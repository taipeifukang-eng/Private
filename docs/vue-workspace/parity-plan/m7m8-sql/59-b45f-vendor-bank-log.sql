-- 59-b45f-vendor-bank-log.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261120100000_m7m8_b45f_vendor_bank_log.sql 相同。
-- 第 4.5 批追加 F6（廠商銀行帳號修改歷程；2026-11-20 驗收問卷）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入（新增 1 張表、2 個觸發器函式、1 個觸發器、1 個對外函式）。ga_vendor_bank_changes（只新增不可改刪；UPDATE／TRUNCATE 一律擋，DELETE 只放行刪廠商的外鍵連鎖）記錄誰、何時、新增或修改、四個銀行欄位的舊值與新值；
--   ga_vendors 上的觸發器（AFTER INSERT OR UPDATE OF 四個銀行欄位）寫入，所以畫面、API、SQL 任何路徑改銀行欄位都有紀錄；沒有真的變動不記；沒有登入身分時修改人留空。
--   表啟用 RLS、不開 policy、撤銷 anon／authenticated 權限；讀取只能走 ga_ws_vendor_bank_log（需 vendor.view 或 vendor.manage，與廠商銀行欄位本身可見規則相同，否則 403）。
-- 先決條件：先套 53（銀行欄位）與第 6 批 44（ga_vd_can_view）。不回填既有廠商的歷史（套用前的修改沒有紀錄）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：59-b45f-vendor-bank-log-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = 'bank_account') THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261119120000_m7m8_b45_vendor_bank';
  END IF;
  IF to_regprocedure('public.ga_vd_can_view(uuid)') IS NULL OR to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 6 批 44（ga_vd_can_view）與第 4 批 ga_rq_*';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_vendor_bank_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.ga_vendors(id) ON DELETE CASCADE,
  op text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  old_bank jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_bank jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ga_vendor_bank_changes_op_check CHECK (op IN ('INSERT', 'UPDATE'))
);
CREATE INDEX IF NOT EXISTS idx_ga_vendor_bank_changes_vendor ON public.ga_vendor_bank_changes (vendor_id, changed_at DESC);
ALTER TABLE public.ga_vendor_bank_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_vendor_bank_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ga_vendor_bank_changes TO service_role;

-- 不可改刪：UPDATE、TRUNCATE 一律擋；DELETE 只放行外鍵連鎖（刪廠商）——連鎖刪除時觸發器深度大於 1。
CREATE OR REPLACE FUNCTION public.ga_vendor_bank_changes_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION '廠商銀行修改歷程不可修改或刪除' USING ERRCODE = 'GA045';
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_vendor_bank_changes_immutable ON public.ga_vendor_bank_changes;
CREATE TRIGGER trg_ga_vendor_bank_changes_immutable BEFORE UPDATE OR DELETE ON public.ga_vendor_bank_changes FOR EACH ROW EXECUTE FUNCTION public.ga_vendor_bank_changes_immutable();
DROP TRIGGER IF EXISTS trg_ga_vendor_bank_changes_no_truncate ON public.ga_vendor_bank_changes;
CREATE TRIGGER trg_ga_vendor_bank_changes_no_truncate BEFORE TRUNCATE ON public.ga_vendor_bank_changes FOR EACH STATEMENT EXECUTE FUNCTION public.ga_vendor_bank_changes_immutable();

-- 寫入歷程的觸發器函式（SECURITY DEFINER：登入者本身沒有這張表的寫入權限）。
CREATE OR REPLACE FUNCTION public.ga_vendor_bank_log_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_fields text[];
BEGIN
  v_new := jsonb_build_object('bank_name', NEW.bank_name, 'bank_branch', NEW.bank_branch, 'bank_account', NEW.bank_account, 'bank_account_name', NEW.bank_account_name);
  IF TG_OP = 'INSERT' THEN
    v_old := jsonb_build_object('bank_name', NULL, 'bank_branch', NULL, 'bank_account', NULL, 'bank_account_name', NULL);
  ELSE
    v_old := jsonb_build_object('bank_name', OLD.bank_name, 'bank_branch', OLD.bank_branch, 'bank_account', OLD.bank_account, 'bank_account_name', OLD.bank_account_name);
  END IF;
  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_fields FROM unnest(ARRAY['bank_name', 'bank_branch', 'bank_account', 'bank_account_name']) k WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
  IF COALESCE(array_length(v_fields, 1), 0) = 0 THEN RETURN NEW; END IF;
  INSERT INTO public.ga_vendor_bank_changes (vendor_id, op, changed_fields, old_bank, new_bank, changed_by)
  VALUES (NEW.id, TG_OP, v_fields, v_old, v_new, COALESCE(auth.uid(), CASE WHEN TG_OP = 'INSERT' OR NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_vendor_bank_log_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ga_vendors_bank_log ON public.ga_vendors;
CREATE TRIGGER trg_ga_vendors_bank_log AFTER INSERT OR UPDATE OF bank_name, bank_branch, bank_account, bank_account_name ON public.ga_vendors FOR EACH ROW EXECUTE FUNCTION public.ga_vendor_bank_log_write();

-- 讀取：只有 vendor.view／manage（與廠商銀行欄位同規則）。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_bank_log(p_vendor_id uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看廠商銀行資料修改歷程的權限'); END IF;
  IF p_vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ga_vendors WHERE id = p_vendor_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個廠商'); END IF;
  SELECT count(*) INTO v_total FROM public.ga_vendor_bank_changes WHERE vendor_id = p_vendor_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'changed_at', x.changed_at, 'changed_by', x.changed_by, 'changed_by_name', COALESCE(nullif(btrim(pr.full_name), ''), pr.email),
           'op', x.op, 'changed_fields', to_jsonb(x.changed_fields), 'old', x.old_bank, 'new', x.new_bank) ORDER BY x.changed_at DESC, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT * FROM public.ga_vendor_bank_changes WHERE vendor_id = p_vendor_id ORDER BY changed_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) x
    LEFT JOIN public.profiles pr ON pr.id = x.changed_by;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;
REVOKE ALL ON FUNCTION public.ga_ws_vendor_bank_log(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_vendor_bank_log(uuid, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT to_regclass('public.ga_vendor_bank_changes') AS log_table, to_regprocedure('public.ga_ws_vendor_bank_log(uuid,integer,integer)') AS read_fn;
-- 核對：兩個都不是空的
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_ga_vendors_bank_log', 'trg_ga_vendor_bank_changes_immutable', 'trg_ga_vendor_bank_changes_no_truncate') ORDER BY 1;
-- 核對：應列出 3 個觸發器
