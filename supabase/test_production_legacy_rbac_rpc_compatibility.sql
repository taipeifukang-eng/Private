-- ============================================================
-- P1-J catalog verification - Production legacy RBAC RPC compatibility
-- Read-only catalog checks only.
-- ============================================================

WITH expected_functions AS (
  SELECT *
  FROM (VALUES
    ('check_user_permission', 'uuid, character varying'),
    ('get_all_employees_for_rbac', '')
  ) AS v(proname, arg_types)
),
function_catalog AS (
  SELECT
    e.proname,
    e.arg_types,
    p.oid,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.proowner,
    pg_get_functiondef(p.oid) AS definition
  FROM expected_functions e
  LEFT JOIN pg_proc p
    ON p.proname = e.proname
   AND oidvectortypes(p.proargtypes) = e.arg_types
  LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' OR n.nspname IS NULL
),
checks AS (
  SELECT
    'functions_exist' AS check_name,
    COUNT(*) FILTER (WHERE oid IS NOT NULL) AS actual,
    COUNT(*) AS expected,
    COUNT(*) FILTER (WHERE oid IS NOT NULL) = COUNT(*) AS passed
  FROM function_catalog

  UNION ALL

  SELECT
    'security_definer',
    COUNT(*) FILTER (WHERE prosecdef IS TRUE),
    COUNT(*),
    COUNT(*) FILTER (WHERE prosecdef IS TRUE) = COUNT(*)
  FROM function_catalog

  UNION ALL

  SELECT
    'search_path_public_pg_temp',
    COUNT(*) FILTER (
      WHERE proconfig::text LIKE '%search_path=public, pg_temp%'
    ),
    COUNT(*),
    COUNT(*) FILTER (
      WHERE proconfig::text LIKE '%search_path=public, pg_temp%'
    ) = COUNT(*)
  FROM function_catalog

  UNION ALL

  SELECT
    'authenticated_execute_grants',
    COUNT(*) FILTER (
      WHERE has_function_privilege('authenticated', oid, 'EXECUTE')
    ),
    COUNT(*),
    COUNT(*) FILTER (
      WHERE has_function_privilege('authenticated', oid, 'EXECUTE')
    ) = COUNT(*)
  FROM function_catalog

  UNION ALL

  SELECT
    'anon_no_execute_grants',
    COUNT(*) FILTER (
      WHERE oid IS NOT NULL AND has_function_privilege('anon', oid, 'EXECUTE')
    ),
    0,
    COUNT(*) FILTER (
      WHERE oid IS NOT NULL AND has_function_privilege('anon', oid, 'EXECUTE')
    ) = 0
  FROM function_catalog

  UNION ALL

  SELECT
    'public_no_execute_grants',
    COUNT(*) FILTER (
      WHERE oid IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(function_catalog.proacl, acldefault('f', function_catalog.proowner))) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
    ),
    0,
    COUNT(*) FILTER (
      WHERE oid IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(function_catalog.proacl, acldefault('f', function_catalog.proowner))) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
    ) = 0
  FROM function_catalog

  UNION ALL

  SELECT
    'check_user_permission_uses_has_permission',
    COUNT(*) FILTER (
      WHERE proname = 'check_user_permission'
        AND definition LIKE '%public.has_permission(p_user_id, p_permission_code)%'
        AND definition LIKE '%auth.uid() IS DISTINCT FROM p_user_id%'
    ),
    1,
    COUNT(*) FILTER (
      WHERE proname = 'check_user_permission'
        AND definition LIKE '%public.has_permission(p_user_id, p_permission_code)%'
        AND definition LIKE '%auth.uid() IS DISTINCT FROM p_user_id%'
    ) = 1
  FROM function_catalog

  UNION ALL

  SELECT
    'get_all_employees_for_rbac_has_rbac_guard',
    COUNT(*) FILTER (
      WHERE proname = 'get_all_employees_for_rbac'
        AND definition LIKE '%public.current_user_has_permission(''role.user_role.assign'')%'
        AND definition LIKE '%public.current_user_has_permission(''user.user.view'')%'
        AND definition NOT LIKE '%profiles.role%'
    ),
    1,
    COUNT(*) FILTER (
      WHERE proname = 'get_all_employees_for_rbac'
        AND definition LIKE '%public.current_user_has_permission(''role.user_role.assign'')%'
        AND definition LIKE '%public.current_user_has_permission(''user.user.view'')%'
        AND definition NOT LIKE '%profiles.role%'
    ) = 1
  FROM function_catalog
)
SELECT
  check_name,
  actual,
  expected,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;
