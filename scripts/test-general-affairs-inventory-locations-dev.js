#!/usr/bin/env node

/**
 * Task 1C-1 DEV RLS/API verification.
 *
 * Local DEV only. This script:
 * - runs the DEV environment guard first
 * - requires local Next.js server to be running
 * - prompts for DEV test user passwords without echoing them
 * - uses service role only for DEV test setup/cleanup
 * - never prints keys, JWTs, passwords, or connection strings
 */

const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const MAX_COOKIE_CHUNK_SIZE = 3180;
const API_ROOT = '/api/general-affairs/inventory/locations';

const USERS = {
  noAccess: { label: 'no_access', email: 'dev-no-ga@example.test', roleCode: 'dev_no_ga_access' },
  storeManager: { label: 'store_manager', email: 'dev-ga-access@example.test', roleCode: 'dev_ga_access_only' },
  inventoryView: { label: 'inventory_view', email: 'dev-ga-view@example.test', roleCode: 'dev_ga_category_view' },
  inventoryManage: { label: 'inventory_manage', email: 'dev-ga-manage@example.test', roleCode: 'dev_ga_category_manage' },
};

const TEMP_MANAGE_NO_PART_ROLE_CODE = 'dev_inventory_manage_no_part_temp';
const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|authorization|api[-_]?key|anon[-_ ]?key|service[-_ ]?role[-_ ]?key|jwt|cookie|set-cookie|token)/i;

function createRunId() {
  return randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function makeRunCode(runId, suffix) {
  return `DEV-1C1-${runId}-${suffix}`.toUpperCase();
}

function makeCleanupTracker() {
  return {
    locationPartIds: [],
    locationIds: [],
  };
}

function trackLocation(cleanup, id) {
  if (id && !cleanup.locationIds.includes(id)) cleanup.locationIds.push(id);
}

function trackLocationPart(cleanup, id, locationId) {
  if (id && !cleanup.locationPartIds.some((item) => item.id === id)) {
    cleanup.locationPartIds.push({ id, locationId });
  }
}

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

function throwSupabaseError(context, error) {
  throw new Error(`${context}: ${safeJson(error)}`);
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
    return '[Unserializable value]';
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: sanitizeForLog(error.cause),
      http: sanitizeForLog(error.http),
      details: sanitizeForLog(error.details),
    };
  }

  if (typeof error === 'string') return error;
  return sanitizeForLog(error);
}

function logCaseStart(name) {
  console.log(`RUN ${name}`);
}

function logFormattedError(error) {
  const formatted = formatError(error);
  if (formatted && typeof formatted === 'object') {
    const details = formatted.details || formatted.http;
    if (details) {
      if (details.cascadeDiagnostics) {
        console.error(`Cascade diagnostics: ${safeJson(details.cascadeDiagnostics)}`);
      }
      if (details.actualStatus !== undefined || details.expectedStatus !== undefined) {
        console.error(`HTTP status: ${details.actualStatus}`);
        console.error(`Expected status: ${details.expectedStatus}`);
        console.error(`Method: ${details.method}`);
        console.error(`Path: ${details.path}`);
        console.error(`Content-Type: ${details.contentType || '<none>'}`);
        console.error(`Response body: ${safeJson(details.responseBody ?? details.body)}`);
        if (details.requestPayload !== undefined) console.error(`Request payload: ${safeJson(details.requestPayload)}`);
      }
    }
    if (formatted.name) console.error(`Error name: ${formatted.name}`);
    if (formatted.message) console.error(`Error message: ${formatted.message}`);
    if (!details && !formatted.name && !formatted.message) console.error(safeJson(formatted));
    return;
  }

  console.error(`Error message: ${String(formatted)}`);
}

async function runCase(name, fn) {
  logCaseStart(name);
  try {
    const result = await fn();
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${name}`);
    logFormattedError(error);
    throw error;
  }
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3002').replace(/\/$/, '');
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
  if (!data.session) throw new Error(`sign in did not return a session for ${email}`);
  return { client, cookieHeader: makeCookieHeader(data.session) };
}

async function apiFetch(siteUrl, cookieHeader, path, options = {}) {
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
      body = text;
    }
  }
  return { response, body, text, contentType };
}

function maskId(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= 8) return '[REDACTED_ID]';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function makeCascadeDiagnostics({
  locationId,
  activeChildId,
  predeletedChildId,
  parentAfter,
  activeChildAfter,
  predeletedChildBefore,
  predeletedChildAfter,
  expectedReason,
}) {
  return {
    parent_location_id: maskId(locationId),
    active_child_location_part_id: maskId(activeChildId),
    pre_deleted_child_location_part_id: maskId(predeletedChildId),
    expected_parent_deletion_reason: expectedReason,
    parent_deletion_reason: parentAfter?.deletion_reason ?? null,
    active_child_deletion_reason: activeChildAfter?.deletion_reason ?? null,
    pre_deleted_child_deletion_reason_before_parent_delete: predeletedChildBefore?.deletion_reason ?? null,
    pre_deleted_child_deletion_reason_after_parent_delete: predeletedChildAfter?.deletion_reason ?? null,
    parent_deleted_by: maskId(parentAfter?.deleted_by),
    active_child_deleted_by: maskId(activeChildAfter?.deleted_by),
    pre_deleted_child_deleted_by_before_parent_delete: maskId(predeletedChildBefore?.deleted_by),
    pre_deleted_child_deleted_by_after_parent_delete: maskId(predeletedChildAfter?.deleted_by),
    parent_deleted_at: parentAfter?.deleted_at ?? null,
    active_child_deleted_at: activeChildAfter?.deleted_at ?? null,
    pre_deleted_child_deleted_at_before_parent_delete: predeletedChildBefore?.deleted_at ?? null,
    pre_deleted_child_deleted_at_after_parent_delete: predeletedChildAfter?.deleted_at ?? null,
  };
}

function throwCascadeAssertion(message, diagnostics) {
  const error = new Error(message);
  error.details = {
    cascadeDiagnostics: diagnostics,
  };
  throw error;
}

function sanitizeRequestPayload(options = {}) {
  if (!options.body || typeof options.body !== 'string') return undefined;
  let parsed;
  try {
    parsed = JSON.parse(options.body);
  } catch {
    return '[Non-JSON body omitted]';
  }

  return {
    code: parsed.code,
    name: parsed.name,
    location_type: parsed.location_type,
    store_id: Object.prototype.hasOwnProperty.call(parsed, 'store_id') ? maskId(parsed.store_id) : undefined,
    is_active: parsed.is_active,
    is_default: parsed.is_default,
    allow_negative_stock: parsed.allow_negative_stock,
    description_exists: Object.prototype.hasOwnProperty.call(parsed, 'description'),
  };
}

async function expectStatus(siteUrl, cookieHeader, path, expectedStatus, options = {}) {
  const { response, body, text, contentType } = await apiFetch(siteUrl, cookieHeader, path, options);
  if (response.status !== expectedStatus) {
    const error = new Error(`${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}`);
    error.details = {
      method: options.method || 'GET',
      path,
      expectedStatus,
      actualStatus: response.status,
      contentType,
      responseBody: typeof body === 'string' ? body.slice(0, 500) : body,
      text: text ? text.slice(0, 500) : '',
      requestPayload: sanitizeRequestPayload(options),
    };
    throw error;
  }
  return body;
}

async function expectAlreadyDeletedConflict(siteUrl, cookieHeader, path, expectedMessage, options = {}) {
  const body = await expectStatus(siteUrl, cookieHeader, path, 409, options);
  const bodyText = typeof body === 'string' ? body : safeJson(body);
  assert(
    bodyText.includes(expectedMessage),
    `Expected repeated DELETE of soft-deleted resource to include "${expectedMessage}", got ${bodyText}`,
  );
  return body;
}

async function assertServerIsRunning(siteUrl) {
  try {
    await apiFetch(siteUrl, '', API_ROOT);
  } catch {
    throw new Error(`Local Next.js server is not reachable at ${siteUrl}. Start it before running this script.`);
  }
}

async function getId(admin, table, column, value) {
  const { data, error } = await admin.from(table).select('id').eq(column, value).limit(1).single();
  if (error) throw new Error(`Missing ${table}.${column}=${value}: ${error.message}`);
  return data.id;
}

async function getNonexistentLocationUuid(admin) {
  const candidates = ['11111111-1111-4111-8111-111111111111'];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = candidates[attempt] || randomUUID();
    const { data, error } = await admin
      .from('ga_inventory_locations')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();
    if (error) throwSupabaseError('getNonexistentLocationUuid failed', error);
    if (!data) return candidate;
  }

  throw new Error('Could not find a nonexistent valid location UUID for 404 test');
}

async function deactivateTemporaryManageWithoutPartViewRole(admin) {
  const { data: tempRole } = await admin
    .from('roles')
    .select('id')
    .eq('code', TEMP_MANAGE_NO_PART_ROLE_CODE)
    .maybeSingle();

  if (tempRole?.id) {
    await admin
      .from('user_roles')
      .update({ is_active: false, expires_at: new Date().toISOString() })
      .eq('role_id', tempRole.id);
  }
}

async function cleanupTestResources(siteUrl, cookieHeader, cleanup) {
  console.log('RUN CLEANUP test resources');
  let cleanupHadWarning = false;
  let alreadyDeletedCount = 0;

  function isAlreadyDeleted(result) {
    const bodyText = typeof result.body === 'string' ? result.body : safeJson(result.body);
    return [400, 404, 409].includes(result.response.status) && /已被刪除|找不到/.test(bodyText);
  }

  for (const item of [...cleanup.locationPartIds].reverse()) {
    const result = await apiFetch(siteUrl, cookieHeader, `${API_ROOT}/${item.locationId}/parts/${item.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_reason: 'DEV Task 1C-1 dynamic test cleanup' }),
    }).catch((error) => ({ response: { status: 0 }, body: formatError(error) }));

    if (isAlreadyDeleted(result)) {
      alreadyDeletedCount += 1;
      continue;
    }

    if (result.response.status !== 200) {
      cleanupHadWarning = true;
      console.warn(`WARN CLEANUP location part ${item.id}`);
      console.warn(`Response body: ${safeJson(result.body)}`);
    }
  }

  for (const locationId of [...cleanup.locationIds].reverse()) {
    const result = await apiFetch(siteUrl, cookieHeader, `${API_ROOT}/${locationId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_reason: 'DEV Task 1C-1 dynamic test cleanup' }),
    }).catch((error) => ({ response: { status: 0 }, body: formatError(error) }));

    if (isAlreadyDeleted(result)) {
      alreadyDeletedCount += 1;
      continue;
    }

    if (result.response.status !== 200) {
      cleanupHadWarning = true;
      console.warn(`WARN CLEANUP location ${locationId}`);
      console.warn(`Response body: ${safeJson(result.body)}`);
    }
  }

  if (alreadyDeletedCount > 0) console.log(`PASS CLEANUP already deleted (${alreadyDeletedCount})`);
  if (!cleanupHadWarning) console.log('PASS CLEANUP test resources');
}

async function setupRolePermissions(admin) {
  const permissionCodes = [
    'general_affairs.inventory_location.view',
    'general_affairs.inventory_location.manage',
    'general_affairs.part.view',
  ];
  const { data: permissions, error: permissionError } = await admin
    .from('permissions')
    .select('id, code')
    .in('code', permissionCodes);
  if (permissionError) throwSupabaseError('load inventory permissions failed', permissionError);

  const permissionId = Object.fromEntries((permissions || []).map((p) => [p.code, p.id]));
  for (const code of permissionCodes) assert(permissionId[code], `Missing permission ${code}`);

  const roleCodes = [USERS.inventoryView.roleCode, USERS.inventoryManage.roleCode];
  const { data: roles, error: roleError } = await admin.from('roles').select('id, code').in('code', roleCodes);
  if (roleError) throwSupabaseError('load inventory roles failed', roleError);
  const roleId = Object.fromEntries((roles || []).map((r) => [r.code, r.id]));
  for (const code of roleCodes) assert(roleId[code], `Missing role ${code}`);

  const assignments = [
    { role_id: roleId[USERS.inventoryView.roleCode], permission_id: permissionId['general_affairs.inventory_location.view'] },
    { role_id: roleId[USERS.inventoryManage.roleCode], permission_id: permissionId['general_affairs.inventory_location.manage'] },
    { role_id: roleId[USERS.inventoryManage.roleCode], permission_id: permissionId['general_affairs.part.view'] },
  ];

  const { error } = await admin.from('role_permissions').upsert(assignments, { onConflict: 'role_id,permission_id' });
  if (error) throwSupabaseError('upsert inventory role permissions failed', error);
}

async function setupManageWithoutPartViewRole(admin) {
  const { data: permission, error: permissionError } = await admin
    .from('permissions')
    .select('id')
    .eq('code', 'general_affairs.inventory_location.manage')
    .single();
  if (permissionError) throwSupabaseError('load inventory manage permission failed', permissionError);

  const { data: role, error: roleError } = await admin
    .from('roles')
    .upsert({
      code: TEMP_MANAGE_NO_PART_ROLE_CODE,
      name: 'DEV inventory manage without part view',
      description: 'Temporary DEV verification role. Do not use outside Task 1C-1 tests.',
      is_system: false,
      is_active: true,
    }, { onConflict: 'code' })
    .select('id')
    .single();
  if (roleError) throwSupabaseError('upsert temporary manage-no-part role failed', roleError);

  const { error: rolePermissionError } = await admin
    .from('role_permissions')
    .upsert({ role_id: role.id, permission_id: permission.id, is_allowed: true }, { onConflict: 'role_id,permission_id' });
  if (rolePermissionError) throwSupabaseError('upsert temporary role permission failed', rolePermissionError);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', USERS.inventoryView.email)
    .single();
  if (profileError) throwSupabaseError('load manage-no-part test profile failed', profileError);

  const { error: userRoleError } = await admin
    .from('user_roles')
    .upsert({
      user_id: profile.id,
      role_id: role.id,
      is_active: true,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }, { onConflict: 'user_id,role_id' });
  if (userRoleError) throwSupabaseError('upsert manage-no-part user role failed', userRoleError);
}

async function setupFixtures(admin, runId, cleanup) {
  await setupRolePermissions(admin);

  const storeOneId = await getId(admin, 'stores', 'store_code', 'DEV001');
  const storeTwoId = await getId(admin, 'stores', 'store_code', 'DEV002');
  const partId = await getId(admin, 'ga_parts', 'part_code', 'DEV-1B-3-PART-CODE');
  const codes = {
    store: makeRunCode(runId, 'STORE'),
    otherStore: makeRunCode(runId, 'OTHER-STORE'),
    central: makeRunCode(runId, 'CENTRAL'),
  };
  const codePrefix = makeRunCode(runId, '');
  const searchText = `DEV 1C1 ${runId}`;

  const { data: storeLocation, error: storeLocationError } = await admin
    .from('ga_inventory_locations')
    .insert({
      code: codes.store,
      name: `${searchText} Store Location`,
      location_type: 'STORE',
      store_id: storeOneId,
      is_default: false,
    })
    .select('id, store_id')
    .single();
  if (storeLocationError) throwSupabaseError('create script store location failed', storeLocationError);
  trackLocation(cleanup, storeLocation.id);

  const { data: otherStoreLocation, error: otherStoreLocationError } = await admin
    .from('ga_inventory_locations')
    .insert({
      code: codes.otherStore,
      name: `${searchText} Other Store Location`,
      location_type: 'STORE',
      store_id: storeTwoId,
      is_default: false,
    })
    .select('id, store_id')
    .single();
  if (otherStoreLocationError) throwSupabaseError('create script other store location failed', otherStoreLocationError);
  trackLocation(cleanup, otherStoreLocation.id);

  const { data: centralLocation, error: centralLocationError } = await admin
    .from('ga_inventory_locations')
    .insert({
      code: codes.central,
      name: `${searchText} Central Location`,
      location_type: 'CENTRAL_WAREHOUSE',
      is_default: false,
    })
    .select('id')
    .single();
  if (centralLocationError) throwSupabaseError('create script central location failed', centralLocationError);
  trackLocation(cleanup, centralLocation.id);

  const { data: locationPart, error: locationPartError } = await admin
    .from('ga_inventory_location_parts')
    .insert({
      location_id: storeLocation.id,
      part_id: partId,
      safety_stock_qty: 2,
      reorder_point_qty: 5,
      maximum_stock_qty: 10,
      preferred_issue_unit_type: 'PURCHASE',
    })
    .select('id')
    .single();
  if (locationPartError) throwSupabaseError('create script location part failed', locationPartError);
  trackLocationPart(cleanup, locationPart.id, storeLocation.id);

  const { data: otherLocationPart, error: otherLocationPartError } = await admin
    .from('ga_inventory_location_parts')
    .insert({
      location_id: otherStoreLocation.id,
      part_id: partId,
      safety_stock_qty: 1,
      reorder_point_qty: 2,
      maximum_stock_qty: 3,
      preferred_issue_unit_type: 'BASE',
    })
    .select('id')
    .single();
  if (otherLocationPartError) throwSupabaseError('create script other location part failed', otherLocationPartError);
  trackLocationPart(cleanup, otherLocationPart.id, otherStoreLocation.id);

  return { runId, storeOneId, storeTwoId, partId, storeLocation, otherStoreLocation, centralLocation, locationPart, codes, codePrefix, searchText };
}

async function testRlsClient(client, label, fixtures, expected, cleanup) {
  const { data: locations, error: locationError } = await client
    .from('ga_inventory_locations')
    .select('id, code, location_type, store_id, deleted_at')
    .like('code', `${fixtures.codePrefix}%`)
    .order('code');
  if (locationError) throwSupabaseError(`${label} read locations failed`, locationError);

  const codes = (locations || []).map((row) => row.code).sort();
  assert(JSON.stringify(codes) === JSON.stringify(expected.locationCodes.sort()), `${label} unexpected visible locations: ${codes.join(',')}`);

  const { data: locationParts, error: partError } = await client
    .from('ga_inventory_location_parts')
    .select('id, location_id, deleted_at')
    .in('location_id', [fixtures.storeLocation.id, fixtures.otherStoreLocation.id, fixtures.centralLocation.id])
    .order('id');
  if (partError) throwSupabaseError(`${label} read location parts failed`, partError);
  assert((locationParts || []).length === expected.locationPartCount, `${label} unexpected location parts count`);

  const insertResult = await client
    .from('ga_inventory_locations')
    .insert({
      code: makeRunCode(fixtures.runId, `RLS-${label.replace(/[^A-Za-z0-9]+/g, '-')}`),
      name: `${fixtures.searchText} RLS ${label}`,
      location_type: 'OFFICE',
    })
    .select('id');

  if (expected.canWrite) {
    assert(!insertResult.error && insertResult.data?.length === 1, `${label} should insert location`);
    trackLocation(cleanup, insertResult.data[0].id);
  } else {
    assert(insertResult.error || !insertResult.data || insertResult.data.length === 0, `${label} must not insert location`);
  }

  const updateResult = await client
    .from('ga_inventory_locations')
    .update({ description: `DEV RLS update ${label}` })
    .eq('id', fixtures.storeLocation.id)
    .select('id');
  if (expected.canWrite) {
    assert(!updateResult.error && updateResult.data?.length === 1, `${label} should update location`);
  } else {
    assert(updateResult.error || !updateResult.data || updateResult.data.length === 0, `${label} must not update location`);
  }

  const hardDeleteResult = await client
    .from('ga_inventory_locations')
    .delete()
    .eq('id', fixtures.storeLocation.id)
    .select('id');
  assert(hardDeleteResult.error || !hardDeleteResult.data || hardDeleteResult.data.length === 0, `${label} must not hard delete location`);
}

async function testRls(users, fixtures, cleanup) {
  await runCase('RLS no_access', () => testRlsClient(users.noAccess.client, 'no_access', fixtures, {
    locationCodes: [],
    locationPartCount: 0,
    canWrite: false,
  }, cleanup));
  await runCase('RLS store_manager', () => testRlsClient(users.storeManager.client, 'store_manager', fixtures, {
    locationCodes: [fixtures.codes.store],
    locationPartCount: 1,
    canWrite: false,
  }, cleanup));
  await runCase('RLS inventory_view', () => testRlsClient(users.inventoryView.client, 'inventory_view', fixtures, {
    locationCodes: [fixtures.codes.central, fixtures.codes.otherStore, fixtures.codes.store],
    locationPartCount: 2,
    canWrite: false,
  }, cleanup));
  await runCase('RLS inventory_manage', () => testRlsClient(users.inventoryManage.client, 'inventory_manage', fixtures, {
    locationCodes: [fixtures.codes.central, fixtures.codes.otherStore, fixtures.codes.store],
    locationPartCount: 2,
    canWrite: true,
  }, cleanup));
}

async function testApiIdErrors(siteUrl, users, admin) {
  await expectStatus(siteUrl, '', API_ROOT, 401);
  await expectStatus(siteUrl, users.noAccess.cookieHeader, API_ROOT, 403);

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/not-a-uuid`, 400);
  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/00000000-0000-0000-0000-000000000000`, 400);
  const nonexistentLocationId = await getNonexistentLocationUuid(admin);
  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${nonexistentLocationId}`, 404);
}

async function testApi(siteUrl, users, fixtures, cleanup) {
  const list = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}?search=${encodeURIComponent(fixtures.searchText)}&page=1&pageSize=10&sortBy=code&sortOrder=asc&locationType=STORE`, 200);
  assert(list.success === true && list.data.length >= 2, 'manage list should return DEV script STORE locations');
  assert(list.data.every((row) => row.store), 'location list should include store join for store locations');

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}?storeId=${fixtures.storeOneId}`, 200);
  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}?isActive=true`, 200);

  const single = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${fixtures.storeLocation.id}`, 200);
  assert(single.data?.id === fixtures.storeLocation.id, 'single location should return requested id');

  const conflictPayload = {
    code: fixtures.codes.store,
    name: 'Conflict',
    location_type: 'OFFICE',
  };
  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, API_ROOT, 409, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conflictPayload),
  });

  const createBody = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, API_ROOT, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: makeRunCode(fixtures.runId, 'API'),
      name: `${fixtures.searchText} API Location`,
      location_type: 'OFFICE',
    }),
  });
  assert(createBody.success === true && createBody.data?.id, 'create location should succeed');
  trackLocation(cleanup, createBody.data.id);

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, API_ROOT, 400, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: makeRunCode(fixtures.runId, 'FAKE-CREATED-BY'),
      name: `${fixtures.searchText} Fake Created By`,
      location_type: 'OFFICE',
      created_by: '00000000-0000-0000-0000-000000000000',
    }),
  });

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${createBody.data.id}`, 200, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: 'DEV API patched',
    }),
  });

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${createBody.data.id}`, 400, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: 'DEV API fake updated_by should fail',
      updated_by: '00000000-0000-0000-0000-000000000000',
    }),
  });

  const partsList = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${fixtures.storeLocation.id}/parts?page=1&pageSize=10`, 200);
  assert(partsList.success === true && Array.isArray(partsList.data), 'location parts list should succeed');

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${fixtures.storeLocation.id}/parts`, 409, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ part_id: fixtures.partId }),
  });

  const newLocation = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, API_ROOT, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: makeRunCode(fixtures.runId, 'PART'),
      name: `${fixtures.searchText} Part API Location`,
      location_type: 'OFFICE',
    }),
  });
  trackLocation(cleanup, newLocation.data.id);

  const createdPart = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${newLocation.data.id}/parts`, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_id: fixtures.partId,
      safety_stock_qty: 1,
      reorder_point_qty: 2,
      maximum_stock_qty: 3,
      preferred_issue_unit_type: 'BASE',
    }),
  });
  trackLocationPart(cleanup, createdPart.data.id, newLocation.data.id);

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${newLocation.data.id}/parts/${createdPart.data.id}`, 200, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notes: 'DEV API part patched',
    }),
  });

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${newLocation.data.id}/parts/${createdPart.data.id}`, 200, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deletion_reason: 'DEV API location part soft delete',
    }),
  });

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${fixtures.storeLocation.id}`, 403, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'should fail' }),
  });

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${createBody.data.id}`, 200, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deletion_reason: 'DEV API location soft delete',
    }),
  });
}

async function testSoftDeleteCascade(siteUrl, users, fixtures, admin, cleanup) {
  const location = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, API_ROOT, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: makeRunCode(fixtures.runId, 'CASCADE'),
      name: `${fixtures.searchText} Cascade Location`,
      location_type: 'OFFICE',
    }),
  });
  trackLocation(cleanup, location.data.id);

  const deletedChild = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${location.data.id}/parts`, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_id: fixtures.partId,
      preferred_issue_unit_type: 'BASE',
    }),
  });
  trackLocationPart(cleanup, deletedChild.data.id, location.data.id);

  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${location.data.id}/parts/${deletedChild.data.id}`, 200, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletion_reason: 'DEV cascade predeleted child' }),
  });

  await expectAlreadyDeletedConflict(
    siteUrl,
    users.inventoryManage.cookieHeader,
    `${API_ROOT}/${location.data.id}/parts/${deletedChild.data.id}`,
    '此位置料件設定已被刪除',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_reason: 'DEV repeated child delete should conflict' }),
    },
  );

  const { data: predeletedChildBefore, error: predeletedBeforeError } = await admin
    .from('ga_inventory_location_parts')
    .select('deleted_at, deleted_by, deletion_reason')
    .eq('id', deletedChild.data.id)
    .single();
  if (predeletedBeforeError) throwSupabaseError('read predeleted child before cascade failed', predeletedBeforeError);

  const activeChild = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${location.data.id}/parts`, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_id: fixtures.partId,
      preferred_issue_unit_type: 'BASE',
      notes: 'DEV cascade active child',
    }),
  });
  trackLocationPart(cleanup, activeChild.data.id, location.data.id);

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${location.data.id}`, 403, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletion_reason: 'DEV non-manage should fail' }),
  });

  const deleteReason = 'DEV cascade parent soft delete';
  await expectStatus(siteUrl, users.inventoryManage.cookieHeader, `${API_ROOT}/${location.data.id}`, 200, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletion_reason: deleteReason }),
  });

  const { data: parentAfter, error: parentAfterError } = await admin
    .from('ga_inventory_locations')
    .select('deleted_at, deleted_by, deletion_reason')
    .eq('id', location.data.id)
    .single();
  if (parentAfterError) throwSupabaseError('read parent after cascade failed', parentAfterError);

  const { data: childrenAfter, error: childrenAfterError } = await admin
    .from('ga_inventory_location_parts')
    .select('id, deleted_at, deleted_by, deletion_reason')
    .in('id', [deletedChild.data.id, activeChild.data.id])
    .order('id');
  if (childrenAfterError) throwSupabaseError('read children after cascade failed', childrenAfterError);

  const predeletedChildAfter = childrenAfter.find((row) => row.id === deletedChild.data.id);
  const activeChildAfter = childrenAfter.find((row) => row.id === activeChild.data.id);
  const cascadeDiagnostics = makeCascadeDiagnostics({
    locationId: location.data.id,
    activeChildId: activeChild.data.id,
    predeletedChildId: deletedChild.data.id,
    parentAfter,
    activeChildAfter,
    predeletedChildBefore,
    predeletedChildAfter,
    expectedReason: deleteReason,
  });
  if (!parentAfter.deleted_at || !parentAfter.deleted_by || parentAfter.deletion_reason !== deleteReason) {
    throwCascadeAssertion('parent soft delete fields should be set', cascadeDiagnostics);
  }
  if (!activeChildAfter?.deleted_at || activeChildAfter.deleted_by !== parentAfter.deleted_by) {
    throwCascadeAssertion('active child should cascade soft delete with same deleted_by', cascadeDiagnostics);
  }
  if (activeChildAfter.deletion_reason !== deleteReason) {
    throwCascadeAssertion(
      `Expected active child deletion_reason: "${deleteReason}". Actual active child deletion_reason: "${activeChildAfter.deletion_reason}"`,
      cascadeDiagnostics,
    );
  }
  if (predeletedChildAfter?.deleted_at !== predeletedChildBefore.deleted_at) {
    throwCascadeAssertion('predeleted child deleted_at must not be rewritten', cascadeDiagnostics);
  }
  if (predeletedChildAfter.deletion_reason !== predeletedChildBefore.deletion_reason) {
    throwCascadeAssertion('predeleted child reason must not be rewritten', cascadeDiagnostics);
  }

  await expectAlreadyDeletedConflict(
    siteUrl,
    users.inventoryManage.cookieHeader,
    `${API_ROOT}/${location.data.id}`,
    '此庫存位置已被刪除',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_reason: 'DEV second delete should fail' }),
    },
  );
}

async function testCrossModulePartView(siteUrl, users, fixtures, admin, cleanup) {
  const manageParts = await expectStatus(siteUrl, users.inventoryManage.cookieHeader, '/api/general-affairs/parts?pageSize=5&isActive=true', 200);
  assert(manageParts.success === true && manageParts.data.length >= 1, 'inventory manager with part.view should see parts');

  await setupManageWithoutPartViewRole(admin);

  const noPart = await apiFetch(siteUrl, users.inventoryView.cookieHeader, '/api/general-affairs/parts?pageSize=5&isActive=true');
  assert(noPart.response.status === 403, `inventory manage without part.view simulation expected 403, got ${noPart.response.status}`);

  const location = await expectStatus(siteUrl, users.inventoryView.cookieHeader, API_ROOT, 201, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: makeRunCode(fixtures.runId, 'NO-PART'),
      name: `${fixtures.searchText} Manage Without Part View`,
      location_type: 'OFFICE',
    }),
  });
  trackLocation(cleanup, location.data.id);

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${location.data.id}/parts`, 403, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_id: fixtures.partId,
      preferred_issue_unit_type: 'BASE',
    }),
  });

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${fixtures.storeLocation.id}/parts/${fixtures.locationPart.id}`, 403, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      part_id: fixtures.partId,
    }),
  });

  await expectStatus(siteUrl, users.inventoryView.cookieHeader, `${API_ROOT}/${location.data.id}`, 200, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletion_reason: 'DEV manage without part cleanup' }),
  });
}

async function main() {
  runGuard('scripts/verify-dev-supabase-environment.js');
  loadEnvConfig(process.cwd(), true);

  const runId = createRunId();
  const cleanup = makeCleanupTracker();
  console.log(`Test run ID: ${runId}`);

  const siteUrl = getSiteUrl();
  await assertServerIsRunning(siteUrl);

  const admin = createServiceClient();
  await deactivateTemporaryManageWithoutPartViewRole(admin);

  const passwordByEmail = {};
  for (const user of Object.values(USERS)) {
    passwordByEmail[user.email] = await promptHidden(`Password for ${user.email}: `);
  }

  const signedIn = {};
  for (const [key, user] of Object.entries(USERS)) {
    signedIn[key] = await signIn(user.email, passwordByEmail[user.email]);
  }

  let fixtures = null;
  try {
    fixtures = await runCase('SETUP test resources', () => setupFixtures(admin, runId, cleanup));
    await testRls(signedIn, fixtures, cleanup);
    await runCase('API id errors', () => testApiIdErrors(siteUrl, signedIn, admin));
    await runCase('API inventory locations', () => testApi(siteUrl, signedIn, fixtures, cleanup));
    await runCase('soft delete cascade', () => testSoftDeleteCascade(siteUrl, signedIn, fixtures, admin, cleanup));
    await runCase('cross-module part.view', () => testCrossModulePartView(siteUrl, signedIn, fixtures, admin, cleanup));
  } finally {
    if (signedIn.inventoryManage?.cookieHeader) {
      await cleanupTestResources(siteUrl, signedIn.inventoryManage.cookieHeader, cleanup).catch((error) => {
        console.warn('WARN CLEANUP test resources');
        logFormattedError(error);
      });
    }
    await deactivateTemporaryManageWithoutPartViewRole(admin).catch((error) => {
      console.warn('WARN CLEANUP temporary RBAC assignment');
      logFormattedError(error);
    });
    for (const user of Object.values(signedIn)) {
      await user.client.auth.signOut();
    }
  }

  console.log('Task 1C-1 RLS/API tests passed');
}

main().catch((error) => {
  console.error('Task 1C-1 RLS/API tests failed');
  logFormattedError(error);
  process.exit(1);
});
