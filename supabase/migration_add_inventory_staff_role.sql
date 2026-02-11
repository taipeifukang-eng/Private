-- ============================================
-- 新增盤點組人員角色與細分每月狀態權限
-- ============================================

-- 1. 新增盤點組人員角色（處理名稱和代碼衝突）
DO $$
BEGIN
  -- 檢查是否已經有同名或同 code 的角色
  IF EXISTS (SELECT 1 FROM roles WHERE name = '盤點組人員' OR code = 'inventory_staff') THEN
    -- 如果存在，更新描述
    UPDATE roles 
    SET description = '盤點組成員,可查看門市人員狀態但不能查看統計資料和支援時數',
        is_system = false
    WHERE code = 'inventory_staff';
    RAISE NOTICE 'ℹ️  盤點組人員角色已存在，已更新描述';
  ELSE
    -- 如果不存在，新增
    INSERT INTO roles (name, code, description, is_system) VALUES
      ('盤點組人員', 'inventory_staff', '盤點組成員,可查看門市人員狀態但不能查看統計資料和支援時數', false);
    RAISE NOTICE '✅ 已新增盤點組人員角色';
  END IF;
END $$;

-- 2. 新增細分的每月狀態權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 查看門市統計資料（績效率、營收達成率等）
  ('monthly', 'status', 'monthly.status.view_stats', 'view_stats', '查看門市統計資料'),
  
  -- 查看支援時數
  ('monthly', 'allowance', 'monthly.allowance.view_support_hours', 'view_support', '查看支援時數')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 為盤點組人員添加權限
-- ============================================

-- 盤點組人員 (inventory_staff) - 可查看人員狀態，但不能查看統計和支援時數
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'inventory_staff'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 每月狀態 - 基本查看權限（人員狀態）
  'monthly.status.view_all',
  'monthly.status.view_own'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 明確禁止查看統計資料和支援時數
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'inventory_staff'),
  id,
  false
FROM permissions
WHERE code IN (
  'monthly.status.view_stats',
  'monthly.allowance.view_support_hours',
  'monthly.allowance.edit_support_hours'
)
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = false;

-- ============================================
-- 為其他角色補充新增的細分權限
-- ============================================

-- 營業部主管、營業部助理、督導 - 擁有完整權限（包含統計資料和支援時數）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id,
  p.id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('business_supervisor', 'business_assistant', 'supervisor_role')
  AND p.code IN ('monthly.status.view_stats', 'monthly.allowance.view_support_hours')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 店長 - 可查看人員狀態和支援時數，但不能查看統計資料
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id,
  true
FROM permissions
WHERE code = 'monthly.allowance.view_support_hours'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id,
  false
FROM permissions
WHERE code = 'monthly.status.view_stats'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = false;

-- 主管 - 只能查看人員狀態，不能查看統計和支援時數
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'manager'),
  id,
  false
FROM permissions
WHERE code IN ('monthly.status.view_stats', 'monthly.allowance.view_support_hours')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = false;

-- ============================================
-- 完成訊息
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ 盤點組人員角色與細分權限新增完成';
  RAISE NOTICE '';
  RAISE NOTICE '新增角色：';
  RAISE NOTICE '  - 盤點組人員 (inventory_staff)';
  RAISE NOTICE '';
  RAISE NOTICE '新增權限：';
  RAISE NOTICE '  - monthly.status.view_stats: 查看門市統計資料';
  RAISE NOTICE '  - monthly.allowance.view_support_hours: 查看支援時數';
  RAISE NOTICE '';
  RAISE NOTICE '權限配置：';
  RAISE NOTICE '  - 盤點組人員: ✅ 查看人員狀態 ❌ 統計資料 ❌ 支援時數';
  RAISE NOTICE '  - 營業部主管/助理/督導: ✅ 完整權限';
  RAISE NOTICE '  - 店長: ✅ 人員狀態 ✅ 支援時數 ❌ 統計資料';
  RAISE NOTICE '  - 主管: ✅ 人員狀態 ❌ 統計資料 ❌ 支援時數';
END $$;
