-- P1-C Production core compatibility catalog test.
-- Run only on confirmed DEV after migration_production_core_compatibility.sql is applied.

WITH
expected_tables(table_name) AS (
  VALUES
    ('permission_logs'),
    ('store_employees'),
    ('employee_movement_history'),
    ('store_relocation_history'),
    ('store_transfer_requests'),
    ('templates'),
    ('assignments'),
    ('assignment_collaborators'),
    ('logs')
),
missing_tables AS (
  SELECT e.table_name
  FROM expected_tables e
  WHERE to_regclass('public.' || e.table_name) IS NULL
),
expected_permissions(code) AS (
  VALUES
    ('role.role.view'),
    ('role.role.create'),
    ('role.role.edit'),
    ('role.role.delete'),
    ('role.permission.view'),
    ('role.permission.assign'),
    ('role.user_role.view'),
    ('role.user_role.assign'),
    ('role.user_role.revoke'),
    ('user.user.view'),
    ('user.user.create'),
    ('user.user.edit'),
    ('user.user.delete'),
    ('user.user.change_role'),
    ('store.manage'),
    ('store.manager.assign'),
    ('store.supervisor.assign'),
    ('employee.manage'),
    ('employee.movement.manage'),
    ('employee.store_transfer.create'),
    ('employee.store_transfer.confirm'),
    ('task.view_own'),
    ('task.manage'),
    ('task.view_archived'),
    ('dashboard.view'),
    ('inventory.result_analysis.view_own'),
    ('inspection.view_own'),
    ('inspection.view_store'),
    ('inspection.view_all'),
    ('activity.manage'),
    ('cross_dept.maintenance.view_all'),
    ('cross_dept.maintenance.submit'),
    ('cross_dept.maintenance.update')
),
missing_permissions AS (
  SELECT e.code
  FROM expected_permissions e
  LEFT JOIN public.permissions p ON p.code = e.code AND p.is_active = true
  WHERE p.id IS NULL
),
rls_disabled AS (
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN expected_tables e ON e.table_name = c.relname
  WHERE n.nspname = 'public'
    AND c.relrowsecurity IS NOT TRUE
),
anon_table_grants AS (
  SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (SELECT table_name FROM expected_tables)
    AND grantee = 'anon'
),
helper_security AS (
  SELECT
    count(*) FILTER (
      WHERE proname IN ('p1c_touch_updated_at', 'p1c_assignment_is_visible')
        AND prosecdef IS TRUE
        AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'
    ) AS safe_count,
    count(*) AS total_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('p1c_touch_updated_at', 'p1c_assignment_is_visible')
),
updated_at_triggers AS (
  SELECT count(*) AS trigger_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND trigger_name IN ('trg_store_employees_updated_at', 'trg_employee_movement_history_updated_at')
),
admin_missing_permissions AS (
  SELECT p.code
  FROM public.permissions p
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.roles r
      JOIN public.role_permissions rp ON rp.role_id = r.id
      WHERE r.code IN ('admin', 'dev_full_admin')
        AND rp.permission_id = p.id
        AND rp.is_allowed = true
    )
),
results AS (
  SELECT
    1 AS sort_order,
    'tables' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    COALESCE(string_agg(table_name, ', ' ORDER BY table_name), '-') AS details
  FROM missing_tables

  UNION ALL

  SELECT
    2,
    'permission_reference',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(string_agg(code, ', ' ORDER BY code), '-')
  FROM missing_permissions

  UNION ALL

  SELECT
    3,
    'rls_enabled',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(string_agg(relname, ', ' ORDER BY relname), '-')
  FROM rls_disabled

  UNION ALL

  SELECT
    4,
    'no_anon_table_grants',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    count(*)::text
  FROM anon_table_grants

  UNION ALL

  SELECT
    5,
    'helper_security',
    CASE WHEN safe_count = 2 AND total_count = 2 THEN 'PASS' ELSE 'FAIL' END,
    ('safe=' || safe_count || ', total=' || total_count)
  FROM helper_security

  UNION ALL

  SELECT
    6,
    'updated_at_triggers',
    CASE WHEN trigger_count = 2 THEN 'PASS' ELSE 'FAIL' END,
    trigger_count::text
  FROM updated_at_triggers

  UNION ALL

  SELECT
    7,
    'admin_full_permissions',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(string_agg(code, ', ' ORDER BY code), '-')
  FROM admin_missing_permissions
)
SELECT check_name, result, details
FROM results
ORDER BY sort_order;

