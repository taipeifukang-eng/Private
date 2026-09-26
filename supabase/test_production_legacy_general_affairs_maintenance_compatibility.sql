-- P1-E Production legacy General Affairs / Maintenance compatibility catalog verification.
-- Read-only catalog checks.

WITH expected_tables(table_name) AS (
  VALUES
    ('ga_service_categories'),
    ('ga_service_regions'),
    ('ga_vendors'),
    ('maintenance_categories'),
    ('maintenance_progress_stages'),
    ('maintenance_requests'),
    ('maintenance_photos'),
    ('maintenance_updates'),
    ('maintenance_update_photos'),
    ('maintenance_ticket_events')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('ga_service_categories', 'common_items'),
    ('ga_service_regions', 'included_locations'),
    ('ga_vendors', 'service_category_ids'),
    ('ga_vendors', 'service_region_ids'),
    ('maintenance_requests', 'resource_type'),
    ('maintenance_requests', 'issue_type'),
    ('maintenance_requests', 'progress_stage'),
    ('maintenance_requests', 'completion_method'),
    ('maintenance_updates', 'progress_date'),
    ('maintenance_updates', 'visibility'),
    ('maintenance_ticket_events', 'metadata')
),
expected_triggers(trigger_name) AS (
  VALUES
    ('trg_ga_service_categories_updated_at'),
    ('trg_ga_service_regions_updated_at'),
    ('trg_ga_vendors_updated_at'),
    ('trg_maintenance_categories_updated_at'),
    ('trg_maintenance_progress_stages_updated_at'),
    ('trg_maintenance_requests_updated_at')
),
expected_indexes(indexname) AS (
  VALUES
    ('idx_ga_service_categories_parent'),
    ('idx_ga_service_regions_parent'),
    ('idx_ga_vendors_name'),
    ('idx_maintenance_categories_active_order'),
    ('idx_maintenance_requests_store_id'),
    ('idx_maintenance_requests_status'),
    ('idx_maintenance_updates_request_id'),
    ('idx_maintenance_ticket_events_ticket_id_created_at')
),
expected_policies(tablename, policyname) AS (
  VALUES
    ('ga_service_categories', 'p1e_ga_service_categories_read'),
    ('ga_service_categories', 'p1e_ga_service_categories_write'),
    ('ga_service_regions', 'p1e_ga_service_regions_read'),
    ('ga_service_regions', 'p1e_ga_service_regions_write'),
    ('ga_vendors', 'p1e_ga_vendors_read'),
    ('ga_vendors', 'p1e_ga_vendors_write'),
    ('maintenance_categories', 'p1e_maintenance_categories_read'),
    ('maintenance_categories', 'p1e_maintenance_categories_write'),
    ('maintenance_progress_stages', 'p1e_maintenance_progress_stages_read'),
    ('maintenance_progress_stages', 'p1e_maintenance_progress_stages_write'),
    ('maintenance_requests', 'p1e_maintenance_requests_read'),
    ('maintenance_requests', 'p1e_maintenance_requests_insert'),
    ('maintenance_requests', 'p1e_maintenance_requests_update'),
    ('maintenance_requests', 'p1e_maintenance_requests_delete'),
    ('maintenance_photos', 'p1e_maintenance_photos_read'),
    ('maintenance_photos', 'p1e_maintenance_photos_write'),
    ('maintenance_updates', 'p1e_maintenance_updates_read'),
    ('maintenance_updates', 'p1e_maintenance_updates_write'),
    ('maintenance_update_photos', 'p1e_maintenance_update_photos_read'),
    ('maintenance_update_photos', 'p1e_maintenance_update_photos_write'),
    ('maintenance_ticket_events', 'p1e_maintenance_ticket_events_read'),
    ('maintenance_ticket_events', 'p1e_maintenance_ticket_events_write')
),
checks AS (
  SELECT
    'tables' AS check_name,
    CASE WHEN count(*) = 10 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=10 actual=%s', count(*)) AS details
  FROM expected_tables et
  JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = et.table_name

  UNION ALL

  SELECT
    'columns' AS check_name,
    CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=11 actual=%s', count(*)) AS details
  FROM expected_columns ec
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = ec.table_name
   AND c.column_name = ec.column_name

  UNION ALL

  SELECT
    'rls_enabled' AS check_name,
    CASE WHEN count(*) = 10 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=10 actual=%s', count(*)) AS details
  FROM expected_tables et
  JOIN pg_class cls ON cls.relname = et.table_name
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'
    AND cls.relrowsecurity = true

  UNION ALL

  SELECT
    'policies' AS check_name,
    CASE WHEN count(*) = 22 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=22 actual=%s', count(*)) AS details
  FROM expected_policies ep
  JOIN pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = ep.tablename
   AND p.policyname = ep.policyname

  UNION ALL

  SELECT
    'triggers' AS check_name,
    CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=6 actual=%s', count(*)) AS details
  FROM expected_triggers et
  JOIN information_schema.triggers trg
    ON trg.trigger_schema = 'public'
   AND trg.trigger_name = et.trigger_name

  UNION ALL

  SELECT
    'indexes' AS check_name,
    CASE WHEN count(*) = 8 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=8 actual=%s', count(*)) AS details
  FROM expected_indexes ei
  JOIN pg_indexes idx
    ON idx.schemaname = 'public'
   AND idx.indexname = ei.indexname

  UNION ALL

  SELECT
    'no_anon_table_grants' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    count(*)::text AS details
  FROM information_schema.role_table_grants g
  JOIN expected_tables et ON et.table_name = g.table_name
  WHERE g.table_schema = 'public'
    AND g.grantee = 'anon'

  UNION ALL

  SELECT
    'helper_security' AS check_name,
    CASE
      WHEN p.proname = 'update_updated_at_column'
        AND p.prosecdef = false
        AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    format('security_definer=%s search_path=%s', p.prosecdef, array_to_string(p.proconfig, ','))
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'update_updated_at_column'
)
SELECT *
FROM checks
ORDER BY check_name;
