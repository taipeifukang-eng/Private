-- 還原 20261120100000_m7m8_b45f_vendor_bank_log.sql：移除讀取函式、寫入觸發器與函式、修改歷程表。會刪掉所有廠商銀行修改歷程（正式區撤回前先備份）。
DROP FUNCTION IF EXISTS public.ga_ws_vendor_bank_log(uuid, integer, integer);
DROP TRIGGER IF EXISTS trg_ga_vendors_bank_log ON public.ga_vendors;
DROP FUNCTION IF EXISTS public.ga_vendor_bank_log_write();
DROP TABLE IF EXISTS public.ga_vendor_bank_changes;
DROP FUNCTION IF EXISTS public.ga_vendor_bank_changes_immutable();
NOTIFY pgrst, 'reload schema';
