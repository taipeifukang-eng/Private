-- =====================================================
-- 新增巡店分頁權限
-- 日期: 2026-02-24
-- 說明: 控制督導/經理巡店分頁的可見性
-- =====================================================

-- 1. 新增權限
INSERT INTO permissions (code, description, module, feature, action, is_active)
VALUES
  (
    'inspection.manager_tab',
    '查看經理巡店分頁 - 允許在巡店列表頁面看到「經理巡店」分頁並新增經理巡店記錄',
    '督導巡店',
    'inspection_manager',
    'view',
    true
  ),
  (
    'inspection.compare',
    '查看對比分析 - 允許進入「督導 vs 經理」巡店對比分析頁面',
    '督導巡店',
    'inspection_compare',
    'view',
    true
  )
ON CONFLICT (code) 
DO UPDATE SET
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  is_active = EXCLUDED.is_active;

-- 2. 預設：管理員擁有所有巡店權限（含新增的）
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin_role'
AND p.code IN ('inspection.manager_tab', 'inspection.compare')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 驗證
SELECT p.code, p.description,
  ARRAY_AGG(r.code) AS assigned_roles
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.code IN ('inspection.manager_tab', 'inspection.compare')
GROUP BY p.code, p.description;
