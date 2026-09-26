#!/usr/bin/env node

/**
 * DEV-only dynamic verification for /api/users/search.
 *
 * This script never logs passwords, JWTs, refresh tokens, cookies, or keys.
 */

const { spawnSync } = require('child_process');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = process.env.RBAC_USER_SEARCH_TEST_BASE_URL || 'http://localhost:3002';
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

async function request(cookieHeader, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
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

async function main() {
  loadEnvConfig(process.cwd(), true);
  runGuard('scripts/verify-dev-supabase-environment.js');
  runGuard('scripts/verify-dev-supabase-cli-environment.js');

  const fullAdminPassword = await promptHidden('Enter dev-full-admin@example.test password: ');
  const noAccessPassword = await promptHidden('Enter dev-no-ga@example.test password: ');
  assert(fullAdminPassword && noAccessPassword, 'DEV passwords are required');

  const fullAdminSession = await signIn('dev-full-admin@example.test', fullAdminPassword);
  const noAccessSession = await signIn('dev-no-ga@example.test', noAccessPassword);

  await runCase('unauthenticated search is 401', async () => {
    const result = await request(null, '/api/users/search?q=DEV');
    expectStatus(result, 401, 'unauthenticated user search');
  });

  await runCase('no_access search is 403', async () => {
    const result = await request(noAccessSession.cookieHeader, '/api/users/search?q=DEV');
    expectStatus(result, 403, 'no_access user search');
    assert(result.body?.error === '沒有搜尋使用者的權限', 'no_access error message mismatch', result.body);
    assertNoSensitiveOutput(result.body, 'no_access search');
  });

  await runCase('full admin can search DEV users', async () => {
    const result = await request(fullAdminSession.cookieHeader, '/api/users/search?q=dev-ga');
    expectStatus(result, 200, 'full admin user search');
    assert(Array.isArray(result.body?.users), 'full admin search should return users array', result.body);
    const emails = new Set(result.body.users.map((user) => user.email));
    assert(emails.has('dev-ga-access@example.test'), 'full admin search should include dev-ga-access@example.test', result.body.users);
    assert(emails.has('dev-ga-manage@example.test'), 'full admin search should include dev-ga-manage@example.test', result.body.users);
    assert(emails.has('dev-ga-view@example.test'), 'full admin search should include dev-ga-view@example.test', result.body.users);
    assertNoSensitiveOutput(result.body, 'full admin search');
  });

  await runCase('full admin can search all manual DEV verification accounts', async () => {
    for (const email of TARGET_USERS) {
      const result = await request(fullAdminSession.cookieHeader, `/api/users/search?q=${encodeURIComponent(email)}`);
      expectStatus(result, 200, `full admin user search ${email}`);
      assert(Array.isArray(result.body?.users), `${email} search should return users array`, result.body);
      assert(
        result.body.users.some((user) => user.email === email),
        `full admin search should include ${email}`,
        result.body.users
      );
      assertNoSensitiveOutput(result.body, `full admin search ${email}`);
    }
  });

  await runCase('short query returns empty array', async () => {
    const result = await request(fullAdminSession.cookieHeader, '/api/users/search?q=D');
    expectStatus(result, 200, 'short user search');
    assert(Array.isArray(result.body?.users), 'short query should return users array', result.body);
    assert(result.body.users.length === 0, 'short query should return no users', result.body);
  });

  console.log('RBAC user search dynamic tests passed');
}

main().catch((error) => {
  console.error('RBAC user search dynamic tests failed');
  console.error(safeJson({
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    details: error?.details,
  }));
  process.exit(1);
});
