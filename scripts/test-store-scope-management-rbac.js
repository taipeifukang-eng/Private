#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCase(name, fn) {
  console.log(`RUN ${name}`);
  fn();
  console.log(`PASS ${name}`);
}

const helper = read('lib/admin/store-management-access.ts');
const supervisorRoutes = [
  'app/api/supervisors/users/route.ts',
  'app/api/supervisors/stores/route.ts',
  'app/api/supervisors/assignments/route.ts',
  'app/api/supervisors/assign/route.ts',
];
const storeManagerRoutes = [
  'app/api/store-managers/users/route.ts',
  'app/api/store-managers/stores/route.ts',
  'app/api/store-managers/assignments/route.ts',
  'app/api/store-managers/assign/route.ts',
];
const storeActions = read('app/store/actions.ts');

runCase('store scope access helper uses RBAC permission codes', () => {
  assert(helper.includes("'store.manager.assign'"), 'missing store.manager.assign');
  assert(helper.includes("'store.supervisor.assign'"), 'missing store.supervisor.assign');
  assert(helper.includes("'store.manage'"), 'missing store.manage compatibility permission');
  assert(helper.includes('hasAnyPermission'), 'helper must use RBAC permission helper');
});

runCase('supervisor APIs no longer require legacy profile admin only', () => {
  for (const route of supervisorRoutes) {
    const source = read(route);
    assert(
      source.includes('@/lib/admin/store-management-access'),
      `${route} must use shared store scope access helper`,
    );
    assert(
      source.includes('requireAuthenticatedUser'),
      `${route} must require login`,
    );
    assert(
      !source.includes("profile?.role !== 'admin'"),
      `${route} must not gate solely on profiles.role admin`,
    );
    assert(
      !source.includes(".select('role')"),
      `${route} must not perform legacy role-only profile lookup`,
    );
  }
});

runCase('supervisor assign differentiates supervisor and store manager permission', () => {
  const source = read('app/api/supervisors/assign/route.ts');
  assert(
    source.includes('STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES'),
    'supervisor assign route must check supervisor assignment permission',
  );
  assert(
    source.includes('STORE_MANAGER_ASSIGN_PERMISSION_CODES'),
    'supervisor assign route must check store manager assignment permission for store_manager mode',
  );
  assert(
    source.includes("roleType === 'store_manager'"),
    'supervisor assign route must branch permission by requested roleType',
  );
});

runCase('store manager APIs require authenticated RBAC permission', () => {
  for (const route of storeManagerRoutes) {
    const source = read(route);
    assert(
      source.includes('@/lib/admin/store-management-access'),
      `${route} must use shared store scope access helper`,
    );
    assert(
      source.includes('requireAuthenticatedUser'),
      `${route} must require login`,
    );
    assert(
      source.includes('STORE_MANAGER_ASSIGN_PERMISSION_CODES'),
      `${route} must require store manager assignment permission`,
    );
  }
});

runCase('supervisor management UI no longer tells users profile role alone is enough', () => {
  const source = read('app/admin/supervisors/page.tsx');
  assert(
    !source.includes('將使用者設定為「主管」角色'),
    'UI must not imply profiles.role manager alone grants supervisor management',
  );
  assert(
    source.includes('角色權限管理授予門市/督導指派權限'),
    'UI should mention RBAC assignment permissions',
  );
});

runCase('debug console noise removed from supervisor management page', () => {
  const source = read('app/admin/supervisors/page.tsx');
  assert(!source.includes('[DEBUG'), 'debug console logs should not remain');
});

runCase('store management page uses RBAC permissions instead of legacy role heuristics', () => {
  const source = read('app/admin/stores/page.tsx');
  assert(source.includes('hasAnyPermission'), 'store management page must use RBAC permission helper');
  assert(source.includes("'store.store.view'"), 'store management page must check store.store.view');
  assert(source.includes("'store.store.create'"), 'store management page must check store.store.create');
  assert(source.includes("'store.store.edit'"), 'store management page must check store.store.edit');
  assert(source.includes("'store.store.clone'"), 'store management page must check store.store.clone');
  assert(source.includes("'store.manage'"), 'store management page must support store.manage');
  assert(!source.includes('isBusinessSupervisor'), 'store management page must not use business supervisor profile heuristic');
  assert(!source.includes("profile?.role === 'admin'"), 'store management page must not show actions by profile admin only');
});

runCase('store edit page uses server actions for read and update', () => {
  const source = read('app/admin/stores/[id]/edit/page.tsx');
  assert(source.includes('getStoreForAdminEdit'), 'store edit page must load through server action');
  assert(source.includes('updateStore'), 'store edit page must save through server action');
  assert(!source.includes(".from('stores')"), 'store edit page must not access stores table directly from client');
  assert(!source.includes('.update({'), 'store edit page must not client-update stores directly');
});

runCase('store server actions include create edit view RBAC guards', () => {
  assert(storeActions.includes('STORE_CREATE_PERMISSION_CODES'), 'missing store create permission constants');
  assert(storeActions.includes('STORE_EDIT_PERMISSION_CODES'), 'missing store edit permission constants');
  assert(storeActions.includes('STORE_VIEW_PERMISSION_CODES'), 'missing store view permission constants');
  assert(storeActions.includes('createAdminClient'), 'store server actions must import createAdminClient');
  assert(storeActions.includes('export async function getStoreForAdminEdit'), 'missing admin store read action');
  assert(storeActions.includes('export async function updateStore'), 'missing updateStore action');
  assert(storeActions.includes("'store.store.create'"), 'create action must check store.store.create');
  assert(storeActions.includes("'store.store.edit'"), 'update action must check store.store.edit');
  assert(storeActions.includes("'store.manage'"), 'store actions must support store.manage');
  assert(
    /export async function createStore[\s\S]*?hasAnyPermission\(user\.id, STORE_CREATE_PERMISSION_CODES\)[\s\S]*?const adminSupabase = createAdminClient\(\)[\s\S]*?adminSupabase\s*\n\s*\.from\('stores'\)\s*\n\s*\.insert\(/.test(storeActions),
    'createStore must write stores through admin client after RBAC guard',
  );
  assert(
    /export async function updateStore[\s\S]*?hasAnyPermission\(user\.id, STORE_EDIT_PERMISSION_CODES\)[\s\S]*?const adminSupabase = createAdminClient\(\)[\s\S]*?adminSupabase\s*\n\s*\.from\('stores'\)\s*\n\s*\.update\(/.test(storeActions),
    'updateStore must update stores through admin client after RBAC guard',
  );
});

console.log('Store scope management RBAC static tests passed');
