-- ============================================================
-- Test SQL - Supervisor Management Log Foundation
-- Intended for DEV after the migration is pushed and approved.
-- This script performs catalog, constraint, trigger, RLS and grant checks.
-- It does not modify migration history and does not use Production data.
-- ============================================================

DO $$
DECLARE
  v_missing text;
  v_delete_policy_count integer;
  v_unsafe_anon_grant_count integer;
  v_missing_rls_count integer;
  v_missing_helper_execute_count integer;
  v_unsafe_helper_execute_count integer;
BEGIN
  WITH expected_permissions(code) AS (
    VALUES
      ('supervisor.management_log.view_own'),
      ('supervisor.management_log.view_team'),
      ('supervisor.management_log.create'),
      ('supervisor.management_log.update_own'),
      ('supervisor.management_log.follow_up'),
      ('supervisor.management_log.manage'),
      ('supervisor.management_category.manage')
  )
  SELECT string_agg(ep.code, ', ' ORDER BY ep.code)
  INTO v_missing
  FROM expected_permissions ep
  LEFT JOIN public.permissions p ON p.code = ep.code AND p.is_active = true
  WHERE p.id IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing supervisor management permissions: %', v_missing;
  END IF;

  WITH expected_tables(table_name) AS (
    VALUES
      ('supervisor_management_categories'),
      ('supervisor_management_cases'),
      ('supervisor_management_records'),
      ('supervisor_management_followups'),
      ('supervisor_management_case_events')
  )
  SELECT string_agg(et.table_name, ', ' ORDER BY et.table_name)
  INTO v_missing
  FROM expected_tables et
  LEFT JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = et.table_name
  WHERE t.table_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing supervisor management tables: %', v_missing;
  END IF;

  WITH expected_functions(function_name, args) AS (
    VALUES
      ('supervisor_management_current_user_has_permission', 'text'),
      ('supervisor_management_current_user_manages_store', 'uuid'),
      ('supervisor_management_case_is_visible', 'uuid'),
      ('supervisor_management_case_is_manageable', 'uuid'),
      ('supervisor_management_validate_category', ''),
      ('supervisor_management_validate_case', ''),
      ('supervisor_management_validate_record', ''),
      ('supervisor_management_validate_followup', ''),
      ('supervisor_management_soft_delete_case', 'uuid, text'),
      ('supervisor_management_soft_delete_record', 'uuid, text')
  )
  SELECT string_agg(ef.function_name || '(' || ef.args || ')', ', ' ORDER BY ef.function_name)
  INTO v_missing
  FROM expected_functions ef
  WHERE to_regprocedure('public.' || ef.function_name || '(' || ef.args || ')') IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing supervisor management functions: %', v_missing;
  END IF;

  SELECT count(*)
  INTO v_missing_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'supervisor_management_categories',
      'supervisor_management_cases',
      'supervisor_management_records',
      'supervisor_management_followups',
      'supervisor_management_case_events'
    )
    AND c.relrowsecurity IS DISTINCT FROM true;

  IF v_missing_rls_count <> 0 THEN
    RAISE EXCEPTION 'Some supervisor management tables do not have RLS enabled: %', v_missing_rls_count;
  END IF;

  SELECT count(*)
  INTO v_delete_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'supervisor_management_categories',
      'supervisor_management_cases',
      'supervisor_management_records',
      'supervisor_management_followups',
      'supervisor_management_case_events'
    )
    AND cmd = 'DELETE';

  IF v_delete_policy_count <> 0 THEN
    RAISE EXCEPTION 'Supervisor management tables must not expose DELETE policies: %', v_delete_policy_count;
  END IF;

  SELECT count(*)
  INTO v_unsafe_anon_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'supervisor_management_categories',
      'supervisor_management_cases',
      'supervisor_management_records',
      'supervisor_management_followups',
      'supervisor_management_case_events'
    )
    AND grantee = 'anon';

  IF v_unsafe_anon_grant_count <> 0 THEN
    RAISE EXCEPTION 'anon must not have supervisor management table grants: %', v_unsafe_anon_grant_count;
  END IF;

  WITH helper_functions(signature) AS (
    VALUES
      ('public.supervisor_management_current_user_has_permission(text)'),
      ('public.supervisor_management_current_user_manages_store(uuid)'),
      ('public.supervisor_management_case_is_visible(uuid)'),
      ('public.supervisor_management_case_is_manageable(uuid)')
  )
  SELECT count(*)
  INTO v_missing_helper_execute_count
  FROM helper_functions hf
  WHERE NOT has_function_privilege('authenticated', hf.signature, 'EXECUTE');

  IF v_missing_helper_execute_count <> 0 THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on RLS helper functions: %', v_missing_helper_execute_count;
  END IF;

  WITH helper_functions(signature) AS (
    VALUES
      ('public.supervisor_management_current_user_has_permission(text)'),
      ('public.supervisor_management_current_user_manages_store(uuid)'),
      ('public.supervisor_management_case_is_visible(uuid)'),
      ('public.supervisor_management_case_is_manageable(uuid)')
  ),
  public_execute AS (
    SELECT hf.signature
    FROM helper_functions hf
    JOIN pg_proc p ON p.oid = to_regprocedure(hf.signature)
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  anon_execute AS (
    SELECT hf.signature
    FROM helper_functions hf
    WHERE has_function_privilege('anon', hf.signature, 'EXECUTE')
  )
  SELECT count(*)
  INTO v_unsafe_helper_execute_count
  FROM (
    SELECT signature FROM public_execute
    UNION ALL
    SELECT signature FROM anon_execute
  ) unsafe;

  IF v_unsafe_helper_execute_count <> 0 THEN
    RAISE EXCEPTION 'PUBLIC/anon must not have EXECUTE on RLS helper functions: %', v_unsafe_helper_execute_count;
  END IF;
END $$;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'supervisor_management_categories',
    'supervisor_management_cases',
    'supervisor_management_records',
    'supervisor_management_followups',
    'supervisor_management_case_events'
  )
ORDER BY c.relname;

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'supervisor_management_%'
ORDER BY tablename, policyname;

SELECT
  routine_name,
  security_type,
  external_language
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'supervisor_management_%'
ORDER BY routine_name;

SELECT
  signature,
  EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = to_regprocedure(signature)
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', signature, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', signature, 'EXECUTE') AS authenticated_execute
FROM (
  VALUES
    ('public.supervisor_management_current_user_manages_store(uuid)'),
    ('public.supervisor_management_current_user_has_permission(text)'),
    ('public.supervisor_management_case_is_visible(uuid)'),
    ('public.supervisor_management_case_is_manageable(uuid)'),
    ('public.supervisor_management_soft_delete_case(uuid, text)'),
    ('public.supervisor_management_soft_delete_record(uuid, text)')
) AS fn(signature)
ORDER BY signature;
