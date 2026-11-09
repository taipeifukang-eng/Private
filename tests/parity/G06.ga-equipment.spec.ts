import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, seedCategory, seedEquipment, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';
import { BASIC_COLUMNS, FULL_ONLY_KEYS } from '../../lib/workspace/general-affairs/asset-fields';

// M7/M8 第 2 批 G06 對等層：舊版 /api/general-affairs/equipment/**（清單、詳情、新增、編輯、刪除、店長貼標待辦與複核）與新版 /api/workspace/general-affairs/** 同一個登入者、同一份輸入逐項比對；
// 寫入以 service role 回讀資料庫欄位比對。差異都列在 tests/parity/allowlist.json（page: ga-equipment）。
const map = loadMap('ga-equipment');
const rec = new ParityRecorder('ga-equipment');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_equipment_view', 'ga_equipment_edit', 'store_manager', 'ga_store_manager_b'];
let eqCat: { id: string };
let sid: Record<string, string> = {};
let managerA = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  eqCat = await seedCategory('equipment', 'EC');
  const s = await (await apis.store_manager.get('/api/workspace/session')).json();
  managerA = s.user.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
/** 物件鍵順序不同不算差異（PostgREST 巢狀關聯的鍵順序與選取順序可能不同）。 */
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
function diffRows(diffs: Diff[], label: string, legacy: any, native: any, cols: string[]) {
  for (const c of cols) {
    const a = legacy?.[c] ?? null, b = native?.[c] ?? null;
    if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: a, native: b });
  }
}
const BASIC = new Set<string>([...BASIC_COLUMNS.equipment, 'store', 'category', 'qr_scan_path']);
/** 店長只看基本欄位（Q5）：舊版回的鍵在新版不見了，只能是「完整層級專屬欄位」；其餘必須逐欄相同。 */
function compareRow(diffs: Diff[], label: string, legacy: any, native: any, level: 'full' | 'basic') {
  const lkeys = Object.keys(legacy);
  // 只有設備查看權限的帳號：舊版的門市與分類關聯因資料庫列級權限讀不到（null），新版由伺服端補上名稱
  const skip = new Set<string>();
  for (const c of ['store', 'category']) {
    if (legacy[c] === null && native[c]) { diffs.push({ kind: 'changed', key: `equipment-view-role-${c}-names`, legacy: null, native: native[c] }); skip.add(c); }
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
  diffRows(diffs, label, legacy, native, lkeys.filter((k) => k in native));
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of FULL_ONLY_KEYS.equipment) expect(native, `${label} 不該有 ${k}`).not.toHaveProperty(k);
}

test('設備清單：同一個登入者、同一個搜尋，id、欄位與筆數相同；店長只看基本欄位（Q5）；搜尋輸入逗號括號舊版壞掉、新版正常', async () => {
  const e = entry('equipment-read');
  const a = await seedEquipment('VW001', eqCat.id, 'PR-A', { asset_code: `PRA-${Date.now()}`, serial_number: 'SN-PRA', purchase_amount: 1234, notes: '備註A', specs: { purchase_source_supplier: '供應商A' }, has_warranty: true, warranty_end_date: '2031-01-01', area: '賣場', location_detail: '門口' });
  const b = await seedEquipment('ZT01', eqCat.id, 'PR-B', { brand: 'BB', model: 'MM' });
  await seedEquipment('VW002', eqCat.id, 'PR-C');
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent('[自動測試]M7M8')}&pageSize=100&sortBy=name&sortDir=asc`;
  for (const [role, level] of [['ga_works', 'full'], ['ga_equipment_view', 'full'], ['store_manager', 'basic'], ['ga_store_manager_b', 'basic']] as const) {
    const lr = await apis[role].get(`${L}/equipment?${q}`);
    const nr = await apis[role].get(`${N}/equipment?${q}`);
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
  // 店長範圍：A 店店長看 ZT01、B 店店長看 VW001（舊版靠資料庫列級權限，新版範圍相同）
  expect((await body(await apis.store_manager.get(`${N}/equipment?${q}`))).data.map((r: any) => r.id)).toEqual([b.id]);
  expect((await body(await apis.ga_store_manager_b.get(`${N}/equipment?${q}`))).data.map((r: any) => r.id)).toEqual([a.id]);
  // 搜尋含逗號、括號、引號：舊版查詢壞掉，新版正常
  for (const s of ['a,b)(', '")', '螺絲(M4),長']) {
    const lr = await apis.ga_works.get(`${L}/equipment?search=${encodeURIComponent(s)}`);
    const nr = await apis.ga_works.get(`${N}/equipment?search=${encodeURIComponent(s)}`);
    compared += 1;
    expect(nr.status()).toBe(200);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'equipment-search-special-chars', legacy: lr.status(), native: nr.status() });
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設備清單', legacy: { endpoint: `GET ${L}/equipment` }, native: { endpoint: `GET ${N}/equipment`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('設備詳情：整列欄位相同；店長只看基本欄位、他店設備舊版 500 新版 404', async () => {
  const e = entry('equipment-detail-read');
  const a = await seedEquipment('VW001', eqCat.id, 'PD-A', { serial_number: 'SN-PDA', purchase_amount: 999, notes: '詳情備註', specs: { purchase_source_supplier: '供應商' }, has_warranty: true, warranty_end_date: '2031-02-02' });
  const diffs: Diff[] = [];
  let compared = 0;
  for (const [role, level] of [['ga_works', 'full'], ['ga_equipment_view', 'full'], ['ga_store_manager_b', 'basic']] as const) {
    const lr = await apis[role].get(`${L}/equipment/${a.id}`);
    const nr = await apis[role].get(`${N}/equipment/${a.id}`);
    expect(lr.status(), role).toBe(200);
    expect(nr.status(), role).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    compared += 1;
    compareRow(diffs, `${role}:${a.id}`, legacy.data, native.data, level);
    if (level === 'full' && JSON.stringify(legacy.warnings) !== JSON.stringify(native.warnings)) diffs.push({ kind: 'changed', key: `${role}:warnings`, legacy: legacy.warnings, native: native.warnings });
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  // A 店店長讀 B 店設備（ZT01 讀 VW001）：舊版 .single() 找不到 -> 500；新版 404
  const lr = await apis.store_manager.get(`${L}/equipment/${a.id}`);
  const nr = await apis.store_manager.get(`${N}/equipment/${a.id}`);
  expect(nr.status()).toBe(404);
  if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'equipment-detail-other-store', legacy: lr.status(), native: nr.status() });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '設備詳情', legacy: { endpoint: `GET ${L}/equipment/:id` }, native: { endpoint: `GET ${N}/equipment/:id`, status: 200 }, compared: { rows: compared }, diffs }));
});

const EQ_SKIP = new Set(['id', 'name', 'created_at', 'updated_at', 'qr_token', 'qr_token_issued_at', 'qr_token_revoked_at', 'deleted_at', 'deleted_by', 'deletion_reason']);
const eqCols = (r: any) => Object.keys(r || {}).filter((k) => !EQ_SKIP.has(k));

test('設備寫入：新增（1 台與 3 台）、編輯、刪除回讀相同；編輯只更新有改的欄位、不能改所屬門市、已報廢要用恢復、有未結案單刪除被擋（列入白名單）', async () => {
  const e = entry('equipment-write');
  const diffs: Diff[] = [];
  const input = (suffix: string, over: Record<string, unknown> = {}) => ({
    store_id: sid.VW002, category_id: eqCat.id, name: m7Name(suffix), brand: 'PB', model: 'PM', serial_number: `SN-${suffix}`, has_warranty: true, warranty_end_date: '2031-03-03', purchase_amount: 321,
    area: '賣場', location_detail: '收銀台', tags: ['x'], notes: '備註', specs: { entry_mode: 'NEW_PURCHASE', purchase_source_supplier: '供應商', warranty_claim_method: 'ONLINE_REGISTRATION' }, ...over,
  });
  // 新增 1 台
  const a = await apis.ga_works.post(`${L}/equipment`, { data: input('PW-LA') });
  const b = await apis.ga_works.post(`${N}/equipment`, { data: input('PW-NA') });
  if (a.status() !== b.status()) diffs.push({ kind: 'status', key: 'create:status', legacy: a.status(), native: b.status() });
  const ra = (await rowsWhere('ga_equipment', 'name', m7Name('PW-LA')))[0];
  const rb = (await rowsWhere('ga_equipment', 'name', m7Name('PW-NA')))[0];
  diffRows(diffs, 'create', ra, rb, eqCols(ra).filter((c) => c !== 'serial_number'));
  expect(rb.serial_number).toBe('SN-PW-NA');
  expect(rb.created_by).toBe(ra.created_by);
  // 新增 3 台：每台獨立 QR，序號與條碼不複製
  const a3 = await apis.ga_works.post(`${L}/equipment`, { data: input('PW-L3', { quantity: 3 }) });
  const b3 = await apis.ga_works.post(`${N}/equipment`, { data: input('PW-N3', { quantity: 3 }) });
  if (a3.status() !== b3.status()) diffs.push({ kind: 'status', key: 'create3:status', legacy: a3.status(), native: b3.status() });
  const r3a = await rowsWhere('ga_equipment', 'name', m7Name('PW-L3'));
  const r3b = await rowsWhere('ga_equipment', 'name', m7Name('PW-N3'));
  if (r3a.length !== r3b.length) diffs.push({ kind: 'count', key: 'create3:count', legacy: r3a.length, native: r3b.length });
  diffRows(diffs, 'create3', r3a[0], r3b[0], eqCols(r3a[0]));
  expect(new Set(r3b.map((r) => r.qr_token)).size).toBe(3);
  // 編輯：一般欄位（位置、保固）
  const patch = { location_detail: '新位置', has_warranty: false, area: '倉庫' };
  const la = await apis.ga_works.patch(`${L}/equipment/${ra.id}`, { data: patch });
  const na = await apis.ga_works.patch(`${N}/equipment/${rb.id}`, { data: { ...patch, expected_updated_at: rb.updated_at } });
  if (la.status() !== na.status()) diffs.push({ kind: 'status', key: 'edit:status', legacy: la.status(), native: na.status() });
  const ea = await row('ga_equipment', ra.id), eb = await row('ga_equipment', rb.id);
  diffRows(diffs, 'edit', ea, eb, eqCols(ea).filter((c) => c !== 'serial_number'));
  // 編輯 specs：舊版整包取代（其他鍵被清掉），新版合併
  const sa = await apis.ga_works.patch(`${L}/equipment/${ra.id}`, { data: { specs: { purchase_source_supplier: '新供應商' } } });
  const sb = await apis.ga_works.patch(`${N}/equipment/${rb.id}`, { data: { specs: { purchase_source_supplier: '新供應商' }, expected_updated_at: (await row('ga_equipment', rb.id)).updated_at } });
  expect([sa.status(), sb.status()]).toEqual([200, 200]);
  const specA = (await row('ga_equipment', ra.id)).specs, specB = (await row('ga_equipment', rb.id)).specs;
  if (JSON.stringify(specA) !== JSON.stringify(specB)) diffs.push({ kind: 'changed', key: 'equipment-edit-specs-preserved', legacy: specA, native: specB });
  expect(specB).toMatchObject({ purchase_source_supplier: '新供應商', warranty_claim_method: 'ONLINE_REGISTRATION' });
  // 編輯所屬門市：舊版直接改，新版拒絕（改走轉移單或更正）
  const ma = await apis.ga_works.patch(`${L}/equipment/${ra.id}`, { data: { store_id: sid.ZT03 } });
  const mb = await apis.ga_works.patch(`${N}/equipment/${rb.id}`, { data: { store_id: sid.ZT03, expected_updated_at: (await row('ga_equipment', rb.id)).updated_at } });
  if (ma.status() !== mb.status()) diffs.push({ kind: 'status', key: 'equipment-edit-store-id', legacy: ma.status(), native: mb.status() });
  expect((await row('ga_equipment', rb.id)).store_id).toBe(sid.VW002);
  // 已報廢直接改回使用中：舊版可以（QR 仍作廢），新版要用恢復
  for (const [id, base] of [[ra.id, L], [rb.id, N]] as const) {
    const cur = await row('ga_equipment', id);
    const r = await apis.ga_works.patch(`${base}/equipment/${id}`, { data: base === N ? { status: 'SCRAPPED', expected_updated_at: cur.updated_at } : { status: 'SCRAPPED' } });
    expect(r.status()).toBe(200);
  }
  diffRows(diffs, 'scrap', await row('ga_equipment', ra.id), await row('ga_equipment', rb.id), ['status']);
  expect((await row('ga_equipment', ra.id)).qr_token_revoked_at).toBeTruthy();
  expect((await row('ga_equipment', rb.id)).qr_token_revoked_at).toBeTruthy();
  const ba = await apis.ga_works.patch(`${L}/equipment/${ra.id}`, { data: { status: 'ACTIVE' } });
  const bb = await apis.ga_works.patch(`${N}/equipment/${rb.id}`, { data: { status: 'ACTIVE', expected_updated_at: (await row('ga_equipment', rb.id)).updated_at } });
  if (ba.status() !== bb.status()) diffs.push({ kind: 'status', key: 'equipment-edit-restore-scrapped', legacy: ba.status(), native: bb.status() });
  // 刪除：沒有未結案單，兩邊相同；有未結案單，舊版放行、新版擋下
  const da = await apis.ga_works.delete(`${L}/equipment/${ra.id}`, { data: { deletion_reason: '對等刪除' } });
  const db = await apis.ga_works.delete(`${N}/equipment/${rb.id}`, { data: { reason: '對等刪除', expected_updated_at: (await row('ga_equipment', rb.id)).updated_at } });
  if (da.status() !== db.status()) diffs.push({ kind: 'status', key: 'delete:status', legacy: da.status(), native: db.status() });
  const xa = await row('ga_equipment', ra.id), xb = await row('ga_equipment', rb.id);
  diffRows(diffs, 'delete', xa, xb, ['deletion_reason']);
  expect(Boolean(xa.deleted_at)).toBe(Boolean(xb.deleted_at));
  const oa = await seedEquipment('VW002', eqCat.id, 'PW-OA');
  const ob = await seedEquipment('VW002', eqCat.id, 'PW-OB');
  await seedRepairRequest('VW002', { equipmentId: oa.id }, 'PW-OA-open', 'IN_PROGRESS', managerA);
  await seedRepairRequest('VW002', { equipmentId: ob.id }, 'PW-OB-open', 'IN_PROGRESS', managerA);
  const od1 = await apis.ga_works.delete(`${L}/equipment/${oa.id}`, { data: { deletion_reason: '有未結案單' } });
  const od2 = await apis.ga_works.delete(`${N}/equipment/${ob.id}`, { data: { reason: '有未結案單' } });
  if (od1.status() !== od2.status()) diffs.push({ kind: 'status', key: 'equipment-delete-with-open-orders', legacy: od1.status(), native: od2.status() });
  expect(od2.status()).toBe(409);
  expect((await row('ga_equipment', ob.id)).deleted_at).toBeNull();
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '設備新增、編輯、刪除', legacy: { endpoint: `${L}/equipment` }, native: { endpoint: `${N}/equipment`, status: 200 }, compared: { writes: 10 }, diffs }));
});

test('店長貼標待辦：同一個登入者的待辦設備 id、狀態、重拍旗標、退回原因相同', async () => {
  const e = entry('onboarding-read');
  const a = await seedEquipment('VW001', eqCat.id, 'PO-A');
  const b = await seedEquipment('VW001', eqCat.id, 'PO-B');
  const c = await seedEquipment('ZT01', eqCat.id, 'PO-C');
  await adminDb().from('ga_equipment').update({ onboarding_status: 'NEEDS_LABEL_PHOTO' }).eq('id', b.id);
  await adminDb().from('ga_equipment').update({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true, onboarding_review_note: '退回原因' }).eq('id', c.id);
  const diffs: Diff[] = [];
  let compared = 0;
  const mark = m7Name('PO-');
  for (const role of ['ga_store_manager_b', 'store_manager', 'ga_works']) {
    const lr = await apis[role].get(`${L}/equipment/store-onboarding-tasks`);
    const nr = await apis[role].get(`${N}/onboarding/tasks?assetType=EQUIPMENT&pageSize=100&q=${encodeURIComponent(mark)}`);
    expect(nr.status(), role).toBe(200);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `${role}:status`, legacy: lr.status(), native: nr.status() });
    const legacy = ((await body(lr)).data as any[]).filter((t) => String(t.equipment.name).startsWith(mark));
    const native = ((await body(nr)).data as any[]);
    const lids = legacy.map((t) => t.id).sort(), nids = native.map((t) => t.id).sort();
    if (JSON.stringify(lids) !== JSON.stringify(nids)) diffs.push({ kind: 'changed', key: `${role}:ids`, legacy: lids, native: nids });
    const nm = new Map(native.map((r) => [r.id, r]));
    for (const t of legacy) {
      const n = nm.get(t.id);
      compared += 1;
      if (!n) continue;
      const lv = { status: t.equipment.onboarding_status, code: t.equipment.asset_code, area: t.equipment.area, loc: t.equipment.location_detail, p: t.equipment.onboarding_requires_primary_photo, l: t.equipment.onboarding_requires_label_photo, note: t.equipment.onboarding_review_note, store: t.store.store_code, name: t.equipment.name, title: t.title };
      const nv = { status: n.onboarding_status, code: n.code, area: n.area, loc: n.location_detail, p: n.requires_primary_photo, l: n.requires_label_photo, note: n.review_note, store: n.store_code, name: n.name, title: n.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO' ? '待上傳設備照片' : '待上傳貼標照片' };
      diffRows(diffs, `${role}:${t.id}`, lv, nv, Object.keys(lv));
    }
  }
  expect(a.id).toBeTruthy();
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '店長貼標待辦', legacy: { endpoint: `GET ${L}/equipment/store-onboarding-tasks` }, native: { endpoint: `GET ${N}/onboarding/tasks`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('貼標複核與上傳寫入：通過與兩項退回回讀相同；只退一項、退回不勾選、照片超過 4MB 與舊版不同（列入白名單）', async () => {
  const e = entry('onboarding-write');
  const diffs: Diff[] = [];
  const pending = async (suffix: string) => {
    const eq = await seedEquipment('VW001', eqCat.id, suffix);
    await adminDb().from('ga_equipment').update({ onboarding_status: 'PENDING_GA_REVIEW' }).eq('id', eq.id);
    return eq;
  };
  const OB = ['onboarding_status', 'onboarding_requires_primary_photo', 'onboarding_requires_label_photo', 'onboarding_review_note'];
  const rv = async (suffix: string, legacyBody: Record<string, unknown>, nativeNote: { action: string; note?: string }) => {
    const l = await pending(`PW-RL-${suffix}`), n = await pending(`PW-RN-${suffix}`);
    const lr = await apis.ga_works.post(`${L}/equipment/${l.id}/onboarding-review`, { data: legacyBody });
    const nr = await apis.ga_works.post(`${N}/onboarding/review`, { data: { assetType: 'EQUIPMENT', assetId: n.id, ...nativeNote } });
    return { l, n, ls: lr.status(), ns: nr.status() };
  };
  // 通過
  let r = await rv('AP', { action: 'approve', note: '照片清楚' }, { action: 'approve', note: '照片清楚' });
  if (r.ls !== r.ns) diffs.push({ kind: 'status', key: 'approve:status', legacy: r.ls, native: r.ns });
  let [x, y] = [await row('ga_equipment', r.l.id), await row('ga_equipment', r.n.id)];
  diffRows(diffs, 'approve', x, y, OB);
  expect(y.onboarding_reviewed_by).toBe(x.onboarding_reviewed_by);
  // 退回兩項
  r = await rv('R2', { action: 'reject', note: '都要重拍', reject_required_primary_photo: true, reject_required_label_photo: true }, { action: 'reject', note: '都要重拍' });
  if (r.ls !== r.ns) diffs.push({ kind: 'status', key: 'reject-both:status', legacy: r.ls, native: r.ns });
  [x, y] = [await row('ga_equipment', r.l.id), await row('ga_equipment', r.n.id)];
  diffRows(diffs, 'reject-both', x, y, OB);
  // 只退貼標照：舊版只要求貼標照（回到待上傳貼標照），新版一律兩項都要求
  r = await rv('R1', { action: 'reject', note: '貼標重拍', reject_required_label_photo: true }, { action: 'reject', note: '貼標重拍' });
  [x, y] = [await row('ga_equipment', r.l.id), await row('ga_equipment', r.n.id)];
  for (const c of OB) if (JSON.stringify(x[c]) !== JSON.stringify(y[c])) diffs.push({ kind: 'changed', key: 'onboarding-reject-label-only', legacy: x[c], native: y[c], detail: c });
  expect(y).toMatchObject({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true });
  // 退回不勾選要重補的照片：舊版 400，新版不需要勾選
  r = await rv('R0', { action: 'reject', note: '沒勾選' }, { action: 'reject', note: '沒勾選' });
  if (r.ls !== r.ns) diffs.push({ kind: 'status', key: 'onboarding-reject-without-photo-choice', legacy: r.ls, native: r.ns });
  // 店長上傳照片：兩邊的狀態流轉與附件欄位相同
  const ul = await seedEquipment('ZT01', eqCat.id, 'PW-UL');
  const un = await seedEquipment('ZT01', eqCat.id, 'PW-UN');
  const png = makePng({ width: 64, height: 64, inkPixels: 10 });
  const file = { name: 'p.png', mimeType: 'image/png', buffer: png };
  const l1 = await apis.store_manager.post(`${L}/equipment/store-onboarding-tasks`, { multipart: { equipment_id: ul.id, purpose: 'PRIMARY_IMAGE', file } });
  const n1 = await apis.store_manager.post(`${N}/onboarding/photo`, { multipart: { assetType: 'EQUIPMENT', assetId: un.id, purpose: 'PRIMARY_IMAGE', file } });
  const cls = (s: number) => (s >= 200 && s < 300 ? 'ok' : s); // 200 與 201 都是成功
  if (cls(l1.status()) !== cls(n1.status())) diffs.push({ kind: 'status', key: 'upload:status', legacy: l1.status(), native: n1.status() });
  const l2 = await apis.store_manager.post(`${L}/equipment/store-onboarding-tasks`, { multipart: { equipment_id: ul.id, purpose: 'LABEL_POSITION_IMAGE', file } });
  const n2 = await apis.store_manager.post(`${N}/onboarding/photo`, { multipart: { assetType: 'EQUIPMENT', assetId: un.id, purpose: 'LABEL_POSITION_IMAGE', file } });
  if (cls(l2.status()) !== cls(n2.status())) diffs.push({ kind: 'status', key: 'upload2:status', legacy: l2.status(), native: n2.status() });
  diffRows(diffs, 'upload', await row('ga_equipment', ul.id), await row('ga_equipment', un.id), OB);
  const att = async (id: string) => (await rowsWhere('ga_resource_attachments', 'resource_id', id)).map((a) => ({ purpose: a.purpose, content_type: a.content_type, is_primary: a.is_primary, storage_bucket: a.storage_bucket, size_bytes: a.size_bytes })).sort((p, q) => p.purpose.localeCompare(q.purpose));
  const al = await att(ul.id), an = await att(un.id);
  if (JSON.stringify(al) !== JSON.stringify(an)) diffs.push({ kind: 'changed', key: 'upload:attachments', legacy: al, native: an });
  // 大於 4MB 的照片：舊版放行到 20MB，新版擋下（Q3）
  const bu = await seedEquipment('ZT01', eqCat.id, 'PW-BL');
  const bn = await seedEquipment('ZT01', eqCat.id, 'PW-BN');
  const big = { name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024, 1)]) };
  const lb = await apis.store_manager.post(`${L}/equipment/store-onboarding-tasks`, { multipart: { equipment_id: bu.id, purpose: 'PRIMARY_IMAGE', file: big } });
  const nb = await apis.store_manager.post(`${N}/onboarding/photo`, { multipart: { assetType: 'EQUIPMENT', assetId: bn.id, purpose: 'PRIMARY_IMAGE', file: big } });
  if (lb.status() !== nb.status()) diffs.push({ kind: 'status', key: 'onboarding-photo-over-4mb', legacy: lb.status(), native: nb.status() });
  expect(nb.status()).toBe(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '貼標複核與照片上傳', legacy: { endpoint: `${L}/equipment/:id/onboarding-review` }, native: { endpoint: `${N}/onboarding/review`, status: 200 }, compared: { writes: 8 }, diffs }));
});
