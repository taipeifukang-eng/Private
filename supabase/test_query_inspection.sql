-- =====================================================
-- 測試查詢巡店記錄 - 逐步排查
-- =====================================================

-- 步驟 1: 檢查當前用戶 ID
SELECT 
  '=== 步驟 1: 當前用戶 ===' as step,
  auth.uid() as user_id;

-- 步驟 2: 檢查 profiles 表有無該用戶資料
SELECT 
  '=== 步驟 2: Profiles 資料 ===' as step,
  id,
  email,
  full_name,
  role,
  employee_code
FROM profiles
WHERE id = auth.uid();

-- 步驟 3: 直接查詢 inspection_masters（不 JOIN，測試 RLS）
SELECT 
  '=== 步驟 3: 巡店主記錄（無 JOIN）===' as step,
  id,
  inspector_id,
  store_id,
  inspection_date,
  status,
  grade,
  total_score,
  created_at
FROM inspection_masters
ORDER BY created_at DESC
LIMIT 5;

-- 步驟 4: 只查詢當前用戶的記錄
SELECT 
  '=== 步驟 4: 當前用戶的記錄 ===' as step,
  id,
  inspector_id,
  store_id,
  inspection_date,
  status,
  grade,
  created_at
FROM inspection_masters
WHERE inspector_id = auth.uid()
ORDER BY created_at DESC
LIMIT 5;

-- 步驟 5: JOIN stores 測試
SELECT 
  '=== 步驟 5: JOIN stores ===' as step,
  im.id,
  im.inspection_date,
  im.status,
  s.store_name,
  s.store_code
FROM inspection_masters im
LEFT JOIN stores s ON s.id = im.store_id
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;

-- 步驟 6: 完整 JOIN（包含 profiles）
SELECT 
  '=== 步驟 6: 完整 JOIN ===' as step,
  im.id,
  im.inspection_date,
  im.status,
  s.store_name,
  p.full_name as inspector_name
FROM inspection_masters im
LEFT JOIN stores s ON s.id = im.store_id
LEFT JOIN profiles p ON p.id = im.inspector_id
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;

-- 步驟 7: 檢查最新創建的記錄（指定 ID）
SELECT 
  '=== 步驟 7: 檢查指定記錄 ===' as step,
  id,
  inspector_id,
  store_id,
  inspection_date,
  status,
  created_at
FROM inspection_masters
WHERE id = '9e21ca9a-a1b7-45c6-bcfe-a7b43c72e442';

-- 步驟 8: 檢查該記錄的明細
SELECT 
  '=== 步驟 8: 檢查明細記錄 ===' as step,
  COUNT(*) as detail_count
FROM inspection_results
WHERE inspection_id = '9e21ca9a-a1b7-45c6-bcfe-a7b43c72e442';

-- 步驟 9: 檢查 stores 表是否有該門市
SELECT 
  '=== 步驟 9: 檢查門市資料 ===' as step,
  id,
  store_name,
  store_code
FROM stores
WHERE id = '80b3800d-4d6e-4556-8515-2b3d12485267';

-- 步驟 10: 檢查 RLS 策略狀態
SELECT 
  '=== 步驟 10: RLS 策略 ===' as step,
  tablename,
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'inspection_masters'
AND schemaname = 'public'
ORDER BY cmd;
