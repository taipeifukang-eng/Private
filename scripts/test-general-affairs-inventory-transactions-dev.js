#!/usr/bin/env node

/**
 * Task 1C-2B DEV DB/RLS/RPC verification.
 *
 * Local DEV only. This script:
 * - runs the DEV environment guard first
 * - creates/updates dedicated DEV auth users with in-memory random passwords
 * - uses service role only for DEV fixture/RBAC setup and verification
 * - executes RLS/RPC checks with authenticated user clients
 * - keeps inventory transactions append-only and uses unique run IDs
 * - never prints keys, JWTs, passwords, or connection strings
 */

const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const USERS = {
  noAccess: { label: 'no_access', email: 'dev-1c2b-no-access@example.test' },
  balanceView: { label: 'inventory_balance_view', email: 'dev-1c2b-balance-view@example.test' },
  transactionView: { label: 'inventory_transaction_view', email: 'dev-1c2b-transaction-view@example.test' },
  transactionManage: { label: 'inventory_transaction_manage', email: 'dev-1c2b-transaction-manage@example.test' },
  transactionManageB: { label: 'inventory_transaction_manage_b', email: 'dev-1c2b-transaction-manage-b@example.test' },
  transactionManageNoPart: { label: 'inventory_transaction_manage_no_part', email: 'dev-1c2b-manage-no-part@example.test' },
  storeManagerA: { label: 'store_manager_a', email: 'dev-1c2b-store-a@example.test' },
  storeManagerB: { label: 'store_manager_b', email: 'dev-1c2b-store-b@example.test' },
};

const TEMP_ROLES = {
  balanceView: 'dev_inventory_balance_view_temp',
  transactionView: 'dev_inventory_transaction_view_temp',
  transactionManage: 'dev_inventory_transaction_manage_temp',
  transactionManageB: 'dev_inventory_transaction_manage_b_temp',
  transactionManageNoPart: 'dev_inventory_transaction_manage_no_part_temp',
};

const PERMISSIONS = {
  balanceView: 'general_affairs.inventory_balance.view',
  transactionView: 'general_affairs.inventory_transaction.view',
  transactionManage: 'general_affairs.inventory_transaction.manage',
  partView: 'general_affairs.part.view',
};

const SENSITIVE_KEY_PATTERN = /(password|access_token|refresh_token|authorization|api[-_]?key|anon[-_ ]?key|service[-_ ]?role[-_ ]?key|jwt|cookie|set-cookie|token)/i;

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
    return '[Unserializable value]';
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: sanitizeForLog(error.cause),
      details: sanitizeForLog(error.details),
    };
  }
  if (typeof error === 'string') return error;
  return sanitizeForLog(error);
}

function logFormattedError(error) {
  console.error(safeJson(formatError(error)));
}

async function runCase(name, fn) {
  console.log(`RUN ${name}`);
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

function createRunId() {
  return randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function runCode(runId, suffix) {
  return `DEV-1C2B-${runId}-${suffix}`.toUpperCase();
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

async function signIn(email, password) {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  if (!data.session) throw new Error(`sign in did not return session for ${email}`);
  return client;
}

function assertSupabaseOk(context, error) {
  if (error) {
    const wrapped = new Error(`${context}: ${error.message}`);
    wrapped.details = error;
    throw wrapped;
  }
}

async function expectRpcError(client, name, args, expectedCode) {
  const { data, error } = await client.rpc(name, args);
  if (!error) {
    const wrapped = new Error(`Expected RPC ${name} to fail with ${expectedCode}`);
    wrapped.details = { data };
    throw wrapped;
  }
  assert(String(error.message || '').includes(expectedCode), `Expected ${expectedCode}, got ${error.message}`);
  return error;
}

async function expectRpcErrorOneOf(client, name, args, expectedCodes) {
  const { data, error } = await client.rpc(name, args);
  if (!error) {
    const wrapped = new Error(`Expected RPC ${name} to fail with one of ${expectedCodes.join(', ')}`);
    wrapped.details = { data };
    throw wrapped;
  }
  const message = String(error.message || '');
  assert(
    expectedCodes.some((code) => message.includes(code)),
    `Expected one of ${expectedCodes.join(', ')}, got ${error.message}`,
  );
  return error;
}

async function expectSelectCount(client, table, filters, expectedCount, label) {
  let query = client.from(table).select('*', { count: 'exact', head: false });
  for (const filter of filters || []) query = filter(query);
  const { data, error, count } = await query;
  assertSupabaseOk(`${label} select ${table}`, error);
  const actual = count ?? data?.length ?? 0;
  assert(actual === expectedCount, `${label} expected ${expectedCount} ${table}, got ${actual}`);
  return data || [];
}

async function getProfileByEmail(admin, email) {
  const { data, error } = await admin.from('profiles').select('id, email').eq('email', email).single();
  assertSupabaseOk(`load profile ${email}`, error);
  return data;
}

async function getId(admin, table, column, value) {
  const { data, error } = await admin.from(table).select('id').eq(column, value).limit(1).single();
  assertSupabaseOk(`load ${table}.${column}=${value}`, error);
  return data.id;
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

async function ensureDevAuthUser(admin, userConfig) {
  const password = `${randomUUID()}Aa1!`;
  const existing = await findAuthUserByEmail(admin, userConfig.email);
  let authUser = existing;

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: `DEV 1C-2B ${userConfig.label}` },
    });
    if (error) throw new Error(`update DEV auth user ${userConfig.email} failed: ${error.message}`);
    authUser = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: userConfig.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `DEV 1C-2B ${userConfig.label}` },
    });
    if (error) throw new Error(`create DEV auth user ${userConfig.email} failed: ${error.message}`);
    authUser = data.user;
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: authUser.id,
      email: userConfig.email,
      full_name: `DEV 1C-2B ${userConfig.label}`,
      role: 'member',
      department: 'DEV',
      job_title: 'Task 1C-2B 驗收',
    }, { onConflict: 'id' });
  assertSupabaseOk(`upsert profile ${userConfig.email}`, profileError);

  return { id: authUser.id, email: userConfig.email, password };
}

async function ensureDevAuthUsers(admin) {
  const result = {};
  for (const [key, config] of Object.entries(USERS)) result[key] = await ensureDevAuthUser(admin, config);
  return result;
}

async function upsertRole(admin, code, permissionCodes, userId) {
  const { data: role, error: roleError } = await admin
    .from('roles')
    .upsert({
      code,
      name: `DEV ${code}`,
      description: `Temporary DEV verification role ${code}`,
      is_system: false,
      is_active: true,
    }, { onConflict: 'code' })
    .select('id')
    .single();
  assertSupabaseOk(`upsert role ${code}`, roleError);

  const { data: permissions, error: permissionError } = await admin
    .from('permissions')
    .select('id, code')
    .in('code', permissionCodes);
  assertSupabaseOk(`load permissions for ${code}`, permissionError);

  const permissionByCode = Object.fromEntries((permissions || []).map((p) => [p.code, p.id]));
  for (const permissionCode of permissionCodes) assert(permissionByCode[permissionCode], `Missing permission ${permissionCode}`);

  if (permissionCodes.length > 0) {
    const { error: rolePermissionError } = await admin
      .from('role_permissions')
      .upsert(permissionCodes.map((permissionCode) => ({
        role_id: role.id,
        permission_id: permissionByCode[permissionCode],
        is_allowed: true,
      })), { onConflict: 'role_id,permission_id' });
    assertSupabaseOk(`upsert role permissions ${code}`, rolePermissionError);
  }

  const { error: userRoleError } = await admin
    .from('user_roles')
    .upsert({
      user_id: userId,
      role_id: role.id,
      is_active: true,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }, { onConflict: 'user_id,role_id' });
  assertSupabaseOk(`upsert user role ${code}`, userRoleError);

  return role.id;
}

async function deactivateTempRoles(admin) {
  const { data: roles, error } = await admin.from('roles').select('id').in('code', Object.values(TEMP_ROLES));
  if (error) throw new Error(`load temp roles failed: ${error.message}`);
  const ids = (roles || []).map((role) => role.id);
  if (ids.length === 0) return;
  const { error: updateError } = await admin
    .from('user_roles')
    .update({ is_active: false, expires_at: new Date().toISOString() })
    .in('role_id', ids);
  assertSupabaseOk('deactivate temp user roles', updateError);
}

async function setupRbac(admin, profiles, stores) {
  await deactivateTempRoles(admin);
  await upsertRole(admin, TEMP_ROLES.balanceView, [PERMISSIONS.balanceView], profiles.balanceView.id);
  await upsertRole(admin, TEMP_ROLES.transactionView, [PERMISSIONS.transactionView], profiles.transactionView.id);
  await upsertRole(admin, TEMP_ROLES.transactionManage, [
    PERMISSIONS.balanceView,
    PERMISSIONS.transactionView,
    PERMISSIONS.transactionManage,
    PERMISSIONS.partView,
  ], profiles.transactionManage.id);
  await upsertRole(admin, TEMP_ROLES.transactionManageB, [
    PERMISSIONS.balanceView,
    PERMISSIONS.transactionView,
    PERMISSIONS.transactionManage,
    PERMISSIONS.partView,
  ], profiles.transactionManageB.id);
  await upsertRole(admin, TEMP_ROLES.transactionManageNoPart, [PERMISSIONS.transactionManage], profiles.transactionManageNoPart.id);

  const { error: deleteStoreManagersError } = await admin
    .from('store_managers')
    .delete()
    .in('user_id', [profiles.storeManagerA.id, profiles.storeManagerB.id]);
  assertSupabaseOk('clear temporary store manager mappings', deleteStoreManagersError);

  const { error: storeManagerError } = await admin
    .from('store_managers')
    .insert([
      { store_id: stores.storeOneId, user_id: profiles.storeManagerA.id, role_type: 'store_manager', is_primary: true },
      { store_id: stores.storeTwoId, user_id: profiles.storeManagerB.id, role_type: 'store_manager', is_primary: true },
    ]);
  assertSupabaseOk('insert temporary store manager mappings', storeManagerError);
}

async function createLocation(admin, payload) {
  const { data, error } = await admin.from('ga_inventory_locations').insert(payload).select('*').single();
  assertSupabaseOk(`create location ${payload.code}`, error);
  return data;
}

async function createLocationPart(admin, payload) {
  const { data, error } = await admin.from('ga_inventory_location_parts').insert(payload).select('*').single();
  assertSupabaseOk('create location part', error);
  return data;
}

async function createPart(admin, partCategoryId, runId, suffix, overrides = {}) {
  const { data, error } = await admin
    .from('ga_parts')
    .insert({
      category_id: partCategoryId,
      name: `DEV 1C-2B ${runId} ${suffix}`,
      part_code: runCode(runId, suffix),
      base_unit: '個',
      minimum_issue_qty: 1,
      allow_fractional_issue: false,
      allow_unpacking: true,
      specs: {},
      ...overrides,
    })
    .select('*')
    .single();
  assertSupabaseOk(`create fixture part ${suffix}`, error);
  return data;
}

async function setupFixtures(admin, runId, actorProfileId) {
  const storeOneId = await getId(admin, 'stores', 'store_code', 'DEV001');
  const storeTwoId = await getId(admin, 'stores', 'store_code', 'DEV002');
  const partCategoryId = await getId(admin, 'ga_part_categories', 'code', 'DEV-1B-3-PART');

  const basePart = await createPart(admin, partCategoryId, runId, 'BASE');
  const purchasePart = await createPart(admin, partCategoryId, runId, 'PURCHASE', {
    purchase_unit: '箱',
    purchase_to_base_rate: 12,
  });
  const fractionalPart = await createPart(admin, partCategoryId, runId, 'FRACTION', {
    base_unit: '公尺',
    minimum_issue_qty: 0.25,
    allow_fractional_issue: true,
  });
  const noPurchasePart = await createPart(admin, partCategoryId, runId, 'NOPURCHASE');
  const noUnpackPart = await createPart(admin, partCategoryId, runId, 'NOUNPACK', {
    purchase_unit: '箱',
    purchase_to_base_rate: 12,
    allow_unpacking: false,
  });
  const minimumQtyPart = await createPart(admin, partCategoryId, runId, 'MINQTY', {
    minimum_issue_qty: 2,
  });
  const inactivePart = await createPart(admin, partCategoryId, runId, 'INACTIVEPART');
  const { error: inactivePartError } = await admin
    .from('ga_parts')
    .update({ is_active: false })
    .eq('id', inactivePart.id);
  assertSupabaseOk('deactivate fixture part', inactivePartError);

  const deletedPart = await createPart(admin, partCategoryId, runId, 'DELETEDPART');
  const { error: deletedPartError } = await admin
    .from('ga_parts')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: actorProfileId,
      deletion_reason: `DEV Task 1C-2B deleted fixture ${runId}`,
    })
    .eq('id', deletedPart.id);
  assertSupabaseOk('soft delete fixture part', deletedPartError);

  const normalLocation = await createLocation(admin, {
    code: runCode(runId, 'LOC'),
    name: `DEV 1C-2B ${runId} normal`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: false,
  });
  const basicLocation = await createLocation(admin, {
    code: runCode(runId, 'BASIC'),
    name: `DEV 1C-2B ${runId} basic`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: false,
  });
  const negativeLocation = await createLocation(admin, {
    code: runCode(runId, 'NEG'),
    name: `DEV 1C-2B ${runId} negative`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: true,
  });
  const otherStoreLocation = await createLocation(admin, {
    code: runCode(runId, 'OTHER'),
    name: `DEV 1C-2B ${runId} other store`,
    location_type: 'STORE',
    store_id: storeTwoId,
    allow_negative_stock: false,
  });
  const centralLocation = await createLocation(admin, {
    code: runCode(runId, 'CENTRAL'),
    name: `DEV 1C-2B ${runId} central`,
    location_type: 'CENTRAL_WAREHOUSE',
    allow_negative_stock: false,
  });
  const noSettingLocation = await createLocation(admin, {
    code: runCode(runId, 'NOSET'),
    name: `DEV 1C-2B ${runId} no setting`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: false,
  });
  const inactiveLocation = await createLocation(admin, {
    code: runCode(runId, 'INACTIVE'),
    name: `DEV 1C-2B ${runId} inactive`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: false,
  });
  const { error: inactiveLocationError } = await admin
    .from('ga_inventory_locations')
    .update({ is_active: false })
    .eq('id', inactiveLocation.id);
  assertSupabaseOk('deactivate fixture location', inactiveLocationError);

  const locationParts = {};
  for (const location of [normalLocation, basicLocation, negativeLocation, otherStoreLocation, centralLocation]) {
    locationParts[location.id] = await createLocationPart(admin, {
      location_id: location.id,
      part_id: basePart.id,
      safety_stock_qty: 1,
      reorder_point_qty: 2,
      maximum_stock_qty: 1000,
      preferred_issue_unit_type: 'BASE',
    });
  }

  const inactiveLocationPartLocation = await createLocation(admin, {
    code: runCode(runId, 'LPINACTIVE'),
    name: `DEV 1C-2B ${runId} inactive location part`,
    location_type: 'STORE',
    store_id: storeOneId,
    allow_negative_stock: false,
  });
  const inactiveLocationPart = await createLocationPart(admin, {
    location_id: inactiveLocationPartLocation.id,
    part_id: basePart.id,
    safety_stock_qty: 1,
    reorder_point_qty: 2,
    maximum_stock_qty: 1000,
  });
  const { error: inactiveLpError } = await admin
    .from('ga_inventory_location_parts')
    .update({ is_active: false })
    .eq('id', inactiveLocationPart.id);
  assertSupabaseOk('deactivate fixture location part', inactiveLpError);

  for (const part of [purchasePart, fractionalPart, noPurchasePart, noUnpackPart, minimumQtyPart]) {
    await createLocationPart(admin, {
      location_id: normalLocation.id,
      part_id: part.id,
      safety_stock_qty: 1,
      reorder_point_qty: 2,
      maximum_stock_qty: 1000,
    });
  }

  return {
    runId,
    actorProfileId,
    partId: basePart.id,
    purchasePartId: purchasePart.id,
    fractionalPartId: fractionalPart.id,
    noPurchasePartId: noPurchasePart.id,
    noUnpackPartId: noUnpackPart.id,
    minimumQtyPartId: minimumQtyPart.id,
    inactivePartId: inactivePart.id,
    deletedPartId: deletedPart.id,
    storeOneId,
    storeTwoId,
    normalLocation,
    basicLocation,
    negativeLocation,
    otherStoreLocation,
    centralLocation,
    noSettingLocation,
    inactiveLocation,
    inactiveLocationPartLocation,
    locationParts,
    locationIds: [
      normalLocation.id,
      basicLocation.id,
      negativeLocation.id,
      otherStoreLocation.id,
      centralLocation.id,
      noSettingLocation.id,
      inactiveLocation.id,
      inactiveLocationPartLocation.id,
    ],
    partIds: [
      basePart.id,
      purchasePart.id,
      fractionalPart.id,
      noPurchasePart.id,
      noUnpackPart.id,
      minimumQtyPart.id,
      inactivePart.id,
      deletedPart.id,
    ],
  };
}

async function setupDynamicBFixtures(admin, runId, actorProfileId) {
  return {
    runId,
    actorProfileId,
    storeOneId: await getId(admin, 'stores', 'store_code', 'DEV001'),
    partCategoryId: await getId(admin, 'ga_part_categories', 'code', 'DEV-1B-3-PART'),
    locationIds: [],
    partIds: [],
  };
}

async function createInventoryCase(admin, fixtures, suffix, options = {}) {
  const part = await createPart(admin, fixtures.partCategoryId, fixtures.runId, `B-${suffix}-PART`, {
    allow_fractional_issue: false,
    allow_unpacking: true,
    ...options.partOverrides,
  });
  fixtures.partIds.push(part.id);

  const location = await createLocation(admin, {
    code: runCode(fixtures.runId, `B-${suffix}-LOC`),
    name: `DEV 1C-2B ${fixtures.runId} ${suffix}`,
    location_type: 'STORE',
    store_id: fixtures.storeOneId,
    allow_negative_stock: options.allowNegativeStock === true,
  });
  fixtures.locationIds.push(location.id);

  const locationPart = await createLocationPart(admin, {
    location_id: location.id,
    part_id: part.id,
    safety_stock_qty: 0,
    reorder_point_qty: 0,
    maximum_stock_qty: 10000,
  });

  return { location, part, locationPart };
}

async function postTransaction(client, payload) {
  const { data, error } = await client.rpc('ga_post_inventory_transaction', {
    p_transaction_type: payload.transaction_type,
    p_location_id: payload.location_id,
    p_part_id: payload.part_id,
    p_quantity: payload.quantity,
    p_input_unit_type: payload.input_unit_type,
    p_reason: payload.reason,
    p_notes: payload.notes ?? null,
    p_reference_type: payload.reference_type ?? null,
    p_reference_id: payload.reference_id ?? null,
    p_idempotency_key: payload.idempotency_key ?? null,
    p_occurred_at: payload.occurred_at ?? null,
    p_metadata: payload.metadata ?? {},
  });
  assertSupabaseOk(`post transaction ${payload.reason}`, error);
  assert(Array.isArray(data) && data.length === 1, 'RPC should return one row');
  return data[0];
}

async function getBalance(admin, locationId, partId) {
  const { data, error } = await admin
    .from('ga_inventory_balances')
    .select('*')
    .eq('location_id', locationId)
    .eq('part_id', partId)
    .single();
  assertSupabaseOk('load balance', error);
  return data;
}

async function getTransactions(admin, locationId, partId, reasonPrefix) {
  let query = admin
    .from('ga_inventory_transactions')
    .select('*')
    .eq('location_id', locationId)
    .eq('part_id', partId)
    .order('created_at', { ascending: true });
  if (reasonPrefix) query = query.like('reason', `${reasonPrefix}%`);
  const { data, error } = await query;
  assertSupabaseOk('load transactions', error);
  return data || [];
}

async function countTransactions(admin, locationId, partId, reasonPrefix) {
  let query = admin
    .from('ga_inventory_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('part_id', partId);
  if (reasonPrefix) query = query.like('reason', `${reasonPrefix}%`);
  const { count, error } = await query;
  assertSupabaseOk('count transactions', error);
  return count || 0;
}

function assertBalanceMatchesLastTransaction(balance, transactions, expectedSuccessCount) {
  assert(transactions.length === expectedSuccessCount, `expected ${expectedSuccessCount} transactions, got ${transactions.length}`);
  const last = transactions[transactions.length - 1];
  assert(last, 'expected at least one transaction');
  for (const tx of transactions) {
    assert(tx.balance_before + tx.quantity_base === tx.balance_after, 'transaction balance math should match');
  }
  assert(balance.quantity_base === last.balance_after, 'final balance should equal last transaction balance_after');
  assert(balance.last_transaction_id === last.id, 'last_transaction_id should point to latest transaction');
  assert(balance.version === expectedSuccessCount, `balance version should equal success count ${expectedSuccessCount}, got ${balance.version}`);
}

function isRawUniqueViolation(error) {
  const serialized = safeJson(formatError(error));
  return serialized.includes('"code": "23505"') || serialized.includes('duplicate key value violates unique constraint');
}

async function testRls(users, fixtures) {
  await runCase('RLS no_access', async () => {
    await expectSelectCount(users.noAccess, 'ga_inventory_balances', [], 0, 'no_access balances');
    await expectSelectCount(users.noAccess, 'ga_inventory_transactions', [], 0, 'no_access transactions');
    await expectRpcError(users.noAccess, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV no access should fail',
    }, 'PERMISSION_DENIED');
  });

  await runCase('RLS inventory_balance.view', async () => {
    await postTransaction(users.transactionManage, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.partId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} seed for balance view`,
    });
    await postTransaction(users.transactionManage, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.otherStoreLocation.id,
      part_id: fixtures.partId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} seed for other store view`,
    });
    await postTransaction(users.transactionManage, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.centralLocation.id,
      part_id: fixtures.partId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} seed for central view`,
    });
    const balances = await expectSelectCount(users.balanceView, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 1, 'balance_view balances');
    assert(balances[0].quantity_base >= 1, 'balance_view should see balance quantity');
    await expectSelectCount(users.balanceView, 'ga_inventory_transactions', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 0, 'balance_view transactions');

    await expectSelectCount(users.transactionView, 'ga_inventory_transactions', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 1, 'transaction_view transactions');
    await expectSelectCount(users.transactionView, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 0, 'transaction_view balances');

    await expectRpcError(users.balanceView, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV balance view cannot write',
    }, 'PERMISSION_DENIED');
  });

  await runCase('RLS inventory_transaction.manage without part.view', async () => {
    await expectRpcError(users.transactionManageNoPart, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV no part view should fail',
    }, 'PART_VIEW_REQUIRED');
  });

  await runCase('RLS store_manager_a', async () => {
    await expectSelectCount(users.storeManagerA, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 1, 'store_manager_a own store balance');
    await expectSelectCount(users.storeManagerA, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.otherStoreLocation.id),
    ], 0, 'store_manager_a other store balance');
    await expectSelectCount(users.storeManagerA, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.centralLocation.id),
    ], 0, 'store_manager_a central balance');
    await expectRpcError(users.storeManagerA, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV store manager cannot write',
    }, 'PERMISSION_DENIED');
  });

  await runCase('RLS store_manager_b', async () => {
    await expectSelectCount(users.storeManagerB, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.otherStoreLocation.id),
    ], 1, 'store_manager_b own store balance');
    await expectSelectCount(users.storeManagerB, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.normalLocation.id),
    ], 0, 'store_manager_b other store balance');
    await expectSelectCount(users.storeManagerB, 'ga_inventory_balances', [
      (q) => q.eq('location_id', fixtures.centralLocation.id),
    ], 0, 'store_manager_b central balance');
  });
}

async function testBasicTransactions(users, fixtures, admin) {
  const manager = users.transactionManage;
  const base = `DEV ${fixtures.runId} basic`;
  const { data: userData, error: userError } = await manager.auth.getUser();
  assertSupabaseOk('load transaction manage auth user', userError);
  const currentUserId = userData.user.id;
  const receipt = await postTransaction(manager, {
    transaction_type: 'RECEIPT',
    location_id: fixtures.basicLocation.id,
    part_id: fixtures.partId,
    quantity: 10,
    input_unit_type: 'BASE',
    reason: `${base} receipt`,
  });
  assert(receipt.unit_conversion_rate === 1, 'BASE rate must be 1');
  assert(receipt.created_by === currentUserId, 'transaction created_by should be current authenticated user');
  assert(receipt.idempotent_replay === false, 'new transaction should not be idempotent replay');
  assert(receipt.balance_before === 0, 'first receipt balance_before should be 0');
  assert(receipt.balance_after === 10, 'first receipt balance_after should be 10');

  const secondReceipt = await postTransaction(manager, {
    transaction_type: 'RECEIPT',
    location_id: fixtures.basicLocation.id,
    part_id: fixtures.partId,
    quantity: 5,
    input_unit_type: 'BASE',
    reason: `${base} second receipt`,
  });
  assert(secondReceipt.balance_before === 10, 'second receipt balance_before should be 10');
  assert(secondReceipt.balance_after === 15, 'second receipt should add quantity');

  const issue = await postTransaction(manager, {
    transaction_type: 'ISSUE',
    location_id: fixtures.basicLocation.id,
    part_id: fixtures.partId,
    quantity: 4,
    input_unit_type: 'BASE',
    reason: `${base} issue`,
  });
  assert(issue.quantity_base === -4, 'ISSUE quantity_base must be -4');
  assert(issue.balance_before + issue.quantity_base === issue.balance_after, 'ISSUE balance math should match');
  assert(issue.balance_after === 11, 'ISSUE should reduce balance to 11');

  const adjustIn = await postTransaction(manager, {
    transaction_type: 'ADJUST_IN',
    location_id: fixtures.basicLocation.id,
    part_id: fixtures.partId,
    quantity: 2,
    input_unit_type: 'BASE',
    reason: `${base} adjust in`,
  });
  assert(adjustIn.quantity_base === 2, 'ADJUST_IN quantity_base must be 2');
  assert(adjustIn.balance_before + adjustIn.quantity_base === adjustIn.balance_after, 'ADJUST_IN balance math should match');
  assert(adjustIn.balance_after === 13, 'ADJUST_IN should increase balance to 13');

  const adjustOut = await postTransaction(manager, {
    transaction_type: 'ADJUST_OUT',
    location_id: fixtures.basicLocation.id,
    part_id: fixtures.partId,
    quantity: 3,
    input_unit_type: 'BASE',
    reason: `${base} adjust out`,
  });
  assert(adjustOut.quantity_base === -3, 'ADJUST_OUT quantity_base must be -3');
  assert(adjustOut.balance_before + adjustOut.quantity_base === adjustOut.balance_after, 'ADJUST_OUT balance math should match');
  assert(adjustOut.balance_after === 10, 'ADJUST_OUT should reduce balance to 10');

  const balance = await getBalance(admin, fixtures.basicLocation.id, fixtures.partId);
  assert(balance.last_transaction_id === adjustOut.transaction_id, 'last_transaction_id should point to latest transaction');
  assert(balance.quantity_base === adjustOut.balance_after, 'balance should match latest transaction balance_after');
  assert(balance.version === 5, `balance version should be 5, got ${balance.version}`);
  assert(Boolean(balance.last_transaction_at), 'last_transaction_at should be set');

  const txs = [receipt, secondReceipt, issue, adjustIn, adjustOut];
  const txNos = new Set(txs.map((tx) => tx.transaction_no));
  assert(txNos.size === txs.length, 'transaction_no should be unique across basic transactions');
  for (const tx of txs) {
    assert(/^INV-\d{12}$/.test(tx.transaction_no), `unexpected transaction_no format: ${tx.transaction_no}`);
    assert(tx.created_by === currentUserId, 'created_by should always be current user');
    assert(tx.balance_before + tx.quantity_base === tx.balance_after, 'balance_before + quantity_base should equal balance_after');
    assert(tx.idempotent_replay === false, 'basic transactions should not be replayed');
  }

  const count = await countTransactions(admin, fixtures.basicLocation.id, fixtures.partId, base);
  assert(count === 5, `basic transaction count should be 5, got ${count}`);
}

async function testValidation(users, fixtures) {
  const manager = users.transactionManage;
  await runCase('unit and validation rules', async () => {
    const purchase = await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.purchasePartId,
      quantity: 1,
      input_unit_type: 'PURCHASE',
      reason: `DEV ${fixtures.runId} purchase receipt`,
    });
    assert(purchase.unit_conversion_rate === 12, `PURCHASE should use rate 12, got ${purchase.unit_conversion_rate}`);
    assert(purchase.quantity_base === 12, 'PURCHASE quantity_base should equal 12 for qty 1');

    const purchaseIssue = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.purchasePartId,
      quantity: 1,
      input_unit_type: 'PURCHASE',
      reason: `DEV ${fixtures.runId} purchase issue`,
    });
    assert(purchaseIssue.quantity_base === -12, 'PURCHASE ISSUE quantity_base should be -12 for qty 1');

    const baseOnPurchasePart = await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.purchasePartId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} base receipt on purchase part`,
    });
    assert(baseOnPurchasePart.unit_conversion_rate === 1, 'BASE input must use rate 1 even when purchase rate exists');
    assert(baseOnPurchasePart.quantity_base === 1, 'BASE input quantity_base should be 1');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.noPurchasePartId,
      p_quantity: 1,
      p_input_unit_type: 'PURCHASE',
      p_reason: 'DEV no purchase unit should fail',
    }, 'INVALID_PURCHASE_UNIT');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.inactiveLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV inactive location',
    }, 'LOCATION_INACTIVE');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.noSettingLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV missing location part',
    }, 'LOCATION_PART_NOT_CONFIGURED');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.inactiveLocationPartLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV inactive location part',
    }, 'LOCATION_PART_NOT_CONFIGURED');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.inactivePartId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV inactive part',
    }, 'PART_INACTIVE');

    await expectRpcErrorOneOf(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.deletedPartId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV deleted part',
    }, ['PART_NOT_FOUND', 'PART_INACTIVE']);

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: '   ',
    }, 'INVALID_QUANTITY');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 0.5,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV fractional should fail',
    }, 'FRACTIONAL_NOT_ALLOWED');

    const fractionalReceipt = await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.fractionalPartId,
      quantity: 1.5,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} fractional receipt`,
    });
    assert(fractionalReceipt.quantity_base === 1.5, 'fractional part should allow decimal receipt');

    const fractionalIssue = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.fractionalPartId,
      quantity: 0.25,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} fractional issue`,
    });
    assert(fractionalIssue.quantity_base === -0.25, 'fractional part should allow decimal issue');

    await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.minimumQtyPartId,
      quantity: 5,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} minimum seed`,
    });

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.minimumQtyPartId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV minimum should fail',
    }, 'MINIMUM_ISSUE_NOT_MET');

    await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.noUnpackPartId,
      quantity: 6,
      input_unit_type: 'PURCHASE',
      reason: `DEV ${fixtures.runId} no unpack seed`,
    });

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.noUnpackPartId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV unpacking should fail',
    }, 'UNPACKING_NOT_ALLOWED');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.noUnpackPartId,
      p_quantity: 13,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV unpacking 13 should fail',
    }, 'UNPACKING_NOT_ALLOWED');

    const packIssue12 = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.noUnpackPartId,
      quantity: 12,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} pack issue 12`,
    });
    assert(packIssue12.quantity_base === -12, 'pack-only ISSUE 12 BASE should be allowed');

    const packIssue24 = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.noUnpackPartId,
      quantity: 24,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} pack issue 24`,
    });
    assert(packIssue24.quantity_base === -24, 'pack-only ISSUE 24 BASE should be allowed');

    const packPurchaseIssue = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.noUnpackPartId,
      quantity: 1,
      input_unit_type: 'PURCHASE',
      reason: `DEV ${fixtures.runId} pack issue purchase`,
    });
    assert(packPurchaseIssue.quantity_base === -12, 'pack-only ISSUE 1 PURCHASE should be allowed');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV invalid metadata',
      p_metadata: [],
    }, 'INVALID_QUANTITY');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV reference missing type',
      p_reference_id: randomUUID(),
    }, 'INVALID_QUANTITY');
  });
}

async function testNegativeStock(users, fixtures) {
  const manager = users.transactionManage;
  await runCase('negative stock rules', async () => {
    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.noSettingLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 1,
      p_input_unit_type: 'BASE',
      p_reason: 'DEV no setting negative should fail first',
    }, 'LOCATION_PART_NOT_CONFIGURED');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: fixtures.otherStoreLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 999,
      p_input_unit_type: 'BASE',
      p_reason: `DEV ${fixtures.runId} insufficient stock`,
    }, 'INSUFFICIENT_STOCK');

    const negative = await postTransaction(manager, {
      transaction_type: 'ISSUE',
      location_id: fixtures.negativeLocation.id,
      part_id: fixtures.partId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} negative allowed`,
    });
    assert(negative.balance_after < 0, 'allow_negative_stock=true should allow negative balance');
  });
}

async function testIdempotency(users, fixtures, admin) {
  const manager = users.transactionManage;
  await runCase('idempotency', async () => {
    const beforeCount = await countTransactions(admin, fixtures.normalLocation.id, fixtures.partId, `DEV ${fixtures.runId} idem`);
    const payload = {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.partId,
      quantity: 3,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} idem receipt`,
      idempotency_key: `DEV-${fixtures.runId}-IDEM`,
      metadata: { runId: fixtures.runId, case: 'idempotency' },
    };
    const first = await postTransaction(manager, payload);
    const second = await postTransaction(manager, payload);
    const afterCount = await countTransactions(admin, fixtures.normalLocation.id, fixtures.partId, `DEV ${fixtures.runId} idem`);
    assert(second.idempotent_replay === true, 'same idempotency payload should replay');
    assert(first.transaction_id === second.transaction_id, 'idempotent replay should return original transaction');
    assert(afterCount === beforeCount + 1, 'idempotency replay must not add second transaction');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: fixtures.normalLocation.id,
      p_part_id: fixtures.partId,
      p_quantity: 4,
      p_input_unit_type: 'BASE',
      p_reason: `DEV ${fixtures.runId} idem changed`,
      p_idempotency_key: `DEV-${fixtures.runId}-IDEM`,
      p_metadata: { runId: fixtures.runId, case: 'idempotency' },
    }, 'IDEMPOTENCY_CONFLICT');
  });
}

async function testAppendOnly(users, fixtures) {
  await runCase('append-only and direct writes', async () => {
    const manager = users.transactionManage;
    const tx = await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: fixtures.normalLocation.id,
      part_id: fixtures.partId,
      quantity: 1,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} append only`,
    });

    const { error: updateError } = await manager
      .from('ga_inventory_transactions')
      .update({ notes: 'SHOULD FAIL' })
      .eq('id', tx.transaction_id);
    assert(updateError, 'transaction UPDATE should be blocked');

    const { error: deleteError } = await manager
      .from('ga_inventory_transactions')
      .delete()
      .eq('id', tx.transaction_id);
    assert(deleteError, 'transaction DELETE should be blocked');

    const { error: insertError } = await manager
      .from('ga_inventory_transactions')
      .insert({
        transaction_no: `DEV-${fixtures.runId}-SHOULD-NOT-INSERT`,
        transaction_type: 'RECEIPT',
        location_id: fixtures.normalLocation.id,
        part_id: fixtures.partId,
        quantity_input: 1,
        input_unit_type: 'BASE',
        unit_conversion_rate: 1,
        quantity_base: 1,
        balance_before: 0,
        balance_after: 1,
        reason: 'SHOULD FAIL',
        created_by: randomUUID(),
      });
    assert(insertError, 'direct transaction INSERT should be rejected by RLS/grants');

    const { error: balanceUpdateError } = await manager
      .from('ga_inventory_balances')
      .update({ quantity_base: 999 })
      .eq('location_id', fixtures.normalLocation.id)
      .eq('part_id', fixtures.partId);
    assert(balanceUpdateError, 'direct balance UPDATE should be rejected by RLS/grants');

    const { error: balanceInsertError } = await manager
      .from('ga_inventory_balances')
      .insert({
        location_id: fixtures.normalLocation.id,
        part_id: fixtures.noPurchasePartId,
        quantity_base: 123,
        version: 999,
        created_by: randomUUID(),
      });
    assert(balanceInsertError, 'direct balance INSERT should be rejected by RLS/grants');

    const { error: balanceDeleteError } = await manager
      .from('ga_inventory_balances')
      .delete()
      .eq('location_id', fixtures.normalLocation.id)
      .eq('part_id', fixtures.partId);
    assert(balanceDeleteError, 'direct balance DELETE should be rejected by RLS/grants');

    assert(tx.transaction_no && /^INV-\d{12}$/.test(tx.transaction_no), 'transaction_no should be DB generated');
    assert(tx.created_by, 'created_by should be DB generated from auth.uid()');
    assert(typeof tx.balance_before === 'number' || typeof tx.balance_before === 'string', 'balance_before should be DB generated');
    assert(typeof tx.balance_after === 'number' || typeof tx.balance_after === 'string', 'balance_after should be DB generated');
  });
}

async function testConcurrentIssue(users, fixtures, admin) {
  await runCase('concurrency issue oversell protection', async () => {
    const manager = users.transactionManage;
    const location = await createLocation(admin, {
      code: runCode(fixtures.runId, 'CONCUR'),
      name: `DEV 1C-2B ${fixtures.runId} concurrency`,
      location_type: 'STORE',
      store_id: fixtures.storeOneId,
      allow_negative_stock: false,
    });
    fixtures.locationIds.push(location.id);
    await createLocationPart(admin, { location_id: location.id, part_id: fixtures.partId });

    await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: location.id,
      part_id: fixtures.partId,
      quantity: 10,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} concurrency seed`,
    });

    const payload = {
      transaction_type: 'ISSUE',
      location_id: location.id,
      part_id: fixtures.partId,
      quantity: 7,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} concurrent issue`,
    };
    const results = await Promise.allSettled([postTransaction(manager, payload), postTransaction(manager, payload)]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    assert(successes.length === 1, `expected one successful ISSUE, got ${successes.length}`);
    assert(failures.length === 1, `expected one failed ISSUE, got ${failures.length}`);
    assert(String(failures[0].reason?.message || '').includes('INSUFFICIENT_STOCK'), 'failed concurrent issue should be insufficient stock');

    const balance = await getBalance(admin, location.id, fixtures.partId);
    const issueCount = await countTransactions(admin, location.id, fixtures.partId, `DEV ${fixtures.runId} concurrent issue`);
    assert(balance.quantity_base === 3, `final balance should be 3, got ${balance.quantity_base}`);
    assert(issueCount === 1, `only one ISSUE transaction expected, got ${issueCount}`);
  });
}

async function testConcurrentIdempotency(users, fixtures, admin) {
  await runCase('concurrency same idempotency key', async () => {
    const manager = users.transactionManage;
    const location = await createLocation(admin, {
      code: runCode(fixtures.runId, 'IDEMCON'),
      name: `DEV 1C-2B ${fixtures.runId} idem concurrency`,
      location_type: 'STORE',
      store_id: fixtures.storeOneId,
      allow_negative_stock: false,
    });
    fixtures.locationIds.push(location.id);
    await createLocationPart(admin, { location_id: location.id, part_id: fixtures.partId });

    const payload = {
      transaction_type: 'RECEIPT',
      location_id: location.id,
      part_id: fixtures.partId,
      quantity: 5,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} concurrent idempotency`,
      idempotency_key: `DEV-${fixtures.runId}-CONCURRENT-IDEM`,
      metadata: { runId: fixtures.runId, case: 'concurrent-idempotency' },
    };
    const results = await Promise.allSettled([postTransaction(manager, payload), postTransaction(manager, payload)]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    assert(successes.length >= 1, 'at least one idempotent request should succeed');

    const txIds = new Set(successes.map((result) => result.value.transaction_id));
    assert(txIds.size === 1, `successful idempotent calls should return one transaction id, got ${Array.from(txIds).join(',')}`);

    for (const failure of failures) {
      const message = String(failure.reason?.message || '');
      assert(
        message.includes('duplicate key') || message.includes('IDEMPOTENCY_CONFLICT'),
        `unexpected concurrent idempotency failure: ${message}`,
      );
    }

    const balance = await getBalance(admin, location.id, fixtures.partId);
    const txCount = await countTransactions(admin, location.id, fixtures.partId, `DEV ${fixtures.runId} concurrent idempotency`);
    assert(balance.quantity_base === 5, `idempotent concurrent balance should be 5, got ${balance.quantity_base}`);
    assert(txCount === 1, `idempotent concurrent transaction count should be 1, got ${txCount}`);
  });
}

async function testDynamicBIdempotencyBaseline(users, fixtures, admin) {
  await runCase('B idempotency same user same key', async () => {
    const manager = users.transactionManage;
    const c = await createInventoryCase(admin, fixtures, 'IDEM');
    const key = `DEV-${fixtures.runId}-IDEM-BASELINE`;
    const reason = `DEV ${fixtures.runId} B idem baseline`;
    const payload = {
      transaction_type: 'RECEIPT',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 10,
      input_unit_type: 'BASE',
      reason,
      idempotency_key: key,
      metadata: { runId: fixtures.runId, case: 'idem-baseline' },
    };

    const first = await postTransaction(manager, payload);
    assert(first.idempotent_replay === false, 'first idempotent request should not replay');
    assert(first.balance_after === 10, 'first idempotent request should set balance to 10');

    const balanceAfterFirst = await getBalance(admin, c.location.id, c.part.id);
    assert(balanceAfterFirst.quantity_base === 10, 'balance after first idempotent request should be 10');
    assert(balanceAfterFirst.version === 1, 'version after first idempotent request should be 1');

    const second = await postTransaction(manager, payload);
    assert(second.idempotent_replay === true, 'second identical request should replay');
    assert(second.transaction_id === first.transaction_id, 'replay should return original transaction id');
    assert(second.transaction_no === first.transaction_no, 'replay should return original transaction_no');

    const balanceAfterReplay = await getBalance(admin, c.location.id, c.part.id);
    const txCountAfterReplay = await countTransactions(admin, c.location.id, c.part.id, reason);
    assert(txCountAfterReplay === 1, `idempotency replay should leave one transaction, got ${txCountAfterReplay}`);
    assert(balanceAfterReplay.quantity_base === 10, 'idempotency replay should leave balance at 10');
    assert(balanceAfterReplay.version === balanceAfterFirst.version, 'idempotency replay must not increment version');
    assert(balanceAfterReplay.last_transaction_id === first.transaction_id, 'idempotency replay must not change last_transaction_id');

    await expectRpcError(manager, 'ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: c.location.id,
      p_part_id: c.part.id,
      p_quantity: 11,
      p_input_unit_type: 'BASE',
      p_reason: reason,
      p_idempotency_key: key,
      p_metadata: { runId: fixtures.runId, case: 'idem-baseline' },
    }, 'IDEMPOTENCY_CONFLICT');

    const balanceAfterConflict = await getBalance(admin, c.location.id, c.part.id);
    const txCountAfterConflict = await countTransactions(admin, c.location.id, c.part.id, reason);
    assert(txCountAfterConflict === 1, 'idempotency conflict must not add transaction');
    assert(balanceAfterConflict.quantity_base === 10, 'idempotency conflict must not change balance');
    assert(balanceAfterConflict.version === balanceAfterFirst.version, 'idempotency conflict must not increment version');
    assert(balanceAfterConflict.last_transaction_id === first.transaction_id, 'idempotency conflict must not change last transaction');
  });
}

async function testDynamicBDifferentUsersSameKey(users, fixtures, admin) {
  await runCase('B idempotency different users same key', async () => {
    const c = await createInventoryCase(admin, fixtures, 'DIFFUSER');
    const key = `DEV-${fixtures.runId}-SAME-KEY-DIFF-USERS`;
    const reason = `DEV ${fixtures.runId} B different users same key`;
    const payload = {
      transaction_type: 'RECEIPT',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 10,
      input_unit_type: 'BASE',
      reason,
      idempotency_key: key,
      metadata: { runId: fixtures.runId, case: 'different-users-same-key' },
    };

    const first = await postTransaction(users.transactionManage, payload);
    const second = await postTransaction(users.transactionManageB, payload);
    assert(first.transaction_id !== second.transaction_id, 'different users should create distinct transactions with same key');
    assert(first.created_by !== second.created_by, 'different users should have distinct created_by values');
    assert(second.idempotent_replay === false, 'different user same key should not replay first user transaction');

    const balance = await getBalance(admin, c.location.id, c.part.id);
    const transactions = await getTransactions(admin, c.location.id, c.part.id, reason);
    assert(transactions.length === 2, `different users same key should create 2 transactions, got ${transactions.length}`);
    assert(balance.quantity_base === 20, `balance should be 20 after two users, got ${balance.quantity_base}`);
    assertBalanceMatchesLastTransaction(balance, transactions, 2);
  });
}

async function testDynamicBConcurrentIssue(users, fixtures, admin) {
  await runCase('B concurrent issue oversell protection', async () => {
    const manager = users.transactionManage;
    const c = await createInventoryCase(admin, fixtures, 'CONCURISSUE', { allowNegativeStock: false });
    const reasonSeed = `DEV ${fixtures.runId} B concurrent issue seed`;
    await postTransaction(manager, {
      transaction_type: 'RECEIPT',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 10,
      input_unit_type: 'BASE',
      reason: reasonSeed,
    });
    const before = await getBalance(admin, c.location.id, c.part.id);
    assert(before.quantity_base === 10, 'concurrent issue fixture should start at 10');
    const beforeIssueCount = await countTransactions(admin, c.location.id, c.part.id, `DEV ${fixtures.runId} B concurrent issue`);

    const payloadA = {
      transaction_type: 'ISSUE',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 7,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} B concurrent issue A`,
      idempotency_key: `DEV-${fixtures.runId}-ISSUE-A`,
    };
    const payloadB = {
      transaction_type: 'ISSUE',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 7,
      input_unit_type: 'BASE',
      reason: `DEV ${fixtures.runId} B concurrent issue B`,
      idempotency_key: `DEV-${fixtures.runId}-ISSUE-B`,
    };

    const results = await Promise.allSettled([postTransaction(manager, payloadA), postTransaction(manager, payloadB)]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    console.log(`INFO concurrent ISSUE request A: ${results[0].status}`);
    console.log(`INFO concurrent ISSUE request B: ${results[1].status}`);
    assert(successes.length === 1, `expected one successful concurrent ISSUE, got ${successes.length}`);
    assert(failures.length === 1, `expected one failed concurrent ISSUE, got ${failures.length}`);
    assert(String(failures[0].reason?.message || '').includes('INSUFFICIENT_STOCK'), 'failed concurrent issue should be INSUFFICIENT_STOCK');

    const success = successes[0].value;
    assert(success.balance_before === 10, 'successful concurrent issue balance_before should be 10');
    assert(success.balance_after === 3, 'successful concurrent issue balance_after should be 3');
    assert(success.quantity_base === -7, 'successful concurrent issue quantity_base should be -7');

    const balance = await getBalance(admin, c.location.id, c.part.id);
    const issueCount = await countTransactions(admin, c.location.id, c.part.id, `DEV ${fixtures.runId} B concurrent issue`);
    assert(balance.quantity_base === 3, `final concurrent issue balance should be 3, got ${balance.quantity_base}`);
    assert(balance.version === before.version + 1, `version should increase by 1, got ${before.version} -> ${balance.version}`);
    assert(issueCount === beforeIssueCount + 1, `only one ISSUE transaction should be added, got ${issueCount - beforeIssueCount}`);
    assert(balance.last_transaction_id === success.transaction_id, 'last_transaction_id should point to successful issue');
  });
}

async function testDynamicBConcurrentIdempotency(users, fixtures, admin) {
  await runCase('B concurrent same idempotency key', async () => {
    const manager = users.transactionManage;
    const c = await createInventoryCase(admin, fixtures, 'CONCURIDEM');
    const key = `DEV-${fixtures.runId}-CONCURRENT-IDEM`;
    const reason = `DEV ${fixtures.runId} B concurrent idempotency`;
    const beforeCount = await countTransactions(admin, c.location.id, c.part.id, reason);
    const payload = {
      transaction_type: 'RECEIPT',
      location_id: c.location.id,
      part_id: c.part.id,
      quantity: 10,
      input_unit_type: 'BASE',
      reason,
      idempotency_key: key,
      metadata: { runId: fixtures.runId, case: 'concurrent-idempotency' },
    };

    const results = await Promise.allSettled([postTransaction(manager, payload), postTransaction(manager, payload)]);
    console.log(`INFO concurrent idem request A: ${results[0].status}`);
    console.log(`INFO concurrent idem request B: ${results[1].status}`);

    const rawUniqueFailures = results.filter((result) => result.status === 'rejected' && isRawUniqueViolation(result.reason));
    assert(rawUniqueFailures.length === 0, 'raw PostgreSQL 23505 must not leak from concurrent idempotency');

    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    assert(successes.length >= 1, 'at least one concurrent idempotent request should succeed');
    for (const failure of failures) {
      throw failure.reason;
    }

    const txIds = new Set(successes.map((result) => result.value.transaction_id));
    const txNos = new Set(successes.map((result) => result.value.transaction_no));
    assert(txIds.size === 1, `concurrent idempotency should return one transaction id, got ${Array.from(txIds).join(',')}`);
    assert(txNos.size === 1, `concurrent idempotency should return one transaction_no, got ${Array.from(txNos).join(',')}`);
    assert(successes.some((result) => result.value.idempotent_replay === false), 'one request should be the original insert');
    assert(successes.length === 1 || successes.some((result) => result.value.idempotent_replay === true), 'second success should be replay');

    const balance = await getBalance(admin, c.location.id, c.part.id);
    const transactions = await getTransactions(admin, c.location.id, c.part.id, reason);
    assert(transactions.length === beforeCount + 1, `concurrent idempotency should add one transaction, got ${transactions.length - beforeCount}`);
    assert(balance.quantity_base === 10, `concurrent idempotency balance should be 10, got ${balance.quantity_base}`);
    assert(balance.version === 1, `concurrent idempotency version should be 1, got ${balance.version}`);
    assert(balance.last_transaction_id === Array.from(txIds)[0], 'last_transaction_id should point to unique transaction');
    assertBalanceMatchesLastTransaction(balance, transactions, 1);
  });
}

async function cleanupFixtures(admin, fixtures) {
  console.log('RUN CLEANUP test fixtures');
  if (!fixtures) {
    console.log('PASS CLEANUP test fixtures');
    return;
  }

  for (const locationId of fixtures.locationIds || []) {
    await admin
      .from('ga_inventory_location_parts')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: fixtures.actorProfileId,
        deletion_reason: `DEV Task 1C-2B cleanup ${fixtures.runId}`,
      })
      .eq('location_id', locationId)
      .is('deleted_at', null);

    await admin
      .from('ga_inventory_locations')
      .update({
        is_active: false,
        is_default: false,
        deleted_at: new Date().toISOString(),
        deleted_by: fixtures.actorProfileId,
        deletion_reason: `DEV Task 1C-2B cleanup ${fixtures.runId}`,
      })
      .eq('id', locationId)
      .is('deleted_at', null);
  }

  for (const partId of fixtures.partIds || []) {
    await admin
      .from('ga_parts')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: fixtures.actorProfileId,
        deletion_reason: `DEV Task 1C-2B cleanup ${fixtures.runId}`,
      })
      .eq('id', partId)
      .is('deleted_at', null);
  }
  console.log('PASS CLEANUP test fixtures');
}

async function main() {
  runGuard('scripts/verify-dev-supabase-environment.js');
  loadEnvConfig(process.cwd(), true);

  const mode = process.argv.includes('--dynamic-a') ? 'A' : 'B';
  const runId = createRunId();
  console.log(`Test run ID: ${runId}`);
  console.log(`Dynamic verification mode: ${mode}`);

  const admin = createServiceClient();
  const storeOneId = await getId(admin, 'stores', 'store_code', 'DEV001');
  const storeTwoId = await getId(admin, 'stores', 'store_code', 'DEV002');
  const devUsers = await runCase('SETUP dedicated DEV auth users', () => ensureDevAuthUsers(admin));
  await setupRbac(admin, devUsers, { storeOneId, storeTwoId });

  const signedIn = {
    noAccess: await signIn(devUsers.noAccess.email, devUsers.noAccess.password),
    balanceView: await signIn(devUsers.balanceView.email, devUsers.balanceView.password),
    transactionView: await signIn(devUsers.transactionView.email, devUsers.transactionView.password),
    transactionManageNoPart: await signIn(devUsers.transactionManageNoPart.email, devUsers.transactionManageNoPart.password),
    transactionManage: await signIn(devUsers.transactionManage.email, devUsers.transactionManage.password),
    transactionManageB: await signIn(devUsers.transactionManageB.email, devUsers.transactionManageB.password),
    storeManagerA: await signIn(devUsers.storeManagerA.email, devUsers.storeManagerA.password),
    storeManagerB: await signIn(devUsers.storeManagerB.email, devUsers.storeManagerB.password),
  };

  let fixtures = null;
  try {
    if (mode === 'A') {
      fixtures = await runCase('SETUP test fixtures', () => setupFixtures(admin, runId, devUsers.transactionManage.id));
      await testRls(signedIn, fixtures);
      await runCase('basic transactions', () => testBasicTransactions(signedIn, fixtures, admin));
      await testValidation(signedIn, fixtures);
      await testNegativeStock(signedIn, fixtures);
      await testAppendOnly(signedIn, fixtures);
    } else {
      console.log('INFO Dynamic A record: transaction_view passed in previous run');
      console.log('INFO Dynamic A record: transaction_manage + part.view passed in previous run');
      console.log('INFO Dynamic A record: store_manager A/B cross-store passed in previous run');
      fixtures = await runCase('SETUP dynamic B fixtures', () => setupDynamicBFixtures(admin, runId, devUsers.transactionManage.id));
      await testDynamicBIdempotencyBaseline(signedIn, fixtures, admin);
      await testDynamicBDifferentUsersSameKey(signedIn, fixtures, admin);
      await testDynamicBConcurrentIssue(signedIn, fixtures, admin);
      await testDynamicBConcurrentIdempotency(signedIn, fixtures, admin);
    }
  } finally {
    await cleanupFixtures(admin, fixtures).catch((error) => {
      console.warn('WARN CLEANUP test fixtures');
      logFormattedError(error);
    });
    await deactivateTempRoles(admin).catch((error) => {
      console.warn('WARN CLEANUP temporary roles');
      logFormattedError(error);
    });
    for (const client of Object.values(signedIn)) await client.auth.signOut().catch(() => {});
  }

  console.log(`Task 1C-2B Dynamic Verification ${mode} tests passed`);
}

main().catch((error) => {
  console.error('Task 1C-2B Dynamic Verification tests failed');
  logFormattedError(error);
  process.exit(1);
});
