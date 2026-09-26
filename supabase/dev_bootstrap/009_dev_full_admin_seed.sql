-- ============================================================
-- DEV Baseline 009 - Full admin seed
--
-- Use only in a DEV Supabase project for manual UI exploration.
-- Do not run in Production.
--
-- Before running:
--   1. Create this Auth user in DEV Dashboard:
--      dev-full-admin@example.test
--   2. Run baseline 001-008 and any feature migrations you want this
--      DEV admin to see.
--
-- This file intentionally grants every currently active permission to the
-- DEV admin role so legacy UI permission lists can show all menus.
-- Re-run this file after adding new DEV permissions.
-- ============================================================

DO $$
DECLARE
  v_admin_user_id UUID;
  v_admin_role_id UUID;
BEGIN
  SELECT id
  INTO v_admin_user_id
  FROM auth.users
  WHERE lower(email) = lower('dev-full-admin@example.test');

  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'DEV Auth user not found. Create dev-full-admin@example.test in Authentication first.';
  END IF;

  SELECT id
  INTO v_admin_role_id
  FROM public.roles
  WHERE code = 'admin'
    AND is_active = true;

  IF v_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'DEV admin role not found. Run 006_dev_base_seed.sql first.';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    department,
    job_title,
    employee_code
  )
  VALUES (
    v_admin_user_id,
    'dev-full-admin@example.test',
    'DEV Full Admin',
    'admin',
    'DEV 測試部門',
    'DEV 全功能管理員',
    'DEV9999'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    job_title = EXCLUDED.job_title,
    employee_code = EXCLUDED.employee_code;

  INSERT INTO public.user_roles (user_id, role_id, employee_code, is_active)
  VALUES (v_admin_user_id, v_admin_role_id, 'DEV9999', true)
  ON CONFLICT (user_id, role_id) DO UPDATE SET
    employee_code = EXCLUDED.employee_code,
    is_active = true,
    expires_at = NULL;

  INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
  SELECT v_admin_role_id, p.id, true
  FROM public.permissions p
  WHERE p.is_active = true
  ON CONFLICT (role_id, permission_id) DO UPDATE SET
    is_allowed = true;
END $$;

-- Verification: should return one row with permission_count > 0.
SELECT
  u.email,
  pr.role AS legacy_profile_role,
  r.code AS rbac_role_code,
  count(rp.permission_id) FILTER (WHERE rp.is_allowed = true) AS permission_count
FROM auth.users u
JOIN public.profiles pr ON pr.id = u.id
JOIN public.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
JOIN public.roles r ON r.id = ur.role_id
LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
WHERE lower(u.email) = lower('dev-full-admin@example.test')
  AND r.code = 'admin'
GROUP BY u.email, pr.role, r.code;
