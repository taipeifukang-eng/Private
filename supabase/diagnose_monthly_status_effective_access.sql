-- Read-only diagnosis for one user's effective monthly-status store scope.
-- Current investigation target: FK0791 李玹瑩.
-- Replace FK0791 when diagnosing another employee, then run the full query.

WITH params AS (
  SELECT upper(btrim('FK0791'))::text AS employee_code
),
target AS (
  SELECT p.id, p.employee_code, p.full_name, p.email, p.role AS profile_role
  FROM public.profiles p
  JOIN params input ON upper(btrim(p.employee_code)) = input.employee_code
),
active_roles AS (
  SELECT
    ur.user_id,
    ur.expires_at,
    r.id AS role_id,
    r.code AS role_code,
    r.name AS role_name
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN target t ON t.id = ur.user_id
  WHERE ur.is_active = true
    AND r.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
),
permission_sources AS (
  SELECT
    ar.user_id,
    ar.role_code,
    ar.role_name,
    p.code AS permission_code
  FROM active_roles ar
  JOIN public.role_permissions rp
    ON rp.role_id = ar.role_id
   AND rp.is_allowed = true
  JOIN public.permissions p
    ON p.id = rp.permission_id
   AND p.is_active = true
  WHERE p.code IN ('monthly.status.view_own', 'monthly.status.view_all')
),
managed_stores AS (
  SELECT
    sm.user_id,
    s.id AS store_id,
    s.store_code,
    COALESCE(s.short_name, s.store_name) AS store_name
  FROM public.store_managers sm
  JOIN public.stores s ON s.id = sm.store_id
  JOIN target t ON t.id = sm.user_id
)
SELECT
  t.employee_code,
  t.full_name,
  t.email,
  t.profile_role,
  (
    t.profile_role = 'admin'
    OR EXISTS (
      SELECT 1
      FROM active_roles ar
      WHERE ar.role_code IN (
        'admin', 'system_admin', 'admin_role', 'full_admin',
        'full_admin_role', 'dev_full_admin', 'owner', 'owner_role'
      )
    )
  ) AS app_admin_bypass,
  EXISTS (
    SELECT 1 FROM permission_sources ps
    WHERE ps.permission_code = 'monthly.status.view_all'
  ) AS effective_view_all,
  EXISTS (
    SELECT 1 FROM permission_sources ps
    WHERE ps.permission_code = 'monthly.status.view_own'
  ) AS effective_view_own,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'role_code', ps.role_code,
        'role_name', ps.role_name,
        'permission', ps.permission_code
      )
      ORDER BY ps.role_name, ps.permission_code
    )
    FROM permission_sources ps
  ), '[]'::jsonb) AS permission_sources,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'store_code', ms.store_code,
        'store_name', ms.store_name
      )
      ORDER BY ms.store_code
    )
    FROM managed_stores ms
  ), '[]'::jsonb) AS managed_stores
FROM target t;
