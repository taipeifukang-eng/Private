-- P1-D DEV-only fake store / employee compatibility cleanup.
-- Does not delete Auth users, profiles, roles, permissions, or role_permissions.
-- Use only in DEV when you want to remove the fake compatibility seed records.

WITH target_users AS (
  SELECT id, lower(email) AS email
  FROM auth.users
  WHERE lower(email) IN (
    'dev-ga-access@example.test',
    'dev-ga-view@example.test',
    'dev-ga-manage@example.test',
    'dev-full-admin@example.test'
  )
),
target_scopes AS (
  SELECT s.id AS store_id, tu.id AS user_id, x.role_type
  FROM (
    VALUES
      ('DEV001', 'dev-ga-access@example.test', 'store_manager'),
      ('DEV001', 'dev-ga-view@example.test', 'supervisor'),
      ('DEV002', 'dev-ga-view@example.test', 'supervisor'),
      ('DEV003', 'dev-ga-view@example.test', 'supervisor'),
      ('DEVHQ', 'dev-ga-manage@example.test', 'area_manager'),
      ('DEVHQ', 'dev-full-admin@example.test', 'area_manager')
  ) AS x(store_code, email, role_type)
  JOIN public.stores s ON s.store_code = x.store_code
  JOIN target_users tu ON tu.email = lower(x.email)
)
DELETE FROM public.store_managers sm
USING target_scopes ts
WHERE sm.store_id = ts.store_id
  AND sm.user_id = ts.user_id
  AND sm.role_type = ts.role_type;

DELETE FROM public.employee_movement_history emh
WHERE emh.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999')
  AND emh.notes = 'DEV fake seed onboarding record';

DELETE FROM public.store_employees se
WHERE se.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999');

DELETE FROM public.stores s
WHERE s.store_code IN ('DEV003', 'DEV004', 'DEVHQ');

SELECT
  'dev_fake_store_employee_cleanup' AS cleanup_name,
  (SELECT count(*) FROM public.store_employees se WHERE se.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999')) AS remaining_seed_employee_count,
  (SELECT count(*) FROM public.stores s WHERE s.store_code IN ('DEV003', 'DEV004', 'DEVHQ')) AS remaining_seed_extra_store_count;
