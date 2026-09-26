-- P1-H catalog-only verification. Read-only; creates no data.

WITH
expected_tables(table_name) AS (
  VALUES
    ('campaigns'),
    ('campaign_schedules'),
    ('campaign_store_details'),
    ('campaign_store_headcount'),
    ('campaign_store_own_staff'),
    ('campaign_support_requests'),
    ('campaign_support_staff'),
    ('campaign_equipment_trips'),
    ('campaign_checklist_items'),
    ('campaign_checklist_completions'),
    ('campaign_department_publish'),
    ('event_dates'),
    ('store_activity_settings'),
    ('pharmacist_profiles'),
    ('pharmacist_annual_master'),
    ('pharmacist_annual_fees'),
    ('pharmacist_annual_master_locks'),
    ('pharmacist_annual_master_sync_log'),
    ('pharmacist_monthly_snapshot'),
    ('pharmacist_monthly_snapshot_sync_log'),
    ('pharmacist_snapshot_locks'),
    ('stockout_reports'),
    ('stockout_product_responses'),
    ('stockout_product_response_history'),
    ('meal_allowance_records'),
    ('spring_festival_bonus'),
    ('support_staff_bonus'),
    ('talent_cultivation_bonus'),
    ('store_performance')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('campaigns', 'campaign_type'),
    ('campaign_store_details', 'planned_inventory_time'),
    ('campaign_department_publish', 'marketing_image_paths'),
    ('pharmacist_profiles', 'education_level'),
    ('pharmacist_annual_fees', 'payment_proof_path'),
    ('pharmacist_monthly_snapshot', 'source'),
    ('stockout_product_responses', 'eta_date'),
    ('store_performance', 'activity_day_gross_profit'),
    ('support_staff_bonus', 'store_id'),
    ('talent_cultivation_bonus', 'cultivation_target')
),
expected_policies(policyname) AS (
  VALUES
    ('p1h_campaigns_read'),
    ('p1h_campaigns_write'),
    ('p1h_campaign_store_details_read'),
    ('p1h_campaign_department_publish_read'),
    ('p1h_pharmacist_profiles_read'),
    ('p1h_pharmacist_annual_master_read'),
    ('p1h_pharmacist_monthly_snapshot_read'),
    ('p1h_stockout_reports_read'),
    ('p1h_stockout_product_responses_read'),
    ('p1h_meal_allowance_read'),
    ('p1h_spring_festival_bonus_read'),
    ('p1h_store_performance_read')
),
expected_triggers(trigger_name) AS (
  VALUES
    ('trg_campaigns_updated_at'),
    ('trg_campaign_store_details_updated_at'),
    ('trg_campaign_department_publish_updated_at'),
    ('trg_pharmacist_profiles_updated_at'),
    ('trigger_pharmacist_annual_master_updated_at'),
    ('trg_pharmacist_monthly_snapshot_updated_at'),
    ('trg_stockout_reports_updated_at'),
    ('trg_stockout_product_responses_updated_at'),
    ('trg_sync_stockout_status'),
    ('trigger_update_support_bonus_updated_at'),
    ('trg_store_performance_updated_at')
),
expected_indexes(indexname) AS (
  VALUES
    ('idx_campaigns_published'),
    ('idx_campaign_store_details_store_id'),
    ('idx_campaign_support_requests_requesting'),
    ('idx_checklist_completions_lookup'),
    ('idx_pharmacist_annual_master_year_status'),
    ('idx_pharmacist_monthly_snapshot_store'),
    ('idx_stockout_response_history_product_code_time'),
    ('idx_support_bonus_store_year_month'),
    ('idx_talent_cultivation_bonus_store'),
    ('idx_store_performance_year_month')
),
actual_tables AS (
  SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
),
actual_rls AS (
  SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relrowsecurity
),
actual_columns AS (
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
),
actual_policies AS (
  SELECT policyname
  FROM pg_policies
  WHERE schemaname = 'public'
),
actual_triggers AS (
  SELECT trigger_name
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
),
actual_indexes AS (
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
),
checks AS (
  SELECT
    'tables' AS check_name,
    count(*) FILTER (WHERE a.table_name IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_tables e
  LEFT JOIN actual_tables a ON a.table_name = e.table_name

  UNION ALL

  SELECT
    'columns' AS check_name,
    count(*) FILTER (WHERE a.column_name IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_columns e
  LEFT JOIN actual_columns a ON a.table_name = e.table_name AND a.column_name = e.column_name

  UNION ALL

  SELECT
    'rls_enabled' AS check_name,
    count(*) FILTER (WHERE a.table_name IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_tables e
  LEFT JOIN actual_rls a ON a.table_name = e.table_name

  UNION ALL

  SELECT
    'policies' AS check_name,
    count(*) FILTER (WHERE a.policyname IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_policies e
  LEFT JOIN actual_policies a ON a.policyname = e.policyname

  UNION ALL

  SELECT
    'triggers' AS check_name,
    count(*) FILTER (WHERE a.trigger_name IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_triggers e
  LEFT JOIN actual_triggers a ON a.trigger_name = e.trigger_name

  UNION ALL

  SELECT
    'indexes' AS check_name,
    count(*) FILTER (WHERE a.indexname IS NOT NULL) AS actual_count,
    count(*) AS expected_count
  FROM expected_indexes e
  LEFT JOIN actual_indexes a ON a.indexname = e.indexname

  UNION ALL

  SELECT
    'no_anon_table_grants' AS check_name,
    count(*) AS actual_count,
    0 AS expected_count
  FROM information_schema.role_table_grants g
  JOIN expected_tables t ON t.table_name = g.table_name
  WHERE g.table_schema = 'public'
    AND g.grantee = 'anon'

  UNION ALL

  SELECT
    'no_using_true_policies' AS check_name,
    count(*) AS actual_count,
    0 AS expected_count
  FROM pg_policies p
  JOIN expected_tables t ON t.table_name = p.tablename
  WHERE p.schemaname = 'public'
    AND (
      p.qual ~* '^\(?true\)?$'
      OR p.with_check ~* '^\(?true\)?$'
    )
)
SELECT
  check_name,
  actual_count,
  expected_count,
  CASE WHEN actual_count = expected_count THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;
