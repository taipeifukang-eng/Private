#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();

const sourcePath = 'supabase/migration_supervisor_management_daily_plans.sql';
const migrationPath = 'supabase/migrations/20260813063209_supervisor_management_daily_plans.sql';
const appliedFoundationPath = 'supabase/migrations/20260812093000_supervisor_management_log_foundation.sql';
const rollbackPath = 'supabase/rollback_supervisor_management_daily_plans.sql';
const testSqlPath = 'supabase/test_supervisor_management_daily_plans.sql';
const proposalPath = 'docs/SUPERVISOR-MANAGEMENT-LOG-TODAY-WORKSPACE-PROPOSAL.md';

const appliedFoundationSha256 = 'DDC1C84874CF980BEBD44E3FE6F535E2F4BCBFF6BDED195B412F72A9AE92BE1F';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function normalize(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
}

function hash(value) {
  return crypto.createHash('sha256').update(normalize(value)).digest('hex').toUpperCase();
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
const appliedFoundation = read(appliedFoundationPath);
const rollback = read(rollbackPath);
const testSql = read(testSqlPath);
const proposal = read(proposalPath);

const expectedFunctions = [
  'supervisor_management_daily_plan_is_visible',
  'supervisor_management_daily_plan_is_manageable',
  'supervisor_management_validate_daily_plan',
  'supervisor_management_soft_delete_daily_plan',
];

const expectedIndexes = [
  'idx_supervisor_management_daily_plans_owner_date',
  'idx_supervisor_management_daily_plans_date_status',
  'idx_supervisor_management_daily_plans_store_date',
  'idx_supervisor_management_daily_plans_employee_date',
  'idx_supervisor_management_daily_plans_linked_case',
  'idx_supervisor_management_daily_plans_linked_record',
];

runCase('source and standard migration are identical', () => {
  assert(hash(source) === hash(migration), 'flat source SQL and standard migration must have identical normalized SHA-256');
});

runCase('applied supervisor management foundation remains immutable', () => {
  assert(hash(appliedFoundation) === appliedFoundationSha256, 'applied 20260812093000 supervisor management foundation migration must remain unchanged');
});

runCase('migration timestamp is later than existing SML migrations', () => {
  assert(migrationPath.includes('20260813063209_'), 'expected daily plans migration timestamp 20260813063209');
  assert(migrationPath > 'supabase/migrations/20260812155612_fix_supervisor_management_case_insert_visibility.sql', 'daily plans migration timestamp must be later than existing SML migrations');
});

runCase('migration contains only daily plans foundation scope', () => {
  assert(migration.includes('CREATE TABLE IF NOT EXISTS public.supervisor_management_daily_plans'), 'daily plans table missing');
  assert(migration.includes('target_type IN'), 'target type check missing');
  assert(migration.includes('status IN'), 'status check missing');
  assert(migration.includes("status in ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')") || migration.includes("status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')"), 'daily plan statuses missing');
  assert(migration.includes('supervisor_management_daily_plans_store_target_check'), 'STORE target constraint missing');
  assert(migration.includes('supervisor_management_daily_plans_employee_target_check'), 'EMPLOYEE target constraint missing');
  assert(migration.includes('supervisor_management_daily_plans_linked_record_case_check'), 'linked record/case constraint missing');
  assert(migration.includes('supervisor_management_daily_plans_soft_delete_fields'), 'soft delete fields constraint missing');

  for (const fn of expectedFunctions) {
    assert(migration.includes(`public.${fn}`), `missing function ${fn}`);
  }

  for (const indexName of expectedIndexes) {
    assert(migration.includes(indexName), `missing index ${indexName}`);
  }

  assert(!/CREATE TABLE IF NOT EXISTS public\.supervisor_management_(cases|records|followups|categories|case_events)\b/i.test(migration), 'daily plans migration must not recreate existing SML foundation tables');
  assert(!/general_affairs_|inspection_|inventory_|maintenance_requests|maintenance_updates/i.test(migration), 'daily plans migration must not couple to other modules');
  assert(!/INSERT\s+INTO\s+auth\.users|odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr|service_role|anon key|jwt|password/i.test(migration), 'migration must not contain auth data, project refs or secrets');
});

runCase('RLS and no hard delete policy are enforced', () => {
  assert(migration.includes('ALTER TABLE public.supervisor_management_daily_plans ENABLE ROW LEVEL SECURITY'), 'daily plans table must enable RLS');
  assert(migration.includes('CREATE POLICY supervisor_management_daily_plans_read'), 'read policy missing');
  assert(migration.includes('CREATE POLICY supervisor_management_daily_plans_insert'), 'insert policy missing');
  assert(migration.includes('CREATE POLICY supervisor_management_daily_plans_update'), 'update policy missing');
  assert(!/CREATE POLICY\s+\S+\s+ON\s+public\.supervisor_management_daily_plans\s+FOR\s+DELETE/i.test(migration), 'daily plans must not create DELETE policy');
  assert(migration.includes('No DELETE policy'), 'migration should document no hard delete policy');
});

runCase('permission and store scope use existing SML helpers', () => {
  assert(migration.includes('public.supervisor_management_current_user_has_permission'), 'must use module-local permission helper');
  assert(migration.includes('public.supervisor_management_current_user_manages_store'), 'must use existing store scope helper');
  for (const code of [
    'supervisor.management_log.view_own',
    'supervisor.management_log.view_team',
    'supervisor.management_log.create',
    'supervisor.management_log.update_own',
    'supervisor.management_log.follow_up',
    'supervisor.management_log.manage',
  ]) {
    assert(migration.includes(code), `missing permission code ${code}`);
  }
});

runCase('function grants do not expose anon or PUBLIC', () => {
  for (const fn of expectedFunctions) {
    assert(migration.includes(`REVOKE ALL ON FUNCTION public.${fn}`), `must revoke PUBLIC/anon from ${fn}`);
  }
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.supervisor_management_daily_\w+\([^)]*\)\s+TO\s+anon/i.test(migration), 'must not grant daily plan functions to anon');
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.supervisor_management_daily_\w+\([^)]*\)\s+TO\s+PUBLIC/i.test(migration), 'must not grant daily plan functions to PUBLIC');
  assert(migration.includes('GRANT EXECUTE ON FUNCTION public.supervisor_management_soft_delete_daily_plan(uuid, text) TO authenticated'), 'soft delete RPC must be executable by authenticated');
});

runCase('rollback removes only daily plan objects', () => {
  assert(rollback.includes('DROP TABLE IF EXISTS public.supervisor_management_daily_plans'), 'rollback must drop daily plans table');
  for (const fn of expectedFunctions) {
    assert(rollback.includes(`DROP FUNCTION IF EXISTS public.${fn}`), `rollback missing ${fn}`);
  }
  assert(!/DROP TABLE IF EXISTS public\.supervisor_management_(cases|records|followups|categories|case_events)\b/i.test(rollback), 'rollback must not drop existing SML foundation tables');
  assert(!/DELETE FROM public\.permissions|DROP TABLE IF EXISTS public\.profiles|DROP TABLE IF EXISTS public\.stores/i.test(rollback), 'rollback must not touch shared RBAC, profiles or stores');
});

runCase('test SQL checks catalog, RLS, grants and no delete policies', () => {
  assert(testSql.includes('supervisor_management_daily_plans'), 'test SQL must cover daily plans table');
  assert(testSql.includes('v_delete_policy_count'), 'test SQL must check no DELETE policy');
  assert(testSql.includes('v_unsafe_anon_grant_count'), 'test SQL must check anon/PUBLIC table grants');
  assert(testSql.includes('v_unsafe_public_function_grant_count'), 'test SQL must check function grants');
  assert(testSql.includes('trg_supervisor_management_daily_plans_validate'), 'test SQL must check validation trigger');
  assert(!/DELETE FROM|DROP TABLE|migration repair|db reset|rollback/i.test(testSql), 'test SQL must not perform destructive cleanup or migration operations');
});

runCase('proposal documents why today plan needs a new entity', () => {
  assert(proposal.includes('Management Plan'), 'proposal must define Management Plan');
  assert(proposal.includes('Management Record'), 'proposal must define Management Record');
  assert(proposal.includes('Management Case'), 'proposal must define Management Case');
  assert(proposal.includes('Follow-up'), 'proposal must define Follow-up');
  assert(proposal.includes('supervisor_management_daily_plans'), 'proposal must document daily plans entity');
});

console.log('Supervisor management daily plans static tests passed');
console.log(`Source SHA-256: ${hash(source)}`);
console.log(`Migration SHA-256: ${hash(migration)}`);
