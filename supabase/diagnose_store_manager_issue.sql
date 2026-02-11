-- ============================================
-- 檢查店長指派問題診斷查詢
-- ============================================

-- 1. 檢查用戶資料
SELECT 
  id,
  email,
  employee_code,
  full_name,
  role,
  job_title,
  department
FROM profiles
WHERE employee_code = 'FK0791' OR full_name LIKE '%李孫堂%';

-- 2. 檢查門市資料
SELECT 
  id,
  store_code,
  store_name,
  is_active
FROM stores
WHERE store_code = '0002' OR store_name LIKE '%富康活力%';

-- 3. 檢查店長指派記錄
SELECT 
  sm.id,
  sm.user_id,
  p.employee_code,
  p.full_name,
  sm.store_id,
  s.store_code,
  s.store_name,
  sm.role_type,
  sm.is_primary,
  sm.created_at
FROM store_managers sm
JOIN profiles p ON p.id = sm.user_id
JOIN stores s ON s.id = sm.store_id
WHERE p.employee_code = 'FK0791' OR s.store_code = '0002'
ORDER BY sm.created_at DESC;

-- 4. 檢查用戶的角色
SELECT 
  p.employee_code,
  p.full_name,
  r.name as role_name,
  r.code as role_code
FROM user_roles ur
JOIN profiles p ON p.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
WHERE p.employee_code = 'FK0791';

-- 5. 檢查店長角色的權限
SELECT 
  p.code,
  p.description,
  rp.is_allowed
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
JOIN roles r ON r.id = rp.role_id
WHERE r.code = 'store_manager_role'
  AND p.module = 'monthly'
ORDER BY p.code;

-- ============================================
-- 修復方案（如果需要）
-- ============================================

-- 如果缺少店長指派記錄，執行以下 INSERT
-- 注意：請將 [USER_ID] 和 [STORE_ID] 替換為實際的 UUID

/*
INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
VALUES (
  '[USER_ID]',  -- 從查詢 1 獲取
  '[STORE_ID]', -- 從查詢 2 獲取
  'store_manager',
  true
)
ON CONFLICT (store_id, user_id, role_type) 
DO UPDATE SET 
  is_primary = true;
*/

-- 如果用戶缺少店長角色，執行以下 INSERT
/*
INSERT INTO user_roles (user_id, role_id)
VALUES (
  '[USER_ID]',  -- 從查詢 1 獲取
  (SELECT id FROM roles WHERE code = 'store_manager_role')
)
ON CONFLICT (user_id, role_id) DO NOTHING;
*/
