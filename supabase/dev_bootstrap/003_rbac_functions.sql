-- ============================================================
-- DEV Baseline 003 - RBAC functions
-- Use only on a brand-new DEV Supabase project.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id UUID,
  p_permission_code VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL OR p_permission_code IS NULL OR btrim(p_permission_code) = '' THEN
    RETURN false;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN false;
  END IF;

  -- Admin bypass is RBAC-based only. No email whitelist and no profiles.role trust.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND r.is_active = true
      AND r.code = 'admin'
  ) INTO v_has_permission;

  IF v_has_permission THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND r.is_active = true
      AND rp.is_allowed = true
      AND p.is_active = true
      AND p.code = p_permission_code
  ) INTO v_has_permission;

  RETURN COALESCE(v_has_permission, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_code VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT public.has_permission(auth.uid(), p_permission_code);
$$;

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS TABLE(permission_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.code::VARCHAR
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    AND r.is_active = true
    AND rp.is_allowed = true
    AND p.is_active = true
  ORDER BY p.code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated;
