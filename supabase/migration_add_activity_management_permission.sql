-- ============================================
-- 新增「活動管理入口」權限
-- 控制每月人員狀態頁面的「活動管理」按鈕顯示
-- ============================================

-- 1. 新增權限定義
INSERT INTO permissions (module, feature, code, action, description)
VALUES ('activity', 'management', 'activity.management.access', 'access', '存取活動管理功能（每月狀態頁面的活動管理按鈕）')
ON CONFLICT (code) DO NOTHING;

-- 2. 將此權限指派給適當的角色
-- admin（系統管理員）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'admin' AND p.code = 'activity.management.access'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- business_supervisor（督導）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'business_supervisor' AND p.code = 'activity.management.access'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- supervisor_role（督導角色）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'supervisor_role' AND p.code = 'activity.management.access'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- store_manager_role（店長角色）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'store_manager_role' AND p.code = 'activity.management.access'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- manager（營業部經理/主管）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code = 'activity.management.access'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
