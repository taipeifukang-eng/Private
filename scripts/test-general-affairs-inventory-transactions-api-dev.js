#!/usr/bin/env node

/**
 * Task 1C-2C DEV HTTP API verification.
 *
 * Requires local Next.js server, default http://localhost:3002.
 * Uses service role only for DEV auth/RBAC/fixture setup and cleanup.
 * All API assertions call real HTTP routes with authenticated cookies.
 */

const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const MAX_COOKIE_CHUNK_SIZE = 3180;
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|authorization|api[-_]?key|anon[-_ ]?key|service[-_ ]?role[-_ ]?key|jwt|cookie|set-cookie|token)/i;

const USERS = {
  noAccess: { label: 'no_access', email: 'dev-1c2c-no-access@example.test' },
  balanceView: { label: 'balance_view', email: 'dev-1c2c-balance-view@example.test' },
  transactionView: { label: 'transaction_view', email: 'dev-1c2c-transaction-view@example.test' },
  transactionManage: { label: 'transaction_manage', email: 'dev-1c2c-transaction-manage@example.test' },
  manageNoPart: { label: 'manage_without_part_view', email: 'dev-1c2c-manage-no-part@example.test' },
  storeManagerA: { label: 'store_manager_a', email: 'dev-1c2c-store-a@example.test' },
  storeManagerB: { label: 'store_manager_b', email: 'dev-1c2c-store-b@example.test' },
};

const TEMP_ROLES = {
  balanceView: 'dev_1c2c_balance_view_temp',
  transactionView: 'dev_1c2c_transaction_view_temp',
  transactionManage: 'dev_1c2c_transaction_manage_temp',
  manageNoPart: 'dev_1c2c_manage_no_part_temp',
};

const PERMISSIONS = {
  balanceView: 'general_affairs.inventory_balance.view',
  transactionView: 'general_affairs.inventory_transaction.view',
  transactionManage: 'general_affairs.inventory_transaction.manage',
  partView: 'general_affairs.part.view',
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

async function runCase(name, fn) {
  console.log(`RUN ${name}`);
  try {
    const result = await fn();
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(safeJson({
      name: error.name,
      message: error.message,
      details: error.details,
    }));
    throw error;
  }
}

function runId() {
  return randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function code(run, suffix) {
  return `DEV-1C2C-${run}-${suffix}`.toUpperCase();
}

function getSiteUrl() {
  return (process.env.TEST_SITE_URL || 'http://localhost:3002').replace(/\/$/, '');
}

function getProjectRef() {
  return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
}

function createAnonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createCookieChunks(key, value) {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) return [{ name: key, value }];
  const chunks = [];
  let remaining = encodedValue;
  while (remaining.length > 0) {
    let encodedHead = remaining.slice(0, MAX_COOKIE_CHUNK_SIZE);
    const lastEscapePos = encodedHead.lastIndexOf('%');
    if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) encodedHead = encodedHead.slice(0, lastEscapePos);
    let decodedHead = '';
    while (encodedHead.length > 0) {
      try {
        decodedHead = decodeURIComponent(encodedHead);
        break;
      } catch (error) {
        if (error instanceof URIError && encodedHead.at(-3) === '%' && encodedHead.length > 3) {
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
  return { client, cookieHeader: makeCookieHeader(data.session), userId: data.user.id };
}

async function http(siteUrl, cookieHeader, path, options = {}) {
  const response = await fetch(`${siteUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }
  return { response, body, contentType };
}

async function expectStatus(siteUrl, cookieHeader, path, expected, options = {}) {
  const result = await http(siteUrl, cookieHeader, path, options);
  if (result.response.status !== expected) {
    const error = new Error(`${options.method || 'GET'} ${path} expected ${expected}, got ${result.response.status}`);
    error.details = {
      method: options.method || 'GET',
      path,
      expected,
      actual: result.response.status,
      responseBody: result.body,
      contentType: result.contentType,
    };
    throw error;
  }
  return result.body;
}

async function findAuthUserByEmail(admin, email) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`list auth users failed: ${error.message}`);
    const found = (data.users || []).find((user) => user.email === email);
    if (found) return found;
    if (!data.users || data.users.length < 100) return null;
    page += 1;
  }
  throw new Error('Too many DEV auth users to scan safely');
}

async function ensureUser(admin, config) {
  const password = `${randomUUID()}Aa1!`;
  const existing = await findAuthUserByEmail(admin, config.email);
  let authUser = existing;
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: `DEV 1C-2C ${config.label}` },
    });
    if (error) throw new Error(`update user failed: ${error.message}`);
    authUser = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: config.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `DEV 1C-2C ${config.label}` },
    });
    if (error) throw new Error(`create user failed: ${error.message}`);
    authUser = data.user;
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: authUser.id,
    email: config.email,
    full_name: `DEV 1C-2C ${config.label}`,
    role: 'member',
    department: 'DEV',
    job_title: 'Task 1C-2C 驗收',
  }, { onConflict: 'id' });
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);
  return { id: authUser.id, email: config.email, password };
}

async function upsertRole(admin, roleCode, permissions, userId) {
  const { data: role, error: roleError } = await admin
    .from('roles')
    .upsert({ code: roleCode, name: `DEV ${roleCode}`, is_system: false, is_active: true }, { onConflict: 'code' })
    .select('id')
    .single();
  if (roleError) throw new Error(`role upsert failed: ${roleError.message}`);

  if (permissions.length) {
    const { data, error } = await admin.from('permissions').select('id, code').in('code', permissions);
    if (error) throw new Error(`permission load failed: ${error.message}`);
    const byCode = Object.fromEntries((data || []).map((item) => [item.code, item.id]));
    for (const permission of permissions) assert(byCode[permission], `Missing permission ${permission}`);
    const { error: rpError } = await admin
      .from('role_permissions')
      .upsert(permissions.map((permission) => ({ role_id: role.id, permission_id: byCode[permission], is_allowed: true })), { onConflict: 'role_id,permission_id' });
    if (rpError) throw new Error(`role permission upsert failed: ${rpError.message}`);
  }

  const { error: urError } = await admin
    .from('user_roles')
    .upsert({
      user_id: userId,
      role_id: role.id,
      is_active: true,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'user_id,role_id' });
  if (urError) throw new Error(`user role upsert failed: ${urError.message}`);
}

async function setupUsersAndRbac(admin, stores) {
  const users = {};
  for (const [key, config] of Object.entries(USERS)) users[key] = await ensureUser(admin, config);

  const { data: oldRoles } = await admin.from('roles').select('id').in('code', Object.values(TEMP_ROLES));
  const oldRoleIds = (oldRoles || []).map((role) => role.id);
  if (oldRoleIds.length) {
    await admin.from('user_roles').update({ is_active: false, expires_at: new Date().toISOString() }).in('role_id', oldRoleIds);
  }

  await upsertRole(admin, TEMP_ROLES.balanceView, [PERMISSIONS.balanceView], users.balanceView.id);
  await upsertRole(admin, TEMP_ROLES.transactionView, [PERMISSIONS.transactionView], users.transactionView.id);
  await upsertRole(admin, TEMP_ROLES.transactionManage, [PERMISSIONS.balanceView, PERMISSIONS.transactionView, PERMISSIONS.transactionManage, PERMISSIONS.partView], users.transactionManage.id);
  await upsertRole(admin, TEMP_ROLES.manageNoPart, [PERMISSIONS.balanceView, PERMISSIONS.transactionView, PERMISSIONS.transactionManage], users.manageNoPart.id);

  await admin.from('store_managers').delete().in('user_id', [users.storeManagerA.id, users.storeManagerB.id]);
  const { error: smError } = await admin.from('store_managers').insert([
    { store_id: stores.storeAId, user_id: users.storeManagerA.id, role_type: 'store_manager', is_primary: true },
    { store_id: stores.storeBId, user_id: users.storeManagerB.id, role_type: 'store_manager', is_primary: true },
  ]);
  if (smError) throw new Error(`store manager setup failed: ${smError.message}`);
  return users;
}

async function getId(admin, table, column, value) {
  const { data, error } = await admin.from(table).select('id').eq(column, value).limit(1).single();
  if (error) throw new Error(`missing ${table}.${column}=${value}: ${error.message}`);
  return data.id;
}

async function ensurePartCategory(admin, actorId) {
  const { data: existing, error: loadError } = await admin
    .from('ga_part_categories')
    .select('id')
    .eq('code', 'DEV-1B-3-PART')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (loadError) throw new Error(`part category load failed: ${loadError.message}`);
  if (existing?.id) return existing.id;

  const { data, error } = await admin
    .from('ga_part_categories')
    .insert({
      name: 'DEV 1B-3 料件分類',
      code: 'DEV-1B-3-PART',
      default_base_unit: '個',
      created_by: actorId,
      updated_by: actorId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`part category fixture failed: ${error.message}`);
  return data.id;
}

async function createFixture(admin, run, actorId) {
  const storeAId = await getId(admin, 'stores', 'store_code', 'DEV001');
  const storeBId = await getId(admin, 'stores', 'store_code', 'DEV002');
  const categoryId = await ensurePartCategory(admin, actorId);

  const { data: part, error: partError } = await admin.from('ga_parts').insert({
    category_id: categoryId,
    name: `DEV 1C-2C ${run} API part`,
    part_code: code(run, 'PART'),
    base_unit: '個',
    purchase_unit: '箱',
    purchase_to_base_rate: 12,
    minimum_issue_qty: 1,
    allow_fractional_issue: false,
    allow_unpacking: true,
    specs: {},
  }).select('*').single();
  if (partError) throw new Error(`part fixture failed: ${partError.message}`);

  const makeLocation = async (suffix, storeId, allowNegative = false) => {
    const { data, error } = await admin.from('ga_inventory_locations').insert({
      code: code(run, suffix),
      name: `DEV 1C-2C ${run} ${suffix}`,
      location_type: 'STORE',
      store_id: storeId,
      allow_negative_stock: allowNegative,
    }).select('*').single();
    if (error) throw new Error(`location ${suffix} fixture failed: ${error.message}`);
    return data;
  };

  const locA = await makeLocation('LOCA', storeAId);
  const locB = await makeLocation('LOCB', storeBId);
  const central = await admin.from('ga_inventory_locations').insert({
    code: code(run, 'CENTRAL'),
    name: `DEV 1C-2C ${run} central`,
    location_type: 'CENTRAL_WAREHOUSE',
    allow_negative_stock: false,
  }).select('*').single();
  if (central.error) throw new Error(`central fixture failed: ${central.error.message}`);

  for (const locationId of [locA.id, locB.id, central.data.id]) {
    const { error } = await admin.from('ga_inventory_location_parts').insert({
      location_id: locationId,
      part_id: part.id,
      safety_stock_qty: 0,
      reorder_point_qty: 0,
      maximum_stock_qty: 10000,
      preferred_issue_unit_type: 'BASE',
    });
    if (error) throw new Error(`location part fixture failed: ${error.message}`);
  }

  return {
    run,
    actorId,
    partId: part.id,
    locationAId: locA.id,
    locationBId: locB.id,
    centralId: central.data.id,
    locationIds: [locA.id, locB.id, central.data.id],
    partIds: [part.id],
  };
}

async function cleanup(admin, fixture) {
  console.log('RUN CLEANUP api fixtures');
  if (!fixture) {
    console.log('PASS CLEANUP api fixtures');
    return;
  }
  const now = new Date().toISOString();
  for (const locationId of fixture.locationIds) {
    await admin.from('ga_inventory_location_parts').update({
      is_active: false,
      deleted_at: now,
      deleted_by: fixture.actorId,
      deletion_reason: `DEV Task 1C-2C cleanup ${fixture.run}`,
    }).eq('location_id', locationId).is('deleted_at', null);
    await admin.from('ga_inventory_locations').update({
      is_active: false,
      is_default: false,
      deleted_at: now,
      deleted_by: fixture.actorId,
      deletion_reason: `DEV Task 1C-2C cleanup ${fixture.run}`,
    }).eq('id', locationId).is('deleted_at', null);
  }
  for (const partId of fixture.partIds) {
    await admin.from('ga_parts').update({
      is_active: false,
      deleted_at: now,
      deleted_by: fixture.actorId,
      deletion_reason: `DEV Task 1C-2C cleanup ${fixture.run}`,
    }).eq('id', partId).is('deleted_at', null);
  }
  console.log('PASS CLEANUP api fixtures');
}

function postBody(fixture, overrides = {}) {
  return {
    transactionType: 'RECEIPT',
    locationId: fixture.locationAId,
    partId: fixture.partId,
    quantity: 5,
    inputUnitType: 'BASE',
    reason: `DEV ${fixture.run} API transaction`,
    notes: null,
    idempotencyKey: randomUUID(),
    metadata: { run: fixture.run },
    ...overrides,
  };
}

async function main() {
  runGuard('scripts/verify-dev-supabase-environment.js');
  loadEnvConfig(process.cwd(), true);
  const siteUrl = getSiteUrl();
  await http(siteUrl, '', '/api/general-affairs/inventory/balances').catch(() => {
    throw new Error(`Local Next.js server is not reachable at ${siteUrl}`);
  });

  const run = runId();
  console.log(`Test run ID: ${run}`);
  const admin = createServiceClient();
  const stores = {
    storeAId: await getId(admin, 'stores', 'store_code', 'DEV001'),
    storeBId: await getId(admin, 'stores', 'store_code', 'DEV002'),
  };
  const devUsers = await runCase('SETUP api test users', () => setupUsersAndRbac(admin, stores));
  const sessions = {};
  for (const [key, user] of Object.entries(devUsers)) sessions[key] = await signIn(user.email, user.password);

  let fixture = null;
  try {
    fixture = await runCase('SETUP api fixtures', () => createFixture(admin, run, devUsers.transactionManage.id));

    await runCase('auth and permission API', async () => {
      await expectStatus(siteUrl, '', '/api/general-affairs/inventory/transactions/post', 401, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture)),
      });
      await expectStatus(siteUrl, sessions.noAccess.cookieHeader, '/api/general-affairs/inventory/transactions/post', 403, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture)),
      });
      const noPart = await expectStatus(siteUrl, sessions.manageNoPart.cookieHeader, '/api/general-affairs/inventory/transactions/post', 403, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture)),
      });
      assert(noPart.error?.code === 'PART_VIEW_REQUIRED', 'manage without part.view should return PART_VIEW_REQUIRED');
    });

    await runCase('validation API', async () => {
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { locationId: 'not-a-uuid' })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { quantity: 0 })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { transactionType: 'BAD' })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { reason: '   ' })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { metadata: [] })),
      });
    });

    await runCase('transaction post API', async () => {
      const receipt = await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { quantity: 10, idempotencyKey: `DEV-${run}-RECEIPT` })),
      });
      assert(receipt.data.transaction_no, 'receipt should return transaction_no');

      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { transactionType: 'ISSUE', quantity: 2, idempotencyKey: `DEV-${run}-ISSUE` })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { transactionType: 'ADJUST_IN', quantity: 1, idempotencyKey: `DEV-${run}-ADJIN` })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { transactionType: 'ADJUST_OUT', quantity: 1, idempotencyKey: `DEV-${run}-ADJOUT` })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { quantity: 1, inputUnitType: 'PURCHASE', idempotencyKey: `DEV-${run}-PURCHASE` })),
      });
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 409, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { transactionType: 'ISSUE', quantity: 999, idempotencyKey: `DEV-${run}-INSUFFICIENT` })),
      });

      const replayBody = postBody(fixture, { quantity: 3, idempotencyKey: `DEV-${run}-REPLAY` });
      const first = await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replayBody),
      });
      const replay = await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 201, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replayBody),
      });
      assert(replay.data.idempotent_replay === true, 'replay should be marked idempotent');
      assert(replay.data.transaction_id === first.data.transaction_id, 'replay should return original transaction');
      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 409, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...replayBody, quantity: 4 }),
      });
    });

    await runCase('query API and RLS', async () => {
      const balances = await expectStatus(siteUrl, sessions.balanceView.cookieHeader, `/api/general-affairs/inventory/balances?locationId=${fixture.locationAId}`, 200);
      assert((balances.data || []).length >= 1, 'balance_view should read balances');
      await expectStatus(siteUrl, sessions.balanceView.cookieHeader, '/api/general-affairs/inventory/transactions', 403);
      const transactions = await expectStatus(siteUrl, sessions.transactionView.cookieHeader, `/api/general-affairs/inventory/transactions?locationId=${fixture.locationAId}`, 200);
      assert((transactions.data || []).length >= 1, 'transaction_view should read transactions');
      const options = await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/options', 200);
      assert(options.data.partCatalogAccess === true, 'manage + part.view should see part catalog options');
      const noPartOptions = await expectStatus(siteUrl, sessions.manageNoPart.cookieHeader, '/api/general-affairs/inventory/options', 200);
      assert(noPartOptions.data.partCatalogAccess === false, 'manage without part.view should not see part catalog options');

      await expectStatus(siteUrl, sessions.transactionManage.cookieHeader, '/api/general-affairs/inventory/transactions/post', 400, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture, { created_by: randomUUID(), balance_after: 999 })),
      });
    });

    await runCase('store manager scope API', async () => {
      const storeA = await expectStatus(siteUrl, sessions.storeManagerA.cookieHeader, '/api/general-affairs/inventory/balances', 200);
      const rowsA = storeA.data || [];
      assert(rowsA.every((row) => row.location_id !== fixture.locationBId && row.location_id !== fixture.centralId), 'store_manager_a must not see B or central');
      const storeB = await expectStatus(siteUrl, sessions.storeManagerB.cookieHeader, '/api/general-affairs/inventory/balances', 200);
      const rowsB = storeB.data || [];
      assert(rowsB.every((row) => row.location_id !== fixture.locationAId && row.location_id !== fixture.centralId), 'store_manager_b must not see A or central');
      await expectStatus(siteUrl, sessions.storeManagerA.cookieHeader, '/api/general-affairs/inventory/transactions/post', 403, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody(fixture)),
      });
    });
  } finally {
    await cleanup(admin, fixture).catch((error) => {
      console.warn('WARN cleanup failed');
      console.warn(safeJson({ message: error.message }));
    });
    for (const session of Object.values(sessions)) await session.client.auth.signOut().catch(() => {});
  }

  console.log('Task 1C-2C inventory transaction API tests passed');
}

main().catch((error) => {
  console.error('Task 1C-2C inventory transaction API tests failed');
  console.error(safeJson({ message: error.message, details: error.details }));
  process.exit(1);
});
