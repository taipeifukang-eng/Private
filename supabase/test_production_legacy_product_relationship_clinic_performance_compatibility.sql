-- P1-G Production legacy product / relationship member / clinic self-pay / performance compatibility catalog verification.
-- Read-only catalog checks.

WITH expected_tables(table_name) AS (
  VALUES
    ('products_master'),
    ('product_barcodes'),
    ('acquisition_scans'),
    ('acquisition_unmatched'),
    ('relationship_members'),
    ('relationship_sales_imports'),
    ('relationship_sales_details'),
    ('clinic_selfpay_price_entries'),
    ('clinic_selfpay_price_month_closures'),
    ('clinic_selfpay_claim_batches'),
    ('clinic_selfpay_claim_items'),
    ('store_performance_thresholds'),
    ('monthly_performance_details')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('products_master', 'product_code'),
    ('product_barcodes', 'barcode'),
    ('acquisition_scans', 'is_matched'),
    ('acquisition_unmatched', 'photos'),
    ('relationship_members', 'member_number'),
    ('relationship_members', 'is_approved'),
    ('relationship_sales_details', 'sale_datetime'),
    ('clinic_selfpay_price_entries', 'selfpay_drug_name'),
    ('clinic_selfpay_price_month_closures', 'closed_by'),
    ('clinic_selfpay_claim_batches', 'total_gross_profit_amount'),
    ('clinic_selfpay_claim_items', 'match_status'),
    ('store_performance_thresholds', 'threshold_level'),
    ('monthly_performance_details', 'is_from_file2')
),
expected_triggers(trigger_name) AS (
  VALUES
    ('trg_products_master_updated_at'),
    ('trg_acquisition_unmatched_updated_at'),
    ('trg_clinic_selfpay_price_entries_updated_at'),
    ('trg_store_performance_thresholds_updated_at'),
    ('trg_monthly_performance_details_updated_at')
),
expected_indexes(indexname) AS (
  VALUES
    ('idx_products_master_code'),
    ('idx_product_barcodes_barcode'),
    ('idx_acquisition_scans_barcode'),
    ('idx_acquisition_unmatched_resolved'),
    ('idx_relationship_members_name'),
    ('uq_relationship_members_member_number'),
    ('idx_relationship_sales_member_number'),
    ('uq_clinic_selfpay_price_entries'),
    ('idx_clinic_selfpay_claim_batches_store_month'),
    ('idx_store_perf_thresholds_store'),
    ('idx_performance_details_staff_status')
),
expected_policies(tablename, policyname) AS (
  VALUES
    ('products_master', 'p1g_products_master_read'),
    ('products_master', 'p1g_products_master_write'),
    ('product_barcodes', 'p1g_product_barcodes_read'),
    ('product_barcodes', 'p1g_product_barcodes_write'),
    ('acquisition_scans', 'p1g_acquisition_scans_read'),
    ('acquisition_scans', 'p1g_acquisition_scans_write'),
    ('acquisition_unmatched', 'p1g_acquisition_unmatched_read'),
    ('acquisition_unmatched', 'p1g_acquisition_unmatched_write'),
    ('relationship_members', 'p1g_relationship_members_read'),
    ('relationship_members', 'p1g_relationship_members_insert'),
    ('relationship_members', 'p1g_relationship_members_update'),
    ('relationship_members', 'p1g_relationship_members_delete'),
    ('relationship_sales_imports', 'p1g_relationship_sales_imports_read'),
    ('relationship_sales_imports', 'p1g_relationship_sales_imports_write'),
    ('relationship_sales_details', 'p1g_relationship_sales_details_read'),
    ('relationship_sales_details', 'p1g_relationship_sales_details_write'),
    ('clinic_selfpay_price_entries', 'p1g_clinic_selfpay_price_entries_read'),
    ('clinic_selfpay_price_entries', 'p1g_clinic_selfpay_price_entries_write'),
    ('clinic_selfpay_price_month_closures', 'p1g_clinic_selfpay_price_month_closures_read'),
    ('clinic_selfpay_price_month_closures', 'p1g_clinic_selfpay_price_month_closures_write'),
    ('clinic_selfpay_claim_batches', 'p1g_clinic_selfpay_claim_batches_read'),
    ('clinic_selfpay_claim_batches', 'p1g_clinic_selfpay_claim_batches_write'),
    ('clinic_selfpay_claim_items', 'p1g_clinic_selfpay_claim_items_read'),
    ('clinic_selfpay_claim_items', 'p1g_clinic_selfpay_claim_items_write'),
    ('store_performance_thresholds', 'p1g_store_performance_thresholds_read'),
    ('store_performance_thresholds', 'p1g_store_performance_thresholds_write'),
    ('monthly_performance_details', 'p1g_monthly_performance_details_read'),
    ('monthly_performance_details', 'p1g_monthly_performance_details_write')
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
    CASE WHEN count(*) = 13 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=13 actual=%s', count(*)) AS details
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
    CASE WHEN count(*) = 28 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=28 actual=%s', count(*)) AS details
  FROM expected_policies ep
  JOIN pg_policies p
    ON p.schemaname = 'public'
   AND p.tablename = ep.tablename
   AND p.policyname = ep.policyname

  UNION ALL

  SELECT
    'triggers' AS check_name,
    CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=5 actual=%s', count(*)) AS details
  FROM expected_triggers et
  JOIN information_schema.triggers trg
    ON trg.trigger_schema = 'public'
   AND trg.trigger_name = et.trigger_name

  UNION ALL

  SELECT
    'indexes' AS check_name,
    CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END AS result,
    format('expected=11 actual=%s', count(*)) AS details
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
