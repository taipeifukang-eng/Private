-- M3 A.4 步驟 C：撤回步驟 B 新增的授權（只刪備份表登記的列，不動原本就有的授權）。
-- 本檔以 BEGIN; 開頭，不會自動提交，看過筆數再另外執行 COMMIT; 或 ROLLBACK;。
BEGIN;
DELETE FROM role_permissions
WHERE id::text IN (SELECT role_permission_id FROM public.m3_task_view_archived_grants);
DROP TABLE IF EXISTS public.m3_task_view_archived_grants;
-- 檢查完畢後，另外執行 COMMIT; 或 ROLLBACK;
