-- M3 B.1／F1：上線前比對「舊版能打開別人任務的人」與「新版能打開並代為勾選的人」。只讀，不改任何資料。
-- 在正式區 SQL editor 由使用者自行執行。
-- 舊版 app/assignment/[id]/page.tsx：isAdmin = profiles.role 為 'admin' 或 'manager'，不是協作者也能打開。
-- 新版（lib/workspace/task-management.ts taskManagementScope + lib/workspace/permission-semantics.ts）：
--   * 系統管理員：profiles.role = 'admin'，或持有有效的管理員類角色（roles.code 在 ADMIN_LIKE_ROLE_CODES）；
--   * 其餘人：profiles.role = 'manager'，且有效角色授權了 task.manage，並且有 task.view_own（taskDetail 先要求 task.view_own，缺了仍 403）。
--   權限判定與正式區 has_permission 一致：user_roles.is_active 且未過期 → role_permissions.is_allowed → permissions.is_active，不檢查 roles.is_active。
-- 欄位依 supabase/migrations 的 schema：profiles(id, email, full_name, role, employee_code)、user_roles(user_id, role_id, is_active, expires_at)、
--   role_permissions(role_id, permission_id, is_allowed)、permissions(id, code, is_active)、roles(id, code, name)。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), has_manage AS (
  SELECT DISTINCT vr.user_id
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.manage'
), admin_like AS (
  SELECT DISTINCT vr.user_id
  FROM valid_roles vr
  JOIN roles r ON r.id = vr.role_id
  WHERE r.code IN ('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
), legacy AS (
  SELECT id, employee_code, full_name, email, role FROM profiles WHERE role IN ('admin','manager')
), has_view_own AS (
  SELECT DISTINCT vr.user_id
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.view_own'
), native AS (
  SELECT pr.id, pr.employee_code, pr.full_name, pr.email, pr.role
  FROM profiles pr
  WHERE pr.role = 'admin'
     OR pr.id IN (SELECT user_id FROM admin_like)
     OR (pr.role = 'manager' AND pr.id IN (SELECT user_id FROM has_manage) AND pr.id IN (SELECT user_id FROM has_view_own))
)
SELECT '舊版可、新版不可（上線後這些人打不開別人的任務；需補 task.manage／task.view_own 或確認不需要）' AS diff,
       l.id AS user_id, l.employee_code, l.full_name, l.email, l.role,
       (SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = l.id) AS current_roles
FROM legacy l WHERE l.id NOT IN (SELECT id FROM native)
UNION ALL
SELECT '新版可、舊版不可（多為持有管理員類角色但 profiles.role 不是 admin/manager；請確認是否合理）',
       n.id, n.employee_code, n.full_name, n.email, n.role,
       (SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = n.id)
FROM native n WHERE n.id NOT IN (SELECT id FROM legacy)
ORDER BY 1, 4, 3;
