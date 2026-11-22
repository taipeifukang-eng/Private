-- 還原 20261122130000_m6_supervisor_log_rpc.sql：移除軟刪除函式（不動任何資料與舊版函式）。
DROP FUNCTION IF EXISTS public.workspace_supervisor_soft_delete(text, uuid, text);
NOTIFY pgrst, 'reload schema';
