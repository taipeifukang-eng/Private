#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

const migrationPath = 'supabase/migration_production_core_compatibility.sql';
const testPath = 'supabase/test_production_core_compatibility.sql';
const rollbackPath = 'supabase/rollback_production_core_compatibility.sql';
const employeeMovementRlsAlignmentPath = 'supabase/migrations/20260826023000_employee_movement_store_employee_rls_alignment.sql';
const appliedMigrationPaths = [
  'supabase/migrations/20260722030244_dev_schema_baseline.sql',
  'supabase/migrations/20260722032048_general_affairs_inventory_locations.sql',
  'supabase/migrations/20260722055852_fix_inventory_location_cascade_deletion_reason.sql',
  'supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql',
  'supabase/migrations/20260722091526_revoke_inventory_transaction_sequence_grants.sql',
  'supabase/migrations/20260722092849_restrict_inventory_transaction_function_execute_grants.sql',
  'supabase/migrations/20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql',
];

const expectedTables = [
  'permission_logs',
  'store_employees',
  'employee_movement_history',
  'store_relocation_history',
  'store_transfer_requests',
  'templates',
  'assignments',
  'assignment_collaborators',
  'logs',
];

const requiredPermissionCodes = [
  'role.role.view',
  'role.role.create',
  'role.role.edit',
  'role.role.delete',
  'role.permission.view',
  'role.permission.assign',
  'role.user_role.view',
  'role.user_role.assign',
  'role.user_role.revoke',
  'user.user.view',
  'user.user.create',
  'user.user.edit',
  'user.user.delete',
  'user.user.change_role',
  'store.manage',
  'employee.manage',
  'employee.movement.manage',
  'employee.store_transfer.create',
  'employee.store_transfer.confirm',
  'task.view_own',
  'task.manage',
  'task.view_archived',
  'dashboard.view',
  'inventory.result_analysis.view_own',
  'inspection.view_all',
  'activity.manage',
  'cross_dept.maintenance.view_all',
];

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha(file) {
  return crypto.createHash('sha256').update(read(file), 'utf8').digest('hex').toUpperCase();
}

function main() {
  const migration = read(migrationPath);
  const testSql = read(testPath);
  const rollback = read(rollbackPath);
  const employeeMovementRlsAlignment = read(employeeMovementRlsAlignmentPath);

  for (const table of expectedTables) {
    assert(
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'i').test(migration),
      `migration missing table ${table}`,
    );
    assert(
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i').test(migration),
      `migration missing RLS enable for ${table}`,
    );
    assert(
      new RegExp(`DROP TABLE IF EXISTS public\\.${table}\\b`, 'i').test(rollback),
      `rollback missing table ${table}`,
    );
  }

  for (const code of requiredPermissionCodes) {
    assert(migration.includes(`'${code}'`), `migration missing permission code ${code}`);
    assert(testSql.includes(`'${code}'`), `test SQL missing permission code ${code}`);
  }

  assert(migration.includes('SECURITY DEFINER'), 'migration must use SECURITY DEFINER helpers');
  assert(migration.includes('SET search_path = public, pg_temp'), 'helpers must pin search_path');
  assert(migration.includes('public.current_user_has_permission'), 'RLS must use RBAC permission checks');
  assert(migration.includes('auth.uid()'), 'RLS must use auth.uid() for user scope');
  assert(migration.includes('public.store_managers'), 'RLS must include store_managers scope');
  assert(migration.includes('public.p1c_assignment_is_visible'), 'task RLS must use helper to avoid recursion');

  assert(!/GRANT\s+ALL\s+ON\s+TABLE\s+public\..+\s+TO\s+anon/i.test(migration), 'migration must not grant ALL on tables to anon');
  assert(!/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL).+\s+TO\s+anon/i.test(migration), 'migration must not grant table privileges to anon');
  assert(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.store_employees\s+FROM\s+PUBLIC,\s+anon,\s+authenticated/i.test(migration), 'migration must revoke broad table grants');

  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(migration), 'migration must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key)\b/i.test(migration), 'migration must not contain sensitive markers');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(migration), 'migration must not insert auth users');
  assert(!/^\s*COPY\s+/im.test(migration), 'migration must not contain COPY data dumps');

  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(migration), 'migration must not contain CLI operations');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(testSql), 'test SQL must not contain CLI operations');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(rollback), 'rollback must not contain CLI operations');

  assert(employeeMovementRlsAlignment.includes('p1c_store_employees_insert_manage'), 'employee movement RLS alignment must update store employee insert policy');
  assert(employeeMovementRlsAlignment.includes('p1c_store_employees_update_manage'), 'employee movement RLS alignment must update store employee update policy');
  assert(employeeMovementRlsAlignment.includes('p1c_employee_movement_manage'), 'employee movement RLS alignment must update movement history manage policy');
  assert(employeeMovementRlsAlignment.includes('CREATE OR REPLACE FUNCTION public.current_user_has_permission'), 'employee movement RLS alignment must ensure current permission helper');
  assert(employeeMovementRlsAlignment.includes("to_regprocedure('public.has_permission(uuid, character varying)')"), 'employee movement RLS alignment must require base RBAC helper');
  assert(employeeMovementRlsAlignment.includes("current_user_has_permission('employee.promotion.batch'::character varying)"), 'employee movement RLS alignment must allow promotion batch permission');
  assert(employeeMovementRlsAlignment.includes("NOTIFY pgrst, 'reload schema'"), 'employee movement RLS alignment must reload PostgREST schema');

  const applied = appliedMigrationPaths.map((file) => ({ file, sha256: sha(file) }));
  console.log('P1-C production core compatibility static tests passed');
  console.log(JSON.stringify({ checked: [migrationPath, testPath, rollbackPath, employeeMovementRlsAlignmentPath], appliedMigrationHashes: applied }, null, 2));
}

main();
