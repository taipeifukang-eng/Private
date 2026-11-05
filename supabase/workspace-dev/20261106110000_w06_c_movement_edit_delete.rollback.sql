-- W06 C 組 rollback：移除修改／刪除異動的函式（皆為新增函式，沒有舊版本可還原）。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_movement_delete(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_movement_update(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.workspace_employee_master_resync(text);
COMMIT;
