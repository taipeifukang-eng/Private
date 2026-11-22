-- 53-b45-vendor-bank-rollback.sql
-- 撤回 53：移除廠商銀行四欄與長度檢查。會刪除已填的銀行資料（請款單上的銀行快照在請款單裡，不受影響）。要先撤回 56（函式參照這四欄）。
-- 撤回前備份：
--   CREATE TABLE public.zz_bak_b45_53_vendor_bank AS SELECT id, bank_name, bank_branch, bank_account, bank_account_name FROM public.ga_vendors WHERE bank_name IS NOT NULL OR bank_account IS NOT NULL;
BEGIN;

ALTER TABLE public.ga_vendors DROP CONSTRAINT IF EXISTS ga_vendors_bank_length_check;
ALTER TABLE public.ga_vendors DROP COLUMN IF EXISTS bank_account_name, DROP COLUMN IF EXISTS bank_account, DROP COLUMN IF EXISTS bank_branch, DROP COLUMN IF EXISTS bank_name;
NOTIFY pgrst, 'reload schema';

COMMIT;
