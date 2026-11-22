import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8 } from '../support/m7m8-fixtures';
import { ga6Code, ga6Name, seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G21.rls（含 G20）：以「真實角色」（店長、總務全套、廠商管理、廠商檢視、只有分類區域、只有合作紀錄、水電檢視與管理、舊式管理員）用使用者身分直連資料庫與呼叫函式，
// 驗證收緊後的 RLS 行為（政策文字不等於行為）：店長與只有合作紀錄者讀不到廠商；只有分類區域者讀不到廠商但讀得到分類與區域；廠商檢視讀得到不能寫；
// 沒有任何人能直接刪除（無 DELETE 政策）；寫入被擋時資料不變（直連回傳錯誤或 0 列，新版 API 與函式回 403）；舊式管理員（profiles.role = admin、沒有角色）不繞過；函式回應不含帳務欄位。
// 測試資料：廠商、分類、區域帶 QA-GA6- 標記、只用 VW／ZT 測試門市；結束只清自己的。
test.describe.configure({ mode: 'serial' });
const KEYS: Ga6Key[] = ['store_mgr', 'ga_all', 'vendor_mgr', 'vendor_view', 'cat_only', 'coop_only', 'util_mgr', 'util_view', 'svc_mgr', 'admin', 'nobody'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let vendor: any;
let cat: any;
let region: any;
const db = () => adminDb();
const cl = (k: Ga6Key) => users[k].client as any;
const fn = (who: Ga6Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  vendor = await seedGa6Vendor('RLS', { tax_id: '12345675', billing_title: '機密抬頭', payment_terms: '月結 30 天', accounting_notes: '機密備註', description: '原簡介' });
  cat = (await db().from('ga_service_categories').insert({ name: ga6Name('RLS-C'), code: ga6Code('S1') }).select('*').single()).data;
  region = (await db().from('ga_service_regions').insert({ name: ga6Name('RLS-R'), code: ga6Code('S1'), region_type: 'city' }).select('*').single()).data;
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

const mine = async (k: Ga6Key, table: string, col: string, like: string) => {
  const r = await cl(k).from(table).select('id').like(col, like);
  expect(r.error, `${k} 讀 ${table}`).toBeNull();
  return (r.data as any[]).map((x) => x.id) as string[];
};

test('直連廠商表（ga_vendors）：只有廠商檢視／管理讀得到；店長、只有分類區域、只有合作紀錄、水電、舊式管理員、無關權限都是空結果（不是錯誤）', async () => {
  for (const k of ['ga_all', 'vendor_mgr', 'vendor_view'] as Ga6Key[]) expect(await mine(k, 'ga_vendors', 'name', 'QA-GA6-%'), k).toEqual([vendor.id]);
  for (const k of ['store_mgr', 'cat_only', 'coop_only', 'util_mgr', 'util_view', 'svc_mgr', 'admin', 'nobody'] as Ga6Key[]) expect(await mine(k, 'ga_vendors', 'name', 'QA-GA6-%'), k).toEqual([]);
  // 直接查統編與帳務欄位也讀不到
  for (const k of ['store_mgr', 'cat_only', 'coop_only', 'admin'] as Ga6Key[]) {
    const r = await cl(k).from('ga_vendors').select('tax_id,billing_title,payment_terms,accounting_notes').eq('id', vendor.id);
    expect(r.data, k).toEqual([]);
  }
});

test('直連分類與區域表：分類區域檢視、廠商檢視／管理與總務全套讀得到；店長、只有合作紀錄、水電、舊式管理員讀不到', async () => {
  for (const k of ['cat_only', 'svc_mgr', 'ga_all', 'vendor_view', 'vendor_mgr'] as Ga6Key[]) {
    expect(await mine(k, 'ga_service_categories', 'code', 'QA-GA6-%'), `${k} 分類`).toEqual([cat.id]);
    expect(await mine(k, 'ga_service_regions', 'code', 'QA-GA6-%'), `${k} 區域`).toEqual([region.id]);
  }
  for (const k of ['store_mgr', 'coop_only', 'util_mgr', 'util_view', 'admin', 'nobody'] as Ga6Key[]) {
    expect(await mine(k, 'ga_service_categories', 'code', 'QA-GA6-%'), `${k} 分類`).toEqual([]);
    expect(await mine(k, 'ga_service_regions', 'code', 'QA-GA6-%'), `${k} 區域`).toEqual([]);
  }
});

test('直連寫入：只有對應的管理權限能新增與修改；其餘被擋且資料不變（新增回錯誤、修改 0 列）；舊式管理員不繞過', async () => {
  const before = (await db().from('ga_vendors').select('*').eq('id', vendor.id).single()).data;
  for (const k of ['vendor_view', 'cat_only', 'coop_only', 'store_mgr', 'svc_mgr', 'admin', 'util_mgr', 'nobody'] as Ga6Key[]) {
    const ins = await cl(k).from('ga_vendors').insert({ name: ga6Name(`HK-${k}`) }).select('id');
    expect(ins.error, `${k} insert`).not.toBeNull();
    const upd = await cl(k).from('ga_vendors').update({ description: `被 ${k} 改了` }).eq('id', vendor.id).select('id');
    expect((upd.data || []).length, `${k} update`).toBe(0);
  }
  expect((await db().from('ga_vendors').select('*').eq('id', vendor.id).single()).data).toEqual(before);
  expect((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA6-%HK-%')).count).toBe(0);
  // 廠商管理可直連修改（RLS 許可；規則由函式把關，新版一律走函式）
  const ok = await cl('vendor_mgr').from('ga_vendors').update({ description: '管理者改的' }).eq('id', vendor.id).select('id');
  expect((ok.data || []).length).toBe(1);
  // 分類、區域
  for (const k of ['vendor_mgr', 'vendor_view', 'cat_only', 'coop_only', 'store_mgr', 'admin', 'nobody'] as Ga6Key[]) {
    const c = await cl(k).from('ga_service_categories').insert({ name: ga6Name(`HC-${k}`), code: ga6Code(`H${k.length}`) }).select('id');
    expect(c.error, `${k} cat insert`).not.toBeNull();
    const cu = await cl(k).from('ga_service_categories').update({ name: '駭' }).eq('id', cat.id).select('id');
    expect((cu.data || []).length, `${k} cat update`).toBe(0);
    const ru = await cl(k).from('ga_service_regions').update({ name: '駭' }).eq('id', region.id).select('id');
    expect((ru.data || []).length, `${k} region update`).toBe(0);
  }
  expect((await db().from('ga_service_categories').select('name').eq('id', cat.id).single()).data!.name).toBe(ga6Name('RLS-C'));
  expect((await db().from('ga_service_regions').select('name').eq('id', region.id).single()).data!.name).toBe(ga6Name('RLS-R'));
  const cm = await cl('svc_mgr').from('ga_service_categories').update({ description: '分類管理改的' }).eq('id', cat.id).select('id');
  expect((cm.data || []).length).toBe(1);
  const rm = await cl('ga_all').from('ga_service_regions').update({ description: '區域管理改的' }).eq('id', region.id).select('id');
  expect((rm.data || []).length).toBe(1);
});

test('沒有任何人能直接刪除廠商、分類與區域（無 DELETE 政策）：含廠商管理與總務全套，資料仍在', async () => {
  for (const k of ['ga_all', 'vendor_mgr', 'svc_mgr', 'vendor_view', 'cat_only', 'store_mgr', 'admin'] as Ga6Key[]) {
    for (const [table, id] of [['ga_vendors', vendor.id], ['ga_service_categories', cat.id], ['ga_service_regions', region.id]] as const) {
      const d = await cl(k).from(table).delete().eq('id', id).select('id');
      expect((d.data || []).length, `${k} delete ${table}`).toBe(0);
    }
  }
  for (const [table, id] of [['ga_vendors', vendor.id], ['ga_service_categories', cat.id], ['ga_service_regions', region.id]] as const) {
    expect((await db().from(table).select('id').eq('id', id).maybeSingle()).data, table).toBeTruthy();
  }
});

test('函式：舊式管理員（沒有角色）與店長不繞過、只有分類區域者讀不到統編；廠商檢視者拿得到帳務欄位但不能寫；水電角色與廠商無關', async () => {
  for (const k of ['admin', 'store_mgr', 'util_mgr', 'util_view', 'cat_only', 'coop_only', 'nobody'] as Ga6Key[]) {
    const r = await fn(k, 'ga_ws_vendor_get', { p_id: vendor.id });
    expect(r.status, k).toBe(403);
    expect(JSON.stringify(r), k).not.toMatch(/12345675|機密|月結/);
    expect((await fn(k, 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { description: '駭' }, p_expected_updated_at: vendor.updated_at })).status, `${k} save`).toBe(403);
  }
  const v = await fn('vendor_view', 'ga_ws_vendor_get', { p_id: vendor.id });
  expect(v.data).toMatchObject({ tax_id: '12345675', billing_title: '機密抬頭', accounting_notes: '機密備註' });
  expect(v.can_manage).toBe(false);
  expect((await fn('vendor_view', 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: { description: '駭' }, p_expected_updated_at: v.data.updated_at })).status).toBe(403);
  const o = await fn('cat_only', 'ga_ws_vendor_options', { p_q: null, p_page: 1, p_page_size: 10 });
  expect(o.status).toBe(403);
  // 只有分類區域者讀得到分類區域函式，不含任何廠商欄位
  const cl1 = await fn('cat_only', 'ga_ws_svc_category_list', { p_filters: { search: ga6Name('RLS-') }, p_page: 1, p_page_size: 10 });
  expect(cl1.data.total).toBe(1);
  expect(JSON.stringify(cl1)).not.toMatch(/tax_id|payment_terms|billing_/);
  expect(cl1.data.rows[0].vendor_count).toBeNull();
  // 資料不變
  expect((await db().from('ga_vendors').select('description').eq('id', vendor.id).single()).data!.description).toBe('管理者改的');
});

test('店長帳號（VW001）：總務服務中心入口之外沒有任何廠商、分類、區域、合作紀錄資料；函式一律 403', async () => {
  for (const [name, args] of [
    ['ga_ws_vendor_list', { p_filters: {}, p_page: 1, p_page_size: 5 }], ['ga_ws_vendor_options', {}], ['ga_ws_svc_category_list', {}], ['ga_ws_svc_region_list', {}],
    ['ga_ws_svc_category_get', { p_id: cat.id }], ['ga_ws_svc_region_get', { p_id: region.id }],
  ] as const) {
    const r = await fn('store_mgr', name, args as any);
    expect([name, r.ok, r.status]).toEqual([name, false, 403]);
  }
});
