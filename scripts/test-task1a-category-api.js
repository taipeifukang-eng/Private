#!/usr/bin/env node

/**
 * Task 1A category API test.
 *
 * Local DEV only. This script:
 * - runs the DEV environment guard first
 * - requires a local Next.js server to already be running
 * - prompts for DEV test user passwords without echoing them
 * - signs in with the anon Supabase client
 * - calls the Next.js category API using the same Supabase SSR cookie format
 *
 * It never prints keys, JWTs, or passwords.
 */

const { spawnSync } = require('child_process');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const TEST_USERS = [
  {
    label: 'no_access',
    email: 'dev-no-ga@example.test',
    canRead: false,
    canManage: false,
  },
  {
    label: 'access_only',
    email: 'dev-ga-access@example.test',
    canRead: true,
    canManage: false,
  },
  {
    label: 'category_view',
    email: 'dev-ga-view@example.test',
    canRead: true,
    canManage: false,
  },
  {
    label: 'category_manage',
    email: 'dev-ga-manage@example.test',
    canRead: true,
    canManage: true,
  },
];

const CATEGORY_TYPES = ['equipment', 'facility', 'part'];
const API_ROOT = '/api/general-affairs/categories';
const MAX_COOKIE_CHUNK_SIZE = 3180;

function runGuard() {
  const result = spawnSync(process.execPath, ['scripts/verify-dev-supabase-environment.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
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
  if (!condition) {
    throw new Error(message);
  }
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getProjectRef() {
  return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
}

function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function createCookieChunks(key, value) {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) {
    return [{ name: key, value }];
  }

  const chunks = [];
  let remaining = encodedValue;
  while (remaining.length > 0) {
    let encodedHead = remaining.slice(0, MAX_COOKIE_CHUNK_SIZE);
    const lastEscapePos = encodedHead.lastIndexOf('%');

    if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) {
      encodedHead = encodedHead.slice(0, lastEscapePos);
    }

    let decodedHead = '';
    while (encodedHead.length > 0) {
      try {
        decodedHead = decodeURIComponent(encodedHead);
        break;
      } catch (error) {
        if (
          error instanceof URIError &&
          encodedHead.at(-3) === '%' &&
          encodedHead.length > 3
        ) {
          encodedHead = encodedHead.slice(0, encodedHead.length - 3);
          continue;
        }
        throw error;
      }
    }

    chunks.push(decodedHead);
    remaining = remaining.slice(encodedHead.length);
  }

  return chunks.map((chunk, index) => ({ name: `${key}.${index}`, value: chunk }));
}

function makeCookieHeader(session) {
  const storageKey = `sb-${getProjectRef()}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  return createCookieChunks(storageKey, value)
    .map(({ name, value: cookieValue }) => `${name}=${encodeURIComponent(cookieValue)}`)
    .join('; ');
}

async function signIn(email, password) {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`sign in did not return a session for ${email}`);
  return makeCookieHeader(data.session);
}

async function apiFetch(siteUrl, cookieHeader, path, options = {}) {
  const response = await fetch(`${siteUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { response, body };
}

async function assertServerIsRunning(siteUrl) {
  try {
    await apiFetch(siteUrl, '', `${API_ROOT}?type=equipment`);
  } catch (error) {
    throw new Error(
      `Local Next.js server is not reachable at ${siteUrl}. Start it with "npm run dev" before running this script.`,
    );
  }
}

function categoryPayload(type, codeSuffix, extra = {}) {
  const payload = {
    type,
    name: `DEV API ${type} ${codeSuffix}`,
    code: `DEV-API-${type}-${codeSuffix}`,
    is_active: true,
    sort_order: 10,
    ...extra,
  };

  if (type === 'equipment') payload.default_fields = {};
  if (type === 'facility') payload.default_issue_fields = {};
  if (type === 'part') payload.spec_schema = [];

  return payload;
}

async function expectStatus(siteUrl, cookieHeader, path, expectedStatus, options = {}) {
  const { response, body } = await apiFetch(siteUrl, cookieHeader, path, options);
  assert(
    response.status === expectedStatus,
    `${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
}

async function testUnauthenticated(siteUrl) {
  const body = await expectStatus(siteUrl, '', `${API_ROOT}?type=equipment`, 401);
  assert(body?.success === false, 'unauthenticated response should be an error envelope');
  console.log('PASS unauthenticated');
}

async function testReadOnlyUser(siteUrl, user, cookieHeader) {
  console.log(`Testing ${user.label} (${user.email})`);

  for (const type of CATEGORY_TYPES) {
    const expectedReadStatus = user.canRead ? 200 : 403;
    const listBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}?type=${type}`, expectedReadStatus);
    if (user.canRead) {
      assert(listBody?.success === true && Array.isArray(listBody.data), `${user.label} should read ${type}`);
    }

    await expectStatus(siteUrl, cookieHeader, API_ROOT, 403, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categoryPayload(type, `${user.label}-${Date.now()}`)),
    });
  }

  console.log(`PASS ${user.label}`);
}

async function testManageUser(siteUrl, user, cookieHeader) {
  console.log(`Testing ${user.label} (${user.email})`);

  const createdIds = [];
  const suffix = Date.now();

  for (const type of CATEGORY_TYPES) {
    const listBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}?type=${type}`, 200);
    assert(listBody?.success === true && Array.isArray(listBody.data), `${user.label} should read ${type}`);

    const createBody = await expectStatus(siteUrl, cookieHeader, API_ROOT, 201, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categoryPayload(type, `${suffix}-ROOT`)),
    });
    assert(createBody?.success === true && createBody.data?.id, `${user.label} should create ${type}`);
    const rootId = createBody.data.id;
    createdIds.push({ type, id: rootId });

    const childBody = await expectStatus(siteUrl, cookieHeader, API_ROOT, 201, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categoryPayload(type, `${suffix}-CHILD`, { parent_id: rootId })),
    });
    assert(childBody?.success === true && childBody.data?.id, `${user.label} should create child ${type}`);
    const childId = childBody.data.id;
    createdIds.push({ type, id: childId });

    const patchBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}/${rootId}`, 200, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, description: 'DEV API updated' }),
    });
    assert(patchBody?.success === true, `${user.label} should update ${type}`);

    const blockedDeleteBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}/${rootId}?type=${type}`, 409, {
      method: 'DELETE',
    });
    assert(
      blockedDeleteBody?.active_children_count === 1,
      `${user.label} delete parent should report one child for ${type}`,
    );

    const deleteChildBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}/${childId}?type=${type}`, 200, {
      method: 'DELETE',
    });
    assert(deleteChildBody?.success === true && deleteChildBody.data?.deleted_at, `${user.label} should soft delete child ${type}`);

    const deleteRootBody = await expectStatus(siteUrl, cookieHeader, `${API_ROOT}/${rootId}?type=${type}`, 200, {
      method: 'DELETE',
    });
    assert(deleteRootBody?.success === true && deleteRootBody.data?.deleted_at, `${user.label} should soft delete root ${type}`);
  }

  await expectStatus(siteUrl, cookieHeader, `${API_ROOT}?type=equipment&includeDeleted=true`, 400);
  await expectStatus(siteUrl, cookieHeader, `${API_ROOT}?type=unknown`, 400);

  console.log(`PASS ${user.label}`);
}

async function main() {
  runGuard();
  loadEnvConfig(process.cwd(), true);

  const siteUrl = getSiteUrl();
  await assertServerIsRunning(siteUrl);

  const passwords = {};
  for (const user of TEST_USERS) {
    passwords[user.email] = await promptHidden(`Password for ${user.email}: `);
  }

  await testUnauthenticated(siteUrl);

  for (const user of TEST_USERS) {
    const cookieHeader = await signIn(user.email, passwords[user.email]);
    if (user.canManage) {
      await testManageUser(siteUrl, user, cookieHeader);
    } else {
      await testReadOnlyUser(siteUrl, user, cookieHeader);
    }
  }

  console.log('Task 1A category API tests passed');
}

main().catch((error) => {
  console.error('Task 1A category API tests failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
