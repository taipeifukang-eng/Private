-- M5 P06 Q15：只讀。「待開通」名單：有登入帳號、沒有被停用、沒有管理員相容身分，而且沒有任何生效角色的帳號。
-- 與新版使用者管理的「待開通 N 位」標籤與篩選使用同一個條件；公開註冊的新帳號預設就是這種帳號。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 生效角色 = user_roles.is_active 且未到期（與正式區 has_permission 相同，不檢查 roles.is_active）。
-- 停用 = auth.users.banned_until 尚未到期（舊版只要有封鎖時間就算停用，新版較準確，列入差異清單）。
-- 管理員相容身分 = profiles.role 是 admin，或持有管理員等級角色（admin、system_admin、full_admin、full_admin_role、dev_full_admin、owner、owner_role、admin_role）。
SELECT au.email,
       pr.employee_code, pr.full_name, pr.department, pr.job_title, pr.role AS legacy_role,
       au.created_at AS registered_at, au.last_sign_in_at, (au.email_confirmed_at IS NOT NULL) AS email_confirmed
FROM auth.users au
LEFT JOIN profiles pr ON pr.id = au.id
WHERE COALESCE(pr.role, 'member') <> 'admin'
  AND NOT (au.banned_until IS NOT NULL AND au.banned_until > now())
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = au.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
  )
ORDER BY au.created_at DESC;
-- 上線後這份名單就是管理員在「使用者管理」看到的「待開通 N 位」；N 應等於這裡的筆數。
-- （持有管理員等級角色的人一定有生效角色，所以上面的「沒有任何生效角色」條件已經把他們排除。）
