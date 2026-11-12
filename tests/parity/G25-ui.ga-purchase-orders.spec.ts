import crypto from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedVendor } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G25 對等層（舊版只有「採購評估」與「收貨」，沒有採購單頁面）：舊版 /api/general-affairs/requests/:id/purchase-review、purchase-receipt 與新版
// 同一個評估 API（進入採購時產生草稿採購單）＋採購單「登錄到貨」、供應商選項，同一個登入者（總務採購）、同一份輸入逐項比對，寫入以 service role 回讀資料庫。
// 差異都列在 tests/parity/allowlist.json（page: ga-purchase-orders）。
const map = loadMap('ga-purchase-orders');
const rec = new ParityRecorder('ga-purchase-orders');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs';
const N = '/api/workspace/general-affairs';
let ga: APIRequestContext;
let gaId = '';
let sid: Record<string, string> = {};
let part: any;
let loc: any;
let vendor: any;
let vendorOff: any;

test.describe.configure({ mode: 'default' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  ga = await apiAs('ga_po_purchaser');
  gaId = ((await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-po-purchaser@example.test').single()).data as any).id;
  const st = await stores();
  sid = { VW001: st.VW001.id };
  const cat = await seedCategory('part', 'PPO');
  part = await seedPart(cat.id, 'PPO-P1', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  loc = await seedLocation(null, 'PPO-L');
  await seedLocationPart(loc.id, part.id);
  vendor = await seedVendor('PPO-A', { phone: '02-1234', contact_name: '測試聯絡人' });
  vendorOff = await seedVendor('PPO-OFF', { status: 'inactive' });
});
test.afterAll(async () => {
  await ga.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const body = async (r: any) => r.json().catch(() => ({}));
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const TIME = /(_at|_since)$/;
const same = (a: unknown, b: unknown, key = '') => {
  if (TIME.test(key) && a && b) return Date.parse(String(a)) === Date.parse(String(b));
  if (a !== null && b !== null && a !== undefined && b !== undefined && typeof a !== 'object' && typeof b !== 'object' && String(a).trim() !== '' && String(b).trim() !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) === Number(b);
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
};
function diffRow(diffs: Diff[], label: string, legacy: any, native: any) {
  for (const k of Object.keys(legacy)) {
    if (!(k in native)) diffs.push({ kind: 'only-legacy', key: `${label}#${k}` });
    else if (!same(legacy[k], native[k], k)) diffs.push({ kind: 'changed', key: `${label}#${k}`, legacy: legacy[k], native: native[k] });
  }
  for (const k of Object.keys(native)) if (!(k in legacy)) diffs.push({ kind: 'only-native', key: `${label}#${k}` });
}
const cmpCols = (diffs: Diff[], label: string, l: any, n: any, cols: string[]) => {
  for (const c of cols) if (!same(l?.[c], n?.[c], c)) diffs.push({ kind: 'changed', key: `${label}#${c}`, legacy: l?.[c], native: n?.[c] });
};
const statusDiff = (diffs: Diff[], key: string, l: number, n: number) => l !== n && diffs.push({ kind: 'status', key, legacy: l, native: n });
const key = () => crypto.randomUUID();
const mk = (suffix: string, over: Record<string, unknown> = {}) =>
  seedRequest(sid.VW001, gaId, suffix, { part_id: part.id, desired_unit: part.base_unit, desired_quantity: 4, main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW', ...over });
const dbReq = async (id: string) => (await adminDb().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const dbReview = async (id: string) => (await adminDb().from('ga_purchase_reviews').select('*').eq('request_id', id).is('deleted_at', null).single()).data as any;
const dbFul = async (id: string) => (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', id).single()).data as any;
const dbEv = async (id: string, type: string) => ((await adminDb().from('ga_service_request_events').select('*').eq('request_id', id).eq('event_type', type).order('created_at')).data || []) as any[];
const dbBal = async () => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
const reviewPayload = (over: Record<string, unknown> = {}) => ({
  decision: 'PURCHASE', vendorId: vendor.id, approvedQuantity: 4, approvedUnit: part.base_unit, estimatedAmount: 1800, quotedAmount: 2000, negotiatedAmount: 1900, finalAmount: 2000,
  deliveryMethod: '廠商送貨', receivingLocationId: loc.id, decisionNote: '評估同意採購', publicNote: '已進入採購', ...over,
});
const REVIEW_COLS = ['decision', 'vendor_id', 'vendor_name', 'approved_quantity', 'approved_unit', 'estimated_amount', 'quoted_amount', 'negotiated_amount', 'final_amount', 'expected_delivery_date', 'delivery_method', 'receiving_location_id', 'substitute_description', 'decision_note', 'public_note'];

test('供應商選項：同一份合作中廠商，id、名稱、別名比對；新版分頁並多回統編、付款條件與類型，舊版多回電話與聯絡人；停用廠商兩邊都不列', async () => {
  const e = entry('vendor-options-read');
  const diffs: Diff[] = [];
  const r = await mk('VO');
  const lr = await ga.get(`${L}/requests/${r.id}/purchase-review`);
  const nr = await ga.get(`${N}/purchase-orders/vendor-options?search=${encodeURIComponent(vendor.name)}&pageSize=100`);
  statusDiff(diffs, 'status', lr.status(), nr.status());
  expect(nr.status()).toBe(200);
  const legacy = ((await body(lr)).data.vendors as any[]).filter((v) => String(v.name).includes('[自動測試]M7M8'));
  const native = (await body(nr)).data as any[];
  expect(native.map((v) => v.id)).toEqual([vendor.id]);
  expect(legacy.map((v) => v.id)).toEqual([vendor.id]);
  expect(legacy.map((v) => v.id)).not.toContain(vendorOff.id);
  diffRow(diffs, vendor.id, { ...legacy[0], status: undefined }, native[0]);
  // status 在新版不回（只回合作中）：舊版回 status = active，另記一筆
  if (legacy[0].status !== 'active') diffs.push({ kind: 'changed', key: `${vendor.id}#status`, legacy: legacy[0].status, native: 'active' });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '供應商選項', legacy: { endpoint: `GET ${L}/requests/:id/purchase-review` }, native: { endpoint: `GET ${N}/purchase-orders/vendor-options`, status: 200 }, compared: { rows: 1 }, diffs: diffs.filter((d) => !(d.key.endsWith('#status') && d.kind === 'only-native')) }));
});

test('採購評估進入採購：同一份輸入儲存後，評估列、需求單狀態與對外進度、事件、處理單相同；新版同交易產生草稿採購單並連回需求單、處理單為「採購中」', async () => {
  const e = entry('purchase-review-write-readback');
  const diffs: Diff[] = [];
  const l = await mk('PR-L'), n = await mk('PR-N');
  const lr = await ga.post(`${L}/requests/${l.id}/purchase-review`, { data: reviewPayload() });
  const nr = await ga.post(`${N}/requests/${n.id}/purchase-review`, { data: { ...reviewPayload(), expected_updated_at: n.updated_at } });
  statusDiff(diffs, 'save-status', lr.status(), nr.status());
  expect(lr.status(), JSON.stringify(await body(lr))).toBe(201);
  expect(nr.status(), JSON.stringify(await body(nr))).toBe(201);
  cmpCols(diffs, 'review', await dbReview(l.id), await dbReview(n.id), REVIEW_COLS);
  const lq = await dbReq(l.id), nq = await dbReq(n.id);
  cmpCols(diffs, 'request', lq, nq, ['main_status', 'intake_route', 'public_progress']);
  const lf = await dbFul(l.id), nf = await dbFul(n.id);
  cmpCols(diffs, 'fulfillment', lf, nf, ['status', 'requested_quantity', 'unit', 'current_step']);
  const le = (await dbEv(l.id, 'PURCHASE_REVIEW_DECIDED'))[0], ne = (await dbEv(n.id, 'PURCHASE_REVIEW_DECIDED'))[0];
  expect(ne).toBeTruthy();
  cmpCols(diffs, 'event', le, ne, ['event_type', 'visibility', 'title', 'description', 'old_status', 'new_status']);
  // 新版：產生草稿採購單並連回需求單（舊版沒有採購單）
  const po = (await adminDb().from('ga_purchase_orders').select('*').eq('source_request_id', n.id)).data as any[];
  expect(po).toHaveLength(1);
  expect(po[0]).toMatchObject({ status: 'DRAFT', vendor_id: vendor.id, receiving_location_id: loc.id, purchase_review_id: (await dbReview(n.id)).id });
  const lpo = (await adminDb().from('ga_purchase_orders').select('id').eq('source_request_id', l.id)).data as any[];
  if (lpo.length !== po.length) diffs.push({ kind: 'changed', key: 'purchase-order-count#linked', legacy: lpo.length, native: po.length });
  // 舊版評估採購編號（ga_next_purchase_order_no）：新版採購單用 PO-日期-流水，評估列也保留編號
  const lno = (await dbReview(l.id)).purchase_no, nno = (await dbReview(n.id)).purchase_no;
  if (!same(!!lno, !!nno)) diffs.push({ kind: 'changed', key: 'review#purchase_no-present', legacy: !!lno, native: !!nno });
  // 缺評估說明：兩邊都擋（400）
  const l2 = await mk('PR-L2'), n2 = await mk('PR-N2');
  const lr2 = await ga.post(`${L}/requests/${l2.id}/purchase-review`, { data: reviewPayload({ decisionNote: '' }) });
  const nr2 = await ga.post(`${N}/requests/${n2.id}/purchase-review`, { data: { ...reviewPayload({ decisionNote: '' }), expected_updated_at: n2.updated_at } });
  statusDiff(diffs, 'missing-note-status', lr2.status(), nr2.status());
  // 新版必須帶版本；舊版沒有版本檢查
  const l3 = await mk('PR-L3'), n3 = await mk('PR-N3');
  const lr3 = await ga.post(`${L}/requests/${l3.id}/purchase-review`, { data: reviewPayload() });
  const nr3 = await ga.post(`${N}/requests/${n3.id}/purchase-review`, { data: reviewPayload() });
  statusDiff(diffs, 'missing-version-status', lr3.status(), nr3.status());
  expect(nr3.status()).toBe(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '採購評估進入採購', legacy: { endpoint: `POST ${L}/requests/:id/purchase-review` }, native: { endpoint: `POST ${N}/requests/:id/purchase-review`, status: 201 }, compared: { rows: 4 }, diffs }));
});

test('採購到貨入庫：同樣數量入庫後庫存餘額、流水、處理單已處理量相同；新版先下訂再登錄到貨（即驗入），舊版直接收貨；評估已有採購單時舊版收貨被擋', async () => {
  const e = entry('purchase-receipt-write-readback');
  const diffs: Diff[] = [];
  const l = await mk('RC-L'), n = await mk('RC-N');
  expect((await ga.post(`${L}/requests/${l.id}/purchase-review`, { data: reviewPayload() })).status()).toBe(201);
  const nrev = await ga.post(`${N}/requests/${n.id}/purchase-review`, { data: { ...reviewPayload(), expected_updated_at: n.updated_at } });
  expect(nrev.status(), JSON.stringify(await body(nrev))).toBe(201);
  const po = ((await adminDb().from('ga_purchase_orders').select('*').eq('source_request_id', n.id)).data as any[])[0];
  const placed = await ga.post(`${N}/purchase-orders/${po.id}/actions`, { data: { action: 'place_order', expected_updated_at: po.updated_at } });
  expect(placed.status(), JSON.stringify(await body(placed))).toBe(200);
  const base = await dbBal();
  // 舊版：評估沒有採購單 → 直接收貨 3
  const lr = await ga.post(`${L}/requests/${l.id}/purchase-receipt`, { data: { locationId: loc.id, partId: part.id, quantity: 3, inputUnitType: 'BASE', idempotencyKey: key() } });
  expect(lr.status(), JSON.stringify(await body(lr))).toBe(201);
  const afterLegacy = await dbBal();
  // 新版：採購單登錄到貨 3（短收：剩餘 4，原因必填）
  const item = (await body(placed)).data.items[0];
  const nr = await ga.post(`${N}/purchase-orders/${po.id}/receipts`, { data: { header: {}, lines: [{ po_item_id: item.id, delivered_qty: 3, reason: '分批到貨' }], idempotency_key: key() } });
  statusDiff(diffs, 'receipt-status', lr.status(), nr.status());
  expect(nr.status(), JSON.stringify(await body(nr))).toBe(201);
  const afterNative = await dbBal();
  if (afterLegacy - base !== afterNative - afterLegacy) diffs.push({ kind: 'changed', key: 'balance#delta', legacy: afterLegacy - base, native: afterNative - afterLegacy });
  const tx = async (extra: Record<string, unknown>) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('part_id', part.id).eq('location_id', loc.id).match(extra).order('created_at')).data || []) as any[];
  const ltx = (await tx({ reference_type: 'GA_PURCHASE_REVIEW' }))[0], ntx = (await tx({ reference_type: 'GA_PURCHASE_ORDER' }))[0];
  expect(ltx && ntx).toBeTruthy();
  cmpCols(diffs, 'transaction', ltx, ntx, ['transaction_type', 'quantity_base', 'reference_type']);
  const lf = await dbFul(l.id), nf = await dbFul(n.id);
  cmpCols(diffs, 'fulfillment', lf, nf, ['fulfilled_quantity', 'requested_quantity', 'unit', 'status', 'current_step']);
  cmpCols(diffs, 'request', await dbReq(l.id), await dbReq(n.id), ['main_status', 'public_progress']);
  // 評估已有採購單：舊版收貨被資料庫擋下（避免雙記庫存）
  const blocked = await ga.post(`${L}/requests/${n.id}/purchase-receipt`, { data: { locationId: loc.id, partId: part.id, quantity: 1, inputUnitType: 'BASE', idempotencyKey: key() } });
  if (blocked.status() < 400) diffs.push({ kind: 'changed', key: 'legacy-receipt-after-po#status', legacy: blocked.status(), native: 'blocked' });
  expect(blocked.status()).toBeGreaterThanOrEqual(400);
  expect(await dbBal()).toBe(afterNative);
  // 超收：舊版以處理單剩餘需求量擋，新版以採購單剩餘可收量擋
  const lOver = await ga.post(`${L}/requests/${l.id}/purchase-receipt`, { data: { locationId: loc.id, partId: part.id, quantity: 5, inputUnitType: 'BASE', idempotencyKey: key() } });
  const nOver = await ga.post(`${N}/purchase-orders/${po.id}/receipts`, { data: { header: {}, lines: [{ po_item_id: item.id, delivered_qty: 5 }], idempotency_key: key() } });
  statusDiff(diffs, 'over-receive-status', lOver.status(), nOver.status());
  expect(nOver.status()).toBeGreaterThanOrEqual(400);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'write-readback', title: '採購到貨入庫', legacy: { endpoint: `POST ${L}/requests/:id/purchase-receipt` }, native: { endpoint: `POST ${N}/purchase-orders/:id/receipts`, status: 201 }, compared: { rows: 3 }, diffs }));
});
