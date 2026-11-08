-- M4 W17 步驟 D：只讀。列出「舊版可以回報改善、新版不可以」的人員名單。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 對應 m4-spec.md F 節（survey/m4f）最後一項。
--
-- 舊版可回報：
--   (L1) 該次巡店的督導本人（inspection_masters.inspector_id）；
--   (L2) 持有「管理改善」權限 inspection.improvement.manage 者（任何門市的項目）。
-- 新版可回報（lib/workspace/improvements.ts 的 canSubmit）：
--   (N1) 管理員：profiles.role = 'admin'，或持有管理員類角色（與新版 isAdmin 一致，清單同 m3-sql/compare_task_proxy_access.sql）；
--   (N2) 該項目所屬門市的店長（store_managers）；
--   (N3) 持有「提交改善」權限 inspection.improvement.submit 者（任何門市）。
-- 本檔列出：舊版可、而新版三個條件都不符的人。
--
-- 權限判定照正式區 has_permission：user_roles.is_active 且未過期 → role_permissions.is_allowed → permissions.is_active 且 code 相符，
-- 不檢查 roles.is_active，DB 端沒有 admin 放行。
-- 欄位依 supabase/migrations 的 schema：profiles(id, email, full_name, role, employee_code)、user_roles(user_id, role_id, is_active, expires_at)、
--   role_permissions(role_id, permission_id, is_allowed)、permissions(id, code, is_active)、roles(id, code)、
--   store_managers(user_id, store_id)、inspection_improvements(id, inspection_id, store_id, status)、inspection_masters(id, inspector_id)。
--
-- 結果欄位：
--   category        'L2 管理改善權限' 或 'L1 巡店督導本人'
--   affected_items  該人在舊版可回報、但新版不可的「尚未改善（pending、overdue）」項目數
--                   （L2 為全部門市尚未改善項目中扣掉他自己當店長的門市；L1 為他自己巡的單且不是該門市店長）
--   affected_stores 涉及的門市數
-- 處理方式：確認名單後，若這些人應該能回報，請補授權 inspection.improvement.submit；否則就是接受新版收緊（已列 allowlist m4-w17-q18-*）。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), perm_users AS (
  SELECT DISTINCT vr.user_id, p.code
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code IN ('inspection.improvement.manage', 'inspection.improvement.submit')
), admin_like AS (
  SELECT pr.id AS user_id FROM profiles pr WHERE pr.role = 'admin'
  UNION
  SELECT vr.user_id
  FROM valid_roles vr
  JOIN roles r ON r.id = vr.role_id
  WHERE r.code IN ('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
), open_items AS (
  -- 尚未改善、仍可回報的項目（已改善者舊版也不能再改）
  SELECT i.id, i.store_id, m.inspector_id
  FROM inspection_improvements i
  JOIN inspection_masters m ON m.id = i.inspection_id
  WHERE i.status IN ('pending', 'overdue')
), legacy_pairs AS (
  -- (人, 項目)：舊版可回報
  SELECT pu.user_id, oi.id AS item_id, oi.store_id, 'L2 管理改善權限' AS category
  FROM perm_users pu CROSS JOIN open_items oi
  WHERE pu.code = 'inspection.improvement.manage'
  UNION
  SELECT oi.inspector_id, oi.id, oi.store_id, 'L1 巡店督導本人'
  FROM open_items oi
  WHERE oi.inspector_id IS NOT NULL
), blocked AS (
  -- 扣掉新版可回報的人與門市
  SELECT lp.*
  FROM legacy_pairs lp
  WHERE lp.user_id NOT IN (SELECT user_id FROM admin_like)
    AND lp.user_id NOT IN (SELECT user_id FROM perm_users WHERE code = 'inspection.improvement.submit')
    AND NOT EXISTS (SELECT 1 FROM store_managers sm WHERE sm.user_id = lp.user_id AND sm.store_id = lp.store_id)
)
SELECT b.category,
       pr.employee_code, pr.full_name, pr.email, pr.role AS profile_role,
       count(DISTINCT b.item_id) AS affected_items,
       count(DISTINCT b.store_id) AS affected_stores,
       (SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = b.user_id) AS current_roles,
       b.user_id
FROM blocked b
LEFT JOIN profiles pr ON pr.id = b.user_id
GROUP BY b.category, b.user_id, pr.employee_code, pr.full_name, pr.email, pr.role
ORDER BY b.category, affected_items DESC, pr.employee_code;
