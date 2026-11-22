import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { addDays, taipeiToday } from '../../lib/workspace/general-affairs/asset-fields';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, seedCategory, seedFacility, seedRepairRequest, seedFacilityTemplate, stores } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 2 批 G08／G09 設施頁面專屬的 API 行為（/api/workspace/general-affairs/facilities）。設備與設施共用的規則在 G06.assets-api 已測；
// 這裡補：保固統計桶與依保固到期日排序、保固文件一次回傳（簽名網址可下載、基本層級不回文件）、新增送舊版新增頁相同的欄位（specs 完整保留、QR 與貼標預設）、
//      編輯不能直接改所屬門市、設施退役規則（維持舊版：退役自動作廢 QR、有未結案單時刪除被擋可改退役）、店長與無權限者做不到的事。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_facility_view', 'ga_facility_edit', 'ga_equipment_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let facCat: { id: string };
let sid: Record<string, string> = {};
let managerA = '';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  facCat = await seedCategory('facility', 'FC');
  managerA = (await (await apis.store_manager.get('/api/workspace/session')).json()).user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${BASE}/${p}`, data === undefined ? {} : { data }));
const png = makePng({ width: 64, height: 64, inkPixels: 10 });
const warrantySpecs = (end: string | null, over: Record<string, unknown> = {}) => ({ facility_has_warranty: true, ...(end ? { facility_warranty_end_date: end } : {}), ...over });

test('G08 設施清單：保固統計桶與篩選用台北日期、依保固到期日排序（沒填的排最後）、統計是整個查詢範圍的精確筆數', async () => {
  const today = taipeiToday();
  const rows = {
    expired: await seedFacility('VW002', facCat.id, 'W-exp', { specs: warrantySpecs(addDays(today, -1)) }),
    today: await seedFacility('VW002', facCat.id, 'W-today', { specs: warrantySpecs(today) }),
    ok: await seedFacility('VW002', facCat.id, 'W-ok', { specs: warrantySpecs(addDays(today, 90)) }),
    missing: await seedFacility('VW002', facCat.id, 'W-missing', { specs: warrantySpecs(null) }),
    none: await seedFacility('VW002', facCat.id, 'W-none', { specs: { facility_has_warranty: false } }),
  };
  const q = `facilities?storeId=${sid.VW002}&search=${encodeURIComponent('W-')}&pageSize=100`;
  const all = await get('ga_facility_view', `${q}&warrantyStats=1&sortBy=warranty_end_date&sortDir=asc`);
  expect(all.status).toBe(200);
  expect(all.body.total).toBe(5);
  expect(all.body.stats.warrantyBuckets).toEqual({ none: 1, missing: 1, expired: 1, expiring: 1, active: 1 });
  // 依保固到期日由近到遠；沒有日期的（保固日未填、無保固）排在最後
  const order = all.body.data.map((r: any) => r.id);
  expect(order.slice(0, 3)).toEqual([rows.expired.id, rows.today.id, rows.ok.id]);
  expect(new Set(order.slice(3))).toEqual(new Set([rows.missing.id, rows.none.id]));
  // 篩選不影響桶（桶是「不含保固條件」的範圍）
  const only = await get('ga_facility_view', `${q}&warrantyStats=1&warranty=expired`);
  expect(only.body.data.map((r: any) => r.id)).toEqual([rows.expired.id]);
  expect(only.body.stats.warrantyBuckets).toEqual(all.body.stats.warrantyBuckets);
  const todayRow = all.body.data.find((r: any) => r.id === rows.today.id);
  expect(todayRow.warranty).toMatchObject({ state: 'expiring', label: '今天到期', has_warranty: true });
  // 沒帶旗標就不算桶
  expect((await get('ga_facility_view', q)).body.stats).not.toHaveProperty('warrantyBuckets');
});

test('G08 保固文件：保固頁一次回傳每台的保固文件與簽名網址（可下載）；只回保固文件用途；基本層級（店長）不回文件', async () => {
  const f = await seedFacility('ZT01', facCat.id, 'DOC', { specs: warrantySpecs(addDays(taipeiToday(), 200)) });
  const form = (purpose: string, name: string) => ({ resource_type: 'FACILITY', resource_id: f.id, purpose, is_primary: 'false', files: { name, mimeType: 'image/png', buffer: png } });
  expect((await j(await apis.ga_facility_edit.post(`${BASE}/attachments`, { multipart: form('WARRANTY_DOCUMENT', 'm7m8t-warranty.png') }))).status).toBe(201);
  expect((await j(await apis.ga_facility_edit.post(`${BASE}/attachments`, { multipart: form('GENERAL', 'm7m8t-general.png') }))).status).toBe(201);
  const r = await get('ga_facility_view', `facilities?search=${encodeURIComponent(m7Name('DOC'))}&withWarrantyDocs=1`);
  expect(r.status).toBe(200);
  const docs = r.body.data[0].warranty_documents;
  expect(docs.map((d: any) => d.file_name)).toEqual(['m7m8t-warranty.png']);
  expect(docs[0].signed_url).toMatch(/^https:/);
  expect((await fetch(docs[0].signed_url)).status).toBe(200);
  // 沒帶旗標不回文件欄位；店長（基本層級）即使帶旗標也不回
  expect((await get('ga_facility_view', `facilities?search=${encodeURIComponent(m7Name('DOC'))}`)).body.data[0]).not.toHaveProperty('warranty_documents');
  const sm = await get('store_manager', `facilities?search=${encodeURIComponent(m7Name('DOC'))}&withWarrantyDocs=1`);
  expect(sm.body.data[0]).not.toHaveProperty('warranty_documents');
});

test('G08 新增：送舊版新增頁相同的欄位（品牌、型號、位置補充、保固起訖都在 specs）；QR 自動產生、貼標從「待上傳設施照片」開始；任何人先選門市再建', async () => {
  const tpl = await seedFacilityTemplate('TPL', { category_id: facCat.id });
  const payload = {
    store_id: sid.ZT02, category_id: facCat.id, facility_template_id: tpl.id, name: m7Name('NEW'), status: 'ACTIVE', criticality: 'HIGH', area: '收銀區', location_detail: '入口右側',
    quantity: 2, unit: '座', is_fixed_asset: true, installed_at: '2026-01-02', purchased_at: '2026-01-01', purchase_unit_amount: 1500, purchase_amount: 3000, last_renovated_at: '2026-02-01',
    description: '中島架', specs: {
      entry_mode: 'NEW_PURCHASE', facility_brand: 'B', facility_model: 'M', facility_floor_area_description: '二樓', facility_has_warranty: true, facility_warranty_start_date: '2026-01-01',
      facility_warranty_end_date: '2027-01-01', facility_warranty_claim_method: 'OTHER', facility_warranty_description: '供應商保固一年', facility_warranty_claim_notes: '聯絡供應商',
    }, tags: ['a', 'b'], notes: '備註',
  };
  const created = await send('ga_facility_edit', 'post', 'facilities', payload);
  expect(created.status).toBe(201);
  expect(created.body.warnings).toEqual([]);
  const db = await row('ga_facilities', created.body.data.id);
  expect(db).toMatchObject({ store_id: sid.ZT02, quantity: 2, unit: '座', purchase_unit_amount: 1500, purchase_amount: 3000, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', status: 'ACTIVE' });
  expect(db.specs).toEqual(payload.specs);
  expect(db.qr_token).toMatch(/^[a-z0-9]{24,64}$/);
  expect(db.qr_token_revoked_at).toBeNull();
  expect(created.body.data.qr_scan_path).toBe(`/general-affairs/assets/scan/${db.qr_token}`);
  expect(created.body.data.warranty).toMatchObject({ has_warranty: true, end_date: '2027-01-01' });
  // 驗證：缺欄位 400、數量與單位要一起、沒有分類
  for (const bad of [{ ...payload, name: ' ' }, { ...payload, category_id: 'x' }, { ...payload, quantity: 0 }, { ...payload, unit: '' }, { ...payload, status: 'SCRAPPED' }]) {
    expect((await send('ga_facility_edit', 'post', 'facilities', { ...bad, name: bad.name === ' ' ? ' ' : m7Name('BAD') })).status).toBe(400);
  }
  expect(await rowsWhere('ga_facilities', 'name', m7Name('BAD'))).toEqual([]);
});

test('G08 編輯：不能直接改所屬門市（400 並說明）；只送有改的欄位，保固 specs 合併；版本衝突 409；店長與設施查看改不了', async () => {
  const f = await seedFacility('ZT03', facCat.id, 'EDIT', { specs: warrantySpecs('2030-01-01', { facility_brand: '原品牌', facility_warranty_claim_method: 'INVOICE_OR_RECEIPT' }), quantity: 1, unit: '座' });
  const stale = f.updated_at;
  const ok = await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { specs: { facility_warranty_end_date: '2031-05-05' }, area: '倉庫', expected_updated_at: stale });
  expect(ok.status).toBe(200);
  const db = await row('ga_facilities', f.id);
  expect(db.area).toBe('倉庫');
  expect(db.specs).toMatchObject({ facility_brand: '原品牌', facility_warranty_end_date: '2031-05-05', facility_warranty_claim_method: 'INVOICE_OR_RECEIPT' });
  const store = await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { store_id: sid.VW001, expected_updated_at: db.updated_at });
  expect(store.status).toBe(400);
  expect(store.body).toMatchObject({ code: 'STORE_NOT_EDITABLE' });
  expect((await row('ga_facilities', f.id)).store_id).toBe(sid.ZT03);
  expect((await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { name: m7Name('EDIT2'), expected_updated_at: stale })).status).toBe(409);
  expect((await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { name: m7Name('EDIT3') })).status).toBe(400); // 缺 expected_updated_at
  for (const k of ['store_manager', 'ga_facility_view', 'ga_equipment_edit', 'denied']) {
    expect((await send(k, 'patch', `facilities/${f.id}`, { area: '改', expected_updated_at: db.updated_at })).status, k).toBe(403);
  }
  expect((await row('ga_facilities', f.id)).area).toBe('倉庫');
});

test('G08 退役規則維持舊版：退役自動作廢 QR；有未結案單時不能刪除、改退役；總務可恢復並沿用原標籤；店長與設施查看做不到', async () => {
  const f = await seedFacility('ZT04', facCat.id, 'RET');
  const open = await seedRepairRequest('ZT04', { facilityId: f.id }, 'RET-open', 'IN_PROGRESS', managerA);
  const blocked = await send('ga_facility_edit', 'delete', `facilities/${f.id}`, { reason: '不要了', expected_updated_at: f.updated_at });
  expect(blocked.status).toBe(409);
  expect(blocked.body).toMatchObject({ code: 'OPEN_ORDERS', open_count: 1 });
  expect((await row('ga_facilities', f.id)).deleted_at).toBeNull();
  const retire = await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { status: 'RETIRED', expected_updated_at: f.updated_at });
  expect(retire.status).toBe(200);
  let db = await row('ga_facilities', f.id);
  expect(db.qr_token_revoked_at).toBeTruthy();
  const token = db.qr_token;
  // 退役後不能用編輯改回使用中，要用恢復
  const back = await send('ga_facility_edit', 'patch', `facilities/${f.id}`, { status: 'ACTIVE', expected_updated_at: db.updated_at });
  expect(back.status).toBe(400);
  expect(back.body).toMatchObject({ code: 'USE_RESTORE' });
  for (const k of ['store_manager', 'ga_facility_view', 'denied']) expect((await send(k, 'post', `facilities/${f.id}/restore`, { reason: '誤退役' })).status, k).toBe(403);
  const restored = await send('ga_facility_edit', 'post', `facilities/${f.id}/restore`, { reason: '誤退役', expected_updated_at: db.updated_at });
  expect(restored.status).toBe(200);
  db = await row('ga_facilities', f.id);
  expect(db).toMatchObject({ status: 'ACTIVE', qr_token: token, qr_token_revoked_at: null });
  // 未結案單結案後才能刪；異動紀錄有「恢復使用」
  const ev = await get('ga_facility_view', `facilities/${f.id}/events`);
  expect(ev.body.data.map((e: any) => e.event_type)).toContain('QR_RESTORED');
  await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', open.id);
  expect((await send('ga_facility_view', 'delete', `facilities/${f.id}`, { reason: '結案後刪除', expected_updated_at: db.updated_at })).status).toBe(403);
  expect((await send('ga_facility_edit', 'delete', `facilities/${f.id}`, { reason: '結案後刪除', expected_updated_at: db.updated_at })).status).toBe(200);
  expect((await row('ga_facilities', f.id)).deleted_at).toBeTruthy();
});

test('G08 店長（名單身分）只看自己門市設施的基本欄位；設施管理／查看與無權限者的邊界', async () => {
  const a = await seedFacility('ZT01', facCat.id, 'SM-A', { notes: '設施秘密備註', purchase_amount: 77777, specs: warrantySpecs(addDays(taipeiToday(), 60), { facility_brand: '祕密品牌' }) });
  const b = await seedFacility('VW001', facCat.id, 'SM-B');
  const mine = await get('store_manager', `facilities?search=${encodeURIComponent(m7Name('SM-'))}`);
  expect(mine.status).toBe(200);
  expect(mine.body.data.map((r: any) => r.id)).toEqual([a.id]);
  expect(JSON.stringify(mine.body)).not.toMatch(/77777|祕密|秘密/);
  expect(mine.body.data[0]).toMatchObject({ has_warranty: true, warranty: { state: 'active' } });
  expect((await get('store_manager', `facilities/${b.id}`)).status).toBe(404);
  expect((await get('ga_store_manager_b', `facilities/${a.id}`)).status).toBe(404);
  expect((await get('ga_store_manager_b', `facilities/${b.id}`)).status).toBe(200);
  // 店長新增、刪除、更正都是 403
  expect((await send('store_manager', 'post', 'facilities', { store_id: sid.ZT01, category_id: facCat.id, name: m7Name('SMX') })).status).toBe(403);
  expect((await send('store_manager', 'delete', `facilities/${a.id}`, { reason: '測試' })).status).toBe(403);
  expect((await send('store_manager', 'post', `facilities/${a.id}/correct-store`, { to_store_id: sid.VW001, reason: 'x' })).status).toBe(403);
  // 設備管理帳號沒有設施權限：清單與新增 403；無權限帳號全部 403
  expect((await get('ga_equipment_edit', 'facilities')).status).toBe(403);
  expect((await send('ga_equipment_edit', 'post', 'facilities', { store_id: sid.ZT01, category_id: facCat.id, name: m7Name('EQX') })).status).toBe(403);
  for (const p of ['facilities', `facilities/${a.id}`, `facilities/${a.id}/events`, 'asset-maintenance/history?type=facility', 'asset-maintenance/summary?type=facility']) expect((await get('denied', p)).status, p).toBe(403);
  // 設施查看不能新增，總務可以
  expect((await send('ga_facility_view', 'post', 'facilities', { store_id: sid.ZT01, category_id: facCat.id, name: m7Name('FVX') })).status).toBe(403);
  expect(await rowsWhere('ga_facilities', 'name', m7Name('SMX'))).toEqual([]);
  expect(await rowsWhere('ga_facilities', 'name', m7Name('EQX'))).toEqual([]);
  expect(await rowsWhere('ga_facilities', 'name', m7Name('FVX'))).toEqual([]);
});
