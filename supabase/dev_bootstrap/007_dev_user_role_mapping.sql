-- ============================================================
-- DEV Baseline 007 - Auth user to DEV role mapping
-- Use only after creating DEV Auth users in Supabase Dashboard.
-- Replace the fake email values below before running.
-- Do not run in Production.
-- ============================================================

DO $$
DECLARE
  v_missing_emails TEXT;
BEGIN
  WITH expected(email) AS (
    VALUES
      ('dev-no-ga@example.test'),
      ('dev-ga-access@example.test'),
      ('dev-ga-view@example.test'),
      ('dev-ga-manage@example.test')
  )
  SELECT string_agg(e.email, ', ' ORDER BY e.email)
  INTO v_missing_emails
  FROM expected e
  LEFT JOIN auth.users u ON lower(u.email) = lower(e.email)
  WHERE u.id IS NULL;

  IF v_missing_emails IS NOT NULL THEN
    RAISE EXCEPTION 'DEV Auth users not found. Create or replace these emails first: %', v_missing_emails;
  END IF;
END $$;

WITH mapped_users AS (
  SELECT
    u.id,
    u.email,
    m.full_name,
    m.employee_code,
    m.job_title,
    m.role_code
  FROM (
    VALUES
      ('dev-no-ga@example.test', 'DEV 無權限使用者', 'DEV0001', '測試人員', 'dev_no_ga_access'),
      ('dev-ga-access@example.test', 'DEV 總務入口使用者', 'DEV0002', '測試店長', 'dev_ga_access_only'),
      ('dev-ga-view@example.test', 'DEV 分類檢視使用者', 'DEV0003', '測試督導', 'dev_ga_category_view'),
      ('dev-ga-manage@example.test', 'DEV 分類管理使用者', 'DEV0004', '測試總務', 'dev_ga_category_manage')
  ) AS m(email, full_name, employee_code, job_title, role_code)
  JOIN auth.users u ON lower(u.email) = lower(m.email)
), upsert_profiles AS (
  INSERT INTO public.profiles (id, email, full_name, role, department, job_title, employee_code)
  SELECT id, email, full_name, 'member', 'DEV 測試部門', job_title, employee_code
  FROM mapped_users
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    department = EXCLUDED.department,
    job_title = EXCLUDED.job_title,
    employee_code = EXCLUDED.employee_code
  RETURNING id
)
INSERT INTO public.user_roles (user_id, role_id, employee_code, is_active)
SELECT mu.id, r.id, mu.employee_code, true
FROM mapped_users mu
JOIN public.roles r ON r.code = mu.role_code
ON CONFLICT (user_id, role_id) DO UPDATE SET
  employee_code = EXCLUDED.employee_code,
  is_active = true,
  expires_at = NULL;

WITH manager_user AS (
  SELECT id FROM auth.users WHERE lower(email) = lower('dev-ga-access@example.test')
), dev_store AS (
  SELECT id FROM public.stores WHERE store_code = 'DEV001'
)
INSERT INTO public.store_managers (store_id, user_id, role_type, is_primary)
SELECT dev_store.id, manager_user.id, 'store_manager', true
FROM manager_user, dev_store
ON CONFLICT (store_id, user_id, role_type) DO UPDATE SET is_primary = true;

