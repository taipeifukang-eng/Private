-- 還原 20261107120000_m3_task_delete.sql（稽核紀錄表會一併移除，執行前請先匯出需要保留的紀錄）。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_delete_assignment(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_delete_template(uuid,uuid,text);
DROP TABLE IF EXISTS public.workspace_task_delete_audit;
NOTIFY pgrst,'reload schema';
COMMIT;
