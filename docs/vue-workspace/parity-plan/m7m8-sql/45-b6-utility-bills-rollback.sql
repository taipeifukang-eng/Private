-- 45-b6-utility-bills-rollback.sql
-- 撤回 45：移除第 6 批水電帳單函式（ga_ws_ub_*、ga_ub_*）與部分索引，並把讀取政策還原成含店長直讀條件的版本。
-- deletion_reason 欄位保留不刪（已軟刪除的原因是資料，刪欄位會遺失；欄位本身無害）。不動任何帳單資料。撤回後新版水電帳單與報表頁會失效。
-- **正式區原政策若與下面不同，以 41 第 10 區存檔的政策為準**改寫後再執行。撤回前不需要備份（只有函式、索引與政策）。
BEGIN;
DROP FUNCTION IF EXISTS public.ga_ws_ub_stores();
DROP FUNCTION IF EXISTS public.ga_ws_ub_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_ub_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ub_anomaly(jsonb, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ub_save(uuid, jsonb, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.ga_ws_ub_pay(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ub_unpay(uuid, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ub_delete(uuid, text, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ub_report(text, integer, text);
DROP FUNCTION IF EXISTS public.ga_ub_bad_uuid();
DROP FUNCTION IF EXISTS public.ga_ub_check_paid_date(date, date);
DROP FUNCTION IF EXISTS public.ga_ub_original(public.ga_utility_bills);
DROP FUNCTION IF EXISTS public.ga_ub_json(uuid);
DROP FUNCTION IF EXISTS public.ga_ub_anomaly(uuid, text, text, text, date, numeric, uuid);
DROP FUNCTION IF EXISTS public.ga_ub_store_label(uuid);
DROP FUNCTION IF EXISTS public.ga_ub_money_text(numeric);
DROP FUNCTION IF EXISTS public.ga_ub_ident(text, text, text);
DROP FUNCTION IF EXISTS public.ga_ub_num(jsonb, text, text, boolean);
DROP FUNCTION IF EXISTS public.ga_ub_month(text);
DROP FUNCTION IF EXISTS public.ga_ub_date(text, text);
DROP FUNCTION IF EXISTS public.ga_ub_txt(jsonb, text, integer, text);
DROP FUNCTION IF EXISTS public.ga_ub_pending_stats();
DROP FUNCTION IF EXISTS public.ga_ub_is_overdue(date, date, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ub_can_manage(uuid);
DROP FUNCTION IF EXISTS public.ga_ub_can_view(uuid);
DROP INDEX IF EXISTS public.idx_ga_utility_bills_unpaid_due;
DROP POLICY IF EXISTS ga_utility_bills_read ON public.ga_utility_bills;
CREATE POLICY ga_utility_bills_read ON public.ga_utility_bills FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    public.current_user_has_permission('general_affairs.utility_bill.view')
    OR public.current_user_has_permission('general_affairs.utility_bill.manage')
    OR (store_id IS NOT NULL AND public.current_user_manages_store(store_id))
  )
);
-- 移除 ga_resource_attachment_can_manage 的 UTILITY_BILL 分支（只拿掉本批插入的區塊；沒有就略過）。
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure);
  IF position('UTILITY_BILL' in v_def) = 0 THEN RETURN; END IF;
  v_new := regexp_replace(v_def, 'IF p_resource_type = ''UTILITY_BILL'' THEN.*?END IF;\s*', '');
  IF v_new = v_def OR position('UTILITY_BILL' in v_new) > 0 THEN
    RAISE EXCEPTION 'ga_resource_attachment_can_manage 的 UTILITY_BILL 分支格式與預期不同，請人工移除';
  END IF;
  EXECUTE v_new;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
