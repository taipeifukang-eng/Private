-- P1-D DEV-only fake store / employee compatibility seed.
-- Do not run in Production. Does not create Auth users.
-- Requires P1-C production core compatibility schema.

DO $$
DECLARE
  v_missing_emails text;
BEGIN
  IF to_regclass('public.store_employees') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.store_employees. Apply P1-C first.';
  END IF;

  IF to_regclass('public.employee_movement_history') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.employee_movement_history. Apply P1-C first.';
  END IF;

  WITH expected(email) AS (
    VALUES
      ('dev-no-ga@example.test'),
      ('dev-ga-access@example.test'),
      ('dev-ga-view@example.test'),
      ('dev-ga-manage@example.test'),
      ('dev-full-admin@example.test')
  )
  SELECT string_agg(e.email, ', ' ORDER BY e.email)
  INTO v_missing_emails
  FROM expected e
  LEFT JOIN auth.users u ON lower(u.email) = lower(e.email)
  WHERE u.id IS NULL;

  IF v_missing_emails IS NOT NULL THEN
    RAISE EXCEPTION 'Missing DEV Auth users. Create these fake DEV users first: %', v_missing_emails;
  END IF;
END $$;

INSERT INTO public.stores (
  store_code,
  store_name,
  short_name,
  address,
  phone,
  hr_store_code,
  manager_name,
  is_active,
  is_franchise
)
VALUES
  ('DEV001', 'DEV 測試門市一', 'DEV一店', 'DEV fake address 001', '02-DEV-0001', 'DEV-HR-001', 'DEV 店長一', true, false),
  ('DEV002', 'DEV 測試門市二', 'DEV二店', 'DEV fake address 002', '02-DEV-0002', 'DEV-HR-002', 'DEV 店長二', true, false),
  ('DEV003', 'DEV 測試門市三', 'DEV三店', 'DEV fake address 003', '02-DEV-0003', 'DEV-HR-003', 'DEV 店長三', true, false),
  ('DEV004', 'DEV 測試門市四', 'DEV四店', 'DEV fake address 004', '02-DEV-0004', 'DEV-HR-004', 'DEV 店長四', true, true),
  ('DEVHQ', 'DEV 測試總部', 'DEV總部', 'DEV fake headquarters', '02-DEV-9999', 'DEV-HQ', 'DEV 總部管理', true, false)
ON CONFLICT (store_code) DO UPDATE SET
  store_name = EXCLUDED.store_name,
  short_name = EXCLUDED.short_name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  hr_store_code = EXCLUDED.hr_store_code,
  manager_name = EXCLUDED.manager_name,
  is_active = true,
  is_franchise = EXCLUDED.is_franchise;

WITH desired_users AS (
  SELECT
    u.id AS user_id,
    u.email,
    d.full_name,
    d.employee_code,
    d.department,
    d.job_title,
    d.profile_role,
    d.store_code,
    d.position,
    d.current_position,
    d.employment_type,
    d.is_pharmacist,
    d.employment_status
  FROM (
    VALUES
      ('dev-no-ga@example.test', 'DEV 無權限使用者', 'DEV0001', 'DEV 測試門市部', '測試門市人員', 'member', 'DEV002', '門市人員', '門市人員', 'full_time', false, 'active'),
      ('dev-ga-access@example.test', 'DEV 總務入口使用者', 'DEV0002', 'DEV 測試門市部', '測試店長', 'member', 'DEV001', '店長', '店長', 'full_time', false, 'active'),
      ('dev-ga-view@example.test', 'DEV 分類檢視使用者', 'DEV0003', 'DEV 測試營運部', '測試督導', 'member', 'DEVHQ', '督導', '督導', 'full_time', false, 'active'),
      ('dev-ga-manage@example.test', 'DEV 分類管理使用者', 'DEV0004', 'DEV 測試總務部', '測試總務', 'member', 'DEVHQ', '總務', '總務', 'full_time', false, 'active'),
      ('dev-full-admin@example.test', 'DEV Full Admin', 'DEV9999', 'DEV 測試系統部', 'DEV 全功能管理員', 'admin', 'DEVHQ', '系統管理員', '系統管理員', 'full_time', false, 'active')
  ) AS d(email, full_name, employee_code, department, job_title, profile_role, store_code, position, current_position, employment_type, is_pharmacist, employment_status)
  JOIN auth.users u ON lower(u.email) = lower(d.email)
),
upsert_profiles AS (
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    department,
    job_title,
    employee_code
  )
  SELECT
    user_id,
    email,
    full_name,
    profile_role,
    department,
    job_title,
    employee_code
  FROM desired_users
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    job_title = EXCLUDED.job_title,
    employee_code = EXCLUDED.employee_code
  RETURNING id
),
updated_employees AS (
  UPDATE public.store_employees se
  SET
    store_id = s.id,
    user_id = du.user_id,
    employee_name = du.full_name,
    position = du.position,
    current_position = du.current_position,
    employment_type = du.employment_type,
    is_pharmacist = du.is_pharmacist,
    is_active = true,
    employment_status = du.employment_status,
    last_movement_type = 'onboarding',
    last_movement_date = DATE '2026-01-01'
  FROM desired_users du
  JOIN public.stores s ON s.store_code = du.store_code
  WHERE se.employee_code = du.employee_code
  RETURNING se.employee_code
)
INSERT INTO public.store_employees (
  store_id,
  user_id,
  employee_code,
  employee_name,
  position,
  current_position,
  employment_type,
  is_pharmacist,
  is_active,
  start_date,
  employment_status,
  last_movement_type,
  last_movement_date
)
SELECT
  s.id,
  du.user_id,
  du.employee_code,
  du.full_name,
  du.position,
  du.current_position,
  du.employment_type,
  du.is_pharmacist,
  true,
  DATE '2026-01-01',
  du.employment_status,
  'onboarding',
  DATE '2026-01-01'
FROM desired_users du
JOIN public.stores s ON s.store_code = du.store_code
WHERE NOT EXISTS (
  SELECT 1
  FROM public.store_employees se
  WHERE se.employee_code = du.employee_code
);

INSERT INTO public.employee_movement_history (
  employee_code,
  employee_name,
  store_id,
  movement_date,
  movement_type,
  new_value,
  notes
)
SELECT
  se.employee_code,
  se.employee_name,
  se.store_id,
  DATE '2026-01-01',
  'onboarding',
  se.current_position,
  'DEV fake seed onboarding record'
FROM public.store_employees se
WHERE se.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999')
  AND NOT EXISTS (
    SELECT 1
    FROM public.employee_movement_history emh
    WHERE emh.employee_code = se.employee_code
      AND emh.movement_type = 'onboarding'
      AND emh.movement_date = DATE '2026-01-01'
      AND emh.notes = 'DEV fake seed onboarding record'
  );

WITH users AS (
  SELECT id, lower(email) AS email
  FROM auth.users
  WHERE lower(email) IN (
    'dev-ga-access@example.test',
    'dev-ga-view@example.test',
    'dev-ga-manage@example.test',
    'dev-full-admin@example.test'
  )
),
scopes AS (
  SELECT s.id AS store_id, u.id AS user_id, x.role_type, x.is_primary
  FROM (
    VALUES
      ('DEV001', 'dev-ga-access@example.test', 'store_manager', true),
      ('DEV001', 'dev-ga-view@example.test', 'supervisor', true),
      ('DEV002', 'dev-ga-view@example.test', 'supervisor', false),
      ('DEV003', 'dev-ga-view@example.test', 'supervisor', false),
      ('DEVHQ', 'dev-ga-manage@example.test', 'area_manager', true),
      ('DEVHQ', 'dev-full-admin@example.test', 'area_manager', true)
  ) AS x(store_code, email, role_type, is_primary)
  JOIN public.stores s ON s.store_code = x.store_code
  JOIN users u ON u.email = lower(x.email)
)
INSERT INTO public.store_managers (store_id, user_id, role_type, is_primary)
SELECT store_id, user_id, role_type, is_primary
FROM scopes
ON CONFLICT (store_id, user_id, role_type) DO UPDATE SET
  is_primary = EXCLUDED.is_primary;

-- Keep DEV admin broad permissions current after P1-C permissions were added.
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'dev_full_admin')
  AND p.is_active = true
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

SELECT
  'dev_fake_store_employee_seed' AS seed_name,
  count(DISTINCT s.id) FILTER (WHERE s.store_code LIKE 'DEV%') AS dev_store_count,
  count(DISTINCT se.id) FILTER (WHERE se.employee_code IN ('DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999')) AS dev_employee_count,
  count(DISTINCT sm.id) AS dev_scope_count
FROM public.stores s
LEFT JOIN public.store_employees se ON se.store_id = s.id
LEFT JOIN public.store_managers sm ON sm.store_id = s.id
WHERE s.store_code LIKE 'DEV%';
