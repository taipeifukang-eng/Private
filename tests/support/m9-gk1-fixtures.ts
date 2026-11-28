import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { adminDb, stores } from './m5-fixtures';
import { clientForCredentials, uniqueTaxId } from './m7m8-po-fixtures';
import { makePng } from './png';

/**
 * M9-GK1（總務採購與請款改善第一批 ga-improve-b1 多角色保留資料劇本）的前置資料與清除。
 * 規則：只用 DEV、只用 VW／ZT 測試門市；全部資料名稱帶 ZTK- 前綴（廠商、料件、型號、庫存位置、買受人公司、採購單備註、需求單標題、
 * 水電帳單供應商、帳號 ztk-ga-*@example.test、臨時角色 ztk_*）。
 * 老闆要求跑完保留資料：GK1_KEEP 預設 1（不清除）；清除邏輯在 scripts/ga-improve-b1-cleanup.cjs，劇本開頭若發現上次殘留會先清除再重建。
 */
const requireNode = createRequire(path.join(__dirname, 'm9-gk1-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
export const GK1_PREFIX = 'ZTK-';
export const SHOTS_ROOT = path.join(ROOT, 'tests', 'reports', '_shots_ga_improve_b1');
export const SHOTS_DIR = path.join(SHOTS_ROOT, 'journey');
export const keepData = () => (process.env.GK1_KEEP ?? '1') !== '0';
export { adminDb, stores, uniqueTaxId };

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

/** 清除上次殘留的 ZTK- 資料（呼叫獨立清除腳本的同一個函式）。回傳殘留說明。 */
export async function cleanupGk1Data(): Promise<string[]> {
  assertDevOnly();
  const mod = requireNode(path.join(ROOT, 'scripts', 'ga-improve-b1-cleanup.cjs')) as { cleanupGk1: (log?: (m: string) => void) => Promise<string[]> };
  return mod.cleanupGk1((m) => console.log(`[m9-gk1] ${m}`));
}

export type Gk1Key = 'buyer' | 'approver' | 'accountant' | 'ubclerk' | 'store' | 'staffA' | 'staffB';
export type Gk1User = { key: Gk1Key; id: string; email: string; password: string; name: string; roles: string[]; client?: any };

const ROLE_OF: Record<Gk1Key, string[]> = {
  // 總務採購：總務基本盤（需求單、設備、庫存、型號、料件、採購三權限）加請款管理（沒有水電權限，用來驗證「水電話網費管理」的提示名稱）。
  buyer: ['vue_workspace_ga_staff', 'vue_workspace_ga45_clerk'],
  // 簽核主管：採購核准權限（不能核准自己送的單）。
  approver: ['vue_workspace_ga_po_approver'],
  // 會計（付款負責人）：採購請款付款加水電請款付款。
  accountant: ['vue_workspace_ga45_accountant', 'vue_workspace_gaup_accountant'],
  // 水電請款總務：水電管理加請款管理。
  ubclerk: ['vue_workspace_gaup_clerk'],
  // ZT01 店長：DEV 的 store_manager 角色沒有需求單權限，用自建的 ztk_store_requester。
  store: ['ztk_store_requester'],
  // 同仁甲（代墊採購）、同仁乙（門市同仁先繳電費）：只有進入總務服務中心的權限，用來登錄匯款帳戶、看自己的代墊款。
  staffA: ['ztk_staff'],
  staffB: ['ztk_staff'],
};
const NAME_OF: Record<Gk1Key, string> = {
  buyer: 'ZTK 總務採購', approver: 'ZTK 簽核主管', accountant: 'ZTK 會計', ubclerk: 'ZTK 水電總務', store: 'ZTK ZT01店長', staffA: 'ZTK 同仁甲', staffB: 'ZTK 同仁乙',
};
const STORE_PERMS = [
  'general_affairs.service_center.access', 'general_affairs.request.create', 'general_affairs.request.view_own_store',
  'general_affairs.request.comment_own_store', 'general_affairs.request.confirm_own_store',
];
const STAFF_PERMS = ['general_affairs.service_center.access'];

/** 建立測試帳號（密碼隨機，寫進 tests/reports/_shots_ga_improve_b1/journey/accounts.json，只有本機有；DEV 專用）。 */
export async function setupGk1Users(): Promise<Record<Gk1Key, Gk1User>> {
  assertDevOnly();
  const db = adminDb();
  const permsOf = async (codes: string[]) => {
    const perms = must(await db.from('permissions').select('id,code').in('code', codes), '讀取權限碼') as { id: string; code: string }[];
    if (perms.length !== codes.length) throw new Error('DEV 缺少需要的權限碼');
    return perms;
  };
  for (const [code, name, codes] of [
    ['ztk_store_requester', 'ZTK 測試店長（需求單）', STORE_PERMS],
    ['ztk_staff', 'ZTK 測試同仁（只進服務中心）', STAFF_PERMS],
  ] as [string, string, string[]][]) {
    const exists = must(await db.from('roles').select('id').eq('code', code).maybeSingle(), `查角色 ${code}`);
    if (exists) throw new Error(`${code} 角色已存在（清除沒做乾淨？）`);
    const role = must(await db.from('roles').insert({ code, name, description: 'M9-GK1 劇本用臨時角色', is_active: true, is_system: false }).select('id').single(), `建立角色 ${code}`) as { id: string };
    must(await db.from('role_permissions').insert((await permsOf(codes)).map((p) => ({ role_id: role.id, permission_id: p.id, is_allowed: true }))), `角色權限 ${code}`);
  }
  const st = await stores();
  const users = {} as Record<Gk1Key, Gk1User>;
  for (const key of Object.keys(ROLE_OF) as Gk1Key[]) {
    const email = `ztk-ga-${key.toLowerCase()}@example.test`;
    const password = `Ztk-${crypto.randomBytes(9).toString('base64url')}-9a`;
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
  for (const key of Object.keys(users) as Gk1Key[]) users[key].client = await clientForCredentials(users[key].email, users[key].password);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, 'accounts.json'), `${JSON.stringify(Object.values(users).map((u) => ({ key: u.key, email: u.email, password: u.password, name: u.name, roles: u.roles })), null, 2)}\n`);
  return users;
}

export type Gk1Seed = { vendor: any; utilityPayee: any; tpl: any; part: any; loc: any };

/** 前置資料：廠商 ZTK-MOMO、公用事業繳費單位 ZTK-台電、設備型號 ZTK-EPSON L6490、料件（對應該型號）、庫存位置 ZTK-總部倉（允許放該料件）。 */
export async function seedGk1Master(): Promise<Gk1Seed> {
  const db = adminDb();
  const vendor = must(await db.from('ga_vendors').insert({
    name: `${GK1_PREFIX}MOMO`, vendor_type: 'company', status: 'active', tax_id: uniqueTaxId(), payment_terms: '先付款後出貨（網購）', alias: 'MOMO 購物網',
    bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: 'ZTK-MOMO 測試戶名',
  }).select('*').single(), '建立廠商 ZTK-MOMO') as any;
  const cat = must(await db.from('ga_workflow_settings').select('value_text').eq('key', 'utility_payee_category_id').maybeSingle(), '讀取公用事業分類設定') as { value_text: string } | null;
  if (!cat?.value_text) throw new Error('DEV 沒有 utility_payee_category_id（先套 20261124100000_ga_utility_payment_schema）');
  const utilityPayee = must(await db.from('ga_vendors').insert({
    name: `${GK1_PREFIX}台電`, vendor_type: 'company', status: 'active', tax_id: uniqueTaxId(), service_category_ids: [cat.value_text],
    bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '000-123-456781', bank_account_name: 'ZTK-台電 測試戶名',
  }).select('*').single(), '建立繳費單位 ZTK-台電') as any;
  const eqCat = must(await db.from('ga_equipment_categories').select('id,code').eq('code', 'IC0202').is('deleted_at', null).single(), '找設備分類 IC0202') as { id: string };
  const tpl = must(await db.from('ga_equipment_templates').insert({
    category_id: eqCat.id, name: `${GK1_PREFIX}EPSON L6490`, brand: 'EPSON', model: 'L6490', specs: {}, default_fields: {}, is_active: true, default_warranty_months: 12, description: 'ZTK-連續供墨印表機（M9-GK1 劇本）',
  }).select('*').single(), '建立設備型號') as any;
  const partCat = must(await db.from('ga_part_categories').select('id,code').eq('code', 'IM01').is('deleted_at', null).single(), '找料件分類 IM01') as { id: string };
  const part = must(await db.from('ga_parts').insert({
    category_id: partCat.id, name: `${GK1_PREFIX}EPSON L6490 連續供墨印表機`, base_unit: '台', specs: {}, tags: [], is_active: true, brand: 'EPSON', model: 'L6490', equipment_template_id: tpl.id,
    notes: 'ZTK- M9-GK1 劇本用料件',
  }).select('*').single(), '建立料件') as any;
  const loc = must(await db.from('ga_inventory_locations').insert({ code: 'ZTK-HQ-WH', name: `${GK1_PREFIX}總部倉`, location_type: 'CENTRAL_WAREHOUSE', description: 'M9-GK1 劇本用總部庫存位置' }).select('*').single(), '建立庫存位置') as any;
  must(await db.from('ga_inventory_location_parts').insert({ location_id: loc.id, part_id: part.id }), '位置料件設定');
  return { vendor, utilityPayee, tpl, part, loc };
}

/** 建立一張水電帳單並附一張真的帳單照片（實體檔上傳到儲存空間、紀錄與 API 相同）。帳單以使用者身分建立。 */
export async function mkUtilityBill(client: any, uploaderId: string, over: Record<string, unknown>) {
  const { data, error } = await client.rpc('ga_ws_ub_save', { p_id: null, p_payload: { service_period_start: '2038-01-01', service_period_end: '2038-01-31', ...over }, p_expected_updated_at: null, p_confirm_paid_change: false });
  if (error) throw new Error(`建立帳單失敗：${error.message}`);
  if (!data?.ok) throw new Error(`建立帳單失敗：${JSON.stringify(data)}`);
  const bill = data.data as any;
  const id = crypto.randomUUID();
  const storagePath = `utility_bill/${bill.id}/bill_document/${id}.png`;
  const db = adminDb();
  const up = await db.storage.from('general-affairs-attachments').upload(storagePath, makePng({ width: 640, height: 420, colorful: true }), { contentType: 'image/png' });
  if (up.error) throw new Error(`上傳帳單照片失敗：${up.error.message}`);
  const r = await client.from('ga_resource_attachments').insert({
    id, resource_type: 'UTILITY_BILL', resource_id: bill.id, purpose: 'BILL_DOCUMENT', storage_path: storagePath, file_name: `${GK1_PREFIX}帳單照片.png`,
    content_type: 'image/png', size_bytes: 1000, uploaded_by: uploaderId,
  });
  if (r.error) throw new Error(`新增帳單附件 失敗：${r.error.message}`);
  return bill;
}
