-- ============================================================
-- RBAC 系統權限點補充
-- 說明: 為全面遷移補充缺少的權限點
-- 執行日期: 2026-02-10
-- ============================================================

-- 0. 先查看現有角色（用於診斷）
-- SELECT code, name FROM roles ORDER BY name;

-- 1. 新增匯出功能權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'export', 'monthly.export.download', 'export', '匯出每月狀態資料（Excel）')
ON CONFLICT (code) DO NOTHING;

-- 2. 新增活動查看全部權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('activity', 'campaign', 'activity.campaign.view_all', 'view_all', '查看所有活動（不受門市限制）')
ON CONFLICT (code) DO NOTHING;

-- 3. 新增每月人員狀態權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'status', 'monthly.status.view', 'view', '查看每月人員狀態（僅自己管理的門市）')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'status', 'monthly.status.view_all', 'view_all', '查看所有門市的每月人員狀態')
ON CONFLICT (code) DO NOTHING;

-- 4. 新增門市管理權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('store', 'store', 'store.store.create', 'create', '建立新門市')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('store', 'store', 'store.store.clone', 'clone', '複製/搬移門市')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('store', 'manager', 'store.manager.assign', 'assign', '指派門市管理者（店長/督導）')
ON CONFLICT (code) DO NOTHING;

-- 5. 新增每月狀態確認權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'status', 'monthly.status.confirm', 'confirm', '確認門市月度狀態')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'status', 'monthly.status.revert', 'revert', '恢復提交狀態（從已提交改回待填寫）')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('monthly', 'status', 'monthly.status.unconfirm', 'unconfirm', '取消確認門市狀態')
ON CONFLICT (code) DO NOTHING;

-- 6. 新增人員異動刪除權限（如果尚未存在）
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('employee', 'promotion', 'employee.promotion.delete', 'delete', '刪除人員異動歷史記錄')
ON CONFLICT (code) DO NOTHING;

-- 7. 將權限授予對應角色

-- 7.1 admin 角色獲得所有新權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN (
    'monthly.export.download', 
    'activity.campaign.view_all', 
    'monthly.status.view_all',
    'store.store.create',
    'store.store.clone',
    'store.manager.assign',
    'monthly.status.confirm',
    'monthly.status.revert',
    'monthly.status.unconfirm',
    'employee.promotion.delete'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7.2 營業部主管獲得查看全部門市權限及門市管理權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code IN (
    'monthly.export.download', 
    'activity.campaign.view_all', 
    'monthly.status.view_all',
    'store.store.create',
    'store.store.clone',
    'store.manager.assign',
    'monthly.status.confirm',
    'monthly.status.revert',
    'employee.promotion.delete'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7.3 營業部助理獲得查看全部門市權限及取消確認權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_assistant'
  AND p.code IN (
    'monthly.export.download', 
    'monthly.status.view_all',
    'monthly.status.unconfirm'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7.4 督導角色獲得查看權限和確認/恢復權限（僅自己門市）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code IN (
    'activity.campaign.view', 
    'monthly.status.view',
    'monthly.status.confirm',
    'monthly.status.revert'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7.5 店長角色獲得查看權限和確認/恢復權限（僅自己門市）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code IN (
    'activity.campaign.view', 
    'monthly.status.view',
    'monthly.status.confirm',
    'monthly.status.revert'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 驗證：查看所有權限
SELECT 
  p.code as 權限代碼,
  p.description as 權限說明,
  COUNT(rp.id) as 已授予角色數
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed = true
WHERE p.code IN (
  'employee.employee.create',
  'employee.employee.edit',
  'monthly.status.view',
  'monthly.status.view_all',
  'employee.promotion.batch',
  'monthly.export.download',
  'activity.campaign.view',
  'activity.campaign.view_all',
  'store.store.create',
  'store.store.clone',
  'store.manager.assign',
  'monthly.status.confirm',
  'monthly.status.revert',
  'monthly.status.unconfirm',
  'employee.promotion.delete'
)
GROUP BY p.id, p.code, p.description
ORDER BY p.code;

-- 驗證：查看角色的權限
SELECT 
  r.name as 角色名稱,
  r.code as 角色代碼,
  COUNT(rp.id) as 擁有權限數
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.is_allowed = true
GROUP BY r.id, r.name, r.code
ORDER BY r.name;
