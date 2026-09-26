#!/usr/bin/env node

const fs = require('fs');

const seedPath = 'supabase/seed_dev_store_employee_compatibility.sql';
const testPath = 'supabase/test_dev_store_employee_compatibility.sql';
const cleanupPath = 'supabase/cleanup_dev_store_employee_compatibility.sql';

const expectedFiles = [seedPath, testPath, cleanupPath];
const expectedEmails = [
  'dev-no-ga@example.test',
  'dev-ga-access@example.test',
  'dev-ga-view@example.test',
  'dev-ga-manage@example.test',
  'dev-full-admin@example.test',
];
const expectedEmployeeCodes = ['DEV0001', 'DEV0002', 'DEV0003', 'DEV0004', 'DEV9999'];
const expectedStoreCodes = ['DEV001', 'DEV002', 'DEV003', 'DEV004', 'DEVHQ'];

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const seed = read(seedPath);
  const testSql = read(testPath);
  const cleanup = read(cleanupPath);
  const combined = `${seed}\n${testSql}\n${cleanup}`;

  for (const file of expectedFiles) {
    assert(fs.statSync(file).size > 0, `${file} must not be empty`);
  }

  for (const email of expectedEmails) {
    assert(seed.includes(email), `seed missing ${email}`);
    assert(testSql.includes(email), `test SQL missing ${email}`);
  }

  for (const employeeCode of expectedEmployeeCodes) {
    assert(seed.includes(employeeCode), `seed missing ${employeeCode}`);
    assert(testSql.includes(employeeCode), `test SQL missing ${employeeCode}`);
    assert(cleanup.includes(employeeCode), `cleanup missing ${employeeCode}`);
  }

  for (const storeCode of expectedStoreCodes) {
    assert(seed.includes(storeCode), `seed missing ${storeCode}`);
    assert(testSql.includes(storeCode), `test SQL missing ${storeCode}`);
  }

  assert(/DO \$\$/i.test(seed), 'seed must have prerequisite guard block');
  assert(seed.includes("to_regclass('public.store_employees')"), 'seed must check store_employees prerequisite');
  assert(seed.includes("to_regclass('public.employee_movement_history')"), 'seed must check employee_movement_history prerequisite');
  assert(seed.includes('Missing DEV Auth users'), 'seed must fail clearly when fake DEV Auth users are missing');

  assert(/UPDATE\s+public\.store_employees\s+se[\s\S]+WHERE\s+se\.employee_code\s*=\s*du\.employee_code/i.test(seed), 'seed must update store_employees by employee_code');
  assert(/INSERT\s+INTO\s+public\.store_employees[\s\S]+WHERE\s+NOT\s+EXISTS\s*\([\s\S]+se\.employee_code\s*=\s*du\.employee_code/i.test(seed), 'seed must insert only missing store_employees by employee_code');
  assert(!/INSERT\s+INTO\s+public\.store_employees[\s\S]+ON\s+CONFLICT\s*\(\s*id\s*\)\s+DO\s+NOTHING/i.test(seed), 'seed must not rely on random id conflict for store_employees idempotency');

  assert(/ON\s+CONFLICT\s*\(\s*store_code\s*\)\s+DO\s+UPDATE/i.test(seed), 'stores seed must be idempotent by store_code');
  assert(/ON\s+CONFLICT\s*\(\s*store_id\s*,\s*user_id\s*,\s*role_type\s*\)\s+DO\s+UPDATE/i.test(seed), 'store_managers seed must be idempotent by scope');
  assert(seed.includes("'DEV fake seed onboarding record'"), 'movement history must be clearly marked as DEV fake seed');

  assert(/SELECT\s+\*\s+FROM\s+checks/i.test(testSql), 'test SQL must emit a consolidated checks result');
  for (const checkName of [
    'stores',
    'profiles',
    'store_employees',
    'store_employee_no_duplicates',
    'store_manager_scopes',
    'movement_history',
    'permission_references',
    'dev_full_admin_permissions',
  ]) {
    assert(testSql.includes(`'${checkName}'`), `test SQL missing check ${checkName}`);
  }

  assert(!/DELETE\s+FROM\s+auth\.users/i.test(cleanup), 'cleanup must not delete Auth users');
  assert(!/DELETE\s+FROM\s+public\.profiles/i.test(cleanup), 'cleanup must not delete profiles');
  assert(!/DELETE\s+FROM\s+public\.roles/i.test(cleanup), 'cleanup must not delete roles');
  assert(!/DELETE\s+FROM\s+public\.permissions/i.test(cleanup), 'cleanup must not delete permissions');
  assert(!/DELETE\s+FROM\s+public\.role_permissions/i.test(cleanup), 'cleanup must not delete role permissions');
  assert(!/DELETE\s+FROM\s+public\.stores\s+s\s+WHERE\s+s\.store_code\s+IN\s*\([^)]*DEV001/i.test(cleanup), 'cleanup must not delete DEV001 baseline store');
  assert(!/DELETE\s+FROM\s+public\.stores\s+s\s+WHERE\s+s\.store_code\s+IN\s*\([^)]*DEV002/i.test(cleanup), 'cleanup must not delete DEV002 baseline store');

  assert(!/odvksgucvfoaqrumpran|mjpdfpxqttbhzeimmtqr/i.test(combined), 'DEV seed files must not contain project refs');
  assert(!/\b(password|access_token|refresh_token|anon_key|jwt|service[_ -]?role[_ -]?key|connection\s+string)\b/i.test(combined), 'DEV seed files must not contain sensitive markers');
  assert(!/\bINSERT\s+INTO\s+auth\.users\b/i.test(combined), 'DEV seed files must not create Auth users');
  assert(!/^\s*COPY\s+/im.test(combined), 'DEV seed files must not contain COPY data dumps');
  assert(!/supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'DEV seed files must not contain remote migration operations');

  const nonDevEmails = combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.filter((email) => !email.toLowerCase().endsWith('@example.test')) ?? [];
  assert(nonDevEmails.length === 0, `DEV seed files contain non-test emails: ${nonDevEmails.join(', ')}`);

  console.log('P1-D DEV store / employee compatibility static tests passed');
  console.log(JSON.stringify({ checked: expectedFiles }, null, 2));
}

main();
