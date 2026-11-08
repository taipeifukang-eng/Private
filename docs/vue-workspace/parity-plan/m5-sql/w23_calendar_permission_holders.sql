-- M5 W23 年度行事曆：只讀。誰持有四個行事曆權限，以及「舊式身分是管理員但沒被授予」的人。
-- 年度行事曆維持舊版三個獨立權限（新增公司行事、修改／取消公司行事、匯入政府假日），另有 Google 同步管理權限；這四個以資料庫規則為準：
--   新增、修改、取消公司行事與匯入假日最後由資料庫規則（RLS 與函式）擋，管理員沒被授予也不能做；
--   Google 管理只在應用層檢查，舊式身分是管理員的人一律放行（與舊版相同）。
-- 上線前用這份名單核對「誰該有、誰缺」，缺的直接在角色上授予權限，不改程式。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 權限判定與正式區 has_permission 相同：user_roles.is_active 且未到期、role_permissions.is_allowed、permissions.is_active，不檢查 roles.is_active。

-- 1) 持有者名單（一個人可能有多個角色，這裡每人每個權限一列）
SELECT p.code AS permission, au.email, pr.employee_code, pr.full_name, pr.department, pr.job_title, pr.role AS legacy_role,
       r.name AS via_role, ur.expires_at
FROM permissions p
JOIN role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed
JOIN roles r ON r.id = rp.role_id
JOIN user_roles ur ON ur.role_id = r.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
JOIN auth.users au ON au.id = ur.user_id
LEFT JOIN profiles pr ON pr.id = au.id
WHERE p.is_active
  AND p.code IN ('organization.calendar.company.create', 'organization.calendar.company.edit', 'organization.calendar.holiday.manage', 'organization.calendar.google.manage')
  AND NOT (au.banned_until IS NOT NULL AND au.banned_until > now())
ORDER BY p.code, pr.full_name;

-- 2) 舊式身分是管理員（或持有管理員等級角色），但「沒有」被授予某個行事曆權限的人
--    舊版畫面會顯示按鈕，按下儲存時資料庫擋下；新版依資料庫規則不顯示這三個按鈕。若他們本來就該能編，請補授予。
WITH calendar_codes(code) AS (
  VALUES ('organization.calendar.company.create'), ('organization.calendar.company.edit'), ('organization.calendar.holiday.manage')
), admins AS (
  SELECT au.id, au.email, pr.full_name, pr.role AS legacy_role
  FROM auth.users au
  LEFT JOIN profiles pr ON pr.id = au.id
  WHERE NOT (au.banned_until IS NOT NULL AND au.banned_until > now())
    AND (
      pr.role = 'admin'
      OR EXISTS (
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = au.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.code IN ('admin', 'system_admin', 'full_admin', 'full_admin_role', 'dev_full_admin', 'owner', 'owner_role', 'admin_role')
      )
    )
)
SELECT a.email, a.full_name, a.legacy_role, c.code AS missing_permission
FROM admins a
CROSS JOIN calendar_codes c
WHERE NOT EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = c.code
  WHERE ur.user_id = a.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
ORDER BY a.full_name, c.code;

-- 3) 四個權限碼在正式區是否存在且啟用（缺的代表正式區還沒套用年度行事曆的 migration）
SELECT code, is_active FROM permissions WHERE code LIKE 'organization.calendar.%' ORDER BY code;
