-- GA-VENDOR-RBAC-1 catalog verification（M7/M8 第 6 批更新版）。
-- Read-only checks for DEV after applying 20261118090000_m7m8_b6_vendor_columns_rls.sql（第 6 批收緊版 RLS，取代 20260824090000 的政策形狀）。
-- 檢查：七個權限碼存在、九條政策（讀、新增、修改各三張表）存在、廠商表只留廠商檢視／管理（不含分類、區域、合作紀錄、service_center.access）、寫入只給 manage、
-- 分類與區域讀取給自己的 view／manage 加廠商 view／manage、三張表沒有 DELETE 與 FOR ALL 政策、廠商函式齊全。
-- 結果欄 result 全為 PASS 才算通過。

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
expected_policies(tablename, policyname, cmd) AS (
  VALUES
    ('ga_vendors', 'p1e_ga_vendors_read', 'SELECT'),
    ('ga_vendors', 'p1e_ga_vendors_insert', 'INSERT'),
    ('ga_vendors', 'p1e_ga_vendors_update', 'UPDATE'),
    ('ga_service_categories', 'p1e_ga_service_categories_read', 'SELECT'),
    ('ga_service_categories', 'p1e_ga_service_categories_insert', 'INSERT'),
    ('ga_service_categories', 'p1e_ga_service_categories_update', 'UPDATE'),
    ('ga_service_regions', 'p1e_ga_service_regions_read', 'SELECT'),
    ('ga_service_regions', 'p1e_ga_service_regions_insert', 'INSERT'),
    ('ga_service_regions', 'p1e_ga_service_regions_update', 'UPDATE')
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
    CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=9 actual=%s', count(*)) AS details
  FROM expected_policies ep
  JOIN pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = ep.tablename
   AND p.policyname = ep.policyname
   AND p.cmd = ep.cmd

  UNION ALL

  SELECT
    'no_delete_or_all_policy' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('delete_or_all_policies=%s', count(*)) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('ga_vendors', 'ga_service_categories', 'ga_service_regions')
    AND cmd IN ('DELETE', 'ALL')

  UNION ALL

  SELECT
    'vendor_read_uses_vendor_permissions_only' AS check_name,
    CASE
      WHEN qual LIKE '%general_affairs.vendor.view%'
       AND qual LIKE '%general_affairs.vendor.manage%'
       AND qual NOT LIKE '%general_affairs.cooperation_record.view%'
       AND qual NOT LIKE '%general_affairs.service_category%'
       AND qual NOT LIKE '%general_affairs.service_region%'
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
      WHEN count(*) = 2
       AND bool_and(coalesce(qual, with_check) LIKE '%general_affairs.vendor.manage%')
       AND bool_and(coalesce(qual, with_check) NOT LIKE '%general_affairs.vendor.view%')
       AND bool_and(coalesce(qual, with_check) NOT LIKE '%general_affairs.service_center.access%')
       AND bool_and(with_check LIKE '%general_affairs.vendor.manage%')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format('policies=%s', count(*)) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'ga_vendors'
    AND policyname IN ('p1e_ga_vendors_insert', 'p1e_ga_vendors_update')

  UNION ALL

  SELECT
    'category_region_read_and_write' AS check_name,
    CASE
      WHEN count(*) = 2
       AND bool_and(CASE
             WHEN tablename = 'ga_service_categories' THEN qual LIKE '%general_affairs.service_category.view%' AND qual LIKE '%general_affairs.service_category.manage%'
             ELSE qual LIKE '%general_affairs.service_region.view%' AND qual LIKE '%general_affairs.service_region.manage%'
           END AND qual LIKE '%general_affairs.vendor.view%' AND qual NOT LIKE '%general_affairs.service_center.access%')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format('read_policies=%s', count(*)) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN ('p1e_ga_service_categories_read', 'p1e_ga_service_regions_read')

  UNION ALL

  SELECT
    'category_region_write_manage_only' AS check_name,
    CASE
      WHEN count(*) = 4
       AND bool_and(CASE
             WHEN tablename = 'ga_service_categories' THEN coalesce(qual, with_check) LIKE '%general_affairs.service_category.manage%'
             ELSE coalesce(qual, with_check) LIKE '%general_affairs.service_region.manage%'
           END AND coalesce(qual, with_check) NOT LIKE '%.view%')
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format('write_policies=%s', count(*)) AS details
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN ('p1e_ga_service_categories_insert', 'p1e_ga_service_categories_update', 'p1e_ga_service_regions_insert', 'p1e_ga_service_regions_update')

  UNION ALL

  SELECT
    'vendor_functions' AS check_name,
    CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=11 actual=%s', count(*)) AS details
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosecdef
    AND p.proname IN ('ga_ws_vendor_list', 'ga_ws_vendor_get', 'ga_ws_vendor_save', 'ga_ws_vendor_set_status', 'ga_ws_vendor_options',
                      'ga_ws_svc_category_list', 'ga_ws_svc_category_get', 'ga_ws_svc_category_save', 'ga_ws_svc_region_list', 'ga_ws_svc_region_get', 'ga_ws_svc_region_save')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
)
SELECT *
FROM checks
ORDER BY check_name;
