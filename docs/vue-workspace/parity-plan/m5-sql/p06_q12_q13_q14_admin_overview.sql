-- M5 P06 Q12、Q13、Q14：只讀。誰能建立使用者、誰能授予管理員、誰能重置密碼。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 權限判定照正式區 has_permission：user_roles.is_active 且未過期、role_permissions.is_allowed、permissions.is_active，不檢查 roles.is_active，資料庫端沒有 admin 放行。
--
-- 欄位說明：
--   can_create_user          持有 user.user.create。Q12：新版移除「管理員直接建立使用者」，這些人上線後只剩「新增使用者」連到公開註冊頁
--   can_change_compat_role   持有 user.user.change_role。Q13：可把任何人（除自己）的相容角色改成管理員，畫面會先跳出醒目確認
--   can_assign_user_role     持有 role.user_role.assign。Q13：可把人加進任何角色（含管理員等級角色），畫面會先跳出醒目確認
--   legacy_admin_can_reset_password  舊式身分（profiles.role）是管理員。Q14：只有這群人能重置密碼
--   admin_like_role_but_cannot_reset_password  角色被視為完全管理員（owner、system_admin 等）但舊式身分不是管理員：其他功能都放行，唯獨不能重置密碼（新舊相同，維持）
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id FROM user_roles ur WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), perms AS (
  SELECT vr.user_id, p.code FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code IN ('user.user.create', 'user.user.change_role', 'role.user_role.assign')
), admin_like AS (
  SELECT vr.user_id, string_agg(DISTINCT r.code, ', ' ORDER BY r.code) AS admin_like_roles
  FROM valid_roles vr JOIN roles r ON r.id = vr.role_id
  WHERE r.code IN ('admin', 'system_admin', 'full_admin', 'full_admin_role', 'dev_full_admin', 'owner', 'owner_role', 'admin_role')
  GROUP BY vr.user_id
)
SELECT pr.employee_code, pr.full_name, pr.email, pr.department, pr.job_title,
       (pr.role = 'admin') AS legacy_admin_can_reset_password,
       (al.user_id IS NOT NULL AND pr.role <> 'admin') AS admin_like_role_but_cannot_reset_password,
       al.admin_like_roles,
       EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'user.user.create') AS can_create_user,
       EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'user.user.change_role') AS can_change_compat_role,
       EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'role.user_role.assign') AS can_assign_user_role,
       pr.id AS user_id
FROM profiles pr
LEFT JOIN admin_like al ON al.user_id = pr.id
WHERE pr.role = 'admin' OR al.user_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id)
ORDER BY (pr.role = 'admin') DESC, (al.user_id IS NOT NULL) DESC, pr.employee_code NULLS LAST, pr.email;
