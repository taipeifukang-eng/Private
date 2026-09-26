-- ============================================================
-- P1-J - Production legacy RBAC RPC compatibility
-- Purpose:
--   Add two legacy RPCs referenced by the existing app code so DEV can run
--   the same RBAC/user-assignment and products-master flows as Production.
--
-- Safety:
--   - No data copy.
--   - No Production project ref or secrets.
--   - Authorization remains RBAC based.
--   - Legacy profile display fields are not used for authorization.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.profiles';
  END IF;

  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.roles';
  END IF;

  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.permissions';
  END IF;

  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.user_roles';
  END IF;

  IF to_regprocedure('public.has_permission(uuid, character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.has_permission(uuid, varchar)';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.current_user_has_permission(varchar)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_user_permission(
  p_user_id uuid,
  p_permission_code varchar
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_user_id IS NULL
    OR p_permission_code IS NULL
    OR btrim(p_permission_code) = ''
    OR auth.uid() IS NULL
    OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN false;
  END IF;

  RETURN public.has_permission(p_user_id, p_permission_code);
END;
$$;

COMMENT ON FUNCTION public.check_user_permission(uuid, varchar)
IS 'Legacy compatibility wrapper for checking the current authenticated user permission through RBAC.';

CREATE OR REPLACE FUNCTION public.get_all_employees_for_rbac()
RETURNS TABLE (
  user_id uuid,
  employee_code varchar,
  employee_name varchar,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.current_user_has_permission('user.user.view')
    OR public.current_user_has_permission('user.user.edit')
    OR public.current_user_has_permission('user.user.create')
    OR public.current_user_has_permission('user.user.delete')
    OR public.current_user_has_permission('user.user.change_role')
    OR public.current_user_has_permission('role.user_role.view')
    OR public.current_user_has_permission('role.user_role.assign')
    OR public.current_user_has_permission('role.user_role.revoke')
    OR public.current_user_has_permission('role.role.view')
  ) THEN
    RETURN;
  END IF;

  IF to_regclass('public.store_employees') IS NULL THEN
    RETURN QUERY
    SELECT
      p.id AS user_id,
      NULLIF(btrim(p.employee_code), '')::varchar AS employee_code,
      COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), p.id::text)::varchar AS employee_name,
      p.email::text AS email
    FROM public.profiles p
    WHERE p.id IS NOT NULL
      AND (
        NULLIF(btrim(p.employee_code), '') IS NOT NULL
        OR NULLIF(btrim(p.email), '') IS NOT NULL
      )
    ORDER BY employee_code NULLS LAST, employee_name, email;

    RETURN;
  END IF;

  RETURN QUERY
  WITH profile_employees AS (
    SELECT
      p.id AS user_id,
      NULLIF(btrim(p.employee_code), '')::varchar AS employee_code,
      COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), p.id::text)::varchar AS employee_name,
      p.email::text AS email,
      1 AS source_priority
    FROM public.profiles p
    WHERE p.id IS NOT NULL
      AND (
        NULLIF(btrim(p.employee_code), '') IS NOT NULL
        OR NULLIF(btrim(p.email), '') IS NOT NULL
      )
  ),
  store_employee_rows AS (
    SELECT
      se.user_id,
      NULLIF(btrim(se.employee_code), '')::varchar AS employee_code,
      COALESCE(NULLIF(btrim(se.employee_name), ''), NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), se.user_id::text)::varchar AS employee_name,
      p.email::text AS email,
      2 AS source_priority
    FROM public.store_employees se
    LEFT JOIN public.profiles p ON p.id = se.user_id
    WHERE se.user_id IS NOT NULL
      AND (
        NULLIF(btrim(se.employee_code), '') IS NOT NULL
        OR NULLIF(btrim(p.email), '') IS NOT NULL
      )
  ),
  combined AS (
    SELECT * FROM profile_employees
    UNION ALL
    SELECT * FROM store_employee_rows
  )
  SELECT DISTINCT ON (c.user_id)
    c.user_id,
    c.employee_code,
    c.employee_name,
    c.email
  FROM combined c
  ORDER BY c.user_id, c.source_priority, c.employee_code NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_all_employees_for_rbac()
IS 'Legacy RBAC user-search compatibility function. Returns basic employee identity for authorized RBAC managers only.';

REVOKE ALL ON FUNCTION public.check_user_permission(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_user_permission(uuid, varchar) FROM anon;
REVOKE ALL ON FUNCTION public.check_user_permission(uuid, varchar) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_permission(uuid, varchar) TO authenticated;

REVOKE ALL ON FUNCTION public.get_all_employees_for_rbac() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_all_employees_for_rbac() FROM anon;
REVOKE ALL ON FUNCTION public.get_all_employees_for_rbac() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_employees_for_rbac() TO authenticated;
