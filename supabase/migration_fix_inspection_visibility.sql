-- =====================================================
-- 修正巡店系統 RLS + 新增 RBAC 權限
-- 日期: 2026-02-24
-- 說明:
--   1. 修正 inspection_masters SELECT RLS - 讓有權限的人看到所有記錄
--   2. 修正 inspection_results SELECT RLS - 同上
--   3. 新增 inspection.view_store_status 權限 - 控制「已巡店/尚未巡店」區塊
--   4. 新增 inspection.manager_tab 權限 - 控制經理巡店分頁
--   5. 新增 inspection.compare 權限 - 控制對比分析
-- =====================================================

-- =====================================================
-- PART 1: 修正 inspection_masters SELECT RLS
-- 問題: 不同用戶互相看不到巡店記錄
-- 原因: RLS SELECT 策略依賴 profiles.role 欄位，但該欄位可能為空或不匹配
-- 修正: 統一使用 RBAC 權限判斷
-- =====================================================

-- 刪除所有可能存在的舊 SELECT 策略
DROP POLICY IF EXISTS "用戶可以查看相關的巡店記錄" ON inspection_masters;
DROP POLICY IF EXISTS "督導和管理員可以查看巡店記錄" ON inspection_masters;
DROP POLICY IF EXISTS "Users can view related inspection records" ON inspection_masters;
DROP POLICY IF EXISTS "督導可以查看自己的記錄" ON inspection_masters;

-- 建立新的統一 SELECT 策略
CREATE POLICY "巡店記錄查看權限"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  -- 1. 自己建立的記錄（一定看得到）
  inspector_id = auth.uid()

  -- 2. 店長看自己門市的記錄
  OR EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_masters.store_id
    AND sm.user_id = auth.uid()
  )

  -- 3. 有 RBAC「查看所有巡店」權限
  OR EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions perm ON rp.permission_id = perm.id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND rp.is_allowed = true
      AND perm.code = 'inspection.view_all'
  )

  -- 4. profiles.role 兜底（向下相容，未來可移除）
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('admin')
  )
);

-- =====================================================
-- PART 2: 修正 inspection_results SELECT RLS
-- =====================================================
DROP POLICY IF EXISTS "可以查看巡店記錄的用戶可以查看結果明細" ON inspection_results;
DROP POLICY IF EXISTS "有權查看巡店記錄者可查看結果明細" ON inspection_results;
DROP POLICY IF EXISTS "督導可以查看巡檢結果" ON inspection_results;

CREATE POLICY "巡店結果查看權限"
ON inspection_results
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND (
      -- 自己的記錄
      im.inspector_id = auth.uid()
      -- 店長看自己門市
      OR EXISTS (
        SELECT 1 FROM store_managers sm
        WHERE sm.store_id = im.store_id AND sm.user_id = auth.uid()
      )
      -- RBAC 查看所有
      OR EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions perm ON rp.permission_id = perm.id
        WHERE ur.user_id = auth.uid()
          AND ur.is_active = true
          AND rp.is_allowed = true
          AND perm.code = 'inspection.view_all'
      )
      -- profiles.role 兜底
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    )
  )
);

-- =====================================================
-- PART 3: 新增 RBAC 權限
-- =====================================================
INSERT INTO permissions (code, description, module, feature, action, is_active)
VALUES
  (
    'inspection.view_store_status',
    '查看門市巡店狀態 - 允許在巡店頁面看到「本月已巡店/尚未巡店」統計區塊',
    '督導巡店',
    'inspection_store_status',
    'view',
    true
  ),
  (
    'inspection.manager_tab',
    '查看經理巡店分頁 - 允許在巡店列表頁面看到「經理巡店」分頁並新增經理巡店記錄',
    '督導巡店',
    'inspection_manager',
    'view',
    true
  ),
  (
    'inspection.compare',
    '查看對比分析 - 允許進入「督導 vs 經理」巡店對比分析頁面',
    '督導巡店',
    'inspection_compare',
    'view',
    true
  )
ON CONFLICT (code) 
DO UPDATE SET
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  is_active = EXCLUDED.is_active;

-- =====================================================
-- PART 4: 分配權限給角色
-- =====================================================

-- 管理員：全部權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin_role'
AND p.code IN (
  'inspection.view_store_status',
  'inspection.manager_tab',
  'inspection.compare',
  'inspection.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 督導：查看門市狀態 + 查看所有巡店
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
AND p.code IN (
  'inspection.view_store_status',
  'inspection.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- PART 5: 驗證
-- =====================================================

-- 驗證權限
SELECT p.code, p.description,
  ARRAY_AGG(r.code ORDER BY r.code) AS assigned_roles
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.code LIKE 'inspection.%'
GROUP BY p.code, p.description
ORDER BY p.code;

-- 驗證 RLS 策略
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('inspection_masters', 'inspection_results')
ORDER BY tablename, cmd, policyname;
