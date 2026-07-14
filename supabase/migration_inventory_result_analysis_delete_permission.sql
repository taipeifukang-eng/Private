-- 盤點結果分析報表：刪除匯入批次權限
-- 日期: 2026-07-14

INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('盤點管理', 'result_analysis', 'inventory.result_analysis.delete', 'delete', '刪除盤點結果分析報表匯入批次')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('admin', 'admin_role', 'system_admin')
  AND p.code = 'inventory.result_analysis.delete'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
