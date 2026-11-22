import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, rowsWhere, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedTransfer,
  setupM7Users, stores, type M7User,
} from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G11 庫存位置與料件設定 API（/api/workspace/general-affairs/inventory/locations/**）整合層。
// 涵蓋：權限矩陣（401／403）與 Origin、清單搜尋分頁與伺服端精確統計、C12 三種名單身分唯讀＋內部欄位遮蔽、新增與 400 驗證、
//      預設位置衝突確認、修改（版本 409 STALE、連點只成功一次）、C3 有交易後鎖定、C2 停用／刪除／移除保護（進行中調撥一律擋、庫存要確認或擋）、
//      C1 批次新增（全成或全不變）與逐筆修改，以及料件停用保護（有庫存不能停用）。每個寫入都用 service role 回讀資料庫。
const BASE = '/api/workspace/general-affairs/inventory/locations';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_inv_location_view', 'ga_inv_location_edit', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'supervisor', 'denied'];
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let partCat: { id: string };
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p = '') => j(await apis[k].get(`${BASE}${p}`));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) =>
  j(await (apis[k] as any)[method](`${BASE}${p}`, method === 'delete' ? { data: data ?? {} } : { data: data ?? {} }));
const ids = (res: any) => ((res.body.data || []) as any[]).map((r) => r.id as string);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  const made = await setupM7Users(['roster_supervisor', 'roster_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  apis.roster_supervisor = await apiForUser(users.roster_supervisor as any);
  apis.roster_area_manager = await apiForUser(users.roster_area_manager as any);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  partCat = await seedCategory('part', 'LP');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
});

// ----------------------------------------------------------------------------- 權限與 Origin
test('權限矩陣：未登入 401；沒有位置權限也不在門市名單的帳號 403；位置查看與管理、三種名單身分 200', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(BASE)).status()).toBe(401);
  await anon.dispose();
  for (const k of ['denied', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'ga_equipment_view']) {
    expect((await get(k)).status, `${k} 清單`).toBe(403);
    expect((await get(k, '/00000000-0000-4000-8000-000000000000')).status, `${k} 詳情`).toBe(403);
  }
  for (const k of ['ga_works', 'ga_inv_location_view', 'ga_inv_location_edit', 'store_manager', 'ga_store_manager_b', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    expect((await get(k)).status, `${k} 清單`).toBe(200);
  }
  const res = await get('ga_inv_location_view');
  expect(res.body.permissions).toMatchObject({ manage: false, readOnly: true, internal: true });
  expect((await get('ga_works')).body.permissions).toMatchObject({ manage: true, readOnly: false, internal: true, canAddParts: true });
  // 只有位置管理、沒有料件查看：能管理位置但不能新增位置料件
  expect((await get('ga_inv_location_edit')).body.permissions).toMatchObject({ manage: true, canAddParts: false });
});

test('寫入：沒有位置管理權限 403（查看者、只有記帳／調撥管理、名單身分）；Origin 不符 403 且沒有寫入；壞 id 400；找不到 404', async () => {
  const name = m7Name('PERM');
  for (const k of ['ga_inv_location_view', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'store_manager', 'supervisor', 'denied']) {
    expect((await send(k, 'post', '', { name, location_type: 'OFFICE' })).status, k).toBe(403);
  }
  expect(await rowsWhere('ga_inventory_locations', 'name', name)).toEqual([]);
  const evil = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await storageStateFor('ga_works'), extraHTTPHeaders: { Origin: 'http://evil.example' } });
  const r = await evil.post(BASE, { data: { name, location_type: 'OFFICE' } });
  expect(r.status()).toBe(403);
  await evil.dispose();
  expect(await rowsWhere('ga_inventory_locations', 'name', name)).toEqual([]);
  expect((await get('ga_works', '/not-a-uuid')).status).toBe(400);
  expect((await get('ga_works', '/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  expect((await send('ga_works', 'patch', '/not-a-uuid', { name: 'x', expected_updated_at: new Date().toISOString() })).status).toBe(400);
  expect((await get('ga_inv_location_view', '/00000000-0000-4000-8000-000000000000/impact')).status).toBe(403);
});

// ----------------------------------------------------------------------------- 新增與驗證
test('新增：欄位驗證 400（缺名稱、類型錯、門市規則、未知欄位、系統欄位、代碼過長）；成功 201 並回讀資料庫（代碼轉大寫、描述保留）', async () => {
  const bad: [string, Record<string, unknown>][] = [
    ['缺名稱', { location_type: 'OFFICE' }],
    ['名稱空白', { name: '   ', location_type: 'OFFICE' }],
    ['類型錯誤', { name: m7Name('B'), location_type: 'MOON' }],
    ['門市類型沒選門市', { name: m7Name('B'), location_type: 'STORE' }],
    ['非門市類型選了門市', { name: m7Name('B'), location_type: 'OFFICE', store_id: sid.ZT01 }],
    ['門市 id 不是 UUID', { name: m7Name('B'), location_type: 'STORE', store_id: 'abc' }],
    ['未知欄位', { name: m7Name('B'), location_type: 'OFFICE', foo: 1 }],
    ['系統欄位', { name: m7Name('B'), location_type: 'OFFICE', deleted_at: '2020-01-01' }],
    ['代碼過長', { name: m7Name('B'), location_type: 'OFFICE', code: 'X'.repeat(41) }],
    ['布林欄位不是布林', { name: m7Name('B'), location_type: 'OFFICE', is_active: 'yes' }],
    ['非預設資格卻設預設', { name: m7Name('B'), location_type: 'OFFICE', is_default: true }],
  ];
  for (const [label, data] of bad) {
    const r = await send('ga_works', 'post', '', data);
    expect(r.status, label).toBe(400);
    expect(r.body.error, label).toBeTruthy();
  }
  expect(await rowsWhere('ga_inventory_locations', 'name', m7Name('B'))).toEqual([]);
  const code = m7Code('crt').toLowerCase();
  const ok = await send('ga_works', 'post', '', { name: m7Name('CRT'), location_type: 'STORE', store_id: sid.ZT02, code, description: '內部描述 CRT', allow_negative_stock: true });
  expect(ok.status).toBe(201);
  const db = await row('ga_inventory_locations', ok.body.data.id);
  expect(db).toMatchObject({ name: m7Name('CRT'), location_type: 'STORE', store_id: sid.ZT02, code: code.toUpperCase(), description: '內部描述 CRT', is_active: true, allow_negative_stock: true, is_default: false, deleted_at: null });
  // 代碼全公司唯一、不分大小寫
  const dup = await send('ga_works', 'post', '', { name: m7Name('CRT2'), location_type: 'OFFICE', code: code.toUpperCase() });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('DUPLICATE_CODE');
  expect(await rowsWhere('ga_inventory_locations', 'name', m7Name('CRT2'))).toEqual([]);
});

test('預設位置：同門市已有預設時 409 DEFAULT_CONFLICT（帶既有位置名稱）；確認後改由新位置接手；總倉同理（全公司一個）', async () => {
  const first = await send('ga_works', 'post', '', { name: m7Name('D1'), location_type: 'STORE', store_id: sid.ZT03, is_default: true });
  expect(first.status).toBe(201);
  expect(first.body.data.is_default).toBe(true);
  const conflict = await send('ga_works', 'post', '', { name: m7Name('D2'), location_type: 'STORE', store_id: sid.ZT03, is_default: true });
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('DEFAULT_CONFLICT');
  expect(conflict.body.existing).toMatchObject({ id: first.body.data.id, name: m7Name('D1') });
  expect(await rowsWhere('ga_inventory_locations', 'name', m7Name('D2'))).toEqual([]);
  const replaced = await send('ga_works', 'post', '', { name: m7Name('D2'), location_type: 'STORE', store_id: sid.ZT03, is_default: true, replace_default: true });
  expect(replaced.status).toBe(201);
  expect((await row('ga_inventory_locations', first.body.data.id)).is_default).toBe(false);
  expect((await row('ga_inventory_locations', replaced.body.data.id)).is_default).toBe(true);
  // 修改成預設：再次衝突要確認
  const third = await send('ga_works', 'post', '', { name: m7Name('D3'), location_type: 'STORE', store_id: sid.ZT03 });
  const c2 = await send('ga_works', 'patch', `/${third.body.data.id}`, { is_default: true, expected_updated_at: third.body.data.updated_at });
  expect(c2.status).toBe(409);
  expect(c2.body.code).toBe('DEFAULT_CONFLICT');
  const c3 = await send('ga_works', 'patch', `/${third.body.data.id}`, { is_default: true, replace_default: true, expected_updated_at: third.body.data.updated_at });
  expect(c3.status).toBe(200);
  expect((await row('ga_inventory_locations', replaced.body.data.id)).is_default).toBe(false);
  // 總倉：全公司只能有一個啟用的預設
  const hq = await send('ga_works', 'post', '', { name: m7Name('HQ1'), location_type: 'CENTRAL_WAREHOUSE', is_default: true, replace_default: true });
  expect(hq.status).toBe(201);
  const hq2 = await send('ga_works', 'post', '', { name: m7Name('HQ2'), location_type: 'CENTRAL_WAREHOUSE', is_default: true });
  expect(hq2.status).toBe(409);
  expect(hq2.body.existing.id).toBe(hq.body.data.id);
  // 收尾：把這個測試設的預設撤掉，避免影響其他測試
  await adminDb().from('ga_inventory_locations').update({ is_default: false }).eq('id', hq.body.data.id);
});

// ----------------------------------------------------------------------------- 清單、統計、C12 遮蔽
test('清單：分頁上限 100、搜尋含逗號括號引號不壞、類型／門市／狀態篩選、統計為伺服端精確筆數', async () => {
  const a = await seedLocation('ZT04', 'LST-A', { description: '內部描述 LST' });
  const b = await seedLocation('ZT04', 'LST-B', { is_active: false });
  const c = await seedLocation(null, 'LST-C');
  await seedLocationPart(a.id, (await seedPart(partCat.id, 'LST-P1')).id);
  const all = await get('ga_works', '?pageSize=1000');
  expect(all.status).toBe(200);
  expect(all.body.meta.pageSize).toBe(100);
  const dbTotal = (await adminDb().from('ga_inventory_locations').select('id', { count: 'exact', head: true }).is('deleted_at', null)).count;
  const dbActive = (await adminDb().from('ga_inventory_locations').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true)).count;
  const dbDefault = (await adminDb().from('ga_inventory_locations').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true).eq('is_default', true)).count;
  expect(all.body.stats).toEqual({ total: dbTotal, active: dbActive, inactive: dbTotal - dbActive, defaults: dbDefault });
  expect(all.body.total).toBe(dbTotal);
  // 搜尋（名稱帶標記）與特殊字元
  const found = await get('ga_works', `?search=${encodeURIComponent(m7Name('LST-'))}&pageSize=50`);
  expect(ids(found).sort()).toEqual([a.id, b.id, c.id].sort());
  for (const q of ['a,b', '(x)', '"q"', "o'r", '50%', 'a\\b']) expect((await get('ga_works', `?search=${encodeURIComponent(q)}`)).status, q).toBe(200);
  const type = await get('ga_works', `?search=${encodeURIComponent(m7Name('LST-'))}&locationType=CENTRAL_WAREHOUSE`);
  expect(ids(type)).toEqual([c.id]);
  const store = await get('ga_works', `?search=${encodeURIComponent(m7Name('LST-'))}&storeId=${sid.ZT04}&isActive=false`);
  expect(ids(store)).toEqual([b.id]);
  // 分頁：每頁 1 筆，總數與頁數正確
  const p2 = await get('ga_works', `?search=${encodeURIComponent(m7Name('LST-'))}&pageSize=1&page=2&sortBy=name&sortOrder=asc`);
  expect(p2.body.meta).toMatchObject({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
  expect(ids(p2)).toEqual([b.id]);
  // 每列筆數
  const rowA = ids(found).length && found.body.data.find((r: any) => r.id === a.id);
  expect(rowA).toMatchObject({ parts_count: 1, stock_items: 0, open_transfers: 0, has_history: false });
  for (const bad of ['?locationType=MOON', '?storeId=abc']) expect((await get('ga_works', bad)).status, bad).toBe(400);
});

test('C12：店長、督導、區經理（名單身分）唯讀、只看自己門市、描述與設定備註由伺服端遮蔽；位置查看者看得到內部欄位', async () => {
  const mine = await seedLocation('ZT01', 'C12-MINE', { description: '內部描述-ZT01' });
  const other = await seedLocation('VW001', 'C12-OTHER', { description: '內部描述-VW001' });
  const central = await seedLocation(null, 'C12-HQ', { description: '內部描述-HQ' });
  const part = await seedPart(partCat.id, 'C12-P');
  const setting = await seedLocationPart(mine.id, part.id, { notes: '內部備註-C12', safety_stock_qty: 2 });
  const search = `?search=${encodeURIComponent(m7Name('C12-'))}`;
  for (const k of ['store_manager', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    const r = await get(k, search);
    expect(r.status, k).toBe(200);
    expect(ids(r), `${k} 只看到自己門市的位置`).toEqual([mine.id]);
    expect(r.body.data[0], `${k} 描述被遮蔽`).not.toHaveProperty('description');
    expect(JSON.stringify(r.body), k).not.toContain('內部描述');
    expect(r.body.permissions, k).toMatchObject({ manage: false, readOnly: true, internal: false });
    const one = await get(k, `/${mine.id}`);
    expect(one.status, k).toBe(200);
    expect(JSON.stringify(one.body), k).not.toContain('內部描述');
    expect((await get(k, `/${other.id}`)).status, `${k} 他店位置`).toBe(404);
    expect((await get(k, `/${central.id}`)).status, `${k} 總倉`).toBe(404);
    const parts = await get(k, `/${mine.id}/parts`);
    expect(parts.status, k).toBe(200);
    expect(parts.body.data).toHaveLength(1);
    expect(parts.body.data[0], `${k} 備註被遮蔽`).not.toHaveProperty('notes');
    expect(JSON.stringify(parts.body), k).not.toContain('內部備註');
    expect(parts.body.data[0].safety_stock_qty).toBe(2);
    expect(parts.body.data[0]).not.toHaveProperty('stock_qty');
    // 不能寫入、看不到影響範圍
    expect((await send(k, 'patch', `/${mine.id}`, { name: 'x', expected_updated_at: mine.updated_at })).status, `${k} 修改`).toBe(403);
    expect((await send(k, 'delete', `/${mine.id}`, { deletion_reason: 'x', expected_updated_at: mine.updated_at })).status, `${k} 刪除`).toBe(403);
    expect((await send(k, 'post', `/${mine.id}/parts`, { items: [{ part_id: part.id }] })).status, `${k} 新增設定`).toBe(403);
    expect((await send(k, 'patch', `/${mine.id}/parts/${setting.id}`, { notes: 'x', expected_updated_at: setting.updated_at })).status, `${k} 修改設定`).toBe(403);
  }
  // 另一間店的店長只看到自己的
  const b = await get('ga_store_manager_b', search);
  expect(ids(b)).toEqual([other.id]);
  // 總務：全部看得到，含內部欄位與庫存
  const ga = await get('ga_works', search);
  expect(ids(ga).sort()).toEqual([mine.id, other.id, central.id].sort());
  expect(ga.body.data.find((r: any) => r.id === mine.id).description).toBe('內部描述-ZT01');
  const gaParts = await get('ga_works', `/${mine.id}/parts`);
  expect(gaParts.body.data[0]).toMatchObject({ notes: '內部備註-C12', stock_qty: 0 });
  // 只有位置查看（沒有餘額權限）：看得到內部欄位、看不到庫存數
  const view = await get('ga_inv_location_view', `/${mine.id}/parts`);
  expect(view.body.data[0].notes).toBe('內部備註-C12');
  expect(view.body.data[0]).not.toHaveProperty('stock_qty');
});

// ----------------------------------------------------------------------------- 修改、版本、鎖定（C3）
test('修改：缺 expected_updated_at 400；版本過期 409 STALE；成功回讀；同時兩個請求只成功一個', async () => {
  const loc = await seedLocation('ZT05', 'UPD');
  expect((await send('ga_works', 'patch', `/${loc.id}`, { name: m7Name('UPD-2') })).status).toBe(400);
  expect((await send('ga_works', 'patch', `/${loc.id}`, { name: m7Name('UPD-2'), expected_updated_at: 'not-a-date' })).status).toBe(400);
  const ok = await send('ga_works', 'patch', `/${loc.id}`, { name: m7Name('UPD-2'), description: ' 新描述 ', expected_updated_at: loc.updated_at });
  expect(ok.status).toBe(200);
  const db = await row('ga_inventory_locations', loc.id);
  expect(db).toMatchObject({ name: m7Name('UPD-2'), description: '新描述' });
  expect(db.updated_at).not.toBe(loc.updated_at);
  const stale = await send('ga_works', 'patch', `/${loc.id}`, { name: m7Name('UPD-3'), expected_updated_at: loc.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await row('ga_inventory_locations', loc.id)).name).toBe(m7Name('UPD-2'));
  // 連點：同一份舊資料同時送兩次，只有一次成功
  const cur = (await row('ga_inventory_locations', loc.id)).updated_at;
  const both = await Promise.all([
    send('ga_works', 'patch', `/${loc.id}`, { description: 'A', expected_updated_at: cur }),
    send('ga_works', 'patch', `/${loc.id}`, { description: 'B', expected_updated_at: cur }),
  ]);
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  // 空修改不報錯也不改資料
  const noop = await send('ga_works', 'patch', `/${loc.id}`, { expected_updated_at: (await row('ga_inventory_locations', loc.id)).updated_at });
  expect(noop.status).toBe(200);
  // 類型與門市的組合錯誤由資料庫擋（修改只送一半時）
  const cur2 = (await row('ga_inventory_locations', loc.id)).updated_at;
  const mixed = await send('ga_works', 'patch', `/${loc.id}`, { location_type: 'OFFICE', expected_updated_at: cur2 });
  expect(mixed.status).toBe(400);
  expect((await row('ga_inventory_locations', loc.id)).location_type).toBe('STORE');
});

test('C3：位置已有餘額或交易後，類型、門市、代碼鎖定（409 LOCKED_BY_HISTORY），名稱與描述仍可改；沒有交易的位置可以改類型與門市', async () => {
  const free = await seedLocation('ZT04', 'LOCK-FREE');
  const moved = await send('ga_works', 'patch', `/${free.id}`, { location_type: 'OFFICE', store_id: null, expected_updated_at: free.updated_at });
  expect(moved.status).toBe(200);
  expect(await row('ga_inventory_locations', free.id)).toMatchObject({ location_type: 'OFFICE', store_id: null });

  const part = await seedPart(partCat.id, 'LOCK-P');
  const loc = await seedLocation('ZT04', 'LOCK');
  await seedBalance(loc.id, part.id, 0); // 只要有餘額列（即使是 0）就代表用過
  const before = await row('ga_inventory_locations', loc.id);
  for (const [label, patch] of [
    ['改類型', { location_type: 'OFFICE', store_id: null }],
    ['改門市', { store_id: sid.ZT05 }],
    ['改代碼', { code: m7Code('LOCK-NEW') }],
  ] as const) {
    const cur = (await row('ga_inventory_locations', loc.id)).updated_at;
    const r = await send('ga_works', 'patch', `/${loc.id}`, { ...patch, expected_updated_at: cur });
    expect(r.status, label).toBe(409);
    expect(r.body.code, label).toBe('LOCKED_BY_HISTORY');
    expect(r.body.error, label).toContain('要換店請新增位置');
  }
  const after = await row('ga_inventory_locations', loc.id);
  expect({ type: after.location_type, store: after.store_id, code: after.code }).toEqual({ type: before.location_type, store: before.store_id, code: before.code });
  // 代碼送同樣的值（不變）不算修改；名稱、描述、負庫存仍可改
  const same = await send('ga_works', 'patch', `/${loc.id}`, { code: before.code.toLowerCase(), name: m7Name('LOCK-2'), description: '可改', allow_negative_stock: true, expected_updated_at: after.updated_at });
  expect(same.status).toBe(200);
  expect(await row('ga_inventory_locations', loc.id)).toMatchObject({ name: m7Name('LOCK-2'), description: '可改', allow_negative_stock: true, code: before.code });
  // 資料庫層（任何路徑，含舊版直接更新）也擋：用有位置管理權限的使用者身分直接更新
  const direct = await adminDb().from('ga_inventory_locations').update({ code: m7Code('LOCK-DB') }).eq('id', loc.id);
  expect(direct.error?.message || '').toContain('不能再修改');
  const detail = await get('ga_works', `/${loc.id}`);
  expect(detail.body.data.has_history).toBe(true);
});

// ----------------------------------------------------------------------------- C2 停用與刪除
test('C2：影響範圍預覽；有進行中調撥一律擋（停用、刪除）；有庫存停用要確認、刪除直接擋；清空後可刪（原因必填、設定一併移除）', async () => {
  const part = await seedPart(partCat.id, 'C2-P');
  const src = await seedLocation('ZT04', 'C2-SRC');
  const dst = await seedLocation('ZT05', 'C2-DST');
  await seedLocationPart(src.id, part.id);
  await seedLocationPart(dst.id, part.id);
  const bal = await seedBalance(src.id, part.id, 5);
  const tr = await seedTransfer(src.id, dst.id, part.id, 'C2-T', 'REQUESTED');

  const imp = await get('ga_works', `/${src.id}/impact`);
  expect(imp.status).toBe(200);
  expect(imp.body.data).toMatchObject({ stock_items: 1, open_transfers: 1, location_parts: 1, has_history: true });
  expect(imp.body.data.open_transfer_nos).toHaveLength(1);
  expect(imp.body.summary.disable.blocked).toContain('1 張進行中的調撥單');
  expect((await get('ga_inv_location_view', `/${src.id}/impact`)).status).toBe(403);

  // 進行中調撥：來源與目的都擋，停用與刪除都擋，帶 confirm_stock 也一樣（不留例外）
  for (const loc of [src, dst]) {
    const cur = (await row('ga_inventory_locations', loc.id)).updated_at;
    const d = await send('ga_works', 'patch', `/${loc.id}`, { is_active: false, confirm_stock: true, expected_updated_at: cur });
    expect(d.status).toBe(409);
    expect(d.body.code).toBe('OPEN_TRANSFERS');
    const del = await send('ga_works', 'delete', `/${loc.id}`, { deletion_reason: '測試', expected_updated_at: cur });
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('OPEN_TRANSFERS');
    expect(await row('ga_inventory_locations', loc.id)).toMatchObject({ is_active: true, deleted_at: null });
  }
  // 資料庫層（任何路徑）也擋
  const direct = await adminDb().from('ga_inventory_locations').update({ is_active: false }).eq('id', src.id);
  expect(direct.error?.message || '').toContain('進行中的調撥單');

  // 取消調撥單後：停用有庫存的位置要先確認
  await adminDb().from('ga_inventory_transfers').update({ status: 'CANCELED', cancel_reason: '測試取消' }).eq('id', tr.id);
  const cur = (await row('ga_inventory_locations', src.id)).updated_at;
  const ask = await send('ga_works', 'patch', `/${src.id}`, { is_active: false, expected_updated_at: cur });
  expect(ask.status).toBe(409);
  expect(ask.body.code).toBe('NEEDS_CONFIRM_STOCK');
  expect(ask.body.impact.stock_items).toBe(1);
  expect((await row('ga_inventory_locations', src.id)).is_active).toBe(true);
  const off = await send('ga_works', 'patch', `/${src.id}`, { is_active: false, confirm_stock: true, expected_updated_at: cur });
  expect(off.status).toBe(200);
  expect((await row('ga_inventory_locations', src.id)).is_active).toBe(false);
  // 停用後庫存仍保留；刪除有庫存的位置直接擋
  expect(Number((await row('ga_inventory_balances', bal.id)).quantity_base)).toBe(5);
  const cur2 = (await row('ga_inventory_locations', src.id)).updated_at;
  const del = await send('ga_works', 'delete', `/${src.id}`, { deletion_reason: '測試', expected_updated_at: cur2 });
  expect(del.status).toBe(409);
  expect(del.body.code).toBe('HAS_STOCK');
  // 清空庫存後：刪除要原因；成功時位置與設定一併軟刪除，不能重複刪
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  expect((await send('ga_works', 'delete', `/${src.id}`, { expected_updated_at: cur2 })).status).toBe(400);
  expect((await send('ga_works', 'delete', `/${src.id}`, { deletion_reason: ' ', expected_updated_at: cur2 })).status).toBe(400);
  expect((await send('ga_works', 'delete', `/${src.id}`, { deletion_reason: '測試' })).status).toBe(400);
  expect((await send('ga_works', 'delete', `/${src.id}`, { deletion_reason: 'x'.repeat(201), expected_updated_at: cur2 })).status).toBe(400);
  const gone = await Promise.all([
    send('ga_works', 'delete', `/${src.id}`, { deletion_reason: '測試刪除', expected_updated_at: cur2 }),
    send('ga_works', 'delete', `/${src.id}`, { deletion_reason: '測試刪除', expected_updated_at: cur2 }),
  ]);
  expect(gone.map((r) => r.status).sort()).toEqual([200, 404].sort()); // 另一個因為已刪除而找不到
  const dbLoc = await row('ga_inventory_locations', src.id);
  expect(dbLoc.deleted_at).not.toBeNull();
  expect(dbLoc.deletion_reason).toBe('測試刪除');
  const settings = await rowsWhere('ga_inventory_location_parts', 'location_id', src.id);
  expect(settings.every((s) => s.deleted_at && s.is_active === false)).toBe(true);
  expect((await get('ga_works', `/${src.id}`)).status).toBe(404);
  // 啟用：已停用的目的位置沒有庫存、取消調撥後可直接停用再啟用
  const curDst = (await row('ga_inventory_locations', dst.id)).updated_at;
  const offDst = await send('ga_works', 'patch', `/${dst.id}`, { is_active: false, expected_updated_at: curDst });
  expect(offDst.status).toBe(200);
  const onDst = await send('ga_works', 'patch', `/${dst.id}`, { is_active: true, expected_updated_at: offDst.body.data.updated_at });
  expect(onDst.status).toBe(200);
  expect((await row('ga_inventory_locations', dst.id)).is_active).toBe(true);
});

// ----------------------------------------------------------------------------- 位置料件設定
test('C1 批次新增：共用數字多筆一次加入；缺料件查看權限 403；全成或全不變（重複／停用料件／單位錯誤／順序錯誤都整批不寫入）；錯誤帶第 N 筆', async () => {
  const loc = await seedLocation('ZT04', 'BATCH');
  const p1 = await seedPart(partCat.id, 'B-P1');
  const p2 = await seedPart(partCat.id, 'B-P2');
  const p3 = await seedPart(partCat.id, 'B-P3');
  const off = await seedPart(partCat.id, 'B-OFF', { is_active: false });
  const noPurchase = await seedPart(partCat.id, 'B-NP');
  const url = `/${loc.id}/parts`;
  const count = async () => (await rowsWhere('ga_inventory_location_parts', 'location_id', loc.id)).filter((r) => !r.deleted_at).length;

  // 權限：沒有料件查看（只有位置管理）403；沒有位置管理 403
  const noPart = await send('ga_inv_location_edit', 'post', url, { items: [{ part_id: p1.id }] });
  expect(noPart.status).toBe(403);
  expect(noPart.body.error).toContain('料件查看');
  expect((await send('ga_inv_location_view', 'post', url, { items: [{ part_id: p1.id }] })).status).toBe(403);
  expect(await count()).toBe(0);

  // 400：空、過多、格式
  for (const [label, data] of [
    ['沒有項目', { items: [] }], ['沒有 body', {}], ['料件 id 壞', { items: [{ part_id: 'x' }] }], ['順序錯', { items: [{ part_id: p1.id, safety_stock_qty: 9, reorder_point_qty: 1 }] }],
    ['同批重複', { items: [{ part_id: p1.id }, { part_id: p1.id }] }], ['負數', { items: [{ part_id: p1.id, maximum_stock_qty: -5 }] }], ['單位錯', { items: [{ part_id: p1.id, preferred_issue_unit_type: 'BOX' }] }],
  ] as const) expect((await send('ga_works', 'post', url, data)).status, label).toBe(400);
  const many = Array.from({ length: 101 }, (_, i) => ({ part_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  expect((await send('ga_works', 'post', url, { items: many })).status).toBe(400);
  expect(await count()).toBe(0);

  // 整批失敗：停用的料件、沒有採購單位卻選 PURCHASE、不存在的料件；訊息帶第 N 筆與料件名稱；前面已處理的也不留
  const f1 = await send('ga_works', 'post', url, { items: [{ part_id: p1.id }, { part_id: off.id }] });
  expect(f1.status).toBe(400);
  expect(f1.body.error).toContain('第 2 筆');
  expect(f1.body.error).toContain(m7Name('B-OFF'));
  const f2 = await send('ga_works', 'post', url, { items: [{ part_id: p1.id }, { part_id: noPurchase.id, preferred_issue_unit_type: 'PURCHASE' }] });
  expect(f2.status).toBe(400);
  expect(f2.body.error).toContain('第 2 筆');
  const f3 = await send('ga_works', 'post', url, { items: [{ part_id: p1.id }, { part_id: '00000000-0000-4000-8000-0000000000aa' }] });
  expect(f3.status).toBe(400);
  expect(await count()).toBe(0);

  // 成功：三個料件共用數字
  const ok = await send('ga_works', 'post', url, { items: [p1, p2, p3].map((p, i) => ({ part_id: p.id, safety_stock_qty: 2, reorder_point_qty: 5, maximum_stock_qty: 10 + i, preferred_issue_unit_type: 'BASE', notes: '共用備註' })) });
  expect(ok.status).toBe(201);
  expect(ok.body.count).toBe(3);
  const dbRows = (await rowsWhere('ga_inventory_location_parts', 'location_id', loc.id)).filter((r) => !r.deleted_at);
  expect(dbRows).toHaveLength(3);
  expect(dbRows.map((r) => Number(r.maximum_stock_qty)).sort()).toEqual([10, 11, 12]);
  expect(dbRows.every((r) => r.notes === '共用備註' && r.preferred_issue_unit_type === 'BASE' && r.is_active === true)).toBe(true);

  // 已設定過的料件再加：整批擋下，新的那筆也不寫入
  const p4 = await seedPart(partCat.id, 'B-P4');
  const dup = await send('ga_works', 'post', url, { items: [{ part_id: p4.id }, { part_id: p2.id }] });
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('DUPLICATE_PART');
  expect(dup.body.error).toContain('第 2 筆');
  expect(await count()).toBe(3);
  // 單筆舊格式也收
  const single = await send('ga_works', 'post', url, { part_id: p4.id, safety_stock_qty: 1 });
  expect(single.status).toBe(201);
  expect(await count()).toBe(4);
  // 位置停用後不能再加
  await adminDb().from('ga_inventory_locations').update({ is_active: false }).eq('id', loc.id);
  const p5 = await seedPart(partCat.id, 'B-P5');
  expect((await send('ga_works', 'post', url, { items: [{ part_id: p5.id }] })).status).toBe(409);
  await adminDb().from('ga_inventory_locations').update({ is_active: true }).eq('id', loc.id);
});

test('清單（設定）：搜尋、狀態篩選、分頁、庫存數、偏好單位名稱；位置與設定網址要對得起來', async () => {
  const loc = await seedLocation('ZT04', 'SET-LIST');
  const other = await seedLocation('ZT05', 'SET-OTHER');
  const pa = await seedPart(partCat.id, 'SL-Alpha', { purchase_unit: '箱', purchase_to_base_rate: 12 });
  const pb = await seedPart(partCat.id, 'SL-Beta');
  const sa = await seedLocationPart(loc.id, pa.id, { preferred_issue_unit_type: 'PURCHASE', safety_stock_qty: 1, reorder_point_qty: 2, maximum_stock_qty: 3 });
  const sb = await seedLocationPart(loc.id, pb.id, { is_active: false });
  const sOther = await seedLocationPart(other.id, pb.id);
  await seedBalance(loc.id, pa.id, 7.5);
  const all = await get('ga_works', `/${loc.id}/parts`);
  expect(all.body.total).toBe(2);
  const a = all.body.data.find((r: any) => r.id === sa.id);
  expect(a).toMatchObject({ stock_qty: 7.5, resolvedPreferredIssueUnit: '箱' });
  expect(a.part.name).toBe(m7Name('SL-Alpha'));
  expect(all.body.data.find((r: any) => r.id === sb.id).stock_qty).toBe(0);
  expect(ids(await get('ga_works', `/${loc.id}/parts?search=${encodeURIComponent('Alpha')}`))).toEqual([sa.id]);
  expect(ids(await get('ga_works', `/${loc.id}/parts?isActive=false`))).toEqual([sb.id]);
  for (const q of ['a,b', '(x)', '"q"']) expect((await get('ga_works', `/${loc.id}/parts?search=${encodeURIComponent(q)}`)).status, q).toBe(200);
  const pg = await get('ga_works', `/${loc.id}/parts?pageSize=1&page=2`);
  expect(pg.body.meta).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  expect((await get('ga_works', `/${loc.id}/parts?partId=abc`)).status).toBe(400);
  // 網址對不上：拿別的位置網址改設定 → 404，資料不變
  const cross = await send('ga_works', 'patch', `/${loc.id}/parts/${sOther.id}`, { notes: '不該改到', expected_updated_at: sOther.updated_at });
  expect(cross.status).toBe(404);
  expect((await row('ga_inventory_location_parts', sOther.id)).notes).toBeNull();
});

test('C1 逐筆修改與停用／啟用：版本 409、料件與位置不可更換 400、順序錯誤 400；C2 有庫存或進行中調撥不能停用；沒有庫存可停用再啟用', async () => {
  const loc = await seedLocation('ZT04', 'SET-EDIT');
  const dst = await seedLocation('ZT05', 'SET-EDIT-DST');
  const pa = await seedPart(partCat.id, 'SE-A');
  const pb = await seedPart(partCat.id, 'SE-B');
  const s = await seedLocationPart(loc.id, pa.id, { safety_stock_qty: 1, reorder_point_qty: 2, maximum_stock_qty: 3, notes: '原備註' });
  const url = `/${loc.id}/parts/${s.id}`;
  expect((await send('ga_works', 'patch', url, { safety_stock_qty: 2 })).status).toBe(400); // 缺 expected_updated_at
  expect((await send('ga_inv_location_view', 'patch', url, { safety_stock_qty: 2, expected_updated_at: s.updated_at })).status).toBe(403);
  for (const [label, data] of [
    ['換料件', { part_id: pb.id }], ['換位置', { location_id: dst.id }], ['未知欄位', { foo: 1 }], ['順序錯', { safety_stock_qty: 9 }], ['負數', { reorder_point_qty: -1 }], ['單位錯', { preferred_issue_unit_type: 'X' }],
  ] as const) expect((await send('ga_works', 'patch', url, { ...data, expected_updated_at: s.updated_at })).status, label).toBe(400);
  expect(await row('ga_inventory_location_parts', s.id)).toMatchObject({ part_id: pa.id, location_id: loc.id, safety_stock_qty: 1 });

  const ok = await send('ga_works', 'patch', url, { safety_stock_qty: 2, reorder_point_qty: 4, maximum_stock_qty: 8, notes: ' 新備註 ', preferred_issue_unit_type: 'BASE', expected_updated_at: s.updated_at });
  expect(ok.status).toBe(200);
  expect(await row('ga_inventory_location_parts', s.id)).toMatchObject({ safety_stock_qty: 2, reorder_point_qty: 4, maximum_stock_qty: 8, notes: '新備註', preferred_issue_unit_type: 'BASE' });
  const stale = await send('ga_works', 'patch', url, { safety_stock_qty: 3, expected_updated_at: s.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  // 採購單位：料件沒有採購單位時不能選
  const cur = (await row('ga_inventory_location_parts', s.id)).updated_at;
  const pur = await send('ga_works', 'patch', url, { preferred_issue_unit_type: 'PURCHASE', expected_updated_at: cur });
  expect(pur.status).toBe(400);
  expect(pur.body.error).toContain('採購單位');

  // C2：有庫存不能停用
  const bal = await seedBalance(loc.id, pa.id, 3);
  const cur2 = (await row('ga_inventory_location_parts', s.id)).updated_at;
  const stock = await send('ga_works', 'patch', url, { is_active: false, expected_updated_at: cur2 });
  expect(stock.status).toBe(409);
  expect(stock.body.code).toBe('HAS_STOCK');
  expect((await row('ga_inventory_location_parts', s.id)).is_active).toBe(true);
  // 庫存清掉但有進行中調撥（來源或目的位置都算）：不能停用
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  await seedLocationPart(dst.id, pa.id);
  const tr = await seedTransfer(loc.id, dst.id, pa.id, 'SE-T', 'SOURCE_CONFIRMED');
  const open = await send('ga_works', 'patch', url, { is_active: false, expected_updated_at: cur2 });
  expect(open.status).toBe(409);
  expect(open.body.code).toBe('OPEN_TRANSFERS');
  await adminDb().from('ga_inventory_transfers').update({ status: 'CANCELED', cancel_reason: '測試取消' }).eq('id', tr.id);
  const offOk = await send('ga_works', 'patch', url, { is_active: false, expected_updated_at: cur2 });
  expect(offOk.status).toBe(200);
  expect((await row('ga_inventory_location_parts', s.id)).is_active).toBe(false);
  const onOk = await send('ga_works', 'patch', url, { is_active: true, expected_updated_at: offOk.body.data.updated_at });
  expect(onOk.status).toBe(200);
  expect((await row('ga_inventory_location_parts', s.id)).is_active).toBe(true);
});

test('C2 移除設定：原因必填；有庫存或進行中調撥擋；清空後移除（軟刪除），可重新加入同一料件；連點只成功一次', async () => {
  const loc = await seedLocation('ZT04', 'RM');
  const dst = await seedLocation('ZT05', 'RM-DST');
  const pa = await seedPart(partCat.id, 'RM-A');
  const s = await seedLocationPart(loc.id, pa.id);
  await seedLocationPart(dst.id, pa.id);
  const url = `/${loc.id}/parts/${s.id}`;
  expect((await send('ga_works', 'delete', url, { expected_updated_at: s.updated_at })).status).toBe(400);
  expect((await send('ga_works', 'delete', url, { deletion_reason: '  ', expected_updated_at: s.updated_at })).status).toBe(400);
  expect((await send('ga_works', 'delete', url, { deletion_reason: '原因' })).status).toBe(400);
  expect((await send('ga_inv_location_view', 'delete', url, { deletion_reason: '原因', expected_updated_at: s.updated_at })).status).toBe(403);
  const bal = await seedBalance(loc.id, pa.id, 2);
  const stock = await send('ga_works', 'delete', url, { deletion_reason: '原因', expected_updated_at: s.updated_at });
  expect(stock.status).toBe(409);
  expect(stock.body.code).toBe('HAS_STOCK');
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  const tr = await seedTransfer(loc.id, dst.id, pa.id, 'RM-T', 'IN_TRANSIT');
  const open = await send('ga_works', 'delete', url, { deletion_reason: '原因', expected_updated_at: s.updated_at });
  expect(open.status).toBe(409);
  expect(open.body.code).toBe('OPEN_TRANSFERS');
  await adminDb().from('ga_inventory_transfers').update({ status: 'RECEIVED' }).eq('id', tr.id);
  const both = await Promise.all([
    send('ga_works', 'delete', url, { deletion_reason: '移除原因', expected_updated_at: s.updated_at }),
    send('ga_works', 'delete', url, { deletion_reason: '移除原因', expected_updated_at: s.updated_at }),
  ]);
  expect(both.map((r) => r.status).sort()).toEqual([200, 404]);
  expect(await row('ga_inventory_location_parts', s.id)).toMatchObject({ is_active: false, deletion_reason: '移除原因' });
  expect((await row('ga_inventory_location_parts', s.id)).deleted_at).not.toBeNull();
  expect(ids(await get('ga_works', `/${loc.id}/parts`))).toEqual([]);
  const again = await send('ga_works', 'post', `/${loc.id}/parts`, { items: [{ part_id: pa.id }] });
  expect(again.status).toBe(201);
});

// ----------------------------------------------------------------------------- 料件停用保護（C2）
test('C2：料件在任何位置仍有庫存時不能停用（新版料件 API 與資料庫層都擋）；清空後可停用', async () => {
  const loc = await seedLocation('ZT04', 'PS');
  const part = await seedPart(partCat.id, 'PS-P');
  await seedLocationPart(loc.id, part.id);
  const bal = await seedBalance(loc.id, part.id, 4);
  const cur = (await row('ga_parts', part.id)).updated_at;
  const api = await apis.ga_works.patch(`/api/workspace/general-affairs/parts/${part.id}`, { data: { is_active: false, expected_updated_at: cur } });
  expect(api.status()).toBe(409); // 審查補強後資料庫守衛回 HAS_STOCK，伺服器統一對應 409
  expect((await api.json()).error).toContain('仍有庫存');
  expect((await row('ga_parts', part.id)).is_active).toBe(true);
  const direct = await adminDb().from('ga_parts').update({ is_active: false }).eq('id', part.id);
  expect(direct.error?.message || '').toContain('仍有庫存');
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
  const ok = await apis.ga_works.patch(`/api/workspace/general-affairs/parts/${part.id}`, { data: { is_active: false, expected_updated_at: cur } });
  expect(ok.status()).toBe(200);
  expect((await row('ga_parts', part.id)).is_active).toBe(false);
});
