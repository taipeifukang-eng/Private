-- =====================================================
-- 督導巡店系統 - RBAC 權限設定
-- =====================================================
-- 版本: v1.0
-- 日期: 2026-02-13
-- 說明: 新增督導巡店系統的 11 個權限並分配給相關角色
-- 依賴: 需先執行 migration_add_inspection_system.sql
-- =====================================================

-- =====================================================
-- 1. 新增督導巡店權限
-- =====================================================
INSERT INTO permissions (code, description, module, feature, action, is_active)
VALUES
  -- 基本 CRUD 權限
  (
    'inspection.create',
    '新增巡店記錄 - 允許督導建立新的門市巡檢記錄，記錄檢查項目、評分與照片',
    '督導巡店',
    'inspection',
    'create',
    true
  ),
  (
    'inspection.view_own',
    '查看自己的巡店記錄 - 允許督導查看自己建立的巡檢記錄與評分明細',
    '督導巡店',
    'inspection',
    'view',
    true
  ),
  (
    'inspection.view_store',
    '查看門市巡店記錄 - 允許店長查看自己門市的所有巡檢記錄與改善項目',
    '督導巡店',
    'inspection_store',
    'view',
    true
  ),
  (
    'inspection.view_all',
    '查看所有巡店記錄 - 允許管理員查看所有門市、所有督導的巡檢記錄',
    '督導巡店',
    'inspection_all',
    'view',
    true
  ),
  (
    'inspection.edit',
    '編輯巡店記錄 - 允許修改進行中的巡檢記錄、更新評分與備註',
    '督導巡店',
    'inspection',
    'edit',
    true
  ),
  (
    'inspection.delete',
    '刪除巡店記錄 - 允許刪除草稿狀態的巡檢記錄（完成後不可刪除）',
    '督導巡店',
    'inspection',
    'delete',
    true
  ),
  
  -- 流程控制權限
  (
    'inspection.complete',
    '完成巡店記錄 - 允許將巡檢記錄標記為完成並通知店長',
    '督導巡店',
    'inspection',
    'complete',
    true
  ),
  (
    'inspection.close',
    '結案巡店記錄 - 允許上傳店長簽名單照片並正式結案',
    '督導巡店',
    'inspection',
    'close',
    true
  ),
  
  -- 功能權限
  (
    'inspection.upload_photo',
    '上傳巡店照片 - 允許拍照並上傳檢查項目的缺失照片到 Supabase Storage',
    '督導巡店',
    'inspection',
    'upload',
    true
  ),
  (
    'inspection.export',
    '匯出巡店報表 - 允許將巡檢記錄列印成 PDF 或匯出報表',
    '督導巡店',
    'inspection',
    'export',
    true
  ),
  
  -- 管理權限
  (
    'inspection.template.manage',
    '管理檢查範本 - 允許新增、編輯、刪除檢查項目範本與評分標準',
    '督導巡店',
    'inspection_template',
    'manage',
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
-- 2. 分配權限給督導角色（Supervisor）
-- =====================================================
-- 督導擁有完整的巡店權限（除了管理範本）
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'supervisor_role'),
  id
FROM permissions
WHERE code IN (
  'inspection.create',        -- 可新增巡店記錄
  'inspection.view_own',      -- 可查看自己的記錄
  'inspection.view_all',      -- 可查看所有門市的記錄
  'inspection.edit',          -- 可編輯進行中的記錄
  'inspection.delete',        -- 可刪除草稿記錄
  'inspection.complete',      -- 可完成巡店
  'inspection.close',         -- 可結案
  'inspection.upload_photo',  -- 可上傳照片
  'inspection.export'         -- 可匯出報表
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- 3. 分配權限給店長角色（Store Manager）
-- =====================================================
-- 店長只能查看自己門市的記錄和匯出報表
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id
FROM permissions
WHERE code IN (
  'inspection.view_store',    -- 只能查看自己門市的記錄
  'inspection.export'         -- 可匯出報表
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- 4. 分配權限給管理員角色（Admin）
-- =====================================================
-- 管理員擁有所有督導巡店權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'admin_role'),
  id
FROM permissions
WHERE code LIKE 'inspection.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- 5. 驗證權限設定
-- =====================================================
-- 查詢督導巡店的權限列表
SELECT 
  p.code,
  p.description,
  p.module,
  p.feature,
  p.action,
  COUNT(DISTINCT rp.role_id) as assigned_roles_count
FROM permissions p
LEFT JOIN role_permissions rp ON p.id = rp.permission_id
WHERE p.code LIKE 'inspection.%'
GROUP BY p.id, p.code, p.description, p.module, p.feature, p.action
ORDER BY p.code;

-- 查詢各角色的督導巡店權限
SELECT 
  r.code as role_code,
  r.name as role_name,
  COUNT(p.id) as inspection_permissions_count,
  STRING_AGG(p.code, ', ' ORDER BY p.code) as permissions
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
LEFT JOIN permissions p ON rp.permission_id = p.id AND p.code LIKE 'inspection.%'
WHERE r.code IN ('admin_role', 'supervisor_role', 'store_manager_role')
GROUP BY r.id, r.code, r.name
ORDER BY r.code;

-- =====================================================
-- 權限設定完成
-- =====================================================
-- 結果應顯示：
-- - admin_role: 11 個督導巡店權限
-- - supervisor_role: 9 個督導巡店權限（除了 template.manage）
-- - store_manager_role: 2 個督導巡店權限（view_store, export）
--
-- 下一步：
-- 1. 執行 migration_add_inspection_rls.sql（設定 RLS 策略）
-- 2. 執行 seed_inspection_templates.sql（匯入題庫）
-- =====================================================
