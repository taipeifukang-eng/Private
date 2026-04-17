-- ============================================================
-- 藥師管理 - 藥師主檔子權限拆分
-- ============================================================
-- 需求：獨立出藥師主檔的檢視與編輯權限
-- 1) pharmacist.management.master.view - 檢視藥師主檔
-- 2) pharmacist.management.master.edit - 編輯藥師主檔

-- 1. 新增子權限代碼
INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('store', 'pharmacist_master', 'pharmacist.management.master.view', 'view', '藥師管理-主檔檢視：查看藥師基本資料與學位資訊'),
  ('store', 'pharmacist_master', 'pharmacist.management.master.edit', 'edit', '藥師管理-主檔編輯：可編輯藥師基本資料')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

-- 2. 授予 business_manager：master.view + master.edit
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
WHERE r.code = 'business_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 3. 授予 supervisor_role：master.view
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'pharmacist.management.master.view'
WHERE r.code = 'supervisor_role'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 4. 授予 admin_role：master.view + master.edit
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
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
WHERE p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
  AND r.code IN ('business_manager', 'supervisor_role', 'admin_role')
ORDER BY r.code, p.code;
