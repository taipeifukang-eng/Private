-- M9 正式區草稿 70 還原：門市、店長與督導。尚未套用。
-- 移除本組新增的政策、函式、資料表。不刪除權限碼（store.store.create／clone 在正式區原本就存在）；
-- 也不碰任何既有資料表資料（stores、store_managers、store_relocation_history 等原樣保留）。
-- 注意：會刪除 workspace_store_requests（冪等紀錄）。要留存請先自行備份。
-- 若管理員已用勾選頁把這五個權限碼授權給角色，權限碼與授權列都保留，無須處理。
BEGIN;
DROP POLICY IF EXISTS workspace_store_inactive_read ON public.stores;
DROP FUNCTION IF EXISTS public.workspace_can_read_inactive_store();
DROP FUNCTION IF EXISTS public.workspace_set_supervisor_choices(uuid,text,uuid[],jsonb,text[]);
DROP FUNCTION IF EXISTS public.workspace_set_supervisor(uuid,text,uuid[],uuid[],text[]);
DROP FUNCTION IF EXISTS public.workspace_set_store_manager(uuid,uuid[],text[]);
DROP FUNCTION IF EXISTS public.workspace_store_mutate(uuid,uuid,text,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_store_history(uuid);
DROP FUNCTION IF EXISTS public.workspace_store_catalog(boolean,uuid);
DROP TABLE IF EXISTS public.workspace_store_requests;
NOTIFY pgrst,'reload schema';
COMMIT;
