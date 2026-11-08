import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import {
  activeManagerIds,
  activeMemberIds,
  addMember,
  cleanupM5Org,
  createAuthUser,
  orgCatalog,
  orgCode,
  orgName,
  orgPost,
  profileDepartment,
  seedOrgTree,
  seedWork,
  unitRow,
  type OrgTree,
} from '../support/m5-org-fixtures';
import { ASSIGNMENT_TYPES, buildChart, chartCounts, personResponsibilities } from '../../lib/workspace/organization-rules';

// W21 對等層：舊版（頁面條件、/api/organization/units、/api/department-workspace/work-items、舊畫面原始碼）與新版同輸入、同輸出。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 user (2026-11-08 survey/m5 Qn)；不需決策項目為 assumptions）。
// 資料：本次建立、代碼 M5W21-<RUNID> 的組織單位（成對的「舊版組」與「新版組」）與 m5p-test-* 帳號；只刪自己建立的資料。

const map = loadMap('org-departments');
const rec = new ParityRecorder('org-departments');
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
let tree: OrgTree;
let p1: { id: string; email: string };
let p2: { id: string; email: string };
let p3: { id: string; email: string };
let p4: { id: string; email: string };
const KEYS = ['org_view', 'org_member_view', 'org_manager_view', 'dept_view', 'dept_ws_view', 'dept_ws_manage', 'dept_member_manage', 'org_full'];
/** 新版組／舊版組的成對單位（同樣的設定）。 */
const pair: Record<string, { legacy: string; native: string }> = {};
const unitCols = (tag: string, parent: string, status: string, type = 'department') => ({ code: orgCode(tag), name: orgName(tag), short_name: tag, type, parent_id: parent, status, sort_order: 5 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  await cleanupM5Org(Object.values(users).map((u) => u.id));
  tree = await seedOrgTree();
  p1 = await createAuthUser('w21-par-p1');
  p2 = await createAuthUser('w21-par-p2');
  p3 = await createAuthUser('w21-par-p3');
  p4 = await createAuthUser('w21-par-p4');
  await addMember(tree.deptA, p1.id);
  await seedWork(tree, { u1: p1.id, u2: p2.id });
  // 成對單位：舊版組（L）與新版組（N）。停用部門、啟用部門各一對。
  const db = adminDb();
  for (const [key, status] of [['off', 'inactive'], ['on', 'active'], ['mv', 'active']] as const) {
    const ids: Record<string, string> = {};
    for (const side of ['L', 'N']) {
      const row = await db.from('organization_units').insert(unitCols(`${key.toUpperCase()}${side}`, tree.hq, status)).select('id').single();
      if (row.error) throw new Error(row.error.message);
      ids[side] = row.data.id;
    }
    pair[key] = { legacy: ids.L, native: ids.N };
  }
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  expect(await cleanupM5Org(Object.values(users).map((u) => u.id)), '殘留單位').toBe(0);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const cls = (status: number) => (status < 300 ? 'allowed' : 'denied');

// 舊版頁面：Next server component，沒有權限時 redirect('/dashboard')（307），有權限時 200。
async function legacyPageAllowed(api: APIRequestContext) {
  const res = await api.get('/admin/departments', { maxRedirects: 0 });
  return { status: res.status(), allowed: res.status() === 200 };
}

test('Q9 部門管理進入條件：舊頁（200／導回）vs 新版 session 能力與選單入口', async () => {
  const e = entry('department-page-gate');
  for (const role of KEYS) {
    const api = await as(role);
    const legacy = await legacyPageAllowed(api);
    const session = await (await api.get('/api/workspace/session')).json();
    const labels: string[] = session.navigation.flatMap((g: any) => g.items.map((i: any) => i.label));
    const native = { capability: !!session.capabilities.departments, menu: labels.includes('部門管理') };
    const diffs: Diff[] = [];
    if (legacy.allowed !== native.capability) diffs.push({ kind: 'status', key: 'capability', legacy: legacy.allowed, native: native.capability, detail: `舊頁 HTTP ${legacy.status}` });
    if (legacy.allowed !== native.menu) diffs.push({ kind: 'status', key: 'menu', legacy: legacy.allowed, native: native.menu });
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'navigation',
        role,
        title: `部門管理進入條件（${role}）`,
        legacy: { endpoint: 'GET /admin/departments', status: legacy.status },
        native: { endpoint: 'GET /api/workspace/session', status: 200 },
        compared: { gate: 2 },
        diffs,
      }),
    );
  }
});

test('Q9 部門職掌資料：舊 /api/department-workspace/work-items vs 新 /api/workspace/department-work（只有組織／成員／主管檢視者舊 API 仍回資料）', async () => {
  const e = entry('department-api-gate');
  for (const role of KEYS) {
    const api = await as(role);
    const l = await api.get(`/api/department-workspace/work-items?department_id=${tree.deptA}`);
    const n = await api.get(`/api/workspace/department-work?department=${tree.deptA}`);
    const ids = async (r: typeof l) => new Set<string>(r.ok() ? ((await r.json()).items as any[]).map((i) => i.id) : []);
    const [ls, ns] = [await ids(l), await ids(n)];
    const diffs: Diff[] = [];
    if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'department-api-gate', legacy: cls(l.status()), native: cls(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` });
    // 兩邊都放行時，啟用中的職掌集合必須相同（新版另含停用職掌，這裡只比舊版會回的啟用職掌）
    if (l.ok() && n.ok()) {
      const activeNative = new Set<string>(((await n.json()).items as any[]).filter((i) => i.status === 'active').map((i) => i.id));
      for (const id of Array.from(ls)) if (!activeNative.has(id)) diffs.push({ kind: 'only-legacy', key: `item#${id}` });
      for (const id of Array.from(activeNative)) if (!ls.has(id)) diffs.push({ kind: 'only-native', key: `item#${id}` });
    }
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `部門職掌資料可讀性（${role}）`,
        legacy: { endpoint: 'GET /api/department-workspace/work-items', status: l.status() },
        native: { endpoint: 'GET /api/workspace/department-work', status: n.status() },
        compared: { items: ls.size, nativeItems: ns.size },
        diffs,
      }),
    );
  }
});

test('公司組織資料：舊 /api/organization/units?showInactive=true vs 新 /api/workspace/organization（本次建立的單位、成員、主管）', async () => {
  const e = entry('organization-units-read');
  await addMember(pair.on.legacy, p2.id);
  for (const role of ['org_view', 'org_full']) {
    const api = await as(role);
    const l = await api.get('/api/organization/units?showInactive=true');
    const n = await api.get('/api/workspace/organization');
    const mine = (rows: any[]) =>
      rows
        .filter((u) => String(u.code).startsWith('M5W21-'))
        .map((u) => ({
          id: u.id, code: u.code, name: u.name, type: u.type, status: u.status, parent_id: u.parent_id, sort_order: u.sort_order,
          members: (u.members || []).map((m: any) => m.user_id).sort(),
          managers: (u.managers || []).map((m: any) => `${m.user_id}:${m.manager_role}:${m.is_primary}`).sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const ls = mine(l.ok() ? (await l.json()).units : []);
    const ns = mine(n.ok() ? (await n.json()).units : []);
    const diffs: Diff[] = [];
    if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'status', legacy: l.status(), native: n.status() });
    const byId = new Map(ns.map((u) => [u.id, u]));
    for (const u of ls) {
      const other = byId.get(u.id);
      if (!other) diffs.push({ kind: 'only-legacy', key: `unit#${u.code}` });
      else if (JSON.stringify(u) !== JSON.stringify(other)) diffs.push({ kind: 'changed', key: `unit#${u.code}`, legacy: u, native: other });
    }
    for (const u of ns) if (!ls.some((x) => x.id === u.id)) diffs.push({ kind: 'only-native', key: `unit#${u.code}` });
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `公司組織資料（${role}）`,
        legacy: { endpoint: 'GET /api/organization/units', status: l.status() },
        native: { endpoint: 'GET /api/workspace/organization', status: n.status() },
        compared: { units: ls.length },
        diffs,
      }),
    );
    expect(ls.length).toBeGreaterThanOrEqual(8);
  }
  await adminDb().from('organization_memberships').delete().eq('organization_unit_id', pair.on.legacy).eq('user_id', p2.id);
});

test('人員職掌統計：舊版算法（逐字移植）vs 新版 personResponsibilities，同一份資料', async () => {
  const e = entry('person-stats');
  const api = await as('org_full');
  const legacy = (await (await api.get(`/api/department-workspace/work-items?department_id=${tree.deptA}`)).json()).items as any[];
  const nativeItems = (await (await api.get(`/api/workspace/department-work?department=${tree.deptA}`)).json()).items as any[];
  const diffs: Diff[] = [];
  let compared = 0;
  for (const id of [p1.id, p2.id, p3.id]) {
    const stats = personResponsibilities(nativeItems, id);
    for (const type of ASSIGNMENT_TYPES) {
      const l = legacy.filter((item) => item.assignments.some((a: any) => a.user_id === id && a.assignment_type === type && a.status === 'active' && !a.effective_to)).map((i) => i.id).sort();
      const n = stats[type].map((i: any) => i.id).sort();
      compared += 1;
      if (JSON.stringify(l) !== JSON.stringify(n)) diffs.push({ kind: 'changed', key: `stats#${id}#${type}`, legacy: l, native: n });
    }
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'api-read', role: 'org_full', title: '人員職掌統計', legacy: { endpoint: '舊版 PersonResponsibilityDrawer 算法' }, native: { endpoint: 'personResponsibilities' }, compared: { cells: compared }, diffs }),
  );
  expect(compared).toBe(9);
});

async function legacyPatch(api: APIRequestContext, body: Record<string, unknown>) {
  return api.patch('/api/organization/units', { data: body });
}
const unitBody = (u: any, over: Record<string, unknown> = {}) => ({ action: 'update_unit', id: u.id, name: u.name, short_name: u.short_name ?? '', parent_id: u.parent_id, status: u.status, description: u.description ?? '', sort_order: u.sort_order, ...over });
const nativeBody = (u: any, over: Record<string, unknown> = {}) => ({ id: u.id, code: u.code, name: u.name, short_name: u.short_name ?? '', description: u.description ?? '', parent_id: u.parent_id, status: u.status, sort_order: u.sort_order, ...over });
const managerView = async (id: string) => {
  const rows = ((await adminDb().from('organization_manager_assignments').select('user_id,manager_role,is_primary').eq('organization_unit_id', id).eq('status', 'active').is('effective_to', null)).data || []) as any[];
  return rows.map((r) => `${r.user_id}:${r.manager_role}:${r.is_primary}`).sort();
};

test('Q10 停用部門調整成員與主管：舊版 PATCH 與新版 POST 回讀相同（加入、設主管、移出）', async () => {
  const e = entry('inactive-member-write');
  const api = await as('org_full');
  const { legacy: L, native: N } = pair.off;
  expect((await unitRow(L)).status).toBe('inactive');
  expect((await unitRow(N)).status).toBe('inactive');
  const diffs: Diff[] = [];
  // 一個人只能有一個主要部門，所以舊版組用 p3、新版組用 p4，比對時都換成 'person'
  const snap = async (id: string) => ({ members: (await activeMemberIds(id)).map((x) => (x === p3.id || x === p4.id ? 'person' : x)), managers: (await managerView(id)).map((x) => x.replace(p3.id, 'person').replace(p4.id, 'person')) });
  const compare = async (step: string) => {
    const [a, b] = [await snap(L), await snap(N)];
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ kind: 'changed', key: `inactive-write#${step}`, legacy: a, native: b });
  };
  // 加入成員與主管
  let l = await legacyPatch(api, { action: 'set_members', organization_unit_id: L, user_ids: [p3.id] });
  let n = await orgPost(api, 'members', { id: N, user_ids: [p4.id] });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'inactive-write#add-members', legacy: l.status(), native: n.status(), detail: `舊版 ${l.status()} ${(await l.text()).slice(0, 120)}／新版 ${n.status()} ${(await n.text()).slice(0, 120)}` });
  l = await legacyPatch(api, { action: 'set_managers', organization_unit_id: L, assignments: [{ user_id: p3.id, manager_role: 'deputy_manager', is_primary: true }] });
  n = await orgPost(api, 'managers', { id: N, assignments: [{ user_id: p4.id, manager_role: 'deputy_manager', is_primary: true }] });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'inactive-write#set-managers', legacy: l.status(), native: n.status() });
  await compare('after-add');
  // 移出
  l = await legacyPatch(api, { action: 'set_members', organization_unit_id: L, user_ids: [] });
  n = await orgPost(api, 'members', { id: N, user_ids: [] });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'inactive-write#remove-members', legacy: l.status(), native: n.status() });
  l = await legacyPatch(api, { action: 'set_managers', organization_unit_id: L, assignments: [] });
  n = await orgPost(api, 'managers', { id: N, assignments: [] });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'inactive-write#remove-managers', legacy: l.status(), native: n.status() });
  await compare('after-remove');
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', role: 'org_full', title: '停用部門成員與主管寫入', legacy: { endpoint: 'PATCH /api/organization/units' }, native: { endpoint: 'POST /api/workspace/organization' }, compared: { steps: 4 }, diffs }),
  );
});

test('Q11 部門改名／停用／啟用／成員異動：人員資料的部門文字，舊版與新版回讀相同', async () => {
  const e = entry('unit-rename-profile-sync');
  const api = await as('org_full');
  const { legacy: L, native: N } = pair.on;
  // p2 進舊版組、p4 進新版組（p1 留在部門 A，供「已在其他部門」案例使用）
  const [left, right] = [p2.id, p4.id];
  await addMember(L, left);
  await addMember(N, right);
  const diffs: Diff[] = [];
  const sameText = async (step: string, expectNative?: string) => {
    const [a, b] = [await profileDepartment(left), await profileDepartment(right)];
    // 文字內含單位名稱（兩邊名稱不同）：以「是否等於當時名稱／舊名稱／空白」分類後比較
    const norm = (value: string | null, current: string, old: string) => (value === null ? 'null' : value === current ? 'current' : value === old ? 'old' : value);
    const [lu, nu] = [await unitRow(L), await unitRow(N)];
    const la = norm(a, lu.name, orgName('ONL'));
    const na = norm(b, nu.name, orgName('ONN'));
    if (la !== na) diffs.push({ kind: 'changed', key: `profile-department#${step}`, legacy: la, native: na });
    return { la, na, expectNative };
  };
  await sameText('seed');
  // 改名
  const renamed = { L: orgName('ONL-renamed'), N: orgName('ONN-renamed') };
  let l = await legacyPatch(api, unitBody(await unitRow(L), { name: renamed.L }));
  let n = await orgPost(api, 'update', nativeBody(await unitRow(N), { name: renamed.N }));
  expect([l.status(), n.status()]).toEqual([200, 200]);
  const afterRename = await sameText('rename');
  expect(afterRename.la, '改名不動').toBe('old');
  // 停用
  l = await legacyPatch(api, unitBody(await unitRow(L), { status: 'inactive' }));
  n = await orgPost(api, 'update', nativeBody(await unitRow(N), { status: 'inactive' }));
  expect([l.status(), n.status()]).toEqual([200, 200]);
  await sameText('inactive');
  // 啟用
  l = await legacyPatch(api, unitBody(await unitRow(L), { status: 'active' }));
  n = await orgPost(api, 'update', nativeBody(await unitRow(N), { status: 'active' }));
  expect([l.status(), n.status()]).toEqual([200, 200]);
  await sameText('active');
  // 成員異動：移出 → 空白；再加入 → 目前名稱
  l = await legacyPatch(api, { action: 'set_members', organization_unit_id: L, user_ids: [] });
  n = await orgPost(api, 'members', { id: N, user_ids: [] });
  expect([l.status(), n.status()]).toEqual([200, 200]);
  expect((await sameText('member-removed')).la).toBe('null');
  l = await legacyPatch(api, { action: 'set_members', organization_unit_id: L, user_ids: [left] });
  n = await orgPost(api, 'members', { id: N, user_ids: [right] });
  expect([l.status(), n.status()]).toEqual([200, 200]);
  expect((await sameText('member-added')).la).toBe('current');
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', role: 'org_full', title: '人員資料部門文字同步', legacy: { endpoint: 'PATCH /api/organization/units' }, native: { endpoint: 'POST /api/workspace/organization' }, compared: { steps: 6 }, diffs }),
  );
});

test('層級調整到停用單位底下：舊版照寫、新版擋下（Q10 其餘照新版）', async () => {
  const e = entry('hierarchy-guard');
  const api = await as('org_full');
  const diffs: Diff[] = [];
  const mk = async (tag: string) => (await adminDb().from('organization_units').insert(unitCols(tag, tree.hq, 'active', 'team')).select('id').single()).data.id as string;
  const [tl, tn] = [await mk('MVTL'), await mk('MVTN')];
  const l = await legacyPatch(api, { action: 'move_unit', id: tl, parent_id: pair.off.legacy, sort_order: 1 });
  const n = await orgPost(api, 'hierarchy', { updates: [{ id: tn, parent_id: pair.off.native, sort_order: 1 }] });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'move-under-inactive', legacy: cls(l.status()), native: cls(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` });
  expect(n.status()).toBe(400);
  expect((await unitRow(tn)).parent_id).toBe(tree.hq);
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', role: 'org_full', title: '移到停用單位底下', legacy: { endpoint: 'PATCH move_unit' }, native: { endpoint: 'POST hierarchy' }, compared: { cases: 1 }, diffs }),
  );
  expect(diffs.length, '舊版允許、新版擋下').toBe(1);
});

test('組織儲存衝突：舊版後存蓋前存，新版用過期版本回 409', async () => {
  const e = entry('save-conflict-guard');
  const api = await as('org_full');
  const diffs: Diff[] = [];
  const stale = (await orgCatalog(api)).body.version as string;
  // 另一個操作先改過（讓 stale 過期）
  expect((await orgPost(api, 'update', nativeBody(await unitRow(pair.mv.native), { description: 'first' }))).status()).toBe(200);
  expect((await legacyPatch(api, unitBody(await unitRow(pair.mv.legacy), { description: 'first' }))).status()).toBe(200);
  const l = await legacyPatch(api, unitBody(await unitRow(pair.mv.legacy), { description: 'second' }));
  const n = await api.post('/api/workspace/organization', { data: { operation: 'update', data: nativeBody(await unitRow(pair.mv.native), { description: 'second' }), requestId: randomUUID(), expected: stale } });
  if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: 'stale-save', legacy: cls(l.status()), native: cls(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` });
  expect(n.status()).toBe(409);
  expect((await unitRow(pair.mv.native)).description).toBe('first');
  expect((await unitRow(pair.mv.legacy)).description).toBe('second');
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', role: 'org_full', title: '過期版本儲存', legacy: { endpoint: 'PATCH update_unit' }, native: { endpoint: 'POST update（expected 過期）' }, compared: { cases: 1 }, diffs }),
  );
});

test('成員已在其他部門：舊版資料庫錯誤（500），新版 409 並說明原因，資料不變', async () => {
  const e = entry('primary-conflict');
  const api = await as('org_full');
  const diffs: Diff[] = [];
  const { legacy: L, native: N } = pair.mv;
  // p1 目前是 deptA 的主要成員（種子）
  const l = await legacyPatch(api, { action: 'set_members', organization_unit_id: L, user_ids: [p1.id] });
  const n = await orgPost(api, 'members', { id: N, user_ids: [p1.id] });
  if (cls(l.status()) !== cls(n.status()) || l.status() !== n.status())
    diffs.push({ kind: 'status', key: 'primary-conflict', legacy: l.status(), native: n.status(), detail: '舊版唯一限制錯誤／新版明確提示' });
  expect(n.status()).toBe(409);
  expect(await n.text()).toContain('已有其他主要組織');
  expect(await activeMemberIds(N)).toEqual([]);
  expect(await activeMemberIds(tree.deptA)).toContain(p1.id);
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', role: 'org_full', title: '成員已在其他部門', legacy: { endpoint: 'PATCH set_members', status: l.status() }, native: { endpoint: 'POST members', status: n.status() }, compared: { cases: 1 }, diffs }),
  );
  expect(diffs.length).toBe(1);
});

test('工作交接分頁與組織導覽器：舊版有、新版不做（空白佔位／與樹狀搜尋重複）', async () => {
  const legacySrc = read('components/admin/OrganizationManagementClient.tsx');
  expect(legacySrc).toContain('renderHandoverTab');
  expect(legacySrc).toContain('function OrganizationNavigatorDrawer');
  const dept = read('vue-workspace/src/pages/DepartmentDetail.vue');
  expect(dept).not.toContain('工作交接');
  assertNoUnlistedDiffs(
    rec.record({
      entry: entry('handover-tab').id,
      mechanism: 'ui-extract',
      title: '工作交接分頁',
      legacy: { endpoint: '舊版 renderHandoverTab（空白佔位）' },
      native: { endpoint: '無' },
      compared: { tabs: 1 },
      diffs: [{ kind: 'only-legacy', key: 'handover-tab', legacy: '工作交接（空白佔位）' }],
    }),
  );
  assertNoUnlistedDiffs(
    rec.record({
      entry: entry('org-navigator').id,
      mechanism: 'ui-extract',
      title: '組織導覽器抽屜',
      legacy: { endpoint: '舊版 OrganizationNavigatorDrawer' },
      native: { endpoint: '樹狀搜尋與類型篩選' },
      compared: { drawers: 1 },
      diffs: [{ kind: 'only-legacy', key: 'organization-navigator', legacy: '組織導覽抽屜' }],
    }),
  );
});

test('組織圖卡片：舊版卡片資訊（名稱、代碼、下層數、含下層人數、停用標籤、無主管警示）新版都有，統計數字相同', async () => {
  const e = entry('org-chart-card');
  const api = await as('org_full');
  const units = (await (await api.get('/api/workspace/organization')).json()).units as any[];
  const mine = units.filter((u) => String(u.code).startsWith('M5W21-'));
  const nodes = buildChart(mine, true);
  const flat: any[] = [];
  const walk = (n: any) => { flat.push(n); n.children.forEach(walk); };
  nodes.forEach(walk);
  // 舊版 countDescendantMembers／directChildrenCount 的逐字移植
  const legacyCounts = (unit: any) => {
    const byParent = new Map<string | null, any[]>();
    for (const u of mine) byParent.set(u.parent_id, [...(byParent.get(u.parent_id) || []), u]);
    const counted = new Set<string>();
    const w = (u: any) => { u.members.forEach((m: any) => counted.add(m.user_id)); (byParent.get(u.id) || []).forEach(w); };
    w(unit);
    return { children: (byParent.get(unit.id) || []).length, people: counted.size };
  };
  const diffs: Diff[] = [];
  for (const node of flat) {
    const l = legacyCounts(node.unit);
    const n = chartCounts(node);
    if (JSON.stringify(l) !== JSON.stringify(n)) diffs.push({ kind: 'changed', key: `chart-counts#${node.unit.code}`, legacy: l, native: n });
  }
  // 卡片版面欄位涵蓋：名稱、代碼、下層數／人數、停用標籤、無主管警示
  const card = read('vue-workspace/src/components/OrgChartNode.vue');
  for (const needle of ['node.unit.name', 'node.unit.code', 'chartCounts(node).children', 'chartCounts(node).people', '停用', '未設定主管']) if (!card.includes(needle)) diffs.push({ kind: 'only-legacy', key: `card-field#${needle}` });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', role: 'org_full', title: '組織圖卡片資訊', legacy: { endpoint: '舊版 renderChartNode' }, native: { endpoint: 'OrgChartNode.vue' }, compared: { cards: flat.length }, diffs }),
  );
  expect(flat.length).toBeGreaterThanOrEqual(8);
});
