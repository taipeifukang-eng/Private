-- 唯讀檢查（pre_check）：活動專案查看權限調整，上線前請在正式區先跑。
-- 只有 SELECT，不會修改任何資料，也不會自動授權。
-- 對應 migration：supabase/migrations/20261103090000_campaign_view_scope.sql
-- 每段查詢獨立執行，結果請存檔給決策者確認。

-- ============================================================
-- A. 哪些角色持有 activity.campaign.view / view_own / view_all
--    （migration 會把「有 view 且沒有 view_all」的角色補上 view_own）
-- ============================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  r.is_active AS role_active,
  bool_or(p.code = 'activity.campaign.view'     AND rp.is_allowed) AS has_view,
  bool_or(p.code = 'activity.campaign.view_own' AND rp.is_allowed) AS has_view_own,
  bool_or(p.code = 'activity.campaign.view_all' AND rp.is_allowed) AS has_view_all,
  CASE
    WHEN bool_or(p.code = 'activity.campaign.view' AND rp.is_allowed)
     AND NOT bool_or(p.code = 'activity.campaign.view_all' AND rp.is_allowed)
     AND NOT bool_or(p.code = 'activity.campaign.view_own' AND rp.is_allowed)
    THEN 'migration 會補上 view_own'
    ELSE '不需補'
  END AS migration_action,
  (SELECT count(*) FROM public.user_roles ur
    WHERE ur.role_id = r.id AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS active_user_count
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE p.code IN ('activity.campaign.view', 'activity.campaign.view_own', 'activity.campaign.view_all')
GROUP BY r.id, r.code, r.name, r.is_active
ORDER BY r.code;

-- view_own 權限列是否存在、目前說明與啟用狀態
SELECT code, description, is_active
FROM public.permissions
WHERE code IN ('activity.campaign.view', 'activity.campaign.view_own', 'activity.campaign.view_all')
ORDER BY code;

-- ============================================================
-- B. 目前靠「部門／職稱身分」看活動、但角色沒有 view_all 的使用者
--    （新規則下，部門身分不再自動看全部，這些人改後會看不到，或只剩依任命身分的範圍）
--    判斷對照舊版 lib/campaign-access.ts：
--      營業主管   = department 以「營業」開頭且 job_title 為 經理／主管
--      盤點組     = department = 營業部-盤點組
--                   （改後：持 view_own 仍可看發布給盤點組的活動，範圍為全部門市）
--      行銷部     = department = 行銷部 且持 activity.management.access
--      營業部助理 = department = 營業部 且 job_title = 助理
-- ============================================================
WITH role_perm AS (
  SELECT
    ur.user_id,
    bool_or(p.code = 'activity.campaign.view_all' AND rp.is_allowed) AS has_view_all,
    bool_or(p.code = 'activity.campaign.view_own' AND rp.is_allowed) AS has_view_own,
    bool_or(p.code = 'activity.campaign.view'     AND rp.is_allowed) AS has_view,
    bool_or(p.code = 'activity.management.access' AND rp.is_allowed) AS has_mgmt_access
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id AND r.is_active = true
  LEFT JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  LEFT JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active = true
  WHERE ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
  GROUP BY ur.user_id
), appt AS (
  SELECT
    user_id,
    bool_or(role_type = 'supervisor')    AS appt_supervisor,
    bool_or(role_type = 'store_manager') AS appt_store_manager
  FROM public.store_managers
  GROUP BY user_id
)
SELECT
  pr.id AS user_id,
  pr.employee_code,
  pr.full_name,
  pr.department,
  pr.job_title,
  CASE
    WHEN pr.department LIKE '營業%' AND pr.job_title IN ('經理', '主管') THEN '營業主管'
    WHEN pr.department = '營業部-盤點組' THEN '盤點組'
    WHEN pr.department = '行銷部' AND COALESCE(rp.has_mgmt_access, false) THEN '行銷部'
    WHEN pr.department = '營業部' AND pr.job_title = '助理' THEN '營業部助理'
  END AS dept_identity,
  COALESCE(rp.has_view, false)          AS has_view,
  COALESCE(rp.has_view_own, false)      AS has_view_own,
  COALESCE(a.appt_supervisor, false)    AS appt_supervisor,
  COALESCE(a.appt_store_manager, false) AS appt_store_manager
FROM public.profiles pr
LEFT JOIN role_perm rp ON rp.user_id = pr.id
LEFT JOIN appt a ON a.user_id = pr.id
WHERE COALESCE(rp.has_view_all, false) = false
  AND (
    (pr.department LIKE '營業%' AND pr.job_title IN ('經理', '主管'))
    OR pr.department = '營業部-盤點組'
    OR (pr.department = '行銷部' AND COALESCE(rp.has_mgmt_access, false))
    OR (pr.department = '營業部' AND pr.job_title = '助理')
  )
  AND (COALESCE(rp.has_view, false) OR COALESCE(rp.has_view_own, false))
ORDER BY dept_identity, pr.department, pr.employee_code;

-- ============================================================
-- C. job_title 與 store_managers 任命不一致的人
--    （新規則身分一律以 store_managers 為準：職稱是店長／督導但沒有任命者，改後不再被視為店長／督導）
-- ============================================================
SELECT
  pr.id AS user_id,
  pr.employee_code,
  pr.full_name,
  pr.job_title,
  COALESCE(a.appt_supervisor, false)    AS appt_supervisor,
  COALESCE(a.appt_store_manager, false) AS appt_store_manager
FROM public.profiles pr
LEFT JOIN (
  SELECT user_id,
         bool_or(role_type = 'supervisor')    AS appt_supervisor,
         bool_or(role_type = 'store_manager') AS appt_store_manager
  FROM public.store_managers GROUP BY user_id
) a ON a.user_id = pr.id
WHERE (pr.job_title LIKE '%督導%' AND COALESCE(a.appt_supervisor, false) = false)
   OR (pr.job_title IN ('店長', '代理店長', '督導(代理店長)') AND COALESCE(a.appt_store_manager, false) = false)
ORDER BY pr.job_title, pr.employee_code;

-- ============================================================
-- D. store_managers.role_type 取值分布（確認只有 supervisor / store_manager）
-- ============================================================
SELECT role_type, count(*) AS rows, count(DISTINCT user_id) AS users
FROM public.store_managers
GROUP BY role_type
ORDER BY role_type;

-- ============================================================
-- E. 持有 view_own 的角色清單與各角色使用者數（特別注意 member）
--    member 多半是全員預設角色：保留 view_own 的話，所有員工都會取得活動檢視權限
--    （入口已加任命條件，RLS／API 也有發布閘門，但仍建議處理）。
--    建議：由使用者在正式區把 view_own 從 member 角色移除（migration 不會自動移除）。
-- ============================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  r.is_active AS role_active,
  (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur
    WHERE ur.role_id = r.id AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS active_user_count,
  CASE WHEN r.code = 'member'
       THEN '建議移除：member 為全員預設角色，持有 view_own 會讓所有員工取得活動檢視權限'
       ELSE '' END AS suggestion
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_allowed = true
JOIN public.permissions p ON p.id = rp.permission_id
WHERE p.code = 'activity.campaign.view_own'
ORDER BY (r.code = 'member') DESC, r.code;

-- member 角色的使用者數（對照全體在職使用者數，判斷是否為全員預設角色）
SELECT
  (SELECT count(DISTINCT ur.user_id)
     FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE r.code = 'member' AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS member_user_count,
  (SELECT count(*) FROM public.profiles) AS total_profile_count;

-- ============================================================
-- F. 會被 migration 正規化移除 view／view_own 的角色（已持有 view_all）
--    這些列會先備份到 _campaign_view_scope_backup（kind='removed_role_permission'），rollback 可還原。
-- ============================================================
SELECT r.code AS role_code, p.code AS permission_code, rp.is_allowed
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE p.code IN ('activity.campaign.view', 'activity.campaign.view_own')
  AND EXISTS (
    SELECT 1 FROM public.role_permissions ra
    JOIN public.permissions pa ON pa.id = ra.permission_id
    WHERE ra.role_id = rp.role_id AND pa.code = 'activity.campaign.view_all' AND ra.is_allowed = true
  )
ORDER BY r.code, p.code;

-- ============================================================
-- G. 店長／督導角色的 activity.* 權限（上線前必看）
--    store_manager_role、supervisor_role 是否持有 support_assign.edit、support_request.edit 很重要：
--    - support_request.edit 是 campaign_support_requests 的 RLS 寫入條件；
--    - support_assign.edit 是 campaign_support_staff／campaign_store_own_staff 的 RLS 寫入條件；
--    - 這兩者「不再」讓人繞過發布閘門讀草稿活動（只通過權限閘門）；
--    - 沒有對應權限的店長／督導，寫入 API 會回 403（RLS 也會擋）。
--    請確認這兩個角色的 activity.* 清單符合預期。
-- ============================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  r.is_active AS role_active,
  p.code AS permission_code,
  rp.is_allowed
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE r.code IN ('store_manager_role', 'supervisor_role')
  AND p.code LIKE 'activity.%'
ORDER BY r.code, p.code;

-- 這兩個角色是否「缺少」關鍵權限（has_* 為 false 代表沒有）
SELECT
  r.code AS role_code,
  COALESCE(bool_or(p.code = 'activity.support_request.edit' AND rp.is_allowed), false) AS has_support_request_edit,
  COALESCE(bool_or(p.code = 'activity.support_assign.edit'  AND rp.is_allowed), false) AS has_support_assign_edit,
  COALESCE(bool_or(p.code = 'activity.store_detail.edit'    AND rp.is_allowed), false) AS has_store_detail_edit,
  COALESCE(bool_or(p.code = 'activity.checklist.edit'       AND rp.is_allowed), false) AS has_checklist_edit,
  COALESCE(bool_or(p.code = 'activity.campaign.view_all'    AND rp.is_allowed), false) AS has_view_all
FROM public.roles r
LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
LEFT JOIN public.permissions p ON p.id = rp.permission_id
WHERE r.code IN ('store_manager_role', 'supervisor_role')
GROUP BY r.code
ORDER BY r.code;


-- ============================================================
-- F. store_manager_role / supervisor_role 目前的 activity.* 權限（上線前務必人工確認）
--    重點：這兩個角色是否持有 support_request.edit、support_assign.edit。
--    新規則下這些權限只是「權限閘門」，仍須有 view_own／view_all 且活動已發布給其身分才讀得到草稿以外的資料；
--    RLS 寫入 policy 仍只認 activity.manage／對應 edit 權，所以角色缺少該 edit 權時，店長／督導無法寫支援需求與支援人員。
-- ============================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  p.code AS permission_code,
  rp.is_allowed,
  p.is_active AS permission_active
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id
JOIN public.permissions p ON p.id = rp.permission_id
WHERE r.code IN ('store_manager_role', 'supervisor_role')
  AND p.code LIKE 'activity.%'
ORDER BY r.code, p.code;

-- 這兩個角色是否缺少下列關鍵權限（missing = true 代表沒有被允許的紀錄）
SELECT
  r.code AS role_code,
  k.code AS permission_code,
  NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id AND p.code = k.code AND rp.is_allowed = true
  ) AS missing
FROM public.roles r
CROSS JOIN (VALUES
  ('activity.support_request.edit'),
  ('activity.support_assign.edit'),
  ('activity.campaign.view_own'),
  ('activity.campaign.view'),
  ('activity.campaign.view_all')
) AS k(code)
WHERE r.code IN ('store_manager_role', 'supervisor_role')
ORDER BY r.code, k.code;

-- ============================================================
-- G. 「總部型」使用者：持有 support_request.edit／support_assign.edit／staff_overview.view，
--    但沒有任何 store_managers 任命，也沒有 view_own／舊 view／view_all。
--    新規則下他們讀不到門市子表資料（沒有可通過發布閘門的身分），寫入 API 也一律 403
--    （舊版未任命者可寫是輔助授權）。若這份清單有人，請決定：
--      a) 給他們 activity.campaign.view_all（可看全部，但仍不能寫門市子表，除非有 activity.manage／對應 edit 權或任命），或
--      b) 另開任務，在 API 與 RLS 同步做「未任命 support_*.edit 持有者且活動已發布」的明確路徑。
-- ============================================================
WITH role_perm AS (
  SELECT
    ur.user_id,
    array_agg(DISTINCT p.code) FILTER (
      WHERE rp.is_allowed AND p.code IN (
        'activity.support_request.edit', 'activity.support_assign.edit', 'activity.staff_overview.view')
    ) AS aux_perms,
    bool_or(p.code IN ('activity.campaign.view_all', 'activity.campaign.view_own', 'activity.campaign.view')
            AND rp.is_allowed) AS has_any_view,
    bool_or(p.code IN ('activity.manage', 'activity.campaign.edit', 'activity.store_detail.edit',
                       'activity.checklist.edit', 'activity.equipment_trip.edit')
            AND rp.is_allowed) AS has_edit_bypass
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id AND r.is_active = true
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active = true
  WHERE ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
  GROUP BY ur.user_id
)
SELECT
  pr.id AS user_id,
  pr.employee_code,
  pr.full_name,
  pr.department,
  pr.job_title,
  rp.aux_perms,
  COALESCE(rp.has_edit_bypass, false) AS has_edit_bypass
FROM role_perm rp
JOIN public.profiles pr ON pr.id = rp.user_id
WHERE rp.aux_perms IS NOT NULL
  AND COALESCE(rp.has_any_view, false) = false
  AND NOT EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = rp.user_id)
ORDER BY pr.department, pr.employee_code;


-- ============================================================
-- H. 持有 activity.management.access，但沒有 view_own／舊 view／view_all／activity.manage 的角色與使用者人數
--    activity.management.access 保留（其他功能與行銷部等部門仍使用），migration 不移除也不授權。
--    這些角色的使用者在新規則下仍不會因它而看到活動資料（活動檢視要 view_own／view_all）；
--    若其中有人需要看活動，請另外決定是否補 view_own／view_all。
-- ============================================================
SELECT
  r.code AS role_code,
  r.name AS role_name,
  r.is_active AS role_active,
  (SELECT count(*) FROM public.user_roles ur
    WHERE ur.role_id = r.id AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS active_user_count
FROM public.roles r
WHERE EXISTS (
    SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id AND rp.is_allowed = true AND p.code = 'activity.management.access')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = r.id AND rp.is_allowed = true
      AND p.code IN ('activity.campaign.view_own', 'activity.campaign.view', 'activity.campaign.view_all', 'activity.manage'))
ORDER BY r.code;

-- 使用者層級（跨角色合併判斷）：
SELECT count(*) AS users_with_access_but_no_view_scope
FROM (
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id AND r.is_active = true
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed = true
  JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active = true
  WHERE ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())
  GROUP BY ur.user_id
  HAVING bool_or(p.code = 'activity.management.access')
     AND NOT bool_or(p.code IN ('activity.campaign.view_own', 'activity.campaign.view', 'activity.campaign.view_all', 'activity.manage'))
) x;
