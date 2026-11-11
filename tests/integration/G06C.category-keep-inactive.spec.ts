import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, seedCategory, seedEquipment, seedFacility, stores } from '../support/m7m8-fixtures';

// M7/M8 第 3 批 C13（2026-11-11 問卷）：設備分類或設施分類被停用後，設備與設施只要「不換分類」就能修改其他欄位；
// 新增或換到停用分類仍被擋。這是資料庫驗證觸發器的規則，所以新版（Vue）API、舊版（Next）API 與資料庫直接寫入的行為都一致。
// 回歸命名 G06C（設備）、G08C（設施）；G06／G08 本身另行重跑。
const NEW = '/api/workspace/general-affairs';
const OLD = '/api/general-affairs';
const MSG_EQ = '設備分類必須啟用';
const MSG_FAC = '設施分類必須啟用';
const apis: Record<string, APIRequestContext> = {};
let sid: Record<string, string> = {};
let eqOn: { id: string };
let eqOff: { id: string };
let eqOff2: { id: string };
let facOn: { id: string };
let facOff: { id: string };
let facOff2: { id: string };
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ['ga_works', 'ga_equipment_edit', 'ga_facility_edit', 'ga_equipment_view']) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqOn = await seedCategory('equipment', 'KON');
  eqOff = await seedCategory('equipment', 'KOFF');
  eqOff2 = await seedCategory('equipment', 'KOFF2', { is_active: false });
  facOn = await seedCategory('facility', 'KON');
  facOff = await seedCategory('facility', 'KOFF');
  facOff2 = await seedCategory('facility', 'KOFF2', { is_active: false });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const disable = async (table: string, id: string) => {
  const r = await adminDb().from(table).update({ is_active: false }).eq('id', id);
  expect(r.error).toBeNull();
};

test('G06C 資料庫層：設備分類停用後，不換分類可改其他欄位；新增或換到停用的分類仍被擋；換回啟用分類可以', async () => {
  const eq = await seedEquipment('ZT01', eqOff.id, 'DB-EQ');
  await disable('ga_equipment_categories', eqOff.id);
  const db = adminDb();
  // 不換分類：改位置、備註、狀態都可以
  const edit = await db.from('ga_equipment').update({ location_detail: '倉庫 B 區', notes: '分類停用後仍可改' }).eq('id', eq.id);
  expect(edit.error).toBeNull();
  expect(await row('ga_equipment', eq.id)).toMatchObject({ location_detail: '倉庫 B 區', notes: '分類停用後仍可改', category_id: eqOff.id });
  // 換到停用分類：擋（含原本就停用的分類）
  const toOff = await db.from('ga_equipment').update({ category_id: eqOff2.id }).eq('id', eq.id);
  expect(toOff.error?.message || '').toContain(MSG_EQ);
  expect((await row('ga_equipment', eq.id)).category_id).toBe(eqOff.id);
  // 新增在停用分類：擋
  const ins = await db.from('ga_equipment').insert({ store_id: sid.ZT01, category_id: eqOff.id, name: m7Name('DB-EQ-NEW'), brand: 'B' });
  expect(ins.error?.message || '').toContain(MSG_EQ);
  // 換到啟用分類：可以（把資產搬出停用分類）
  const toOn = await db.from('ga_equipment').update({ category_id: eqOn.id }).eq('id', eq.id);
  expect(toOn.error).toBeNull();
  expect((await row('ga_equipment', eq.id)).category_id).toBe(eqOn.id);
  // 直接建在停用分類被擋（資料庫層）
  const eq2 = await seedEquipment('ZT01', eqOff2.id, 'DB-EQ2', {}).catch((e) => e);
  expect(String(eq2.message || eq2)).toContain(MSG_EQ);
});

test('G08C 資料庫層：設施同規則（不換分類可改；新增或換到停用分類被擋）', async () => {
  const fac = await seedFacility('ZT01', facOff.id, 'DB-FAC');
  await disable('ga_facility_categories', facOff.id);
  const db = adminDb();
  const edit = await db.from('ga_facilities').update({ location_detail: '一樓', notes: '分類停用後仍可改' }).eq('id', fac.id);
  expect(edit.error).toBeNull();
  expect(await row('ga_facilities', fac.id)).toMatchObject({ location_detail: '一樓', category_id: facOff.id });
  const toOff = await db.from('ga_facilities').update({ category_id: facOff2.id }).eq('id', fac.id);
  expect(toOff.error?.message || '').toContain(MSG_FAC);
  const ins = await db.from('ga_facilities').insert({ store_id: sid.ZT01, category_id: facOff.id, name: m7Name('DB-FAC-NEW') });
  expect(ins.error?.message || '').toContain(MSG_FAC);
  const toOn = await db.from('ga_facilities').update({ category_id: facOn.id }).eq('id', fac.id);
  expect(toOn.error).toBeNull();
  expect((await row('ga_facilities', fac.id)).category_id).toBe(facOn.id);
});

test('G06C 新版 API：停用分類下的設備不換分類可儲存（含畫面整包送出同一個 category_id）；換到停用分類 400；新增在停用分類 400；換到啟用分類 200', async () => {
  const cat = await seedCategory('equipment', 'API-OFF');
  const eq = await seedEquipment('ZT01', cat.id, 'API-EQ');
  const eqDel = await seedEquipment('ZT01', cat.id, 'API-EQ-DEL');
  await disable('ga_equipment_categories', cat.id);
  const ok = await j(await apis.ga_works.patch(`${NEW}/equipment/${eq.id}`, { data: { location_detail: '新位置', category_id: cat.id, expected_updated_at: eq.updated_at } }));
  expect(ok.status).toBe(200);
  expect(await row('ga_equipment', eq.id)).toMatchObject({ location_detail: '新位置', category_id: cat.id });
  const cur = (await row('ga_equipment', eq.id)).updated_at;
  const bad = await j(await apis.ga_works.patch(`${NEW}/equipment/${eq.id}`, { data: { category_id: eqOff2.id, expected_updated_at: cur } }));
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain(MSG_EQ);
  expect((await row('ga_equipment', eq.id)).category_id).toBe(cat.id);
  const created = await j(await apis.ga_works.post(`${NEW}/equipment`, { data: { store_id: sid.ZT01, category_id: cat.id, name: m7Name('API-EQ-NEW'), brand: 'B' } }));
  expect(created.status).toBe(400);
  expect(created.body.error).toContain(MSG_EQ);
  const moved = await j(await apis.ga_works.patch(`${NEW}/equipment/${eq.id}`, { data: { category_id: eqOn.id, expected_updated_at: cur } }));
  expect(moved.status).toBe(200);
  expect((await row('ga_equipment', eq.id)).category_id).toBe(eqOn.id);
  // 停用分類下的設備也能刪除（刪除不換分類；舊規則會被擋）
  const del = await j(await apis.ga_works.delete(`${NEW}/equipment/${eqDel.id}`, { data: { reason: '分類停用後刪除', expected_updated_at: eqDel.updated_at } }));
  expect(del.status).toBe(200);
  expect((await row('ga_equipment', eqDel.id)).deleted_at).not.toBeNull();
  // 權限不變：只有查看權限的帳號仍然不能改
  expect((await apis.ga_equipment_view.patch(`${NEW}/equipment/${eq.id}`, { data: { location_detail: 'x', expected_updated_at: moved.body.data?.updated_at || cur } })).status()).toBe(403);
});

test('G08C 新版 API：設施同規則', async () => {
  const cat = await seedCategory('facility', 'API-OFF');
  const fac = await seedFacility('ZT01', cat.id, 'API-FAC');
  const facDel = await seedFacility('ZT01', cat.id, 'API-FAC-DEL');
  await disable('ga_facility_categories', cat.id);
  const ok = await j(await apis.ga_works.patch(`${NEW}/facilities/${fac.id}`, { data: { location_detail: '新位置', category_id: cat.id, expected_updated_at: fac.updated_at } }));
  expect(ok.status).toBe(200);
  expect(await row('ga_facilities', fac.id)).toMatchObject({ location_detail: '新位置', category_id: cat.id });
  const cur = (await row('ga_facilities', fac.id)).updated_at;
  const bad = await j(await apis.ga_works.patch(`${NEW}/facilities/${fac.id}`, { data: { category_id: facOff2.id, expected_updated_at: cur } }));
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain(MSG_FAC);
  const created = await j(await apis.ga_works.post(`${NEW}/facilities`, { data: { store_id: sid.ZT01, category_id: cat.id, name: m7Name('API-FAC-NEW') } }));
  expect(created.status).toBe(400);
  expect(created.body.error).toContain(MSG_FAC);
  const moved = await j(await apis.ga_works.patch(`${NEW}/facilities/${fac.id}`, { data: { category_id: facOn.id, expected_updated_at: cur } }));
  expect(moved.status).toBe(200);
  const del = await j(await apis.ga_works.delete(`${NEW}/facilities/${facDel.id}`, { data: { reason: '分類停用後刪除', expected_updated_at: facDel.updated_at } }));
  expect(del.status).toBe(200);
  expect((await row('ga_facilities', facDel.id)).deleted_at).not.toBeNull();
});

test('C13 舊版 API 一併適用（同一條資料庫規則）：停用分類下的設備與設施不換分類可儲存；換到停用分類被擋', async () => {
  const eCat = await seedCategory('equipment', 'OLD-OFF');
  const fCat = await seedCategory('facility', 'OLD-OFF');
  const eq = await seedEquipment('ZT01', eCat.id, 'OLD-EQ');
  const fac = await seedFacility('ZT01', fCat.id, 'OLD-FAC');
  await disable('ga_equipment_categories', eCat.id);
  await disable('ga_facility_categories', fCat.id);
  const e1 = await j(await apis.ga_works.patch(`${OLD}/equipment/${eq.id}`, { data: { location_detail: '舊版改位置' } }));
  expect(e1.status).toBe(200);
  expect((await row('ga_equipment', eq.id)).location_detail).toBe('舊版改位置');
  const f1 = await j(await apis.ga_works.patch(`${OLD}/facilities/${fac.id}`, { data: { location_detail: '舊版改位置' } }));
  expect(f1.status).toBe(200);
  expect((await row('ga_facilities', fac.id)).location_detail).toBe('舊版改位置');
  const e2 = await j(await apis.ga_works.patch(`${OLD}/equipment/${eq.id}`, { data: { category_id: eqOff2.id } }));
  expect(e2.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(e2.body)).toContain(MSG_EQ);
  const f2 = await j(await apis.ga_works.patch(`${OLD}/facilities/${fac.id}`, { data: { category_id: facOff2.id } }));
  expect(f2.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(f2.body)).toContain(MSG_FAC);
});

test('C13 分類恢復啟用或換到啟用分類後，一般新增與修改照舊；必填規則（品牌）在停用分類下仍照分類設定檢查', async () => {
  const cat = await seedCategory('equipment', 'REQ-BRAND', { requires_brand: true });
  const eq = await seedEquipment('ZT01', cat.id, 'REQ-EQ');
  await disable('ga_equipment_categories', cat.id);
  // 分類停用後仍要求品牌（分類設定不因停用而失效）：清掉品牌被擋
  const clear = await adminDb().from('ga_equipment').update({ brand: null }).eq('id', eq.id);
  expect(clear.error?.message || '').toContain('品牌');
  await adminDb().from('ga_equipment_categories').update({ is_active: true }).eq('id', cat.id);
  const ins = await adminDb().from('ga_equipment').insert({ store_id: sid.ZT01, category_id: cat.id, name: m7Name('REQ-NEW'), brand: 'B' }).select('id').single();
  expect(ins.error).toBeNull();
});
