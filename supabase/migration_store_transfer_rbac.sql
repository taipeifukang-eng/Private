-- ============================================================
-- 調店登記確認模組 - RBAC 權限設定
-- 新增 employee.store_transfer.create 與 employee.store_transfer.confirm
-- ============================================================

-- 1. 新增權限碼
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('employee', 'store_transfer', 'employee.store_transfer.create', 'create', '新增調店申請 - 登記員工調店請求，待督導確認')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('employee', 'store_transfer', 'employee.store_transfer.confirm', 'confirm', '確認調店申請 - 督導確認生效日期並寫入異動歷程')
ON CONFLICT (code) DO NOTHING;

-- 2. 授予 admin 兩個權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('employee.store_transfer.create', 'employee.store_transfer.confirm')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 授予 business_supervisor（營業部主管）新增調店申請權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code = 'employee.store_transfer.create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. 授予 business_assistant（營業部助理）新增調店申請權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_assistant'
  AND p.code = 'employee.store_transfer.create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. 授予 supervisor_role（督導）確認調店申請權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code = 'employee.store_transfer.confirm'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6. 驗證結果
SELECT
  r.name AS 角色名稱,
  r.code AS 角色代碼,
  p.code AS 權限代碼,
  p.description AS 說明
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id AND rp.is_allowed = true
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('employee.store_transfer.create', 'employee.store_transfer.confirm')
ORDER BY r.code, p.code;
