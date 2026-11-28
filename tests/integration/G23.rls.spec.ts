import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { anonClient } from '../support/m7m8-po-fixtures';
import { ga6Name, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G23.rls：用「真實角色」（店長、總務全套、水電管理、水電檢視、只有分類區域、廠商管理、舊式管理員、無關權限、未登入）以使用者身分直連 ga_utility_bills 資料表，
// 驗證 RLS 的行為（政策文字不等於行為）：店長讀不到自己門市的帳單（讀取 policy 已移除 current_user_manages_store 條件）；水電檢視讀得到、寫入被擋；沒有任何人能直接刪除（沒有 DELETE 授權）；
// 軟刪除的帳單直連讀不到；寫入被擋時資料不變；舊式管理員（profiles.role = admin、沒有角色）不繞過；函式也一致擋下。
// 測試資料：帳單供應商帶 QA-GA6- 標記、只用 VW／ZT 測試門市；結束只清自己的。
test.describe.configure({ mode: 'serial' });
const KEYS: Ga6Key[] = ['store_mgr', 'ga_all', 'util_mgr', 'util_view', 'cat_only', 'vendor_mgr', 'admin', 'nobody'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
let bill: any;
let goneBill: any;
const db = () => adminDb();
const cl = (k: Ga6Key) => users[k].client as any;
const fn = (who: Ga6Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const mine = async (k: Ga6Key) => {
  const r = await cl(k).from('ga_utility_bills').select('id,amount,location_name').like('provider_name', 'QA-GA6-%');
  expect(r.error, `${k} 讀取`).toBeNull();
  return (r.data as any[]).map((x) => x.id) as string[];
};

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  const mk = async (ident: string, store: string) => {
    const r = await fn('util_mgr', 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: store, service_period_start: '2038-01-01', service_period_end: '2038-01-31', expense_type: 'WATER', billing_month: '2038-08', provider_name: ga6Name('P'), service_identifier: ident, amount: 4321 }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.data;
  };
  // 店長（VW001 的店長）自己門市的帳單：舊政策會讓他直讀，新政策不行
  bill = await mk(`QA-GA6-RLS-${Date.now()}-A`, st.VW001.id);
  goneBill = await mk(`QA-GA6-RLS-${Date.now()}-B`, st.VW002.id);
  const d = await fn('util_mgr', 'ga_ws_ub_delete', { p_id: goneBill.id, p_reason: 'RLS 測試', p_confirm_paid_change: false, p_expected_updated_at: goneBill.updated_at });
  expect(d.ok).toBe(true);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

test('直連帳單表：水電檢視／管理與總務全套讀得到（未刪除的）；店長（即使是該門市的店長）、只有分類區域、廠商管理、舊式管理員、無關權限、未登入都是空結果（不是錯誤）', async () => {
  for (const k of ['ga_all', 'util_mgr', 'util_view'] as Ga6Key[]) expect(await mine(k), k).toEqual([bill.id]);
  for (const k of ['store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'] as Ga6Key[]) expect(await mine(k), k).toEqual([]);
  // 直接用 id 查也一樣讀不到（含金額）
  for (const k of ['store_mgr', 'cat_only', 'admin'] as Ga6Key[]) {
    const r = await cl(k).from('ga_utility_bills').select('id,amount').eq('id', bill.id);
    expect(r.error, k).toBeNull();
    expect(r.data, k).toEqual([]);
  }
  const anon = await anonClient().from('ga_utility_bills').select('id').eq('id', bill.id);
  expect(anon.error ? [] : anon.data).toEqual([]);
  // 軟刪除的帳單直連讀不到（連有權限的人也一樣；只能走函式的「顯示已刪除」唯讀檢視）
  for (const k of ['ga_all', 'util_mgr', 'util_view'] as Ga6Key[]) {
    const r = await cl(k).from('ga_utility_bills').select('id').eq('id', goneBill.id);
    expect(r.data, k).toEqual([]);
  }
  const viaFn = await fn('util_view', 'ga_ws_ub_list', { p_filters: { deleted: true, search: goneBill.service_identifier }, p_page: 1, p_page_size: 5 });
  expect(viaFn.data.rows.map((x: any) => x.id)).toEqual([goneBill.id]);
});

test('函式與資料表一致：店長、只有分類區域、廠商管理、舊式管理員、無關權限呼叫帳單函式都是 403（不是空資料）', async () => {
  for (const k of ['store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'] as Ga6Key[]) {
    expect(await fn(k, 'ga_ws_ub_list', { p_filters: {}, p_page: 1, p_page_size: 5 }), k).toMatchObject({ ok: false, status: 403 });
    expect(await fn(k, 'ga_ws_ub_get', { p_id: bill.id }), k).toMatchObject({ ok: false, status: 403 });
  }
});

test('直連寫入：水電檢視、店長、其他角色寫不進去（回傳錯誤或 0 列），資料不變；沒有任何人能直接刪除（沒有 DELETE 授權）', async () => {
  const before = (await db().from('ga_utility_bills').select('*').eq('id', bill.id).maybeSingle()).data as any;
  for (const k of ['util_view', 'store_mgr', 'cat_only', 'vendor_mgr', 'admin', 'nobody'] as Ga6Key[]) {
    const ins = await cl(k).from('ga_utility_bills').insert({ location_name: 'QA-GA6 直連', expense_type: 'WATER', billing_month: '2038-01-01', provider_name: ga6Name('P'), service_identifier: `QA-GA6-RLS-INS-${k}`, amount: 1 });
    expect(ins.error, `${k} 直連新增`).toBeTruthy();
    const upd = await cl(k).from('ga_utility_bills').update({ amount: 1 }).eq('id', bill.id).select('id');
    expect(upd.error || (upd.data as any[]).length === 0, `${k} 直連更新被擋`).toBeTruthy();
  }
  for (const k of ['util_mgr', 'ga_all', 'util_view', 'store_mgr'] as Ga6Key[]) {
    const del = await cl(k).from('ga_utility_bills').delete().eq('id', bill.id).select('id');
    expect(del.error || (del.data as any[]).length === 0, `${k} 直連刪除被擋`).toBeTruthy();
  }
  const after = (await db().from('ga_utility_bills').select('*').eq('id', bill.id).maybeSingle()).data as any;
  expect(after).toEqual(before);
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('service_identifier', 'QA-GA6-RLS-INS-%')).count).toBe(0);
});

test('舊式管理員（profiles.role = admin、沒有角色）不繞過：直連、函式與寫入都被擋', async () => {
  expect(await mine('admin')).toEqual([]);
  expect(await fn('admin', 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, service_period_start: '2038-01-01', service_period_end: '2038-01-31', expense_type: 'WATER', billing_month: '2038-08', provider_name: ga6Name('P'), service_identifier: 'QA-GA6-RLS-ADM', amount: 1 }, p_expected_updated_at: null, p_confirm_paid_change: false }))
    .toMatchObject({ ok: false, status: 403 });
  expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', 'QA-GA6-RLS-ADM')).count).toBe(0);
});
