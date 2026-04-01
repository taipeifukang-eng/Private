-- 修正 RBAC 函式：admin 直接放行
-- 目的：避免 user_roles 資料短暫不同步時，管理員被誤判無權限

CREATE OR REPLACE FUNCTION has_permission(
  p_user_id UUID,
  p_permission_code VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_permission BOOLEAN := false;
  v_is_admin BOOLEAN := false;
BEGIN
  -- A) profiles.role = 'admin' 直接放行
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_user_id
      AND role = 'admin'
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN true;
  END IF;

  -- B) RBAC 角色權限檢查（兼容 admin/system_admin/admin_role）
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    INNER JOIN roles r ON r.id = ur.role_id
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND rp.is_allowed = true
      AND p.is_active = true
      AND (
        p.code = p_permission_code
        OR r.code IN ('admin', 'system_admin', 'admin_role')
      )
  ) INTO v_has_permission;

  RETURN v_has_permission;
END;
$$;

-- 驗證：確認函式存在
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'has_permission';
