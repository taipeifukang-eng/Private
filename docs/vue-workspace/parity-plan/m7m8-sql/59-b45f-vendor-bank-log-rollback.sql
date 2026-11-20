-- 59-b45f-vendor-bank-log-rollback.sql
-- 撤回 59：移除讀取函式、寫入觸發器與函式、修改歷程表。會刪除全部廠商銀行修改歷程。
-- 撤回前備份：
--   CREATE TABLE public.zz_bak_b45f_59_bank_changes AS SELECT * FROM public.ga_vendor_bank_changes;
BEGIN;

DROP FUNCTION IF EXISTS public.ga_ws_vendor_bank_log(uuid, integer, integer);
DROP TRIGGER IF EXISTS trg_ga_vendors_bank_log ON public.ga_vendors;
DROP FUNCTION IF EXISTS public.ga_vendor_bank_log_write();
DROP TABLE IF EXISTS public.ga_vendor_bank_changes;
DROP FUNCTION IF EXISTS public.ga_vendor_bank_changes_immutable();
NOTIFY pgrst, 'reload schema';

COMMIT;
