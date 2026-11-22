-- 還原 20261119120000_m7m8_b45_vendor_bank.sql：移除廠商銀行四欄（資料一併刪除）。先決：150000 的函式已先撤回（ga_vd_json、ga_ws_vendor_save 不再參照這四欄）。
ALTER TABLE public.ga_vendors DROP CONSTRAINT IF EXISTS ga_vendors_bank_length_check;
ALTER TABLE public.ga_vendors DROP COLUMN IF EXISTS bank_account_name, DROP COLUMN IF EXISTS bank_account, DROP COLUMN IF EXISTS bank_branch, DROP COLUMN IF EXISTS bank_name;
NOTIFY pgrst, 'reload schema';
