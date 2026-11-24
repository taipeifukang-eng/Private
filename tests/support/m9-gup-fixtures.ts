import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { adminDb, stores } from './m5-fixtures';

/**
 * M9-GUP（水電話費請款 e2e 劇本）的前置資料與清除。
 * 規則：只用 DEV、只用 ZT 測試門市；全部資料名稱帶 ZTU- 前綴（繳費單位廠商、帳單供應商、帳號 ztu-ga-*@example.test）。
 * 老闆要求跑完保留資料：GUP_KEEP 預設 1（不清除）；清除邏輯在 scripts/ga-ub-pay-cleanup.cjs，劇本開頭若發現上次殘留會先清除再重建。
 * 帳號不建臨時角色，直接用 DEV 既有的角色：總務＝vue_workspace_gaup_clerk（水電管理、請款管理）＋vue_workspace_ga_vendor_manager（廠商管理）；會計＝vue_workspace_gaup_accountant。
 */
const requireNode = createRequire(path.join(__dirname, 'm9-gup-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
export const GUP_PREFIX = 'ZTU-';
export const SHOTS_ROOT = path.join(ROOT, 'tests', 'reports', '_shots_ga_ub_pay');
export const SHOTS_DIR = path.join(SHOTS_ROOT, 'journey');
export const keepData = () => (process.env.GUP_KEEP ?? '1') !== '0';
export { adminDb, stores };

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

/** DEV 守衛：supabase CLI 連結的專案與環境的專案 ref 都必須以 mjpd 開頭。 */
export function assertDevOnly() {
  const guard = requireNode('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const linked = fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();
  if (!ref.startsWith('mjpd') || !linked.startsWith('mjpd')) throw new Error('不是 DEV 專案（ref 不是 mjpd 開頭），停止');
}

/** 清除上次殘留的 ZTU- 資料（呼叫獨立清除腳本的同一個函式）。回傳殘留說明。 */
export async function cleanupGupData(): Promise<string[]> {
  assertDevOnly();
  const mod = requireNode(path.join(ROOT, 'scripts', 'ga-ub-pay-cleanup.cjs')) as { cleanupGup: (log?: (m: string) => void) => Promise<string[]> };
  return mod.cleanupGup((m) => console.log(`[ga-ub-pay] ${m}`));
}

export type GupKey = 'clerk' | 'accountant';
export type GupUser = { key: GupKey; id: string; email: string; password: string; name: string; roles: string[] };

const ROLE_OF: Record<GupKey, string[]> = {
  clerk: ['vue_workspace_gaup_clerk', 'vue_workspace_ga_vendor_manager'],
  accountant: ['vue_workspace_gaup_accountant'],
};
const NAME_OF: Record<GupKey, string> = { clerk: 'ZTU 總務（水電請款）', accountant: 'ZTU 會計' };

/** 建立兩個測試帳號（密碼隨機，寫進 tests/reports/_shots_ga_ub_pay/accounts.json，只有本機有；DEV 專用）。 */
export async function setupGupUsers(): Promise<Record<GupKey, GupUser>> {
  assertDevOnly();
  const db = adminDb();
  const users = {} as Record<GupKey, GupUser>;
  for (const key of Object.keys(ROLE_OF) as GupKey[]) {
    const email = `ztu-ga-${key}@example.test`;
    const password = `Ztu-${crypto.randomBytes(9).toString('base64url')}-9a`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: NAME_OF[key] } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: 'member', job_title: '測試', department: null, full_name: NAME_OF[key] }).eq('id', uid), `profile ${key}`);
    for (const code of ROLE_OF[key]) {
      const r = must(await db.from('roles').select('id').eq('code', code).maybeSingle(), `讀取角色 ${code}`) as { id: string } | null;
      if (!r) throw new Error(`DEV 沒有角色 ${code}`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: r.id, is_active: true }), `user_roles ${key}`);
    }
    users[key] = { key, id: uid, email, password, name: NAME_OF[key], roles: ROLE_OF[key] };
  }
  fs.mkdirSync(SHOTS_ROOT, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_ROOT, 'accounts.json'), `${JSON.stringify(Object.values(users).map((u) => ({ key: u.key, email: u.email, password: u.password, name: u.name, roles: u.roles })), null, 2)}\n`);
  return users;
}
