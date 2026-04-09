-- ============================================
-- 每月人員狀態：每月人員各式獎金明細 RBAC 權限
-- 2026-04-09
-- ============================================

INSERT INTO permissions (module, feature, code, action, description)
VALUES (
  'monthly',
  'bonus_detail',
  'monthly.status.bonus_detail.view',
  'view',
  '查看每月人員各式獎金明細'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'monthly.status.bonus_detail.view'
WHERE r.code IN ('admin', 'admin_role', 'system_admin')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );
