import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, seedCategory, seedFacility, seedFacilityTemplate, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { BASIC_COLUMNS, FULL_ONLY_KEYS } from '../../lib/workspace/general-affairs/asset-fields';

// M7/M8 第 2 批 G08 對等層：舊版 /api/general-affairs/facilities/**（清單、詳情、新增、編輯、刪除）與新版 /api/workspace/general-affairs/facilities/** 同一個登入者、同一份輸入逐項比對；
// 寫入以 service role 回讀資料庫欄位比對。差異都列在 tests/parity/allowlist.json（page: ga-facilities）。
const map = loadMap('ga-facilities');
const rec = new ParityRecorder('ga-facilities');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_facility_view', 'ga_facility_edit', 'ga_equipment_edit', 'store_manager', 'ga_store_manager_b'];
let facCat: { id: string };
let tpl: { id: string };
let sid: Record<string, string> = {};
let managerA = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  facCat = await seedCategory('facility', 'FC');
  tpl = await seedFacilityTemplate('PTPL', { category_id: facCat.id });
  managerA = (await (await apis.store_manager.get('/api/workspace/session')).json()).user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
/** 物件鍵順序不同不算差異。 */
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
function diffRows(diffs: Diff[], label: string, legacy: any, native: any, cols: string[]) {
  for (const c of cols) {
    const a = legacy?.[c] ?? null, b = native?.[c] ?? null;
    if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: a, native: b });
  }
}
// specs 內是保固申請方式等內部資料，基本層級不回；其餘基本欄位逐欄相同
const BASIC = new Set<string>([...BASIC_COLUMNS.facilities.filter((c) => c !== 'specs'), 'store', 'category', 'qr_scan_path']);
function compareRow(diffs: Diff[], label: string, legacy: any, native: any, level: 'full' | 'basic') {
  const lkeys = Object.keys(legacy);
  // 只有設施查看權限的帳號：舊版的門市與分類關聯因資料庫列級權限讀不到（null），新版由伺服端補上名稱
  const skip = new Set<string>();
  for (const c of ['store', 'category']) {
    if (legacy[c] === null && native[c]) { diffs.push({ kind: 'changed', key: `facility-view-role-${c}-names`, legacy: null, native: native[c] }); skip.add(c); }
  }
  if (level === 'full') {
    diffRows(diffs, label, legacy, native, lkeys.filter((k) => !skip.has(k)));
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
    return;
  }
  const missing = lkeys.filter((k) => !(k in native));
  const illegal = missing.filter((k) => BASIC.has(k) && k !== 'qr_scan_path');
  if (illegal.length) diffs.push({ kind: 'changed', key: `${label}#basic-lost-columns`, detail: illegal.join(',') });
  if (missing.length) diffs.push({ kind: 'only-legacy', key: 'q5-store-manager-basic-fields', detail: missing.join(',') });
  diffRows(diffs, label, legacy, native, lkeys.filter((k) => k in native && k !== 'specs'));
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of FULL_ONLY_KEYS.facilities) expect(native, `${label} 不該有 ${k}`).not.toHaveProperty(k);
}

test('設施清單：同一個登入者、同一個搜尋，id、欄位與筆數相同；店長只看基本欄位（Q5）；搜尋輸入逗號括號舊版壞掉、新版正常', async () => {
  const e = entry('facility-read');
  const a = await seedFacility('VW001', facCat.id, 'FR-A', { facility_code: `FRA-${Date.now() % 100000}`, purchase_amount: 1234, notes: '備註A', area: '賣場', location_detail: '門口', quantity: 2, unit: '座', specs: { facility_has_warranty: true, facility_warranty_end_date: '2031-01-01', facility_brand: 'A牌' } });
  const b = await seedFacility('ZT01', facCat.id, 'FR-B', { facility_template_id: tpl.id });
  await seedFacility('VW002', facCat.id, 'FR-C');
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=name&sortOrder=asc`;
  for (const [role, level] of [['ga_works', 'full'], ['ga_facility_view', 'full'], ['store_manager', 'basic'], ['ga_store_manager_b', 'basic']] as const) {
    const lr = await apis[role].get(`${L}/facilities?${q}`);
    const nr = await apis[role].get(`${N}/facilities?${q}`);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${role}:status`, legacy: lr.status(), native: nr.status() });
    expect(nr.status()).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    const lids = (legacy.data as any[]).map((r) => r.id).sort();
    const nids = (native.data as any[]).map((r) => r.id).sort();
    if (JSON.stringify(lids) !== JSON.stringify(nids)) diffs.push({ kind: 'changed', key: `${role}:ids`, legacy: lids, native: nids });
    for (const k of Object.keys(legacy.meta)) if (legacy.meta[k] !== native.meta[k]) diffs.push({ kind: 'count', key: `${role}:meta#${k}`, legacy: legacy.meta[k], native: native.meta[k] });
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      compared += 1;
      const n = nm.get(l.id);
      if (n) compareRow(diffs, `${role}:${l.id}`, l, n, level);
    }
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  expect((await body(await apis.store_manager.get(`${N}/facilities?${q}`))).data.map((r: any) => r.id)).toEqual([b.id]);
  expect((await body(await apis.ga_store_manager_b.get(`${N}/facilities?${q}`))).data.map((r: any) => r.id)).toEqual([a.id]);
  // 搜尋含逗號、括號、引號：舊版查詢壞掉，新版正常
  for (const s of ['a,b)(', '")', '螺絲(M4),長']) {
    const lr = await apis.ga_works.get(`${L}/facilities?search=${encodeURIComponent(s)}`);
    const nr = await apis.ga_works.get(`${N}/facilities?search=${encodeURIComponent(s)}`);
    compared += 1;
    expect(nr.status()).toBe(200);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'facility-search-special-chars', legacy: lr.status(), native: nr.status() });
  }
  // 只有設備管理權限（沒有設施權限、不是名單店長）：舊版靠資料庫列級權限，新版直接 403
  const lr = await apis.ga_equipment_edit.get(`${L}/facilities?${q}`);
  const nr = await apis.ga_equipment_edit.get(`${N}/facilities?${q}`);
  expect(nr.status()).toBe(403);
  if (lr.status() !== nr.status() || (lr.status() === 200 && (await body(lr)).data.length)) diffs.push({ kind: 'status', key: 'facility-no-permission', legacy: lr.status(), native: nr.status() });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設施清單', legacy: { endpoint: `GET ${L}/facilities` }, native: { endpoint: `GET ${N}/facilities`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('設施詳情：整列欄位相同；店長只看基本欄位、他店設施舊版 500 新版 404', async () => {
  const e = entry('facility-detail-read');
  const a = await seedFacility('VW001', facCat.id, 'FD-A', { facility_template_id: tpl.id, purchase_amount: 999, notes: '詳情備註', quantity: 1, unit: '座', specs: { facility_has_warranty: true, facility_warranty_end_date: '2031-02-02', facility_warranty_claim_method: 'OTHER', facility_warranty_claim_notes: '備註' } });
  const diffs: Diff[] = [];
  let compared = 0;
  for (const [role, level] of [['ga_works', 'full'], ['ga_facility_view', 'full'], ['ga_store_manager_b', 'basic']] as const) {
    const lr = await apis[role].get(`${L}/facilities/${a.id}`);
    const nr = await apis[role].get(`${N}/facilities/${a.id}`);
    expect(lr.status(), role).toBe(200);
    expect(nr.status(), role).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    compared += 1;
    compareRow(diffs, `${role}:${a.id}`, legacy.data, native.data, level);
    if (level === 'full' && JSON.stringify(legacy.warnings) !== JSON.stringify(native.warnings)) diffs.push({ kind: 'changed', key: `${role}:warnings`, legacy: legacy.warnings, native: native.warnings });
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  const lr = await apis.store_manager.get(`${L}/facilities/${a.id}`);
  const nr = await apis.store_manager.get(`${N}/facilities/${a.id}`);
  expect(nr.status()).toBe(404);
  if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'facility-detail-other-store', legacy: lr.status(), native: nr.status() });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設施詳情', legacy: { endpoint: `GET ${L}/facilities/:id` }, native: { endpoint: `GET ${N}/facilities/:id`, status: 200 }, compared: { rows: compared }, diffs }));
});

const SKIP = new Set(['id', 'name', 'created_at', 'updated_at', 'qr_token', 'qr_token_issued_at', 'qr_token_revoked_at', 'deleted_at', 'deleted_by', 'deletion_reason']);
const cols = (r: any) => Object.keys(r || {}).filter((k) => !SKIP.has(k));

test('設施寫入：新增、編輯、刪除回讀相同；編輯只更新有改的欄位、不能改所屬門市、已退役要用恢復、有未結案單刪除被擋（列入白名單）', async () => {
  const e = entry('facility-write');
  const diffs: Diff[] = [];
  const input = (suffix: string, over: Record<string, unknown> = {}) => ({
    store_id: sid.VW002, category_id: facCat.id, facility_template_id: tpl.id, name: m7Name(suffix), status: 'ACTIVE', criticality: 'HIGH', area: '收銀區', location_detail: '入口', quantity: 2, unit: '座', is_fixed_asset: true,
    installed_at: '2026-01-02', purchased_at: '2026-01-01', purchase_unit_amount: 100, purchase_amount: 200, description: '說明', tags: ['x'], notes: '備註',
    specs: { entry_mode: 'NEW_PURCHASE', facility_brand: 'B', facility_model: 'M', facility_has_warranty: true, facility_warranty_end_date: '2031-03-03', facility_warranty_claim_method: 'ONLINE_REGISTRATION' }, ...over,
  });
  // 新增
  const a = await apis.ga_works.post(`${L}/facilities`, { data: input('FW-LA') });
  const b = await apis.ga_works.post(`${N}/facilities`, { data: input('FW-NA') });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'create:status', legacy: a.status(), native: b.status() });
  const ra = (await rowsWhere('ga_facilities', 'name', m7Name('FW-LA')))[0];
  const rb = (await rowsWhere('ga_facilities', 'name', m7Name('FW-NA')))[0];
  diffRows(diffs, 'create', ra, rb, cols(ra));
  expect(rb.onboarding_status).toBe('NEEDS_EQUIPMENT_PHOTO');
  expect(rb.created_by ?? null).toBe(ra.created_by ?? null);
  const la = await body(a), lb = await body(b);
  for (const k of ['qr_scan_path']) if (!!la.data?.[k] !== !!lb.data?.[k]) diffs.push({ kind: 'changed', key: `create:${k}`, legacy: la.data?.[k], native: lb.data?.[k] });
  // 驗證失敗：兩邊同樣 400 且不寫入
  for (const bad of [{ name: ' ' }, { quantity: 0 }, { unit: '' }, { status: 'SCRAPPED' }]) {
    const x = await apis.ga_works.post(`${L}/facilities`, { data: input('FW-BADL', bad) });
    const y = await apis.ga_works.post(`${N}/facilities`, { data: input('FW-BADN', bad) });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `create-invalid:${Object.keys(bad)[0]}`, legacy: x.status(), native: y.status() });
  }
  // 編輯：一般欄位
  const patch = { location_detail: '新位置', area: '倉庫', quantity: 3, unit: '組' };
  const pa = await apis.ga_works.patch(`${L}/facilities/${ra.id}`, { data: patch });
  const pb = await apis.ga_works.patch(`${N}/facilities/${rb.id}`, { data: { ...patch, expected_updated_at: rb.updated_at } });
  if (pa.status() !== pb.status()) diffs.push({ kind: 'status', key: 'edit:status', legacy: pa.status(), native: pb.status() });
  diffRows(diffs, 'edit', await row('ga_facilities', ra.id), await row('ga_facilities', rb.id), cols(ra));
  // 編輯 specs：舊版整包取代，新版合併
  const sa = await apis.ga_works.patch(`${L}/facilities/${ra.id}`, { data: { specs: { facility_has_warranty: true, facility_warranty_end_date: '2032-02-02' } } });
  const sb = await apis.ga_works.patch(`${N}/facilities/${rb.id}`, { data: { specs: { facility_has_warranty: true, facility_warranty_end_date: '2032-02-02' }, expected_updated_at: (await row('ga_facilities', rb.id)).updated_at } });
  expect([sa.status(), sb.status()]).toEqual([200, 200]);
  const specA = (await row('ga_facilities', ra.id)).specs, specB = (await row('ga_facilities', rb.id)).specs;
  if (JSON.stringify(canon(specA)) !== JSON.stringify(canon(specB))) diffs.push({ kind: 'changed', key: 'facility-edit-specs-preserved', legacy: specA, native: specB });
  expect(specB).toMatchObject({ facility_brand: 'B', facility_warranty_end_date: '2032-02-02', facility_warranty_claim_method: 'ONLINE_REGISTRATION' });
  // 編輯所屬門市：舊版直接改，新版拒絕
  const ma = await apis.ga_works.patch(`${L}/facilities/${ra.id}`, { data: { store_id: sid.ZT03 } });
  const mb = await apis.ga_works.patch(`${N}/facilities/${rb.id}`, { data: { store_id: sid.ZT03, expected_updated_at: (await row('ga_facilities', rb.id)).updated_at } });
  if (ma.status() !== mb.status()) diffs.push({ kind: 'status', key: 'facility-edit-store-id', legacy: ma.status(), native: mb.status() });
  expect((await row('ga_facilities', rb.id)).store_id).toBe(sid.VW002);
  // 退役：QR 自動作廢（兩邊相同）；之後直接改回使用中，舊版可以，新版要用恢復
  for (const [id, base] of [[ra.id, L], [rb.id, N]] as const) {
    const cur = await row('ga_facilities', id);
    const r = await apis.ga_works.patch(`${base}/facilities/${id}`, { data: base === N ? { status: 'RETIRED', expected_updated_at: cur.updated_at } : { status: 'RETIRED' } });
    expect(r.status()).toBe(200);
  }
  diffRows(diffs, 'retire', await row('ga_facilities', ra.id), await row('ga_facilities', rb.id), ['status']);
  expect(Boolean((await row('ga_facilities', ra.id)).qr_token_revoked_at)).toBe(Boolean((await row('ga_facilities', rb.id)).qr_token_revoked_at));
  expect((await row('ga_facilities', rb.id)).qr_token_revoked_at).toBeTruthy();
  const ba = await apis.ga_works.patch(`${L}/facilities/${ra.id}`, { data: { status: 'ACTIVE' } });
  const bb = await apis.ga_works.patch(`${N}/facilities/${rb.id}`, { data: { status: 'ACTIVE', expected_updated_at: (await row('ga_facilities', rb.id)).updated_at } });
  if (ba.status() !== bb.status()) diffs.push({ kind: 'status', key: 'facility-edit-restore-retired', legacy: ba.status(), native: bb.status() });
  // 刪除：沒有未結案單，兩邊相同；有未結案單，舊版放行、新版擋下
  const da = await apis.ga_works.delete(`${L}/facilities/${ra.id}`, { data: { deletion_reason: '對等刪除' } });
  const db = await apis.ga_works.delete(`${N}/facilities/${rb.id}`, { data: { reason: '對等刪除', expected_updated_at: (await row('ga_facilities', rb.id)).updated_at } });
  if (da.status() !== db.status()) diffs.push({ kind: 'status', key: 'delete:status', legacy: da.status(), native: db.status() });
  const xa = await row('ga_facilities', ra.id), xb = await row('ga_facilities', rb.id);
  diffRows(diffs, 'delete', xa, xb, ['deletion_reason']);
  expect(Boolean(xa.deleted_at)).toBe(Boolean(xb.deleted_at));
  const oa = await seedFacility('VW002', facCat.id, 'FW-OA');
  const ob = await seedFacility('VW002', facCat.id, 'FW-OB');
  await seedRepairRequest('VW002', { facilityId: oa.id }, 'FW-OA-open', 'IN_PROGRESS', managerA);
  await seedRepairRequest('VW002', { facilityId: ob.id }, 'FW-OB-open', 'IN_PROGRESS', managerA);
  const od1 = await apis.ga_works.delete(`${L}/facilities/${oa.id}`, { data: { deletion_reason: '有未結案單' } });
  const od2 = await apis.ga_works.delete(`${N}/facilities/${ob.id}`, { data: { reason: '有未結案單' } });
  if (od1.status() !== od2.status()) diffs.push({ kind: 'status', key: 'facility-delete-with-open-orders', legacy: od1.status(), native: od2.status() });
  expect(od2.status()).toBe(409);
  expect((await row('ga_facilities', ob.id)).deleted_at).toBeNull();
  // 沒有設施管理權限（設備管理、設施查看）：兩邊都 403 且不寫入
  for (const role of ['ga_facility_view', 'ga_equipment_edit']) {
    const x = await apis[role].post(`${L}/facilities`, { data: input(`FW-DL-${role}`) });
    const y = await apis[role].post(`${N}/facilities`, { data: input(`FW-DN-${role}`) });
    if (x.status() !== y.status()) diffs.push({ kind: 'status', key: `create-denied:${role}`, legacy: x.status(), native: y.status() });
    expect(y.status()).toBe(403);
  }
  expect(await adminDb().from('ga_facilities').select('id').like('name', `%FW-D%`).is('deleted_at', null).then((r) => r.data || [])).toEqual([]);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '設施新增、編輯、刪除', legacy: { endpoint: `${L}/facilities` }, native: { endpoint: `${N}/facilities`, status: 200 }, compared: { writes: 12 }, diffs }));
});
