-- 回復「巡店強制定位」：移除 BEFORE INSERT trigger 與函式。可重複執行。
DROP TRIGGER IF EXISTS trg_inspection_masters_require_gps ON public.inspection_masters;
DROP FUNCTION IF EXISTS public.enforce_inspection_gps_on_insert();
