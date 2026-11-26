-- M9 95 角色權限授權 rollback（只還原本檔動過的列）
-- 來源：新權限勾選頁（survey/m9-permissions，送出時間 2026-11-24T14:17:43.674Z）
-- 授權配對數：33
-- 只處理 m9_role_grant_log 裡記錄的配對：原本沒有的授權列刪掉；原本被關閉的列改回關閉。授權前就持有的不會動。
-- 若 m9_role_grant_log 不存在，代表授權檔沒有執行過，這裡會報錯，不需要 rollback。
BEGIN;

DELETE FROM public.role_permissions rp
USING public.m9_role_grant_log l, public.roles r, public.permissions p
WHERE NOT l.prev_denied
  AND r.code = l.role_code
  AND p.code = l.permission_code
  AND rp.role_id = r.id
  AND rp.permission_id = p.id;

UPDATE public.role_permissions rp SET is_allowed = false
FROM public.m9_role_grant_log l, public.roles r, public.permissions p
WHERE l.prev_denied
  AND r.code = l.role_code
  AND p.code = l.permission_code
  AND rp.role_id = r.id
  AND rp.permission_id = p.id;

DELETE FROM public.m9_role_grant_log;

COMMIT;
