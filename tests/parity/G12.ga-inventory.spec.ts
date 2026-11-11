import crypto from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G12 對等層：舊版 /api/general-affairs/inventory/{balances,transactions,options,transactions/post,balances/:id/holding} 與新版同功能 API，
// 同一個登入者、同一份輸入逐項比對；寫入以 service role 回讀資料庫欄位比對（兩邊共用同一個過帳核心函式與資料表）。
// 差異都列在 tests/parity/allowlist.json（page: ga-inventory）。
const map = loadMap('ga-inventory');
const rec = new ParityRecorder('ga-inventory');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs/inventory';
const N = '/api/workspace/general-affairs/inventory';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'store_manager'];
let partCat: { id: string };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  partCat = await seedCategory('part', 'PG12');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含過帳流水）').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const TIME_KEYS = new Set(['last_transaction_at', 'occurred_at', 'created_at', 'updated_at']);
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME_KEYS.has(key) && a && b) return Date.parse(String(a)) === Date.parse(String(b));
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'string' || typeof b === 'string') {
    if (a !== null && b !== null && a !== undefined && b !== undefined && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && String(a).trim() !== '' && String(b).trim() !== '') return Number(a) === Number(b);
  }
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
};
/** 逐欄比對一列：巢狀物件（nested）另外只比對兩邊都有的欄位，不在這裡逐欄報差異。 */
function diffRow(diffs: Diff[], label: string, legacy: any, native: any, nested: string[] = []) {
  for (const k of Object.keys(legacy)) {
    if (nested.includes(k)) continue;
    if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
    else if (!same(legacy[k], native[k], k)) diffs.push({ kind: 'changed', key: `${label}#${k}`, legacy: legacy[k], native: native[k] });
  }
  for (const k of Object.keys(native)) if (!nested.includes(k) && !(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of nested) {
    const l = legacy[k], n = native[k];
    if (l && n && typeof l === 'object') for (const kk of Object.keys(l)) if (kk in n && !same(l[kk], n[kk], kk) && kk !== 'store') diffs.push({ kind: 'changed', key: `${label}:${k}#${kk}`, legacy: l[kk], native: n[kk] });
  }
}
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });
const key = () => crypto.randomUUID();
const dbBal = async (loc: string, part: string) => (await adminDb().from('ga_inventory_balances').select('*').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any;
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at')).data || []) as any[];

async function pair(suffix: string, qty: number, over: { part?: Record<string, unknown>; loc?: Record<string, unknown>; store?: string | null } = {}) {
  const loc = await seedLocation(over.store === undefined ? 'ZT04' : over.store, `${suffix}-L`, over.loc);
  const part = await seedPart(partCat.id, `${suffix}-P`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false, ...over.part });
  await seedLocationPart(loc.id, part.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  const bal = qty ? await seedBalance(loc.id, part.id, qty) : null;
  return { loc, part, bal };
}

test('餘額清單：同一個登入者、同一個搜尋，id、欄位、位置與料件關聯、持有狀態與筆數相同；名單身分調整原因被遮蔽（C12）；新版多回低庫存標示與統計（C5、C7）', async () => {
  const e = entry('balance-list-read');
  const a = await pair('PB-A', 3, { store: 'ZT01' });
  const b = await pair('PB-B', 20, { store: 'VW001' });
  const c = await pair('PB-C', 0, { store: 'ZT01' });
  await seedBalance(c.loc.id, c.part.id, 0);
  const holdRow = await dbBal(a.loc.id, a.part.id);
  const gaApi = apis.ga_works;
  expect((await gaApi.post(`${N}/transactions/post`, { data: { transaction_type: 'RECEIPT', location_id: a.loc.id, part_id: a.part.id, quantity: 2, input_unit_type: 'BASE', reason: '建立最後異動時間', idempotency_key: key() } })).status()).toBe(201);
  expect((await gaApi.patch(`${N}/holding/${holdRow.id}`, { data: { in_use_quantity: 2, idle_quantity: 1, reason: '內部調整原因-PB', expected_updated_at: null } })).status()).toBe(200);
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent(m7Name('PB-'))}&includeZero=true&pageSize=100`;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}/balances?${q}`);
    const nr = await apis[role].get(`${N}/balances?${q}`);
    statusDiff(diffs, `${role}:status`, lr.status(), nr.status());
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
      if (!n) continue;
      diffRow(diffs, `${role}:${l.id}`, l, n, ['location', 'part', 'holding', 'store']);
      // 門市關聯：舊版在 location.store 內，新版在列的最上層 store
      if (!same(l.location?.store ?? null, n.store ?? null)) diffs.push({ kind: 'changed', key: `${role}:${l.id}:store`, legacy: l.location?.store, native: n.store });
    }
    for (const k of Object.keys(native)) if (!(k in legacy) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  const sm = await body(await apis.store_manager.get(`${N}/balances?${q}`));
  expect((sm.data as any[]).map((r) => r.id).sort()).toEqual([holdRow.id, (await dbBal(c.loc.id, c.part.id)).id].sort());
  expect(JSON.stringify(sm)).not.toContain('內部調整原因-PB');
  const ga = await body(await apis.ga_works.get(`${N}/balances?${q}`));
  expect(ga.data.find((r: any) => r.id === holdRow.id).holding.notes).toBe('內部調整原因-PB');
  expect(ga.data.find((r: any) => r.id === holdRow.id).level).toBe('yellow');
  expect(ga.stats).toMatchObject({ rows: 3, nonzero: 2, zero: 1 });
  // 匯出：舊版沒有
  const lx = await apis.ga_works.get(`${L}/balances/export?${q}`);
  const nx = await apis.ga_works.get(`${N}/balances/export?${q}`);
  expect(nx.status()).toBe(200);
  statusDiff(diffs, 'export-csv', lx.status() === 200 ? 200 : 404, nx.status());
  void b;
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '庫存餘額清單', legacy: { endpoint: `GET ${L}/balances` }, native: { endpoint: `GET ${N}/balances`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('流水清單：同一個位置篩選，單號、類型、數量、前後餘額、原因、發生時間相同；新版回記錄人姓名與來源、不回識別碼；日期用台北時間；名單身分原因與備註遮蔽（C12）', async () => {
  const e = entry('transaction-list-read');
  const p = await pair('PT', 0, { store: 'ZT01' });
  const post = async (over: Record<string, unknown>) => (await apis.ga_works.post(`${N}/transactions/post`, { data: { transaction_type: 'RECEIPT', location_id: p.loc.id, part_id: p.part.id, quantity: 5, input_unit_type: 'BASE', reason: '內部原因-PT', notes: '內部備註-PT', idempotency_key: key(), ...over } })).status();
  expect(await post({ occurred_at: '2026-10-03T10:00:00+08:00' })).toBe(201);
  expect(await post({ transaction_type: 'ISSUE', quantity: 2, occurred_at: '2026-10-03T23:30:00+08:00' })).toBe(201);
  expect(await post({ quantity: 1, occurred_at: '2026-10-04T00:10:00+08:00' })).toBe(201);
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `locationId=${p.loc.id}&pageSize=100&sortOrder=asc`;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}/transactions?${q}&sort=occurred_at`);
    const nr = await apis[role].get(`${N}/transactions?${q}&sort=occurred_at`);
    statusDiff(diffs, `${role}:status`, lr.status(), nr.status());
    expect(nr.status()).toBe(200);
    const legacy = await body(lr), native = await body(nr);
    const lids = (legacy.data as any[]).map((r) => r.id);
    const nids = (native.data as any[]).map((r) => r.id);
    if (JSON.stringify(lids) !== JSON.stringify(nids)) diffs.push({ kind: 'changed', key: `${role}:ids`, legacy: lids, native: nids });
    for (const k of Object.keys(legacy.meta)) if (legacy.meta[k] !== native.meta[k]) diffs.push({ kind: 'count', key: `${role}:meta#${k}`, legacy: legacy.meta[k], native: native.meta[k] });
    const nm = new Map((native.data as any[]).map((r) => [r.id, r]));
    for (const l of legacy.data as any[]) {
      compared += 1;
      const n = nm.get(l.id);
      if (!n) continue;
      diffRow(diffs, `${role}:${l.id}`, l, n, ['location', 'part']);
    }
    for (const k of Object.keys(native)) if (!(k in legacy) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  // 日期篩選：舊版把 YYYY-MM-DD 當成 UTC 的 0 點；新版用台北時間一整天
  const ld = await body(await apis.ga_works.get(`${L}/transactions?locationId=${p.loc.id}&dateFrom=2026-10-03&dateTo=2026-10-03`));
  const nd = await body(await apis.ga_works.get(`${N}/transactions?locationId=${p.loc.id}&dateFrom=2026-10-03&dateTo=2026-10-03`));
  expect(nd.data).toHaveLength(2);
  if (ld.data?.length !== nd.data.length) diffs.push({ kind: 'count', key: 'date-filter-taipei', legacy: ld.data?.length ?? 0, native: nd.data.length });
  const sm = await body(await apis.store_manager.get(`${N}/transactions?${q}`));
  expect(sm.data).toHaveLength(3);
  expect(JSON.stringify(sm)).not.toContain('內部');
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '庫存流水清單', legacy: { endpoint: `GET ${L}/transactions` }, native: { endpoint: `GET ${N}/transactions`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('持有狀態：同一份資料，新版 /holding 每列持有量與彙總等於舊版餘額清單內嵌的持有量加總', async () => {
  const e = entry('holding-read');
  const a = await pair('PH-A', 10);
  const b = await pair('PH-B', 6);
  const ba = await dbBal(a.loc.id, a.part.id), bb = await dbBal(b.loc.id, b.part.id);
  expect((await apis.ga_works.put(`${L}/balances/${ba.id}/holding`, { data: { in_use_quantity: 4, idle_quantity: 3, notes: '舊版調整' } })).status()).toBe(200);
  expect((await apis.ga_works.patch(`${N}/holding/${bb.id}`, { data: { in_use_quantity: 1, idle_quantity: 5, reason: '新版調整', expected_updated_at: null } })).status()).toBe(200);
  const diffs: Diff[] = [];
  const q = `search=${encodeURIComponent(m7Name('PH-'))}&includeZero=false&pageSize=100`;
  const legacy = await body(await apis.ga_works.get(`${L}/balances?${q}`));
  const native = await body(await apis.ga_works.get(`${N}/holding?search=${encodeURIComponent(m7Name('PH-'))}&pageSize=100`));
  const lm = new Map((legacy.data as any[]).map((r) => [r.id, r.holding]));
  let compared = 0;
  for (const n of native.data as any[]) {
    compared += 1;
    const l = lm.get(n.id);
    for (const k of ['in_use_quantity', 'idle_quantity', 'unclassified_quantity']) if (!same(l?.[k], n.holding[k])) diffs.push({ kind: 'changed', key: `${n.id}#${k}`, legacy: l?.[k], native: n.holding[k] });
  }
  const sum = (k: string) => (legacy.data as any[]).filter((r) => Number(r.quantity_base) > 0).reduce((s, r) => s + Number(r.holding[k]), 0);
  for (const [k, nk] of [['in_use_quantity', 'in_use'], ['idle_quantity', 'idle'], ['unclassified_quantity', 'unclassified']] as const) {
    if (sum(k) !== Number(native.summary[nk])) diffs.push({ kind: 'count', key: `summary#${nk}`, legacy: sum(k), native: native.summary[nk] });
  }
  expect(native.top[0].id).toBe(bb.id); // 閒置最多（5）排第一
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '持有狀態', legacy: { endpoint: `GET ${L}/balances（內嵌 holding）` }, native: { endpoint: `GET ${N}/holding`, status: 200 }, compared: { rows: compared }, diffs }));
});

test('過帳選項：同一個位置的位置料件與目前庫存逐筆相同；新版搜尋加分頁（超過一頁時舊版一次全回）', async () => {
  const e = entry('options-read');
  const loc = await seedLocation('ZT04', 'PO-L');
  const parts: any[] = [];
  for (let i = 0; i < 22; i += 1) {
    const part = await seedPart(partCat.id, `PO-P${String(i).padStart(2, '0')}`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
    await seedLocationPart(loc.id, part.id);
    parts.push(part);
  }
  await seedBalance(loc.id, parts[0].id, 7);
  const diffs: Diff[] = [];
  const legacy = await body(await apis.ga_works.get(`${L}/options`));
  const nlp = await body(await apis.ga_works.get(`${N}/options?type=location-parts&locationId=${loc.id}&pageSize=100`));
  const nfirst = await body(await apis.ga_works.get(`${N}/options?type=location-parts&locationId=${loc.id}`));
  const llp = (legacy.data.locationParts as any[]).filter((x) => x.location_id === loc.id);
  expect(nlp.data).toHaveLength(22);
  const nm = new Map((nlp.data as any[]).map((r) => [r.part_id, r]));
  let compared = 0;
  for (const l of llp) {
    compared += 1;
    const n = nm.get(l.part_id);
    if (!n) { diffs.push({ kind: 'changed', key: `lp:${l.part_id}`, legacy: 'present', native: 'missing' }); continue; }
    if (!same(l.currentBalance?.quantity_base ?? null, n.currentBalance?.quantity_base ?? null)) diffs.push({ kind: 'changed', key: `lp:${l.part_id}#currentBalance`, legacy: l.currentBalance?.quantity_base, native: n.currentBalance?.quantity_base });
    for (const k of ['base_unit', 'purchase_unit', 'purchase_to_base_rate', 'minimum_issue_qty', 'allow_fractional_issue', 'allow_unpacking', 'name']) if (!same(l.part?.[k], n.part?.[k])) diffs.push({ kind: 'changed', key: `lp:${l.part_id}#${k}`, legacy: l.part?.[k], native: n.part?.[k] });
  }
  const llocs = (legacy.data.locations as any[]).find((x) => x.id === loc.id);
  expect(llocs).toBeTruthy();
  const nl = await body(await apis.ga_works.get(`${N}/options?type=locations&search=${encodeURIComponent(loc.name)}`));
  if (nl.data[0]?.allow_negative_stock !== llocs.allow_negative_stock) diffs.push({ kind: 'changed', key: 'location#allow_negative_stock', legacy: llocs.allow_negative_stock, native: nl.data[0]?.allow_negative_stock });
  // 分頁：新版預設一頁 20 筆，舊版一次回全部
  if (nfirst.data.length !== llp.length) diffs.push({ kind: 'count', key: 'options-paginated', legacy: llp.length, native: nfirst.data.length });
  expect(nfirst.meta.total).toBe(22);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '過帳選項', legacy: { endpoint: `GET ${L}/options` }, native: { endpoint: `GET ${N}/options`, status: 200 }, compared: { rows: compared }, diffs }));
});

const TXN_COLS = ['transaction_type', 'quantity_input', 'input_unit_type', 'unit_conversion_rate', 'quantity_base', 'balance_before', 'balance_after', 'reason', 'notes', 'reference_type'];
test('過帳後回讀資料庫：同一份輸入，兩邊寫入的流水與餘額相同（四種類型、採購單位換算）；新規則差異（未來時間、補登舊日期、錯誤狀態碼）', async () => {
  const e = entry('post-write-readback');
  const diffs: Diff[] = [];
  const mk = async (tag: string) => pair(tag, 0, { part: { purchase_unit: '箱', purchase_to_base_rate: 12 } });
  const L1 = await mk('WL1'), N1 = await mk('WN1');
  const legacyBody = (p: any, o: Record<string, unknown>) => ({ transactionType: 'RECEIPT', locationId: p.loc.id, partId: p.part.id, quantity: 2, inputUnitType: 'PURCHASE', reason: '對等測試', notes: '備註', idempotencyKey: key(), ...o });
  const nativeBody = (p: any, o: Record<string, unknown>) => ({ transaction_type: 'RECEIPT', location_id: p.loc.id, part_id: p.part.id, quantity: 2, input_unit_type: 'PURCHASE', reason: '對等測試', notes: '備註', idempotency_key: key(), ...o });
  const steps: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['RECEIPT 採購單位', {}, {}],
    ['ISSUE 整箱', { transactionType: 'ISSUE', quantity: 1 }, { transaction_type: 'ISSUE', quantity: 1 }],
    ['ADJUST_OUT 基本單位 12', { transactionType: 'ADJUST_OUT', quantity: 12, inputUnitType: 'BASE' }, { transaction_type: 'ADJUST_OUT', quantity: 12, input_unit_type: 'BASE' }],
    ['ADJUST_IN 基本單位 5', { transactionType: 'ADJUST_IN', quantity: 5, inputUnitType: 'BASE' }, { transaction_type: 'ADJUST_IN', quantity: 5, input_unit_type: 'BASE' }],
  ];
  for (const [label, lo, no] of steps) {
    const lr = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, lo) });
    const nr = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, no) });
    statusDiff(diffs, `post-status:${label}`, lr.status(), nr.status());
    expect(nr.status(), label).toBe(201);
  }
  const lt = await dbTx(L1.loc.id, L1.part.id), nt = await dbTx(N1.loc.id, N1.part.id);
  expect(nt).toHaveLength(4);
  expect(lt).toHaveLength(4);
  lt.forEach((l, i) => { for (const c of TXN_COLS) if (!same(l[c], nt[i][c])) diffs.push({ kind: 'changed', key: `tx${i}#${c}`, legacy: l[c], native: nt[i][c] }); });
  const lb = await dbBal(L1.loc.id, L1.part.id), nb = await dbBal(N1.loc.id, N1.part.id);
  for (const c of ['quantity_base', 'version']) if (!same(lb[c], nb[c])) diffs.push({ kind: 'changed', key: `balance#${c}`, legacy: lb[c], native: nb[c] });
  // 庫存不足：兩邊都擋（狀態碼相同）
  const li = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, { transactionType: 'ISSUE', quantity: 1200, inputUnitType: 'BASE' }) });
  const ni = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, { transaction_type: 'ISSUE', quantity: 1200, input_unit_type: 'BASE' }) });
  statusDiff(diffs, 'insufficient-status', li.status(), ni.status());
  expect(ni.status()).toBe(409);
  // 冪等重送：兩邊都回原交易
  const k = key(), k2 = key(); // 識別碼以人為範圍，兩邊用不同字串
  const l1 = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, { idempotencyKey: k, quantity: 1, inputUnitType: 'BASE' }) });
  const l2 = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, { idempotencyKey: k, quantity: 1, inputUnitType: 'BASE' }) });
  const n1 = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, { idempotency_key: k2, quantity: 1, input_unit_type: 'BASE' }) });
  const n2 = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, { idempotency_key: k2, quantity: 1, input_unit_type: 'BASE' }) });
  expect([l1.status(), l2.status()]).toEqual([201, 201]);
  expect([n1.status(), n2.status()]).toEqual([201, 200]);
  statusDiff(diffs, 'replay-status', l2.status(), n2.status());
  expect((await dbTx(N1.loc.id, N1.part.id)).length).toBe((await dbTx(L1.loc.id, L1.part.id)).length);
  // 發生時間在未來：舊版接受，新版擋
  const future = new Date(Date.now() + 3 * 3600_000).toISOString();
  const lf = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, { occurredAt: future, quantity: 1, inputUnitType: 'BASE' }) });
  const nf = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, { occurred_at: future, quantity: 1, input_unit_type: 'BASE' }) });
  statusDiff(diffs, 'future-occurred-at-status', lf.status(), nf.status());
  expect(nf.status()).toBe(400);
  // 補登舊日期：舊版把餘額的最後異動時間倒退成舊日期，新版不倒退
  const old = '2026-10-01T02:00:00.000Z';
  const lo = await apis.ga_works.post(`${L}/transactions/post`, { data: legacyBody(L1, { occurredAt: old, quantity: 1, inputUnitType: 'BASE' }) });
  const no = await apis.ga_works.post(`${N}/transactions/post`, { data: nativeBody(N1, { occurred_at: old, quantity: 1, input_unit_type: 'BASE' }) });
  expect([lo.status(), no.status()]).toEqual([201, 201]);
  const lb2 = await dbBal(L1.loc.id, L1.part.id), nb2 = await dbBal(N1.loc.id, N1.part.id);
  if (Date.parse(lb2.last_transaction_at) !== Date.parse(nb2.last_transaction_at) && Date.parse(lb2.last_transaction_at) === Date.parse(old)) {
    diffs.push({ kind: 'changed', key: 'last-transaction-not-regress', legacy: lb2.last_transaction_at, native: nb2.last_transaction_at });
  }
  expect(Date.parse(nb2.last_transaction_at)).toBeGreaterThan(Date.parse(old));
  // 只有交易管理（沒有料件查看）：舊版與新版都擋，新版說清楚缺哪個
  const txnOnly = await apiAs('ga_inv_txn_only');
  const lp = await txnOnly.post(`${L}/transactions/post`, { data: legacyBody(L1, { quantity: 1, inputUnitType: 'BASE' }) });
  const np = await txnOnly.post(`${N}/transactions/post`, { data: nativeBody(N1, { quantity: 1, input_unit_type: 'BASE' }) });
  statusDiff(diffs, 'missing-part-view-status', lp.status(), np.status());
  expect((await body(np)).error).toContain('料件查看');
  await txnOnly.dispose();
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '過帳', legacy: { endpoint: `POST ${L}/transactions/post` }, native: { endpoint: `POST ${N}/transactions/post`, status: 201 }, compared: { rows: 8 }, diffs }));
});

test('調整持有狀態後回讀資料庫：同一份輸入，兩邊的持有量、備註、事件紀錄相同；新版要帶 expected_updated_at（版本檢查）', async () => {
  const e = entry('holding-write-readback');
  const diffs: Diff[] = [];
  const a = await pair('WH-A', 10), b = await pair('WH-B', 10);
  const ba = await dbBal(a.loc.id, a.part.id), bb = await dbBal(b.loc.id, b.part.id);
  const lr = await apis.ga_works.put(`${L}/balances/${ba.id}/holding`, { data: { in_use_quantity: 4, idle_quantity: 3, notes: '調整說明' } });
  const nr = await apis.ga_works.patch(`${N}/holding/${bb.id}`, { data: { in_use_quantity: 4, idle_quantity: 3, reason: '調整說明', expected_updated_at: null } });
  statusDiff(diffs, 'holding-update-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const get = async (id: string) => ({
    alloc: (await adminDb().from('ga_inventory_holding_allocations').select('*').eq('balance_id', id).single()).data as any,
    events: ((await adminDb().from('ga_inventory_holding_events').select('*').eq('balance_id', id)).data || []) as any[],
  });
  const l = await get(ba.id), n = await get(bb.id);
  for (const c of ['in_use_quantity', 'idle_quantity', 'notes']) if (!same(l.alloc[c], n.alloc[c])) diffs.push({ kind: 'changed', key: `alloc#${c}`, legacy: l.alloc[c], native: n.alloc[c] });
  expect(n.events).toHaveLength(1);
  for (const c of ['before_in_use_quantity', 'before_idle_quantity', 'after_in_use_quantity', 'after_idle_quantity', 'notes']) if (!same(l.events[0][c], n.events[0][c])) diffs.push({ kind: 'changed', key: `event#${c}`, legacy: l.events[0][c], native: n.events[0][c] });
  // 超過持有量：兩邊都擋
  const lx = await apis.ga_works.put(`${L}/balances/${ba.id}/holding`, { data: { in_use_quantity: 9, idle_quantity: 9, notes: '' } });
  const nx = await apis.ga_works.patch(`${N}/holding/${bb.id}`, { data: { in_use_quantity: 9, idle_quantity: 9, expected_updated_at: n.alloc.updated_at } });
  statusDiff(diffs, 'exceeds-status', lx.status(), nx.status());
  expect(nx.status()).toBe(409);
  // 沒帶版本：舊版直接成功（可能蓋掉別人的調整），新版 400
  const lv = await apis.ga_works.put(`${L}/balances/${ba.id}/holding`, { data: { in_use_quantity: 1, idle_quantity: 1, notes: '無版本' } });
  const nv = await apis.ga_works.patch(`${N}/holding/${bb.id}`, { data: { in_use_quantity: 1, idle_quantity: 1 } });
  statusDiff(diffs, 'update-without-version', lv.status(), nv.status());
  expect(nv.status()).toBe(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '持有狀態調整', legacy: { endpoint: `PUT ${L}/balances/:id/holding` }, native: { endpoint: `PATCH ${N}/holding/:balanceId`, status: 200 }, compared: { rows: 4 }, diffs }));
});
