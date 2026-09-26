#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();

const sourcePath = 'supabase/migration_supervisor_management_log_foundation.sql';
const migrationPath = 'supabase/migrations/20260812093000_supervisor_management_log_foundation.sql';
const rlsHelperGrantFixPath = 'supabase/migrations/20260812153524_grant_supervisor_management_rls_helper_execute.sql';
const permissionHelperFixPath = 'supabase/migrations/20260812154708_fix_supervisor_management_permission_helper.sql';
const caseInsertVisibilityFixPath = 'supabase/migrations/20260812155612_fix_supervisor_management_case_insert_visibility.sql';
const rollbackPath = 'supabase/rollback_supervisor_management_log_foundation.sql';
const testSqlPath = 'supabase/test_supervisor_management_log_foundation.sql';
const navbarPermissionsPath = 'hooks/useNavbarPermissions.ts';
const uiTestPath = 'scripts/test-supervisor-management-log-ui.js';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function normalizeSql(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
}

function hash(value) {
  return crypto.createHash('sha256').update(normalizeSql(value)).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCase(name, fn) {
  process.stdout.write(`RUN ${name}\n`);
  fn();
  process.stdout.write(`PASS ${name}\n`);
}

const source = read(sourcePath);
const migration = read(migrationPath);
const rlsHelperGrantFix = read(rlsHelperGrantFixPath);
const permissionHelperFix = read(permissionHelperFixPath);
const caseInsertVisibilityFix = read(caseInsertVisibilityFixPath);
const rollback = read(rollbackPath);
const testSql = read(testSqlPath);
const navbarPermissions = read(navbarPermissionsPath);
const uiTest = read(uiTestPath);

const appliedMigrationSha256 = 'DDC1C84874CF980BEBD44E3FE6F535E2F4BCBFF6BDED195B412F72A9AE92BE1F';

const expectedTables = [
  'supervisor_management_categories',
  'supervisor_management_cases',
  'supervisor_management_records',
  'supervisor_management_followups',
  'supervisor_management_case_events',
];

const expectedPermissionCodes = [
  'supervisor.management_log.view_own',
  'supervisor.management_log.view_team',
  'supervisor.management_log.create',
  'supervisor.management_log.update_own',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
  'supervisor.management_category.manage',
];

const expectedFunctions = [
  'supervisor_management_current_user_manages_store',
  'supervisor_management_case_is_visible',
  'supervisor_management_case_is_manageable',
  'supervisor_management_validate_category',
  'supervisor_management_validate_case',
  'supervisor_management_validate_record',
  'supervisor_management_validate_followup',
  'supervisor_management_soft_delete_case',
  'supervisor_management_soft_delete_record',
];

const rlsHelperFunctions = [
  'supervisor_management_current_user_manages_store',
  'supervisor_management_case_is_visible',
  'supervisor_management_case_is_manageable',
];

runCase('applied migration stays immutable and flat source contains RLS helper grants', () => {
  assert(hash(migration) === appliedMigrationSha256, 'applied 20260812093000 migration must remain unchanged');
  assert(source.includes('CREATE OR REPLACE FUNCTION public.supervisor_management_current_user_has_permission'), 'flat source SQL must contain module-local permission helper');
  for (const fn of rlsHelperFunctions) {
    assert(source.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(uuid) TO authenticated;`), `flat source SQL must grant authenticated execute on ${fn}`);
  }
});

runCase('migration timestamp is after current applied migrations', () => {
  assert(migrationPath.includes('20260812093000_'), 'expected migration timestamp 20260812093000');
  assert(migrationPath > 'supabase/migrations/20260810090000_allow_part_resource_attachments.sql', 'migration timestamp must be later than latest applied migration');
});

runCase('migration contains only supervisor management log foundation scope', () => {
  for (const tableName of expectedTables) {
    assert(migration.includes(`public.${tableName}`), `missing table ${tableName}`);
  }
  for (const fn of expectedFunctions) {
    assert(migration.includes(`public.${fn}`), `missing function ${fn}`);
  }
  for (const code of expectedPermissionCodes) {
    assert(migration.includes(code), `missing permission code ${code}`);
  }

  assert(!/inspection_|inventory_|general_affairs_|maintenance_requests|maintenance_updates/i.test(migration), 'migration must not couple to inspection, inventory, maintenance, or general affairs tables');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset|INSERT\s+INTO\s+auth\.users|odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(migration), 'migration must not contain remote ops, auth data, or project refs');
});

runCase('RLS and no hard delete policy are enforced in SQL', () => {
  for (const tableName of expectedTables) {
    assert(migration.includes(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY`), `${tableName} must enable RLS`);
  }
  assert(!/CREATE POLICY\s+\S+\s+ON\s+public\.supervisor_management_\S+\s+FOR\s+DELETE/i.test(migration), 'must not create DELETE policies');
  assert(migration.includes('No DELETE policies'), 'migration should document no hard delete policy');
});

runCase('store scope and employee relation use existing schema', () => {
  assert(migration.includes('public.store_managers'), 'visibility helper must use store_managers');
  assert(migration.includes('public.store_employees'), 'employee target must reference existing store_employees');
  assert(migration.includes("role_type IN ('store_manager', 'supervisor', 'area_manager')"), 'store scope must honor existing role_type values');
  assert(migration.includes('target_name_snapshot'), 'records must preserve target snapshot for audit history');
});

runCase('system fields and soft delete are protected', () => {
  assert(migration.includes('SYSTEM_FIELDS_IMMUTABLE'), 'validation triggers must block client system field forgery');
  assert(migration.includes('supervisor_management_soft_delete_case'), 'case soft delete RPC missing');
  assert(migration.includes('supervisor_management_soft_delete_record'), 'record soft delete RPC missing');
  assert(migration.includes('AND deleted_at IS NULL'), 'soft delete must only affect undeleted rows');
});

runCase('forward fix only grants RLS helper execute', () => {
  for (const fn of rlsHelperFunctions) {
    assert(rlsHelperGrantFix.includes(`REVOKE ALL ON FUNCTION public.${fn}(uuid) FROM PUBLIC, anon;`), `forward fix must revoke PUBLIC/anon for ${fn}`);
    assert(rlsHelperGrantFix.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(uuid) TO authenticated;`), `forward fix must grant authenticated execute on ${fn}`);
  }

  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.supervisor_management_\w+\([^)]*\)\s+TO\s+anon/i.test(rlsHelperGrantFix), 'forward fix must not grant function execute to anon');
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.supervisor_management_\w+\([^)]*\)\s+TO\s+PUBLIC/i.test(rlsHelperGrantFix), 'forward fix must not grant function execute to PUBLIC');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+POLICY|DROP\s+POLICY|INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|migration\s+repair|db\s+reset/i.test(rlsHelperGrantFix), 'forward fix must only adjust function grants');
});

runCase('permission helper forward fix only rebuilds SML permission surfaces', () => {
  assert(permissionHelperFix.includes('CREATE OR REPLACE FUNCTION public.supervisor_management_current_user_has_permission'), 'permission helper fix must create module-local permission helper');
  assert(permissionHelperFix.includes("p.role = 'admin'"), 'permission helper must preserve admin compatibility');
  assert(permissionHelperFix.includes('public.user_roles ur'), 'permission helper must use formal user_roles');
  assert(permissionHelperFix.includes('public.role_permissions rp'), 'permission helper must use formal role_permissions');
  assert(permissionHelperFix.includes('public.permissions perm'), 'permission helper must use permissions table');
  assert(permissionHelperFix.includes('public.supervisor_management_current_user_has_permission'), 'SML functions and policies must use module-local permission helper');
  assert(!permissionHelperFix.includes('public.current_user_has_permission('), 'forward fix must not keep legacy current_user_has_permission calls in SML functions or policies');
  assert(!/CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE|INSERT\\s+INTO\\s+public\\.(?!supervisor_management_case_events)|DELETE\\s+FROM|migration\\s+repair|db\\s+reset/i.test(permissionHelperFix), 'permission helper fix must not change tables, seed data or migration history');
  assert(!/general_affairs_|inspection_|inventory_|maintenance_requests|maintenance_updates/i.test(permissionHelperFix), 'permission helper fix must not couple to other modules');
});

runCase('case insert visibility forward fix aligns create permission and owner guard', () => {
  assert(caseInsertVisibilityFix.includes("supervisor.management_log.create"), 'case insert visibility fix must reference create permission');
  assert(caseInsertVisibilityFix.includes('c.owner_user_id = auth.uid()'), 'case visibility must allow owner-based access');
  assert(caseInsertVisibilityFix.includes('NEW.owner_user_id IS DISTINCT FROM auth.uid()'), 'case validation must reject owner spoofing for non-manage users');
  assert(caseInsertVisibilityFix.includes('AND owner_user_id = auth.uid()'), 'case insert policy must restrict create users to their own owner_user_id');
  assert(caseInsertVisibilityFix.includes('supervisor_management_current_user_has_permission'), 'case insert visibility fix must use module-local permission helper');
  assert(!caseInsertVisibilityFix.includes('public.current_user_has_permission('), 'case insert visibility fix must not use legacy current_user_has_permission');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|INSERT\s+INTO|DELETE\s+FROM|migration\s+repair|db\s+reset/i.test(caseInsertVisibilityFix), 'case insert visibility fix must not change tables, seed data or migration history');
  assert(!/general_affairs_|inspection_|inventory_|maintenance_requests|maintenance_updates/i.test(caseInsertVisibilityFix), 'case insert visibility fix must not couple to other modules');
});

runCase('rollback removes only supervisor management log objects', () => {
  for (const tableName of expectedTables) {
    assert(rollback.includes(`public.${tableName}`), `rollback missing ${tableName}`);
  }
  for (const code of expectedPermissionCodes) {
    assert(rollback.includes(code), `rollback missing permission ${code}`);
  }
  assert(!/DROP TABLE IF EXISTS public\.stores|DROP TABLE IF EXISTS public\.profiles|DROP TABLE IF EXISTS public\.roles|DROP TABLE IF EXISTS public\.permissions/i.test(rollback), 'rollback must not drop shared RBAC or store tables');
});

runCase('test SQL checks catalog, RLS, grants and no delete policies', () => {
  for (const tableName of expectedTables) {
    assert(testSql.includes(tableName), `test SQL missing ${tableName}`);
  }
  assert(testSql.includes('v_delete_policy_count'), 'test SQL must check delete policy count');
  assert(testSql.includes('v_unsafe_anon_grant_count'), 'test SQL must check anon grants');
  assert(testSql.includes('v_missing_helper_execute_count'), 'test SQL must check authenticated RLS helper function grants');
  assert(testSql.includes('v_unsafe_helper_execute_count'), 'test SQL must check PUBLIC/anon RLS helper function grants');
  assert(testSql.includes('supervisor_management_current_user_has_permission'), 'test SQL must check module-local permission helper');
  assert(!/DELETE FROM|DROP TABLE|migration repair|db reset|rollback/i.test(testSql), 'test SQL must not perform destructive cleanup or migration operations');
});

runCase('navbar permissions include every entry permission', () => {
  for (const code of expectedPermissionCodes.filter((code) => code.startsWith('supervisor.management_log.'))) {
    assert(navbarPermissions.includes(code), `navbar permission gate missing ${code}`);
    assert(uiTest.includes(code), `UI static test missing ${code}`);
  }
});

console.log('Supervisor management log foundation static tests passed');
console.log(`Source SHA-256: ${hash(source)}`);
console.log(`Migration SHA-256: ${hash(migration)}`);
