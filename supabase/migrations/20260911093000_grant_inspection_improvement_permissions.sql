-- Ensure inspection improvement permissions exist and are granted to admin-like roles.
-- This repairs production roles that were created before improvement-specific permissions existed.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.permissions';
  END IF;

  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.roles';
  END IF;

  IF to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.role_permissions';
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('inspection', 'improvement', 'inspection.improvement.view_all', 'view_all', '查看全部待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.view_own', 'view_own', '查看自己巡店建立的待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.view_own_store', 'view_own_store', '查看自己負責門市待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.manage', 'manage', '管理自己範圍內的待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.submit', 'submit', '提交待改善改善回報', true)
ON CONFLICT (code) DO UPDATE
SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'inspection.improvement.view_all',
  'inspection.improvement.view_own',
  'inspection.improvement.view_own_store',
  'inspection.improvement.manage',
  'inspection.improvement.submit'
)
WHERE r.code IN (
  'admin',
  'system_admin',
  'admin_role',
  'full_admin',
  'full_admin_role',
  'dev_full_admin',
  'owner',
  'owner_role'
)
AND r.is_active = true
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = true;

NOTIFY pgrst, 'reload schema';
