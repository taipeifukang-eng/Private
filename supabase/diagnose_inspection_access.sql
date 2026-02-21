-- =====================================================
-- 診斷巡店列表訪問問題
-- =====================================================
-- 執行這個腳本來診斷為什麼用戶無法訪問巡店記錄
-- =====================================================

-- 1. 檢查當前用戶資訊
SELECT 
  id,
  email,
  role,
  full_name,
  created_at
FROM profiles
WHERE id = auth.uid();

-- 2. 檢查用戶的角色和權限
SELECT 
  ur.user_id,
  r.name as role_name,
  r.code as role_code,
  p.code as permission_code,
  p.name as permission_name,
  rp.is_allowed
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE ur.user_id = auth.uid()
  AND ur.is_active = true
  AND rp.is_allowed = true
ORDER BY p.code;

-- 3. 檢查 inspection_masters 表的總記錄數（不受 RLS 限制）
SELECT 
  COUNT(*) as total_inspections,
  COUNT(DISTINCT inspector_id) as total_inspectors,
  COUNT(DISTINCT store_id) as total_stores,
  MIN(inspection_date) as earliest_date,
  MAX(inspection_date) as latest_date
FROM inspection_masters;

-- 4. 測試當前用戶能看到的巡店記錄（受 RLS 限制）
SELECT 
  im.id,
  im.inspector_id,
  im.store_id,
  im.inspection_date,
  im.status,
  im.grade,
  im.created_at
FROM inspection_masters im
ORDER BY im.created_at DESC
LIMIT 10;

-- 5. 檢查當前用戶是否為督導（inspector）
SELECT 
  im.id,
  im.inspector_id,
  im.inspection_date,
  (im.inspector_id = auth.uid()) as is_own_record
FROM inspection_masters im
WHERE im.inspector_id = auth.uid()
LIMIT 10;

-- 6. 檢查當前用戶是否為店長（能看自己門市的記錄）
SELECT 
  sm.store_id,
  s.store_name,
  s.store_code,
  sm.role_type,
  COUNT(im.id) as inspection_count
FROM store_managers sm
JOIN stores s ON sm.store_id = s.id
LEFT JOIN inspection_masters im ON sm.store_id = im.store_id
WHERE sm.user_id = auth.uid()
GROUP BY sm.store_id, s.store_name, s.store_code, sm.role_type;

-- 7. 檢查當前啟用的 RLS 策略
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'inspection_masters'
ORDER BY policyname;

-- 8. 測試簡化的查詢（不包含關聯）
SELECT 
  id,
  inspector_id,
  store_id,
  inspection_date,
  status,
  grade,
  total_score,
  max_possible_score
FROM inspection_masters
ORDER BY inspection_date DESC
LIMIT 5;

-- 9. 測試 stores 表訪問
SELECT 
  id,
  store_code,
  store_name,
  short_name,
  is_active
FROM stores
WHERE is_active = true
LIMIT 5;

-- 10. 測試 profiles 表訪問
SELECT 
  id,
  full_name,
  role,
  email
FROM profiles
WHERE id IN (
  SELECT DISTINCT inspector_id 
  FROM inspection_masters 
  LIMIT 5
);

-- 11. 診斷：嘗試查詢但添加詳細錯誤處理
DO $$
DECLARE
  v_user_id uuid;
  v_has_permission boolean;
  v_is_inspector boolean;
  v_is_store_manager boolean;
  v_has_admin_role boolean;
BEGIN
  v_user_id := auth.uid();
  
  RAISE NOTICE '當前用戶 ID: %', v_user_id;
  
  -- 檢查是否為督導
  SELECT EXISTS (
    SELECT 1 FROM inspection_masters 
    WHERE inspector_id = v_user_id
  ) INTO v_is_inspector;
  RAISE NOTICE '是督導: %', v_is_inspector;
  
  -- 檢查是否為店長
  SELECT EXISTS (
    SELECT 1 FROM store_managers 
    WHERE user_id = v_user_id
  ) INTO v_is_store_manager;
  RAISE NOTICE '是店長: %', v_is_store_manager;
  
  -- 檢查是否有管理員角色
  SELECT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = v_user_id 
    AND role IN ('admin', 'supervisor', 'area_manager')
  ) INTO v_has_admin_role;
  RAISE NOTICE '有管理員角色: %', v_has_admin_role;
  
  -- 檢查是否有相關權限
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = v_user_id
    AND ur.is_active = true
    AND rp.is_allowed = true
    AND p.code IN ('inspection.view_all', 'inspection.view_own', 'inspection.view_store', 'admin.full_access')
  ) INTO v_has_permission;
  RAISE NOTICE '有查看權限: %', v_has_permission;
  
END $$;
