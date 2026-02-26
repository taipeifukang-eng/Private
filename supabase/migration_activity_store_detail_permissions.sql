-- =====================================================
-- 活動門市細節的編輯/檢視權限
--
-- 【雙層權限設計】
-- ┌─────────────────────────────────────────────────────┐
-- │  進入「排程管理」頁面                                │
-- │  → 需要 activity.campaign.edit                      │
-- │    OR  activity.store_detail.edit  (任一即可)        │
-- ├─────────────────────────────────────────────────────┤
-- │  日曆拖曳 / 移除 / 自動排程 / 儲存變更              │
-- │  → 僅需要 activity.campaign.edit                    │
-- ├─────────────────────────────────────────────────────┤
-- │  門市細節欄位編輯（人員安排）                        │
-- │  → 僅需要 activity.store_detail.edit                │
-- └─────────────────────────────────────────────────────┘
--
-- activity.campaign.edit 已在 migration_rbac_system.sql 定義並
-- 授予 admin / business_supervisor 等角色，本檔案不重複設定。
-- =====================================================

-- 1. 新增權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('activity', 'store_detail', 'activity.store_detail.view', 'view', '查看活動門市細節（人員安排）'),
  ('activity', 'store_detail', 'activity.store_detail.edit', 'edit', '編輯活動門市細節（人員安排）')
ON CONFLICT (code) DO NOTHING;

-- 2. 授予 admin 角色
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin'
  AND p.code IN ('activity.store_detail.view', 'activity.store_detail.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. 授予 business_supervisor（營業部主管）
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'business_supervisor'
  AND p.code IN ('activity.store_detail.view', 'activity.store_detail.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. 授予 supervisor_role（督導）：可編輯
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
  AND p.code IN ('activity.store_detail.view', 'activity.store_detail.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. 授予 store_manager_role（店長）：僅可查看
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code IN ('activity.store_detail.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6. 授予盤點組/行銷部等（如有對應 role code）：僅可查看
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('inventory_team', 'marketing_team', 'business_assistant')
  AND p.code IN ('activity.store_detail.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 驗證
SELECT r.code as 角色, p.code as 權限, rp.is_allowed as 已授予
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('activity.store_detail.view', 'activity.store_detail.edit')
ORDER BY r.code, p.code;
