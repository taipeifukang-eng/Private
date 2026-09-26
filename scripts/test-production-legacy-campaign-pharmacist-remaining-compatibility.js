#!/usr/bin/env node

const fs = require('fs');

const migrationPath = 'supabase/migration_production_legacy_campaign_pharmacist_remaining_compatibility.sql';
const standardMigrationPath = 'supabase/migrations/20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql';
const testPath = 'supabase/test_production_legacy_campaign_pharmacist_remaining_compatibility.sql';
const rollbackPath = 'supabase/rollback_production_legacy_campaign_pharmacist_remaining_compatibility.sql';
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
  'supabase/migrations/20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql',
];

const expectedTables = [
  'campaigns',
  'campaign_schedules',
  'campaign_store_details',
  'campaign_store_headcount',
  'campaign_store_own_staff',
  'campaign_support_requests',
  'campaign_support_staff',
  'campaign_equipment_trips',
  'campaign_checklist_items',
  'campaign_checklist_completions',
  'campaign_department_publish',
  'event_dates',
  'store_activity_settings',
  'pharmacist_profiles',
  'pharmacist_annual_master',
  'pharmacist_annual_fees',
  'pharmacist_annual_master_locks',
  'pharmacist_annual_master_sync_log',
  'pharmacist_monthly_snapshot',
  'pharmacist_monthly_snapshot_sync_log',
  'pharmacist_snapshot_locks',
  'stockout_reports',
  'stockout_product_responses',
  'stockout_product_response_history',
  'meal_allowance_records',
  'spring_festival_bonus',
  'support_staff_bonus',
  'talent_cultivation_bonus',
  'store_performance',
];

const forbiddenTables = [
  'assignment_cleanup_backup_20260401',
  'maintenance_status_migration_backup',
  'store_transfer_requests',
  'ga_inventory_transactions',
  'ga_inventory_balances',
  'ga_vendors',
  'maintenance_requests',
  'inventory_result_batches',
  'inspection_masters',
  'monthly_staff_status',
  'products_master',
  'relationship_members',
  'clinic_selfpay_claim_batches',
  'monthly_performance_details',
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

  for (const file of [migrationPath, standardMigrationPath, testPath, rollbackPath, ...appliedMigrationPaths]) {
    assert(fs.existsSync(file), `Missing file: ${file}`);
    assert(fs.statSync(file).size > 0, `${file} must not be empty`);
  }

  assert(read(standardMigrationPath) === migration, 'standard migration must match source migration exactly');

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
    'p1h_campaigns_read',
    'p1h_campaign_store_details_read',
    'p1h_campaign_department_publish_read',
    'p1h_pharmacist_profiles_read',
    'p1h_pharmacist_annual_master_read',
    'p1h_pharmacist_monthly_snapshot_read',
    'p1h_stockout_reports_read',
    'p1h_stockout_product_responses_read',
    'p1h_meal_allowance_read',
    'p1h_spring_festival_bonus_read',
    'p1h_store_performance_read',
  ]) {
    assert(migration.includes(policy), `migration missing policy ${policy}`);
    assert(testSql.includes(policy), `test SQL missing policy ${policy}`);
  }

  for (const permission of [
    'activity.management.access',
    'activity.manage',
    'activity.campaign.view',
    'activity.campaign.view_all',
    'activity.campaign.edit',
    'activity.store_detail.edit',
    'activity.equipment_trip.edit',
    'activity.checklist.edit',
    'activity.support_request.edit',
    'activity.support_assign.edit',
    'activity.marketing.publish',
    'activity.merchandise.publish',
    'activity.staff_overview.view',
    'pharmacist.management.view',
    'pharmacist.management.edit',
    'pharmacist.management.master.view',
    'pharmacist.management.master.edit',
    'cross_dept.stockout.view_all',
    'cross_dept.stockout.submit',
    'cross_dept.stockout.respond',
    'monthly.allowance.view_support_hours',
    'monthly.allowance.edit_support_hours',
    'performance.view',
    'performance.edit',
    'performance.bonus.view',
    'performance.bonus.import',
  ]) {
    assert(migration.includes(permission), `migration missing permission check ${permission}`);
  }

  assert(migration.includes('public.current_user_has_permission'), 'migration must use current_user_has_permission for permission checks');
  assert(migration.includes('public.store_managers'), 'store-scoped RLS must include store_managers');
  assert(migration.includes('auth.uid()'), 'RLS must use auth.uid()');
  assert(migration.includes('SET search_path = public, pg_temp'), 'functions must set search_path');
  assert(migration.includes('to_regprocedure'), 'migration must include prerequisite function checks');
  assert(migration.includes('p1h_sync_stockout_report_status'), 'migration must include stockout status sync helper');

  assert(!/USING\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive USING true policies');
  assert(!/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(migration), 'migration must not create permissive WITH CHECK true policies');
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL).+\s+TO\s+anon/i.test(migration), 'migration must not grant table privileges to anon');
  assert(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.campaigns/i.test(migration), 'migration must revoke broad campaign grants');

  assert(!/\bINSERT\s+INTO\b/i.test(migration), 'migration must not contain seed INSERT statements');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(combined), 'files must not create Auth users');
  assert(!/^\s*COPY\s+/im.test(combined), 'files must not contain COPY dumps');
  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(combined), 'files must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key|connection\s+string)\b/i.test(combined), 'files must not contain sensitive markers');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'files must not contain remote migration operations');

  assert(testSql.includes("'no_anon_table_grants'"), 'test SQL must check anon table grants');
  assert(testSql.includes("'no_using_true_policies'"), 'test SQL must check permissive policy bodies');
  assert(rollback.includes('Keep public.update_updated_at_column'), 'rollback must preserve shared update helper');

  console.log('P1-H legacy campaign / pharmacist / stockout / bonus compatibility static tests passed');
  console.log(JSON.stringify({ checked: [migrationPath, testPath, rollbackPath], expectedTables }, null, 2));
}

main();
