-- 還原 20261127110000_ga_ub_year_matrix.sql（年度逐月檢視）：只移除唯讀函式，沒有資料會遺失。可重複執行。
DROP FUNCTION IF EXISTS public.ga_ws_ub_year_matrix(integer);
NOTIFY pgrst, 'reload schema';
