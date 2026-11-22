import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, rowsWhere, seedCategory, seedEquipment, seedFacility, row, stores } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 2 批 建檔貼標流程 API（/api/workspace/general-affairs/onboarding/**）整合層：設備與設施共用同一套流程（解讀 (b)）。
// 流程：待上傳照片 → 待上傳貼標照 → 待總務複核 → 完成；退回須填原因且兩項照片都要重傳（解讀 (f)）。
// 涵蓋：店長只看自己門市的待辦（取代舊版 100 筆上限）、上傳（驗證圖片／4MB／狀態順序、失敗清理儲存空間、重傳只留一張主圖）、
//      總務複核（通過、退回兩項都要求、重複複核 409）、權限（店長不能複核、他店店長不能替別店上傳）、進度完成率。
const BASE = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_facility_edit', 'store_manager', 'ga_store_manager_b', 'denied'];
let eqCat: { id: string };
let facCat: { id: string };
let sid: Record<string, string> = {};
const png = makePng({ width: 64, height: 64, inkPixels: 10 });

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
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(`${BASE}/${p}`));
const post = async (k: string, p: string, data: unknown) => j(await apis[k].post(`${BASE}/${p}`, { data }));
const upload = async (k: string, type: 'EQUIPMENT' | 'FACILITY', id: string, purpose: string, file = { name: 'p.png', mimeType: 'image/png', buffer: png }) =>
  j(await apis[k].post(`${BASE}/onboarding/photo`, { multipart: { assetType: type, assetId: id, purpose, file } }));
const attachments = async (id: string) => ((await adminDb().from('ga_resource_attachments').select('*').eq('resource_id', id).is('deleted_at', null)).data || []) as any[];
const tasksOf = async (k: string, qs = '') => (await get(k, `onboarding/tasks?pageSize=100${qs}`)).body;

test('貼標待辦：店長只看自己門市（設備與設施合併）、他店店長看不到、沒有權限 403、總務看全部且可篩門市與類型', async () => {
  const a1 = await seedEquipment('ZT01', eqCat.id, 'OB-A1');
  const a2 = await seedFacility('ZT01', facCat.id, 'OB-A2');
  const b1 = await seedEquipment('VW001', eqCat.id, 'OB-B1');
  const mine = await tasksOf('store_manager');
  const ids = mine.data.map((r: any) => r.id);
  expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]));
  expect(ids).not.toContain(b1.id);
  const row1 = mine.data.find((r: any) => r.id === a1.id);
  expect(row1).toMatchObject({ asset_type: 'EQUIPMENT', onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', store_code: 'ZT01' });
  expect(row1).not.toHaveProperty('purchase_amount');
  expect(mine.data.find((r: any) => r.id === a2.id).asset_type).toBe('FACILITY');
  expect((await tasksOf('ga_store_manager_b')).data.map((r: any) => r.id)).toContain(b1.id);
  expect((await tasksOf('ga_store_manager_b')).data.map((r: any) => r.id)).not.toContain(a1.id);
  // 總務看全部，並可篩選
  const all = await tasksOf('ga_works');
  expect(all.data.map((r: any) => r.id)).toEqual(expect.arrayContaining([a1.id, a2.id, b1.id]));
  expect((await tasksOf('ga_works', `&assetType=FACILITY&storeId=${sid.ZT01}`)).data.map((r: any) => r.id)).toContain(a2.id);
  expect((await tasksOf('ga_works', `&assetType=FACILITY&storeId=${sid.ZT01}`)).data.map((r: any) => r.id)).not.toContain(a1.id);
  expect((await tasksOf('ga_works', `&q=${encodeURIComponent('OB-A1')}`)).total).toBe(1);
  // 參數錯誤與權限
  expect((await get('ga_works', 'onboarding/tasks?statuses=BOGUS')).status).toBe(400);
  expect((await get('ga_works', 'onboarding/tasks?assetType=PART')).status).toBe(400);
  expect((await get('ga_works', 'onboarding/tasks?storeId=x')).status).toBe(400);
  expect((await get('denied', 'onboarding/tasks')).status).toBe(403);
  // 精確筆數與分頁（不是只載入 100 筆）
  const page = await get('ga_works', `onboarding/tasks?pageSize=1&page=2`);
  expect(page.body.meta).toMatchObject({ page: 2, pageSize: 1 });
  expect(page.body.total).toBeGreaterThanOrEqual(3);
});

test('店長上傳：設備照片 → 貼標位置照片 → 待總務複核；順序錯、非圖片、超過 4MB、他店、沒有權限都被擋，失敗不留檔案', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'OB-UP');
  // 順序錯：還在待上傳設備照片就傳貼標照 -> 409，且沒有留下檔案或附件
  const early = await upload('store_manager', 'EQUIPMENT', eq.id, 'LABEL_POSITION_IMAGE');
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('STALE');
  expect(await attachments(eq.id)).toEqual([]);
  const ls = await adminDb().storage.from('general-affairs-attachments').list(`equipment/${eq.id}/label_position_image`);
  expect(ls.data || []).toEqual([]);
  // 非圖片、超過大小、缺檔案、用途錯誤
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE', { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })).status).toBe(400);
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 10, 1) })).status).toBe(400);
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'GENERAL')).status).toBe(400);
  expect((await j(await apis.store_manager.post(`${BASE}/onboarding/photo`, { multipart: { assetType: 'EQUIPMENT', assetId: eq.id, purpose: 'PRIMARY_IMAGE' } }))).status).toBe(400);
  expect((await upload('store_manager', 'EQUIPMENT', 'x', 'PRIMARY_IMAGE')).status).toBe(400);
  // 他店店長、沒有權限者：404／403，沒有任何檔案進儲存空間
  expect([403, 404]).toContain((await upload('ga_store_manager_b', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE')).status);
  expect([403, 404]).toContain((await upload('denied', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE')).status);
  expect((await upload('ga_equipment_view', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE')).status).toBe(403); // 只有查看權限，不是名單店長、也沒有管理權限
  expect(await attachments(eq.id)).toEqual([]);
  expect((await ls_(eq.id, 'primary_image')).length).toBe(0);
  // 正常流程
  const first = await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE');
  expect(first.status).toBe(201);
  expect(first.body.data.onboarding_status).toBe('NEEDS_LABEL_PHOTO');
  expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('NEEDS_LABEL_PHOTO');
  expect((await ls_(eq.id, 'primary_image')).length).toBe(1);
  // 這時再傳一次設備照片（例如重複點擊）：狀態已前進，409，且不留多餘檔案
  const again = await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE');
  expect(again.status).toBe(409);
  expect((await ls_(eq.id, 'primary_image')).length).toBe(1);
  const second = await upload('store_manager', 'EQUIPMENT', eq.id, 'LABEL_POSITION_IMAGE');
  expect(second.status).toBe(201);
  expect(second.body.data.onboarding_status).toBe('PENDING_GA_REVIEW');
  const atts = await attachments(eq.id);
  expect(atts.map((a) => a.purpose).sort()).toEqual(['LABEL_POSITION_IMAGE', 'PRIMARY_IMAGE']);
  expect(atts.find((a) => a.purpose === 'PRIMARY_IMAGE').is_primary).toBe(true);
  expect(atts.every((a) => a.storage_bucket === 'general-affairs-attachments' && a.content_type === 'image/png')).toBe(true);
  // 待複核分頁：店長看得到自己送出的，簽名網址可讀到照片
  const review = (await tasksOf('store_manager', '&statuses=PENDING_GA_REVIEW')).data.find((r: any) => r.id === eq.id);
  expect(review.photos.primary.url).toMatch(/^https?:\/\//);
  expect((await fetch(review.photos.primary.url)).status).toBe(200);
});
const ls_ = async (id: string, purpose: string) => ((await adminDb().storage.from('general-affairs-attachments').list(`equipment/${id}/${purpose}`)).data || []) as any[];

test('總務複核：店長與設備查看不能複核；退回必填原因；退回後兩項都要重傳（主圖只留一張）；通過後完成；重複複核 409', async () => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'OB-RV');
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE')).status).toBe(201);
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'LABEL_POSITION_IMAGE')).status).toBe(201);
  const body = (action: string, note?: string) => ({ assetType: 'EQUIPMENT', assetId: eq.id, action, note });
  // 權限
  expect((await post('store_manager', 'onboarding/review', body('approve'))).status).toBe(403);
  expect((await get('store_manager', 'onboarding/review')).status).toBe(403);
  expect((await post('ga_equipment_view', 'onboarding/review', body('approve'))).status).toBe(403);
  expect((await get('ga_equipment_view', 'onboarding/review')).status).toBe(200); // 查看可看清單
  expect((await post('ga_facility_edit', 'onboarding/review', body('approve'))).status).toBe(403); // 設施管理不能複核設備
  expect((await post('denied', 'onboarding/review', body('approve'))).status).toBe(403);
  expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('PENDING_GA_REVIEW');
  // 驗證
  expect((await post('ga_works', 'onboarding/review', body('reject', ' '))).status).toBe(400);
  expect((await post('ga_works', 'onboarding/review', body('bogus'))).status).toBe(400);
  expect((await post('ga_works', 'onboarding/review', { ...body('approve'), assetType: 'PART' })).status).toBe(400);
  // 複核清單
  const rv = await get('ga_works', 'onboarding/review?pageSize=100');
  expect(rv.status).toBe(200);
  const card = rv.body.data.find((r: any) => r.id === eq.id);
  expect(card.photos.primary.url).toBeTruthy();
  expect(card.photos.label.url).toBeTruthy();
  expect(rv.body.permissions.review).toBe(true);
  // 退回：兩項照片旗標都設為需重拍，回到待上傳設備照片，並記錄原因
  const rej = await post('ga_works', 'onboarding/review', body('reject', '貼標位置看不清楚'));
  expect(rej.status).toBe(200);
  let db = await row('ga_equipment', eq.id);
  expect(db).toMatchObject({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true, onboarding_review_note: '貼標位置看不清楚' });
  expect(db.onboarding_reviewed_by).toBeTruthy();
  const back = (await tasksOf('store_manager')).data.find((r: any) => r.id === eq.id);
  expect(back).toMatchObject({ review_note: '貼標位置看不清楚', requires_primary_photo: true, requires_label_photo: true });
  // 店長重傳兩張；舊主圖降級（同資源同用途只有一張主圖）
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'PRIMARY_IMAGE')).status).toBe(201);
  expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('NEEDS_LABEL_PHOTO');
  expect((await upload('store_manager', 'EQUIPMENT', eq.id, 'LABEL_POSITION_IMAGE')).status).toBe(201);
  expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('PENDING_GA_REVIEW');
  const primaries = (await attachments(eq.id)).filter((a) => a.purpose === 'PRIMARY_IMAGE');
  expect(primaries.length).toBe(2);
  expect(primaries.filter((a) => a.is_primary).length).toBe(1);
  // 通過
  const ok = await post('ga_works', 'onboarding/review', body('approve', '照片清楚'));
  expect(ok.status).toBe(200);
  db = await row('ga_equipment', eq.id);
  expect(db).toMatchObject({ onboarding_status: 'COMPLETED', onboarding_requires_primary_photo: false, onboarding_requires_label_photo: false, onboarding_review_note: '照片清楚' });
  const again = await post('ga_works', 'onboarding/review', body('approve'));
  expect(again.status).toBe(409);
  expect(again.body.code).toBe('STALE');
  // 完成後不再出現在待辦與待複核
  expect((await tasksOf('store_manager')).data.map((r: any) => r.id)).not.toContain(eq.id);
  expect((await get('ga_works', 'onboarding/review?pageSize=100')).body.data.map((r: any) => r.id)).not.toContain(eq.id);
  expect((await tasksOf('store_manager', '&statuses=COMPLETED')).data.map((r: any) => r.id)).toContain(eq.id);
});

test('設施比照設備：待上傳設施照片 → 貼標照 → 複核（設施管理者可複核，設備管理不能複核設施）；進度完成率', async () => {
  const fac = await seedFacility('ZT02', facCat.id, 'OB-FAC');
  const eq = await seedEquipment('ZT02', eqCat.id, 'OB-FEQ');
  // ZT02 沒有店長名單：總務能代傳（有管理權限），店長帳號不是名單成員不能傳
  expect([403, 404]).toContain((await upload('store_manager', 'FACILITY', fac.id, 'PRIMARY_IMAGE')).status);
  expect((await upload('ga_facility_edit', 'FACILITY', fac.id, 'PRIMARY_IMAGE')).status).toBe(201);
  expect((await upload('ga_facility_edit', 'FACILITY', fac.id, 'LABEL_POSITION_IMAGE')).status).toBe(201);
  expect((await row('ga_facilities', fac.id)).onboarding_status).toBe('PENDING_GA_REVIEW');
  const body = (action: string, note?: string) => ({ assetType: 'FACILITY', assetId: fac.id, action, note });
  expect((await post('ga_equipment_view', 'onboarding/review', body('approve'))).status).toBe(403);
  expect((await post('ga_facility_edit', 'onboarding/review', body('reject', '重拍'))).status).toBe(200);
  expect(await row('ga_facilities', fac.id)).toMatchObject({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true });
  expect((await upload('ga_facility_edit', 'FACILITY', fac.id, 'PRIMARY_IMAGE')).status).toBe(201);
  expect((await upload('ga_facility_edit', 'FACILITY', fac.id, 'LABEL_POSITION_IMAGE')).status).toBe(201);
  expect((await post('ga_works', 'onboarding/review', body('approve'))).status).toBe(200);
  expect((await row('ga_facilities', fac.id)).onboarding_status).toBe('COMPLETED');
  // 進度：ZT02 有設備 1 台（未完成）、設施 1 筆（完成）-> 50%
  const prog = await get('ga_works', `onboarding/progress?storeId=${sid.ZT02}`);
  expect(prog.status).toBe(200);
  const s = prog.body.data.find((x: any) => x.store_id === sid.ZT02);
  expect(s).toMatchObject({ total: 2, completed: 1, completion_rate: 50 });
  expect(s.equipment).toMatchObject({ total: 1, needs_photo: 1, completed: 0 });
  expect(s.facility).toMatchObject({ total: 1, completed: 1 });
  // 已報廢設備不算進度；沒有資產的門市完成率為 null（不是 100%）
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', eq.id);
  const prog2 = (await get('ga_works', `onboarding/progress?storeId=${sid.ZT02}`)).body.data[0];
  expect(prog2).toMatchObject({ total: 1, completed: 1, completion_rate: 100 });
  const empty = (await get('ga_works', `onboarding/progress?storeId=${sid.ZT05}`)).body.data[0];
  expect(empty).toMatchObject({ total: 0, completion_rate: null });
  // 店長只看自己的門市；沒有權限 403
  const mine = (await get('store_manager', 'onboarding/progress')).body.data;
  expect(mine.map((x: any) => x.store_code)).toEqual(['ZT01']);
  expect((await get('denied', 'onboarding/progress')).status).toBe(403);
  expect((await get('ga_works', 'onboarding/progress?storeId=x')).status).toBe(400);
  expect(await rowsWhere('ga_resource_attachments', 'resource_id', fac.id)).not.toHaveLength(0);
});
