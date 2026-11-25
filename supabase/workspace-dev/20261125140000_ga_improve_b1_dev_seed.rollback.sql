-- 還原 20261125140000_ga_improve_b1_dev_seed.sql：只刪測試資料清除函式（不動任何資料與角色）。可重複執行。
DROP FUNCTION IF EXISTS public.ga_dev_cleanup_ga_improve_b1(text, text);
NOTIFY pgrst, 'reload schema';
