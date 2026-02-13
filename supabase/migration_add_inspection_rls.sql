-- =====================================================
-- 督導巡店系統 - RLS（Row Level Security）策略
-- =====================================================
-- 版本: v1.1
-- 日期: 2026-02-13
-- 說明: 設定督導巡店系統的資料安全存取策略
--      使用簡化的權限檢查邏輯，不依賴複雜的 RBAC user_roles
-- 依賴: 需先執行 migration_add_inspection_system.sql
-- =====================================================

-- =====================================================
-- 輔助函數：檢查用戶是否有指定權限（簡化版）
-- =====================================================
CREATE OR REPLACE FUNCTION has_inspection_permission(
  p_user_id UUID,
  p_permission_code TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  -- 方式 1：檢查 profiles.role（如果使用舊系統）
  IF EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = p_user_id 
    AND role IN ('admin', 'supervisor', 'area_manager')
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- 方式 2：檢查 user_roles（如果使用新 RBAC 系統）
  IF EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND p.code = p_permission_code
  ) THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
EXCEPTION
  WHEN OTHERS THEN
    -- 如果資料表不存在，返回 FALSE
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =====================================================
-- 1. inspection_templates（檢查範本表）的 RLS
-- =====================================================
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;

-- 策略 1.1：所有已驗證用戶都可以讀取活動的範本
DROP POLICY IF EXISTS "所有用戶可以讀取活動的檢查範本" ON inspection_templates;
CREATE POLICY "所有用戶可以讀取活動的檢查範本"
ON inspection_templates
FOR SELECT
TO authenticated
USING (is_active = true);

-- 策略 1.2：管理員可以管理範本（簡化版）
DROP POLICY IF EXISTS "管理員可以管理檢查範本" ON inspection_templates;
CREATE POLICY "管理員可以管理檢查範本"
ON inspection_templates
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  )
);

-- =====================================================
-- 2. inspection_masters（巡店主記錄表）的 RLS
-- =====================================================
ALTER TABLE inspection_masters ENABLE ROW LEVEL SECURITY;

-- 策略 2.1：督導可以建立巡店記錄（自己）
DROP POLICY IF EXISTS "督導可以建立巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以建立巡店記錄"
ON inspection_masters
FOR INSERT
TO authenticated
WITH CHECK (
  inspector_id = auth.uid()
);

-- 策略 2.2：用戶可以查看相關的巡店記錄
DROP POLICY IF EXISTS "用戶可以查看相關的巡店記錄" ON inspection_masters;
CREATE POLICY "用戶可以查看相關的巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  -- 督導本人
  inspector_id = auth.uid()
  -- 或店長（自己管理的門市）
  OR EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_masters.store_id
    AND sm.employee_id = auth.uid()
    AND sm.is_active = true
  )
  -- 或管理員
  OR EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin', 'supervisor', 'area_manager')
  )
);

-- 策略 2.3：督導可以更新自己建立的進行中記錄
DROP POLICY IF EXISTS "督導可以更新自己的巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以更新自己的巡店記錄"
ON inspection_masters
FOR UPDATE
TO authenticated
USING (
  inspector_id = auth.uid()
  AND status IN ('draft', 'in_progress')
);

-- 策略 2.4：督導可以刪除自己的草稿記錄
DROP POLICY IF EXISTS "督導可以刪除草稿巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以刪除草稿巡店記錄"
ON inspection_masters
FOR DELETE
TO authenticated
USING (
  inspector_id = auth.uid()
  AND status = 'draft'
);

-- =====================================================
-- 3. inspection_results（評分結果表）的 RLS
-- =====================================================
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;

-- 策略 3.1：可以查看巡店記錄的人可以查看結果明細
DROP POLICY IF EXISTS "可以查看巡店記錄的用戶可以查看結果明細" ON inspection_results;
CREATE POLICY "可以查看巡店記錄的用戶可以查看結果明細"
ON inspection_results
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND (
      -- 督導本人
      im.inspector_id = auth.uid()
      -- 或店長（自己門市）
      OR EXISTS (
        SELECT 1 FROM store_managers sm
        WHERE sm.store_id = im.store_id
        AND sm.employee_id = auth.uid()
        AND sm.is_active = true
      )
      -- 或管理員/督導/區經理
      OR EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() 
        AND role IN ('admin', 'supervisor', 'area_manager')
      )
    )
  )
);

-- 策略 3.2：督導可以管理自己巡店記錄的結果明細
DROP POLICY IF EXISTS "督導可以管理自己巡店記錄的結果明細" ON inspection_results;
CREATE POLICY "督導可以管理自己巡店記錄的結果明細"
ON inspection_results
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status IN ('draft', 'in_progress')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status IN ('draft', 'in_progress')
  )
);

-- =====================================================
-- 4. Supabase Storage 的 RLS 策略
-- =====================================================
-- 注意：以下策略需要在 Supabase Dashboard 的 Storage 設定中執行
-- 或使用 Supabase Management API

-- Bucket: inspection-photos
-- 設定為 Private

-- 策略 4.1：督導可以上傳照片到自己的巡店記錄
-- DROP POLICY IF EXISTS "督導可以上傳巡店照片" ON storage.objects;
-- CREATE POLICY "督導可以上傳巡店照片"
-- ON storage.objects
-- FOR INSERT
-- TO authenticated
-- WITH CHECK (
--   bucket_id = 'inspection-photos'
--   AND (storage.foldername(name))[1] IN (
--     SELECT im.store_id::text 
--     FROM inspection_masters im
--     WHERE im.inspector_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
--   )
--   AND (storage.foldername(name))[2] IN (
--     SELECT im.id::text 
--     FROM inspection_masters im
--     WHERE im.inspector_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
--   )
-- );

-- 策略 4.2：可以查看巡店記錄的人可以查看照片
-- DROP POLICY IF EXISTS "有權限的用戶可以查看巡店照片" ON storage.objects;
-- CREATE POLICY "有權限的用戶可以查看巡店照片"
-- ON storage.objects
-- FOR SELECT
-- TO authenticated
-- USING (
--   bucket_id = 'inspection-photos'
--   AND (
--     -- 督導可以看自己的照片
--     (storage.foldername(name))[2] IN (
--       SELECT im.id::text 
--       FROM inspection_masters im
--       WHERE im.inspector_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
--     )
--     -- 店長可以看自己門市的照片
--     OR (storage.foldername(name))[1] IN (
--       SELECT sm.store_id::text 
--       FROM store_managers sm
--       WHERE sm.employee_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
--       AND sm.is_active = true
--     )
--     -- 管理員可以看所有照片
--     OR EXISTS (
--       SELECT 1 FROM user_roles ur
--       JOIN role_permissions rp ON ur.role_id = rp.role_id
--       JOIN permissions p ON rp.permission_id = p.id
--       WHERE ur.user_id = auth.uid()
--       AND p.code IN ('inspection.view_all', 'admin.full_access')
--     )
--   )
-- );

-- 策略 4.3：督導可以刪除自己上傳的照片
-- DROP POLICY IF EXISTS "督導可以刪除自己上傳的巡店照片" ON storage.objects;
-- CREATE POLICY "督導可以刪除自己上傳的巡店照片"
-- ON storage.objects
-- FOR DELETE
-- TO authenticated
-- USING (
--   bucket_id = 'inspection-photos'
--   AND (storage.foldername(name))[2] IN (
--     SELECT im.id::text 
--     FROM inspection_masters im
--     WHERE im.inspector_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
--     AND im.status IN ('draft', 'in_progress')
--   )
-- );

-- =====================================================
-- 5. 驗證 RLS 策略
-- =====================================================
-- 查詢已啟用 RLS 的表
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename LIKE 'inspection%'
ORDER BY tablename;

-- 查詢各表的 RLS 策略
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
WHERE tablename LIKE 'inspection%'
ORDER BY tablename, policyname;

-- =====================================================
-- RLS 策略設定完成
-- =====================================================
-- 安全機制摘要：
-- 
-- inspection_templates（檢查範本）：
-- - 所有用戶可讀取活動範本
-- - 只有管理員可管理範本
--
-- inspection_masters（巡店記錄）：
-- - 督導只能建立、查看、編輯、刪除自己的記錄
-- - 店長可查看自己門市的記錄
-- - 管理員可查看所有記錄
-- - 草稿狀態可刪除，完成後不可刪除
--
-- inspection_results（評分結果）：
-- - 繼承 inspection_masters 的查看權限
-- - 督導可管理自己巡店記錄的評分結果
-- - 只有進行中的記錄可編輯
--
-- Storage（照片儲存）：
-- - 督導可上傳照片到自己的巡店記錄
-- - 有查看權限的人可查看照片
-- - 督導可刪除自己上傳的照片
--
-- 下一步：
-- 1. 執行 seed_inspection_templates.sql（匯入 220 分題庫）
-- 2. 在 Supabase Dashboard 建立 Storage Bucket: inspection-photos
-- 3. 在 Supabase Dashboard 設定 Storage RLS 策略
-- =====================================================
