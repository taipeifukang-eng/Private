#!/usr/bin/env node

/**
 * Local smoke test for RBAC admin routes.
 *
 * Requires the dev server to be running. Does not log or require credentials.
 */

const BASE_URL = process.env.RBAC_ADMIN_SMOKE_BASE_URL || 'http://localhost:3002';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    redirect: 'manual',
    headers: {
      Accept: 'application/json,text/html',
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  return { status: response.status, contentType, body };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(path, options = {}, retries = 2) {
  let lastResult = await request(path, options);
  for (let attempt = 0; attempt < retries && lastResult.status >= 500; attempt += 1) {
    await sleep(500);
    lastResult = await request(path, options);
  }
  return lastResult;
}

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function runCase(label, fn) {
  console.log(`RUN ${label}`);
  await fn();
  console.log(`PASS ${label}`);
}

async function main() {
  const roleId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const targetUserId = '33333333-3333-4333-8333-333333333333';

  await runCase('home page does not 500 when unauthenticated', async () => {
    const result = await requestWithRetry('/');
    assert(result.status === 200, '/ should render the unauthenticated landing page', {
      status: result.status,
      contentType: result.contentType,
      body: result.body.slice(0, 300),
    });
    assert(!result.body.includes('Cannot read properties of null'), '/ should not render React hook null error');
  });

  await runCase('admin users page does not 500 when unauthenticated', async () => {
    const result = await requestWithRetry('/admin/users');
    assert(
      [200, 307, 308].includes(result.status),
      '/admin/users should render or redirect, not fail',
      { status: result.status, contentType: result.contentType, body: result.body.slice(0, 300) }
    );
    assert(!result.body.includes('Cannot read properties of null'), '/admin/users should not render React hook null error');
  });

  await runCase('admin roles page does not 500 when unauthenticated', async () => {
    const result = await requestWithRetry('/admin/roles');
    assert(
      [200, 307, 308].includes(result.status),
      '/admin/roles should render or redirect, not fail',
      { status: result.status, contentType: result.contentType, body: result.body.slice(0, 300) }
    );
    assert(!result.body.includes('Cannot read properties of null'), '/admin/roles should not render React hook null error');
  });

  await runCase('user search API requires auth', async () => {
    const result = await requestWithRetry('/api/users/search?q=dev-ga');
    assert(result.status === 401, '/api/users/search should return 401 when unauthenticated', {
      status: result.status,
      body: result.body.slice(0, 300),
    });
    assert(result.body.includes('未登入'), '/api/users/search 401 body should be explicit');
  });

  await runCase('user RBAC detail API requires auth', async () => {
    const result = await requestWithRetry(`/api/admin/users/${targetUserId}/rbac`);
    assert(result.status === 401, '/api/admin/users/[id]/rbac should return 401 when unauthenticated', {
      status: result.status,
      body: result.body.slice(0, 300),
    });
    assert(result.body.includes('未登入'), '/api/admin/users/[id]/rbac 401 body should be explicit');
  });

  const unauthenticatedApiCases = [
    ['GET roles list', '/api/roles'],
    ['POST create role', '/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Not Create', code: 'should_not_create' }),
    }],
    ['GET role detail', `/api/roles/${roleId}`],
    ['PATCH role detail', `/api/roles/${roleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Not Patch' }),
    }],
    ['DELETE role', `/api/roles/${roleId}`, { method: 'DELETE' }],
    ['GET role permissions', `/api/roles/${roleId}/permissions`],
    ['POST role permissions', `/api/roles/${roleId}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionIds: [] }),
    }],
    ['GET role users', `/api/roles/${roleId}/users`],
    ['POST role users', `/api/roles/${roleId}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_codes: ['DEV9999'] }),
    }],
    ['DELETE role user', `/api/roles/${roleId}/users/${userId}`, { method: 'DELETE' }],
  ];

  for (const [label, path, options] of unauthenticatedApiCases) {
    await runCase(`roles API requires auth: ${label}`, async () => {
      const result = await requestWithRetry(path, options);
      assert(result.status === 401, `${label} should return 401 when unauthenticated`, {
        status: result.status,
        contentType: result.contentType,
        body: result.body.slice(0, 300),
      });
      assert(result.body.includes('未登入'), `${label} 401 body should be explicit`);
    });
  }

  console.log('RBAC admin route smoke checks passed');
}

main().catch((error) => {
  console.error('RBAC admin route smoke checks failed');
  console.error(JSON.stringify({
    name: error.name,
    message: error.message,
    details: error.details,
  }, null, 2));
  process.exit(1);
});
