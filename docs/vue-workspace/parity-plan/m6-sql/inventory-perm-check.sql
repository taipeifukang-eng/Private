-- ============================================================================
-- 盤點匯入／刪除權限上線前檢查（唯讀；2026-11-22 盤點權限問卷 inv-perm-ai-cap）
-- ----------------------------------------------------------------------------
-- 用途：上線前由老闆或 DBA 在「正式區」的 SQL Editor 手動執行。全部只有 SELECT，不修改任何資料。
-- 背景：匯入盤點結果改為只認 inventory.result_analysis.import、刪除只認 inventory.result_analysis.delete；
--       inventory.inventory.view／access、inventory.result_analysis.view_own、inventory.manage 都只能檢視。
--       上線後原本靠這些權限「順便」能匯入、刪除的人會失去這兩個動作，請先確認真正需要的人已被授與專屬權限。
-- 計算方式對齊正式區 has_permission 語意：只看 user_roles（is_active、未過期）與 role_permissions.is_allowed，
--       不檢查 roles.is_active；管理員（profiles.role = 'admin'）另由應用層放行，不在這些計數內，另列於查詢 4。
-- 本檔不要在 DEV 以外自動執行；也不得拿來改權限，授權請走正常的角色管理流程。
-- ============================================================================

-- 查詢 1：每個角色的代碼、名稱、啟用狀態，以及它是否含有盤點相關權限，與持有此角色（有效）的使用者數
SELECT
  r.code                                                   AS role_code,
  r.name                                                   AS role_name,
  r.is_active                                              AS role_active,
  bool_or(p.code = 'inventory.result_analysis.import')     AS has_import,
  bool_or(p.code = 'inventory.result_analysis.delete')     AS has_delete,
  bool_or(p.code = 'inventory.manage')                     AS has_manage,
  bool_or(p.code IN ('inventory.inventory.view', 'inventory.inventory.access', 'inventory.result_analysis.view_own')) AS has_view,
  (
    SELECT count(DISTINCT ur.user_id)
    FROM public.user_roles ur
    WHERE ur.role_id = r.id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  )                                                        AS active_users
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_allowed = true
JOIN public.permissions p       ON p.id = rp.permission_id
WHERE p.code IN (
  'inventory.result_analysis.import',
  'inventory.result_analysis.delete',
  'inventory.manage',
  'inventory.inventory.view',
  'inventory.inventory.access',
  'inventory.result_analysis.view_own'
)
GROUP BY r.id, r.code, r.name, r.is_active
ORDER BY r.code;

-- 查詢 2：各權限實際有幾位使用者（去重；有效的 user_roles、角色權限 is_allowed = true、不檢查 roles.is_active）
SELECT
  p.code                                AS permission_code,
  count(DISTINCT ur.user_id)            AS user_count
FROM public.permissions p
JOIN public.role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed = true
JOIN public.user_roles ur       ON ur.role_id = rp.role_id
                               AND ur.is_active = true
                               AND (ur.expires_at IS NULL OR ur.expires_at > now())
WHERE p.code IN (
  'inventory.result_analysis.import',
  'inventory.result_analysis.delete',
  'inventory.manage',
  'inventory.inventory.view',
  'inventory.inventory.access',
  'inventory.result_analysis.view_own'
)
GROUP BY p.code
ORDER BY p.code;

-- 查詢 3：上線後會「失去匯入或刪除」的人（目前有檢視類權限或 inventory.manage，但沒有對應的專屬權限）
-- 這份名單請老闆逐一確認：真的需要匯入、刪除的人要先補授與專屬權限，其餘就是預期中的「只能看」。
WITH held AS (
  SELECT DISTINCT ur.user_id, p.code
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed = true
  JOIN public.permissions p       ON p.id = rp.permission_id
  WHERE ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
    AND p.code IN (
      'inventory.result_analysis.import',
      'inventory.result_analysis.delete',
      'inventory.manage',
      'inventory.inventory.view',
      'inventory.inventory.access'
    )
), per_user AS (
  SELECT
    user_id,
    bool_or(code IN ('inventory.manage', 'inventory.inventory.view', 'inventory.inventory.access')) AS had_legacy_import_delete,
    bool_or(code = 'inventory.result_analysis.import') AS has_import,
    bool_or(code = 'inventory.result_analysis.delete') AS has_delete
  FROM held
  GROUP BY user_id
)
SELECT
  pr.employee_code,
  pr.full_name,
  pr.role                                         AS profile_role,
  (pu.had_legacy_import_delete AND NOT pu.has_import) AS loses_import,
  (pu.had_legacy_import_delete AND NOT pu.has_delete) AS loses_delete
FROM per_user pu
JOIN public.profiles pr ON pr.id = pu.user_id
WHERE pu.had_legacy_import_delete
  AND (NOT pu.has_import OR NOT pu.has_delete)
ORDER BY pr.role, pr.employee_code;

-- 查詢 4：管理員（應用層後備，永遠可匯入、刪除）人數，供對照
SELECT count(*) AS admin_profiles FROM public.profiles WHERE role = 'admin';
