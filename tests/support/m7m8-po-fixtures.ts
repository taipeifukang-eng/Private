import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { adminDb, cleanupM7Users, M7_EMAIL_PREFIX, M7_ROLE_PREFIX, m7Name, stores } from './m7m8-fixtures';

/**
 * M7/M8 第 4 批（G25 採購單）測試共用工具：採購與核准的測試帳號（每個帳號掛一個只含指定權限的臨時角色 m7m8_test_po_*）、供應商與需求單種子。
 * 帳號與角色都帶 m7m8-test-／m7m8_test_ 前綴，teardown 與下次 setup 開頭依標記清除（cleanupM7Users）；密碼隨機、只存在記憶體。
 * 權限語意與正式區一致：沒有任何角色勾選的權限就是沒有；profiles.role = 'admin' 不會繞過資料庫權限（admin 帳號用來驗證「管理員不繞過」）。
 */
const requireNode = createRequire(path.join(__dirname, 'm7m8-po-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');

export const PERM = {
  reviewManage: 'general_affairs.purchase_review.manage',
  reviewView: 'general_affairs.purchase_review.view',
  txnManage: 'general_affairs.inventory_transaction.manage',
  partView: 'general_affairs.part.view',
  partManage: 'general_affairs.part.manage',
  approve: 'general_affairs.purchase_order.approve',
  vendorView: 'general_affairs.vendor.view',
  vendorManage: 'general_affairs.vendor.manage',
  equipmentManage: 'general_affairs.equipment.manage',
  // 第 4 批 G14 至 G17：需求單與料件處理單
  requestCreate: 'general_affairs.request.create',
  requestManage: 'general_affairs.request.manage',
  requestViewAll: 'general_affairs.request.view_all',
  requestViewOwn: 'general_affairs.request.view_own_store',
  requestCommentOwn: 'general_affairs.request.comment_own_store',
  requestConfirmOwn: 'general_affairs.request.confirm_own_store',
  fulfillView: 'general_affairs.part_fulfillment.view',
  fulfillManage: 'general_affairs.part_fulfillment.manage',
} as const;
const THREE = [PERM.reviewManage, PERM.txnManage, PERM.partView];

/** 帳號 → 權限。purchaser 是標準採購（三個權限，沒有廠商檢視）；approver 只有核准與採購評估檢視。 */
export const PO_ACCOUNTS = {
  purchaser: THREE,
  purchaser2: THREE,
  purchaser_vendor: [...THREE, PERM.vendorView],
  purchaser_vendor_manage: [...THREE, PERM.vendorManage],
  approver: [PERM.approve, PERM.reviewView],
  approver2: [PERM.approve],
  purchaser_approver: [...THREE, PERM.approve],
  review_only: [PERM.reviewManage],
  stock_only: [PERM.txnManage],
  part_only: [PERM.partView],
  no_partview: [PERM.reviewManage, PERM.txnManage],
  no_review: [PERM.txnManage, PERM.partView],
  no_txn: [PERM.reviewManage, PERM.partView],
  part_manage: [PERM.reviewManage, PERM.txnManage, PERM.partManage],
  viewer: [PERM.reviewView],
  nobody: [] as string[],
  admin: [] as string[],
  // 第 4 批 G26：設備管理權限（序號補填）、門市店長（只有名單身分，沒有任何權限；A = VW001、B = ZT01）
  eq_manage: [PERM.equipmentManage],
  purchaser_eq: [...THREE, PERM.equipmentManage],
  storemgr_a: [] as string[],
  storemgr_b: [] as string[],
  // 第 4 批 G14 至 G17：總務（需求單與處理單管理＋採購三權限＋採購評估查看）、只有需求單管理（沒有採購與庫存權限）、只能看全部、門市店長（A = VW001、B = ZT01）、只能看自己門市、只有建立權限但不在任何門市名單
  rq_staff: [PERM.requestManage, PERM.requestViewAll, PERM.requestViewOwn, PERM.requestCreate, PERM.fulfillManage, PERM.fulfillView, ...THREE, PERM.reviewView],
  rq_manage_only: [PERM.requestManage],
  rq_view_all: [PERM.requestViewAll],
  rq_store_a: [PERM.requestCreate, PERM.requestViewOwn, PERM.requestCommentOwn, PERM.requestConfirmOwn],
  rq_store_b: [PERM.requestCreate, PERM.requestViewOwn, PERM.requestCommentOwn, PERM.requestConfirmOwn],
  rq_store_viewonly: [PERM.requestViewOwn],
  rq_create_nostore: [PERM.requestCreate],
  ful_view: [PERM.fulfillView],
  ful_manage_only: [PERM.fulfillManage],
} satisfies Record<string, string[]>;
export type PoKey = keyof typeof PO_ACCOUNTS;

export type PoUser = { key: PoKey; id: string; email: string; password: string; client: any };

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

function envForTest(): Record<string, string> {
  const guard = requireNode('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  return guard.assertDevEnvironment({ root: ROOT }).env;
}

/** 以帳號密碼登入的 Supabase 客戶端（anon key + 該帳號 JWT），用來直接呼叫 ga_ws_* 函式。 */
export async function clientForCredentials(email: string, password: string): Promise<any> {
  const env = envForTest();
  const { createClient } = requireNode('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(`測試帳號登入失敗（${login.error.message}）`);
  return client;
}

/** 沒有登入的客戶端（只有 anon key）。 */
export function anonClient(): any {
  const env = envForTest();
  const { createClient } = requireNode('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function setupPoUsers(keys: PoKey[]): Promise<{ users: Record<string, PoUser>; teardown: () => Promise<string[]> }> {
  const db = adminDb();
  const left = await cleanupM7Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const permRows = must(await db.from('permissions').select('id,code').in('code', Object.values(PERM)), '讀取權限碼') as { id: string; code: string }[];
  const permId = new Map(permRows.map((p) => [p.code, p.id]));
  for (const code of Object.values(PERM)) if (!permId.has(code)) throw new Error(`DEV 缺少權限碼 ${code}（先套 20261112110000_m7m8_b4_purchase_orders）`);
  const users: Record<string, PoUser> = {};
  for (const key of keys) {
    const email = `${M7_EMAIL_PREFIX}po-${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 PO ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: key === 'admin' ? 'admin' : 'member', job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    const perms = PO_ACCOUNTS[key];
    if (perms.length) {
      const role = must(await db.from('roles').insert({ code: `${M7_ROLE_PREFIX}po_${key}`, name: `M7M8 測試 ${key}`, description: 'M7M8 第 4 批測試臨時角色', is_active: true, is_system: false }).select('id').single(), `建立角色 ${key}`) as { id: string };
      must(await db.from('role_permissions').insert(perms.map((c) => ({ role_id: role.id, permission_id: permId.get(c), is_allowed: true }))), `角色權限 ${key}`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    }
    if (key === 'storemgr_a' || key === 'storemgr_b' || key === 'rq_store_a' || key === 'rq_store_b' || key === 'rq_store_viewonly') {
      const st = await stores();
      const vw = key === 'storemgr_a' || key === 'rq_store_a' || key === 'rq_store_viewonly';
      must(await db.from('store_managers').insert({ user_id: uid, store_id: (vw ? st.VW001 : st.ZT01).id, role_type: 'store_manager', is_primary: true }), `store_managers ${key}`);
    }
    users[key] = { key, id: uid, email, password, client: await clientForCredentials(email, password) };
  }
  return { users, teardown: () => cleanupM7Users(db) };
}

// ------------------------------------------------------------------ 種子資料
/** 供應商（ga_vendors）：名稱帶標記，cleanup 以名稱清除。 */
export async function seedVendor(suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_vendors').insert({ name: m7Name(`V-${suffix}`), vendor_type: 'company', status: 'active', tax_id: '12345678', payment_terms: '月結 30 天', ...over }).select('*').single(),
    `建立供應商 ${suffix}`,
  ) as any;
}

/** 需求單（可指定需求量與單位、類型、狀態）。 */
export async function seedRequest(storeId: string, userId: string, suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_service_requests').insert({
      store_id: storeId, created_by: userId, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name(suffix), description: 'm7m8 採購單測試', resource_type: 'PART',
      desired_quantity: 10, main_status: 'IN_PROGRESS', ...over,
    }).select('*').single(),
    `建立需求單 ${suffix}`,
  ) as any;
}

/** 採購評估（要有 decision）。 */
export async function seedReview(requestId: string, userId: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_purchase_reviews').insert({ request_id: requestId, decision: 'PURCHASE', created_by: userId, ...over }).select('*').single(),
    '建立採購評估',
  ) as any;
}

/** 目前的台北日期 YYYYMMDD（單號前綴）。 */
export function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (k: string) => parts.find((p) => p.type === k)?.value || '';
  return `${g('year')}${g('month')}${g('day')}`;
}
