-- ============================================================
-- 商品主檔權限更名
-- 原：cross_dept.products_master.manage（module=cross_dept）
-- 新：store.products_master.manage（module=store）
-- 說明：商品主檔屬門市管理範疇，不屬於跨部門功能，故移至 store 模組
-- ============================================================

-- 1. 若舊 permission 存在，更新 module 與 code
UPDATE permissions
SET module = 'store',
    code   = 'store.products_master.manage'
WHERE code = 'cross_dept.products_master.manage';

-- 2. 若舊 permission 不存在（首次執行），直接 INSERT
INSERT INTO permissions (module, feature, code, action, description)
VALUES ('store', 'products_master', 'store.products_master.manage', 'manage', '可匯入及管理商品資料主檔')
ON CONFLICT (code) DO NOTHING;

-- 3. 確保 system_admin 擁有新權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'system_admin'
  AND p.code = 'store.products_master.manage'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
