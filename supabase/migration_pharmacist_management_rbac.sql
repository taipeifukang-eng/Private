-- 藥師管理模組 RBAC 權限
-- 需求：
-- 1) business_manager 可編輯/檢視
-- 2) supervisor_role 可檢視

-- 1. 新增權限代碼
INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('store', 'pharmacist_management', 'pharmacist.management.view', 'view', '藥師管理-檢視：查看各督導區藥師任職與職級變化'),
  ('store', 'pharmacist_management', 'pharmacist.management.edit', 'edit', '藥師管理-編輯：可編輯藥師該月職級')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

-- 2. 授予 business_manager：view + edit
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.view', 'pharmacist.management.edit')
WHERE r.code = 'business_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 3. 授予 supervisor_role：view
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'pharmacist.management.view'
WHERE r.code = 'supervisor_role'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 4. （建議）admin_role 也給 view + edit，避免管理員看不到
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.view', 'pharmacist.management.edit')
WHERE r.code = 'admin_role'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 5. 驗證
SELECT
  r.code AS role_code,
  p.code AS permission_code,
  rp.is_allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('pharmacist.management.view', 'pharmacist.management.edit')
  AND r.code IN ('business_manager', 'supervisor_role', 'admin_role')
ORDER BY r.code, p.code;
