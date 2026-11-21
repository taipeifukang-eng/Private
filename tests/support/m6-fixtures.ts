import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { adminDb, apiForUser, runIdOrThrow, stores, type M5User } from './m5-fixtures';

/**
 * M6（第一批 W25 盤點、P07 關係會員）測試共用工具。
 * 規則：只用 DEV、只用 VW/ZT 測試門市、銷售日期一律年度 2038；關係會員姓名帶 ZT + runId、匯入檔名帶 m6p07-<runId>，
 * 測試只刪「自己建立（帶標記）」的資料；sweeper 以同一標記作後備（sweep-targets.cjs）。
 * 臨時帳號 m6-test-*、臨時角色 m6_test_*（前綴已查過不與 tests/fixtures/role-matrix.json 的 vue_workspace_* 或 DEV roles 表既有代碼撞名）。
 */
export { adminDb, apiForUser, stores, runIdOrThrow };
export type M6User = M5User;
export const M6_EMAIL_PREFIX = 'm6-test-';
export const M6_ROLE_PREFIX = 'm6_test_';
export const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'm6');
export const fixtureFile = (name: string) => path.join(FIXTURE_DIR, name);
export const fixtureBytes = (name: string) => fs.readFileSync(fixtureFile(name));

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export type M6Scenario = { desc: string; perms: string[]; profileRole: 'member' | 'manager' | 'admin' };
export const M6_SCENARIOS: Record<string, M6Scenario> = {
  // 關係會員「核可」單獨權限（role-matrix 沒有 approve 的單獨帳號）
  rel_approve: { desc: '只有關係會員核可權限', perms: ['relationship_member.approve'], profileRole: 'member' },
};

export async function cleanupM6Users(db: any = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${M6_EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  const { data: roles } = await db.from('roles').select('id').like('code', `${M6_ROLE_PREFIX}%`);
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
      if (u.email && u.email.startsWith(M6_EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (users.length < 200) break;
  }
  return log;
}

export async function setupM6Users(keys: string[] = Object.keys(M6_SCENARIOS)): Promise<{ users: Record<string, M6User>; teardown: () => Promise<string[]> }> {
  runIdOrThrow();
  const db = adminDb();
  const left = await cleanupM6Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const codes = Array.from(new Set(keys.flatMap((k) => M6_SCENARIOS[k].perms)));
  const permIds: Record<string, string> = {};
  if (codes.length) for (const p of must(await db.from('permissions').select('id,code').in('code', codes), '讀取 permissions') as any[]) permIds[p.code] = p.id;
  for (const c of codes) if (!permIds[c]) throw new Error(`DEV 缺少權限 ${c}`);
  const users: Record<string, M6User> = {};
  for (const key of keys) {
    const sc = M6_SCENARIOS[key];
    const role = must(await db.from('roles').insert({ name: `M6 Test ${key}`, code: `${M6_ROLE_PREFIX}${key}`, description: 'm6 test role', is_system: false, is_active: true }).select('id').single(), `建立角色 ${key}`) as { id: string };
    if (sc.perms.length) must(await db.from('role_permissions').insert(sc.perms.map((c) => ({ role_id: role.id, permission_id: permIds[c], is_allowed: true }))), `角色權限 ${key}`);
    const email = `${M6_EMAIL_PREFIX}${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M6 ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    users[key] = { key, id: uid, email, password };
    must(await db.from('profiles').update({ role: sc.profileRole, job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
  }
  return { users, teardown: () => cleanupM6Users(db) };
}

/** 清除本測試匯入的銷售批次（檔名 m6p07-<runId>…，明細 cascade）與關係會員（姓名 ZT<runId>…）。 */
export async function cleanupM6Relationships(runId: string = runIdOrThrow(), db: any = adminDb()): Promise<void> {
  await db.from('relationship_sales_imports').delete().like('file_name', `m6p07-${runId}%`);
  await db.from('relationship_members').delete().like('member_name', `ZT${runId}%`);
}
export const salesFileName = (tag: string) => `m6p07-${runIdOrThrow()}-${tag}.xlsx`;
export const memberName = (tag: string) => `ZT${runIdOrThrow()}-${tag}`;
