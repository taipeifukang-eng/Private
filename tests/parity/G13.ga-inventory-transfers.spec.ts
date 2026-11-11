import crypto from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedTransfer } from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G13 對等層：舊版 /api/general-affairs/inventory/transfers（清單、建單、動作）與新版同功能 API，同一個登入者、同一份輸入逐項比對；
// 寫入以 service role 回讀資料庫欄位比對（兩邊共用同一個過帳核心函式與資料表）。差異都列在 tests/parity/allowlist.json（page: ga-inventory-transfers）。
const map = loadMap('ga-inventory-transfers');
const rec = new ParityRecorder('ga-inventory-transfers');
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
  partCat = await seedCategory('part', 'PG13');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含調撥與過帳流水）').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const TIME_KEYS = new Set(['source_confirmed_at', 'shipped_at', 'received_at', 'canceled_at', 'created_at', 'updated_at']);
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME_KEYS.has(key) && a && b) return Date.parse(String(a)) === Date.parse(String(b));
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'string' || typeof b === 'string') {
    if (a !== null && b !== null && a !== undefined && b !== undefined && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && String(a).trim() !== '' && String(b).trim() !== '') return Number(a) === Number(b);
  }
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
};
function diffRow(diffs: Diff[], label: string, legacy: any, native: any, nested: string[] = []) {
  for (const k of Object.keys(legacy)) {
    if (nested.includes(k)) continue;
    if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
    else if (!same(legacy[k], native[k], k)) diffs.push({ kind: 'changed', key: `${label}#${k}`, legacy: legacy[k], native: native[k] });
  }
  for (const k of Object.keys(native)) if (!nested.includes(k) && !(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
  for (const k of nested) {
    const l = legacy[k], n = native[k];
    if (l && n && typeof l === 'object' && !Array.isArray(l)) for (const kk of Object.keys(l)) if (kk in n && !same(l[kk], n[kk], kk) && kk !== 'store') diffs.push({ kind: 'changed', key: `${label}:${k}#${kk}`, legacy: l[kk], native: n[kk] });
  }
}
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });
const key = () => crypto.randomUUID();
const dbT = async (id: string) => (await adminDb().from('ga_inventory_transfers').select('*').eq('id', id).single()).data as any;
const dbItems = async (id: string) => ((await adminDb().from('ga_inventory_transfer_items').select('*').eq('transfer_id', id).order('created_at')).data || []) as any[];
const dbBal = async (loc: string, part: string) => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at')).data || []) as any[];

/** 來源（中央倉庫，有庫存）＋目的（ZT01 門市位置）＋料件，兩邊都有設定。 */
async function setup(suffix: string, o: { qty?: number; destCfg?: boolean } = {}) {
  const src = await seedLocation(null, `${suffix}-S`);
  const dest = await seedLocation('ZT01', `${suffix}-D`);
  const part = await seedPart(partCat.id, `${suffix}-P`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(src.id, part.id);
  if (o.destCfg !== false) await seedLocationPart(dest.id, part.id);
  await seedBalance(src.id, part.id, o.qty ?? 30);
  return { src, dest, part };
}
type S = Awaited<ReturnType<typeof setup>>;
const legacyCreate = (s: S, o: Record<string, unknown> = {}) => ({ sourceLocationId: s.src.id, destinationLocationId: s.dest.id, reason: m7Name('CR'), notes: '建單備註', shippingMethod: '總務配送', items: [{ partId: s.part.id, quantity: 5, inputUnitType: 'BASE' }], ...o });
const nativeCreate = (s: S, o: Record<string, unknown> = {}) => ({ source_location_id: s.src.id, destination_location_id: s.dest.id, reason: m7Name('CR'), notes: '建單備註', shipping_method: '總務配送', part_id: s.part.id, quantity: 5, input_unit_type: 'BASE', idempotency_key: key(), ...o });
const legacyAct = (api: APIRequestContext, id: string, action: string, o: Record<string, unknown> = {}) => api.post(`${L}/transfers/${id}/actions`, { data: { action, idempotencyKey: key(), ...o } });
const nativeAct = async (api: APIRequestContext, id: string, action: string, o: Record<string, unknown> = {}) => {
  const cur = (await dbT(id)).updated_at;
  return api.post(`${N}/transfers/${id}/actions`, { data: { action, expected_updated_at: cur, idempotency_key: key(), ...o } });
};

test('調撥單清單：同一個登入者、同一個搜尋，id、欄位、位置與料件關聯、筆數相同；名單身分內部備註被遮蔽（C12）；新版多回逾期與回報標示、abilities、統計（C10、C11）', async () => {
  const e = entry('transfer-list-read');
  const a = await setup('PL-A');
  const b = await setup('PL-B');
  const ta = await seedTransfer(a.src.id, a.dest.id, a.part.id, 'PL-A', 'SOURCE_CONFIRMED');
  const tb = await seedTransfer(b.src.id, b.dest.id, b.part.id, 'PL-B', 'REQUESTED');
  await adminDb().from('ga_inventory_transfers').update({ notes: '內部備註-PL', shipping_method: '物流寄送', source_confirmed_at: new Date().toISOString() }).eq('id', ta.id);
  const diffs: Diff[] = [];
  let compared = 0;
  const q = `search=${encodeURIComponent(m7Name('PL-'))}&pageSize=100`;
  for (const role of ROLES) {
    const lr = await apis[role].get(`${L}/transfers?${q}`);
    const nr = await apis[role].get(`${N}/transfers?${q}`);
    statusDiff(diffs, `${role}:status`, lr.status(), nr.status());
    expect(nr.status()).toBe(200);
    if (lr.status() !== 200) continue; // 舊版不給這個角色看（沒有調撥／交易／餘額權限），新版名單身分唯讀可看（C12）
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
      diffRow(diffs, `${role}:${l.id}`, l, n, ['source_location', 'destination_location', 'items']);
      const ni = new Map((n.items as any[]).map((i) => [i.id, i]));
      for (const li of l.items as any[]) {
        const x = ni.get(li.id);
        if (x) diffRow(diffs, `${role}:${l.id}:item`, li, x, ['part']);
        else diffs.push({ kind: 'changed', key: `${role}:${l.id}:item-missing`, legacy: li.id, native: null });
      }
    }
    for (const k of Object.keys(native)) if (!(k in legacy) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-native', key: `${role}:top#${k}` });
    for (const k of Object.keys(legacy)) if (!(k in native) && k !== 'data' && k !== 'meta') diffs.push({ kind: 'only-legacy', key: `${role}:top#${k}` });
  }
  // C12：名單身分看得到單，但內部備註被遮蔽；總務看得到
  const sm = await body(await apis.store_manager.get(`${N}/transfers?${q}`));
  expect((sm.data as any[]).map((r) => r.id)).toContain(ta.id);
  expect(JSON.stringify(sm)).not.toContain('內部備註-PL');
  const ga = await body(await apis.ga_works.get(`${N}/transfers?${q}`));
  expect((ga.data as any[]).find((r) => r.id === ta.id).notes).toBe('內部備註-PL');
  expect(ga.stats).toMatchObject({ all: 2, REQUESTED: 1, SOURCE_CONFIRMED: 1 });
  void tb;
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '調撥單清單', legacy: { endpoint: `GET ${L}/transfers` }, native: { endpoint: `GET ${N}/transfers`, status: 200 }, compared: { rows: compared }, diffs }));
});

const TR_COLS = ['status', 'reason', 'notes', 'shipping_method'];
test('建單：舊版 POST 在這個資料庫設定下建不起來（新增列再讀回時被列級權限擋下，回 500）；新版以資料庫函式建單，回讀的調撥單與明細符合輸入；新規則（目的位置缺設定被擋、固定識別防重複、單號台北日期、一張單一個料件）', async () => {
  const e = entry('transfer-create-write-readback');
  const diffs: Diff[] = [];
  const reasonL = m7Name('CR-L'), reasonN = m7Name('CR-N');
  const l1 = await setup('WCL'), n1 = await setup('WCN');
  const lr = await apis.ga_works.post(`${L}/transfers`, { data: legacyCreate(l1, { reason: reasonL }) });
  const nr = await apis.ga_works.post(`${N}/transfers`, { data: nativeCreate(n1, { reason: reasonN }) });
  statusDiff(diffs, 'create-status', lr.status(), nr.status());
  expect(nr.status()).toBe(201);
  const nt = await dbT((await body(nr)).data.id);
  // 舊版建單成功時（其他環境）才比對欄位；這個資料庫舊版建單失敗，也沒有留下半張單
  if (lr.status() === 201) {
    const lt = await dbT((await body(lr)).data.id);
    for (const c of TR_COLS) {
      const lv = c === 'reason' ? reasonL : lt[c], nv = c === 'reason' ? reasonN : nt[c];
      if (!same(lv, nv)) diffs.push({ kind: 'changed', key: `transfer#${c}`, legacy: lt[c], native: nt[c] });
    }
    if (lt.transfer_no.slice(4, 12) !== nt.transfer_no.slice(4, 12)) diffs.push({ kind: 'changed', key: 'transfer-no-date', legacy: lt.transfer_no, native: nt.transfer_no });
  } else {
    expect(((await adminDb().from('ga_inventory_transfers').select('id').eq('reason', reasonL)).data || []).length).toBe(0);
  }
  expect(nt).toMatchObject({ status: 'REQUESTED', reason: reasonN, notes: '建單備註', shipping_method: '總務配送', source_location_id: n1.src.id, destination_location_id: n1.dest.id });
  expect(nt.transfer_no).toMatch(/^GAT-\d{8}-\d{5}$/);
  const ni = await dbItems(nt.id);
  expect(ni).toHaveLength(1);
  expect(ni[0]).toMatchObject({ part_id: n1.part.id, input_unit_type: 'BASE', source_transaction_id: null, receipt_transaction_id: null });
  expect(Number(ni[0].quantity_input)).toBe(5);
  expect(await dbBal(n1.src.id, n1.part.id)).toBe(30); // 建單不動庫存
  // 目的位置沒設定這個料件：新版建單就擋（C8），舊版收貨才會失敗
  const n2 = await setup('WCN2', { destCfg: false });
  const nx = await apis.ga_works.post(`${N}/transfers`, { data: nativeCreate(n2, { reason: reasonN }) });
  expect(nx.status()).toBe(422);
  // 重送同一份輸入：新版以固定識別只建一張
  const n3 = await setup('WCN3');
  const reasonN3 = m7Name('CR-N3');
  const k = key();
  await apis.ga_works.post(`${N}/transfers`, { data: nativeCreate(n3, { reason: reasonN3, idempotency_key: k }) });
  await apis.ga_works.post(`${N}/transfers`, { data: nativeCreate(n3, { reason: reasonN3, idempotency_key: k }) });
  expect(((await adminDb().from('ga_inventory_transfers').select('id').eq('reason', reasonN3)).data || []).length).toBe(1);
  // 舊版一張單可以放多個料件：新版一張單一個料件，舊格式（items 陣列）被拒絕
  const m2 = await setup('WCM');
  const nm = await apis.ga_works.post(`${N}/transfers`, { data: { ...nativeCreate(m2, { reason: reasonN }), items: [{ partId: m2.part.id }] } });
  expect(nm.status()).toBe(400);
  // 沒有三個權限：只有交易管理的人被擋，說明缺哪個
  const txnOnly = await apiAs('ga_inv_txn_only');
  const n4 = await setup('WCN4');
  const np = await txnOnly.post(`${N}/transfers`, { data: nativeCreate(n4, { reason: reasonN }) });
  expect(np.status()).toBe(403);
  expect((await body(np)).error).toContain('調撥管理');
  await txnOnly.dispose();
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '調撥建單', legacy: { endpoint: `POST ${L}/transfers` }, native: { endpoint: `POST ${N}/transfers`, status: 201 }, compared: { rows: 4 }, diffs }));
});

/** 動作測試的前置調撥單：直接寫入資料庫（舊版建單在這個資料庫建不起來，兩邊從同一個起點比較動作本身）。 */
async function seedReq(s: S, reason: string) {
  const t = (await adminDb().from('ga_inventory_transfers').insert({ source_location_id: s.src.id, destination_location_id: s.dest.id, reason, notes: '建單備註', shipping_method: '總務配送' }).select('*').single()).data as any;
  await adminDb().from('ga_inventory_transfer_items').insert({ transfer_id: t.id, part_id: s.part.id, quantity_input: 5, input_unit_type: 'BASE' });
  return { id: t.id as string };
}

const TX_COLS = ['transaction_type', 'quantity_input', 'input_unit_type', 'quantity_base', 'balance_before', 'balance_after', 'reference_type'];
test('動作後回讀資料庫：同一份輸入，兩邊的狀態、庫存、流水與明細流水關聯相同；新規則差異（備註不清空、取消可退回來源庫存、白話錯誤與狀態碼、版本與固定識別）', async () => {
  const e = entry('transfer-action-write-readback');
  const diffs: Diff[] = [];
  const reasonL = m7Name('AC-L'), reasonN = m7Name('AC-N');
  const l1 = await setup('WAL'), n1 = await setup('WAN');
  const lt = await seedReq(l1, reasonL);
  const nt = await seedReq(n1, reasonN);
  const compareState = async (step: string) => {
    const a = await dbT(lt.id), b = await dbT(nt.id);
    for (const c of ['status', 'notes', 'shipping_method']) if (!same(a[c], b[c])) diffs.push({ kind: 'changed', key: `${step}:transfer#${c}`, legacy: a[c], native: b[c] });
    const ia = (await dbItems(lt.id))[0], ib = (await dbItems(nt.id))[0];
    for (const c of ['source_transaction_id', 'receipt_transaction_id']) if (!!ia[c] !== !!ib[c]) diffs.push({ kind: 'changed', key: `${step}:item#${c}`, legacy: !!ia[c], native: !!ib[c] });
    const sa = await dbBal(l1.src.id, l1.part.id), sb = await dbBal(n1.src.id, n1.part.id);
    const da = await dbBal(l1.dest.id, l1.part.id), db = await dbBal(n1.dest.id, n1.part.id);
    if (sa !== sb) diffs.push({ kind: 'changed', key: `${step}:source-balance`, legacy: sa, native: sb });
    if (da !== db) diffs.push({ kind: 'changed', key: `${step}:destination-balance`, legacy: da, native: db });
    for (const [loc1, loc2, part1, part2, side] of [[l1.src.id, n1.src.id, l1.part.id, n1.part.id, 'source'], [l1.dest.id, n1.dest.id, l1.part.id, n1.part.id, 'destination']] as const) {
      const ta = await dbTx(loc1, part1), tb = await dbTx(loc2, part2);
      if (ta.length !== tb.length) diffs.push({ kind: 'count', key: `${step}:${side}-tx-count`, legacy: ta.length, native: tb.length });
      ta.forEach((x, i) => { if (tb[i]) for (const c of TX_COLS) if (!same(x[c], tb[i][c])) diffs.push({ kind: 'changed', key: `${step}:${side}-tx#${c}`, legacy: x[c], native: tb[i][c] }); });
    }
  };
  // 確認交出
  let lr = await legacyAct(apis.ga_works, lt.id, 'CONFIRM_SOURCE', { notes: '交出備註', shippingMethod: '物流寄送' });
  let nr = await nativeAct(apis.ga_works, nt.id, 'confirm_source', { note: '交出備註', shipping_method: '物流寄送' });
  statusDiff(diffs, 'confirm-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  await compareState('confirm');
  expect(await dbBal(n1.src.id, n1.part.id)).toBe(25);
  // 運送中
  lr = await legacyAct(apis.ga_works, lt.id, 'MARK_IN_TRANSIT', { notes: '運送備註' });
  nr = await nativeAct(apis.ga_works, nt.id, 'ship', { note: '運送備註' });
  statusDiff(diffs, 'ship-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  await compareState('ship');
  // 收貨
  lr = await legacyAct(apis.ga_works, lt.id, 'RECEIVE', { notes: '收貨備註' });
  nr = await nativeAct(apis.ga_works, nt.id, 'receive', { note: '收貨備註' });
  statusDiff(diffs, 'receive-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  await compareState('receive');
  expect(await dbBal(n1.dest.id, n1.part.id)).toBe(5);
  // 已收貨再取消：兩邊都擋，狀態碼不同（舊版英文訊息回 500 或 400，新版 409）
  lr = await legacyAct(apis.ga_works, lt.id, 'CANCEL', { cancelReason: '太晚了' });
  nr = await nativeAct(apis.ga_works, nt.id, 'cancel', { note: '太晚了' });
  statusDiff(diffs, 'cancel-after-receive-status', lr.status(), nr.status());
  expect(nr.status()).toBe(409);
  // 還沒交出就收貨：兩邊都擋
  const l2 = await setup('WAL2'), n2 = await setup('WAN2');
  const lt2 = await seedReq(l2, reasonL);
  const nt2 = await seedReq(n2, reasonN);
  lr = await legacyAct(apis.ga_works, lt2.id, 'RECEIVE');
  nr = await nativeAct(apis.ga_works, nt2.id, 'receive');
  statusDiff(diffs, 'receive-before-confirm-status', lr.status(), nr.status());
  expect(nr.status()).toBe(409);
  // 庫存不足交出：兩邊都擋（單子維持原狀、沒有流水）
  const l3 = await setup('WAL3', { qty: 2 }), n3 = await setup('WAN3', { qty: 2 });
  const lt3 = await seedReq(l3, reasonL);
  const nt3 = await seedReq(n3, reasonN);
  lr = await legacyAct(apis.ga_works, lt3.id, 'CONFIRM_SOURCE');
  nr = await nativeAct(apis.ga_works, nt3.id, 'confirm_source');
  statusDiff(diffs, 'insufficient-stock-status', lr.status(), nr.status());
  expect(nr.status()).toBe(409);
  expect((await dbT(lt3.id)).status).toBe('REQUESTED');
  expect((await dbT(nt3.id)).status).toBe('REQUESTED');
  expect(await dbTx(n3.src.id, n3.part.id)).toEqual([]);
  // 取消：已交出後取消，舊版不退回來源庫存；新版勾選才退回（Q12）
  const l4 = await setup('WAL4'), n4 = await setup('WAN4');
  const lt4 = await seedReq(l4, reasonL);
  const nt4 = await seedReq(n4, reasonN);
  await legacyAct(apis.ga_works, lt4.id, 'CONFIRM_SOURCE');
  await nativeAct(apis.ga_works, nt4.id, 'confirm_source');
  lr = await legacyAct(apis.ga_works, lt4.id, 'CANCEL', { cancelReason: '不要了' });
  nr = await nativeAct(apis.ga_works, nt4.id, 'cancel', { note: '不要了', return_stock: true });
  statusDiff(diffs, 'cancel-status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const lc = await dbT(lt4.id), nc = await dbT(nt4.id);
  if (lc.status !== nc.status) diffs.push({ kind: 'changed', key: 'cancel:transfer#status', legacy: lc.status, native: nc.status });
  if (lc.cancel_reason !== nc.cancel_reason) diffs.push({ kind: 'changed', key: 'cancel:transfer#cancel_reason', legacy: lc.cancel_reason, native: nc.cancel_reason });
  const lb = await dbBal(l4.src.id, l4.part.id), nb = await dbBal(n4.src.id, n4.part.id);
  if (lb !== nb) diffs.push({ kind: 'changed', key: 'cancel-return-stock-balance', legacy: lb, native: nb });
  expect(nb).toBe(30);
  expect(lb).toBe(25);
  // 重送同一個動作：舊版每次點擊都是新的隨機識別（狀態改了才被擋），新版同識別重送回原結果
  const l5 = await setup('WAL5'), n5 = await setup('WAN5');
  const lt5 = await seedReq(l5, reasonL);
  const nt5 = await seedReq(n5, reasonN);
  const lk = key();
  await apis.ga_works.post(`${L}/transfers/${lt5.id}/actions`, { data: { action: 'CONFIRM_SOURCE', idempotencyKey: lk } });
  const l5b = await apis.ga_works.post(`${L}/transfers/${lt5.id}/actions`, { data: { action: 'CONFIRM_SOURCE', idempotencyKey: lk } });
  const cur = (await dbT(nt5.id)).updated_at;
  const nk = key();
  const n5a = await apis.ga_works.post(`${N}/transfers/${nt5.id}/actions`, { data: { action: 'confirm_source', expected_updated_at: cur, idempotency_key: nk } });
  const n5b = await apis.ga_works.post(`${N}/transfers/${nt5.id}/actions`, { data: { action: 'confirm_source', expected_updated_at: cur, idempotency_key: nk } });
  expect([n5a.status(), n5b.status()]).toEqual([200, 200]);
  statusDiff(diffs, 'resend-same-key-status', l5b.status(), n5b.status());
  expect(await dbBal(n5.src.id, n5.part.id)).toBe(25);
  expect(await dbBal(l5.src.id, l5.part.id)).toBe(25);
  // 沒帶版本與識別：舊版不用版本，新版 400
  const nv = await apis.ga_works.post(`${N}/transfers/${nt5.id}/actions`, { data: { action: 'ship' } });
  const lv = await apis.ga_works.post(`${L}/transfers/${lt5.id}/actions`, { data: { action: 'MARK_IN_TRANSIT', idempotencyKey: key() } });
  statusDiff(diffs, 'action-without-version-status', lv.status(), nv.status());
  expect(nv.status()).toBe(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '調撥動作', legacy: { endpoint: `POST ${L}/transfers/:id/actions` }, native: { endpoint: `POST ${N}/transfers/:id/actions`, status: 200 }, compared: { rows: 12 }, diffs }));
});
