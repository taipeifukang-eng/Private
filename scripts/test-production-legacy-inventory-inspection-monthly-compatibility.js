#!/usr/bin/env node

const fs = require('fs');

const migrationPath = 'supabase/migration_production_legacy_inventory_inspection_monthly_compatibility.sql';
const testPath = 'supabase/test_production_legacy_inventory_inspection_monthly_compatibility.sql';
const rollbackPath = 'supabase/rollback_production_legacy_inventory_inspection_monthly_compatibility.sql';
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
];

const expectedTables = [
  'inventory_result_batches',
  'inventory_result_items',
  'inventory_result_settings',
  'inspection_templates',
  'inspection_masters',
  'inspection_results',
  'inspection_improvements',
  'inspection_on_duty_staff',
  'inspection_bonus_config',
  'inspection_grade_mapping',
  'monthly_staff_status',
  'monthly_store_summary',
  'monthly_bonus_records',
];

const forbiddenTables = [
  'ga_inventory_transactions',
  'ga_inventory_balances',
  'ga_inventory_locations',
  'ga_inventory_location_parts',
  'ga_vendors',
  'ga_service_categories',
  'ga_service_regions',
  'maintenance_requests',
  'maintenance_updates',
  'products_master',
  'campaigns',
  'pharmacist_profiles',
  'relationship_members',
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
    'p1f_inventory_result_batches_read',
    'p1f_inventory_result_items_read',
    'p1f_inspection_masters_read',
    'p1f_inspection_results_read',
    'p1f_inspection_improvements_read',
    'p1f_monthly_staff_status_read',
    'p1f_monthly_store_summary_read',
    'p1f_monthly_bonus_records_read',
  ]) {
    assert(migration.includes(policy), `migration missing policy ${policy}`);
    assert(testSql.includes(policy), `test SQL missing policy ${policy}`);
  }

  for (const permission of [
    'inventory.result_analysis.view_own',
    'inventory.result_analysis.import',
    'inspection.view_all',
    'inspection.view_store',
    'inspection.view_own',
    'inspection.create',
    'inspection.improvement.view',
    'inspection.improvement.manage',
    'monthly.status.view_all',
    'monthly.status.view_own',
    'monthly.status.confirm',
  ]) {
    assert(migration.includes(permission), `migration missing permission check ${permission}`);
  }

  assert(migration.includes('public.current_user_has_permission'), 'migration must use current_user_has_permission for permission checks');
  assert(migration.includes('public.store_managers'), 'store-scoped RLS must include store_managers');
  assert(migration.includes('auth.uid()'), 'RLS must use auth.uid()');
  assert(migration.includes('to_regprocedure'), 'migration must include prerequisite function checks');

  assert(!/USING\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive USING true policies');
  assert(!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive WITH CHECK true policies');
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL).+\s+TO\s+anon/i.test(migration), 'migration must not grant table privileges to anon');
  assert(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.inventory_result_batches/i.test(migration), 'migration must revoke broad inventory_result_batches grants');

  assert(!/\bINSERT\s+INTO\b/i.test(migration), 'migration must not contain seed INSERT statements');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(combined), 'files must not create Auth users');
  assert(!/^\s*COPY\s+/im.test(combined), 'files must not contain COPY dumps');
  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(combined), 'files must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key|connection\s+string)\b/i.test(combined), 'files must not contain sensitive markers');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'files must not contain remote migration operations');

  assert(testSql.includes("'no_anon_table_grants'"), 'test SQL must check anon table grants');
  assert(testSql.includes("'no_using_true_policies'"), 'test SQL must check permissive policy bodies');
  assert(rollback.includes('Keep public.update_updated_at_column'), 'rollback must preserve shared update helper');

  console.log('P1-F legacy inventory / inspection / monthly compatibility static tests passed');
  console.log(JSON.stringify({ checked: [migrationPath, testPath, rollbackPath], expectedTables }, null, 2));
}

main();
