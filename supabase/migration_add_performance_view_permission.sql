-- ============================================
-- 新增「檢視業績資訊」權限
-- 控制每月人員狀態頁面中的業績欄位顯示：
-- 上月單品獎金、計算區塊、交易次數、銷售金額、毛利、毛利率
-- ============================================

-- 1. 新增權限定義（放在 monthly 模組下）
INSERT INTO permissions (module, feature, code, action, description)
VALUES ('monthly', 'status', 'monthly.status.view_performance', 'view', '檢視業績資訊（單品獎金、交易次數、銷售金額、毛利、毛利率）')
ON CONFLICT (code) DO NOTHING;

-- 2. 將此權限指派給適當的角色
-- admin（系統管理員）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'admin' AND p.code = 'monthly.status.view_performance'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- business_supervisor（督導）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'business_supervisor' AND p.code = 'monthly.status.view_performance'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- supervisor_role（督導角色）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'supervisor_role' AND p.code = 'monthly.status.view_performance'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- store_manager_role（店長角色）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'store_manager_role' AND p.code = 'monthly.status.view_performance'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

-- manager（營業部經理/主管）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.code = 'manager' AND p.code = 'monthly.status.view_performance'
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
