-- M3 F1 補授權 task.manage：步驟 A（只讀預覽）。
-- 先在下方 target 清單填入要補授權的「員工編號」或「user id」（兩種擇一或混用），貼到正式區 SQL editor 執行。
-- 預覽每個人：找不到、profiles.role 不是 manager（task.manage 對其他身分無效）、已經有 task.manage（會略過）、將被補授權。
WITH target(ident) AS (
  VALUES
    -- ('A001'),                                   -- 員工編號
    -- ('00000000-0000-0000-0000-000000000000'),   -- user id
    ('__填入員工編號或_user_id__')
), resolved AS (
  SELECT t.ident, pr.id, pr.employee_code, pr.full_name, pr.role
  FROM target t
  LEFT JOIN profiles pr ON pr.employee_code = t.ident OR pr.id::text = t.ident
), has_manage AS (
  SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.manage'
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT r.ident, r.id AS user_id, r.employee_code, r.full_name, r.role,
  CASE
    WHEN r.id IS NULL THEN '找不到此人，將略過'
    WHEN r.role <> 'manager' THEN '身分不是 manager（admin 本來就可；其他身分補了也無效），將略過'
    WHEN r.id IN (SELECT user_id FROM has_manage) THEN '已有 task.manage，將略過'
    ELSE '將補授權 task.manage'
  END AS plan
FROM resolved r
ORDER BY plan, r.employee_code;
