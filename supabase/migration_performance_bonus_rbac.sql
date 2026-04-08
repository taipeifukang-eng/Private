-- ============================================
-- 業績管理：每月獎金匯入 RBAC 權限
-- 2026-04-08
-- ============================================

-- 1) 新增權限碼
INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('performance', 'bonus', 'performance.bonus.view', 'view', '檢視每月獎金匯入資料'),
  ('performance', 'bonus', 'performance.bonus.import', 'import', '匯入每月獎金資料')
ON CONFLICT (code) DO NOTHING;

-- 2) 指派給 admin 角色（含常見 admin 代碼）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'performance.bonus.view'
WHERE r.code IN ('admin', 'admin_role', 'system_admin')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'performance.bonus.import'
WHERE r.code IN ('admin', 'admin_role', 'system_admin')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );
