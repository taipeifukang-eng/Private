-- GA-VENDOR-RBAC-1 catalog verification.
-- Read-only checks for DEV after applying
-- 20260824090000_general_affairs_vendor_permissions_rls.sql.

WITH expected_permissions(code) AS (
  VALUES
    ('general_affairs.vendor.view'),
    ('general_affairs.vendor.manage'),
    ('general_affairs.service_category.view'),
    ('general_affairs.service_category.manage'),
    ('general_affairs.service_region.view'),
    ('general_affairs.service_region.manage'),
    ('general_affairs.cooperation_record.view')
),
expected_policies(tablename, policyname) AS (
  VALUES
    ('ga_vendors', 'p1e_ga_vendors_read'),
    ('ga_vendors', 'p1e_ga_vendors_write'),
    ('ga_service_categories', 'p1e_ga_service_categories_read'),
    ('ga_service_categories', 'p1e_ga_service_categories_write'),
    ('ga_service_regions', 'p1e_ga_service_regions_read'),
    ('ga_service_regions', 'p1e_ga_service_regions_write')
),
checks AS (
  SELECT
    'permissions' AS check_name,
    CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=7 actual=%s', count(*)) AS details
  FROM expected_permissions ep
  JOIN public.permissions p ON p.code = ep.code AND p.is_active = true

  UNION ALL

  SELECT
    'policies' AS check_name,
    CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=6 actual=%s', count(*)) AS details
  FROM expected_policies ep
  JOIN pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = ep.tablename
   AND p.policyname = ep.policyname

  UNION ALL

  SELECT
    'vendor_read_uses_vendor_permissions' AS check_name,
    CASE
      WHEN qual LIKE '%general_affairs.vendor.view%'
       AND qual LIKE '%general_affairs.cooperation_record.view%'
       AND qual NOT LIKE '%general_affairs.service_center.access%'
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    coalesce(qual, '') AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'ga_vendors'
    AND policyname = 'p1e_ga_vendors_read'

  UNION ALL

  SELECT
    'vendor_write_uses_manage_permission' AS check_name,
    CASE
      WHEN qual LIKE '%general_affairs.vendor.manage%'
       AND with_check LIKE '%general_affairs.vendor.manage%'
       AND qual NOT LIKE '%general_affairs.service_center.access%'
       AND with_check NOT LIKE '%general_affairs.service_center.access%'
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format('qual=%s with_check=%s', coalesce(qual, ''), coalesce(with_check, '')) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'ga_vendors'
    AND policyname = 'p1e_ga_vendors_write'

  UNION ALL

  SELECT
    'dev_ga_manager_vendor_permissions' AS check_name,
    CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=7 actual=%s', count(*)) AS details
  FROM expected_permissions ep
  JOIN public.permissions p ON p.code = ep.code
  JOIN public.role_permissions rp ON rp.permission_id = p.id AND rp.is_allowed = true
  JOIN public.roles r ON r.id = rp.role_id AND r.code = 'dev_ga_category_manage'
)
SELECT *
FROM checks
ORDER BY check_name;
