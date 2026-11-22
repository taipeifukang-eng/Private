import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, rowsWhere, seedBalance, seedCategory, seedEquipment, seedFacility, seedLocation, seedLocationPart, seedPart, seedTransfer, stores,
} from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G11 對等層：舊版 /api/general-affairs/inventory/locations/**（清單、詳情、設定清單、新增、修改、刪除、位置料件）與新版同路徑 API，
// 同一個登入者、同一份輸入逐項比對；寫入以 service role 回讀資料庫欄位比對。C13（分類停用後可修改）同時驗證舊版與新版 API。
// 差異都列在 tests/parity/allowlist.json（page: ga-inventory-locations）。
const map = loadMap('ga-inventory-locations');
const rec = new ParityRecorder('ga-inventory-locations');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs/inventory/locations';
const N = '/api/workspace/general-affairs/inventory/locations';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_inv_location_view', 'store_manager'];
let sid: Record<string, string> = {};
let partCat: { id: string };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  partCat = await seedCategory('part', 'PLC');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
function diffRow(diffs: Diff[], label: string, legacy: any, native: any, skip: string[] = []) {
  for (const k of Object.keys(legacy)) {
    if (skip.includes(k)) continue;
    if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
    else if (!same(legacy[k], native[k])) diffs.push({ kind: 'changed', key: `${label}#${k}`, legacy: legacy[k], native: native[k] });
  }
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
}
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });

test('位置清單：同一個登入者、同一個搜尋，id、欄位、門市關聯與筆數相同；名單身分描述被遮蔽（C12）；搜尋含逗號括號舊版壞掉、新版正常', async () => {
  const e = entry('location-list-read');
  const a = await seedLocation('ZT01', 'PL-A', { description: '內部描述A' });
  const b = await seedLocation('VW001', 'PL-B');
  const c = await seedLocation(null, 'PL-C', { is_active: false, allow_negative_stock: true });
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent(m7Name('PL-'))}&pageSize=100&sortBy=name&sortOrder=asc`;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}?${q}`);
    const nr = await apis[role].get(`${N}?${q}`);
    statusDiff(diffs, `${role}:status`, lr.status(), nr.status());
    expect(nr.status()).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    const lids = (legacy.data as any[]).map((r) => r.id);
    const nids = (native.data as any[]).map((r) => r.id);
    if (!same(lids, nids)) diffs.push({ kind: 'changed', key: `${role}:ids`, legacy: lids, native: nids });
    for (const k of Object.keys(legacy.meta)) if (legacy.meta[k] !== native.meta[k]) diffs.push({ kind: 'count', key: `${role}:meta#${k}`, legacy: legacy.meta[k], native: native.meta[k] });
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      compared += 1;
      const n = nm.get(l.id);
      if (n) diffRow(diffs, `${role}:${l.id}`, l, n);
    }
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  expect(((await body(await apis.store_manager.get(`${N}?${q}`))).data as any[]).map((r) => r.id)).toEqual([a.id]);
  expect(((await body(await apis.ga_works.get(`${N}?${q}`))).data as any[]).map((r) => r.id).sort()).toEqual([a.id, b.id, c.id].sort());
  // 搜尋含逗號、括號、引號：舊版查詢壞掉，新版正常
  for (const s of ['a,b)(', '")', '庫存(A),倉']) {
    const lr = await apis.ga_works.get(`${L}?search=${encodeURIComponent(s)}`);
    const nr = await apis.ga_works.get(`${N}?search=${encodeURIComponent(s)}`);
    compared += 1;
    expect(nr.status()).toBe(200);
    statusDiff(diffs, 'location-search-special-chars', lr.status(), nr.status());
  }
  // 篩選（類型、門市、狀態）兩邊相同
  for (const f of [`locationType=CENTRAL_WAREHOUSE`, `storeId=${sid.VW001}`, `isActive=false`]) {
    const lr = await body(await apis.ga_works.get(`${L}?${q}&${f}`)), nr = await body(await apis.ga_works.get(`${N}?${q}&${f}`));
    compared += 1;
    if (!same((lr.data as any[]).map((r) => r.id), (nr.data as any[]).map((r) => r.id))) diffs.push({ kind: 'changed', key: `filter:${f}`, legacy: lr.data?.length, native: nr.data?.length });
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '庫存位置清單', legacy: { endpoint: `GET ${L}` }, native: { endpoint: `GET ${N}`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('位置詳情：欄位與門市關聯相同；他店位置、不存在、壞 id 的狀態碼相同', async () => {
  const e = entry('location-detail-read');
  const a = await seedLocation('ZT01', 'PD-A', { description: '內部描述D' });
  const b = await seedLocation('VW001', 'PD-B');
  const diffs: Diff[] = [];
  let compared = 0;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}/${a.id}`);
    const nr = await apis[role].get(`${N}/${a.id}`);
    statusDiff(diffs, `${role}:detail-status`, lr.status(), nr.status());
    expect(nr.status()).toBe(role === 'denied' ? 403 : 200);
    compared += 1;
    diffRow(diffs, `${role}:${a.id}`, (await body(lr)).data, (await body(nr)).data);
  }
  for (const [label, id] of [['other-store', b.id], ['not-found', '00000000-0000-4000-8000-000000000000'], ['bad-id', 'not-a-uuid']] as const) {
    const lr = await apis.store_manager.get(`${L}/${id}`);
    const nr = await apis.store_manager.get(`${N}/${id}`);
    compared += 1;
    statusDiff(diffs, `location-detail-${label}`, lr.status(), nr.status());
  }
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '庫存位置詳情', legacy: { endpoint: `GET ${L}/:id` }, native: { endpoint: `GET ${N}/:id`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('位置料件設定清單：設定列欄位與料件關聯相同；名單身分備註被遮蔽；舊版搜尋在載入後的那一頁內過濾、新版伺服端搜尋', async () => {
  const e = entry('location-parts-read');
  const loc = await seedLocation('ZT01', 'PP-LOC');
  const parts = [] as any[];
  for (const s of ['甲', '乙', '丙']) parts.push(await seedPart(partCat.id, `PP-${s}`, { purchase_unit: '箱', purchase_to_base_rate: 6 }));
  for (const p of parts) await seedLocationPart(loc.id, p.id, { safety_stock_qty: 1, reorder_point_qty: 2, maximum_stock_qty: 3, notes: `內部備註-${p.name.slice(-1)}`, preferred_issue_unit_type: 'PURCHASE' });
  const diffs: Diff[] = [];
  let compared = 0;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}/${loc.id}/parts?pageSize=100`);
    const nr = await apis[role].get(`${N}/${loc.id}/parts?pageSize=100`);
    statusDiff(diffs, `${role}:parts-status`, lr.status(), nr.status());
    expect(nr.status()).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    const lids = (legacy.data as any[]).map((r) => r.id).sort();
    const nids = (native.data as any[]).map((r) => r.id).sort();
    if (!same(lids, nids)) diffs.push({ kind: 'changed', key: `${role}:parts-ids`, legacy: lids, native: nids });
    for (const k of Object.keys(legacy.meta)) if (legacy.meta[k] !== native.meta[k]) diffs.push({ kind: 'count', key: `${role}:meta#${k}`, legacy: legacy.meta[k], native: native.meta[k] });
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      compared += 1;
      const n = nm.get(l.id);
      if (!n) continue;
      // 料件關聯：欄位逐欄比
      const { part: lp, ...lrest } = l;
      const { part: np, ...nrest } = n;
      diffRow(diffs, `${role}:${l.id}`, lrest, nrest);
      if (lp && np) diffRow(diffs, `${role}:${l.id}:part`, lp, np);
    }
    for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  // 搜尋：每頁 2 筆、搜第三個料件。舊版先取第一頁再過濾（找不到或總數不準），新版直接搜尋
  const target = parts[2];
  const lr = await body(await apis.ga_works.get(`${L}/${loc.id}/parts?pageSize=1&search=${encodeURIComponent(target.name.slice(-3))}`));
  const nr = await body(await apis.ga_works.get(`${N}/${loc.id}/parts?pageSize=1&search=${encodeURIComponent(target.name.slice(-3))}`));
  compared += 1;
  expect(nr.data.map((r: any) => r.part.id)).toEqual([target.id]);
  expect(nr.meta.total).toBe(1);
  if (!same(lr.data?.map((r: any) => r.part?.id), nr.data.map((r: any) => r.part.id)) || lr.meta.total !== nr.meta.total) diffs.push({ kind: 'count', key: 'location-parts-search-total', legacy: lr.meta?.total, native: nr.meta.total });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '位置料件設定清單', legacy: { endpoint: `GET ${L}/:id/parts` }, native: { endpoint: `GET ${N}/:id/parts`, status: 200 }, compared: { rows: compared }, diffs }));
});

const COLS = ['location_type', 'store_id', 'is_active', 'allow_negative_stock', 'is_default', 'description', 'deleted_at'];
test('新增與修改位置後回讀資料庫：同一份輸入，兩邊寫入的欄位相同（代碼轉大寫、名稱修剪）；新規則差異（版本、預設確認、有交易後鎖定）', async () => {
  const e = entry('location-write-readback');
  const diffs: Diff[] = [];
  const mk = (tag: string) => ({ name: `  ${m7Name(tag)}  `, location_type: 'STORE', store_id: sid.ZT03, code: ` ${m7Code(tag)} `.toLowerCase(), description: ' 描述 ', allow_negative_stock: true });
  const lc = await apis.ga_works.post(L, { data: mk('WL1') });
  const nc = await apis.ga_works.post(N, { data: mk('WN1') });
  statusDiff(diffs, 'create-status', lc.status(), nc.status());
  expect(nc.status()).toBe(201);
  const lrow = await row('ga_inventory_locations', (await body(lc)).data.id);
  const nrow = await row('ga_inventory_locations', (await body(nc)).data.id);
  for (const c of COLS) if (!same(lrow[c], nrow[c])) diffs.push({ kind: 'changed', key: `create-row#${c}`, legacy: lrow[c], native: nrow[c] });
  expect(lrow.name).toBe(m7Name('WL1'));
  expect(nrow.name).toBe(m7Name('WN1'));
  expect(lrow.code).toBe(m7Code('WL1'));
  expect(nrow.code).toBe(m7Code('WN1'));
  // 修改
  const lu = await apis.ga_works.patch(`${L}/${lrow.id}`, { data: { description: '改後描述', allow_negative_stock: false } });
  const nu = await apis.ga_works.patch(`${N}/${nrow.id}`, { data: { description: '改後描述', allow_negative_stock: false, expected_updated_at: nrow.updated_at } });
  statusDiff(diffs, 'update-status', lu.status(), nu.status());
  const lrow2 = await row('ga_inventory_locations', lrow.id), nrow2 = await row('ga_inventory_locations', nrow.id);
  for (const c of COLS) if (!same(lrow2[c], nrow2[c])) diffs.push({ kind: 'changed', key: `update-row#${c}`, legacy: lrow2[c], native: nrow2[c] });
  // 新版修改一定要帶 expected_updated_at；舊版不用（可能蓋掉別人的修改）
  const lnv = await apis.ga_works.patch(`${L}/${lrow.id}`, { data: { description: '無版本' } });
  const nnv = await apis.ga_works.patch(`${N}/${nrow.id}`, { data: { description: '無版本' } });
  statusDiff(diffs, 'update-without-version', lnv.status(), nnv.status());
  // 預設位置衝突：舊版直接 409（資料庫唯一索引），新版 409 並提供確認改由新位置接手
  await apis.ga_works.post(L, { data: { name: m7Name('WL-D1'), location_type: 'STORE', store_id: sid.ZT04, is_default: true } });
  const ld = await apis.ga_works.post(L, { data: { name: m7Name('WL-D2'), location_type: 'STORE', store_id: sid.ZT04, is_default: true } });
  const nd = await apis.ga_works.post(N, { data: { name: m7Name('WN-D2'), location_type: 'STORE', store_id: sid.ZT04, is_default: true } });
  statusDiff(diffs, 'default-conflict-status', ld.status(), nd.status());
  expect((await body(nd)).code).toBe('DEFAULT_CONFLICT');
  diffs.push({ kind: 'changed', key: 'default-conflict-confirm', detail: '新版預設位置衝突時帶出既有預設位置並可確認改由新位置接手（舊版只回資料庫唯一索引錯誤）', legacy: (await body(ld)).error, native: (await body(nd)).code });
  // C3：有交易或餘額後鎖定類型、門市、代碼。舊版畫面沒有資料庫以外的保護（觸發器現在連舊版也擋）
  const part = await seedPart(partCat.id, 'WL-LOCKP');
  const lock1 = await seedLocation('ZT05', 'WL-LOCK1');
  const lock2 = await seedLocation('ZT05', 'WL-LOCK2');
  await seedBalance(lock1.id, part.id, 1);
  await seedBalance(lock2.id, part.id, 1);
  const ll = await apis.ga_works.patch(`${L}/${lock1.id}`, { data: { location_type: 'OFFICE', store_id: null } });
  const nl = await apis.ga_works.patch(`${N}/${lock2.id}`, { data: { location_type: 'OFFICE', store_id: null, expected_updated_at: lock2.updated_at } });
  statusDiff(diffs, 'locked-by-history-status', ll.status(), nl.status());
  expect(nl.status()).toBe(409);
  expect((await row('ga_inventory_locations', lock1.id)).location_type).toBe('STORE');
  expect((await row('ga_inventory_locations', lock2.id)).location_type).toBe('STORE');
  diffs.push({ kind: 'changed', key: 'locked-by-history-message', detail: '有交易或餘額後鎖定位置類型、門市、代碼（C3）；舊版資料庫觸發器也擋，但舊版畫面顯示英文代碼或資料庫原文', legacy: (await body(ll)).error, native: (await body(nl)).error });
  // 新版才有的驗證：名稱 100 字、代碼 40 字
  const longName = await apis.ga_works.post(N, { data: { name: 'x'.repeat(101), location_type: 'OFFICE' } });
  const lLong = await apis.ga_works.post(L, { data: { name: m7Name('WL-LONG') + 'x'.repeat(101), location_type: 'OFFICE' } });
  statusDiff(diffs, 'name-length-limit', lLong.status(), longName.status());
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '新增與修改位置', legacy: { endpoint: `POST/PATCH ${L}` }, native: { endpoint: `POST/PATCH ${N}`, status: 201 }, compared: { rows: 4 }, diffs }));
});

test('刪除位置：舊版不查庫存與進行中調撥；新版先擋（C2）。清空後兩邊都軟刪除並連帶移除設定', async () => {
  const e = entry('location-delete-readback');
  const diffs: Diff[] = [];
  const part = await seedPart(partCat.id, 'DL-P');
  const mkLoc = async (tag: string) => {
    const l = await seedLocation('ZT04', tag);
    await seedLocationPart(l.id, part.id);
    return l;
  };
  // 有庫存
  const ls = await mkLoc('DL-STOCK-L');
  const ns = await mkLoc('DL-STOCK-N');
  await seedBalance(ls.id, part.id, 2);
  await seedBalance(ns.id, part.id, 2);
  const lr1 = await apis.ga_works.delete(`${L}/${ls.id}`, { data: { deletion_reason: '測試' } });
  const nr1 = await apis.ga_works.delete(`${N}/${ns.id}`, { data: { deletion_reason: '測試', expected_updated_at: ns.updated_at } });
  statusDiff(diffs, 'delete-with-stock-status', lr1.status(), nr1.status());
  expect(nr1.status()).toBe(409);
  expect((await row('ga_inventory_locations', ns.id)).deleted_at).toBeNull();
  if ((await row('ga_inventory_locations', ls.id)).deleted_at) diffs.push({ kind: 'changed', key: 'delete-with-stock-result', legacy: 'deleted', native: 'kept', detail: '舊版把仍有庫存的位置軟刪除；新版擋下' });
  // 進行中調撥（目的位置）
  const lt = await mkLoc('DL-TR-L');
  const nt = await mkLoc('DL-TR-N');
  const dstL = await mkLoc('DL-TR-DST-L');
  const dstN = await mkLoc('DL-TR-DST-N');
  await seedTransfer(lt.id, dstL.id, part.id, 'DL-TL', 'REQUESTED');
  await seedTransfer(nt.id, dstN.id, part.id, 'DL-TN', 'REQUESTED');
  const lr2 = await apis.ga_works.delete(`${L}/${lt.id}`, { data: { deletion_reason: '測試' } });
  const nr2 = await apis.ga_works.delete(`${N}/${nt.id}`, { data: { deletion_reason: '測試', expected_updated_at: nt.updated_at } });
  statusDiff(diffs, 'delete-with-open-transfer-status', lr2.status(), nr2.status());
  expect(nr2.status()).toBe(409);
  expect((await row('ga_inventory_locations', nt.id)).deleted_at).toBeNull();
  // 乾淨位置：兩邊都刪除，設定連帶軟刪除
  const lc = await mkLoc('DL-OK-L');
  const nc = await mkLoc('DL-OK-N');
  const lr3 = await apis.ga_works.delete(`${L}/${lc.id}`, { data: { deletion_reason: '測試刪除' } });
  const nr3 = await apis.ga_works.delete(`${N}/${nc.id}`, { data: { deletion_reason: '測試刪除', expected_updated_at: nc.updated_at } });
  statusDiff(diffs, 'delete-clean-status', lr3.status(), nr3.status());
  expect(nr3.status()).toBe(200);
  const lrow = await row('ga_inventory_locations', lc.id), nrow = await row('ga_inventory_locations', nc.id);
  for (const c of ['is_active', 'is_default', 'deletion_reason']) if (!same(lrow[c], nrow[c])) diffs.push({ kind: 'changed', key: `delete-row#${c}`, legacy: lrow[c], native: nrow[c] });
  if (!lrow.deleted_at || !nrow.deleted_at) diffs.push({ kind: 'changed', key: 'delete-row#deleted_at', legacy: lrow.deleted_at, native: nrow.deleted_at });
  const lset = (await rowsWhere('ga_inventory_location_parts', 'location_id', lc.id))[0], nset = (await rowsWhere('ga_inventory_location_parts', 'location_id', nc.id))[0];
  for (const c of ['is_active', 'deletion_reason']) if (!same(lset[c], nset[c])) diffs.push({ kind: 'changed', key: `delete-child-row#${c}`, legacy: lset[c], native: nset[c] });
  if (!lset.deleted_at || !nset.deleted_at) diffs.push({ kind: 'changed', key: 'delete-child-row#deleted_at' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '刪除位置', legacy: { endpoint: `DELETE ${L}/:id` }, native: { endpoint: `DELETE ${N}/:id`, status: 200 }, compared: { rows: 6 }, diffs }));
});

test('位置料件設定寫入後回讀：新增、修改、移除兩邊的資料庫欄位相同；批次新增、修改停用、移除保護是新版才有（C1、C2）', async () => {
  const e = entry('location-part-write-readback');
  const diffs: Diff[] = [];
  const locL = await seedLocation('ZT05', 'PW-L');
  const locN = await seedLocation('ZT05', 'PW-N');
  const p1 = await seedPart(partCat.id, 'PW-1'), p2 = await seedPart(partCat.id, 'PW-2');
  const input = { safety_stock_qty: 2, reorder_point_qty: 5, maximum_stock_qty: 10, preferred_issue_unit_type: 'BASE', notes: ' 備註 ' };
  const lc = await apis.ga_works.post(`${L}/${locL.id}/parts`, { data: { part_id: p1.id, ...input } });
  const nc = await apis.ga_works.post(`${N}/${locN.id}/parts`, { data: { items: [{ part_id: p1.id, ...input }] } });
  statusDiff(diffs, 'part-create-status', lc.status(), nc.status());
  expect(nc.status()).toBe(201);
  const SC = ['is_active', 'safety_stock_qty', 'reorder_point_qty', 'maximum_stock_qty', 'preferred_issue_unit_type', 'notes'];
  const lrow = (await rowsWhere('ga_inventory_location_parts', 'location_id', locL.id))[0];
  const nrow = (await rowsWhere('ga_inventory_location_parts', 'location_id', locN.id))[0];
  for (const c of SC) if (!same(lrow[c], nrow[c])) diffs.push({ kind: 'changed', key: `part-create-row#${c}`, legacy: lrow[c], native: nrow[c] });
  // 修改
  const lu = await apis.ga_works.patch(`${L}/${locL.id}/parts/${lrow.id}`, { data: { safety_stock_qty: 3, notes: '改後' } });
  const nu = await apis.ga_works.patch(`${N}/${locN.id}/parts/${nrow.id}`, { data: { safety_stock_qty: 3, notes: '改後', expected_updated_at: nrow.updated_at } });
  statusDiff(diffs, 'part-update-status', lu.status(), nu.status());
  const lrow2 = await row('ga_inventory_location_parts', lrow.id), nrow2 = await row('ga_inventory_location_parts', nrow.id);
  for (const c of SC) if (!same(lrow2[c], nrow2[c])) diffs.push({ kind: 'changed', key: `part-update-row#${c}`, legacy: lrow2[c], native: nrow2[c] });
  // 批次新增只有新版有：舊版沒有 items 陣列（回 400），新版一次加入多筆
  const lb = await apis.ga_works.post(`${L}/${locL.id}/parts`, { data: { items: [{ part_id: p2.id }] } });
  const nb = await apis.ga_works.post(`${N}/${locN.id}/parts`, { data: { items: [{ part_id: p2.id }, { part_id: (await seedPart(partCat.id, 'PW-3')).id }] } });
  statusDiff(diffs, 'part-batch-create', lb.status(), nb.status());
  expect(nb.status()).toBe(201);
  // 移除：有庫存時舊版照樣移除，新版擋下（C2）
  await seedBalance(locL.id, p1.id, 4);
  await seedBalance(locN.id, p1.id, 4);
  const lr = await apis.ga_works.delete(`${L}/${locL.id}/parts/${lrow.id}`, { data: { deletion_reason: '測試' } });
  const nr = await apis.ga_works.delete(`${N}/${locN.id}/parts/${nrow.id}`, { data: { deletion_reason: '測試', expected_updated_at: (await row('ga_inventory_location_parts', nrow.id)).updated_at } });
  statusDiff(diffs, 'part-remove-with-stock-status', lr.status(), nr.status());
  expect(nr.status()).toBe(409);
  if ((await row('ga_inventory_location_parts', lrow.id)).deleted_at) diffs.push({ kind: 'changed', key: 'part-remove-with-stock-result', legacy: 'removed', native: 'kept' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '位置料件設定寫入', legacy: { endpoint: `POST/PATCH/DELETE ${L}/:id/parts` }, native: { endpoint: `POST/PATCH/DELETE ${N}/:id/parts`, status: 201 }, compared: { rows: 4 }, diffs }));
});

test('C13：分類停用後，不換分類的修改舊版 API 與新版 API 都成功；換到停用分類兩邊都被擋且訊息相同（設備、設施）', async () => {
  const e = entry('category-keep-inactive');
  const diffs: Diff[] = [];
  const eCat = await seedCategory('equipment', 'PC13E');
  const eOff = await seedCategory('equipment', 'PC13E-OFF', { is_active: false });
  const fCat = await seedCategory('facility', 'PC13F');
  const fOff = await seedCategory('facility', 'PC13F-OFF', { is_active: false });
  const eqL = await seedEquipment('ZT01', eCat.id, 'PC13-EQL');
  const eqN = await seedEquipment('ZT01', eCat.id, 'PC13-EQN');
  const faL = await seedFacility('ZT01', fCat.id, 'PC13-FAL');
  const faN = await seedFacility('ZT01', fCat.id, 'PC13-FAN');
  for (const t of ['ga_equipment_categories', 'ga_facility_categories']) {
    await adminDb().from(t).update({ is_active: false }).in('id', [t === 'ga_equipment_categories' ? eCat.id : fCat.id]);
  }
  const O = '/api/general-affairs', W = '/api/workspace/general-affairs';
  for (const [kind, lid, nid, off, lrow, nrow] of [['equipment', eqL.id, eqN.id, eOff.id, eqL, eqN], ['facilities', faL.id, faN.id, fOff.id, faL, faN]] as const) {
    const table = kind === 'equipment' ? 'ga_equipment' : 'ga_facilities';
    const l1 = await apis.ga_works.patch(`${O}/${kind}/${lid}`, { data: { location_detail: '改位置' } });
    const n1 = await apis.ga_works.patch(`${W}/${kind}/${nid}`, { data: { location_detail: '改位置', expected_updated_at: nrow.updated_at } });
    statusDiff(diffs, `${kind}-keep-category-status`, l1.status(), n1.status());
    expect(n1.status()).toBe(200);
    expect((await row(table, lid)).location_detail).toBe((await row(table, nid)).location_detail);
    const cur = (await row(table, nid)).updated_at;
    const l2 = await apis.ga_works.patch(`${O}/${kind}/${lid}`, { data: { category_id: off } });
    const n2 = await apis.ga_works.patch(`${W}/${kind}/${nid}`, { data: { category_id: off, expected_updated_at: cur } });
    expect(n2.status()).toBe(400);
    statusDiff(diffs, `${kind}-change-to-inactive-status`, l2.status() >= 400 ? 400 : l2.status(), n2.status());
    const lm = JSON.stringify(await body(l2)), nm = JSON.stringify(await body(n2));
    const word = kind === 'equipment' ? '設備分類必須啟用' : '設施分類必須啟用';
    expect(lm).toContain(word);
    expect(nm).toContain(word);
    void lrow;
  }
  // 舊規則（任何修改都被擋）改為新規則：登記為問卷核可的差異
  diffs.push({ kind: 'changed', key: 'category-inactive-edit-allowed', detail: '分類停用後，不換分類的設備與設施可以修改其他欄位（C13，舊版也一起適用）', legacy: '舊規則：任何修改都被資料庫擋下', native: '新規則：只有新增或換分類才檢查分類必須啟用' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '分類停用後的修改（C13）', legacy: { endpoint: `PATCH ${O}/equipment|facilities/:id` }, native: { endpoint: `PATCH ${W}/equipment|facilities/:id`, status: 200 }, compared: { rows: 4 }, diffs }));
});
