-- M3 A.4 步驟 A：預覽（只讀，不改任何資料）。
-- 1) 缺 task.view_archived 的主管（profiles.role = 'manager'，且沒有任何有效角色授權此權限碼）
WITH has_perm AS (
  SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.view_archived'
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT pr.id, pr.full_name, pr.email, pr.role AS profile_role
FROM profiles pr
WHERE pr.role = 'manager' AND NOT EXISTS (SELECT 1 FROM has_perm h WHERE h.user_id = pr.id)
ORDER BY pr.full_name;

-- 2) 這些主管持有的角色，以及各角色的成員組成。
--    non_manager_holders = 0 的角色，步驟 B 會補授權；大於 0 的是混合角色，步驟 B 會略過，需人工決定。
WITH has_perm AS (
  SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.view_archived'
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), lacking AS (
  SELECT pr.id FROM profiles pr WHERE pr.role = 'manager' AND NOT EXISTS (SELECT 1 FROM has_perm h WHERE h.user_id = pr.id)
), role_stats AS (
  SELECT r.id AS role_id, r.code, r.name,
         count(DISTINCT ur.user_id) FILTER (WHERE ur.user_id IN (SELECT id FROM lacking)) AS lacking_managers,
         count(DISTINCT ur.user_id) FILTER (WHERE coalesce(pr.role,'') NOT IN ('manager','admin')) AS non_manager_holders,
         count(DISTINCT ur.user_id) AS all_holders
  FROM roles r
  JOIN user_roles ur ON ur.role_id = r.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
  LEFT JOIN profiles pr ON pr.id = ur.user_id
  GROUP BY r.id, r.code, r.name
)
SELECT role_id, code, name, lacking_managers, non_manager_holders, all_holders,
       CASE WHEN non_manager_holders = 0 THEN '步驟 B 會補授權' ELSE '混合角色：步驟 B 略過，需人工決定' END AS plan
FROM role_stats
WHERE lacking_managers > 0
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = role_stats.role_id AND rp.is_allowed AND p.code = 'task.view_archived'
  )
ORDER BY non_manager_holders, code;

-- 3) 權限碼本身是否存在且啟用（應為 1 列；沒有的話請先確認正式區是否已有此權限碼）。
SELECT id, code, is_active FROM permissions WHERE code = 'task.view_archived';
