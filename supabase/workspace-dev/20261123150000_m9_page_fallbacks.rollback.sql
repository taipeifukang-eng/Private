-- 還原 20261123150000_m9_page_fallbacks.sql：移除備援開關函式與兩張資料表（不動任何舊版資料）。
-- 還原後 session 讀不到備援表時一律視為「沒有任何頁面切回舊版」，選單回到全部開新版。
DROP FUNCTION IF EXISTS public.workspace_set_page_fallback(text, boolean, text, uuid);
DROP TABLE IF EXISTS public.workspace_page_fallback_events;
DROP TABLE IF EXISTS public.workspace_page_fallbacks;
NOTIFY pgrst, 'reload schema';
