#!/usr/bin/env node

/**
 * DEV-only verification for the admin user RBAC read-only view.
 *
 * It never logs passwords, JWTs, refresh tokens, cookies, or Supabase keys.
 */

const { spawnSync } = require('child_process');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = process.env.RBAC_USER_VIEW_TEST_BASE_URL || 'http://localhost:3002';
const MAX_COOKIE_CHUNK_SIZE = 3180;
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|authorization|api[-_]?key|anon[-_ ]?key|service[-_ ]?role[-_ ]?key|jwt|cookie|set-cookie|token)/i;

const TARGET_USERS = [
  'dev-ga-access@example.test',
  'dev-ga-manage@example.test',
  'dev-ga-view@example.test',
  'dev-no-ga@example.test',
];

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

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
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
      Accept: 'application/json',
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
  return { status: response.status, contentType, body };
}

function expectStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} expected ${expected}, got ${result.status}: ${safeJson(result.body)}`);
  }
}

function assertNoSensitiveOutput(value, label) {
  const text = JSON.stringify(value || {});
  const forbidden = [
    'access_token',
    'refresh_token',
    'session',
    'user_metadata',
    'app_metadata',
    'encrypted_password',
    'confirmation_token',
    'recovery_token',
    'email_change_token',
    'phone_change_token',
  ];
  const found = forbidden.filter((needle) => text.includes(needle));
  assert(found.length === 0, `${label} returned sensitive auth fields`, { found });
}

async function runCase(label, fn) {
  console.log(`RUN ${label}`);
  await fn();
  console.log(`PASS ${label}`);
}

async function loadTargetProfilesViaSearch(cookieHeader) {
  const byEmail = new Map();

  for (const email of TARGET_USERS) {
    const result = await request(cookieHeader, `/api/users/search?q=${encodeURIComponent(email)}`);
    expectStatus(result, 200, `full admin search ${email}`);
    assert(Array.isArray(result.body?.users), `${email} search should return users array`, result.body);

    const matched = result.body.users.find((user) => user.email === email);
    assert(matched?.id, `full admin search should find ${email}`, result.body.users);
    byEmail.set(email, matched);
  }

  return byEmail;
}

function codes(detail) {
  return new Set((detail.effective_permissions || []).map((permission) => permission.code));
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  runGuard('scripts/verify-dev-supabase-environment.js');
  runGuard('scripts/verify-dev-supabase-cli-environment.js');

  const fullAdminPassword = await promptHidden('Enter dev-full-admin@example.test password: ');
  const noAccessPassword = await promptHidden('Enter dev-no-ga@example.test password: ');
  assert(fullAdminPassword && noAccessPassword, 'DEV passwords are required');

  const fullAdminSession = await signIn('dev-full-admin@example.test', fullAdminPassword);
  const noAccessSession = await signIn('dev-no-ga@example.test', noAccessPassword);
  const targets = await loadTargetProfilesViaSearch(fullAdminSession.cookieHeader);

  const detailsByEmail = new Map();

  await runCase('DEV Full Admin can query user RBAC details', async () => {
    for (const email of TARGET_USERS) {
      const profile = targets.get(email);
      const result = await request(fullAdminSession.cookieHeader, `/api/admin/users/${profile.id}/rbac`);
      expectStatus(result, 200, `full admin GET ${email} rbac`);
      assert(result.body?.success === true, `${email} response success should be true`, result.body);
      assert(result.body?.data?.user?.email === email, `${email} response user mismatch`, result.body?.data?.user);
      assertNoSensitiveOutput(result.body, `${email} rbac detail`);
      detailsByEmail.set(email, result.body.data);
    }
  });

  await runCase('no_access cannot query another user RBAC details', async () => {
    const target = targets.get('dev-ga-access@example.test');
    const result = await request(noAccessSession.cookieHeader, `/api/admin/users/${target.id}/rbac`);
    expectStatus(result, 403, 'no_access GET another user rbac');
  });

  await runCase('role and effective permission sources are readable', async () => {
    for (const email of TARGET_USERS) {
      const detail = detailsByEmail.get(email);
      assert(Array.isArray(detail.roles), `${email} roles should be array`);
      assert(Array.isArray(detail.effective_permissions), `${email} effective_permissions should be array`);
      for (const permission of detail.effective_permissions) {
        assert(permission.code && Array.isArray(permission.source_roles), `${email} permission source roles missing`, permission);
        assert(permission.source_roles.length > 0, `${email} permission should have at least one source role`, permission);
      }
    }
  });

  await runCase('known DEV account permission expectations', async () => {
    const noGa = codes(detailsByEmail.get('dev-no-ga@example.test'));
    const access = codes(detailsByEmail.get('dev-ga-access@example.test'));
    const view = codes(detailsByEmail.get('dev-ga-view@example.test'));
    const manage = codes(detailsByEmail.get('dev-ga-manage@example.test'));

    assert(!noGa.has('general_affairs.service_center.access'), 'dev-no-ga should not have GA service center access');
    assert(access.has('general_affairs.service_center.access'), 'dev-ga-access should have GA service center access');
    assert(view.has('general_affairs.equipment_category.view'), 'dev-ga-view should have category view permission');
    assert(!view.has('general_affairs.equipment_category.manage'), 'dev-ga-view should not have category manage permission');
    assert(manage.has('general_affairs.equipment_category.manage'), 'dev-ga-manage should have category manage permission');
  });

  await runCase('store manager scope is displayed separately', async () => {
    const accessDetail = detailsByEmail.get('dev-ga-access@example.test');
    const noAccessDetail = detailsByEmail.get('dev-no-ga@example.test');
    assert(accessDetail.store_scopes.some((scope) => scope.store_code === 'DEV001'), 'dev-ga-access should include DEV001 store scope', accessDetail.store_scopes);
    assert(noAccessDetail.store_scopes.length === 0, 'dev-no-ga should not have store scope', noAccessDetail.store_scopes);
  });

  await runCase('DEV test account indicator is display-only', async () => {
    for (const email of TARGET_USERS) {
      const detail = detailsByEmail.get(email);
      assert(detail.user.is_dev_test_account === true, `${email} should be marked as DEV test account`);
    }
  });

  await runCase('admin compatibility is explicit and not a fake permission source', async () => {
    for (const email of TARGET_USERS) {
      const detail = detailsByEmail.get(email);
      assert(detail.legacy_compatibility.is_admin_like === false, `${email} should not use admin compatibility bypass`, detail.legacy_compatibility);
    }
  });

  console.log('Task RBAC user permissions view tests passed');
}

main().catch((error) => {
  console.error('Task RBAC user permissions view tests failed');
  console.error(safeJson({
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    details: error?.details,
  }));
  process.exit(1);
});
