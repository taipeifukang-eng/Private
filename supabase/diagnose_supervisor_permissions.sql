-- ============================================
-- 診斷督導/經理的每月人員狀態權限
-- ============================================
-- 問題：督導/經理被指派管理門市，但看不到每月人員狀態

-- 【檢查 1】檢查經理的基本資料
SELECT 
  id,
  email,
  employee_code,
  full_name,
  role as profile_role,
  job_title,
  department,
  '✅ 用戶存在' as status
FROM profiles
WHERE employee_code = 'FK0052' OR full_name LIKE '%徐孝銘%';

-- 【檢查 2】檢查經理被指派的門市數量
SELECT 
  p.employee_code,
  p.full_name,
  sm.role_type,
  COUNT(sm.store_id) as managed_stores_count,
  CASE 
    WHEN COUNT(sm.store_id) > 0 THEN '✅ 有管理門市'
    ELSE '❌ 沒有管理門市'
  END as status
FROM profiles p
LEFT JOIN store_managers sm ON sm.user_id = p.id
WHERE (p.employee_code = 'FK0052' OR p.full_name LIKE '%徐孝銘%')
GROUP BY p.id, p.employee_code, p.full_name, sm.role_type;

-- 【檢查 3】檢查經理的 RBAC 角色
SELECT 
  p.employee_code,
  p.full_name,
  r.code as role_code,
  r.name as role_name,
  ur.is_active,
  ur.assigned_at,
  CASE 
    WHEN r.code IN ('admin_role', 'supervisor_role', 'area_manager_role') THEN '✅ 有管理角色'
    WHEN r.code = 'store_manager_role' THEN '⚠️ 只有店長角色'
    ELSE '❌ 無管理權限角色'
  END as status
FROM profiles p
LEFT JOIN user_roles ur ON ur.user_id = p.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE (p.employee_code = 'FK0052' OR p.full_name LIKE '%徐孝銘%')
  AND (ur.is_active = true OR ur.is_active IS NULL)
ORDER BY ur.assigned_at DESC;

-- 【檢查 4】檢查經理實際擁有的每月人員狀態權限
SELECT 
  p.employee_code,
  p.full_name,
  perm.code as permission_code,
  perm.description,
  rp.is_allowed,
  r.name as granted_by_role,
  CASE 
    WHEN perm.code = 'monthly.status.view_all' AND rp.is_allowed THEN '✅ 可查看所有門市'
    WHEN perm.code = 'monthly.status.view_own' AND rp.is_allowed THEN '✅ 可查看自己管理的門市'
    WHEN perm.code = 'monthly.status.confirm' AND rp.is_allowed THEN '✅ 可確認/核簽門市狀態'
    WHEN rp.is_allowed THEN '✅ 已啟用'
    ELSE '❌ 已禁用或不存在'
  END as status
FROM profiles p
LEFT JOIN user_roles ur ON ur.user_id = p.id AND ur.is_active = true
LEFT JOIN roles r ON r.id = ur.role_id
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions perm ON perm.id = rp.permission_id
WHERE (p.employee_code = 'FK0052' OR p.full_name LIKE '%徐孝銘%')
  AND perm.code IN (
    'monthly.status.view_all',
    'monthly.status.view_own',
    'monthly.status.edit',
    'monthly.status.submit',
    'monthly.status.confirm',
    'monthly.export.stores'
  )
ORDER BY perm.code;

-- 【檢查 5】列出所有可用的督導/經理角色
SELECT 
  code,
  name,
  description,
  is_active,
  CASE 
    WHEN code IN ('supervisor_role', 'area_manager_role') THEN '✅ 適合督導/經理'
    WHEN code = 'admin_role' THEN '⚠️ 管理員角色（權限過大）'
    ELSE '❌ 不適合'
  END as recommendation
FROM roles
WHERE is_active = true
ORDER BY code;

-- ============================================
-- 【診斷結果】
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '診斷完成！請檢查上述查詢結果：';
  RAISE NOTICE '';
  RAISE NOTICE '必須滿足以下條件才能看到門市：';
  RAISE NOTICE '1. ✅ 用戶存在於 profiles (檢查 1)';
  RAISE NOTICE '2. ✅ 在 store_managers 有被指派門市 (檢查 2)';
  RAISE NOTICE '3. ✅ 在 user_roles 有督導/經理角色 (檢查 3)';
  RAISE NOTICE '4. ✅ 角色有 monthly.status.view_all 或 view_own 權限 (檢查 4)';
  RAISE NOTICE '';
  RAISE NOTICE '如果檢查 3 或 4 是 ❌，需要執行下方的修復 SQL';
  RAISE NOTICE '================================================';
END $$;

-- ============================================
-- 【修復方案 A】為經理指派督導角色
-- ============================================
-- 如果檢查 3 沒有督導角色，請執行以下 SQL

/*
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
BEGIN
  -- 獲取用戶 ID
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0052';
  
  -- 嘗試獲取 supervisor_role
  SELECT id INTO v_role_id FROM roles WHERE code = 'supervisor_role' AND is_active = true;
  
  -- 如果沒有 supervisor_role，使用 admin_role (臨時方案)
  IF v_role_id IS NULL THEN
    SELECT id INTO v_role_id FROM roles WHERE code = 'admin_role' AND is_active = true;
    RAISE NOTICE '⚠️ 找不到 supervisor_role，使用 admin_role 作為替代';
  END IF;
  
  -- 檢查是否都存在
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ 找不到員工編號 FK0052';
  END IF;
  
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '❌ 找不到可用的督導或管理員角色';
  END IF;
  
  RAISE NOTICE '================================================';
  RAISE NOTICE '開始為經理指派角色...';
  RAISE NOTICE '用戶 ID: %', v_user_id;
  RAISE NOTICE '角色 ID: %', v_role_id;
  RAISE NOTICE '';
  
  -- 指派角色
  INSERT INTO user_roles (user_id, role_id, is_active)
  VALUES (v_user_id, v_role_id, true)
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET is_active = true;
  
  RAISE NOTICE '✅ 已指派角色';
  RAISE NOTICE '';
  RAISE NOTICE '================================================';
  RAISE NOTICE '🎉 完成！請要求經理重新登入系統';
  RAISE NOTICE '經理登入後應該能看到所有被指派的門市';
  RAISE NOTICE '================================================';
END $$;
*/

-- ============================================
-- 【修復方案 B】創建並使用督導角色（如果不存在）
-- ============================================
-- 如果系統中沒有 supervisor_role，先創建此角色

/*
-- 步驟 1：創建督導角色
INSERT INTO roles (code, name, description, is_active)
VALUES (
  'supervisor_role',
  '督導/區經理',
  '管理多個門市的督導或區經理，可查看和管理所屬門市的各項資料',
  true
)
ON CONFLICT (code) DO NOTHING;

-- 步驟 2：為督導角色分配權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id as role_id,
  p.id as permission_id,
  true as is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code IN (all',      -- 查看所有門市
    'monthly.status.edit',          -- 編輯每月狀態
    'monthly.status.submit',        -- 提交每月狀態
    'monthly.status.confirm',       -- 確認/核簽門市狀態
    'monthly.export.stores',        -- 匯出門市資料
    
    -- 任務管理
    'task.view_own',
    'dashboard.view',
    'task.manage',
    
    -- 門市管理
    'store.manage',
    'employee.manage',
    
    -- 導航欄權限
    'store.supervisor.assign',
    'employee.movement.manage',
    'activity.manage',
    'inventor
    'store.supervisor.assign',
    'employee.movement.manage',
    'activity.manage'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 步驟 3：為經理指派督導角色
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0052';
  SELECT id INTO v_role_id FROM roles WHERE code = 'supervisor_role';
  
  IF v_user_id IS NOT NULL AND v_role_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id, is_active)
    VALUES (v_user_id, v_role_id, true)
    ON CONFLICT (user_id, role_id) 
    DO UPDATE SET is_active = true;
    
    RAISE NOTICE '✅ 已為徐孝銘指派督導角色';
  END IF;
END $$;
*/

-- ============================================
-- 【驗證】執行修復後，再次檢查
-- ============================================
-- 修復完成後，重新執行上方的檢查 1-4，確認所有項目都是 ✅
