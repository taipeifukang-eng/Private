-- 以員工編號為主，確保帳號 RBAC 權限全開
-- 使用方式：先把下方 target_employee_code 改成你的員編（例如 FK0171）

BEGIN;

-- 0) 目標員編
WITH target AS (
  SELECT 'FK0171'::varchar AS target_employee_code
),
owner_profile AS (
  SELECT p.id, p.email, p.employee_code
  FROM profiles p
  JOIN target t ON upper(p.employee_code) = upper(t.target_employee_code)
  LIMIT 1
)
-- 1) profiles.role 設為 admin（以員編找到帳號）
UPDATE profiles p
SET role = 'admin',
    updated_at = NOW()
FROM owner_profile o
WHERE p.id = o.id;

-- 2) 綁定 admin 類角色到 user_roles（以員編對應到 user_id）
WITH target AS (
  SELECT 'FK0171'::varchar AS target_employee_code
),
owner_profile AS (
  SELECT p.id, p.employee_code
  FROM profiles p
  JOIN target t ON upper(p.employee_code) = upper(t.target_employee_code)
  LIMIT 1
),
admin_like_roles AS (
  SELECT id AS role_id
  FROM roles
  WHERE code IN ('admin', 'system_admin', 'admin_role')
)
INSERT INTO user_roles (user_id, role_id, employee_code, is_active, assigned_at, expires_at)
SELECT
  o.id,
  r.role_id,
  o.employee_code,
  true,
  NOW(),
  NULL
FROM owner_profile o
CROSS JOIN admin_like_roles r
ON CONFLICT (user_id, role_id)
DO UPDATE SET
  employee_code = EXCLUDED.employee_code,
  is_active = true,
  expires_at = NULL;

-- 3) 確保 admin 類角色擁有全部 active permissions
WITH admin_like_roles AS (
  SELECT id AS role_id
  FROM roles
  WHERE code IN ('admin', 'system_admin', 'admin_role')
), active_permissions AS (
  SELECT id AS permission_id
  FROM permissions
  WHERE is_active = true
)
INSERT INTO role_permissions (role_id, permission_id, is_allowed, created_at)
SELECT
  r.role_id,
  p.permission_id,
  true,
  NOW()
FROM admin_like_roles r
CROSS JOIN active_permissions p
ON CONFLICT (role_id, permission_id)
DO NOTHING;

UPDATE role_permissions rp
SET is_allowed = true
FROM roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code IN ('admin', 'system_admin', 'admin_role')
  AND p.is_active = true
  AND rp.is_allowed = false;

COMMIT;

-- 4) 驗證：以員編查看目前角色、RBAC指派、權限缺口
WITH target AS (
  SELECT 'FK0171'::varchar AS target_employee_code
), owner_profile AS (
  SELECT p.id, p.email, p.full_name, p.role, p.employee_code
  FROM profiles p
  JOIN target t ON upper(p.employee_code) = upper(t.target_employee_code)
  LIMIT 1
)
SELECT * FROM owner_profile;

WITH target AS (
  SELECT 'FK0171'::varchar AS target_employee_code
), owner_profile AS (
  SELECT p.id, p.employee_code
  FROM profiles p
  JOIN target t ON upper(p.employee_code) = upper(t.target_employee_code)
  LIMIT 1
)
SELECT r.code AS role_code, r.name AS role_name, ur.is_active, ur.expires_at, ur.employee_code
FROM owner_profile o
JOIN user_roles ur ON ur.user_id = o.id
JOIN roles r ON r.id = ur.role_id
ORDER BY r.code;

WITH target AS (
  SELECT 'FK0171'::varchar AS target_employee_code
), owner_profile AS (
  SELECT p.id
  FROM profiles p
  JOIN target t ON upper(p.employee_code) = upper(t.target_employee_code)
  LIMIT 1
), user_active_permissions AS (
  SELECT DISTINCT p.id
  FROM owner_profile o
  JOIN user_roles ur ON ur.user_id = o.id
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    AND rp.is_allowed = true
    AND p.is_active = true
)
SELECT p.code AS missing_permission_code
FROM permissions p
LEFT JOIN user_active_permissions up ON up.id = p.id
WHERE p.is_active = true
  AND up.id IS NULL
ORDER BY p.code;
