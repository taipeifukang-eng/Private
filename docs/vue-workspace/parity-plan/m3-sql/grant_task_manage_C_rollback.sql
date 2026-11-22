-- M3 F1 補授權 task.manage：步驟 C（撤回）。依備份表只刪除步驟 B 新增的人員指派、授權與專用角色；其他資料不動。
-- 以 BEGIN; 開頭，不自動提交；看過筆數後另外執行 COMMIT; 或 ROLLBACK;。
BEGIN;
DELETE FROM user_roles WHERE id IN (SELECT row_id FROM public.m3_task_manage_grants WHERE kind = 'user_role');
DELETE FROM role_permissions WHERE id IN (SELECT row_id FROM public.m3_task_manage_grants WHERE kind = 'role_permission');
-- 專用角色只有在沒有其他人使用時才刪
DELETE FROM roles r
WHERE r.id IN (SELECT row_id FROM public.m3_task_manage_grants WHERE kind = 'role')
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id);
DELETE FROM public.m3_task_manage_grants;
-- 備份表已清空；確認無誤後可另外執行 DROP TABLE public.m3_task_manage_grants;
-- 檢查完畢後，另外執行 COMMIT; 或 ROLLBACK;
