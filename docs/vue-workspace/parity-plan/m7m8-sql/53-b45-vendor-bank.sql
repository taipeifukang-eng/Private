-- 53-b45-vendor-bank.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119120000_m7m8_b45_vendor_bank.sql 相同。
-- 第 4.5 批 C（廠商銀行資料：銀行名稱、分行、帳號、戶名；P8）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入（只加欄位）。ga_vendors 新增 bank_name、bank_branch、bank_account、bank_account_name 四個可為空的欄位與長度檢查。屬帳務機密（與第 6 批 V1 同規則：只有廠商查看或管理權限者看得到）；請款單建立時快照。
-- 不改既有資料；函式（ga_ws_vendor_save、ga_vd_json）的擴充在 56。
-- 先決條件：ga_vendors 存在。上線後請人逐一補廠商銀行資料（50 第 6 區有廠商筆數）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：53-b45-vendor-bank-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

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

COMMIT;

-- 核對
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name LIKE 'bank%' ORDER BY 1;
-- 核對：應列出 4 個欄位
