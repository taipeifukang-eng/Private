#!/usr/bin/env node

/**
 * DEV RBAC management navigation/page/API guard verification.
 *
 * Local DEV only. The script prepares dedicated DEV-only users/roles,
 * prompts for one temporary test password without echoing it, and never logs
 * passwords, JWTs, refresh tokens, cookies, or Supabase keys.
 */

const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const MAX_COOKIE_CHUNK_SIZE = 3180;
const BASE_URL = process.env.RBAC_TEST_BASE_URL || 'http://localhost:3002';
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|authorization|api[-_]?key|anon[-_ ]?key|service[-_ ]?role[-_ ]?key|jwt|cookie|set-cookie|token)/i;

const USERS = {
  noAccess: { label: 'no_access', email: 'dev-rbac-no-access@example.test', roleCode: null },
  userViewOnly: { label: 'user_view_only', email: 'dev-rbac-user-view@example.test', roleCode: 'dev_rbac_user_view_temp' },
  roleViewOnly: { label: 'role_view_only', email: 'dev-rbac-role-view@example.test', roleCode: 'dev_rbac_role_view_temp' },
  roleManage: { label: 'role_manage', email: 'dev-rbac-role-manage@example.test', roleCode: 'dev_rbac_role_manage_temp' },
  admin: { label: 'admin', email: 'dev-rbac-admin@example.test', roleCode: 'admin' },
};

const TEMP_ROLES = {
  userViewOnly: {
    code: 'dev_rbac_user_view_temp',
    name: 'DEV RBAC User View Temp',
    permissions: ['user.user.view'],
  },
  roleViewOnly: {
    code: 'dev_rbac_role_view_temp',
    name: 'DEV RBAC Role View Temp',
    permissions: ['role.role.view'],
  },
  roleManage: {
    code: 'dev_rbac_role_manage_temp',
    name: 'DEV RBAC Role Manage Temp',
    permissions: [
      'role.role.view',
      'role.role.create',
      'role.role.edit',
      'role.role.delete',
      'role.permission.view',
      'role.permission.assign',
      'role.user_role.view',
      'role.user_role.assign',
      'role.user_role.revoke',
    ],
  },
};

function runGuard(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const onData = (char) => {
      char = String(char);
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          break;
        default:
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(query + '*'.repeat(rl.line.length));
          break;
      }
    };

    process.stdin.on('data', onData);
    rl.question(query, (value) => {
      rl.close();
      resolve(value);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeForLog(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) return '[REDACTED]';
    return value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, seen));
  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForLog(nestedValue, seen);
  }
  return output;
}

function safeJson(value) {
  try {
    return JSON.stringify(sanitizeForLog(value), null, 2);
  } catch {
    return '[Unserializable]';
  }
}

function createCookieChunks(key, value) {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) return [{ name: key, value }];
  const chunks = [];
  let remaining = encodedValue;
  let index = 0;
  while (remaining.length > 0) {
    let encodedHead = remaining.slice(0, MAX_COOKIE_CHUNK_SIZE);
    const lastEscapePos = encodedHead.lastIndexOf('%');
    if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) encodedHead = encodedHead.slice(0, lastEscapePos);
    chunks.push({
      name: `${key}.${index}`,
      value: decodeURIComponent(encodedHead),
    });
    remaining = remaining.slice(encodedHead.length);
    index += 1;
  }
  return chunks;
}

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const host = new URL(url).hostname;
  return host.split('.')[0];
}

function makeCookieHeader(session) {
  const storageKey = `sb-${getProjectRef()}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  return createCookieChunks(storageKey, value)
    .map((chunk) => `${chunk.name}=${encodeURIComponent(chunk.value)}`)
    .join('; ');
}

async function signIn(email, password) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`sign in did not return a session for ${email}`);
  return { userId: data.user.id, cookieHeader: makeCookieHeader(data.session) };
}

async function request(cookieHeader, path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: 'manual',
    headers: {
      ...(options.headers || {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let body = text;
  if (contentType.includes('application/json') && text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, contentType, body, location: response.headers.get('location') };
}

function expectStatus(result, expected, label) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(result.status)) {
    throw new Error(`${label} expected ${expectedStatuses.join('/')} got ${result.status}: ${safeJson(result.body)}`);
  }
}

async function ensureAuthUser(admin, email, password, metadata) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`list auth users failed: ${listError.message}`);
  const existing = (listed.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw new Error(`update auth user ${email} failed: ${error.message}`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`create auth user ${email} failed: ${error.message}`);
  return data.user;
}

async function setupRole(admin, roleConfig, createdBy) {
  const { data: role, error: roleError } = await admin
    .from('roles')
    .upsert({
      code: roleConfig.code,
      name: roleConfig.name,
      description: `Temporary DEV verification role ${roleConfig.code}`,
      is_system: false,
      is_active: true,
      created_by: createdBy,
    }, { onConflict: 'code' })
    .select('id, code')
    .single();
  if (roleError) throw new Error(`upsert role ${roleConfig.code} failed: ${safeJson(roleError)}`);

  const { data: permissions, error: permissionError } = await admin
    .from('permissions')
    .select('id, code')
    .in('code', roleConfig.permissions);
  if (permissionError) throw new Error(`load permissions for ${roleConfig.code} failed: ${safeJson(permissionError)}`);

  const byCode = new Map((permissions || []).map((permission) => [permission.code, permission.id]));
  for (const code of roleConfig.permissions) {
    assert(byCode.has(code), `missing permission code ${code}`);
  }

  await admin.from('role_permissions').delete().eq('role_id', role.id);
  if (roleConfig.permissions.length > 0) {
    const { error: rolePermissionError } = await admin
      .from('role_permissions')
      .insert(roleConfig.permissions.map((code) => ({
        role_id: role.id,
        permission_id: byCode.get(code),
        is_allowed: true,
        created_by: createdBy,
      })));
    if (rolePermissionError) throw new Error(`insert role permissions ${roleConfig.code} failed: ${safeJson(rolePermissionError)}`);
  }

  return role;
}

async function assignRole(admin, userId, roleId, assignedBy) {
  const { error } = await admin
    .from('user_roles')
    .upsert({
      user_id: userId,
      role_id: roleId,
      is_active: true,
      assigned_by: assignedBy,
      expires_at: null,
    }, { onConflict: 'user_id,role_id' });
  if (error) throw new Error(`assign role failed: ${safeJson(error)}`);
}

async function setupDevRbac(password) {
  console.log('RUN SETUP dev rbac users and roles');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const preparedUsers = {};
  for (const userConfig of Object.values(USERS)) {
    const authUser = await ensureAuthUser(admin, userConfig.email, password, {
      full_name: `DEV RBAC ${userConfig.label}`,
    });
    preparedUsers[userConfig.label] = authUser;

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUser.id,
        email: userConfig.email,
        full_name: `DEV RBAC ${userConfig.label}`,
        role: userConfig.label === 'admin' ? 'admin' : 'member',
        department: 'DEV',
        job_title: 'RBAC 驗證',
        employee_code: `RBAC-${userConfig.label}`.slice(0, 20),
      }, { onConflict: 'id' });
    if (profileError) throw new Error(`upsert profile ${userConfig.email} failed: ${safeJson(profileError)}`);
  }

  const adminUserId = preparedUsers.admin.id;
  const rolesByCode = {};
  for (const roleConfig of Object.values(TEMP_ROLES)) {
    const role = await setupRole(admin, roleConfig, adminUserId);
    rolesByCode[role.code] = role;
  }

  const { data: adminRole, error: adminRoleError } = await admin
    .from('roles')
    .select('id, code')
    .eq('code', 'admin')
    .single();
  if (adminRoleError || !adminRole) throw new Error('missing admin role for DEV admin test user');
  rolesByCode.admin = adminRole;

  await admin.from('user_roles').delete().in('user_id', Object.values(preparedUsers).map((user) => user.id));
  for (const userConfig of Object.values(USERS)) {
    if (!userConfig.roleCode) continue;
    await assignRole(admin, preparedUsers[userConfig.label].id, rolesByCode[userConfig.roleCode].id, adminUserId);
  }

  console.log('PASS SETUP dev rbac users and roles');
  return { rolesByCode };
}

async function runCase(label, fn) {
  console.log(`RUN ${label}`);
  await fn();
  console.log(`PASS ${label}`);
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  runGuard('scripts/verify-dev-supabase-environment.js');
  runGuard('scripts/verify-dev-supabase-cli-environment.js');

  const password = await promptHidden('Enter DEV RBAC test password to set/use: ');
  assert(password && password.length >= 6, 'test password must be at least 6 characters');

  const { rolesByCode } = await setupDevRbac(password);

  const sessions = {};
  for (const [key, userConfig] of Object.entries(USERS)) {
    sessions[key] = await signIn(userConfig.email, password);
  }

  await runCase('no_access', async () => {
    expectStatus(await request(sessions.noAccess.cookieHeader, '/admin/users'), [303, 307, 308], 'no_access /admin/users');
    expectStatus(await request(sessions.noAccess.cookieHeader, '/admin/roles'), [303, 307, 308], 'no_access /admin/roles');
    expectStatus(await request(sessions.noAccess.cookieHeader, '/api/roles'), 403, 'no_access GET /api/roles');
  });

  await runCase('user_view_only', async () => {
    expectStatus(await request(sessions.userViewOnly.cookieHeader, '/admin/users'), 200, 'user_view_only /admin/users');
    expectStatus(await request(sessions.userViewOnly.cookieHeader, '/admin/roles'), [303, 307, 308], 'user_view_only /admin/roles');
    expectStatus(await request(sessions.userViewOnly.cookieHeader, '/api/roles'), 403, 'user_view_only GET /api/roles');
  });

  await runCase('role_view_only', async () => {
    expectStatus(await request(sessions.roleViewOnly.cookieHeader, '/admin/roles'), 200, 'role_view_only /admin/roles');
    expectStatus(await request(sessions.roleViewOnly.cookieHeader, `/admin/roles/${rolesByCode.dev_rbac_role_view_temp.id}`), [303, 307, 308], 'role_view_only /admin/roles/[id]');
    expectStatus(await request(sessions.roleViewOnly.cookieHeader, '/admin/users'), [303, 307, 308], 'role_view_only /admin/users');
    expectStatus(await request(sessions.roleViewOnly.cookieHeader, '/api/roles'), 200, 'role_view_only GET /api/roles');
    expectStatus(await request(sessions.roleViewOnly.cookieHeader, '/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DEV SHOULD FAIL', code: `dev_should_fail_${Date.now()}` }),
    }), 403, 'role_view_only POST /api/roles');
  });

  await runCase('role_manage', async () => {
    const roleId = rolesByCode.dev_rbac_role_manage_temp.id;
    expectStatus(await request(sessions.roleManage.cookieHeader, '/admin/roles'), 200, 'role_manage /admin/roles');
    expectStatus(await request(sessions.roleManage.cookieHeader, `/admin/roles/${roleId}`), 200, 'role_manage /admin/roles/[id]');
    const code = `dev_rbac_api_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const createResult = await request(sessions.roleManage.cookieHeader, '/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `DEV RBAC API ${code}`, code, description: 'Temporary DEV verification role' }),
    });
    expectStatus(createResult, 201, 'role_manage POST /api/roles');
    const createdRoleId = createResult.body?.role?.id;
    assert(createdRoleId, 'created role id missing');
    expectStatus(await request(sessions.roleManage.cookieHeader, `/api/roles/${createdRoleId}`, { method: 'DELETE' }), 200, 'role_manage DELETE /api/roles/[id]');
  });

  await runCase('admin', async () => {
    expectStatus(await request(sessions.admin.cookieHeader, '/admin/users'), 200, 'admin /admin/users');
    expectStatus(await request(sessions.admin.cookieHeader, '/admin/roles'), 200, 'admin /admin/roles');
    expectStatus(await request(sessions.admin.cookieHeader, '/api/roles'), 200, 'admin GET /api/roles');
  });

  console.log('Task RBAC navbar/page/API permission tests passed');
}

main().catch((error) => {
  console.error('Task RBAC navbar/page/API permission tests failed');
  console.error(safeJson({
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    details: error?.details,
  }));
  process.exit(1);
});
