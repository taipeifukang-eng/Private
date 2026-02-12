-- ============================================
-- 新增導航欄 RBAC 權限碼
-- ============================================
-- 目的：將 Navbar.tsx 從舊權限系統遷移到 RBAC 系統

-- 【步驟 1】新增導航欄需要的權限碼
INSERT INTO permissions (code, description, module, feature, action) VALUES
  -- ========================================
  -- 任務管理模組
  -- ========================================
  ('task.view_own', '查看自己的任務 - 允許查看指派給自己的所有任務', '任務管理', 'task_own', 'view'),
  ('task.manage', '管理任務模板 - 允許新增、編輯、刪除任務範本和指派任務給他人', '任務管理', 'task_template', 'manage'),
  ('task.view_archived', '查看已封存任務 - 允許查看歷史已完成或已封存的任務記錄', '任務管理', 'task_archived', 'view'),
  
  -- ========================================
  -- 系統管理模組
  -- ========================================
  ('dashboard.view', '查看儀表板 - 允許訪問系統主儀表板，查看統計數據和概覽', '系統', 'dashboard', 'view'),
  
  -- ========================================
  -- 門市管理模組
  -- ========================================
  ('store.manage', '管理門市資料 - 允許新增、編輯門市基本資料（名稱、地址、聯絡方式）', '門市管理', 'store', 'manage'),
  ('store.manager.assign', '指派店長 - 允許為門市指派或更換店長', '門市管理', 'store_manager', 'assign'),
  ('store.supervisor.assign', '指派督導/區經理 - 允許為門市指派督導或區經理進行管理', '門市管理', 'store_supervisor', 'assign'),
  
  -- ========================================
  -- 員工與人事管理模組
  -- ========================================
  ('employee.manage', '管理員工資料 - 允許新增、編輯、查看員工基本資料（姓名、員工編號、聯絡方式等）', '人事管理', 'employee', 'manage'),
  ('employee.import', '批次匯入員工 - 允許透過 Excel 檔案批次匯入多筆員工資料', '人事管理', 'employee_batch', 'import'),
  ('employee.movement.manage', '管理人員異動 - 允許記錄和管理員工的調動、升遷、離職等異動紀錄', '人事管理', 'employee_movement', 'manage'),
  
  -- ========================================
  -- 活動管理模組
  -- ========================================
  ('activity.manage', '管理活動 - 允許新增、編輯、刪除公司活動或促銷活動', '活動管理', 'activity', 'manage'),
  
  -- ========================================
  -- 盤點管理模組
  -- ========================================
  ('inventory.manage', '管理盤點 - 允許建立、執行、查看門市盤點作業和盤點結果', '盤點管理', 'inventory', 'manage'),
  
  -- ========================================
  -- 每月人員狀態管理模組
  -- ========================================
  ('monthly.status.view_own', '查看自己管理門市狀態 - 店長可查看自己負責門市的每月人員狀態', '每月人員狀態', 'monthly_status', 'view'),
  ('monthly.status.view_all', '查看所有門市狀態 - 督導/管理員可查看所有門市的每月人員狀態', '每月人員狀態', 'monthly_status_all', 'view'),
  ('monthly.status.view_stats', '查看門市統計資料 - 允許查看門市人員統計、支援時數、獎金等統計數據', '每月人員狀態', 'monthly_status_stats', 'view'),
  ('monthly.status.edit', '編輯門市狀態 - 允許編輯每月人員狀態資料（出勤、請假、獎金等）', '每月人員狀態', 'monthly_status', 'edit'),
  ('monthly.status.submit', '提交門市狀態 - 允許將編輯完成的每月狀態提交審核', '每月人員狀態', 'monthly_status', 'submit'),
  ('monthly.status.confirm', '確認/核簽門市狀態 - 督導/主管可審核並確認店長提交的每月狀態', '每月人員狀態', 'monthly_status', 'confirm'),
  ('monthly.export.stores', '匯出門市資料 - 允許將每月人員狀態匯出成 Excel 報表', '每月人員狀態', 'monthly_export_stores', 'export')
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
    'activity.manage', 'inventory.manage',
    'monthly.status.view_own', 'monthly.status.view_all', 'monthly.status.view_stats',
    'monthly.status.edit', 'monthly.status.submit', 'monthly.status.confirm', 'monthly.export.stores'
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
    'monthly.status.view_own',
    'monthly.status.view_stats',
    'monthly.status.edit',
    'monthly.status.submit'
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
  'activity.manage', 'inventory.manage',
  'monthly.status.view_own', 'monthly.status.view_all', 'monthly.status.view_stats',
  'monthly.status.edit', 'monthly.status.submit', 'monthly.status.confirm', 'monthly.export.stores'
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
