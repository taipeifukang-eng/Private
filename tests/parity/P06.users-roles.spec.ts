import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAuthUser, createPlainRole, grantRole, userRoleRows } from '../support/m5-org-fixtures';
import { isBanActive } from '../../lib/workspace/user-management-rules';

// P06 對等層：舊版 REST（/api/admin/reset-password、/api/roles、/api/roles/[id]/users）、舊版 server action 原始碼與新版同輸入、同輸出。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 user (2026-11-08 survey/m5 Qn)；不需決策項目為 assumptions）。
// 資料：m5p-test-* 帳號與 m5p_test_* 角色；只刪自己建立的資料。

const map = loadMap('users-roles');
const rec = new ParityRecorder('users-roles');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string) {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}
let target: { id: string; email: string; password: string };
let plainRole: { id: string; code: string; name: string };
const cls = (status: number) => (status < 300 ? 'allowed' : 'denied');

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['user_viewer', 'user_editor', 'user_admin', 'role_viewer', 'role_assigner']);
  users = s.users;
  teardownUsers = s.teardown;
  plainRole = await createPlainRole('p06parity');
  target = await createAuthUser('p06-par-target', { employeeCode: 'ZTP06PAR' });
  await createPlainRole('p06parity-dev', { name: 'DEV M5P Test parity', code: 'm5p_test_p06paritydev' });
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  expect(await teardownUsers(), '清除帳號與角色').toEqual([]);
});

test('Q14 重置密碼：舊 POST /api/admin/reset-password vs 新 POST /api/workspace/users（reset）的允許與否相同', async () => {
  const e = entry('reset-password-gate');
  for (const role of ['user_viewer', 'user_editor', 'user_admin']) {
    const api = await as(role);
    const l = await api.post('/api/admin/reset-password', { data: { userId: target.id, newPassword: 'M5p-legacy-Pass-1!' } });
    const n = await api.post('/api/workspace/users', { data: { action: 'reset', id: target.id, password: 'M5p-native-Pass-1!' } });
    const diffs: Diff[] = [];
    if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'reset-password', legacy: l.status(), native: n.status() });
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'write-readback',
        role,
        title: `重置密碼（${role}）`,
        legacy: { endpoint: 'POST /api/admin/reset-password', status: l.status() },
        native: { endpoint: 'POST /api/workspace/users reset', status: n.status() },
        compared: { calls: 2 },
        diffs,
      }),
    );
    expect(cls(n.status())).toBe(role === 'user_admin' ? 'allowed' : 'denied');
  }
});

test('Q12 新增使用者：連結目標與舊版相同（/register），沒有管理員直接建立', async () => {
  const e = entry('add-user-entry');
  const legacyHref = /href="(\/register)"/.exec(read('app/admin/users/page.tsx'))?.[1];
  const vue = read('vue-workspace/src/pages/Users.vue');
  const rules = read('lib/workspace/user-management-rules.ts');
  const nativeHref = /REGISTER_PATH = "([^"]+)"/.exec(rules)?.[1];
  const diffs: Diff[] = [];
  if (legacyHref !== nativeHref) diffs.push({ kind: 'changed', key: 'add-user-href', legacy: legacyHref, native: nativeHref });
  if (!vue.includes(':href="REGISTER_PATH"')) diffs.push({ kind: 'changed', key: 'add-user-anchor', legacy: 'a href=/register', native: '不是連結' });
  if (/modal === "create"|confirmPassword/.test(vue)) diffs.push({ kind: 'only-native', key: 'direct-create-form' });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'ui-extract', title: '新增使用者入口', legacy: { endpoint: 'app/admin/users/page.tsx' }, native: { endpoint: 'Users.vue add-user-link' }, compared: { facts: 3 }, diffs }));
});

test('角色清單與 DEV 測試角色開關：舊 /api/roles vs 新 /api/workspace/roles（預設與 includeDevRoles=true）', async () => {
  const e = entry('roles-list');
  const api = await as('role_viewer');
  for (const query of ['', '?includeDevRoles=true']) {
    const l = await (await api.get(`/api/roles${query}`)).json();
    const n = await (await api.get(`/api/workspace/roles${query}`)).json();
    const diffs: Diff[] = [];
    const ls = new Set<string>(l.roles.map((r: any) => r.id));
    const ns = new Set<string>(n.roles.map((r: any) => r.id));
    for (const id of Array.from(ls)) if (!ns.has(id)) diffs.push({ kind: 'only-legacy', key: `role#${id}` });
    for (const id of Array.from(ns)) if (!ls.has(id)) diffs.push({ kind: 'only-native', key: `role#${id}` });
    if (l.meta.hidden_dev_role_count !== n.meta.hidden_dev_role_count) diffs.push({ kind: 'count', key: 'hidden_dev_role_count', legacy: l.meta.hidden_dev_role_count, native: n.meta.hidden_dev_role_count });
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role: `role_viewer${query ? '+dev' : ''}`,
        title: `角色清單${query ? '（顯示 DEV 測試角色）' : ''}`,
        legacy: { endpoint: `GET /api/roles${query}` },
        native: { endpoint: `GET /api/workspace/roles${query}` },
        compared: { roles: ls.size },
        diffs,
      }),
    );
  }
  // 開關：預設藏起來的 DEV 測試角色數量 > 0（本次建立了一個）
  const def = await (await api.get('/api/workspace/roles')).json();
  expect(def.meta.hidden_dev_role_count).toBeGreaterThanOrEqual(1);
});

test('把使用者加進角色／移出：舊 /api/roles/[id]/users vs 新 /api/workspace/roles/[id]/users（允許與否與回讀相同）', async () => {
  const e = entry('roles-assign-user');
  for (const role of ['role_assigner', 'role_viewer', 'user_viewer']) {
    const api = await as(role);
    const diffs: Diff[] = [];
    const attempt = async (base: string) => {
      const res = await api.post(`${base}/${plainRole.id}/users`, { data: { employee_codes: ['ZTP06PAR'] } });
      const rows = (await userRoleRows(target.id, plainRole.id)).length;
      if (rows) await adminDb().from('user_roles').delete().eq('user_id', target.id).eq('role_id', plainRole.id);
      return { status: res.status(), rows };
    };
    const l = await attempt('/api/roles');
    const n = await attempt('/api/workspace/roles');
    if (cls(l.status) !== cls(n.status)) diffs.push({ kind: 'status', key: 'assign', legacy: l.status, native: n.status });
    if (l.rows !== n.rows) diffs.push({ kind: 'count', key: 'assigned-rows', legacy: l.rows, native: n.rows });
    assertNoUnlistedDiffs(
      rec.record({ entry: e.id, mechanism: 'write-readback', role, title: `加進角色（${role}）`, legacy: { endpoint: 'POST /api/roles/[id]/users', status: l.status }, native: { endpoint: 'POST /api/workspace/roles/[id]/users', status: n.status }, compared: { rows: l.rows }, diffs }),
    );
    expect(cls(n.status)).toBe(role === 'role_assigner' ? 'allowed' : 'denied');
  }
  // 移出
  await grantRole(target.id, plainRole.id);
  const api = await as('role_assigner');
  const l = await api.delete(`/api/roles/${plainRole.id}/users/${target.id}`);
  await grantRole(target.id, plainRole.id).catch(() => undefined);
  const n = await api.delete(`/api/workspace/roles/${plainRole.id}/users/${target.id}`);
  expect([cls(l.status()), cls(n.status())]).toEqual(['allowed', 'allowed']);
});

test('變更相容角色的規則：舊 updateUserProfile（原始碼）與新 PATCH /api/workspace/users 逐項相同', async () => {
  const e = entry('compat-role-rules');
  const legacy = read('app/auth/actions.ts');
  const native = read('app/api/workspace/users/route.ts');
  const facts: Array<[string, boolean, boolean]> = [
    ['需要 user.user.change_role', legacy.includes("'user.user.change_role'"), native.includes('"user.user.change_role"')],
    ['角色只能是 admin／manager／member', legacy.includes("['admin', 'manager', 'member'].includes(updates.role)"), native.includes('["admin", "manager", "member"].includes(body.role)')],
    ['不能改自己的相容角色', legacy.includes('不能修改目前登入使用者的相容角色'), native.includes('不能修改目前登入使用者的相容角色')],
  ];
  const diffs: Diff[] = facts.filter((f) => f[1] !== f[2]).map((f) => ({ kind: 'changed', key: `rule#${f[0]}`, legacy: f[1], native: f[2] }));
  // 行為：新版對自己、對他人、無權限
  const editor = await as('user_editor');
  const self = await editor.patch('/api/workspace/users', { data: { action: 'role', id: users.user_editor.id, role: 'manager' } });
  const bad = await editor.patch('/api/workspace/users', { data: { action: 'role', id: target.id, role: 'root' } });
  const none = await (await as('user_viewer')).patch('/api/workspace/users', { data: { action: 'role', id: target.id, role: 'manager' } });
  if (self.status() !== 400) diffs.push({ kind: 'status', key: 'self-change', legacy: 400, native: self.status() });
  if (bad.status() !== 400) diffs.push({ kind: 'status', key: 'invalid-role', legacy: 400, native: bad.status() });
  if (none.status() !== 403) diffs.push({ kind: 'status', key: 'no-permission', legacy: 403, native: none.status() });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', role: 'user_editor', title: '變更相容角色規則', legacy: { endpoint: 'app/auth/actions.ts updateUserProfile' }, native: { endpoint: 'PATCH /api/workspace/users' }, compared: { rules: 6 }, diffs }));
});

test('帳號停用判定：舊版 Boolean(banned_until) vs 新版封鎖時間未到期才算（已過期的封鎖舊版仍算停用）', async () => {
  const e = entry('ban-state');
  expect(read('app/auth/actions.ts')).toContain('is_disabled: Boolean(authUser.banned_until)');
  const now = Date.parse('2026-11-09T00:00:00Z');
  const cases: Array<[string, string | null]> = [['沒有封鎖', null], ['封鎖到明天', '2026-11-10T00:00:00Z'], ['封鎖已過期', '2026-11-01T00:00:00Z']];
  const diffs: Diff[] = [];
  for (const [label, until] of cases) {
    const l = Boolean(until);
    const n = isBanActive(until, now);
    if (l !== n) diffs.push({ kind: 'changed', key: `ban#${label}`, legacy: l, native: n });
  }
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'ui-extract', title: '帳號停用判定', legacy: { endpoint: 'getAllUsers is_disabled' }, native: { endpoint: 'isBanActive' }, compared: { cases: 3 }, diffs }));
  expect(diffs).toHaveLength(1);
});

test('Q15 待開通與 Q13 授予管理員確認：新版新增的畫面元素（舊版沒有）', async () => {
  const legacyUsers = read('components/admin/UserManagementTable.tsx') + read('app/admin/users/page.tsx');
  const vueUsers = read('vue-workspace/src/pages/Users.vue');
  const vueRoles = read('vue-workspace/src/pages/Roles.vue');
  expect(legacyUsers).not.toContain('待開通');
  expect(vueUsers).toContain('pending-tag');
  assertNoUnlistedDiffs(
    rec.record({ entry: entry('pending-activation').id, mechanism: 'ui-extract', title: '待開通標籤與篩選', legacy: { endpoint: '舊版使用者管理（無）' }, native: { endpoint: 'pending-tag／pending-filter' }, compared: { elements: 2 }, diffs: [{ kind: 'only-native', key: 'pending-tag' }, { kind: 'only-native', key: 'pending-filter' }] }),
  );
  expect(legacyUsers).not.toMatch(/完整管理權限/);
  expect(vueUsers).toContain('admin-grant-warning');
  expect(vueRoles).toContain('admin-grant-warning');
  assertNoUnlistedDiffs(
    rec.record({ entry: entry('admin-grant-confirm').id, mechanism: 'ui-extract', title: '授予管理員前確認', legacy: { endpoint: '舊版（無確認）' }, native: { endpoint: 'admin-grant-warning（使用者管理、角色管理）' }, compared: { elements: 2 }, diffs: [{ kind: 'only-native', key: 'admin-grant-warning#users' }, { kind: 'only-native', key: 'admin-grant-warning#roles' }] }),
  );
});

test('DEV 測試角色開關：新版文字與舊版相同', async () => {
  const e = entry('dev-role-toggle');
  const legacy = read('app/admin/roles/RoleListClient.tsx');
  const vue = read('vue-workspace/src/pages/Roles.vue');
  const diffs: Diff[] = [];
  for (const [label, legacyNeedle, vueNeedle] of [
    ['開關文字', '顯示 DEV 測試角色', '顯示 DEV 測試角色'],
    ['隱藏提示', '已隱藏 {hiddenDevRoleCount} 個 DEV 測試角色', '已隱藏 {{ hidden }} 個 DEV 測試角色'],
    ['列上標籤', 'DEV測試', 'DEV測試'],
    ['查詢參數', "params.set('includeDevRoles', 'true')", 'includeDevRoles=${includeDev.value}'],
  ] as const) {
    if (!legacy.includes(legacyNeedle) || !vue.includes(vueNeedle)) diffs.push({ kind: 'changed', key: `dev-toggle#${label}` });
  }
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'ui-extract', title: 'DEV 測試角色開關', legacy: { endpoint: 'RoleListClient.tsx' }, native: { endpoint: 'Roles.vue' }, compared: { texts: 4 }, diffs }));
});
