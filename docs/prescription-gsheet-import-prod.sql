-- ============================================================================
-- 【處方箋 Google Sheet 匯入】正式區執行用 SQL
-- ============================================================================
--
-- 這份 SQL 在做什麼（白話說明）
--   處方箋頁新增「匯入 Google Sheet 下載的 xlsx」功能（每店一般／連續／加總三列、每月一組張數／金額）。
--   表上的店別是簡稱（南港、東湖…），系統需要一張「門市簡稱對照表」記住簡稱對到哪一家門市。
--   這份 SQL 會：
--     1. 新增資料表 prescription_store_aliases（簡稱對照表，一個簡稱只對一家門市）。
--        只有後台程式（service role）能讀寫，一般登入者與匿名使用者完全不能直接存取。
--     2. 新增函式 import_prescription_report_batch：匯入時「存簡稱＋寫處方箋月報」在同一個交易內完成，
--        任何一步失敗整批還原，不會留下半套資料。只有後台程式能呼叫。
--   不會改動、不會刪除任何既有資料（monthly_prescription_reports 完全不動）。
--
-- 執行方式（Supabase 正式區，SQL Editor）
--   1. 順序：先執行這份 SQL，再部署新版程式（新程式匯入時會讀簡稱對照表與呼叫上面的函式）。
--   2. 整份複製貼到 SQL Editor，按 Run。
--   3. 最後一段會顯示一列「驗證結果」，三個欄位都應該是 true。
--   4. 可以重複執行，不會重複新增或出錯。
--   5. 中途出現紅字錯誤時整份會自動還原（包在 BEGIN ... COMMIT 裡），請把錯誤訊息給我。
--   6. 不需要在權限管理新增任何權限：匯入與修改對照表沿用既有的「業績管理：編輯（performance.edit）」，
--      查看對照表沿用「業績管理：查看」。
--
-- 想要復原的話
--   執行 docs/prescription-gsheet-import-prod-rollback.sql（會刪除簡稱對照表內容，月報資料不受影響）。
--
-- 設計與使用說明：處方箋分頁 → 匯入 Excel → 預覽 → 確認；底部「門市簡稱對照表」可查看、修改、刪除。
-- ============================================================================

-- 處方箋 Google Sheet 匯入：門市簡稱對照表 + 整批原子匯入函式。
-- 1. public.prescription_store_aliases：簡稱（已正規化：去空白、全形轉半形）對應一家門市。簡稱唯一；一家門市可有多個簡稱。
--    只有 service_role 能讀寫（和 monthly_prescription_reports 一樣，由 API 檢查 performance.edit 後用 service role 操作）。
-- 2. public.import_prescription_report_batch(...)：同一個交易內先存簡稱對照、再 upsert 處方箋月報，任何一步失敗整批還原。
-- 冪等：可重複執行。rollback 見 supabase/rollback_prescription_store_aliases.sql。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.monthly_prescription_reports') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables for prescription store aliases migration';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.prescription_store_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL
    CHECK (alias = btrim(alias) AND alias <> '' AND char_length(alias) <= 40),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_store_aliases_alias_key UNIQUE (alias)
);

CREATE INDEX IF NOT EXISTS idx_prescription_store_aliases_store_id
  ON public.prescription_store_aliases (store_id);

COMMENT ON TABLE public.prescription_store_aliases IS
  'Google Sheet prescription import: store short name (normalized) to store mapping. One alias maps to exactly one store.';

ALTER TABLE public.prescription_store_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prescription_store_aliases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prescription_store_aliases TO service_role;

CREATE OR REPLACE FUNCTION public.import_prescription_report_batch(
  p_year_month text,
  p_reports jsonb,
  p_aliases jsonb,
  p_user uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid year_month %', p_year_month USING ERRCODE = '22023';
  END IF;
  IF p_reports IS NULL OR jsonb_typeof(p_reports) <> 'array' OR jsonb_array_length(p_reports) = 0 THEN
    RAISE EXCEPTION 'no reports to import' USING ERRCODE = '22023';
  END IF;

  IF p_aliases IS NOT NULL AND jsonb_typeof(p_aliases) = 'array' AND jsonb_array_length(p_aliases) > 0 THEN
    INSERT INTO public.prescription_store_aliases (alias, store_id, created_by)
    SELECT a.alias, a.store_id, p_user
    FROM jsonb_to_recordset(p_aliases) AS a(alias text, store_id uuid)
    ON CONFLICT (alias) DO UPDATE
      SET store_id = EXCLUDED.store_id, updated_at = now();
  END IF;

  INSERT INTO public.monthly_prescription_reports (
    year_month, store_id,
    regular_prescription_count, regular_prescription_point_value,
    chronic_prescription_count, chronic_prescription_point_value,
    prescription_data_updated_at, prescription_data_updated_by, updated_at
  )
  SELECT
    p_year_month, r.store_id,
    r.regular_prescription_count, r.regular_prescription_point_value,
    r.chronic_prescription_count, r.chronic_prescription_point_value,
    now(), p_user, now()
  FROM jsonb_to_recordset(p_reports) AS r(
    store_id uuid,
    regular_prescription_count integer,
    regular_prescription_point_value numeric,
    chronic_prescription_count integer,
    chronic_prescription_point_value numeric
  )
  ON CONFLICT (year_month, store_id) DO UPDATE SET
    regular_prescription_count = EXCLUDED.regular_prescription_count,
    regular_prescription_point_value = EXCLUDED.regular_prescription_point_value,
    chronic_prescription_count = EXCLUDED.chronic_prescription_count,
    chronic_prescription_point_value = EXCLUDED.chronic_prescription_point_value,
    prescription_data_updated_at = EXCLUDED.prescription_data_updated_at,
    prescription_data_updated_by = EXCLUDED.prescription_data_updated_by,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_prescription_report_batch(text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_prescription_report_batch(text, jsonb, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ----------------------------------------------------------------------------
-- 驗證結果：下面這一列的三個欄位都應該是 true
-- ----------------------------------------------------------------------------
SELECT
  to_regclass('public.prescription_store_aliases') IS NOT NULL AS "簡稱對照表 已建立",
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'import_prescription_report_batch' AND pronamespace = 'public'::regnamespace) AS "整批匯入函式 已建立",
  NOT has_table_privilege('authenticated', 'public.prescription_store_aliases', 'SELECT') AS "一般登入者不能直接讀寫對照表";
