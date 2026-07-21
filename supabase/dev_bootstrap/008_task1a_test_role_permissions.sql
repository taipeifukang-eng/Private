-- ============================================================
-- DEV Baseline 008 - Task 1A test role permissions
-- Run only after supabase/migration_general_affairs_category_foundation.sql.
-- Do not run in Production.
-- ============================================================

DO $$
DECLARE
  v_missing_permissions TEXT;
BEGIN
  WITH expected(code) AS (
    VALUES
      ('general_affairs.equipment_category.view'),
      ('general_affairs.equipment_category.manage'),
      ('general_affairs.facility_category.view'),
      ('general_affairs.facility_category.manage'),
      ('general_affairs.part_category.view'),
      ('general_affairs.part_category.manage')
  )
  SELECT string_agg(e.code, ', ' ORDER BY e.code)
  INTO v_missing_permissions
  FROM expected e
  LEFT JOIN public.permissions p ON p.code = e.code
  WHERE p.id IS NULL;

  IF v_missing_permissions IS NOT NULL THEN
    RAISE EXCEPTION 'Task 1A permissions not found. Run migration_general_affairs_category_foundation.sql first. Missing: %', v_missing_permissions;
  END IF;
END $$;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'general_affairs.equipment_category.view',
  'general_affairs.facility_category.view',
  'general_affairs.part_category.view'
)
WHERE r.code = 'dev_ga_category_view'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'general_affairs.equipment_category.manage',
  'general_affairs.facility_category.manage',
  'general_affairs.part_category.manage'
)
WHERE r.code = 'dev_ga_category_manage'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

