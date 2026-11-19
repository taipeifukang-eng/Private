import crypto from 'node:crypto';
import { adminDb, cleanupM7Users, M7_EMAIL_PREFIX, M7_ROLE_PREFIX, stores, ga45Name, GA45_PREFIX, m7Name } from './m7m8-fixtures';
import { clientForCredentials, PERM, uniqueTaxId } from './m7m8-po-fixtures';

/**
 * M7/M8 第 4.5 批（G45 進貨憑證、發票、請款單）測試共用工具。
 * 帳號：m7m8-test-ga45-*（teardown 與下次 setup 開頭依標記清除，密碼隨機只存在記憶體）。
 * 角色：優先用 DEV 的真實角色（vue_workspace_ga45_*：20261119145000 建立；vue_workspace_ga_purchaser：既有的採購角色，對照組）；
 *       其餘用只含指定權限的臨時角色 m7m8_test_ga45_*（cleanupM7Users 一併刪除）。權限語意與正式區一致：沒有角色勾選的權限就是沒有；profiles.role = 'admin' 不會繞過資料庫權限。
 * 資料：廠商名稱帶 QA-GA45- 標記，採購單備註帶 [自動測試]M7M8 T 標記；請款單、發票、附件由 DEV 專用函式 ga_dev_cleanup_m7m8_b45 清除（cleanupM7M8 會呼叫）。
 */
export { ga45Name, GA45_PREFIX };

export const PAY = {
  view: 'general_affairs.purchase_payment.view',
  manage: 'general_affairs.purchase_payment.manage',
} as const;

export const REAL_ROLES = {
  clerk: 'vue_workspace_ga45_clerk',
  clerk2: 'vue_workspace_ga45_clerk',
  accountant: 'vue_workspace_ga45_accountant',
  viewer: 'vue_workspace_ga45_viewer',
  novendor: 'vue_workspace_ga45_novendor',
  /** 對照組：既有採購角色（沒有 purchase_payment.*）。 */
  purchaser: 'vue_workspace_ga_purchaser',
  /** 水電網費管理（第 6 批 DEV 角色；附件既有資源類型回歸用）。 */
  util_mgr: 'vue_workspace_ga6_util_mgr',
} as const;

/** 臨時角色（只含指定權限）。 */
export const TEMP_ACCOUNTS = {
  /** 只有請款查看（沒有採購評估檢視、沒有廠商權限）：驗證 PO_VIEW_REQUIRED 與遮蔽。 */
  payonly: [PAY.view],
  /** 廠商管理（含 view）：廠商銀行欄位寫入。 */
  vendor_mgr: [PERM.vendorManage],
  /** 只有廠商查看：看得到銀行欄位但不能寫。 */
  vendor_view: [PERM.vendorView],
  /** 只有一個無關權限。 */
  nobody: [PERM.serviceAccess],
  /** 舊式管理員：profiles.role = admin、沒有任何角色（資料庫不給繞過）。 */
  admin: [] as string[],
} satisfies Record<string, string[]>;

export type Ga45Key = keyof typeof REAL_ROLES | keyof typeof TEMP_ACCOUNTS | 'store_mgr';
export type Ga45User = { key: Ga45Key; id: string; email: string; password: string; client: any };

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export async function setupGa45Users(keys: Ga45Key[]): Promise<{ users: Record<string, Ga45User>; teardown: () => Promise<string[]> }> {
  const db = adminDb();
  const left = await cleanupM7Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const allPerm = Object.values(TEMP_ACCOUNTS).flat();
  const permRows = must(await db.from('permissions').select('id,code').in('code', allPerm), '讀取權限碼') as { id: string; code: string }[];
  const permId = new Map(permRows.map((p) => [p.code, p.id]));
  const st = await stores();
  const users: Record<string, Ga45User> = {};
  for (const key of keys) {
    const email = `${M7_EMAIL_PREFIX}ga45-${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M7M8 GA45 ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    must(await db.from('profiles').update({ role: key === 'admin' ? 'admin' : 'member', job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    if (key in REAL_ROLES) {
      const code = REAL_ROLES[key as keyof typeof REAL_ROLES];
      const role = must(await db.from('roles').select('id').eq('code', code).maybeSingle(), `讀取角色 ${key}`) as { id: string } | null;
      if (!role) throw new Error(`DEV 沒有角色 ${code}（先套 supabase/workspace-dev 的 20261119145000_m7m8_b45_dev_seed 或第 6 批 DEV 角色）`);
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    } else if (key === 'store_mgr') {
      const role = must(await db.from('roles').select('id').eq('code', 'store_manager').maybeSingle(), '讀取 store_manager 角色') as { id: string } | null;
      if (!role) throw new Error('DEV 沒有 store_manager 角色');
      must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      must(await db.from('store_managers').insert({ user_id: uid, store_id: st.VW001.id, role_type: 'store_manager', is_primary: true }), `store_managers ${key}`);
    } else {
      const perms = TEMP_ACCOUNTS[key as keyof typeof TEMP_ACCOUNTS];
      if (perms.length) {
        const role = must(await db.from('roles').insert({ code: `${M7_ROLE_PREFIX}ga45_${key}`, name: `M7M8 測試 ga45 ${key}`, description: 'M7M8 第 4.5 批測試臨時角色', is_active: true, is_system: false }).select('id').single(), `建立角色 ${key}`) as { id: string };
        must(await db.from('role_permissions').insert(perms.map((c) => ({ role_id: role.id, permission_id: permId.get(c), is_allowed: true }))), `角色權限 ${key}`);
        must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
      }
    }
    users[key] = { key, id: uid, email, password, client: await clientForCredentials(email, password) };
  }
  return { users, teardown: () => cleanupM7Users(db) };
}

/** 測試廠商（以 service role 直接寫入；名稱帶 QA-GA45- 標記、統編隨機不重複、預設有一組銀行資料）。 */
export async function seedGa45Vendor(suffix: string, over: Record<string, unknown> = {}) {
  return must(
    await adminDb().from('ga_vendors').insert({
      name: ga45Name(`V-${suffix}`), vendor_type: 'company', status: 'active', tax_id: uniqueTaxId(), payment_terms: '月結 30 天',
      bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試戶名', ...over,
    }).select('*').single(),
    `建立測試廠商 ${suffix}`,
  ) as any;
}

export { m7Name };
