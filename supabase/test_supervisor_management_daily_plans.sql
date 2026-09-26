-- ============================================================
-- DEV Test - Supervisor Management Daily Plans Foundation
-- Run only on confirmed DEV project.
-- ============================================================

DO $$
DECLARE
  v_missing_table_count integer;
  v_missing_function_count integer;
  v_missing_policy_count integer;
  v_delete_policy_count integer;
  v_rls_enabled boolean;
  v_missing_index_count integer;
  v_unsafe_anon_grant_count integer;
  v_unsafe_public_function_grant_count integer;
BEGIN
  SELECT count(*)
  INTO v_missing_table_count
  FROM (VALUES ('supervisor_management_daily_plans')) AS expected(table_name)
  WHERE to_regclass('public.' || expected.table_name) IS NULL;

  IF v_missing_table_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans table missing';
  END IF;

  SELECT count(*)
  INTO v_missing_function_count
  FROM (VALUES
    ('supervisor_management_daily_plan_is_visible(uuid)'),
    ('supervisor_management_daily_plan_is_manageable(uuid)'),
    ('supervisor_management_validate_daily_plan()'),
    ('supervisor_management_soft_delete_daily_plan(uuid,text)')
  ) AS expected(signature)
  WHERE to_regprocedure('public.' || expected.signature) IS NULL;

  IF v_missing_function_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans functions missing: %', v_missing_function_count;
  END IF;

  SELECT relrowsecurity
  INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.supervisor_management_daily_plans'::regclass;

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL daily plans RLS is not enabled';
  END IF;

  SELECT count(*)
  INTO v_missing_policy_count
  FROM (VALUES
    ('supervisor_management_daily_plans_read'),
    ('supervisor_management_daily_plans_insert'),
    ('supervisor_management_daily_plans_update')
  ) AS expected(policy_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'supervisor_management_daily_plans'
      AND p.policyname = expected.policy_name
  );

  IF v_missing_policy_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans policies missing: %', v_missing_policy_count;
  END IF;

  SELECT count(*)
  INTO v_delete_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'supervisor_management_daily_plans'
    AND cmd = 'DELETE';

  IF v_delete_policy_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans must not have DELETE policy';
  END IF;

  SELECT count(*)
  INTO v_missing_index_count
  FROM (VALUES
    ('idx_supervisor_management_daily_plans_owner_date'),
    ('idx_supervisor_management_daily_plans_date_status'),
    ('idx_supervisor_management_daily_plans_store_date'),
    ('idx_supervisor_management_daily_plans_employee_date'),
    ('idx_supervisor_management_daily_plans_linked_case'),
    ('idx_supervisor_management_daily_plans_linked_record')
  ) AS expected(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'supervisor_management_daily_plans'
      AND i.indexname = expected.index_name
  );

  IF v_missing_index_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans indexes missing: %', v_missing_index_count;
  END IF;

  SELECT count(*)
  INTO v_unsafe_anon_grant_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name = 'supervisor_management_daily_plans'
    AND grantee IN ('anon', 'PUBLIC');

  IF v_unsafe_anon_grant_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans anon/PUBLIC table grants must be absent';
  END IF;

  SELECT count(*)
  INTO v_unsafe_public_function_grant_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN (
      'supervisor_management_daily_plan_is_visible',
      'supervisor_management_daily_plan_is_manageable',
      'supervisor_management_validate_daily_plan',
      'supervisor_management_soft_delete_daily_plan'
    )
    AND grantee IN ('anon', 'PUBLIC');

  IF v_unsafe_public_function_grant_count <> 0 THEN
    RAISE EXCEPTION 'FAIL daily plans anon/PUBLIC function grants must be absent';
  END IF;

  RAISE NOTICE 'PASS supervisor management daily plans catalog checks';
END $$;

DO $$
DECLARE
  v_trigger_count integer;
  v_constraint_count integer;
BEGIN
  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.supervisor_management_daily_plans'::regclass
    AND tgname = 'trg_supervisor_management_daily_plans_validate'
    AND NOT tgisinternal;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'FAIL daily plans validation trigger missing';
  END IF;

  SELECT count(*)
  INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.supervisor_management_daily_plans'::regclass
    AND conname IN (
      'supervisor_management_daily_plans_target_type_check',
      'supervisor_management_daily_plans_status_check',
      'supervisor_management_daily_plans_store_target_check',
      'supervisor_management_daily_plans_employee_target_check',
      'supervisor_management_daily_plans_metadata_object',
      'supervisor_management_daily_plans_soft_delete_fields'
    );

  IF v_constraint_count <> 6 THEN
    RAISE EXCEPTION 'FAIL daily plans required constraints missing: %', v_constraint_count;
  END IF;

  RAISE NOTICE 'PASS supervisor management daily plans trigger and constraints';
END $$;
