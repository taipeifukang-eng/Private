-- =====================================================
-- 活動前置 Checklist 編輯權限
--
-- 【權限設計】
-- ┌──────────────────────────────────────────────────┐
-- │  activity.checklist.edit                         │
-- │  → 可新增、修改、刪除活動前置 checklist 項目     │
-- │  → 店長查看並打勾完成項目不需要此權限            │
-- └──────────────────────────────────────────────────┘
--
-- 授予對象：admin、business_supervisor、business_assistant
-- （活動組/營業部負責編輯 checklist 模板）
-- =====================================================

-- 1. 新增權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('activity', 'checklist', 'activity.checklist.edit', 'edit', '編輯活動前置 checklist 項目')
ON CONFLICT (code) DO NOTHING;

-- 2. 授予 admin
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code = 'activity.checklist.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 授予 business_supervisor（營業部主管）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code = 'activity.checklist.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. 授予 business_assistant（營業部助理/活動組）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'business_assistant'
  AND p.code = 'activity.checklist.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 驗證
SELECT r.code AS 角色, p.code AS 權限, rp.is_allowed AS 已授予
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code = 'activity.checklist.edit'
ORDER BY r.code;
