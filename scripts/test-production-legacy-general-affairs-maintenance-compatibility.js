#!/usr/bin/env node

const fs = require('fs');

const migrationPath = 'supabase/migration_production_legacy_general_affairs_maintenance_compatibility.sql';
const testPath = 'supabase/test_production_legacy_general_affairs_maintenance_compatibility.sql';
const rollbackPath = 'supabase/rollback_production_legacy_general_affairs_maintenance_compatibility.sql';
const appliedMigrationPaths = [
  'supabase/migrations/20260722030244_dev_schema_baseline.sql',
  'supabase/migrations/20260722032048_general_affairs_inventory_locations.sql',
  'supabase/migrations/20260722055852_fix_inventory_location_cascade_deletion_reason.sql',
  'supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql',
  'supabase/migrations/20260722091526_revoke_inventory_transaction_sequence_grants.sql',
  'supabase/migrations/20260722092849_restrict_inventory_transaction_function_execute_grants.sql',
  'supabase/migrations/20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql',
  'supabase/migrations/20260724002545_production_core_compatibility.sql',
];

const expectedTables = [
  'ga_service_categories',
  'ga_service_regions',
  'ga_vendors',
  'maintenance_categories',
  'maintenance_progress_stages',
  'maintenance_requests',
  'maintenance_photos',
  'maintenance_updates',
  'maintenance_update_photos',
  'maintenance_ticket_events',
];

const forbiddenTables = [
  'inventory_result_batches',
  'inventory_result_items',
  'inventory_result_settings',
  'inspection_masters',
  'inspection_results',
  'monthly_staff_status',
  'products_master',
  'campaigns',
  'pharmacist_profiles',
  'relationship_members',
  'ga_inventory_transactions',
  'ga_inventory_balances',
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
    'p1e_ga_service_categories_read',
    'p1e_ga_service_regions_read',
    'p1e_ga_vendors_read',
    'p1e_maintenance_requests_read',
    'p1e_maintenance_requests_insert',
    'p1e_maintenance_requests_update',
    'p1e_maintenance_requests_delete',
    'p1e_maintenance_ticket_events_write',
  ]) {
    assert(migration.includes(policy), `migration missing policy ${policy}`);
    assert(testSql.includes(policy), `test SQL missing policy ${policy}`);
  }

  assert(migration.includes('public.current_user_has_permission'), 'migration must use current_user_has_permission for permission checks');
  assert(migration.includes('public.store_managers'), 'maintenance request RLS must include store_managers scope');
  assert(migration.includes('auth.uid()'), 'RLS must use auth.uid()');
  assert(migration.includes('SET search_path = public, pg_temp'), 'helper function must pin search_path');

  assert(!/USING\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive USING true policies');
  assert(!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive WITH CHECK true policies');
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL).+\s+TO\s+anon/i.test(migration), 'migration must not grant table privileges to anon');
  assert(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.maintenance_requests\s+FROM\s+PUBLIC,\s+anon,\s+authenticated/i.test(migration), 'migration must revoke broad maintenance_requests grants');

  assert(!/\bINSERT\s+INTO\b/i.test(migration), 'migration must not contain seed INSERT statements');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(combined), 'files must not create Auth users');
  assert(!/^\s*COPY\s+/im.test(combined), 'files must not contain COPY dumps');
  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(combined), 'files must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key|connection\s+string)\b/i.test(combined), 'files must not contain sensitive markers');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'files must not contain remote migration operations');

  assert(testSql.includes("'no_anon_table_grants'"), 'test SQL must check anon table grants');
  assert(testSql.includes("'helper_security'"), 'test SQL must check helper search_path/security');
  assert(rollback.includes('Keep public.update_updated_at_column'), 'rollback must preserve shared update helper');

  console.log('P1-E legacy General Affairs / Maintenance compatibility static tests passed');
  console.log(JSON.stringify({ checked: [migrationPath, testPath, rollbackPath], expectedTables }, null, 2));
}

main();
