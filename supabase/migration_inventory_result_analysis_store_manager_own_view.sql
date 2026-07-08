-- ============================================
-- 盤點結果分析報表：店長僅檢視自己門市權限
-- 日期: 2026-07-08
-- ============================================
-- 用途：
--   - inventory.result_analysis.view_own：只能檢視 store_managers 指派門市的盤點結果分析報表
--   - inventory.result_analysis.import：匯入盤點結果分析報表
--
-- 注意：
--   本 migration 只建立權限碼，不自動指派給 store_manager_role。
--   若要讓特定店長只看自己門市，請建立/指派只包含 inventory.result_analysis.view_own 的角色。

INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('盤點管理', 'result_analysis', 'inventory.result_analysis.view_own', 'view_own', '檢視自己門市的盤點結果分析報表'),
  ('盤點管理', 'result_analysis', 'inventory.result_analysis.import', 'import', '匯入盤點結果分析報表')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

-- 管理員角色保底取得匯入權限；一般店長不自動取得。
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('admin', 'admin_role', 'system_admin')
  AND p.code IN ('inventory.result_analysis.view_own', 'inventory.result_analysis.import')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
