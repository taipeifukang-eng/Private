-- ============================================
-- 檢查並修正店長的 profiles 資料
-- ============================================
-- 問題：Navbar 使用舊的權限系統，檢查 profiles.job_title
--       如果 job_title 不是「店長」，即使有 RBAC 角色也看不到選單

-- 【步驟 1】檢查李玹瑩的 profiles 資料
SELECT 
  p.id,
  p.employee_code,
  p.full_name,
  p.email,
  p.role as profile_role,
  p.department,
  p.job_title,
  CASE 
    WHEN p.job_title IN ('督導', '店長', '代理店長', '督導(代理店長)') THEN '✅ job_title 符合 Navbar 要求'
    ELSE '❌ job_title 不符合（Navbar 看不到選單）'
  END as navbar_status
FROM profiles p
WHERE p.full_name LIKE '%李玹瑩%' OR p.employee_code = 'FK0791';

-- 【步驟 2】檢查她的 RBAC 角色
SELECT 
  p.employee_code,
  p.full_name,
  r.code as role_code,
  r.name as role_name,
  ur.is_active,
  CASE 
    WHEN r.code = 'store_manager_role' THEN '✅ 有店長 RBAC 角色'
    ELSE '⚠️ 其他角色'
  END as status
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
WHERE (p.full_name LIKE '%李玹瑩%' OR p.employee_code = 'FK0791')
  AND ur.is_active = true
ORDER BY ur.assigned_at DESC;

-- ============================================
-- 【修復方案 A】為李玹瑩設置正確的 job_title
-- ============================================
-- 這是短期快速修復方案

/*
UPDATE profiles
SET 
  job_title = '店長',
  role = 'manager',  -- 建議設為 manager，這樣也能看到其他管理功能
  department = '營業一部'  -- 如果知道她的部門，請設置正確的部門
WHERE full_name LIKE '%李玹瑩%' OR employee_code = 'FK0791';

-- 驗證修改
SELECT 
  employee_code,
  full_name,
  role,
  department,
  job_title,
  '✅ 已更新' as status
FROM profiles
WHERE full_name LIKE '%李玹瑩%' OR employee_code = 'FK0791';
*/

-- ============================================
-- 【修復方案 B】批次更新所有有 store_manager_role 的用戶
-- ============================================
-- 確保所有店長都有正確的 job_title

/*
-- 先查看有多少店長需要更新
SELECT 
  p.employee_code,
  p.full_name,
  p.job_title as current_job_title,
  p.department,
  p.role as current_role,
  CASE 
    WHEN p.job_title IN ('督導', '店長', '代理店長', '督導(代理店長)') THEN '✅ 已正確'
    ELSE '❌ 需要更新'
  END as status
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
WHERE r.code = 'store_manager_role'
  AND ur.is_active = true
ORDER BY status DESC, p.employee_code;

-- 如果確認要批次更新，執行以下 SQL：
UPDATE profiles
SET 
  job_title = CASE 
    WHEN job_title IS NULL OR job_title NOT IN ('督導', '店長', '代理店長', '督導(代理店長)') 
    THEN '店長'
    ELSE job_title
  END,
  role = CASE 
    WHEN role = 'member' THEN 'manager'  -- 將 member 升級為 manager
    ELSE role
  END
WHERE id IN (
  SELECT ur.user_id
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE r.code = 'store_manager_role'
    AND ur.is_active = true
);

-- 驗證批次更新結果
SELECT 
  p.employee_code,
  p.full_name,
  p.job_title,
  p.department,
  p.role,
  '✅ 已更新' as status
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
WHERE r.code = 'store_manager_role'
  AND ur.is_active = true
ORDER BY p.employee_code;
*/

-- ============================================
-- 【長期方案】遷移 Navbar 到 RBAC 系統
-- ============================================
-- 注意：這是建議，需要修改 components/Navbar.tsx 代碼

/*
建議修改：
1. 移除 needsAssignment, isBusinessAssistant, isBusinessSupervisor
2. 改為使用 RBAC 權限檢查：hasPermission(user.id, 'permission.code')
3. 為每個選單項目定義對應的權限碼

例如：
- 店長指派: store.manager.assign
- 門市管理: store.manage
- 員工管理: employee.manage
- 盤點管理: inventory.manage

這樣所有權限檢查都統一使用 RBAC 系統，不再依賴 profiles 表的 role/department/job_title。
*/

-- ============================================
-- 【診斷總結】
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '診斷總結：';
  RAISE NOTICE '';
  RAISE NOTICE '問題：Navbar 使用舊的權限系統';
  RAISE NOTICE '  - 檢查 profiles.job_title 是否在 [督導, 店長, 代理店長, 督導(代理店長)]';
  RAISE NOTICE '  - 不使用 RBAC 的 user_roles 和 role_permissions';
  RAISE NOTICE '';
  RAISE NOTICE '短期解決方案：';
  RAISE NOTICE '  - 執行【修復方案 A】更新李玹瑩的 job_title = 店長';
  RAISE NOTICE '  - 或執行【修復方案 B】批次更新所有店長';
  RAISE NOTICE '';
  RAISE NOTICE '長期解決方案：';
  RAISE NOTICE '  - 將 Navbar.tsx 遷移到 RBAC 權限系統';
  RAISE NOTICE '  - 移除對 profiles 欄位的依賴';
  RAISE NOTICE '  - 所有權限檢查統一使用 hasPermission()';
  RAISE NOTICE '';
  RAISE NOTICE '================================================';
END $$;
