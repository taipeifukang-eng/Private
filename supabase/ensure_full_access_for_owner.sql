-- 確保指定帳號在 RBAC 中「功能全開」
-- 目標帳號: taipeifukang@gmail.com
-- 說明:
-- 1) profiles.role 設為 admin
-- 2) 綁定所有 admin 類角色（若存在）到 user_roles
-- 3) 確保 admin/system_admin/admin_role 角色擁有全部 active permissions
-- 4) 將上述角色 assignment 設為啟用且永不過期

BEGIN;

-- A. 先確保 profiles 存在，並升級為 admin
INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) AS full_name,
  'admin'::text,
  NOW(),
  NOW()
FROM auth.users u
WHERE lower(u.email) = lower('taipeifukang@gmail.com')
ON CONFLICT (id)
DO UPDATE SET
  email = EXCLUDED.email,
  role = 'admin',
  updated_at = NOW();

-- B. 建立 admin 類角色清單（僅針對資料庫中真的存在的角色代碼）
WITH owner_user AS (
  SELECT id AS user_id
  FROM auth.users
  WHERE lower(email) = lower('taipeifukang@gmail.com')
), admin_like_roles AS (
  SELECT id AS role_id
  FROM roles
  WHERE code IN ('admin', 'system_admin', 'admin_role')
)
INSERT INTO user_roles (user_id, role_id, is_active, assigned_at, expires_at)
SELECT
  o.user_id,
  r.role_id,
  true,
  NOW(),
  NULL
FROM owner_user o
CROSS JOIN admin_like_roles r
ON CONFLICT (user_id, role_id)
DO UPDATE SET
  is_active = true,
  expires_at = NULL;

-- C. 讓 admin 類角色擁有全部 active permissions
-- 1) 先補齊缺少的 role_permissions
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

-- 2) 既有映射若為 false，強制改為 true（避免被明確拒絕）
UPDATE role_permissions rp
SET is_allowed = true
FROM roles r
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role_id = r.id
  AND r.code IN ('admin', 'system_admin', 'admin_role')
  AND p.is_active = true
  AND rp.is_allowed = false;

COMMIT;

-- D. 驗證 1：目前帳號 profiles 角色
SELECT id, email, full_name, role
FROM public.profiles
WHERE lower(email) = lower('taipeifukang@gmail.com');

-- D. 驗證 2：目前帳號擁有的角色
SELECT
  u.email,
  r.code AS role_code,
  r.name AS role_name,
  ur.is_active,
  ur.expires_at
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN auth.users u ON u.id = ur.user_id
WHERE lower(u.email) = lower('taipeifukang@gmail.com')
ORDER BY r.code;

-- D. 驗證 3：目前帳號有效權限總數
SELECT COUNT(DISTINCT p.code) AS permission_count
FROM auth.users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE lower(u.email) = lower('taipeifukang@gmail.com')
  AND ur.is_active = true
  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  AND rp.is_allowed = true
  AND p.is_active = true;

-- D. 驗證 4：列出缺少的 active permissions（理論上應為 0 筆）
WITH owner_user AS (
  SELECT id AS user_id
  FROM auth.users
  WHERE lower(email) = lower('taipeifukang@gmail.com')
), user_active_permissions AS (
  SELECT DISTINCT p.id
  FROM owner_user o
  JOIN user_roles ur ON ur.user_id = o.user_id
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
