import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
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

export type M6Scenario = { desc: string; perms: string[]; profileRole: 'member' | 'manager' | 'admin'; /** 店長指派（測試門市代號）。 */ managed?: string[] };
export const M6_SCENARIOS: Record<string, M6Scenario> = {
  // 關係會員「核可」單獨權限（role-matrix 沒有 approve 的單獨帳號）
  rel_approve: { desc: '只有關係會員核可權限', perms: ['relationship_member.approve'], profileRole: 'member' },
  // 第二批 W27：只有商品主檔管理權限、非 admin（驗證不靠管理員後備也能操作）
  pm_manage: { desc: '只有商品主檔管理權限', perms: ['store.products_master.manage'], profileRole: 'member' },
  // 第二批 W27：有一般登入身分、完全沒有商品主檔權限（可搜尋、不可管理）
  pm_plain: { desc: '無商品主檔權限的一般帳號', perms: [], profileRole: 'member' },
  // 第二批 W29 缺貨回報：店長（提交，管轄 VW001／VW002）、商品部（只有回覆、只有查看全部）、沒有指派門市的提交者、完全沒有權限者
  so_store_a: { desc: '缺貨回報：店長，管轄 VW001', perms: ['cross_dept.stockout.submit'], profileRole: 'member', managed: ['VW001'] },
  so_store_b: { desc: '缺貨回報：店長，管轄 VW002', perms: ['cross_dept.stockout.submit'], profileRole: 'member', managed: ['VW002'] },
  so_responder: { desc: '缺貨回報：商品部，只有回覆權限', perms: ['cross_dept.stockout.respond'], profileRole: 'member' },
  so_viewer: { desc: '缺貨回報：商品部，只有查看全部權限', perms: ['cross_dept.stockout.view_all'], profileRole: 'member' },
  so_nostore: { desc: '缺貨回報：有提交權限但沒有指派門市', perms: ['cross_dept.stockout.submit'], profileRole: 'member' },
  so_plain: { desc: '缺貨回報：沒有任何缺貨回報權限', perms: [], profileRole: 'member' },
  // 2026-11-22 盤點權限問卷：只有 inventory.manage（不隱含匯入、刪除），驗證兩邊 API 都 403
  inv_manage_only: { desc: '盤點：只有 inventory.manage', perms: ['inventory.manage'], profileRole: 'member' },
};

export async function cleanupM6Users(db: any = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${M6_EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('products_master_operation_logs').delete().in('actor_id', uids);
    // W29：這些測試帳號自己建立的缺貨回報、回覆與歷程（只刪測試帳號的，避免 FK 擋住刪帳號）
    await db.from('stockout_product_response_history').delete().in('responded_by', uids);
    await db.from('stockout_product_responses').delete().in('responded_by', uids);
    await db.from('stockout_reports').delete().in('reported_by', uids);
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
    if (sc.managed?.length) {
      const st = must(await db.from('stores').select('id,store_code').in('store_code', sc.managed), `讀取門市 ${key}`) as { id: string; store_code: string }[];
      if (st.length !== sc.managed.length) throw new Error(`DEV 缺少測試門市 ${sc.managed.join(',')}`);
      must(await db.from('store_managers').insert(st.map((x, i) => ({ user_id: uid, store_id: x.id, role_type: 'store_manager', is_primary: i === 0 }))), `store_managers ${key}`);
    }
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

/** 第二批 W27/W28：測試商品編號一律 ZT2038-<runId>-<tag>（sweeper 以 ZT2038-T% 作後備）；只刪自己的。 */
export const productPrefix = () => `ZT2038-${runIdOrThrow()}`;
export const productCode = (tag: string) => `${productPrefix()}-${tag}`;
export async function cleanupM6Products(runId: string = runIdOrThrow(), db: any = adminDb()): Promise<void> {
  const pattern = `ZT2038-${runId}-%`;
  await db.from('products_master_operation_logs').delete().like('product_code', pattern);
  await db.from('products_master').delete().like('product_code', pattern);
}

/** 第二批 W29：測試缺貨商品編號 ZT2038-<runId>-…（回報、回覆、歷程都用這個前綴；只刪自己的）。 */
export const stockoutCode = (tag: string) => `ZT2038-${runIdOrThrow()}-${tag}`;
export async function cleanupM6Stockout(runId: string = runIdOrThrow(), db: any = adminDb()): Promise<void> {
  const pattern = `ZT2038-${runId}-%`;
  await db.from('stockout_product_response_history').delete().like('product_code', pattern);
  await db.from('stockout_reports').delete().like('product_code', pattern);
  await db.from('stockout_product_responses').delete().like('product_code', pattern);
}
export async function testStoreIds(): Promise<Record<string, string>> {
  const rows = must(await adminDb().from('stores').select('id,store_code').in('store_code', ['VW001', 'VW002', 'ZT01']), '讀取測試門市') as { id: string; store_code: string }[];
  return Object.fromEntries(rows.map((r) => [r.store_code, r.id]));
}

/**
 * 2026-11-22 盤點權限問卷（W25 匯入／刪除權限分開）：測試用盤點結果匯入檔。
 * 檔名 m6w25perm-<runId>-<tag>.xlsx、年月 2038-03、門市 VW001（測試門市）、盤點單號帶 runId；只刪自己的（依檔名）。
 */
export const inventoryResultFileName = (tag: string) => `m6w25perm-${runIdOrThrow()}-${tag}.xlsx`;
export const inventoryResultOrderNo = (tag: string) => `M6W25PERM-${runIdOrThrow()}-${tag}`;
export function inventoryResultXlsx(tag: string, storeCode = 'VW001'): Buffer {
  const header = ['店號', '店名', '盤點單號', '結案?', '品號', '品名', '單位', '儲位1', '儲位2', '盤差量', '盤差額(會員)', '成本', '單位成本', '庫存量', '庫存額'];
  const rows = [
    [storeCode, '測試門市', inventoryResultOrderNo(tag), 'Y', '02000001', `ZT2038 測試品 ${tag}`, '盒', 'A1', '', -1, -100, 80, 80, 5, 400],
    [storeCode, '測試門市', inventoryResultOrderNo(tag), 'Y', '03000002', `ZT2038 測試品二 ${tag}`, '盒', 'A2', '', 2, 200, 160, 80, 7, 560],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export async function cleanupM6InventoryResults(runId: string = runIdOrThrow(), db: any = adminDb()): Promise<void> {
  await db.from('inventory_result_batches').delete().like('source_file_name', `m6w25perm-${runId}-%`);
}
