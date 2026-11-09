import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedFacility, seedRepairRequest, stores } from '../support/m7m8-fixtures';

// M7/M8 第 2 批 G09 維修紀錄 API（/api/workspace/general-affairs/asset-maintenance/**）整合層（Q11：改讀需求單與其工單、完整分頁）。
// 涵蓋：逐筆與彙總（只含報修類、設備與設施分開）、分頁與精確筆數（超過舊版 100 筆）、搜尋含逗號括號、狀態與日期與門市篩選、
//      範圍（總務看全部、門市負責人只看自己門市且看不到處理人姓名、他店看不到、無權限 403）、參數驗證 400、唯讀（寫入 405）。
const BASE = '/api/workspace/general-affairs/asset-maintenance';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_facility_view', 'ga_equipment_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string };
let facCat: { id: string };
let managerA = '';
let sid: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
  managerA = (await (await apis.store_manager.get('/api/workspace/session')).json()).user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const mine = (rows: any[]) => rows.filter((r) => String(r.title).startsWith(m7Name('')));
const withWo = async (reqId: string, storeCode: string, suffix: string, status: string) => {
  const wo = (await adminDb().from('maintenance_requests').insert({ store_id: sid[storeCode], title: m7Name(suffix), reported_by: managerA, reporter_name: 'm7m8', status, assignee_name: '王處理' }).select('id').single()).data;
  await adminDb().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', reqId);
  return wo.id as string;
};

test('逐筆：只含報修類需求單（添購不算）、設備與設施分開、帶工單狀態；總務看到處理人姓名', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'H-EQ');
  const fac = await seedFacility('ZT01', facCat.id, 'H-FAC');
  const r1 = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'H-r1', 'IN_PROGRESS', managerA);
  await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'H-r2', 'COMPLETED', managerA);
  await seedRepairRequest('ZT01', { facilityId: fac.id }, 'H-r3', 'WAITING_GA_REVIEW', managerA);
  await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'H-purchase', 'IN_PROGRESS', managerA, { request_type: 'PURCHASE_SUPPLEMENT' });
  await withWo(r1.id, 'ZT01', 'H-wo1', 'PROCESSING');
  const q = `q=${encodeURIComponent(m7Name('H-'))}&pageSize=100`;
  const e = await get('ga_works', `history?type=equipment&${q}`);
  expect(e.status).toBe(200);
  const titles = e.body.data.map((r: any) => r.title).sort();
  expect(titles).toEqual([m7Name('H-r1'), m7Name('H-r2')].sort());
  const row1 = e.body.data.find((r: any) => r.id === r1.id);
  expect(row1).toMatchObject({ main_status: 'IN_PROGRESS', asset_id: eq.id, asset_name: eq.name, store_code: 'ZT01', work_order: { status: 'PROCESSING', assignee_name: '王處理' } });
  expect(e.body.permissions).toEqual({ seeAll: true, seeAssignee: true });
  expect(e.body.total).toBe(2);
  const f = await get('ga_works', `history?type=facility&${q}`);
  expect(f.body.data.map((r: any) => r.title)).toEqual([m7Name('H-r3')]);
  // 不帶類型：兩種都有；每台設備的彙總
  expect((await get('ga_works', `history?${q}`)).body.total).toBe(3);
  const sum = await get('ga_works', `summary?type=equipment&q=${encodeURIComponent(eq.name)}`);
  expect(sum.body.data).toHaveLength(1);
  expect(sum.body.data[0]).toMatchObject({ asset_id: eq.id, repair_count: 2, open_count: 1, store_code: 'ZT01' });
  // 只看某一台
  expect((await get('ga_works', `history?type=equipment&assetId=${eq.id}`)).body.total).toBe(2);
});

test('篩選：狀態（未結案、已結案、單一狀態）、日期、門市、搜尋含逗號與括號不壞；參數錯誤 400', async () => {
  const eq = await seedEquipment('ZT02', eqCat.id, 'F-EQ');
  await seedRepairRequest('ZT02', { equipmentId: eq.id }, 'F-open', 'PENDING_INTAKE', managerA);
  await seedRepairRequest('ZT02', { equipmentId: eq.id }, 'F-done', 'COMPLETED', managerA);
  await seedRepairRequest('ZT02', { equipmentId: eq.id }, 'F-rej', 'REJECTED', managerA);
  const base = `history?type=equipment&storeId=${sid.ZT02}&assetId=${eq.id}&pageSize=100`;
  const titles = async (extra: string) => (await get('ga_works', `${base}${extra}`)).body.data.map((r: any) => String(r.title).replace(m7Name(''), '')).sort();
  expect(await titles('')).toEqual(['F-done', 'F-open', 'F-rej']);
  expect(await titles('&status=OPEN')).toEqual(['F-open']);
  expect(await titles('&status=CLOSED')).toEqual(['F-done', 'F-rej']);
  expect(await titles('&status=REJECTED')).toEqual(['F-rej']);
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  expect(await titles(`&from=${today}&to=${today}`)).toHaveLength(3);
  expect(await titles('&from=2000-01-01&to=2000-01-02')).toEqual([]);
  expect((await get('ga_works', `history?type=equipment&storeId=${sid.ZT03}&assetId=${eq.id}`)).body.total).toBe(0);
  for (const s of ['a,b)(', '")', '螺絲(M4),長', '100%', 'x_y']) expect((await get('ga_works', `history?type=equipment&q=${encodeURIComponent(s)}`)).status, s).toBe(200);
  expect((await get('ga_works', 'history?type=bogus')).status).toBe(400);
  expect((await get('ga_works', 'history?status=NOPE')).status).toBe(400);
  expect((await get('ga_works', 'history?from=2026/01/01')).status).toBe(400);
  expect((await get('ga_works', 'history?storeId=abc')).status).toBe(400);
  expect((await get('ga_works', 'history?assetId=abc')).status).toBe(400);
  expect((await get('ga_works', 'summary')).status).toBe(400); // 彙總必須指定類型
  expect((await get('ga_works', 'nothing')).status).toBe(404);
});

test('分頁與精確筆數：超過舊版 100 筆上限也完整可翻頁，總筆數精確', async () => {
  const eq = await seedEquipment('ZT04', eqCat.id, 'P-EQ');
  const rows = Array.from({ length: 105 }, (_, i) => ({
    store_id: sid.ZT04, created_by: managerA, request_type: 'REPAIR', title: m7Name(`P-${String(i).padStart(3, '0')}`), description: 'm7m8 測試', resource_type: 'EQUIPMENT', equipment_id: eq.id, main_status: 'COMPLETED',
  }));
  const ins = await adminDb().from('ga_service_requests').insert(rows);
  expect(ins.error).toBeNull();
  const p1 = await get('ga_works', `history?type=equipment&assetId=${eq.id}&pageSize=100&page=1`);
  const p2 = await get('ga_works', `history?type=equipment&assetId=${eq.id}&pageSize=100&page=2`);
  expect(p1.body.total).toBe(105);
  expect(p1.body.data).toHaveLength(100);
  expect(p2.body.data).toHaveLength(5);
  expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 100, total: 105, totalPages: 2 });
  const ids = new Set([...p1.body.data, ...p2.body.data].map((r: any) => r.id));
  expect(ids.size).toBe(105); // 沒有重複也沒有漏
  expect((await get('ga_works', `history?type=equipment&assetId=${eq.id}&pageSize=500`)).body.data.length).toBe(100); // 單頁上限 100
  const sum = await get('ga_works', `summary?type=equipment&q=${encodeURIComponent(eq.name)}`);
  expect(sum.body.data[0]).toMatchObject({ repair_count: 105, open_count: 0 });
});

test('範圍：門市負責人只看自己門市且看不到處理人；他店店長看不到；設備／設施查看與管理者看全部；跨類型與無權限都被擋', async () => {
  const a = await seedEquipment('ZT01', eqCat.id, 'S-A');
  const b = await seedEquipment('VW001', eqCat.id, 'S-B');
  const ra = await seedRepairRequest('ZT01', { equipmentId: a.id }, 'S-ra', 'IN_PROGRESS', managerA);
  const rb = await seedRepairRequest('VW001', { equipmentId: b.id }, 'S-rb', 'IN_PROGRESS', managerA);
  await withWo(ra.id, 'ZT01', 'S-woa', 'ACCEPTED');
  await withWo(rb.id, 'VW001', 'S-wob', 'ACCEPTED');
  const q = `type=equipment&q=${encodeURIComponent(m7Name('S-'))}&pageSize=100`;
  // A 店店長：只有 A 店，看不到處理人姓名
  const sm = await get('store_manager', `history?${q}`);
  expect(sm.status).toBe(200);
  expect(sm.body.data.map((r: any) => r.id)).toEqual([ra.id]);
  expect(sm.body.permissions).toEqual({ seeAll: false, seeAssignee: false });
  expect(sm.body.data[0].work_order.assignee_name ?? null).toBeNull();
  expect(JSON.stringify(sm.body)).not.toContain('王處理');
  // B 店店長：只有 B 店
  expect((await get('ga_store_manager_b', `history?${q}`)).body.data.map((r: any) => r.id)).toEqual([rb.id]);
  // 店長用 storeId 指定他店：結果是空（不是他店資料）
  expect((await get('store_manager', `history?${q}&storeId=${sid.VW001}`)).body.total).toBe(0);
  // 彙總同樣只看自己門市
  const smSum = await get('store_manager', `summary?type=equipment&q=${encodeURIComponent(m7Name('S-'))}`);
  expect(smSum.body.data.map((r: any) => r.asset_id)).toEqual([a.id]);
  // 設備查看、設備管理、總務：看全部
  for (const k of ['ga_equipment_view', 'ga_equipment_edit', 'ga_works']) {
    const r = await get(k, `history?${q}`);
    expect(r.status, k).toBe(200);
    expect(r.body.data.map((x: any) => x.id).sort(), k).toEqual([ra.id, rb.id].sort());
    expect(r.body.permissions.seeAssignee, k).toBe(true);
  }
  // 只有設施權限的帳號不能用 type=equipment 讀設備維修紀錄（也不是名單店長）：403；改讀設施則可以
  expect((await get('ga_facility_view', `history?${q}`)).status).toBe(403);
  expect((await get('ga_facility_view', 'summary?type=equipment')).status).toBe(403);
  expect((await get('ga_facility_view', 'history?type=facility')).status).toBe(200);
  // 只有設備權限的帳號不能讀設施的
  expect((await get('ga_equipment_edit', 'history?type=facility')).status).toBe(403);
  // 無權限
  for (const p of ['history?type=equipment', 'history?type=facility', 'history', 'summary?type=equipment']) expect((await get('denied', p)).status, p).toBe(403);
  expect((await j(await apis.denied.get(BASE + '/history?type=equipment'))).body.error).toMatch(/沒有查看維修紀錄/);
  // 唯讀：寫入一律 405
  expect((await j(await apis.ga_works.post(`${BASE}/history`, { data: {} }))).status).toBe(405);
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get(`${BASE}/history?type=equipment`)).status()).toBe(401);
  await anon.dispose();
});
