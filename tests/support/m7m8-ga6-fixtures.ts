import crypto from 'node:crypto';
import { adminDb, cleanupM7Users, M7_EMAIL_PREFIX, M7_ROLE_PREFIX, stores, GA6_PREFIX, ga6Name } from './m7m8-fixtures';
import { clientForCredentials, PERM } from './m7m8-po-fixtures';
import { runIdOrThrow } from './m5-fixtures';
import { taxIdChecksumOk } from '../../lib/workspace/general-affairs/vendor-rules';

/**
 * M7/M8 第 6 批（G20 服務分類與區域、G21 廠商資料）測試共用工具。
 * 帳號：m7m8-test-ga6-*（teardown 與下次 setup 開頭依標記清除，密碼隨機只存在記憶體）。
 * 角色：優先用 DEV 的真實角色（vue_workspace_ga6_*：第 6 批 130000 建立；vue_workspace_ga_vendor_view：既有，只有 vendor.view；store_manager：真正店長角色），
 *       其餘用只含指定權限的臨時角色 m7m8_test_ga6_*（cleanupM7Users 一併刪除）。權限語意與正式區一致：沒有角色勾選的權限就是沒有；profiles.role = 'admin' 不會繞過資料庫權限。
 * 資料：廠商、分類、區域名稱與代碼帶 QA-GA6- 標記（cleanupM7M8 只清這些）。
 */
export { GA6_PREFIX, ga6Name };
/** 分類／區域代碼：QA-GA6-<runId 去連字號>-<後綴>，全大寫、最長 30 字（後綴最多 9 字）。 */
export const ga6Code = (suffix: string) => `${GA6_PREFIX}${runIdOrThrow().replace('-', '')}-${suffix}`.toUpperCase();

export const REAL_ROLES = {
  vendor_mgr: 'vue_workspace_ga6_vendor_mgr',
  cat_only: 'vue_workspace_ga6_cat_only',
  coop_only: 'vue_workspace_ga6_coop_only',
  util_mgr: 'vue_workspace_ga6_util_mgr',
  util_view: 'vue_workspace_ga6_util_view',
  ga_all: 'vue_workspace_ga6_ga_all',
  vendor_view: 'vue_workspace_ga_vendor_view',
} as const;

/** 臨時角色（只含指定權限）。 */
export const TEMP_ACCOUNTS = {
  /** 採購人員：採購評估管理＋庫存交易管理＋料件查看，沒有任何廠商權限（需求單採購評估頁下拉要靠 vendor-options）。 */
  purchaser: [PERM.reviewManage, PERM.txnManage, PERM.partView],
  /** 工務：工單更新＋看全部，沒有廠商權限。 */
  wo_works: [PERM.woUpdate, PERM.woViewAll],
  /** 只有需求單管理。 */
  rq_manager: [PERM.requestManage],
  /** 只有採購核准。 */
  approver: [PERM.approve],
  /** 只有分類與區域管理（沒有廠商權限）。 */
  svc_mgr: ['general_affairs.service_category.view', 'general_affairs.service_category.manage', 'general_affairs.service_region.view', 'general_affairs.service_region.manage'],
  /** 只有廠商管理（沒有 view）：管理隱含查看。 */
  vendor_manage_only: [PERM.vendorManage],
  /** 一個無關權限（只有服務中心入口）。 */
  nobody: [PERM.serviceAccess],
  /** 舊式管理員：profiles.role = admin、沒有任何角色（資料庫不給繞過）。 */
  admin: [] as string[],
} satisfies Record<string, string[]>;

export type Ga6Key = keyof typeof REAL_ROLES | keyof typeof TEMP_ACCOUNTS | 'store_mgr';
export type Ga6User = { key: Ga6Key; id: string; email: string; password: string; client: any };

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export async function setupGa6Users(keys: Ga6Key[]): Promise<{ users: Record<string, Ga6User>; teardown: () => Promise<string[]> }> {
  const db = adminDb();
  const left = await cleanupM7Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const allPerm = Object.values(TEMP_ACCOUNTS).flat();
  const permRows = must(await db.from('permissions').select('id,code').in('code', allPerm), '讀取權限碼') as { id: string; code: string }[];
  const permId = new Map(permRows.map((p) => [p.code, p.id]));
  const st = await stores();
  const users: Record<string, Ga6User> = {};
  for (const key of keys) {
    const email = `${M7_EMAIL_PREFIX}ga6-${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 GA6 ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: key === 'admin' ? 'admin' : 'member', job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    if (key in REAL_ROLES) {
      const role = must(await db.from('roles').select('id').eq('code', REAL_ROLES[key as keyof typeof REAL_ROLES]).maybeSingle(), `讀取角色 ${key}`) as { id: string } | null;
      if (!role) throw new Error(`DEV 沒有角色 ${REAL_ROLES[key as keyof typeof REAL_ROLES]}（先套 20261118130000_m7m8_b6_dev_seed）`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    } else if (key === 'store_mgr') {
      const role = must(await db.from('roles').select('id').eq('code', 'store_manager').maybeSingle(), '讀取 store_manager 角色') as { id: string } | null;
      if (!role) throw new Error('DEV 沒有 store_manager 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: st.VW001.id, role_type: 'store_manager', is_primary: true }), `store_managers ${key}`);
    } else {
      const perms = TEMP_ACCOUNTS[key as keyof typeof TEMP_ACCOUNTS];
      if (perms.length) {
        const role = must(await db.from('roles').insert({ code: `${M7_ROLE_PREFIX}ga6_${key}`, name: `M7M8 測試 ga6 ${key}`, description: 'M7M8 第 6 批測試臨時角色', is_active: true, is_system: false }).select('id').single(), `建立角色 ${key}`) as { id: string };
        must(await db.from('role_permissions').insert(perms.map((c) => ({ role_id: role.id, permission_id: permId.get(c), is_allowed: true }))), `角色權限 ${key}`);
        must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      }
    }
    users[key] = { key, id: uid, email, password, client: await clientForCredentials(email, password) };
  }
  return { users, teardown: () => cleanupM7Users(db) };
}

/** 測試廠商（以 service role 直接寫入，前置資料；統編預設放可通過檢查碼的 04595257，名稱帶標記；API 的新增另有專門測試）。 */
export async function seedGa6Vendor(suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_vendors').insert({ name: ga6Name(`V-${suffix}`), vendor_type: 'company', status: 'active', tax_id: null, ...over }).select('*').single(),
    `建立測試廠商 ${suffix}`,
  ) as any;
}

/** 隨機且不會與 DEV 既有資料重複的 8 碼統編（只用在本次測試）。 */
export function randomTaxId(): string {
  return String(Math.floor(10000000 + Math.random() * 89999999));
}

/** 產生通過檢查碼的 8 碼統編（本次測試專用，重試到沒有重複為止）。 */
export async function freshValidTaxId(): Promise<string> {
  for (let i = 0; i < 2000; i += 1) {
    const t = randomTaxId();
    if (!taxIdChecksumOk(t)) continue;
    const r = await adminDb().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', t);
    if (!r.error && !r.count) return t;
  }
  throw new Error('找不到可用的測試統編');
}
export async function freshInvalidTaxId(): Promise<string> {
  for (let i = 0; i < 2000; i += 1) {
    const t = randomTaxId();
    if (taxIdChecksumOk(t)) continue;
    const r = await adminDb().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('tax_id', t);
    if (!r.error && !r.count) return t;
  }
  throw new Error('找不到可用的測試統編');
}

/** 台灣縣市行政區固定資料（來源 migration 檔）涵蓋的 code 數量，供對照。 */
export const SECRET_FIELDS = ['tax_id', 'billing_title', 'billing_address', 'invoice_type', 'payment_terms', 'payment_methods', 'accounting_notes', 'total_amount'] as const;
