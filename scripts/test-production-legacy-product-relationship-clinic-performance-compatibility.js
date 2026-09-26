#!/usr/bin/env node

const fs = require('fs');

const migrationPath = 'supabase/migration_production_legacy_product_relationship_clinic_performance_compatibility.sql';
const testPath = 'supabase/test_production_legacy_product_relationship_clinic_performance_compatibility.sql';
const rollbackPath = 'supabase/rollback_production_legacy_product_relationship_clinic_performance_compatibility.sql';
const appliedMigrationPaths = [
  'supabase/migrations/20260722030244_dev_schema_baseline.sql',
  'supabase/migrations/20260722032048_general_affairs_inventory_locations.sql',
  'supabase/migrations/20260722055852_fix_inventory_location_cascade_deletion_reason.sql',
  'supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql',
  'supabase/migrations/20260722091526_revoke_inventory_transaction_sequence_grants.sql',
  'supabase/migrations/20260722092849_restrict_inventory_transaction_function_execute_grants.sql',
  'supabase/migrations/20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql',
  'supabase/migrations/20260724002545_production_core_compatibility.sql',
  'supabase/migrations/20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql',
  'supabase/migrations/20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql',
];

const expectedTables = [
  'products_master',
  'product_barcodes',
  'acquisition_scans',
  'acquisition_unmatched',
  'relationship_members',
  'relationship_sales_imports',
  'relationship_sales_details',
  'clinic_selfpay_price_entries',
  'clinic_selfpay_price_month_closures',
  'clinic_selfpay_claim_batches',
  'clinic_selfpay_claim_items',
  'store_performance_thresholds',
  'monthly_performance_details',
];

const forbiddenTables = [
  'campaigns',
  'campaign_schedules',
  'campaign_store_details',
  'pharmacist_profiles',
  'pharmacist_monthly_snapshot',
  'pharmacist_annual_master',
  'ga_inventory_transactions',
  'ga_inventory_balances',
  'ga_vendors',
  'maintenance_requests',
  'inventory_result_batches',
  'inspection_masters',
  'monthly_staff_status',
];

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const migration = read(migrationPath);
  const testSql = read(testPath);
  const rollback = read(rollbackPath);
  const combined = `${migration}\n${testSql}\n${rollback}`;

  for (const file of [migrationPath, testPath, rollbackPath, ...appliedMigrationPaths]) {
    assert(fs.existsSync(file), `Missing file: ${file}`);
    assert(fs.statSync(file).size > 0, `${file} must not be empty`);
  }

  for (const table of expectedTables) {
    assert(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'i').test(migration), `migration missing table ${table}`);
    assert(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i').test(migration), `migration missing RLS enable for ${table}`);
    assert(new RegExp(`DROP TABLE IF EXISTS public\\.${table}\\b`, 'i').test(rollback), `rollback missing table ${table}`);
    assert(testSql.includes(`'${table}'`), `test SQL missing table ${table}`);
  }

  for (const table of forbiddenTables) {
    assert(!new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'i').test(migration), `migration must not create out-of-scope table ${table}`);
  }

  for (const policy of [
    'p1g_products_master_read',
    'p1g_product_barcodes_read',
    'p1g_acquisition_scans_read',
    'p1g_relationship_members_read',
    'p1g_relationship_sales_details_read',
    'p1g_clinic_selfpay_price_entries_read',
    'p1g_clinic_selfpay_claim_batches_read',
    'p1g_store_performance_thresholds_read',
    'p1g_monthly_performance_details_read',
  ]) {
    assert(migration.includes(policy), `migration missing policy ${policy}`);
    assert(testSql.includes(policy), `test SQL missing policy ${policy}`);
  }

  for (const permission of [
    'store.products_master.manage',
    'relationship_member.view',
    'relationship_member.edit',
    'relationship_member.delete',
    'relationship_member.approve',
    'store.clinic_selfpay.margin',
    'store.clinic_selfpay.calculator.use',
    'store.clinic_selfpay.mapping.manage',
    'store.clinic_selfpay.batch.delete',
    'performance.view',
    'performance.edit',
    'performance.bonus.import',
    'monthly.status.view_performance',
  ]) {
    assert(migration.includes(permission), `migration missing permission check ${permission}`);
  }

  assert(migration.includes('public.current_user_has_permission'), 'migration must use current_user_has_permission for permission checks');
  assert(migration.includes('public.store_managers'), 'store-scoped RLS must include store_managers');
  assert(migration.includes('auth.uid()'), 'RLS must use auth.uid()');
  assert(migration.includes('public.monthly_staff_status'), 'monthly performance details must depend on monthly_staff_status');
  assert(migration.includes('to_regprocedure'), 'migration must include prerequisite function checks');

  assert(!/USING\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive USING true policies');
  assert(!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive WITH CHECK true policies');
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL).+\s+TO\s+anon/i.test(migration), 'migration must not grant table privileges to anon');
  assert(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.products_master/i.test(migration), 'migration must revoke broad products_master grants');

  assert(!/\bINSERT\s+INTO\b/i.test(migration), 'migration must not contain seed INSERT statements');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(combined), 'files must not create Auth users');
  assert(!/^\s*COPY\s+/im.test(combined), 'files must not contain COPY dumps');
  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(combined), 'files must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key|connection\s+string)\b/i.test(combined), 'files must not contain sensitive markers');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'files must not contain remote migration operations');

  assert(testSql.includes("'no_anon_table_grants'"), 'test SQL must check anon table grants');
  assert(testSql.includes("'no_using_true_policies'"), 'test SQL must check permissive policy bodies');
  assert(rollback.includes('Keep public.update_updated_at_column'), 'rollback must preserve shared update helper');

  console.log('P1-G legacy product / relationship / clinic / performance compatibility static tests passed');
  console.log(JSON.stringify({ checked: [migrationPath, testPath, rollbackPath], expectedTables }, null, 2));
}

main();
