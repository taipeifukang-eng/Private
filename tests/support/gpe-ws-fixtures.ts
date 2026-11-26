import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN, BYPASS_HEADERS } from './auth';

/**
 * 新版巡店「定位例外」e2e 的測試帳號與角色。
 * 規則：只用 DEV（env-guard）、只用 ZT 測試門市；角色代碼前綴 gpe_test_、信箱前綴 gpe-test-（已查無撞名）。
 * 兩個角色的權限相同（比照 vue_workspace_supervisor 的巡店權限），差別只有 inspection.gps_exempt。
 * 帳號密碼每次隨機產生，只存在記憶體；teardown 與下次 setup 開頭依標記清除。
 */
const nodeRequire = createRequire(path.join(__dirname, 'gpe-ws-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');

export const GPE_EMAIL_PREFIX = 'gpe-test-';
export const GPE_ROLE_PREFIX = 'gpe_test_';
export const GPE_STORES = ['ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];
export const GPS_EXEMPT_CODE = 'inspection.gps_exempt';
const BASE_PERMS = [
  'inspection.create',
  'inspection.edit',
  'inspection.complete',
  'inspection.upload_photo',
  'inspection.view_own',
  'inspection.view_store',
  'store.store.view', // 巡店列表的門市下拉要用（比照 vue_workspace_supervisor）
];

export interface GpeUser {
  key: 'yes' | 'no';
  id: string;
  email: string;
  password: string;
}

type Db = any;
function adminDb(): Db {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => Db };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

/** 依標記清除帳號、角色與任命；回傳失敗訊息。 */
export async function cleanupGpe(db: Db = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${GPE_EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  const { data: roles } = await db.from('roles').select('id').like('code', `${GPE_ROLE_PREFIX}%`);
  const roleIds = (roles || []).map((r: { id: string }) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const r = await db.from('roles').delete().in('id', roleIds);
    if (r.error) log.push(`roles: ${r.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    const users = r.data.users || [];
    for (const u of users) {
      if (u.email && u.email.startsWith(GPE_EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (users.length < 200) break;
  }
  return log;
}

/** 建立兩個督導角色帳號：yes 有 inspection.gps_exempt，no 沒有；兩者都是 ZT01~ZT05 的督導。 */
export async function setupGpe(): Promise<{ users: Record<'yes' | 'no', GpeUser>; teardown: () => Promise<string[]> }> {
  const db = adminDb();
  const leftover = await cleanupGpe(db);
  if (leftover.length) throw new Error(`清除上次殘留失敗：${leftover.join('; ')}`);
  const stores = must(await db.from('stores').select('id,store_code').in('store_code', GPE_STORES), '讀取測試門市') as { id: string; store_code: string }[];
  for (const c of GPE_STORES) if (!stores.some((s) => s.store_code === c)) throw new Error(`DEV 缺少測試門市 ${c}`);
  const codes = [...BASE_PERMS, GPS_EXEMPT_CODE];
  const permIds: Record<string, string> = {};
  for (const p of must(await db.from('permissions').select('id,code').in('code', codes), '讀取 permissions') as any[]) permIds[p.code] = p.id;
  for (const c of codes) if (!permIds[c]) throw new Error(`DEV 缺少權限 ${c}`);

  const users = {} as Record<'yes' | 'no', GpeUser>;
  for (const key of ['yes', 'no'] as const) {
    const perms = key === 'yes' ? [...BASE_PERMS, GPS_EXEMPT_CODE] : BASE_PERMS;
    const role = must(
      await db.from('roles').insert({ name: `GPE Test ${key}`, code: `${GPE_ROLE_PREFIX}${key}`, description: 'workspace gps exempt e2e test role', is_system: false, is_active: true }).select('id').single(),
      `建立角色 ${key}`,
    ) as { id: string };
    must(await db.from('role_permissions').insert(perms.map((c) => ({ role_id: role.id, permission_id: permIds[c], is_allowed: true }))), `角色權限 ${key}`);
    const email = `${GPE_EMAIL_PREFIX}${key}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `GPE ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    users[key] = { key, id: uid, email, password };
    must(await db.from('profiles').update({ department: null, job_title: '督導', role: 'member' }).eq('id', uid), `profile ${key}`);
    must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    must(
      await db.from('store_managers').insert(stores.map((s, i) => ({ user_id: uid, store_id: s.id, role_type: 'supervisor', is_primary: i === 0 }))).select('id'),
      `store_managers ${key}`,
    );
  }
  return { users, teardown: () => cleanupGpe(db) };
}

export async function apiForGpe(user: GpeUser): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN, ...BYPASS_HEADERS } });
  const res = await ctx.post('/api/workspace/login', { data: { email: user.email, password: user.password } });
  if (!res.ok()) {
    await ctx.dispose();
    throw new Error(`帳號 ${user.key} 登入失敗（HTTP ${res.status()}）`);
  }
  return ctx;
}
