-- P1-D DEV-only fake store / employee compatibility seed verification.
-- Read-only checks. Run only after seed_dev_store_employee_compatibility.sql on DEV.

WITH expected_stores(store_code) AS (
  VALUES ('DEV001'), ('DEV002'), ('DEV003'), ('DEV004'), ('DEVHQ')
),
expected_users(email, employee_code) AS (
  VALUES
    ('dev-no-ga@example.test', 'DEV0001'),
    ('dev-ga-access@example.test', 'DEV0002'),
    ('dev-ga-view@example.test', 'DEV0003'),
    ('dev-ga-manage@example.test', 'DEV0004'),
    ('dev-full-admin@example.test', 'DEV9999')
),
expected_scopes(store_code, email, role_type) AS (
  VALUES
    ('DEV001', 'dev-ga-access@example.test', 'store_manager'),
    ('DEV001', 'dev-ga-view@example.test', 'supervisor'),
    ('DEV002', 'dev-ga-view@example.test', 'supervisor'),
    ('DEV003', 'dev-ga-view@example.test', 'supervisor'),
    ('DEVHQ', 'dev-ga-manage@example.test', 'area_manager'),
    ('DEVHQ', 'dev-full-admin@example.test', 'area_manager')
),
expected_permissions(code) AS (
  VALUES
    ('role.role.view'),
    ('user.user.view'),
    ('store.manage'),
    ('employee.manage'),
    ('monthly.status.view_own'),
    ('inspection.view_own'),
    ('inventory.result_analysis.view_own')
),
checks AS (
  SELECT
    'stores' AS check_name,
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=5 actual=%s', count(*)) AS details
  FROM expected_stores es
  JOIN public.stores s ON s.store_code = es.store_code
  WHERE s.is_active = true

  UNION ALL

  SELECT
    'profiles' AS check_name,
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=5 actual=%s', count(*)) AS details
  FROM expected_users eu
  JOIN public.profiles p ON p.employee_code = eu.employee_code
  WHERE lower(p.email) = eu.email

  UNION ALL

  SELECT
    'store_employees' AS check_name,
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=5 actual=%s', count(*)) AS details
  FROM expected_users eu
  JOIN public.store_employees se ON se.employee_code = eu.employee_code
  WHERE se.is_active = true

  UNION ALL

  SELECT
    'store_employee_no_duplicates' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('duplicate_employee_codes=%s', count(*)) AS details
  FROM (
    SELECT se.employee_code
    FROM public.store_employees se
    WHERE se.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999')
    GROUP BY se.employee_code
    HAVING count(*) > 1
  ) duplicated

  UNION ALL

  SELECT
    'store_manager_scopes' AS check_name,
    CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=6 actual=%s', count(*)) AS details
  FROM expected_scopes es
  JOIN public.stores s ON s.store_code = es.store_code
  JOIN auth.users u ON lower(u.email) = es.email
  JOIN public.store_managers sm
    ON sm.store_id = s.id
   AND sm.user_id = u.id
   AND sm.role_type = es.role_type

  UNION ALL

  SELECT
    'movement_history' AS check_name,
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=5 actual=%s', count(*)) AS details
  FROM expected_users eu
  JOIN public.employee_movement_history emh ON emh.employee_code = eu.employee_code
  WHERE emh.movement_type = 'onboarding'
    AND emh.notes = 'DEV fake seed onboarding record'

  UNION ALL

  SELECT
    'permission_references' AS check_name,
    CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=7 actual=%s', count(*)) AS details
  FROM expected_permissions ep
  JOIN public.permissions p ON p.code = ep.code
  WHERE p.is_active = true

  UNION ALL

  SELECT
    'dev_full_admin_permissions' AS check_name,
    CASE
      WHEN (
        SELECT count(*)
        FROM public.permissions p
        WHERE p.is_active = true
      ) = (
        SELECT count(*)
        FROM public.roles r
        JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'dev_full_admin'
          AND p.is_active = true
          AND rp.is_allowed = true
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format(
      'active_permissions=%s dev_full_admin_allowed=%s',
      (SELECT count(*) FROM public.permissions p WHERE p.is_active = true),
      (
        SELECT count(*)
        FROM public.roles r
        JOIN public.role_permissions rp ON rp.role_id = r.id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE r.code = 'dev_full_admin'
          AND p.is_active = true
          AND rp.is_allowed = true
      )
    ) AS details
)
SELECT *
FROM checks
ORDER BY check_name;
