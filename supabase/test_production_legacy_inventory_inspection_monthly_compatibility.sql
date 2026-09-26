-- P1-F Production legacy inventory result / inspection / monthly status compatibility catalog verification.
-- Read-only catalog checks.

WITH expected_tables(table_name) AS (
  VALUES
    ('inventory_result_batches'),
    ('inventory_result_items'),
    ('inventory_result_settings'),
    ('inspection_templates'),
    ('inspection_masters'),
    ('inspection_results'),
    ('inspection_improvements'),
    ('inspection_on_duty_staff'),
    ('inspection_bonus_config'),
    ('inspection_grade_mapping'),
    ('monthly_staff_status'),
    ('monthly_store_summary'),
    ('monthly_bonus_records')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('inventory_result_items', 'difference_reason'),
    ('inventory_result_items', 'difference_reason_updated_by'),
    ('inventory_result_settings', 'value'),
    ('inspection_masters', 'inspection_type'),
    ('inspection_masters', 'improvement_bonus'),
    ('inspection_results', 'selected_items'),
    ('inspection_improvements', 'improved_by'),
    ('inspection_on_duty_staff', 'is_duty_supervisor'),
    ('inspection_bonus_config', 'bonus_score'),
    ('inspection_grade_mapping', 'grade'),
    ('monthly_staff_status', 'monthly_status'),
    ('monthly_staff_status', 'monthly_transport_expense'),
    ('monthly_store_summary', 'store_status'),
    ('monthly_bonus_records', 'inventory_diff_penalty')
),
expected_triggers(trigger_name) AS (
  VALUES
    ('trg_inventory_result_settings_updated_at'),
    ('trg_inspection_templates_updated_at'),
    ('trg_inspection_masters_updated_at'),
    ('trg_inspection_results_updated_at'),
    ('trg_inspection_improvements_updated_at'),
    ('trg_inspection_bonus_config_updated_at'),
    ('trg_inspection_grade_mapping_updated_at'),
    ('trg_monthly_staff_status_updated_at'),
    ('trg_monthly_store_summary_updated_at'),
    ('trg_monthly_bonus_records_updated_at')
),
expected_indexes(indexname) AS (
  VALUES
    ('idx_inventory_result_batches_store'),
    ('idx_inventory_result_batches_year_month'),
    ('idx_inventory_result_items_batch'),
    ('idx_inspection_masters_store_date'),
    ('idx_inspection_results_inspection'),
    ('idx_improvements_store'),
    ('idx_monthly_staff_status_store_id'),
    ('idx_monthly_store_summary_year_month'),
    ('idx_mbr_store_yearmonth')
),
expected_policies(tablename, policyname) AS (
  VALUES
    ('inventory_result_batches', 'p1f_inventory_result_batches_read'),
    ('inventory_result_batches', 'p1f_inventory_result_batches_write'),
    ('inventory_result_items', 'p1f_inventory_result_items_read'),
    ('inventory_result_items', 'p1f_inventory_result_items_update'),
    ('inventory_result_settings', 'p1f_inventory_result_settings_read'),
    ('inventory_result_settings', 'p1f_inventory_result_settings_write'),
    ('inspection_templates', 'p1f_inspection_templates_read'),
    ('inspection_templates', 'p1f_inspection_templates_write'),
    ('inspection_masters', 'p1f_inspection_masters_read'),
    ('inspection_masters', 'p1f_inspection_masters_write'),
    ('inspection_results', 'p1f_inspection_results_read'),
    ('inspection_results', 'p1f_inspection_results_write'),
    ('inspection_improvements', 'p1f_inspection_improvements_read'),
    ('inspection_improvements', 'p1f_inspection_improvements_write'),
    ('inspection_on_duty_staff', 'p1f_inspection_on_duty_staff_read'),
    ('inspection_on_duty_staff', 'p1f_inspection_on_duty_staff_write'),
    ('inspection_bonus_config', 'p1f_inspection_bonus_config_read'),
    ('inspection_bonus_config', 'p1f_inspection_bonus_config_write'),
    ('inspection_grade_mapping', 'p1f_inspection_grade_mapping_read'),
    ('inspection_grade_mapping', 'p1f_inspection_grade_mapping_write'),
    ('monthly_staff_status', 'p1f_monthly_staff_status_read'),
    ('monthly_staff_status', 'p1f_monthly_staff_status_write'),
    ('monthly_store_summary', 'p1f_monthly_store_summary_read'),
    ('monthly_store_summary', 'p1f_monthly_store_summary_write'),
    ('monthly_bonus_records', 'p1f_monthly_bonus_records_read'),
    ('monthly_bonus_records', 'p1f_monthly_bonus_records_write')
),
checks AS (
  SELECT
    'tables' AS check_name,
    CASE WHEN count(*) = 13 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=13 actual=%s', count(*)) AS details
  FROM expected_tables et
  JOIN information_schema.tables t
    ON t.table_schema = 'public'
   AND t.table_name = et.table_name

  UNION ALL

  SELECT
    'columns' AS check_name,
    CASE WHEN count(*) = 14 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=14 actual=%s', count(*)) AS details
  FROM expected_columns ec
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = ec.table_name
   AND c.column_name = ec.column_name

  UNION ALL

  SELECT
    'rls_enabled' AS check_name,
    CASE WHEN count(*) = 13 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=13 actual=%s', count(*)) AS details
  FROM expected_tables et
  JOIN pg_class cls ON cls.relname = et.table_name
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'
    AND cls.relrowsecurity = true

  UNION ALL

  SELECT
    'policies' AS check_name,
    CASE WHEN count(*) = 26 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=26 actual=%s', count(*)) AS details
  FROM expected_policies ep
  JOIN pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = ep.tablename
   AND p.policyname = ep.policyname

  UNION ALL

  SELECT
    'triggers' AS check_name,
    CASE WHEN count(*) = 10 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=10 actual=%s', count(*)) AS details
  FROM expected_triggers et
  JOIN information_schema.triggers trg
    ON trg.trigger_schema = 'public'
   AND trg.trigger_name = et.trigger_name

  UNION ALL

  SELECT
    'indexes' AS check_name,
    CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=9 actual=%s', count(*)) AS details
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
    'no_using_true_policies' AS check_name,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    count(*)::text AS details
  FROM pg_policies p
  JOIN expected_tables et ON et.table_name = p.tablename
  WHERE p.schemaname = 'public'
    AND (p.qual = 'true' OR p.with_check = 'true')
)
SELECT *
FROM checks
ORDER BY check_name;
