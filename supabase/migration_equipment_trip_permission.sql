-- =====================================================
-- 活動用品車次管理的專用編輯權限
--
-- 【權限設計】
-- ┌──────────────────────────────────────────────────┐
-- │  activity.equipment_trip.edit                    │
-- │  → 可新增、修改、刪除促銷活動的用品車次記錄      │
-- │  → 僅 promotion 類型活動才有此 Tab               │
-- └──────────────────────────────────────────────────┘
--
-- 授予對象：admin、business_supervisor、business_assistant
-- （活動組/營業部助理負責填寫設備車次排程）
-- =====================================================

-- 1. 新增權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('activity', 'equipment_trip', 'activity.equipment_trip.edit', 'edit', '編輯活動用品車次記錄（5套設備搬運排程）')
ON CONFLICT (code) DO NOTHING;

-- 2. 授予 admin
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code = 'activity.equipment_trip.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 授予 business_supervisor（營業部主管）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code = 'activity.equipment_trip.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. 授予 business_assistant（營業部助理/活動組）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'business_assistant'
  AND p.code = 'activity.equipment_trip.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 驗證
SELECT r.code AS 角色, p.code AS 權限, rp.is_allowed AS 已授予
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'activity.equipment_trip.edit'
ORDER BY r.code;
