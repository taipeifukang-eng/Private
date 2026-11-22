import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { addDays, taipeiToday } from '../../lib/workspace/general-affairs/asset-fields';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, rpcClientFor, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores,
} from '../support/m7m8-fixtures';

// M7/M8 第 2 批 G06／G08 設備與設施主檔 API（/api/workspace/general-affairs/equipment、facilities）整合層。
// 涵蓋：權限（401／403／404）、Q5 店長只看基本欄位（伺服端挑欄位、搜尋不能探測看不到的欄位）、清單搜尋分頁與保固篩選（台北時間）、
//      新增 1-100 台（全成或全不變）、編輯只更新有改的欄位（specs 合併）與版本衝突、Q10 編輯拒收 store_id／刪除被未結案單擋下／更正所屬門市、
//      Q8 恢復使用並重新啟用 QR（token 不變）、異動紀錄範圍。資料只用測試門市 VW／ZT；結束只刪自己建立的資料。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_equipment_edit', 'ga_facility_view', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string; code: string; name: string };
let facCat: { id: string; code: string; name: string };
let codedCat: { id: string };
let sid: Record<string, string> = {};
let managerA = '';
const rpcClients: Record<string, any> = {};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  for (const k of ['ga_works', 'store_manager']) rpcClients[k] = await rpcClientFor(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  managerA = (await rpcClients.store_manager.auth.getUser()).data.user.id;
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
  const cats = ((await adminDb().from('ga_equipment_categories').select('id,code,parent_id').is('deleted_at', null).eq('is_active', true)).data || []) as any[];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const l2 = cats.find((c) => /^[A-Z]{2}[0-9]{2}$/.test(c.code) && c.parent_id && byId.get(c.parent_id) && !byId.get(c.parent_id).parent_id);
  if (!l2) throw new Error('DEV 找不到可自動產生資產編號的第二層設備分類，停止');
  codedCat = { id: l2.id };
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const send = async (k: string, method: 'post' | 'patch' | 'put' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${BASE}/${p}`, data === undefined ? {} : { data }));
const eqPayload = (suffix: string, storeCode: string, over: Record<string, unknown> = {}) => ({ store_id: sid[storeCode], category_id: eqCat.id, name: m7Name(suffix), brand: 'B', ...over });
const SENSITIVE = ['purchase_amount', 'serial_number', 'barcode', 'notes', 'specs', 'qr_token', 'qr_scan_path', 'purchased_at', 'brand', 'model', 'tags', 'purpose', 'criticality'];

// ----------------------------------------------------------------------------- 權限
test('G06 未登入 401；沒有任何設備權限且不是名單店長的帳號 403（清單、詳情、新增、貼標待辦）', async () => {
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(`${BASE}/equipment`)).status()).toBe(401);
  await anon.dispose();
  const eq = await seedEquipment('ZT01', eqCat.id, 'PERM');
  for (const p of ['equipment', `equipment/${eq.id}`, `equipment/${eq.id}/events`, 'onboarding/tasks', 'onboarding/progress']) expect((await get('denied', p)).status, p).toBe(403);
  expect((await send('denied', 'post', 'equipment', eqPayload('x', 'ZT01'))).status).toBe(403);
  expect(await rowsWhere('ga_equipment', 'name', m7Name('x'))).toEqual([]);
  // 設施帳號沒有設備權限、也不是名單店長：設備清單 403
  expect((await get('ga_facility_view', 'equipment')).status).toBe(403);
  expect((await get('ga_facility_view', 'facilities')).status).toBe(200);
});

test('G06 session：店長（名單身分）看得到設備清冊與貼標待辦入口，但沒有新增、複核；設備查看沒有新增；總務全有', async () => {
  const cap = async (k: string) => (await (await apis[k].get('/api/workspace/session')).json()).capabilities;
  expect(await cap('store_manager')).toMatchObject({ gaEquipment: true, gaOnboardingTasks: true, gaEquipmentCreate: false, gaOnboardingReview: false });
  expect(await cap('ga_equipment_view')).toMatchObject({ gaEquipment: true, gaEquipmentCreate: false, gaOnboardingReview: false });
  expect(await cap('ga_works')).toMatchObject({ gaEquipment: true, gaEquipmentCreate: true, gaOnboardingTasks: true, gaOnboardingReview: true });
  expect(await cap('denied')).toMatchObject({ gaEquipment: false, gaEquipmentCreate: false, gaOnboardingTasks: false, gaOnboardingReview: false });
  const nav = (await (await apis.store_manager.get('/api/workspace/session')).json()).gaNavigation.flatMap((g: any) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
  expect(nav.find((i: any) => i.kind === 'ga-equipment')).toBeTruthy();
  expect(nav.find((i: any) => i.kind === 'ga-onboarding-tasks')).toBeTruthy();
  expect(nav.find((i: any) => i.kind === 'ga-onboarding-review')).toBeUndefined();
});

// ----------------------------------------------------------------------------- Q5 欄位可見範圍
test('Q5 店長只看自己門市設備的基本欄位（資料庫端不取敏感欄位）；他店設備清單看不到、詳情 404、搜尋序號探測不到', async () => {
  const a = await seedEquipment('ZT01', eqCat.id, 'Q5A', { serial_number: 'SN-Q5-ZT', purchase_amount: 98765, notes: '祕密備註', barcode: 'BC-Q5', specs: { purchase_source_supplier: '祕密供應商' }, area: '賣場', location_detail: '門口', has_warranty: true, warranty_end_date: addDays(taipeiToday(), 200) });
  const b = await seedEquipment('VW001', eqCat.id, 'Q5B', { serial_number: 'SN-Q5-VW' });
  const list = await get('store_manager', 'equipment?pageSize=100');
  expect(list.status).toBe(200);
  expect(list.body.permissions).toMatchObject({ level: 'basic', seeFull: false, manage: false });
  const mine = list.body.data.find((r: any) => r.id === a.id);
  expect(mine).toBeTruthy();
  expect(list.body.data.find((r: any) => r.id === b.id)).toBeUndefined();
  for (const k of SENSITIVE) expect(mine, k).not.toHaveProperty(k);
  expect(JSON.stringify(list.body)).not.toMatch(/98765|祕密|SN-Q5|BC-Q5/);
  expect(mine).toMatchObject({ name: m7Name('Q5A'), status: 'ACTIVE', area: '賣場', location_detail: '門口', has_warranty: true });
  expect(mine.store.store_code).toBe('ZT01');
  expect(mine.warranty.state).toBe('active');
  // 詳情
  const d = await get('store_manager', `equipment/${a.id}`);
  expect(d.status).toBe(200);
  for (const k of SENSITIVE) expect(d.body.data, k).not.toHaveProperty(k);
  expect((await get('store_manager', `equipment/${b.id}`)).status).toBe(404);
  // 搜尋：店長用序號搜不到（只能用名稱與編號），總務用序號搜得到
  expect((await get('store_manager', `equipment?search=${encodeURIComponent('SN-Q5-ZT')}`)).body.total).toBe(0);
  expect((await get('ga_works', `equipment?search=${encodeURIComponent('SN-Q5-ZT')}`)).body.total).toBe(1);
  // 另一店店長看不到 A 店設備
  expect((await get('ga_store_manager_b', `equipment/${a.id}`)).status).toBe(404);
  expect((await get('ga_store_manager_b', `equipment?pageSize=100`)).body.data.find((r: any) => r.id === a.id)).toBeUndefined();
  // 總務與設備查看看得到全部欄位
  for (const k of ['ga_works', 'ga_equipment_view']) {
    const full = await get(k, `equipment/${a.id}`);
    expect(full.status, k).toBe(200);
    expect(full.body.data).toMatchObject({ purchase_amount: 98765, serial_number: 'SN-Q5-ZT', notes: '祕密備註', specs: { purchase_source_supplier: '祕密供應商' } });
    expect(full.body.permissions.level).toBe('full');
  }
  // 店長不能新增、編輯、刪除
  expect((await send('store_manager', 'post', 'equipment', eqPayload('SM', 'ZT01'))).status).toBe(403);
  expect((await send('store_manager', 'patch', `equipment/${a.id}`, { name: '改', expected_updated_at: a.updated_at })).status).toBe(403);
  expect((await send('store_manager', 'delete', `equipment/${a.id}`, { reason: '測試' })).status).toBe(403);
  expect((await send('store_manager', 'post', `equipment/${a.id}/correct-store`, { to_store_id: sid.VW001, reason: 'x' })).status).toBe(403);
  expect((await send('store_manager', 'post', `equipment/${a.id}/restore`, { reason: 'x' })).status).toBe(403);
  expect((await row('ga_equipment', a.id)).name).toBe(m7Name('Q5A'));
});

// ----------------------------------------------------------------------------- 清單
test('G06 清單：搜尋含逗號括號不壞、分頁與精確筆數、分類含子孫、排序白名單、保固篩選用台北日期、統計卡', async () => {
  const today = taipeiToday();
  const rows = {
    expired: await seedEquipment('VW002', eqCat.id, 'W-exp', { has_warranty: true, warranty_end_date: addDays(today, -1) }),
    today: await seedEquipment('VW002', eqCat.id, 'W-today', { has_warranty: true, warranty_end_date: today }),
    soon: await seedEquipment('VW002', eqCat.id, 'W-soon', { has_warranty: true, warranty_end_date: addDays(today, 30) }),
    ok: await seedEquipment('VW002', eqCat.id, 'W-ok', { has_warranty: true, warranty_end_date: addDays(today, 31) }),
    missing: await seedEquipment('VW002', eqCat.id, 'W-missing', { has_warranty: true }),
    none: await seedEquipment('VW002', eqCat.id, 'W-none', { has_warranty: false }),
  };
  const ids = (r: any) => r.body.data.map((x: any) => x.id);
  const q = (w: string) => get('ga_works', `equipment?storeId=${sid.VW002}&warranty=${w}&pageSize=100&search=${encodeURIComponent('W-')}`);
  expect(ids(await q('expired'))).toEqual([rows.expired.id]); // 到期日前一天已過保
  expect(ids(await q('expiring')).sort()).toEqual([rows.today.id, rows.soon.id].sort()); // 到期日當天仍在保固內
  expect(ids(await q('active'))).toEqual([rows.ok.id]);
  expect(ids(await q('missing'))).toEqual([rows.missing.id]);
  expect(ids(await q('none'))).toEqual([rows.none.id]);
  expect((await get('ga_works', 'equipment?warranty=bogus')).status).toBe(400);
  const todayRow = (await q('expiring')).body.data.find((x: any) => x.id === rows.today.id);
  expect(todayRow.warranty).toMatchObject({ state: 'expiring', label: '今天到期' });
  // 搜尋輸入逗號、括號、引號不會讓查詢壞掉
  for (const s of ['a,b)(', '"x"', '50%_', "'; drop"]) expect((await get('ga_works', `equipment?search=${encodeURIComponent(s)}`)).status, s).toBe(200);
  // 分頁：pageSize=2，總筆數精確
  const p1 = await get('ga_works', `equipment?storeId=${sid.VW002}&pageSize=2&page=1&search=${encodeURIComponent('W-')}`);
  const p3 = await get('ga_works', `equipment?storeId=${sid.VW002}&pageSize=2&page=3&search=${encodeURIComponent('W-')}`);
  expect(p1.body.total).toBe(6);
  expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 6, totalPages: 3 });
  expect(p1.body.data).toHaveLength(2);
  expect(p3.body.data).toHaveLength(2);
  expect(new Set([...ids(p1), ...ids(p3)]).size).toBe(4);
  // 統計卡：這 6 台中保固需確認 = 過保 1 + 即將到期 2 + 保固日未填 1
  const stat = await get('ga_works', `equipment?storeId=${sid.VW002}&search=${encodeURIComponent('W-')}`);
  expect(stat.body.stats).toMatchObject({ total: 6, warrantyAttention: 4 });
  // 排序白名單：不在名單內的欄位退回預設排序，不會報錯也不會被注入
  expect((await get('ga_works', 'equipment?sortBy=notes;drop&sortDir=asc')).status).toBe(200);
  // 分類含子孫
  const parent = await seedCategory('equipment', 'PARENT');
  const child = (await adminDb().from('ga_equipment_categories').insert({ name: m7Name('CHILD'), code: `${parent.code}C`.toUpperCase(), parent_id: parent.id, sort_order: 1, is_active: true }).select('id').single()).data;
  const inChild = await seedEquipment('VW002', child.id, 'CAT-child');
  const byParent = await get('ga_works', `equipment?categoryId=${parent.id}&pageSize=100`);
  expect(ids(byParent)).toEqual([inChild.id]);
  expect((await get('ga_works', 'equipment?categoryId=not-a-uuid')).status).toBe(400);
  expect((await get('ga_works', 'equipment?storeId=not-a-uuid')).status).toBe(400);
  await adminDb().from('ga_equipment').delete().eq('id', inChild.id);
});

// ----------------------------------------------------------------------------- 新增
test('G07 新增：一次 1-100 台各自獨立、數量與欄位驗證、權限；資產編號自動產生；任一編號重複整批失敗（全成或全不變）', async () => {
  const one = await send('ga_works', 'post', 'equipment', eqPayload('C1', 'ZT02', { serial_number: 'SN-C1', specs: { entry_mode: 'NEW_PURCHASE', purchase_source_supplier: '供應商甲', warranty_claim_method: 'ONLINE_REGISTRATION' } }));
  expect(one.status).toBe(201);
  expect(one.body.createdCount).toBe(1);
  const created = await row('ga_equipment', one.body.data.id);
  expect(created).toMatchObject({ store_id: sid.ZT02, category_id: eqCat.id, serial_number: 'SN-C1', status: 'ACTIVE' });
  expect(created.specs).toMatchObject({ purchase_source_supplier: '供應商甲', warranty_claim_method: 'ONLINE_REGISTRATION' });
  expect(created.created_by).toBeTruthy();
  expect(created.qr_token).toMatch(/^[a-z0-9]{24,64}$/);

  const many = await send('ga_works', 'post', 'equipment', eqPayload('CM', 'ZT02', { quantity: 5, serial_number: 'SN-IGNORED', barcode: 'BC-IGNORED' }));
  expect(many.status).toBe(201);
  expect(many.body.createdCount).toBe(5);
  const manyRows = await rowsWhere('ga_equipment', 'name', m7Name('CM'));
  expect(manyRows).toHaveLength(5);
  expect(new Set(manyRows.map((r) => r.qr_token)).size).toBe(5); // 每台各自的 QR
  expect(manyRows.every((r) => r.serial_number === null && r.barcode === null)).toBe(true); // 多台時序號與條碼不複製

  for (const q of [0, 101, 1.5, 'x']) {
    const bad = await send('ga_works', 'post', 'equipment', eqPayload('CBAD', 'ZT02', { quantity: q }));
    expect(bad.status, String(q)).toBe(400);
  }
  expect(await rowsWhere('ga_equipment', 'name', m7Name('CBAD'))).toEqual([]);
  expect((await send('ga_works', 'post', 'equipment', { ...eqPayload('CV', 'ZT02'), name: ' ' })).status).toBe(400);
  expect((await send('ga_works', 'post', 'equipment', { ...eqPayload('CV', 'ZT02'), store_id: 'x' })).status).toBe(400);
  expect((await send('ga_works', 'post', 'equipment', eqPayload('CV', 'ZT02', { has_warranty: false, warranty_end_date: '2030-01-01' }))).status).toBe(400);
  expect((await send('ga_works', 'post', 'equipment', eqPayload('CV2', 'ZT02', { quantity: 2, asset_code: 'SAME-CODE' }))).status).toBe(400);
  expect((await send('ga_equipment_view', 'post', 'equipment', eqPayload('CV3', 'ZT02'))).status).toBe(403);
  expect((await send('ga_facility_edit', 'post', 'equipment', eqPayload('CV4', 'ZT02'))).status).toBe(403);
  for (const s of ['CV', 'CV2', 'CV3', 'CV4']) expect(await rowsWhere('ga_equipment', 'name', m7Name(s))).toEqual([]);

  // 有購買日期且分類代碼合格：資產編號自動產生，每台不同
  const auto = await send('ga_works', 'post', 'equipment', { store_id: sid.ZT02, category_id: codedCat.id, name: m7Name('AUTO'), quantity: 3, purchased_at: '2026-11-10' });
  expect(auto.status).toBe(201);
  const codes = auto.body.items.map((i: any) => i.asset_code);
  expect(codes.every((c: string) => /^[A-Z]{2}[0-9]{2}20261110[0-9]{3}$/.test(c))).toBe(true);
  expect(new Set(codes).size).toBe(3);

  // 指定的資產編號重複：409，且沒有留下任何一台
  const withCode = await send('ga_works', 'post', 'equipment', eqPayload('CODE1', 'ZT02', { asset_code: `AC-DUP-${Date.now()}` }));
  expect(withCode.status).toBe(201);
  const dup = await send('ga_works', 'post', 'equipment', eqPayload('CODE2', 'ZT02', { asset_code: withCode.body.data.asset_code }));
  expect(dup.status).toBe(409);
  expect(await rowsWhere('ga_equipment', 'name', m7Name('CODE2'))).toEqual([]);

  // 整批全成或全不變：同一個 insert 陳述式裡有一台編號重複，整批都不建立
  const before = (await adminDb().from('ga_equipment').select('id', { count: 'exact', head: true }).like('name', `${m7Name('ATOM')}%`)).count;
  const batch = await rpcClients.ga_works.from('ga_equipment').insert([
    { store_id: sid.ZT02, category_id: eqCat.id, name: m7Name('ATOM-1'), asset_code: `${withCode.body.data.asset_code}-N` },
    { store_id: sid.ZT02, category_id: eqCat.id, name: m7Name('ATOM-2'), asset_code: withCode.body.data.asset_code },
  ]);
  expect(batch.error).toBeTruthy();
  expect((await adminDb().from('ga_equipment').select('id', { count: 'exact', head: true }).like('name', `${m7Name('ATOM')}%`)).count).toBe(before);
});

// ----------------------------------------------------------------------------- 編輯
test('編輯只更新有改的欄位：specs 合併（不再清空供應商與保固申請方式）、sets 空物件不清資料、版本衝突、編號可改並提醒重印', async () => {
  const eq = await seedEquipment('ZT03', eqCat.id, 'E1', { asset_code: `AC-${Date.now()}`, specs: { entry_mode: 'X', purchase_source_supplier: '原廠', warranty_claim_method: 'ONLINE_REGISTRATION', warranty_claim_notes: null }, has_warranty: true, warranty_end_date: '2031-01-01', notes: '舊備註' });
  // 舊版整包送 specs: {} 會清空；新版 specs 合併，什麼都沒改就不寫入
  let r = await send('ga_works', 'patch', `equipment/${eq.id}`, { name: eq.name, specs: {}, expected_updated_at: eq.updated_at });
  expect(r.status).toBe(200);
  expect(r.body.changedFields).toEqual([]);
  expect((await row('ga_equipment', eq.id)).specs).toMatchObject({ purchase_source_supplier: '原廠', warranty_claim_method: 'ONLINE_REGISTRATION' });
  expect((await row('ga_equipment', eq.id)).updated_at).toBe(eq.updated_at);
  // 只改一個欄位：其他欄位與 specs 其他鍵原封不動
  r = await send('ga_works', 'patch', `equipment/${eq.id}`, { location_detail: '新位置', expected_updated_at: eq.updated_at });
  expect(r.status).toBe(200);
  expect(r.body.changedFields).toEqual(['location_detail']);
  let db = await row('ga_equipment', eq.id);
  expect(db).toMatchObject({ location_detail: '新位置', notes: '舊備註', warranty_end_date: '2031-01-01' });
  expect(db.specs).toMatchObject({ purchase_source_supplier: '原廠', warranty_claim_method: 'ONLINE_REGISTRATION' });
  expect(db.updated_by).toBeTruthy();
  // 明確送 null 才清空那一個鍵
  r = await send('ga_works', 'patch', `equipment/${eq.id}`, { specs: { purchase_source_supplier: null }, expected_updated_at: db.updated_at });
  expect(r.status).toBe(200);
  db = await row('ga_equipment', eq.id);
  expect(db.specs.purchase_source_supplier).toBeNull();
  expect(db.specs.warranty_claim_method).toBe('ONLINE_REGISTRATION');
  // 版本衝突：用舊的 updated_at
  const stale = await send('ga_works', 'patch', `equipment/${eq.id}`, { name: m7Name('E1-b'), expected_updated_at: eq.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await row('ga_equipment', eq.id)).name).toBe(eq.name);
  // 缺 expected_updated_at
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { name: m7Name('E1-c') })).status).toBe(400);
  // Q10：不能直接改所屬門市
  const store = await send('ga_works', 'patch', `equipment/${eq.id}`, { store_id: sid.VW001, expected_updated_at: db.updated_at });
  expect(store.status).toBe(400);
  expect(store.body.code).toBe('STORE_NOT_EDITABLE');
  expect(store.body.error).toMatch(/轉移單/);
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.ZT03);
  // 貼標進度不能從編輯畫面直接改
  r = await send('ga_works', 'patch', `equipment/${eq.id}`, { onboarding_status: 'COMPLETED', expected_updated_at: db.updated_at });
  expect(r.status).toBe(200);
  expect((await row('ga_equipment', eq.id)).onboarding_status).not.toBe('COMPLETED');
  // 資產編號可改，並提醒標籤需重印；編號重複 409
  db = await row('ga_equipment', eq.id);
  const newCode = `AC-NEW-${Date.now()}`;
  r = await send('ga_works', 'patch', `equipment/${eq.id}`, { asset_code: newCode, expected_updated_at: db.updated_at });
  expect(r.status).toBe(200);
  expect(r.body.warnings.map((w: any) => w.code)).toContain('LABEL_REPRINT');
  expect((await row('ga_equipment', eq.id)).asset_code).toBe(newCode);
  const other = await seedEquipment('ZT03', eqCat.id, 'E1-other', { asset_code: `AC-OTHER-${Date.now()}` });
  db = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { asset_code: other.asset_code, expected_updated_at: db.updated_at })).status).toBe(409);
  // 取消「有保固」一併清掉到期日；無保固不可單獨填到期日
  db = await row('ga_equipment', eq.id);
  r = await send('ga_works', 'patch', `equipment/${eq.id}`, { has_warranty: false, expected_updated_at: db.updated_at });
  expect(r.status).toBe(200);
  expect(await row('ga_equipment', eq.id)).toMatchObject({ has_warranty: false, warranty_end_date: null });
  db = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { warranty_end_date: '2040-01-01', expected_updated_at: db.updated_at })).status).toBe(400);
  // 驗證錯誤
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { status: 'BOGUS', expected_updated_at: db.updated_at })).status).toBe(400);
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { name: ' ', expected_updated_at: db.updated_at })).status).toBe(400);
  // 設備查看只能看不能改；不存在的 id 404
  expect((await send('ga_equipment_view', 'patch', `equipment/${eq.id}`, { name: 'x', expected_updated_at: db.updated_at })).status).toBe(403);
  expect((await send('ga_works', 'patch', 'equipment/3f2b8c1e-5b0e-4f6a-9d3e-0a1b2c3d4e5f', { name: 'x', expected_updated_at: db.updated_at })).status).toBe(404);
  // 設備管理（細分帳號）可以改
  db = await row('ga_equipment', eq.id);
  expect((await send('ga_equipment_edit', 'patch', `equipment/${eq.id}`, { area: '倉庫', expected_updated_at: db.updated_at })).status).toBe(200);
});

// ----------------------------------------------------------------------------- Q10 刪除、更正；Q8 恢復
test('Q10 刪除：有未結案單 409 並回張數（可改報廢）；已結案才可刪、原因必填；刪除後 QR 作廢', async () => {
  const eq = await seedEquipment('ZT04', eqCat.id, 'D1');
  const req = await seedRepairRequest('ZT04', { equipmentId: eq.id }, 'D1-open', 'IN_PROGRESS', managerA);
  const orders = await get('ga_works', `equipment/${eq.id}/open-orders`);
  expect(orders.body.data).toMatchObject({ open_count: 1, open_transfer_id: null });
  expect((await get('store_manager', `equipment/${eq.id}/open-orders`)).status).toBe(403);
  const blocked = await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '不要了', expected_updated_at: eq.updated_at });
  expect(blocked.status).toBe(409);
  expect(blocked.body).toMatchObject({ code: 'OPEN_ORDERS', open_count: 1 });
  expect(blocked.body.error).toContain('1 張未結案單');
  expect((await row('ga_equipment', eq.id)).deleted_at).toBeNull();
  expect((await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: ' ' })).status).toBe(400);
  expect((await send('ga_equipment_view', 'delete', `equipment/${eq.id}`, { reason: '測試' })).status).toBe(403);
  // 可改為報廢（編輯狀態）：QR 自動作廢
  const cur = await row('ga_equipment', eq.id);
  const scrap = await send('ga_works', 'patch', `equipment/${eq.id}`, { status: 'SCRAPPED', expected_updated_at: cur.updated_at });
  expect(scrap.status).toBe(200);
  expect((await row('ga_equipment', eq.id)).qr_token_revoked_at).toBeTruthy();
  // 需求單結案後才可刪除
  await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', req.id);
  const cur2 = await row('ga_equipment', eq.id);
  const stale = await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '報廢後移除', expected_updated_at: eq.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  const ok = await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '報廢後移除', expected_updated_at: cur2.updated_at });
  expect(ok.status).toBe(200);
  const gone = await row('ga_equipment', eq.id);
  expect(gone.deleted_at).toBeTruthy();
  expect(gone.deletion_reason).toBe('報廢後移除');
  expect(gone.qr_token_revoked_at).toBeTruthy();
  expect((await get('ga_works', `equipment/${eq.id}`)).status).toBe(404);
  expect((await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '再刪' })).status).toBe(404);
});

test('Q10 更正所屬門市：必填原因、不能同店、版本衝突、寫入異動紀錄（含未結案單數）；沒有管理權限做不到', async () => {
  const eq = await seedEquipment('ZT05', eqCat.id, 'CS');
  await seedRepairRequest('ZT05', { equipmentId: eq.id }, 'CS-open', 'ACCEPTED', managerA);
  const url = `equipment/${eq.id}/correct-store`;
  expect((await send('ga_works', 'post', url, { to_store_id: sid.VW002, reason: ' ', expected_updated_at: eq.updated_at })).status).toBe(400);
  expect((await send('ga_works', 'post', url, { to_store_id: sid.ZT05, reason: '同店', expected_updated_at: eq.updated_at })).status).toBe(400);
  expect((await send('ga_works', 'post', url, { to_store_id: 'x', reason: '壞 id' })).status).toBe(400);
  expect((await send('ga_equipment_view', 'post', url, { to_store_id: sid.VW002, reason: '無權限' })).status).toBe(403);
  expect((await send('ga_works', 'post', url, { to_store_id: sid.VW002, reason: '舊資料', expected_updated_at: '2020-01-01T00:00:00+00:00' })).status).toBe(409);
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.ZT05);
  const ok = await send('ga_works', 'post', url, { to_store_id: sid.VW002, reason: '建檔時選錯門市', expected_updated_at: eq.updated_at });
  expect(ok.status).toBe(200);
  expect(ok.body.data.open_count).toBe(1);
  expect((await row('ga_equipment', eq.id)).store_id).toBe(sid.VW002);
  const ev = await get('ga_works', `equipment/${eq.id}/events`);
  expect(ev.body.data).toHaveLength(1);
  expect(ev.body.data[0]).toMatchObject({ event_type: 'STORE_CORRECTION', reason: '建檔時選錯門市', open_request_count: 1, from_store_id: sid.ZT05, to_store_id: sid.VW002 });
  expect(ev.body.data[0].actor_name).toBeTruthy();
  expect(ev.body.data[0].to_store_name).toContain('VW002');
  // 異動紀錄：原門市店長（已不在轉出／轉入門市以外的）仍看得到自己門市涉及的紀錄；無關門市店長看不到
  expect((await get('ga_store_manager_b', `equipment/${eq.id}/events`)).body.data).toEqual([]);
  expect((await get('denied', `equipment/${eq.id}/events`)).status).toBe(403);
});

test('Q8 恢復使用並重新啟用 QR：報廢後 QR 作廢，總務恢復後沿用原 token；原因必填；不需恢復或已刪除不可；沒有管理權限做不到', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'RS');
  const token = eq.qr_token;
  const url = `equipment/${eq.id}/restore`;
  expect((await send('ga_works', 'post', url, { reason: '還好好的', expected_updated_at: eq.updated_at })).status).toBe(409); // 不需恢復
  let cur = await row('ga_equipment', eq.id);
  expect((await send('ga_works', 'patch', `equipment/${eq.id}`, { status: 'SCRAPPED', expected_updated_at: cur.updated_at })).status).toBe(200);
  cur = await row('ga_equipment', eq.id);
  expect(cur.qr_token_revoked_at).toBeTruthy();
  // 已報廢的設備不能直接用編輯把狀態改回來（要走恢復，才能沿用原標籤並留下紀錄）
  const direct = await send('ga_works', 'patch', `equipment/${eq.id}`, { status: 'ACTIVE', expected_updated_at: cur.updated_at });
  expect(direct.status).toBe(400);
  expect(direct.body.code).toBe('USE_RESTORE');
  expect((await send('ga_works', 'post', url, { reason: ' ', expected_updated_at: cur.updated_at })).status).toBe(400);
  expect((await send('ga_equipment_view', 'post', url, { reason: '無權限' })).status).toBe(403);
  expect((await send('store_manager', 'post', url, { reason: '店長不行' })).status).toBe(403);
  const ok = await send('ga_works', 'post', url, { reason: '誤報廢', expected_updated_at: cur.updated_at });
  expect(ok.status).toBe(200);
  const after = await row('ga_equipment', eq.id);
  expect(after).toMatchObject({ status: 'ACTIVE', qr_token: token, qr_token_revoked_at: null });
  const ev = (await get('ga_works', `equipment/${eq.id}/events`)).body.data;
  expect(ev.find((e: any) => e.event_type === 'QR_RESTORED')).toMatchObject({ reason: '誤報廢' });
  expect((await send('ga_works', 'post', url, { reason: '再來一次', expected_updated_at: after.updated_at })).status).toBe(409);
  // 已刪除不可恢復
  expect((await send('ga_works', 'delete', `equipment/${eq.id}`, { reason: '刪除', expected_updated_at: after.updated_at })).status).toBe(200);
  expect((await send('ga_works', 'post', url, { reason: '刪了還想恢復' })).status).toBe(404);
});

// ----------------------------------------------------------------------------- 設施（同規則）
test('G08 設施：同樣的欄位挑選、保固（specs）篩選、新增與編輯（specs 合併）、刪除被未結案單擋下、退役後恢復；權限', async () => {
  const today = taipeiToday();
  const f1 = await seedFacility('ZT01', facCat.id, 'F1', { specs: { facility_has_warranty: true, facility_warranty_end_date: addDays(today, -2), facility_warranty_claim_method: 'OTHER' }, notes: '設施祕密備註', purchase_amount: 55555 });
  const f2 = await seedFacility('VW001', facCat.id, 'F2', { specs: { facility_has_warranty: false } });
  const sm = await get('store_manager', 'facilities?pageSize=100');
  expect(sm.status).toBe(200);
  expect(sm.body.permissions.level).toBe('basic');
  const mine = sm.body.data.find((r: any) => r.id === f1.id);
  expect(mine).toBeTruthy();
  expect(sm.body.data.find((r: any) => r.id === f2.id)).toBeUndefined();
  expect(JSON.stringify(sm.body)).not.toMatch(/55555|祕密|claim|OTHER/);
  expect(mine.warranty.state).toBe('expired');
  for (const k of ['specs', 'notes', 'purchase_amount', 'qr_token']) expect(mine, k).not.toHaveProperty(k);
  const full = await get('ga_facility_view', `facilities/${f1.id}`);
  expect(full.body.data).toMatchObject({ purchase_amount: 55555, notes: '設施祕密備註' });
  expect((await get('ga_facility_view', `equipment?pageSize=1`)).status).toBe(403);
  // 保固篩選
  const expired = await get('ga_facility_edit', `facilities?warranty=expired&search=${encodeURIComponent(m7Name('F'))}`);
  expect(expired.body.data.map((x: any) => x.id)).toEqual([f1.id]);
  expect((await get('ga_facility_edit', `facilities?warranty=none&search=${encodeURIComponent(m7Name('F'))}`)).body.data.map((x: any) => x.id)).toEqual([f2.id]);
  // 新增／編輯（specs 合併、拒收 store_id）
  const created = await send('ga_facility_edit', 'post', 'facilities', { store_id: sid.ZT02, category_id: facCat.id, name: m7Name('FC1'), specs: { facility_has_warranty: true, facility_warranty_end_date: '2032-02-02', facility_warranty_claim_method: 'INVOICE_OR_RECEIPT' } });
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  let db = await row('ga_facilities', id);
  expect((await send('ga_facility_view', 'post', 'facilities', { store_id: sid.ZT02, category_id: facCat.id, name: m7Name('FCX') })).status).toBe(403);
  expect((await send('ga_works', 'post', 'facilities', { store_id: sid.ZT02, category_id: facCat.id, name: m7Name('FCY') })).status).toBe(201); // 總務同時有設施管理
  let r = await send('ga_facility_edit', 'patch', `facilities/${id}`, { area: '後場', specs: {}, expected_updated_at: db.updated_at });
  expect(r.status).toBe(200);
  db = await row('ga_facilities', id);
  expect(db.area).toBe('後場');
  expect(db.specs).toMatchObject({ facility_has_warranty: true, facility_warranty_claim_method: 'INVOICE_OR_RECEIPT' });
  r = await send('ga_facility_edit', 'patch', `facilities/${id}`, { store_id: sid.VW001, expected_updated_at: db.updated_at });
  expect(r.status).toBe(400);
  // 刪除被未結案單擋下
  const open = await seedRepairRequest('ZT02', { facilityId: id }, 'F-open', 'WAITING_GA_REVIEW', managerA);
  const blocked = await send('ga_facility_edit', 'delete', `facilities/${id}`, { reason: '不要了', expected_updated_at: db.updated_at });
  expect(blocked.status).toBe(409);
  expect(blocked.body).toMatchObject({ code: 'OPEN_ORDERS', open_count: 1 });
  expect((await send('ga_facility_view', 'delete', `facilities/${id}`, { reason: '不要了' })).status).toBe(403);
  // 退役後 QR 作廢，可恢復
  db = await row('ga_facilities', id);
  expect((await send('ga_facility_edit', 'patch', `facilities/${id}`, { status: 'RETIRED', expected_updated_at: db.updated_at })).status).toBe(200);
  db = await row('ga_facilities', id);
  expect(db.qr_token_revoked_at).toBeTruthy();
  const token = db.qr_token;
  expect((await send('ga_facility_edit', 'post', `facilities/${id}/restore`, { reason: '誤退役', expected_updated_at: db.updated_at })).status).toBe(200);
  expect(await row('ga_facilities', id)).toMatchObject({ status: 'ACTIVE', qr_token: token, qr_token_revoked_at: null });
  await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', open.id);
  db = await row('ga_facilities', id);
  expect((await send('ga_facility_edit', 'post', `facilities/${id}/correct-store`, { to_store_id: sid.VW002, reason: '建檔錯誤', expected_updated_at: db.updated_at })).status).toBe(200);
  expect((await row('ga_facilities', id)).store_id).toBe(sid.VW002);
});
