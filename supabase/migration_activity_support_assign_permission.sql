-- ============================================================
-- 新增 activity.support_assign.edit 權限並指派給督導角色
-- 執行環境：Supabase SQL Editor
-- ============================================================

-- 1. 新增權限定義（若已存在則忽略）
INSERT INTO permissions (module, resource, code, action, description)
VALUES ('activity', 'support_assign', 'activity.support_assign.edit', 'edit', '活動人力查看與支援請求管理（查看/編輯管理門市的本店人員）')
ON CONFLICT (code) DO NOTHING;

-- 2. 指派給督導角色 (supervisor_role)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code = 'activity.support_assign.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 指派給營業部主管 (business_supervisor)，通常也需要
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code = 'activity.support_assign.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 驗證：檢查指派結果
SELECT 
  r.code AS 角色代碼,
  r.name AS 角色名稱,
  p.code AS 權限代碼,
  rp.is_allowed AS 是否允許
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'activity.support_assign.edit'
ORDER BY r.code;
