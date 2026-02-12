-- ============================================
-- 店長指派完整性檢查與修復
-- ============================================

-- 【檢查 1】檢查用戶是否存在
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
WHERE employee_code = 'FK0791' OR full_name LIKE '%李孫堂%';

-- 【檢查 2】檢查門市是否存在
SELECT 
  id,
  store_code,
  store_name,
  is_active,
  CASE 
    WHEN is_active THEN '✅ 門市啟用中'
    ELSE '❌ 門市已停用'
  END as status
FROM stores
WHERE store_code = '0002' OR store_name LIKE '%富康活力%';

-- 【檢查 3】檢查店長指派記錄 (store_managers)
SELECT 
  sm.id,
  p.employee_code,
  p.full_name,
  s.store_code,
  s.store_name,
  sm.role_type,
  sm.is_primary,
  sm.created_at,
  CASE 
    WHEN sm.id IS NOT NULL THEN '✅ 已指派'
    ELSE '❌ 未指派'
  END as status
FROM store_managers sm
JOIN profiles p ON p.id = sm.user_id
JOIN stores s ON s.id = sm.store_id
WHERE (p.employee_code = 'FK0791' OR p.full_name LIKE '%李孫堂%')
  AND (s.store_code = '0002' OR s.store_name LIKE '%富康活力%')
ORDER BY sm.created_at DESC;

-- 【檢查 4】檢查用戶的角色 (user_roles)
SELECT 
  p.employee_code,
  p.full_name,
  r.name as role_name,
  r.code as role_code,
  ur.is_active,
  ur.assigned_at,
  CASE 
    WHEN r.code = 'store_manager_role' THEN '✅ 已分配店長角色'
    ELSE '⚠️ 非店長角色'
  END as status
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
WHERE (p.employee_code = 'FK0791' OR p.full_name LIKE '%李孫堂%')
ORDER BY ur.assigned_at DESC;

-- 【檢查 5】檢查店長角色的關鍵權限
SELECT 
  p.code,
  p.description,
  rp.is_allowed,
  CASE 
    WHEN p.code = 'monthly.status.view_own' AND rp.is_allowed THEN '✅ 可查看自己管理的門市'
    WHEN p.code = 'monthly.status.view_own' AND NOT rp.is_allowed THEN '❌ 無法查看門市'
    WHEN rp.is_allowed THEN '✅ 已啟用'
    ELSE '❌ 已禁用'
  END as status
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
JOIN roles r ON r.id = rp.role_id
WHERE r.code = 'store_manager_role'
  AND p.code IN (
    'monthly.status.view_own',
    'monthly.status.view_all',
    'monthly.status.edit',
    'monthly.status.submit'
  )
ORDER BY p.code;

-- ============================================
-- 【診斷結果】根據上述查詢結果判斷問題
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '診斷完成！請檢查上述查詢結果：';
  RAISE NOTICE '';
  RAISE NOTICE '必須滿足以下條件，店長才能看到門市：';
  RAISE NOTICE '1. ✅ 用戶存在 (檢查 1)';
  RAISE NOTICE '2. ✅ 門市存在且啟用 (檢查 2)';
  RAISE NOTICE '3. ✅ store_managers 有記錄 (檢查 3)';
  RAISE NOTICE '4. ✅ user_roles 有 store_manager_role (檢查 4)';
  RAISE NOTICE '5. ✅ store_manager_role 有 monthly.status.view_own 權限 (檢查 5)';
  RAISE NOTICE '';
  RAISE NOTICE '如果缺少任何一項，請執行下方的修復 SQL';
  RAISE NOTICE '================================================';
END $$;

-- ============================================
-- 【修復方案 A】新增店長指派記錄
-- ============================================
-- 如果檢查 3 沒有結果，請執行以下 SQL（記得替換 UUID）

/*
-- 步驟 1：查詢用戶 ID 和門市 ID
DO $$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
BEGIN
  -- 獲取用戶 ID
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  -- 獲取門市 ID
  SELECT id INTO v_store_id FROM stores WHERE store_code = '0002';
  
  -- 顯示 ID
  RAISE NOTICE '用戶 ID: %', v_user_id;
  RAISE NOTICE '門市 ID: %', v_store_id;
  
  -- 如果都存在，則新增指派記錄
  IF v_user_id IS NOT NULL AND v_store_id IS NOT NULL THEN
    INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
    VALUES (v_user_id, v_store_id, 'store_manager', true)
    ON CONFLICT (store_id, user_id, role_type) 
    DO UPDATE SET is_primary = true;
    
    RAISE NOTICE '✅ 已建立店長指派記錄';
  ELSE
    RAISE NOTICE '❌ 無法建立指派記錄：用戶或門市不存在';
  END IF;
END $$;
*/

-- ============================================
-- 【修復方案 B】為用戶指派店長角色
-- ============================================
-- 如果檢查 4 沒有 store_manager_role，請執行以下 SQL

/*
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
BEGIN
  -- 獲取用戶 ID
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  -- 獲取店長角色 ID
  SELECT id INTO v_role_id FROM roles WHERE code = 'store_manager_role';
  
  -- 顯示 ID
  RAISE NOTICE '用戶 ID: %', v_user_id;
  RAISE NOTICE '角色 ID: %', v_role_id;
  
  -- 如果都存在，則指派角色
  IF v_user_id IS NOT NULL AND v_role_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id, is_active)
    VALUES (v_user_id, v_role_id, true)
    ON CONFLICT (user_id, role_id) 
    DO UPDATE SET is_active = true;
    
    RAISE NOTICE '✅ 已指派店長角色';
  ELSE
    RAISE NOTICE '❌ 無法指派角色：用戶或角色不存在';
  END IF;
END $$;
*/

-- ============================================
-- 【修復方案 C】一鍵修復（同時執行 A + B）
-- ============================================
-- 如果要一次性建立完整的店長指派，請執行以下 SQL

/*
DO $$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
  v_role_id UUID;
BEGIN
  -- 獲取 IDs
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  SELECT id INTO v_store_id FROM stores WHERE store_code = '0002';
  SELECT id INTO v_role_id FROM roles WHERE code = 'store_manager_role';
  
  -- 檢查是否都存在
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ 找不到員工編號 FK0791';
  END IF;
  
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION '❌ 找不到門市代碼 0002';
  END IF;
  
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '❌ 找不到店長角色 (store_manager_role)';
  END IF;
  
  RAISE NOTICE '================================================';
  RAISE NOTICE '開始一鍵修復...';
  RAISE NOTICE '用戶 ID: %', v_user_id;
  RAISE NOTICE '門市 ID: %', v_store_id;
  RAISE NOTICE '角色 ID: %', v_role_id;
  RAISE NOTICE '';
  
  -- 步驟 1：建立店長指派記錄
  INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
  VALUES (v_user_id, v_store_id, 'store_manager', true)
  ON CONFLICT (store_id, user_id, role_type) 
  DO UPDATE SET is_primary = true;
  RAISE NOTICE '✅ 步驟 1：已建立店長指派記錄 (store_managers)';
  
  -- 步驟 2：為用戶指派店長角色
  INSERT INTO user_roles (user_id, role_id, is_active)
  VALUES (v_user_id, v_role_id, true)
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET is_active = true;
  RAISE NOTICE '✅ 步驟 2：已指派店長角色 (user_roles)';
  
  RAISE NOTICE '';
  RAISE NOTICE '================================================';
  RAISE NOTICE '🎉 完成！請要求店長重新登入系統';
  RAISE NOTICE '店長登入後應該能看到以下門市：';
  RAISE NOTICE '  - 門市代碼: 0002';
  RAISE NOTICE '  - 門市名稱: 富康活力藥局';
  RAISE NOTICE '================================================';
END $$;
*/

-- ============================================
-- 【驗證】執行修復後，再次檢查
-- ============================================
-- 修復完成後，重新執行上方的檢查 1-5，確認所有項目都是 ✅
