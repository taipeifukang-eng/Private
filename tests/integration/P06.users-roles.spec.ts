import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAdminLevelRole, createAuthUser, createPlainRole, deleteAdminLevelRole, grantRole, profileRole, userRoleRows } from '../support/m5-org-fixtures';
import { isPendingActivation } from '../../lib/workspace/user-management-rules';

// P06 整合層（M5 Q12、Q13、Q14、Q15、角色清單 DEV 測試角色）：使用者管理 API 與角色管理 API。
// 資料：m5p-test-* 帳號與 m5p_test_* 角色（密碼隨機、只在記憶體），結束時只刪自己建立的帳號與角色。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string): Promise<APIRequestContext> {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}
let plainRole: { id: string; code: string; name: string };
const t: Record<string, { id: string; email: string; password: string }> = {};
let ownerRole: { id: string; code: string; name: string } | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['user_viewer', 'user_editor', 'user_admin', 'role_viewer', 'role_assigner']);
  users = s.users;
  teardownUsers = s.teardown;
  await deleteAdminLevelRole();
  plainRole = await createPlainRole('p06plain');
  // 各種狀態的帳號
  t.pending = await createAuthUser('p06-pending', { employeeCode: 'ZTP06PENDING' });
  t.withRole = await createAuthUser('p06-withrole', { employeeCode: 'ZTP06WITHROLE' });
  t.expired = await createAuthUser('p06-expired', { employeeCode: 'ZTP06EXPIRED' });
  t.inactiveAssign = await createAuthUser('p06-inactive-assign', { employeeCode: 'ZTP06INACTIVE' });
  t.banned = await createAuthUser('p06-banned', { ban: true, employeeCode: 'ZTP06BANNED' });
  t.adminProfile = await createAuthUser('p06-admin-profile', { profileRole: 'admin', employeeCode: 'ZTP06ADMINPROF' });
  t.target = await createAuthUser('p06-target', { employeeCode: 'ZTP06TARGET' });
  await grantRole(t.withRole.id, plainRole.id);
  await grantRole(t.expired.id, plainRole.id, { expires_at: '2020-01-01T00:00:00Z' });
  await grantRole(t.inactiveAssign.id, plainRole.id, { is_active: false });
  ownerRole = await createAdminLevelRole();
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  await deleteAdminLevelRole();
  expect(await teardownUsers(), '清除帳號與角色').toEqual([]);
});

const usersList = async (key = 'user_viewer') => (await (await as(key)).get('/api/workspace/users')).json();

test('Q12 新增使用者：管理員直接建立的功能已移除，API 回 400 並說明改由本人註冊；不會建立任何帳號', async () => {
  const email = 'm5p-test-p06-created@example.test';
  const api = await as('user_editor'); // 持有「建立使用者」權限
  const res = await api.post('/api/workspace/users', { data: { action: 'create', email, full_name: 'M5P created', password: 'Abcdef1!' } });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('公開註冊頁');
  const { data } = await adminDb().from('profiles').select('id').eq('email', email);
  expect(data || []).toEqual([]);
  const list = await usersList('user_editor');
  expect(list.users.some((u: any) => u.email === email)).toBe(false);
});

test('Q12 公開註冊頁仍可開啟（新增使用者連到的地方）', async () => {
  const anon = await pwRequest.newContext({ baseURL: 'http://localhost:3002' });
  try {
    const res = await anon.get('/register', { maxRedirects: 5 });
    expect(res.status()).toBe(200);
  } finally {
    await anon.dispose();
  }
});

test('Q15 待開通：沒有任何生效角色的有效帳號才算；已到期／已停用的指派算沒有角色；管理員身分、已停用帳號不算', async () => {
  const body = await usersList();
  const byId = new Map<string, any>(body.users.map((u: any) => [u.id, u]));
  const want: Record<string, boolean> = { pending: true, expired: true, inactiveAssign: true, withRole: false, banned: false, adminProfile: false, target: true };
  for (const [key, expected] of Object.entries(want)) {
    const row = byId.get(t[key].id);
    expect(row, key).toBeTruthy();
    expect(row.is_pending_activation, key).toBe(expected);
    expect(isPendingActivation(row), `${key} 與共用規則一致`).toBe(expected);
  }
  expect(byId.get(t.banned.id).is_disabled).toBe(true);
  // 帳號有角色的測試操作者本身不是待開通
  expect(byId.get(users.user_viewer.id).is_pending_activation).toBe(false);
  // 總數 = 旗標為真的筆數（站內「待開通 N 位」）
  expect(body.pendingCount).toBe(body.users.filter((u: any) => u.is_pending_activation).length);
  expect(body.pendingCount).toBeGreaterThanOrEqual(4);
});

test('Q15 指派角色後就不再是待開通（資料庫狀態即時反映）', async () => {
  await grantRole(t.target.id, plainRole.id);
  const body = await usersList();
  expect(body.users.find((u: any) => u.id === t.target.id).is_pending_activation).toBe(false);
  await adminDb().from('user_roles').delete().eq('user_id', t.target.id);
});

test('Q14 重置密碼：只有舊式身分是管理員的人能用；其他人（含持有使用者全部權限者）403；能力旗標一致', async () => {
  const newPassword = 'M5p-new-Password-1!';
  const editor = await as('user_editor');
  const denied = await editor.post('/api/workspace/users', { data: { action: 'reset', id: t.target.id, password: newPassword } });
  expect(denied.status()).toBe(403);
  expect(await denied.text()).toContain('只有管理員可以重置密碼');
  expect((await usersList('user_editor')).capabilities.reset).toBe(false);
  const viewer = await as('user_viewer');
  expect((await viewer.post('/api/workspace/users', { data: { action: 'reset', id: t.target.id, password: newPassword } })).status()).toBe(403);

  const admin = await as('user_admin');
  expect((await usersList('user_admin')).capabilities.reset).toBe(true);
  const short = await admin.post('/api/workspace/users', { data: { action: 'reset', id: t.target.id, password: '12345' } });
  expect(short.status()).toBe(400);
  const ok = await admin.post('/api/workspace/users', { data: { action: 'reset', id: t.target.id, password: newPassword } });
  expect(ok.status(), await ok.text()).toBe(200);
  // 新密碼可以登入
  const login = await apiForUser({ key: 'target', id: t.target.id, email: t.target.email, password: newPassword });
  await login.dispose();
});

test('Q13 後端規則不變：持有「變更使用者角色」的人仍可把別人改成管理員（畫面才加確認）；不能改自己', async () => {
  const editor = await as('user_editor');
  const self = await editor.patch('/api/workspace/users', { data: { action: 'role', id: users.user_editor.id, role: 'admin' } });
  expect(self.status()).toBe(400);
  const res = await editor.patch('/api/workspace/users', { data: { action: 'role', id: t.target.id, role: 'admin' } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await profileRole(t.target.id)).toBe('admin');
  const back = await editor.patch('/api/workspace/users', { data: { action: 'role', id: t.target.id, role: 'member' } });
  expect(back.status()).toBe(200);
  expect(await profileRole(t.target.id)).toBe('member');
  expect((await (await as('user_viewer')).patch('/api/workspace/users', { data: { action: 'role', id: t.target.id, role: 'admin' } })).status()).toBe(403);
});

test('Q13 後端規則不變：持有「指派使用者角色」的人仍可把人加進管理員等級角色（畫面才加確認）', async () => {
  test.skip(!ownerRole, 'DEV 已有 owner_role 角色，不動別人的角色');
  const api = await as('role_assigner');
  const res = await api.post(`/api/workspace/roles/${ownerRole!.id}/users`, { data: { employee_codes: ['ZTP06TARGET'] } });
  expect(res.status(), await res.text()).toBe(201);
  expect((await userRoleRows(t.target.id, ownerRole!.id)).length).toBe(1);
  const out = await api.delete(`/api/workspace/roles/${ownerRole!.id}/users/${t.target.id}`);
  expect(out.status()).toBe(200);
  expect(await userRoleRows(t.target.id, ownerRole!.id)).toEqual([]);
  expect((await (await as('role_viewer')).post(`/api/workspace/roles/${ownerRole!.id}/users`, { data: { employee_codes: ['ZTP06TARGET'] } })).status()).toBe(403);
});

test('角色清單：預設隱藏 DEV 測試角色並回報隱藏數量；帶開關才列出；no_access 也屬此類', async () => {
  await createPlainRole('p06devhidden', { name: 'DEV M5P Test hidden', code: 'm5p_test_p06devhidden' });
  const api = await as('role_viewer');
  const def = await (await api.get('/api/workspace/roles')).json();
  const all = await (await api.get('/api/workspace/roles?includeDevRoles=true')).json();
  const isDev = (r: any) => /^dev_/.test(r.code) || /^dev-/.test(r.code) || /_temp$/.test(r.code) || /^no_access$/.test(r.code) || /^dev[ _]/i.test(r.name) || /temporary dev verification role|dev-only/i.test(r.description || '');
  expect(def.roles.some(isDev)).toBe(false);
  expect(def.roles.some((r: any) => r.code === 'm5p_test_p06devhidden')).toBe(false);
  expect(all.roles.some((r: any) => r.code === 'm5p_test_p06devhidden' && r.is_dev_verification_role)).toBe(true);
  expect(def.meta.hidden_dev_role_count).toBeGreaterThanOrEqual(1);
  expect(all.roles.length - def.roles.length).toBe(def.meta.hidden_dev_role_count);
  expect(all.meta.hidden_dev_role_count).toBe(0);
  // 一般測試角色（plainRole）預設就看得到
  expect(def.roles.some((r: any) => r.code === plainRole.code)).toBe(true);
  // 權限旗標
  expect(def.capabilities).toMatchObject({ create: false, assignUsers: false });
  expect((await (await as('role_assigner')).get('/api/workspace/roles')).status()).toBe(200);
});

test('權限與來源檢查：未登入 401；沒有使用者管理權限 403', async () => {
  const anon = await pwRequest.newContext({ baseURL: 'http://localhost:3002' });
  try {
    expect((await anon.get('/api/workspace/users')).status()).toBe(401);
    expect((await anon.get('/api/workspace/roles')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  expect((await (await as('role_viewer')).get('/api/workspace/users')).status()).toBe(403);
  expect((await (await as('user_viewer')).get('/api/workspace/roles')).status()).toBe(403);
});
