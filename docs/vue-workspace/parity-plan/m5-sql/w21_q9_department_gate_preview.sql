-- M5 W21 Q9：只讀。部門管理（含部門職掌）的進入條件改回「舊版頁面條件」之後，哪些帳號的入口會不同。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
--
-- 三種規則（權限判定照正式區 has_permission：user_roles.is_active 且未過期、role_permissions.is_allowed、permissions.is_active，不檢查 roles.is_active，資料庫端沒有 admin 放行）：
--   舊 Navbar 選單：organization.department.view／create／edit、organization.member.view／manage、organization.manager.view／manage 任一
--   舊部門管理頁面（也是 M5 新版採用的條件）：organization.department_workspace.view／manage、organization.department.view／create／edit、organization.member.manage、organization.manager.manage 任一
--   M5 之前的新版：整組組織相關權限（含 organization.organization.view、member.view、manager.view）＋工作管理
--
-- 結果欄位 state：
--   'NEW_BLOCKED'      M5 之前的新版進得去、M5 新版（＝舊頁面）進不去。這是 Q9 要收回的人：只有組織檢視、成員檢視或主管檢視之類的權限。
--   'MENU_BUT_BLOCKED' 舊版選單看得到「部門管理」，但點進去會被導回儀表板（舊頁面不放行）；M5 新版選單不再出現。
--   'ALLOWED'          舊頁面與 M5 新版都放行。
-- profile_role_admin：舊式身分是管理員者，舊版 hasPermission 對他們任何權限碼都放行（應用層後備），不受上面規則限制，僅供參考。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), perms AS (
  SELECT vr.user_id, p.code, vr.role_id
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code LIKE 'organization.%'
), eval AS (
  SELECT pr.id AS user_id, pr.employee_code, pr.full_name, pr.email, pr.department, pr.job_title, (pr.role = 'admin') AS profile_role_admin,
    EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code IN ('organization.department.view','organization.department.create','organization.department.edit','organization.member.view','organization.member.manage','organization.manager.view','organization.manager.manage')) AS legacy_menu,
    EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code IN ('organization.department_workspace.view','organization.department_workspace.manage','organization.department.view','organization.department.create','organization.department.edit','organization.member.manage','organization.manager.manage')) AS legacy_page,
    EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code IN ('organization.organization.view','organization.department.view','organization.department_workspace.view','organization.department.create','organization.department.edit','organization.member.view','organization.member.manage','organization.manager.view','organization.manager.manage','organization.department_workspace.manage')) AS before_m5_new
  FROM profiles pr
)
SELECT CASE WHEN before_m5_new AND NOT legacy_page THEN 'NEW_BLOCKED 只有組織／成員／主管檢視類權限：M5 之前的新版進得去、M5 新版進不去'
            WHEN legacy_menu AND NOT legacy_page THEN 'MENU_BUT_BLOCKED 舊版選單看得到但舊頁面導回儀表板'
            ELSE 'ALLOWED' END AS state,
       employee_code, full_name, email, department, job_title, profile_role_admin,
       legacy_menu, legacy_page, before_m5_new,
       (SELECT string_agg(DISTINCT r.code, ', ' ORDER BY r.code) FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = e.user_id) AS current_roles,
       (SELECT string_agg(DISTINCT x.code, ', ' ORDER BY x.code) FROM perms x WHERE x.user_id = e.user_id) AS organization_permissions,
       user_id
FROM eval e
WHERE before_m5_new OR legacy_menu OR legacy_page   -- 只想看會不同的人：改成 (before_m5_new AND NOT legacy_page) OR (legacy_menu AND NOT legacy_page)
ORDER BY state, department NULLS LAST, employee_code NULLS LAST, email;

-- 另外：哪些角色帶有這類權限（決定要不要幫某個角色補「部門檢視」或「部門工作檢視」，由你決定）。要看請把下面三行的註解拿掉單獨執行。
-- SELECT r.code, r.name, r.is_active, string_agg(p.code, ', ' ORDER BY p.code) AS organization_permissions
-- FROM roles r JOIN role_permissions rp ON rp.role_id = r.id AND rp.is_allowed JOIN permissions p ON p.id = rp.permission_id AND p.is_active
-- WHERE p.code LIKE 'organization.%' GROUP BY r.id, r.code, r.name, r.is_active ORDER BY r.code;
