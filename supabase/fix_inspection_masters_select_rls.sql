-- =====================================================
-- 修復巡店列表 RLS 策略 - 確保督導能查看自己的記錄
-- =====================================================
-- 問題: 當前的 SELECT RLS 策略可能因為用戶 role 不匹配而無法查詢
-- 解決: 簡化 RLS 策略，只要是督導本人就能查看自己的記錄
-- =====================================================

-- 刪除舊的 SELECT 策略
DROP POLICY IF EXISTS "用戶可以查看相關的巡店記錄" ON inspection_masters;

-- 創建新的 SELECT 策略（簡化版）
CREATE POLICY "用戶可以查看相關的巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  -- 督導本人（核心條件）
  inspector_id = auth.uid()
  
  -- 或者是店長查看自己門市的記錄
  OR EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_masters.store_id
    AND sm.user_id = auth.uid()
  )
  
  -- 或者用戶有管理員/督導/區經理角色（但不強制要求）
  OR EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IS NOT NULL
    AND role IN ('admin', 'supervisor', 'area_manager')
  )
  
  -- 或者用戶有相關權限（RBAC 系統）
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND ur.is_active = true
    AND rp.is_allowed = true
    AND p.code IN ('inspection.view_all', 'inspection.view')
  )
);

-- 驗證：測試查詢
-- 這應該返回當前用戶創建的巡店記錄
SELECT 
  im.id,
  im.inspector_id,
  im.inspection_date,
  im.status,
  im.grade,
  im.created_at
FROM inspection_masters im
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;
