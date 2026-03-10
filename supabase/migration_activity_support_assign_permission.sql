-- ============================================================
-- 活動模組權限設定（兩個獨立權限，分別給店長和督導）
-- 執行環境：Supabase SQL Editor
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 權限 A: activity.support_assign.edit
-- 對象：store_manager_role（店長）
-- 用途：當有支援請求時，店長可開啟「支援請求」按鈕填入人員資訊
-- ──────────────────────────────────────────────────────────

-- 1a. 新增權限定義
INSERT INTO permissions (module, feature, code, action, description)
VALUES ('activity', 'support_assign', 'activity.support_assign.edit', 'edit', '支援請求填寫（店長填入支援人員資訊）')
ON CONFLICT (code) DO NOTHING;

-- 1b. 指派給店長角色 (store_manager_role)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code = 'activity.support_assign.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────
-- 權限 B: activity.staff_overview.view
-- 對象：supervisor_role（督導）、business_supervisor（營業部主管）
-- 用途：督導查看管理門市的活動人力概況，並可編輯/調整人員名單
-- ──────────────────────────────────────────────────────────

-- 2a. 新增權限定義
INSERT INTO permissions (module, feature, code, action, description)
VALUES ('activity', 'staff_overview', 'activity.staff_overview.view', 'view', '活動人力查看（督導查看/編輯管理門市的本店人員名單）')
ON CONFLICT (code) DO NOTHING;

-- 2b. 指派給督導角色 (supervisor_role)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code = 'activity.staff_overview.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 2c. 指派給營業部主管 (business_supervisor)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code = 'activity.staff_overview.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────
-- 驗證：檢查兩個權限的指派結果
-- ──────────────────────────────────────────────────────────
SELECT 
  r.code AS 角色代碼,
  r.name AS 角色名稱,
  p.code AS 權限代碼,
  rp.is_allowed AS 是否允許
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('activity.support_assign.edit', 'activity.staff_overview.view')
ORDER BY p.code, r.code;
