-- M5 W20 Q7：只讀。預覽每個人在「活動排程檢視」會看到哪幾顆按鈕與管轄門市數。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 對應 m5-spec.md Q7（照舊版）：新版按鈕條件與舊頁 app/activity-view/[id]/page.tsx 完全相同，沒有新舊差異；
-- 這份名單的用途是「上線前讓你確認每個角色看到的按鈕符不符合預期」，特別是下面兩種容易被誤解的情況：
--   (a) 有支援指派或人力查看權限、但沒有任何店長／督導任命的人：舊版與新版都不會載入管轄門市，三顆按鈕（含前置 Check List）全不出現。
--   (b) 只有活動檢視權（view_own）、沒有支援指派／人力查看權的店長：前置 Check List 也不出現（舊版 Check List 只在有管轄門市時才顯示，而管轄門市只有在持有那兩個權限之一時才會載入）。
--
-- 規則（舊版逐行）：
--   admin_role      = 持有角色代碼 'admin'（舊頁以角色代碼判斷，與 profiles.role 無關）
--   can_assign      = admin_role 或有 activity.support_assign.edit      -> 「支援請求」按鈕（且有管轄門市）
--   can_overview    = admin_role 或有 activity.staff_overview.view      -> 「活動人力查看」按鈕（且有管轄門市）
--   managed_count   = 只有 can_assign 或 can_overview 才計算：admin_role 為全部啟用門市數，其他人為 store_managers 任命的門市數（任何任命類型）
--   「前置 Check List」按鈕 = managed_count > 0
-- 權限判定照正式區 has_permission：user_roles.is_active 且未過期、role_permissions.is_allowed、permissions.is_active，不檢查 roles.is_active。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), perms AS (
  SELECT vr.user_id, p.code
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code IN ('activity.support_assign.edit', 'activity.staff_overview.view')
), eval AS (
  SELECT pr.id AS user_id, pr.employee_code, pr.full_name, pr.email, pr.department, pr.job_title,
         EXISTS (SELECT 1 FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = pr.id AND r.code = 'admin') AS admin_role,
         EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'activity.support_assign.edit') AS has_assign_perm,
         EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'activity.staff_overview.view') AS has_overview_perm,
         (SELECT count(DISTINCT sm.store_id) FROM store_managers sm WHERE sm.user_id = pr.id) AS appointed_count,
         (SELECT count(*) FROM stores s WHERE s.is_active) AS active_store_count
  FROM profiles pr
), calc AS (
  SELECT e.*,
         (admin_role OR has_assign_perm) AS can_assign,
         (admin_role OR has_overview_perm) AS can_overview,
         CASE WHEN admin_role OR has_assign_perm OR has_overview_perm
              THEN (CASE WHEN admin_role THEN active_store_count ELSE appointed_count END)
              ELSE 0 END AS managed_count
  FROM eval e
)
SELECT employee_code, full_name, email, department, job_title, admin_role,
       (can_assign AND managed_count > 0)   AS btn_support_request,
       (can_overview AND managed_count > 0) AS btn_staff_overview,
       (managed_count > 0)                  AS btn_checklist,
       managed_count,
       CASE WHEN (can_assign OR can_overview) AND managed_count = 0 THEN 'CHECK 有權限但沒有任命，三顆按鈕都不會出現'
            WHEN managed_count > 0 AND NOT can_overview THEN 'NOTE 沒有人力查看權：看不到活動人力查看'
            WHEN managed_count > 0 AND NOT can_assign THEN 'NOTE 沒有支援指派權：看不到支援請求'
            ELSE '' END AS note,
       user_id
FROM calc
WHERE can_assign OR can_overview OR admin_role
ORDER BY note DESC, department NULLS LAST, employee_code NULLS LAST, email;
