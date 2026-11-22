-- 還原 20261112140000_m7m8_b4_dev_test_cleanup.sql：移除 DEV 專用測試清除函式（沒有資料表變更）。
-- 還原後，測試真的走完採購流程留下的採購單沒有辦法清除（需另行處理）。
DROP FUNCTION IF EXISTS public.ga_dev_cleanup_m7m8_purchasing(text);
NOTIFY pgrst, 'reload schema';
