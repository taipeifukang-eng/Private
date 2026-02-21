-- =====================================================
-- 極簡 RLS 策略 - 確保巡店記錄可訪問
-- =====================================================
-- 這個腳本創建最簡化的 RLS 策略，確保基本訪問權限
-- =====================================================

-- 1. 刪除所有現有的 inspection_masters SELECT 策略
DROP POLICY IF EXISTS "用戶可以查看相關的巡店記錄" ON inspection_masters;
DROP POLICY IF EXISTS "Users can view related inspection records" ON inspection_masters;
DROP POLICY IF EXISTS "督導可以查看自己的記錄" ON inspection_masters;

-- 2. 創建極簡的 SELECT 策略
-- 優先級：督導本人 > 有權限的用戶 > 有角色的用戶
CREATE POLICY "督導和管理員可以查看巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  -- 條件 1: 督導本人（最優先）
  inspector_id = auth.uid()
  
  -- 條件 2: 店長查看自己門市
  OR EXISTS (
    SELECT 1 
    FROM store_managers sm
    WHERE sm.store_id = inspection_masters.store_id
      AND sm.user_id = auth.uid()
  )
  
  -- 條件 3: 有 supervisor 或 admin 角色的用戶（透過 profiles.role）
  OR EXISTS (
    SELECT 1 
    FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'supervisor', 'area_manager')
  )
  
  -- 條件 4: 有相關 RBAC 權限（最寬鬆）
  OR EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions perm ON rp.permission_id = perm.id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND rp.is_allowed = true
      AND perm.code IN (
        'inspection.view_all',
        'inspection.view_own', 
        'inspection.view_store',
        'admin.full_access'
      )
  )
);

-- 3. 為了安全起見，也修復 inspection_results 的 SELECT 策略
DROP POLICY IF EXISTS "可以查看巡店記錄的用戶可以查看結果明細" ON inspection_results;
DROP POLICY IF EXISTS "督導可以查看巡檢結果" ON inspection_results;

CREATE POLICY "有權查看巡店記錄者可查看結果明細"
ON inspection_results
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
      AND (
        -- 督導本人
        im.inspector_id = auth.uid()
        -- 或有查看巡店記錄的權限（透過上面的策略）
        OR EXISTS (
          SELECT 1 FROM store_managers sm
          WHERE sm.store_id = im.store_id AND sm.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid() AND p.role IN ('admin', 'supervisor', 'area_manager')
        )
        OR EXISTS (
          SELECT 1 
          FROM user_roles ur
          JOIN role_permissions rp ON ur.role_id = rp.role_id
          JOIN permissions perm ON rp.permission_id = perm.id
          WHERE ur.user_id = auth.uid()
            AND ur.is_active = true
            AND rp.is_allowed = true
            AND perm.code IN ('inspection.view_all', 'inspection.view_own', 'admin.full_access')
        )
      )
  )
);

-- 4. 驗證策略
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('inspection_masters', 'inspection_results')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- 5. 測試查詢（應該能返回記錄）
SELECT 
  im.id,
  im.inspector_id,
  im.inspection_date,
  im.status,
  (im.inspector_id = auth.uid()) as is_my_record
FROM inspection_masters im
ORDER BY im.created_at DESC
LIMIT 5;

COMMENT ON POLICY "督導和管理員可以查看巡店記錄" ON inspection_masters IS '極簡 RLS: 督導本人、店長、有角色或權限的用戶均可查看';
COMMENT ON POLICY "有權查看巡店記錄者可查看結果明細" ON inspection_results IS '繼承 inspection_masters 的查看權限';
