-- M7/M8 第 4.5 批追加 F6（2026-11-20 驗收問卷）：廠商銀行帳號修改歷程（DEV）。
-- 內容：
--   1. 新表 ga_vendor_bank_changes（只新增不可改刪）：誰（changed_by）、何時（changed_at）、新增或修改（op）、四個銀行欄位的舊值與新值（old_bank／new_bank）、有變動的欄位（changed_fields）。
--      以 ga_vendors 上的觸發器寫入，所以不論從畫面、API、SQL 或測試腳本改銀行欄位都會留紀錄（新增廠商時只要有任何銀行欄位有值也記一筆，op = INSERT）。
--      只有四個銀行欄位其中之一真的有變才記；改別的欄位不記。changed_by 取 auth.uid()（沒有登入身分，例如 service role 直接改，只在 ga_vendors.updated_by 同一次有被改動時才採用它，否則留空，避免算到上一個修改的人頭上）。
--   2. 表啟用 RLS 且不開放 policy，並撤銷 anon／authenticated 的所有權限（銀行帳號是帳務機密）；讀取只能走 ga_ws_vendor_bank_log，伺服端用 ga_vd_can_view（vendor.view 或 vendor.manage，
--      與廠商銀行欄位本身的可見規則 ga_ws_vendor_get 相同）判斷，沒有權限回 403。
--   3. ga_ws_vendor_bank_log(p_vendor_id, p_page, p_page_size)：新到舊，回 {rows:[{id, changed_at, changed_by, changed_by_name, op, changed_fields, old, new}], total, page, page_size}。
--   刪除廠商時歷程跟著刪（外鍵 CASCADE；刪除觸發器只放行外鍵連鎖刪除，直接 DELETE／UPDATE／TRUNCATE 一律擋）。
-- 先決：20261119120000（廠商銀行欄位）、第 6 批 44（ga_vd_can_view）。
-- 還原：20261120100000_m7m8_b45f_vendor_bank_log.rollback.sql（會刪掉修改歷程，正式區撤回前先備份）。可重複執行。
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
