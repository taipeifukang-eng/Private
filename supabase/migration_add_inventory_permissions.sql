-- ============================================
-- 新增盤點管理模組權限
-- ============================================

-- 7.9 盤點管理模組
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 盤點管理主要功能
  ('盤點管理', 'inventory', 'inventory.inventory.view', 'view', '查看盤點管理'),
  ('盤點管理', 'inventory', 'inventory.inventory.access', 'access', '存取盤點管理系統'),
  
  -- 模組一：產出外盤複盤清單
  ('盤點管理', 'module1', 'inventory.module1.upload_external', 'upload_external', '上傳外盤公司盤點檔'),
  ('盤點管理', 'module1', 'inventory.module1.upload_fks0701', 'upload_fks0701', '上傳FKS0701盤點記錄'),
  ('盤點管理', 'module1', 'inventory.module1.generate', 'generate', '產生外盤複盤清單'),
  
  -- 模組二：產出內部+外盤公司資料整合之複盤表與未盤表
  ('盤點管理', 'module2', 'inventory.module2.upload_pre', 'upload_pre', '上傳預盤資料'),
  ('盤點管理', 'module2', 'inventory.module2.upload_fks0701', 'upload_fks0701_m2', '上傳FKS0701記錄'),
  ('盤點管理', 'module2', 'inventory.module2.upload_external', 'upload_external_m2', '上傳外盤公司盤點檔'),
  ('盤點管理', 'module2', 'inventory.module2.generate', 'generate_m2', '產生整合複盤表與未盤表'),
  
  -- 模組三：產出匯入DPOS檔案
  ('盤點管理', 'module3', 'inventory.module3.upload_recount', 'upload_recount', '上傳修改後的複盤資料'),
  ('盤點管理', 'module3', 'inventory.module3.upload_uninventoried', 'upload_uninventoried', '上傳修改後的未盤資料'),
  ('盤點管理', 'module3', 'inventory.module3.generate', 'generate_m3', '產生DPOS匯入檔案'),
  
  -- 基礎資料上傳
  ('盤點管理', 'base_data', 'inventory.base_data.upload', 'upload_base', '上傳1F當日商品資料'),
  
  -- 資料匯出
  ('盤點管理', 'export', 'inventory.export.download', 'export', '下載盤點結果檔案')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 為各角色添加盤點管理權限
-- ============================================

-- 系統管理員 (admin) - 自動擁有所有權限，無需額外設定

-- 營業部主管 (business_supervisor) - 擁有完整盤點管理權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_supervisor'),
  id,
  true
FROM permissions
WHERE module = '盤點管理'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 營業部助理 (business_assistant) - 擁有完整盤點管理權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_assistant'),
  id,
  true
FROM permissions
WHERE module = '盤點管理'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 店長 (store_manager_role) - 擁有查看和基本操作權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id,
  true
FROM permissions
WHERE code IN (
  'inventory.inventory.view',
  'inventory.inventory.access',
  'inventory.module1.upload_external',
  'inventory.module1.upload_fks0701',
  'inventory.module1.generate',
  'inventory.module2.upload_pre',
  'inventory.module2.upload_fks0701',
  'inventory.module2.upload_external',
  'inventory.module2.generate',
  'inventory.module3.upload_recount',
  'inventory.module3.upload_uninventoried',
  'inventory.module3.generate',
  'inventory.base_data.upload',
  'inventory.export.download'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 督導 (supervisor_role) - 擁有查看和基本操作權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'supervisor_role'),
  id,
  true
FROM permissions
WHERE code IN (
  'inventory.inventory.view',
  'inventory.inventory.access',
  'inventory.module1.upload_external',
  'inventory.module1.upload_fks0701',
  'inventory.module1.generate',
  'inventory.module2.upload_pre',
  'inventory.module2.upload_fks0701',
  'inventory.module2.upload_external',
  'inventory.module2.generate',
  'inventory.module3.upload_recount',
  'inventory.module3.upload_uninventoried',
  'inventory.module3.generate',
  'inventory.base_data.upload',
  'inventory.export.download'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 主管 (manager) - 擁有查看權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'manager'),
  id,
  true
FROM permissions
WHERE code IN (
  'inventory.inventory.view',
  'inventory.inventory.access'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 一般成員 (member) - 無盤點管理權限（不新增）

-- ============================================
-- 完成訊息
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ 盤點管理模組權限新增完成';
  RAISE NOTICE '已為以下角色添加盤點管理權限：';
  RAISE NOTICE '  - 系統管理員 (admin): 所有權限';
  RAISE NOTICE '  - 營業部主管 (business_supervisor): 完整權限';
  RAISE NOTICE '  - 營業部助理 (business_assistant): 完整權限';
  RAISE NOTICE '  - 店長 (store_manager_role): 基本操作權限';
  RAISE NOTICE '  - 督導 (supervisor_role): 基本操作權限';
  RAISE NOTICE '  - 主管 (manager): 查看權限';
END $$;
