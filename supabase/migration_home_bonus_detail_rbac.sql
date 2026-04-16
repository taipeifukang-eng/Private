-- ============================================
-- 首頁「我的每月獎金明細」RBAC 權限
-- 2026-04-16
-- ============================================

-- 1) 新增權限點
INSERT INTO permissions (module, feature, code, action, description)
VALUES (
  'home',
  'bonus_detail',
  'home.bonus_detail.view_own',
  'view_own',
  '查看首頁我的每月獎金明細'
)
ON CONFLICT (code) DO NOTHING;

-- 2) 新增專用角色（可由後台維護成員）
INSERT INTO roles (name, code, description, is_system, is_active)
VALUES (
  '首頁獎金明細查看角色',
  'home_bonus_detail_viewer',
  '可在首頁查看自己的每月獎金明細',
  false,
  true
)
ON CONFLICT (code) DO NOTHING;

-- 3) 將權限綁定到專用角色
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'home.bonus_detail.view_own'
WHERE r.code = 'home_bonus_detail_viewer'
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 4) 指派角色給目前指定的 7 位督導（後續可在角色管理頁面維護）
WITH target_codes AS (
  SELECT UNNEST(ARRAY[
    'FK0129',
    'FK0195',
    'FK0199',
    'FK0309',
    'FK0359',
    'FK0385',
    'FK0389'
  ]) AS employee_code
), target_users AS (
  SELECT p.id AS user_id, UPPER(p.employee_code) AS employee_code
  FROM profiles p
  JOIN target_codes tc ON UPPER(p.employee_code) = tc.employee_code
), target_role AS (
  SELECT id AS role_id
  FROM roles
  WHERE code = 'home_bonus_detail_viewer'
  LIMIT 1
)
INSERT INTO user_roles (user_id, role_id, employee_code, is_active, assigned_at)
SELECT tu.user_id, tr.role_id, tu.employee_code, true, NOW()
FROM target_users tu
CROSS JOIN target_role tr
ON CONFLICT (user_id, role_id)
DO UPDATE SET
  employee_code = EXCLUDED.employee_code,
  is_active = true,
  expires_at = NULL;
