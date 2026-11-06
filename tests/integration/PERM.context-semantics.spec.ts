import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

// PERM 整合層（DEV）：Vue context() 的權限結果 = 舊版在正式區語意下的結果。
// DEV 的 has_permission 與正式區不同（會檢查 roles.is_active、對 admin 放行），所以「正式區語意」由暫時 DEV 函式
// perf_has_permission_prod（逐字複製正式區定義、只改名稱）提供，測試結束即刪除。
// 資料：臨時帳號 cvp-test-perm-*@example.test、角色 cvp_test_perm_*、權限 cvp_test.perm.*；都在 finally 依標記清除，
// 帳號沒有任何門市任命，也不碰任何真實使用者。密碼隨機產生、只存在記憶體。

const nodeRequire = createRequire(path.join(__dirname, 'PERM.context-semantics.spec.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
const TEST_ORIGIN = 'http://localhost:3002';
const EMAIL_PREFIX = 'cvp-test-perm-';
const ROLE_PREFIX = 'cvp_test_perm_';
const PERM_PREFIX = 'cvp_test.perm.';
const PHARM = 'pharmacist.management.view'; // session.capabilities.pharmacists = ctx.has(PHARM)
const ON = `${PERM_PREFIX}on`;
const OFF = `${PERM_PREFIX}off`; // permissions.is_active = false
const DENIED = `${PERM_PREFIX}denied`; // role_permissions.is_allowed = false
const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2099-01-01T00:00:00Z';

type Db = any;
const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
};

interface Scenario {
  key: string;
  desc: string;
  profileRole: 'member' | 'admin';
  roleActive?: boolean;
  urActive?: boolean;
  expiresAt?: string | null;
  noRole?: boolean;
  grants?: ('pharm' | 'on' | 'off' | 'denied')[];
  /** 明確期望（不依賴 oracle，避免同義反覆）。 */
  expect: { on: boolean; off: boolean; denied: boolean; pharmPermission: boolean; pharmCapability: boolean };
}
const G = ['pharm', 'on'] as ('pharm' | 'on')[];
const SCENARIOS: Scenario[] = [
  { key: 'baseline', desc: '有效角色、有效指派', profileRole: 'member', grants: G, expect: { on: true, off: false, denied: false, pharmPermission: true, pharmCapability: true } },
  { key: 'inactiverole', desc: '角色已停用（roles.is_active=false）：正式區仍生效', profileRole: 'member', roleActive: false, grants: G, expect: { on: true, off: false, denied: false, pharmPermission: true, pharmCapability: true } },
  { key: 'adminprofile', desc: 'profiles.role=admin、沒有任何角色：has 全開，但沒有明確授權', profileRole: 'admin', noRole: true, expect: { on: false, off: false, denied: false, pharmPermission: false, pharmCapability: true } },
  { key: 'expired', desc: 'user_roles 已過期', profileRole: 'member', expiresAt: PAST, grants: G, expect: { on: false, off: false, denied: false, pharmPermission: false, pharmCapability: false } },
  { key: 'future', desc: 'user_roles 尚未過期', profileRole: 'member', expiresAt: FUTURE, grants: G, expect: { on: true, off: false, denied: false, pharmPermission: true, pharmCapability: true } },
  { key: 'urinactive', desc: 'user_roles.is_active=false', profileRole: 'member', urActive: false, grants: G, expect: { on: false, off: false, denied: false, pharmPermission: false, pharmCapability: false } },
  { key: 'permflags', desc: '權限停用（permissions.is_active=false）與未允許（is_allowed=false）', profileRole: 'member', grants: ['on', 'off', 'denied'], expect: { on: true, off: false, denied: false, pharmPermission: false, pharmCapability: false } },
  { key: 'norole', desc: '一般帳號、沒有角色', profileRole: 'member', noRole: true, expect: { on: false, off: false, denied: false, pharmPermission: false, pharmCapability: false } },
  { key: 'adminexpired', desc: 'profiles.role=admin 且角色已過期：保底仍生效，角色授權不生效', profileRole: 'admin', expiresAt: PAST, grants: G, expect: { on: false, off: false, denied: false, pharmPermission: false, pharmCapability: true } },
];

function adminDb(): Db {
  const guard = nodeRequire(path.join(ROOT, 'tests', 'support', 'env-guard.cjs')) as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => Db };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function cleanup(db: Db): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) await db.from('user_roles').delete().in('user_id', uids);
  const { data: roles } = await db.from('roles').select('id').like('code', `${ROLE_PREFIX}%`);
  const roleIds = (roles || []).map((r: { id: string }) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const r = await db.from('roles').delete().in('id', roleIds);
    if (r.error) log.push(`roles: ${r.error.message}`);
  }
  const { data: perms } = await db.from('permissions').select('id').like('code', `${PERM_PREFIX}%`);
  const permIds = (perms || []).map((p: { id: string }) => p.id);
  if (permIds.length) {
    await db.from('role_permissions').delete().in('permission_id', permIds);
    const r = await db.from('permissions').delete().in('id', permIds);
    if (r.error) log.push(`permissions: ${r.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    for (const u of r.data.users || []) {
      if (u.email && u.email.startsWith(EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if ((r.data.users || []).length < 200) break;
  }
  return log;
}

test.describe.configure({ mode: 'serial' });

test.describe('Vue context() 權限語意 = 舊版在正式區語意（DEV 暫時函式模擬正式區 has_permission）', () => {
  let db: Db;
  const prodFn = nodeRequire(path.join(ROOT, 'scripts', 'perf', 'prod-has-permission-fn.cjs')) as { FN: string; createProdFn: () => void; dropProdFn: () => void };
  const users: Record<string, { id: string; email: string; password: string }> = {};
  let fnCreated = false;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    db = adminDb();
    const left = await cleanup(db);
    if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
    prodFn.createProdFn();
    fnCreated = true;

    const mk = async (code: string, active: boolean) =>
      must(await db.from('permissions').insert({ module: 'cvp_test', feature: 'perm', code, action: 'view', description: 'PERM test probe', is_active: active }).select('id').single(), `建立權限 ${code}`) as { id: string };
    const permIds = { on: (await mk(ON, true)).id, off: (await mk(OFF, false)).id, denied: (await mk(DENIED, true)).id, pharm: '' };
    permIds.pharm = (must(await db.from('permissions').select('id').eq('code', PHARM).single(), '讀取藥師權限') as { id: string }).id;

    for (const sc of SCENARIOS) {
      const email = `${EMAIL_PREFIX}${sc.key}@example.test`;
      const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
      const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `PERM ${sc.key}` } });
      if (created.error) throw new Error(`建立帳號 ${sc.key} 失敗：${created.error.message}`);
      const uid = created.data.user.id as string;
      users[sc.key] = { id: uid, email, password };
      must(await db.from('profiles').update({ role: sc.profileRole, department: null }).eq('id', uid), `profile ${sc.key}`);
      if (sc.noRole && !sc.grants) continue;
      const role = must(
        await db.from('roles').insert({ name: `PERM Test ${sc.key}`, code: `${ROLE_PREFIX}${sc.key}`, description: 'context permission semantics test role', is_system: false, is_active: sc.roleActive ?? true }).select('id').single(),
        `建立角色 ${sc.key}`,
      ) as { id: string };
      const rows = (sc.grants || []).map((g) => ({ role_id: role.id, permission_id: permIds[g], is_allowed: g !== 'denied' }));
      if (rows.length) must(await db.from('role_permissions').insert(rows), `角色權限 ${sc.key}`);
      must(
        await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: sc.urActive ?? true, expires_at: sc.expiresAt ?? null }),
        `user_roles ${sc.key}`,
      );
    }
  });

  test.afterAll(async () => {
    const errors: string[] = [];
    try {
      if (db) errors.push(...(await cleanup(db)));
    } catch (e) {
      errors.push(`cleanup: ${(e as Error).message}`);
    }
    try {
      if (fnCreated) prodFn.dropProdFn();
    } catch (e) {
      errors.push(`dropProdFn: ${(e as Error).message}`);
    }
    if (db) {
      const { count: p } = await db.from('permissions').select('id', { count: 'exact', head: true }).like('code', `${PERM_PREFIX}%`);
      const { count: r } = await db.from('roles').select('id', { count: 'exact', head: true }).like('code', `${ROLE_PREFIX}%`);
      const { count: u } = await db.from('profiles').select('id', { count: 'exact', head: true }).like('email', `${EMAIL_PREFIX}%`);
      if (p || r || u) errors.push(`殘留 permissions=${p} roles=${r} profiles=${u}`);
    }
    expect(errors).toEqual([]);
  });

  async function sessionAs(key: string): Promise<{ permissions: string[]; capabilities: Record<string, boolean> }> {
    const u = users[key];
    const ctx: APIRequestContext = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
    try {
      const login = await ctx.post('/api/workspace/login', { data: { email: u.email, password: u.password } });
      if (!login.ok()) throw new Error(`帳號 ${key} 登入失敗（HTTP ${login.status()}）`);
      const res = await ctx.get('/api/workspace/session');
      expect(res.status(), `${key} session`).toBe(200);
      return await res.json();
    } finally {
      await ctx.dispose();
    }
  }
  const prodHas = async (uid: string, code: string): Promise<boolean> => {
    const { data, error } = await db.rpc(prodFn.FN, { p_user_id: uid, p_permission_code: code });
    if (error) throw new Error(`${prodFn.FN} 失敗：${error.message}`);
    return data === true;
  };

  for (const sc of SCENARIOS) {
    test(`${sc.key}：${sc.desc}`, async () => {
      const s = await sessionAs(sc.key);
      const uid = users[sc.key].id;
      const perms = new Set(s.permissions);
      // 明確期望
      expect(perms.has(ON), 'on').toBe(sc.expect.on);
      expect(perms.has(OFF), 'off').toBe(sc.expect.off);
      expect(perms.has(DENIED), 'denied').toBe(sc.expect.denied);
      expect(perms.has(PHARM), 'pharm permission').toBe(sc.expect.pharmPermission);
      expect(s.capabilities.pharmacists, 'pharm capability').toBe(sc.expect.pharmCapability);
      // 與正式區 has_permission（暫時 DEV 函式）逐碼一致：ctx.permissions 沒有 admin 繞過
      for (const code of [ON, OFF, DENIED, PHARM]) expect(perms.has(code), `prod has_permission(${code})`).toBe(await prodHas(uid, code));
      // 與舊版 hasPermission 一致：profiles.role=admin 保底，否則等於正式區 has_permission
      expect(s.capabilities.pharmacists, 'legacy hasPermission').toBe(sc.profileRole === 'admin' || (await prodHas(uid, PHARM)));
    });
  }

  test('對照：DEV 現行 has_permission 對停用角色與正式區不同（本測試以暫時函式為準）', async () => {
    const uid = users.inactiverole.id;
    const dev = await db.rpc('has_permission', { p_user_id: uid, p_permission_code: ON });
    test.info().annotations.push({ type: 'dev-vs-prod', description: `inactive role: DEV has_permission=${dev.error ? 'error' : dev.data}, prod semantics=${await prodHas(uid, ON)}` });
    expect(await prodHas(uid, ON)).toBe(true);
  });
});
