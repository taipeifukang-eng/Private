-- ============================================
-- 新增業績管理模組 RBAC 權限碼
-- ============================================
-- 目的：為業績管理模組建立「檢視」與「編輯」兩個獨立的 RBAC 權限碼
-- 執行方式：在 Supabase SQL Editor 執行此檔案

-- 【步驟 1】新增業績管理權限碼
INSERT INTO permissions (code, description, module, feature, action) VALUES
  ('performance.view', '查看業績資料 - 允許查看門市業績目標及達成狀況、各季度獎金計算結果', '業績管理', 'performance', 'view'),
  ('performance.edit', '編輯業績資料 - 允許新增、修改、匯入門市業績目標及實際數據', '業績管理', 'performance', 'edit')
ON CONFLICT (code) DO UPDATE SET 
  description = EXCLUDED.description,
  module = EXCLUDED.module;

-- 【步驟 2】為 admin_role 角色分配業績管理全部權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id AS role_id,
  p.id AS permission_id,
  true AS is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin_role'
  AND p.code IN ('performance.view', 'performance.edit')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 【步驟 3】為 store_manager_role 分配業績管理全部權限（店長可查看並輸入自己門市的業績）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id AS role_id,
  p.id AS permission_id,
  true AS is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code IN ('performance.view', 'performance.edit')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 【步驟 4】驗證權限已正確建立
SELECT 
  p.code,
  p.description,
  p.module,
  r.code AS role_code,
  r.name AS role_name,
  rp.is_allowed
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed = true
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.code IN ('performance.view', 'performance.edit')
ORDER BY p.code, r.code;

-- ============================================
-- 【完成提示】
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ 業績管理模組權限碼已新增完成！';
  RAISE NOTICE '';
  RAISE NOTICE '新增的權限碼：';
  RAISE NOTICE '  - performance.view  ：查看業績資料';
  RAISE NOTICE '  - performance.edit  ：編輯業績資料';
  RAISE NOTICE '';
  RAISE NOTICE '已指派給以下角色：';
  RAISE NOTICE '  - admin_role        ：查看 + 編輯';
  RAISE NOTICE '  - store_manager_role：查看 + 編輯';
  RAISE NOTICE '';
  RAISE NOTICE '如需指派給督導/區經理角色，請在角色管理介面中手動新增。';
  RAISE NOTICE '================================================';
END $$;
