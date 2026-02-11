-- ============================================
-- 新增導航欄 RBAC 權限碼
-- ============================================
-- 目的：將 Navbar.tsx 從舊權限系統遷移到 RBAC 系統

-- 【步驟 1】新增導航欄需要的權限碼
INSERT INTO permissions (code, description, module, feature, action) VALUES
  -- 任務管理相關
  ('task.view_own', '查看自己的任務', '任務管理', 'task_own', 'view'),
  ('task.manage', '管理任務模板', '任務管理', 'task_template', 'manage'),
  ('task.view_archived', '查看已封存任務', '任務管理', 'task_archived', 'view'),
  ('dashboard.view', '查看儀表板', '系統', 'dashboard', 'view'),
  
  -- 門市管理相關
  ('store.manager.assign', '指派店長', '門市管理', 'store_manager', 'assign'),
  ('store.supervisor.assign', '指派督導/區經理', '門市管理', 'store_supervisor', 'assign'),
  ('store.manage', '管理門市資料', '門市管理', 'store', 'manage'),
  
  -- 人事管理相關
  ('employee.manage', '管理員工資料', '人事管理', 'employee', 'manage'),
  ('employee.movement.manage', '管理人員異動', '人事管理', 'employee_movement', 'manage'),
  ('employee.import', '批次匯入員工', '人事管理', 'employee_batch', 'import'),
  
  -- 活動管理相關
  ('activity.manage', '管理活動', '活動管理', 'activity', 'manage'),
  
  -- 盤點管理相關
  ('inventory.manage', '管理盤點', '盤點管理', 'inventory', 'manage'),
  
  -- 每月人員狀態相關
  ('monthly.status.export', '匯出每月人員狀態', '每月人員狀態', 'monthly_status', 'export')
ON CONFLICT (code) DO NOTHING;

-- 【步驟 2】為 admin_role 角色分配所有權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id as role_id,
  p.id as permission_id,
  true as is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin_role'
  AND p.code IN (
    'task.view_own', 'task.manage', 'task.view_archived', 'dashboard.view',
    'store.manager.assign', 'store.supervisor.assign', 'store.manage',
    'employee.manage', 'employee.movement.manage', 'employee.import',
    'activity.manage', 'inventory.manage', 'monthly.status.export'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 【步驟 3】為 store_manager_role 分配店長相關權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id as role_id,
  p.id as permission_id,
  true as is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code IN (
    'task.view_own',
    'inventory.manage',
    'monthly.status.view_own'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 【步驟 4】檢查是否有需要創建的營業部角色
-- 如果有營業部助理和主管，建議創建對應的 RBAC 角色

-- 檢查有多少營業部用戶
SELECT 
  department,
  role,
  job_title,
  COUNT(*) as count
FROM profiles
WHERE department LIKE '營業%'
GROUP BY department, role, job_title
ORDER BY department, role, job_title;

-- 【步驟 5】驗證權限已正確建立
SELECT 
  p.code,
  p.description,
  p.module,
  COUNT(rp.id) as assigned_roles
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed = true
WHERE p.code IN (
  'task.view_own', 'task.manage', 'task.view_archived', 'dashboard.view',
  'store.manager.assign', 'store.supervisor.assign', 'store.manage',
  'employee.manage', 'employee.movement.manage', 'employee.import',
  'activity.manage', 'inventory.manage', 'monthly.status.export'
)
GROUP BY p.id, p.code, p.description, p.module
ORDER BY p.code;

-- 【步驟 6】檢查店長角色的權限清單
SELECT 
  r.name as role_name,
  r.code as role_code,
  p.code as permission_code,
  p.description,
  rp.is_allowed
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'store_manager_role'
  AND rp.is_allowed = true
ORDER BY p.code;

-- ============================================
-- 【完成提示】
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ 導航欄權限碼已新增完成！';
  RAISE NOTICE '';
  RAISE NOTICE '下一步：';
  RAISE NOTICE '1. 檢查上方的驗證查詢結果';
  RAISE NOTICE '2. 實施前端代碼變更（useNavbarPermissions Hook）';
  RAISE NOTICE '3. 更新 Navbar.tsx 使用 RBAC 權限';
  RAISE NOTICE '4. 測試所有角色的選單顯示';
  RAISE NOTICE '';
  RAISE NOTICE '📝 建議：如有營業部專屬角色需求，請創建：';
  RAISE NOTICE '  - business_assistant_role（營業部助理）';
  RAISE NOTICE '  - business_supervisor_role（營業部主管）';
  RAISE NOTICE '================================================';
END $$;
