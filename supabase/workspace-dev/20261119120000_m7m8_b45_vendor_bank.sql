-- M7/M8 第 4.5 批 C（G45，P8）：廠商銀行資料（一組：銀行名稱、分行、帳號、戶名）。屬帳務機密，與第 6 批 V1 同規則：只有廠商查看／管理權限者看得到；請款單建立時快照。
-- 本檔只加欄位與長度檢查；函式（ga_ws_vendor_save 與 ga_vd_json 擴充）在 20261119150000。
-- 還原：20261119120000_m7m8_b45_vendor_bank.rollback.sql（會刪掉廠商銀行資料，正式區撤回前先備份）。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.ga_vendors') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: ga_vendors'; END IF;
END $$;

ALTER TABLE public.ga_vendors ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.ga_vendors ADD COLUMN IF NOT EXISTS bank_branch text;
ALTER TABLE public.ga_vendors ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE public.ga_vendors ADD COLUMN IF NOT EXISTS bank_account_name text;
DO $$ BEGIN
  ALTER TABLE public.ga_vendors ADD CONSTRAINT ga_vendors_bank_length_check CHECK (
    (bank_name IS NULL OR char_length(bank_name) <= 60) AND (bank_branch IS NULL OR char_length(bank_branch) <= 60)
    AND (bank_account IS NULL OR char_length(bank_account) <= 40) AND (bank_account_name IS NULL OR char_length(bank_account_name) <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
NOTIFY pgrst, 'reload schema';
