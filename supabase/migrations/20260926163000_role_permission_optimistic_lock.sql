-- Prevent one administrator from silently overwriting another administrator's
-- newer role-permission changes.

DROP FUNCTION IF EXISTS public.replace_role_permissions(uuid, uuid[], uuid);

CREATE FUNCTION public.replace_role_permissions(
  p_role_id uuid,
  p_permission_ids uuid[],
  p_expected_permission_ids uuid[],
  p_created_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_permission_ids uuid[];
  v_expected_permission_ids uuid[];
  v_current_permission_ids uuid[];
  v_inserted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.roles
    WHERE id = p_role_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT permission_id ORDER BY permission_id), ARRAY[]::uuid[])
  INTO v_permission_ids
  FROM unnest(COALESCE(p_permission_ids, ARRAY[]::uuid[])) AS permission_id;

  SELECT COALESCE(array_agg(DISTINCT permission_id ORDER BY permission_id), ARRAY[]::uuid[])
  INTO v_expected_permission_ids
  FROM unnest(COALESCE(p_expected_permission_ids, ARRAY[]::uuid[])) AS permission_id;

  SELECT COALESCE(array_agg(permission_id ORDER BY permission_id), ARRAY[]::uuid[])
  INTO v_current_permission_ids
  FROM public.role_permissions
  WHERE role_id = p_role_id
    AND is_allowed = true;

  IF v_current_permission_ids IS DISTINCT FROM v_expected_permission_ids THEN
    RAISE EXCEPTION 'ROLE_PERMISSIONS_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_permission_ids) AS requested(permission_id)
    LEFT JOIN public.permissions permission
      ON permission.id = requested.permission_id
     AND permission.is_active = true
    WHERE permission.id IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PERMISSION';
  END IF;

  DELETE FROM public.role_permissions
  WHERE role_id = p_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id, is_allowed, created_by)
  SELECT p_role_id, permission_id, true, p_created_by
  FROM unnest(v_permission_ids) AS permission_id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_role_permissions(uuid, uuid[], uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_role_permissions(uuid, uuid[], uuid[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public.replace_role_permissions(uuid, uuid[], uuid[], uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_role_permissions(uuid, uuid[], uuid[], uuid) TO service_role;

COMMENT ON FUNCTION public.replace_role_permissions(uuid, uuid[], uuid[], uuid)
IS 'Atomically replaces role permissions when the caller snapshot still matches; service-role only.';

NOTIFY pgrst, 'reload schema';
