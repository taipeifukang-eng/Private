-- M3 B.1：上線前比對「舊版能打開別人任務的人」與「新版能代為勾選的人」（只讀，不改任何資料）。
-- 舊版 /assignment/[id]：profiles.role 為 admin 或 manager 的人都能打開不是自己參與的任務。
-- 新版：系統管理員（profiles.role = 'admin'），或 profiles.role = 'manager' 且有 task.manage 權限者。
-- 權限判定與正式區 has_permission 一致：看 user_roles（有效、未過期）→ role_permissions.is_allowed → permissions.is_active，不檢查 roles.is_active。
WITH has_manage AS (
  SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.manage'
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), legacy AS (
  SELECT id, full_name, email, role FROM profiles WHERE role IN ('admin','manager')
), native AS (
  SELECT pr.id, pr.full_name, pr.email, pr.role
  FROM profiles pr
  WHERE pr.role = 'admin' OR (pr.role = 'manager' AND pr.id IN (SELECT user_id FROM has_manage))
)
SELECT '舊版可、新版不可（上線後這些人打不開別人的任務，需補 task.manage 或確認不需要）' AS diff,
       l.full_name, l.email, l.role
FROM legacy l WHERE l.id NOT IN (SELECT id FROM native)
UNION ALL
SELECT '新版可、舊版不可（不應該出現；若有請確認 profiles.role）', n.full_name, n.email, n.role
FROM native n WHERE n.id NOT IN (SELECT id FROM legacy)
ORDER BY 1, 2;
