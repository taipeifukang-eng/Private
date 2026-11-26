import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { adminDb, stores } from './m5-fixtures';

/**
 * M9-GAJ（總務印表機採購到配發 e2e 劇本）的前置資料與清除。
 * 規則：只用 DEV、只用 VW／ZT 測試門市；全部資料名稱帶 ZTJ- 前綴（廠商、料件、型號、庫存位置、採購單備註、需求單標題、帳號 ztj-*@example.test、臨時角色 ztj_*）。
 * 老闆要求跑完保留資料：GAJ_KEEP 預設 1（不清除）；清除邏輯在 scripts/m9-gaj-cleanup.cjs，劇本開頭若發現上次殘留會先清除再重建。
 */
const requireNode = createRequire(path.join(__dirname, 'm9-gaj-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
export const GAJ_PREFIX = 'ZTJ-';
export const SHOTS_DIR = path.join(ROOT, 'tests', 'reports', '_shots_ga_journey');
export const keepData = () => (process.env.GAJ_KEEP ?? '1') !== '0';
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

/** 清除上次殘留的 ZTJ- 資料（呼叫獨立清除腳本的同一個函式）。回傳殘留說明。 */
export async function cleanupGajData(): Promise<string[]> {
  assertDevOnly();
  const mod = requireNode(path.join(ROOT, 'scripts', 'm9-gaj-cleanup.cjs')) as { cleanupGaj: (log?: (m: string) => void) => Promise<string[]> };
  return mod.cleanupGaj((m) => console.log(`[m9-gaj] ${m}`));
}

export type GajKey = 'buyer' | 'accountant' | 'reviewer' | 'store';
export type GajUser = { key: GajKey; id: string; email: string; password: string; name: string; roles: string[] };

const ROLE_OF: Record<GajKey, string[]> = {
  // 總務採購：總務基本盤（需求單、設備、庫存、型號、料件、採購三權限）加請款管理（採購三權限與廠商檢視也在 ga45_clerk 內）。
  buyer: ['vue_workspace_ga_staff', 'vue_workspace_ga45_clerk'],
  // 會計（付款負責人）。
  accountant: ['vue_workspace_ga45_accountant'],
  // 另一位持設備管理權限的總務（貼標複核，避免建立者自己複核）。
  reviewer: ['vue_workspace_ga_staff'],
  // ZT01 店長（代替南港店）：DEV 的 store_manager 角色沒有需求單權限，用本劇本自建的 ztj_store_requester。
  store: ['ztj_store_requester'],
};
const NAME_OF: Record<GajKey, string> = { buyer: 'ZTJ 總務採購', accountant: 'ZTJ 會計', reviewer: 'ZTJ 總務複核', store: 'ZTJ ZT01店長' };
const STORE_PERMS = [
  'general_affairs.service_center.access', 'general_affairs.request.create', 'general_affairs.request.view_own_store',
  'general_affairs.request.comment_own_store', 'general_affairs.request.confirm_own_store',
];

/** 建立四個測試帳號（密碼隨機，寫進 tests/reports/_shots_ga_journey/accounts.json，只有本機有；DEV 專用）。 */
export async function setupGajUsers(): Promise<Record<GajKey, GajUser>> {
  assertDevOnly();
  const db = adminDb();
  const exists = must(await db.from('roles').select('id').eq('code', 'ztj_store_requester').maybeSingle(), '查角色 ztj_store_requester');
  if (exists) throw new Error('ztj_store_requester 角色已存在（清除沒做乾淨？）');
  const perms = must(await db.from('permissions').select('id,code').in('code', STORE_PERMS), '讀取權限碼') as { id: string; code: string }[];
  if (perms.length !== STORE_PERMS.length) throw new Error('DEV 缺少店長需求單權限碼');
  const role = must(await db.from('roles').insert({ code: 'ztj_store_requester', name: 'ZTJ 測試店長（需求單）', description: 'M9-GAJ 劇本用臨時角色', is_active: true, is_system: false }).select('id').single(), '建立角色') as { id: string };
  must(await db.from('role_permissions').insert(perms.map((p) => ({ role_id: role.id, permission_id: p.id, is_allowed: true }))), '角色權限');
  const st = await stores();
  const users = {} as Record<GajKey, GajUser>;
  for (const key of Object.keys(ROLE_OF) as GajKey[]) {
    const email = `ztj-ga-${key}@example.test`;
    const password = `Ztj-${crypto.randomBytes(9).toString('base64url')}-9a`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: NAME_OF[key] } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: 'member', job_title: '測試', department: null, full_name: NAME_OF[key] }).eq('id', uid), `profile ${key}`);
    for (const code of ROLE_OF[key]) {
      const r = must(await db.from('roles').select('id').eq('code', code).maybeSingle(), `讀取角色 ${code}`) as { id: string } | null;
      if (!r) throw new Error(`DEV 沒有角色 ${code}`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: r.id, is_active: true }), `user_roles ${key}`);
    }
    if (key === 'store') must(await db.from('store_managers').insert({ user_id: uid, store_id: st.ZT01.id, role_type: 'store_manager', is_primary: true }), 'store_managers');
    users[key] = { key, id: uid, email, password, name: NAME_OF[key], roles: ROLE_OF[key] };
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, 'accounts.json'), `${JSON.stringify(Object.values(users).map((u) => ({ key: u.key, email: u.email, password: u.password, name: u.name, roles: u.roles })), null, 2)}\n`);
  return users;
}

export type GajSeed = { vendor: any; tpl: any; part: any; loc: any };

/** 前置資料：廠商 ZTJ-MOMO、設備型號 ZTJ-EPSON L6490（噴墨印表機 IC0202）、料件（對應該型號）、庫存位置 ZTJ-總部倉（允許放該料件）。 */
export async function seedGajMaster(): Promise<GajSeed> {
  const db = adminDb();
  const taxId = String(90000000 + Math.floor(Math.random() * 9999999));
  const vendor = must(await db.from('ga_vendors').insert({
    name: `${GAJ_PREFIX}MOMO`, vendor_type: 'company', status: 'active', tax_id: taxId, payment_terms: '先付款後出貨（網購）', alias: 'MOMO 購物網',
    bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: 'ZTJ-MOMO 測試戶名',
  }).select('*').single(), '建立廠商 ZTJ-MOMO') as any;
  const cat = must(await db.from('ga_equipment_categories').select('id,code').eq('code', 'IC0202').is('deleted_at', null).single(), '找設備分類 IC0202') as { id: string };
  const tpl = must(await db.from('ga_equipment_templates').insert({
    category_id: cat.id, name: `${GAJ_PREFIX}EPSON L6490`, brand: 'EPSON', model: 'L6490', specs: {}, default_fields: {}, is_active: true, default_warranty_months: 12, description: 'ZTJ-連續供墨印表機（M9-GAJ 劇本）',
  }).select('*').single(), '建立設備型號') as any;
  const partCat = must(await db.from('ga_part_categories').select('id,code').eq('code', 'IM01').is('deleted_at', null).single(), '找料件分類 IM01') as { id: string };
  const part = must(await db.from('ga_parts').insert({
    category_id: partCat.id, name: `${GAJ_PREFIX}EPSON L6490 連續供墨印表機`, base_unit: '台', specs: {}, tags: [], is_active: true, brand: 'EPSON', model: 'L6490', equipment_template_id: tpl.id,
    notes: 'ZTJ- M9-GAJ 劇本用料件',
  }).select('*').single(), '建立料件') as any;
  const loc = must(await db.from('ga_inventory_locations').insert({ code: 'ZTJ-HQ-WH', name: `${GAJ_PREFIX}總部倉`, location_type: 'CENTRAL_WAREHOUSE', description: 'M9-GAJ 劇本用總部庫存位置' }).select('*').single(), '建立庫存位置') as any;
  must(await db.from('ga_inventory_location_parts').insert({ location_id: loc.id, part_id: part.id }), '位置料件設定');
  return { vendor, tpl, part, loc };
}
