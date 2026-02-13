-- =====================================================
-- 診斷巡店列表查詢問題
-- =====================================================
-- 在 Supabase SQL Editor 中執行此腳本來診斷問題
-- =====================================================

-- 1. 檢查當前用戶資訊
SELECT 
  '=== 當前用戶資訊 ===' as section,
  id,
  email,
  full_name,
  role,
  department,
  job_title,
  employee_code
FROM profiles
WHERE id = auth.uid();

-- 2. 檢查該用戶創建的巡店記錄（忽略 RLS）
-- 需要以 service_role 執行，或暫時停用 RLS
SELECT 
  '=== 該用戶的巡店記錄（忽略 RLS）===' as section,
  im.id,
  im.inspector_id,
  im.inspection_date,
  im.status,
  im.total_score,
  im.grade,
  im.created_at,
  s.store_name,
  s.store_code
FROM inspection_masters im
LEFT JOIN stores s ON s.id = im.store_id
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;

-- 3. 檢查 RLS 策略是否生效
SELECT 
  '=== RLS 策略狀態 ===' as section,
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
AND schemaname = 'public';

-- 4. 測試用戶是否符合 SELECT RLS 條件
SELECT 
  '=== RLS 條件檢測 ===' as section,
  '督導本人條件' as condition_type,
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.inspector_id = auth.uid()
  ) as matches;

-- 5. 檢查用戶 role 是否在管理員範圍內
SELECT 
  '=== 管理員權限檢測 ===' as section,
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin', 'supervisor', 'area_manager')
  ) as has_admin_permission;

-- 6. 最近創建的 5 筆記錄（所有用戶，需要 service_role 或暫時停用 RLS）
SELECT 
  '=== 系統最近的巡店記錄 ===' as section,
  im.id,
  im.inspector_id,
  im.inspection_date,
  im.status,
  im.created_at,
  p.full_name as inspector_name,
  p.role as inspector_role
FROM inspection_masters im
LEFT JOIN profiles p ON p.id = im.inspector_id
ORDER BY im.created_at DESC
LIMIT 5;
