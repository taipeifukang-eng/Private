import { randomUUID } from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import {
  activeManagerIds,
  activeMemberIds,
  addManager,
  addMember,
  cleanupM5Org,
  createAuthUser,
  orgCatalog,
  orgName,
  orgPost,
  profileDepartment,
  seedOrgTree,
  seedWork,
  unitRow,
  type OrgTree,
} from '../support/m5-org-fixtures';
import { ASSIGNMENT_TYPES, personResponsibilities } from '../../lib/workspace/organization-rules';

// W21 整合層（M5 Q9、Q10、Q11、人員職掌統計）：
//  Q9 部門管理的資料讀取權限照舊版頁面條件；Q10 停用部門仍可調整成員與主管；Q11 部門改名／停用不同步人員資料的部門文字。
// 資料：只用本次建立、代碼帶 M5W21-<RUNID> 的組織單位與 m5p-test-* 帳號；結束時只刪自己建立的資料。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string): Promise<APIRequestContext> {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}
let tree: OrgTree;
let p1: { id: string; email: string };
let p2: { id: string; email: string };
let p3: { id: string; email: string };
const KEYS = ['org_view', 'org_member_view', 'org_manager_view', 'dept_view', 'dept_ws_view', 'dept_ws_manage', 'dept_member_manage', 'org_full'];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  await cleanupM5Org(Object.values(users).map((u) => u.id));
  tree = await seedOrgTree();
  p1 = await createAuthUser('w21-p1');
  p2 = await createAuthUser('w21-p2');
  p3 = await createAuthUser('w21-p3');
  await addMember(tree.deptA, p1.id);
  await seedWork(tree, { u1: p1.id, u2: p2.id });
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  const left = await cleanupM5Org(Object.values(users).map((u) => u.id));
  expect(left, '殘留的測試組織單位').toBe(0);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const unitPayload = (u: any, over: Record<string, unknown> = {}) => ({
  id: u.id, code: u.code, name: u.name, short_name: u.short_name ?? '', description: u.description ?? '', parent_id: u.parent_id, status: u.status, sort_order: u.sort_order, ...over,
});

test('Q9 部門管理資料：只有部門相關權限進得來；只有組織／成員／主管檢視的人被擋（舊頁會導回儀表板）', async () => {
  const expected: Record<string, number> = {
    org_view: 403, org_member_view: 403, org_manager_view: 403,
    dept_view: 200, dept_ws_view: 200, dept_ws_manage: 200, dept_member_manage: 200, org_full: 200,
  };
  for (const [key, status] of Object.entries(expected)) {
    const api = await as(key);
    expect((await api.get('/api/workspace/department-work')).status(), `${key} 部門列表`).toBe(status);
    expect((await api.get(`/api/workspace/department-work?department=${tree.deptA}`)).status(), `${key} 部門職掌`).toBe(status);
  }
  const anon = await pwRequest.newContext({ baseURL: 'http://localhost:3002' });
  try {
    expect((await anon.get('/api/workspace/department-work')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('人員職掌統計（stats=true）：只有組織／成員／主管檢視的人也能取得該部門職掌，且不含成員與主管；其他請求仍被擋', async () => {
  for (const key of ['org_view', 'org_member_view', 'org_manager_view', 'dept_view', 'org_full']) {
    const api = await as(key);
    const res = await api.get(`/api/workspace/department-work?stats=true&department=${tree.deptA}`);
    expect(res.status(), `${key} 統計`).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items), `${key} items`).toBe(true);
    expect(Array.isArray(body.categories), `${key} categories`).toBe(true);
    expect(body.members, `${key} 不含成員`).toBeUndefined();
    expect(body.managers, `${key} 不含主管`).toBeUndefined();
  }
  const orgOnly = await as('org_view');
  expect((await orgOnly.get(`/api/workspace/department-work?department=${tree.deptA}`)).status(), '一般職掌請求仍被擋').toBe(403);
  expect((await orgOnly.get('/api/workspace/department-work?stats=true&people=true&department=' + tree.deptA)).status(), 'people 仍被擋').toBe(403);
});

test('Q9 導覽與 session：部門管理入口與能力旗標跟 API 同一條件；公司組織入口不變', async () => {
  const cases: Record<string, { departments: boolean; organization: boolean }> = {
    org_view: { departments: false, organization: true },
    org_member_view: { departments: false, organization: true },
    org_manager_view: { departments: false, organization: true },
    dept_view: { departments: true, organization: true },
    dept_ws_view: { departments: true, organization: true },
    dept_ws_manage: { departments: true, organization: false }, // 工作管理不在公司組織的入口條件內（舊版 Navbar 相同）
    dept_member_manage: { departments: true, organization: true },
  };
  for (const [key, want] of Object.entries(cases)) {
    const body = await (await (await as(key)).get('/api/workspace/session')).json();
    expect(body.capabilities.departments, `${key} departments`).toBe(want.departments);
    expect(body.capabilities.organization, `${key} organization`).toBe(want.organization);
    const labels: string[] = body.navigation.flatMap((g: any) => g.items.map((i: any) => i.label));
    expect(labels.includes('部門管理'), `${key} 導覽`).toBe(want.departments);
    expect(labels.includes('公司組織'), `${key} 導覽(組織)`).toBe(want.organization);
  }
});

test('Q9 公司組織資料仍照整組組織權限（沒有被收緊）；人員清單需成員或主管管理', async () => {
  for (const key of ['org_view', 'org_member_view', 'org_manager_view', 'dept_view', 'org_full']) {
    expect((await orgCatalog(await as(key))).status, key).toBe(200);
  }
  expect((await orgCatalog(await as('dept_ws_manage'))).status).toBe(403);
  expect((await (await as('org_view')).get('/api/workspace/organization-people')).status()).toBe(403);
  expect((await (await as('org_full')).get('/api/workspace/organization-people')).status()).toBe(200);
  // 部門 API 的人員名單需要工作管理
  expect((await (await as('dept_view')).get('/api/workspace/department-work?people=true')).status()).toBe(403);
  expect((await (await as('dept_ws_manage')).get('/api/workspace/department-work?people=true')).status()).toBe(200);
});

test('部門列表包含停用部門（畫面用「包含停用」開關控制）；停用部門的職掌為唯讀', async () => {
  const body = await (await (await as('dept_ws_view')).get('/api/workspace/department-work')).json();
  const mine = body.departments.filter((d: any) => String(d.code).startsWith('M5W21-'));
  expect(mine.map((d: any) => d.id).sort()).toEqual([tree.deptA, tree.deptB, tree.deptC].sort());
  expect(mine.find((d: any) => d.id === tree.deptB).status).toBe('inactive');
  const detail = await (await (await as('org_full')).get(`/api/workspace/department-work?department=${tree.deptB}`)).json();
  expect(detail.canManage).toBe(false);
  expect(detail.organizationCapabilities).toMatchObject({ members: true, managers: true });
});

test('人員職掌統計：只算該部門、只看有效職掌；與舊版 API 算出的數字相同', async () => {
  const api = await as('dept_ws_view');
  const body = await (await api.get(`/api/workspace/department-work?department=${tree.deptA}`)).json();
  const stats = (id: string) => {
    const s = personResponsibilities(body.items, id);
    return { PRIMARY: s.PRIMARY.length, COLLABORATOR: s.COLLABORATOR.length, BACKUP: s.BACKUP.length };
  };
  // p1：主責 2（a1、a2；停用職掌與別部門都不算）、協作 1、代理 0（指派已結束）。p2：協作指派已停用不算，代理 1。
  expect(stats(p1.id)).toEqual({ PRIMARY: 2, COLLABORATOR: 1, BACKUP: 0 });
  expect(stats(p2.id)).toEqual({ PRIMARY: 0, COLLABORATOR: 0, BACKUP: 1 });
  expect(stats(p3.id)).toEqual({ PRIMARY: 0, COLLABORATOR: 0, BACKUP: 0 });
  // 不會多給其他部門的資訊：部門 A 的回應不含部門 C 的職掌
  expect(body.items.every((i: any) => i.organization_unit_id === tree.deptA)).toBe(true);
  // 舊版 API（只回啟用職掌）逐項算出相同數字
  const legacy = await (await (await as('org_full')).get(`/api/department-workspace/work-items?department_id=${tree.deptA}`)).json();
  for (const id of [p1.id, p2.id, p3.id]) {
    const legacyCounts = Object.fromEntries(
      ASSIGNMENT_TYPES.map((type) => [type, legacy.items.filter((item: any) => item.assignments.some((a: any) => a.user_id === id && a.assignment_type === type && a.status === 'active' && !a.effective_to)).length]),
    );
    expect(stats(id)).toEqual(legacyCounts);
  }
});

test('Q10 停用部門仍可調整成員與主管（含移出）；停用單位不得新增子單位、也不能被掛到停用單位底下', async () => {
  const api = await as('org_full');
  expect((await unitRow(tree.deptB)).status).toBe('inactive');
  // 加入成員
  let res = await orgPost(api, 'members', { id: tree.deptB, user_ids: [p3.id] });
  expect(res.status(), await res.text()).toBe(200);
  expect(await activeMemberIds(tree.deptB)).toEqual([p3.id]);
  // 設定主管
  res = await orgPost(api, 'managers', { id: tree.deptB, assignments: [{ user_id: p3.id, manager_role: 'manager', is_primary: true }] });
  expect(res.status(), await res.text()).toBe(200);
  expect(await activeManagerIds(tree.deptB)).toEqual([p3.id]);
  // 一個人只有一個主要部門：p3 留在停用部門時不能直接加到別的部門（要先移出）
  res = await orgPost(api, 'members', { id: tree.deptC, user_ids: [p3.id] });
  expect(res.status()).toBe(409);
  // 移出成員與主管
  res = await orgPost(api, 'members', { id: tree.deptB, user_ids: [] });
  expect(res.status(), await res.text()).toBe(200);
  res = await orgPost(api, 'managers', { id: tree.deptB, assignments: [] });
  expect(res.status(), await res.text()).toBe(200);
  expect(await activeMemberIds(tree.deptB)).toEqual([]);
  expect(await activeManagerIds(tree.deptB)).toEqual([]);
  // 移出後就能加到別的部門
  res = await orgPost(api, 'members', { id: tree.deptC, user_ids: [p3.id] });
  expect(res.status(), await res.text()).toBe(200);
  res = await orgPost(api, 'members', { id: tree.deptC, user_ids: [] });
  expect(res.status()).toBe(200);
  // 其餘照新版：不能在停用單位底下新增子單位，也不能把單位移到停用單位下
  res = await orgPost(api, 'create', { code: `${(await unitRow(tree.deptA)).code}-X`.slice(0, 30), name: orgName('child-of-inactive'), short_name: '', description: '', type: 'team', parent_id: tree.deptB, status: 'active', sort_order: 9 });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('上層單位不存在或已停用');
  res = await orgPost(api, 'hierarchy', { updates: [{ id: tree.teamA1, parent_id: tree.deptB, sort_order: 1 }] });
  expect(res.status()).toBe(400);
  expect((await unitRow(tree.teamA1)).parent_id).toBe(tree.deptA);
});

test('Q10 權限分開：只有成員管理的人不能設主管；只有檢視的人 403', async () => {
  const memberOnly = await as('dept_member_manage');
  const res = await orgPost(memberOnly, 'managers', { id: tree.deptC, assignments: [{ user_id: p2.id, manager_role: 'manager', is_primary: true }] });
  expect(res.status()).toBe(403);
  expect((await orgPost(await as('org_view'), 'members', { id: tree.deptC, user_ids: [] })).status()).toBe(403);
});

test('Q11 部門改名／停用／改類型不同步人員資料的部門文字；成員異動才同步', async () => {
  const api = await as('org_full');
  const before = await unitRow(tree.deptA);
  expect(await profileDepartment(p1.id), '種子：加入成員時已同步').toBe(before.name);

  // 改名：人員資料的部門文字維持舊名稱（舊版：不動）
  const renamed = orgName('A-renamed');
  let res = await orgPost(api, 'update', unitPayload(before, { name: renamed }));
  expect(res.status(), await res.text()).toBe(200);
  expect((await unitRow(tree.deptA)).name).toBe(renamed);
  expect(await profileDepartment(p1.id), '改名後人員資料維持舊名稱').toBe(before.name);

  // 停用：人員資料不被清成空白
  res = await orgPost(api, 'update', unitPayload(await unitRow(tree.deptA), { status: 'inactive' }));
  expect(res.status(), await res.text()).toBe(200);
  expect((await unitRow(tree.deptA)).status).toBe('inactive');
  expect(await profileDepartment(p1.id), '停用後人員資料不被清空').toBe(before.name);

  // 啟用回來，仍不動
  res = await orgPost(api, 'update', unitPayload(await unitRow(tree.deptA), { status: 'active' }));
  expect(res.status()).toBe(200);
  expect(await profileDepartment(p1.id)).toBe(before.name);

  // 成員異動才同步：移出 → 空白；再加入 → 目前名稱
  res = await orgPost(api, 'members', { id: tree.deptA, user_ids: [] });
  expect(res.status(), await res.text()).toBe(200);
  expect(await profileDepartment(p1.id), '移出主要部門後同步為空').toBeNull();
  res = await orgPost(api, 'members', { id: tree.deptA, user_ids: [p1.id] });
  expect(res.status()).toBe(200);
  expect(await profileDepartment(p1.id), '重新加入後同步為目前名稱').toBe(renamed);

  // 還原名稱，後續測試不受影響
  res = await orgPost(api, 'update', unitPayload(await unitRow(tree.deptA), { name: before.name }));
  expect(res.status()).toBe(200);
});

test('組織儲存的衝突保護仍在：用過期的版本儲存回 409，資料不變', async () => {
  const api = await as('org_full');
  const stale = (await orgCatalog(api)).body.version as string;
  const row = await unitRow(tree.deptC);
  let res = await orgPost(api, 'update', unitPayload(row, { description: 'changed once' }));
  expect(res.status()).toBe(200);
  res = await api.post('/api/workspace/organization', { data: { operation: 'update', data: unitPayload(row, { description: 'stale write' }), requestId: randomUUID(), expected: stale } });
  expect(res.status()).toBe(409);
  expect((await unitRow(tree.deptC)).description).toBe('changed once');
  res = await orgPost(api, 'update', unitPayload(await unitRow(tree.deptC), { description: '' }));
  expect(res.status()).toBe(200);
});

test('人員抽屜用到的人員欄位只有識別、姓名、員編、職稱與信箱，不多給其他資料', async () => {
  const body = await (await (await as('dept_ws_view')).get(`/api/workspace/department-work?department=${tree.deptA}`)).json();
  const user = body.items.flatMap((i: any) => i.assignments).find((a: any) => a.user_id === p1.id).user;
  expect(Object.keys(user).sort()).toEqual(['email', 'employee_code', 'full_name', 'id', 'job_title']);
});
