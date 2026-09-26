#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const MIGRATION_NAME = '20260724042430_production_legacy_rbac_rpc_compatibility.sql';
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', MIGRATION_NAME);
const SOURCE_PATH = path.join(ROOT, 'supabase', 'migration_production_legacy_rbac_rpc_compatibility.sql');
const TEST_SQL_PATH = path.join(ROOT, 'supabase', 'test_production_legacy_rbac_rpc_compatibility.sql');
const ROLLBACK_PATH = path.join(ROOT, 'supabase', 'rollback_production_legacy_rbac_rpc_compatibility.sql');
const AUDIT_PATH = path.join(ROOT, 'docs', 'P1-J-API-SCHEMA-PARITY-AUDIT.json');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
}

function sha256(text) {
  return crypto.createHash('sha256').update(normalize(text)).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  for (const file of [MIGRATION_PATH, SOURCE_PATH, TEST_SQL_PATH, ROLLBACK_PATH, AUDIT_PATH]) {
    assert(fs.existsSync(file), `Missing required file: ${path.relative(ROOT, file)}`);
  }

  const migration = read(MIGRATION_PATH);
  const source = read(SOURCE_PATH);
  const testSql = read(TEST_SQL_PATH);
  const rollback = read(ROLLBACK_PATH);
  const audit = JSON.parse(read(AUDIT_PATH));

  assert(sha256(migration) === sha256(source), 'Flat source SQL and standard migration must match');
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.check_user_permission'), 'check_user_permission missing');
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.get_all_employees_for_rbac'), 'get_all_employees_for_rbac missing');
  assert(migration.includes('SECURITY DEFINER'), 'SECURITY DEFINER missing');
  assert(migration.includes('SET search_path = public, pg_temp'), 'fixed search_path missing');
  assert(migration.includes('auth.uid() IS DISTINCT FROM p_user_id'), 'check_user_permission must reject other user ids');
  assert(migration.includes('public.has_permission(p_user_id, p_permission_code)'), 'check_user_permission must delegate to RBAC has_permission');
  assert(migration.includes("public.current_user_has_permission('role.user_role.assign')"), 'get_all_employees_for_rbac must check RBAC user-role permission');
  assert(migration.includes("public.current_user_has_permission('user.user.view')"), 'get_all_employees_for_rbac must check RBAC user-view permission');
  assert(!/profiles\.role/i.test(migration), 'Migration must not use profiles.role for authorization');

  for (const blocked of [
    'odvksgucvfoaqrumpran',
    'mjpdfpxqttbhzeimmtqr',
    'service_role_key',
    'anon_key',
    'access_token',
    'refresh_token',
    'connection string',
    'password',
  ]) {
    assert(!migration.toLowerCase().includes(blocked), `Migration contains blocked marker: ${blocked}`);
  }

  assert(!/CREATE\s+TABLE/i.test(migration), 'Forward fix must not create tables');
  assert(!/INSERT\s+INTO/i.test(migration), 'Forward fix must not insert data');
  assert(!/DROP\s+TABLE/i.test(migration), 'Forward fix must not drop tables');
  assert(!/ALTER\s+TABLE/i.test(migration), 'Forward fix must not alter tables');
  assert(!/GRANT\s+.*\s+TO\s+anon/i.test(migration), 'Forward fix must not grant function execute to anon');
  assert(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.check_user_permission\(uuid,\s*varchar\)\s+TO\s+authenticated/i.test(migration), 'authenticated grant for check_user_permission missing');
  assert(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_all_employees_for_rbac\(\)\s+TO\s+authenticated/i.test(migration), 'authenticated grant for get_all_employees_for_rbac missing');

  assert(testSql.includes('anon_no_execute_grants'), 'Catalog test must check anon execute grants');
  assert(testSql.includes('public_no_execute_grants'), 'Catalog test must check PUBLIC execute grants');
  assert(testSql.includes('profiles.role'), 'Catalog test must verify function definition does not use profiles.role');
  assert(rollback.includes('DROP FUNCTION IF EXISTS public.get_all_employees_for_rbac()'), 'Rollback must drop get_all_employees_for_rbac');
  assert(rollback.includes('DROP FUNCTION IF EXISTS public.check_user_permission(uuid, varchar)'), 'Rollback must drop check_user_permission');

  assert(Array.isArray(audit.missingInDev?.tables) && audit.missingInDev.tables.length === 0, 'API/schema audit should have no missing table refs');
  assert(Array.isArray(audit.missingInDev?.rpcs), 'API/schema audit RPC result missing');
  assert(audit.missingInDev.rpcs.length === 0, 'API/schema audit should have no missing RPC refs after this migration');

  console.log('P1-J legacy RBAC RPC compatibility static checks passed');
  console.log(`SHA-256: ${sha256(migration)}`);
}

main();
