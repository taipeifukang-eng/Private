import crypto from 'node:crypto';
import { adminDb, cleanupM7Users, M7_EMAIL_PREFIX, M7_ROLE_PREFIX, stores } from './m7m8-fixtures';
import { runIdOrThrow } from './m5-fixtures';
import { clientForCredentials, PERM, uniqueTaxId } from './m7m8-po-fixtures';

/**
 * G46 水電話費請款（水電帳單接進請款單）測試共用工具。
 * 帳號：m7m8-test-gaup-*（teardown 與下次 setup 開頭依標記清除，密碼隨機只存在記憶體）。
 * 角色：優先用 DEV 的真實角色（vue_workspace_gaup_*：20261124140000 建立；ga45_clerk＝有請款沒水電、purchaser＝採購角色對照）；
 *       其餘用只含指定權限的臨時角色 m7m8_test_gaup_*（cleanupM7Users 一併刪除）。權限語意與正式區一致：沒有角色勾選的權限就是沒有；profiles.role = 'admin' 不會繞過資料庫權限。
 * 資料：廠商名稱與帳單供應商名稱帶 QA-GAUP- 標記（再帶 runId），只用 VW／ZT 測試門市、帳單月份 2038（需要手動標記已繳的案例用過去月份）；
 *       請款單、明細、事件、帳單與附件由 DEV 專用函式 ga_dev_cleanup_ga_utility_payment 清除（cleanupGaup 會呼叫並刪除附件實體檔）。
 */
export const GAUP_PREFIX = 'QA-GAUP-';
export const gaupName = (suffix: string) => `${GAUP_PREFIX}${runIdOrThrow()}-${suffix}`;

export const GAUP_REAL_ROLES = {
  clerk: 'vue_workspace_gaup_clerk',
  accountant: 'vue_workspace_gaup_accountant',
  billonly: 'vue_workspace_gaup_billonly',
  payview: 'vue_workspace_gaup_payview',
  /** 第 4.5 批總務採購：有請款管理、沒有水電權限。 */
  ga45_clerk: 'vue_workspace_ga45_clerk',
  /** 第 4.5 批會計：有請款管理、沒有水電權限。 */
  ga45_accountant: 'vue_workspace_ga45_accountant',
  /** 既有採購角色（沒有請款與水電權限）。 */
  purchaser: 'vue_workspace_ga_purchaser',
} as const;

const SERVICE = PERM.serviceAccess;
export const UB_P = { view: 'general_affairs.utility_bill.view', manage: 'general_affairs.utility_bill.manage' } as const;
export const PAY_P = { view: 'general_affairs.purchase_payment.view', manage: 'general_affairs.purchase_payment.manage' } as const;

/** 臨時角色（只含指定權限）。 */
export const GAUP_TEMP = {
  /** 有水電與請款管理、沒有廠商檢視：驗證統編與銀行遮蔽。 */
  novendor: [SERVICE, UB_P.manage, UB_P.view, PAY_P.manage, PAY_P.view],
  /** 請款管理＋水電檢視（沒有水電管理）：能退回作廢、不能建立與送出。 */
  payman_ubview: [SERVICE, PAY_P.manage, PAY_P.view, UB_P.view, PERM.vendorView],
  /** 只有水電檢視。 */
  ubview: [SERVICE, UB_P.view],
  /** 只有一個無關權限。 */
  nobody: [SERVICE],
  /** 廠商管理（含檢視）：建立公用事業廠商。 */
  vendor_mgr: [SERVICE, PERM.vendorManage, PERM.vendorView],
  /** 舊式管理員：profiles.role = admin、沒有任何角色（資料庫不給繞過）。 */
  admin: [] as string[],
} satisfies Record<string, string[]>;

export type GaupKey = keyof typeof GAUP_REAL_ROLES | keyof typeof GAUP_TEMP | 'store_mgr';
export type GaupUser = { key: GaupKey; id: string; email: string; password: string; client: any };

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export async function setupGaupUsers(keys: GaupKey[]): Promise<{ users: Record<string, GaupUser>; teardown: () => Promise<string[]> }> {
  const db = adminDb();
  const left = await cleanupM7Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const allPerm = Object.values(GAUP_TEMP).flat();
  const permRows = must(await db.from('permissions').select('id,code').in('code', allPerm), '讀取權限碼') as { id: string; code: string }[];
  const permId = new Map(permRows.map((p) => [p.code, p.id]));
  const st = await stores();
  const users: Record<string, GaupUser> = {};
  for (const key of keys) {
    const email = `${M7_EMAIL_PREFIX}gaup-${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 GAUP ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: key === 'admin' ? 'admin' : 'member', job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    if (key in GAUP_REAL_ROLES) {
      const code = GAUP_REAL_ROLES[key as keyof typeof GAUP_REAL_ROLES];
      const role = must(await db.from('roles').select('id').eq('code', code).maybeSingle(), `讀取角色 ${key}`) as { id: string } | null;
      if (!role) throw new Error(`DEV 沒有角色 ${code}（先套 supabase/workspace-dev 的 20261124140000_ga_utility_payment_dev_seed 或第 4.5 批 DEV 角色）`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    } else if (key === 'store_mgr') {
      const role = must(await db.from('roles').select('id').eq('code', 'store_manager').maybeSingle(), '讀取 store_manager 角色') as { id: string } | null;
      if (!role) throw new Error('DEV 沒有 store_manager 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: st.VW001.id, role_type: 'store_manager', is_primary: true }), `store_managers ${key}`);
    } else {
      const perms = GAUP_TEMP[key as keyof typeof GAUP_TEMP];
      if (perms.length) {
        const role = must(await db.from('roles').insert({ code: `${M7_ROLE_PREFIX}gaup_${key}`, name: `M7M8 測試 gaup ${key}`, description: 'G46 水電話費請款測試臨時角色', is_active: true, is_system: false }).select('id').single(), `建立角色 ${key}`) as { id: string };
        must(await db.from('role_permissions').insert(perms.map((c) => ({ role_id: role.id, permission_id: permId.get(c), is_allowed: true }))), `角色權限 ${key}`);
        must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      }
    }
    users[key] = { key, id: uid, email, password, client: await clientForCredentials(email, password) };
  }
  return { users, teardown: () => cleanupM7Users(db) };
}

/** 清除水電請款測試資料（請款單、事件、水電明細、帳單、附件紀錄與實體檔、測試廠商）。回傳殘留說明（空陣列代表乾淨）。 */
export async function cleanupGaup(): Promise<string[]> {
  const db = adminDb();
  const log: string[] = [];
  const r = await db.rpc('ga_dev_cleanup_ga_utility_payment');
  if (r.error) {
    if (r.error.code !== 'PGRST202') log.push(`ga_dev_cleanup_ga_utility_payment: ${r.error.message}`);
    return log;
  }
  const paths: string[] = (r.data && r.data.storage_paths) || [];
  if (paths.length) {
    const rm = await db.storage.from('general-affairs-attachments').remove(paths);
    if (rm.error) log.push(`gaup storage: ${rm.error.message}`);
  }
  for (const [table, col] of [['ga_vendors', 'name'], ['ga_utility_bills', 'provider_name']] as const) {
    const left = await db.from(table).select('id', { count: 'exact', head: true }).like(col, `${GAUP_PREFIX}%`);
    if (left.error) log.push(`${table}: ${left.error.message}`);
    else if (left.count) log.push(`${table} 殘留 ${left.count} 筆`);
  }
  return log;
}

// ------------------------------------------------------------------ 種子資料
let seq = 0;
/** 公用事業分類 id（設定鍵 utility_payee_category_id）。 */
export async function utilityCategoryId(): Promise<string> {
  const r = must(await adminDb().from('ga_workflow_settings').select('value_text').eq('key', 'utility_payee_category_id').maybeSingle(), '讀取公用事業分類設定') as { value_text: string } | null;
  if (!r?.value_text) throw new Error('DEV 沒有 utility_payee_category_id（先套 20261124100000_ga_utility_payment_schema）');
  return r.value_text;
}

/** 公用事業繳費單位（以 service role 直接寫入；名稱帶標記、統編不重複、預設有一組銀行資料；預設掛公用事業分類）。 */
export async function seedPayee(suffix: string, over: Record<string, unknown> = {}) {
  const cat = await utilityCategoryId();
  return must(
    await adminDb().from('ga_vendors').insert({
      name: gaupName(`P-${suffix}${(seq += 1)}`), vendor_type: 'company', status: 'active', tax_id: uniqueTaxId(), service_category_ids: [cat],
      bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試戶名', ...over,
    }).select('*').single(),
    `建立繳費單位 ${suffix}`,
  ) as any;
}

/** 台北今天（YYYY-MM-DD）。 */
export function todayIso(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
/** 往前推 n 個月的月份 1 日（YYYY-MM-01）。 */
export function pastMonth(months: number): string {
  const d = new Date(`${todayIso().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months, 1);
  return d.toISOString().slice(0, 10);
}

export type BillOver = Record<string, unknown>;
/** 帳單 payload：預設 VW001、電費、2038-03、帶標記供應商與唯一電號、金額 1000；payee_vendor_id 由呼叫端指定。 */
export function billPayload(over: BillOver = {}) {
  return {
    store_id: undefined as string | undefined, expense_type: 'ELECTRICITY', billing_month: '2038-03', provider_name: gaupName('PRV'),
    service_identifier: `QA-GAUP-${String(Date.now()).slice(-6)}-${String((seq += 1)).padStart(4, '0')}`, amount: 1000, ...over,
  };
}
/** 建立帳單（走 ga_ws_ub_save，以使用者身分）。 */
export async function mkBill(client: any, over: BillOver = {}) {
  const st = await stores();
  const { data, error } = await client.rpc('ga_ws_ub_save', { p_id: null, p_payload: { ...billPayload(over), store_id: (over.store_id as string) ?? st.VW001.id }, p_expected_updated_at: null, p_confirm_paid_change: false });
  if (error) throw new Error(`建立帳單失敗：${error.message}`);
  if (!data?.ok) throw new Error(`建立帳單失敗：${JSON.stringify(data)}`);
  return data.data as any;
}
/** 為帳單補一個附件紀錄（以使用者身分寫入，與 API 相同；實體檔不上傳，只為資料庫層的「至少一個附件」檢查）。回傳附件 id。 */
export async function addBillAttachment(client: any, billId: string, uploaderId: string): Promise<string> {
  const id = crypto.randomUUID();
  const r = await client.from('ga_resource_attachments').insert({
    id, resource_type: 'UTILITY_BILL', resource_id: billId, purpose: 'BILL_DOCUMENT', storage_path: `utility_bill/${billId}/bill_document/${id}.png`, file_name: `m7m8t-${id}.png`,
    content_type: 'image/png', size_bytes: 100, uploaded_by: uploaderId,
  });
  if (r.error) throw new Error(`新增帳單附件 失敗：${r.error.message}`);
  return id;
}
/** 標記刪除附件（與 API 相同，走 ga_soft_delete_resource_attachment）；回傳 RPC 結果。 */
export async function softDeleteAttachment(client: any, id: string, reason = '測試刪除') {
  return client.rpc('ga_soft_delete_resource_attachment', { p_attachment_id: id, p_reason: reason });
}
export { uniqueTaxId };
