import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { anonClient, taipeiToday } from '../support/m7m8-po-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-void（作廢進貨，API＋資料庫回讀）：POST /purchase-orders/:id/receipts/:rid/void。
// 驗：未登入 401、Origin 不符 403、權限矩陣（採購評估管理＋庫存交易管理＋料件查看；管理員身分無角色被擋）、400 驗證不寫入、404、
//   未請款可作廢並沖回庫存（反向庫存交易）、採購單狀態重算、同識別重送冪等、STALE 409、已作廢 409；
//   擋下：已請款（白話指出請款單號，作廢請款單後可作廢）、連有效發票、已配發成設備、已結案、庫存不足（含位置允許負庫存）、直接建立設備；
//   作廢後不計累計驗入、請款候選、可配發量，且不能再被請款單引用。
// 測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記、VW／ZT 門市、只用 DEV；結束只清自己的。
const P = '/api/workspace/general-affairs';
const PO_API = `${P}/purchase-orders`;
const PR = `${P}/payment-requests`;
const INV = `${P}/purchase-invoices`;
const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'purchaser', 'nobody', 'admin'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const today = () => { const d = taipeiToday(); return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; };
const itemId = (p: any, line: number) => p.items.find((i: any) => i.line_no === line).id as string;

let vendor: any;
let loc: any;
let partP: any; // 一般庫存料件
let partD: any; // 對應設備型號（配發用）
let eqCatId = '';
let sid: Record<string, string> = {};

const stockItem = (part: any, qty: number, price = 100) => [{ part_id: part.id, quantity: qty, unit_price: price }];
const hdr = () => ({ notes: m7Name(`VOID${(seq += 1)}`), vendor_id: vendor.id, receiving_location_id: loc.id });
/** 已下訂的採購單。 */
async function ordered(items: unknown[]) {
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: hdr(), p_items: items, p_create_key: key() });
  return rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
}
const receive = (po: any, qty: number, line = 1) => rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, line), delivered_qty: qty }], p_key: key() });
const voidUrl = (poId: string, rid: string) => `${PO_API}/${poId}/receipts/${rid}/void`;
const voidBody = (rc: any, over: Record<string, unknown> = {}) => ({ reason: '進貨登錯了', idempotency_key: key(), expected_updated_at: rc.updated_at, ...over });
const balance = async (locationId: string, partId: string) => Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', locationId).eq('part_id', partId).maybeSingle()).data?.quantity_base ?? 0);
const txOf = async (partId: string) => ((await db().from('ga_inventory_transactions').select('*').eq('part_id', partId).order('created_at')).data || []) as any[];
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbItem = async (id: string) => (await db().from('ga_purchase_order_items').select('*').eq('id', id).single()).data as any;
const dbReceipt = async (id: string) => (await db().from('ga_purchase_receipts').select('*').eq('id', id).single()).data as any;
const dbEvents = async (poId: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', poId).order('created_at').order('id')).data || []) as any[];
const mkPr = async (who: string, receiptId: string) => {
  const r = await send(who, 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: receiptId }], idempotency_key: key() });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as any;
};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  vendor = await seedGa45Vendor(`VOID${(seq += 1)}`);
  const cat = await seedCategory('part', 'VOID');
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201，無法測試配發');
  eqCatId = eqCat.data.id;
  const tpl = await seedEquipmentTemplate(eqCatId, 'VOID-T1', { default_warranty_months: 12 });
  partP = await seedPart(cat.id, 'VOID-P');
  partD = await seedPart(cat.id, 'VOID-D', { equipment_template_id: tpl.id });
  loc = await seedLocation(null, 'VOID-W');
  await seedLocationPart(loc.id, partP.id);
  await seedLocationPart(loc.id, partD.id);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

test('未登入 401、Origin 不符 403、權限矩陣（採購評估管理＋庫存交易管理＋料件查看）、400 與 404 都不寫入', async () => {
  const po = await ordered(stockItem(partP, 5));
  const rc = await receive(po, 5);
  const url = voidUrl(po.id, rc.id);
  const noAuth = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await noAuth.post(url, { data: voidBody(rc), headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  } finally {
    await noAuth.dispose();
  }
  expect((await apis.clerk.post(url, { data: voidBody(rc), headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  // 權限矩陣：缺任何一個都擋；管理員身分沒有角色也擋（資料庫語意）
  for (const who of ['viewer', 'accountant', 'nobody', 'admin']) {
    const r = await send(who, 'post', url, voidBody(rc));
    expect(r.status, `${who} ${JSON.stringify(r.body)}`).toBe(403);
  }
  // 400：缺原因、空白原因、過長、缺識別、缺版本、版本格式、多餘欄位、壞 id
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ reason: '' }, '原因'], [{ reason: '   ' }, '原因'], [{ reason: 'x'.repeat(201) }, '200'], [{ idempotency_key: '' }, '識別'], [{ expected_updated_at: '' }, '版本'],
    [{ expected_updated_at: 'abc' }, '格式'], [{ voided_by: users.clerk.id }, '不支援'],
  ];
  for (const [over, part] of bad) {
    const r = await send('clerk', 'post', url, voidBody(rc, over));
    expect(r.status, JSON.stringify(over)).toBe(400);
    expect(String(r.body.error), JSON.stringify(over)).toContain(part);
    expect(String(r.body.error)).not.toMatch(/SQLSTATE|violates|constraint/);
  }
  expect((await send('clerk', 'post', voidUrl(po.id, 'not-a-uuid'), voidBody(rc))).status).toBe(400);
  expect((await send('clerk', 'post', voidUrl('not-a-uuid', rc.id), voidBody(rc))).status).toBe(400);
  // 404：不存在的進貨單、屬於別張採購單的進貨單（不能用 A 單網址作廢 B 單的進貨）
  expect((await send('clerk', 'post', voidUrl(po.id, crypto.randomUUID()), voidBody(rc))).status).toBe(404);
  const other = await ordered(stockItem(partP, 2));
  expect((await send('clerk', 'post', voidUrl(other.id, rc.id), voidBody(rc))).status).toBe(404);
  // 全部沒有寫入
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(5);
  expect(await balance(loc.id, partP.id)).toBe(5);
  expect((await dbEvents(po.id)).filter((e) => e.event_type === 'receipt_void')).toHaveLength(0);
  // 清掉這兩張單造成的庫存，讓後面的庫存斷言乾淨（先沖回）
  const ok = await send('clerk', 'post', url, voidBody(rc));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await balance(loc.id, partP.id)).toBe(0);
});

test('未請款可作廢：沖回庫存、扣回驗入量、重算採購單狀態、留原因與事件；回讀資料庫；同識別重送冪等；已作廢與舊版本 409', async () => {
  const po = await ordered(stockItem(partP, 10));
  const a = await receive(po, 4);
  const b = await receive(po, 6);
  expect((await dbPo(po.id)).status).toBe('RECEIVED');
  expect(await balance(loc.id, partP.id)).toBe(10);
  const k = key();
  const r = await send('clerk', 'post', voidUrl(po.id, a.id), { reason: '品項登錯', idempotency_key: k, expected_updated_at: a.updated_at });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.replay).toBe(false);
  expect(r.body.data).toMatchObject({ id: a.id });
  expect(r.body.data.voided_at).toBeTruthy();
  expect(r.body.order.status).toBe('PARTIALLY_RECEIVED');
  expect(Number(r.body.receiving.items[0].received_qty)).toBe(6);
  expect(Number(r.body.receiving.items[0].remaining_qty)).toBe(4);
  expect(Number(r.body.receiving.items[0].received_base)).toBe(6); // 不含已作廢進貨
  // 資料庫回讀
  const row = await dbReceipt(a.id);
  expect(row).toMatchObject({ voided_by: users.clerk.id, void_reason: '品項登錯', void_key: k });
  expect(row.voided_at).toBeTruthy();
  const it = await dbItem(itemId(po, 1));
  expect(Number(it.received_qty)).toBe(6);
  expect((await dbPo(po.id)).status).toBe('PARTIALLY_RECEIVED');
  expect(await balance(loc.id, partP.id)).toBe(6);
  const tx = (await txOf(partP.id)).filter((t) => String(t.reason || '').includes('作廢進貨沖回') && String(t.reason).includes(a.receipt_no));
  expect(tx).toHaveLength(1);
  expect(tx[0]).toMatchObject({ transaction_type: 'ISSUE', location_id: loc.id });
  expect(Number(tx[0].quantity_base)).toBe(-4); // 反向庫存交易（出庫）
  expect(tx[0].metadata).toMatchObject({ void: true, receipt_no: a.receipt_no });
  expect(String(tx[0].reason)).toContain(a.receipt_no);
  const ev = (await dbEvents(po.id)).filter((e) => e.event_type === 'receipt_void');
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ actor_id: users.clerk.id, note: '品項登錯', from_status: 'RECEIVED', to_status: 'PARTIALLY_RECEIVED' });
  expect(ev[0].payload.receipt_no).toBe(a.receipt_no);
  // 同識別重送：回原結果、不再沖一次
  const again = await send('clerk', 'post', voidUrl(po.id, a.id), { reason: '品項登錯', idempotency_key: k, expected_updated_at: a.updated_at });
  expect(again.status).toBe(200);
  expect(again.body.replay).toBe(true);
  // 審查修正：同識別但換了原因，不是重送，回 409（與作廢發票一致），也不會改掉原本的作廢原因
  const changed = await send('clerk', 'post', voidUrl(po.id, a.id), { reason: '品項登錄錯', idempotency_key: k, expected_updated_at: a.updated_at });
  expect(changed.status, JSON.stringify(changed.body)).toBe(409);
  expect(changed.body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await dbReceipt(a.id)).void_reason).toBe('品項登錯');
  expect(await balance(loc.id, partP.id)).toBe(6);
  expect((await dbEvents(po.id)).filter((e) => e.event_type === 'receipt_void')).toHaveLength(1);
  // 已作廢：換識別再作廢 → 409
  const twice = await send('clerk', 'post', voidUrl(po.id, a.id), voidBody(row));
  expect(twice.status).toBe(409);
  expect(twice.body.code).toBe('ALREADY_VOIDED');
  // 舊版本：用過期的 expected_updated_at → 409 STALE，什麼都沒動
  const stale = await send('clerk', 'post', voidUrl(po.id, b.id), voidBody(b, { expected_updated_at: '2020-01-01T00:00:00.000Z' }));
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await dbReceipt(b.id)).voided_at).toBeNull();
  expect(await balance(loc.id, partP.id)).toBe(6);
  // 採購單狀態重算：兩張都作廢回到「已下訂」，之後可重新登錄到貨且不會誤判超收
  const r2 = await send('clerk', 'post', voidUrl(po.id, b.id), voidBody(b, { reason: '全部重登' }));
  expect(r2.status, JSON.stringify(r2.body)).toBe(200);
  expect(r2.body.order.status).toBe('ORDERED');
  expect((await dbPo(po.id)).status).toBe('ORDERED');
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(0);
  expect(await balance(loc.id, partP.id)).toBe(0);
  const re = await receive(po, 10);
  expect((await dbPo(po.id)).status).toBe('RECEIVED');
  expect(await balance(loc.id, partP.id)).toBe(10);
  // 清乾淨：把這張也作廢，後面的庫存斷言才乾淨
  expect((await send('clerk', 'post', voidUrl(po.id, re.id), voidBody(re))).status).toBe(200);
  expect(await balance(loc.id, partP.id)).toBe(0);
});

test('已被請款單引用：擋下並指出請款單號；作廢請款單釋放後可作廢；作廢後不能再請款、不在請款候選、不計累計驗入', async () => {
  const po = await ordered(stockItem(partP, 5));
  const rc = await receive(po, 5);
  const pr = await mkPr('clerk', rc.id);
  const blocked = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('RECEIPT_CLAIMED');
  expect(blocked.body.error).toContain(pr.pr_no);
  expect(blocked.body.error).toContain('請先作廢或退回該請款單');
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect(await balance(loc.id, partP.id)).toBe(5);
  // 草稿與已送出也算引用
  const sub = await send('clerk', 'post', `${PR}/${pr.id}/actions`, { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: key() });
  expect(sub.status).toBe(200);
  expect((await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc))).body.code).toBe('RECEIPT_CLAIMED');
  // 作廢請款單 → 可以作廢進貨
  const vp = await send('clerk', 'post', `${PR}/${pr.id}/actions`, { action: 'void', reason: '退回重請', expected_updated_at: sub.body.data.updated_at, idempotency_key: key() });
  expect(vp.status, JSON.stringify(vp.body)).toBe(200);
  const ok = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc, { reason: '重登進貨' }));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await balance(loc.id, partP.id)).toBe(0);
  // 作廢後：不在請款候選、不能再被請款單引用、累計驗入為 0
  const cand = await get('clerk', `${PR}/candidates?vendorId=${vendor.id}&pageSize=100`);
  expect((cand.body.data as any[]).map((x) => x.receipt_id)).not.toContain(rc.id);
  const again = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], idempotency_key: key() });
  expect(again.status).toBe(409);
  expect(again.body.code).toBe('RECEIPT_VOIDED');
  expect((await dbReceipt(rc.id)).voided_at).toBeTruthy();
});

test('內部輔助函式只開給 service_role；作廢後累計驗入（含稅）不含已作廢進貨', async () => {
  const po = await ordered(stockItem(partP, 10));
  const a = await receive(po, 4);
  await receive(po, 6);
  const svc = adminDb();
  const before = await svc.rpc('ga_pay_po_received', { p_po: po.id });
  expect(before.error, JSON.stringify(before.error)).toBeNull();
  expect(before.data).toMatchObject({ untaxed: 1000, total: 1050 });
  expect((await send('clerk', 'post', voidUrl(po.id, a.id), voidBody(a))).status).toBe(200);
  const after = await svc.rpc('ga_pay_po_received', { p_po: po.id });
  expect(after.data).toMatchObject({ untaxed: 600, total: 630 });
  // 登入者直接呼叫內部輔助函式被擋
  const asClerk: any = await users.clerk.client.rpc('ga_pay_po_received', { p_po: po.id });
  expect(asClerk.error, '登入者不能直接呼叫內部輔助函式').toBeTruthy();
  // 收尾：作廢剩下的
  const rest = (await db().from('ga_purchase_receipts').select('*').eq('po_id', po.id).is('voided_at', null)).data as any[];
  for (const r of rest) expect((await send('clerk', 'post', voidUrl(po.id, r.id), voidBody(r))).status).toBe(200);
});

test('連結有效發票的進貨不能作廢；作廢發票後可作廢', async () => {
  const po = await ordered(stockItem(partP, 10));
  const rc = await receive(po, 10);
  const inv = await send('clerk', 'post', INV, { invoice_type: 'TRIPLE', invoice_no: `QA${String(Date.now()).slice(-8)}`, invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: [{ receipt_id: rc.id }], idempotency_key: key() });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  // 連結發票會更新進貨單的憑證狀態與版本，所以先讀最新版本
  const linked = await dbReceipt(rc.id);
  expect(linked.voucher_status).toBe('LINKED');
  const blocked = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(linked));
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('RECEIPT_HAS_INVOICE');
  expect(blocked.body.error).toContain(inv.body.data.invoice_no);
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  const vi = await send('clerk', 'post', `${INV}/${inv.body.data.id}/actions`, { action: 'void', reason: '發票作廢', expected_updated_at: inv.body.data.updated_at, idempotency_key: key() });
  expect(vi.status, JSON.stringify(vi.body)).toBe(200);
  const ok = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(await dbReceipt(rc.id)));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await balance(loc.id, partP.id)).toBe(0);
});

test('已配發成設備不能作廢（請走報廢）；作廢過的進貨的庫存不能再被配發', async () => {
  const po = await ordered(stockItem(partD, 4, 500));
  const a = await receive(po, 3);
  const b = await receive(po, 1);
  // 配發 1 台：先進先出，扣在 a（較早的進貨）
  const d = await rpcOk('clerk', 'ga_ws_po_dispatch', { p_po_item_id: itemId(po, 1), p_store_id: sid.VW001, p_quantity: 1, p_template_id: null, p_template_reason: null, p_source_location_id: null, p_serials: null, p_notes: null, p_key: key() });
  expect(d.equipment).toHaveLength(1);
  const blocked = await send('clerk', 'post', voidUrl(po.id, a.id), voidBody(a));
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('RECEIPT_DISPATCHED');
  expect(blocked.body.error).toContain('報廢');
  expect((await dbReceipt(a.id)).voided_at).toBeNull();
  expect(await balance(loc.id, partD.id)).toBe(3);
  // 沒配發過的 b 可以作廢；作廢後 b 的庫存不在可配發量裡
  const ok = await send('clerk', 'post', voidUrl(po.id, b.id), voidBody(b));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  const view = await get('clerk', `${PO_API}/${po.id}/receipts`);
  const row = (view.body.data.items as any[])[0];
  expect(Number(row.dispatchable_base)).toBe(2); // a 共 3 台、已配發 1，b 已作廢不計
  const over = await callFn(users.clerk.client, 'ga_ws_po_dispatch', { p_po_item_id: itemId(po, 1), p_store_id: sid.VW001, p_quantity: 3, p_template_id: null, p_template_reason: null, p_source_location_id: null, p_serials: null, p_notes: null, p_key: key() });
  expect(over.ok).toBe(false);
  expect(over.status).toBe(409);
  expect(over.code).toBe('OVER_DISPATCH');
});

test('已結案的採購單不能作廢進貨', async () => {
  const po = await ordered(stockItem(partP, 3));
  const rc = await receive(po, 3);
  const fresh = await rpcOk('clerk', 'ga_ws_po_get', { p_id: po.id });
  await rpcOk('clerk', 'ga_ws_po_action', { p_id: po.id, p_action: 'close', p_expected_updated_at: fresh.updated_at, p_note: null });
  expect((await dbPo(po.id)).status).toBe('CLOSED');
  const r = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('INVALID_STATE');
  expect(r.body.error).toContain('已結案');
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect(await balance(loc.id, partP.id)).toBe(3);
  // 收尾：測試資料靠 cleanup 清除，庫存手動歸零不影響後面（後面的測試用另外的庫存斷言差額）
});

test('庫存不足擋下（即使位置允許負庫存）：整筆沒有變動；補足庫存後可作廢', async () => {
  // 用獨立料件：庫存餘額是（位置、料件）合計，避免別的測試留下的庫存讓「用掉一部分」失效
  const cat = await db().from('ga_part_categories').select('id').eq('id', partP.category_id).single();
  const partX = await seedPart(cat.data!.id, 'VOID-X');
  await seedLocationPart(loc.id, partX.id);
  const base = 0;
  const po = await ordered(stockItem(partX, 5));
  const rc = await receive(po, 5);
  // 庫存被其他單據用掉 3
  const issue = await rpcOk('clerk', 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: loc.id, p_part_id: partX.id, p_quantity: 3, p_input_unit_type: 'BASE', p_reason: '領用', p_notes: null, p_idempotency_key: key() });
  expect(issue.transaction_id).toBeTruthy();
  expect(await balance(loc.id, partX.id)).toBe(base + 2);
  const r = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('STOCK_INSUFFICIENT');
  expect(r.body.error).toContain('負庫存');
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(5);
  expect((await dbPo(po.id)).status).toBe('RECEIVED');
  expect(await balance(loc.id, partX.id)).toBe(base + 2);
  // 位置允許負庫存也一樣擋（作廢進貨不可以造成負庫存）
  await db().from('ga_inventory_locations').update({ allow_negative_stock: true }).eq('id', loc.id);
  const r2 = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(r2.status).toBe(409);
  expect(r2.body.code).toBe('STOCK_INSUFFICIENT');
  expect(await balance(loc.id, partX.id)).toBe(base + 2);
  await db().from('ga_inventory_locations').update({ allow_negative_stock: false }).eq('id', loc.id);
  // 補回 3 之後可以作廢
  await rpcOk('clerk', 'ga_ws_inv_post', { p_transaction_type: 'RECEIPT', p_location_id: loc.id, p_part_id: partX.id, p_quantity: 3, p_input_unit_type: 'BASE', p_reason: '補回', p_notes: null, p_idempotency_key: key() });
  const ok = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await balance(loc.id, partX.id)).toBe(0) // 5 入、3 領用、3 補回、5 沖回;
});

test('驗入時直接建立設備的品項不能作廢（請走報廢）', async () => {
  const tpl = await seedEquipmentTemplate(eqCatId, 'VOID-T2', { default_warranty_months: 12 });
  const po = await ordered([{ item_name: m7Name('直送印表機'), quantity: 2, unit_price: 800, unit: '台', fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl.id }]);
  const rc = await receive(po, 2);
  const r = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('RECEIPT_ASSET_CREATED');
  expect(r.body.error).toContain('報廢');
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(2);
});

test('只登錄不入庫存的品項也能作廢（沒有庫存交易，只扣回驗入量）；多品項一張進貨整張作廢', async () => {
  const po = await ordered([
    { item_name: m7Name('只登錄品項'), quantity: 3, unit_price: 50, unit: '個', fulfil_mode: 'NO_STOCK' },
    ...stockItem(partP, 2, 100),
  ]);
  const base = await balance(loc.id, partP.id);
  const rc = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: 3 }, { po_item_id: itemId(po, 2), delivered_qty: 2 }], p_key: key() });
  expect(await balance(loc.id, partP.id)).toBe(base + 2);
  const ok = await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc));
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(0);
  expect(Number((await dbItem(itemId(po, 2))).received_qty)).toBe(0);
  expect(await balance(loc.id, partP.id)).toBe(base);
  expect((await dbPo(po.id)).status).toBe('ORDERED');
});

test('資料庫函式直接呼叫：未登入 401、缺權限 403（白話、不外露資料庫原文）；呼叫者不能偽造他人身分', async () => {
  const po = await ordered(stockItem(partP, 1));
  const rc = await receive(po, 1);
  const args = { p_po_id: po.id, p_receipt_id: rc.id, p_reason: '測試', p_key: key(), p_expected_updated_at: rc.updated_at };
  const anon: any = await anonClient().rpc('ga_ws_po_receipt_void', args);
  expect(anon.error, '匿名不能呼叫').toBeTruthy();
  for (const who of ['viewer', 'accountant', 'nobody', 'admin'] as Ga45Key[]) {
    const r: any = await callFn(users[who].client, 'ga_ws_po_receipt_void', args);
    expect(r.ok, who).toBe(false);
    expect(r.status, who).toBe(403);
    expect(String(r.error)).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
  }
  const noReason: any = await callFn(users.clerk.client, 'ga_ws_po_receipt_void', { ...args, p_reason: '  ' });
  expect(noReason).toMatchObject({ ok: false, status: 400, code: 'REASON_REQUIRED' });
  const noKey: any = await callFn(users.clerk.client, 'ga_ws_po_receipt_void', { ...args, p_key: '' });
  expect(noKey).toMatchObject({ ok: false, status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  // 沒有資料表直接寫入權限：登入者不能自己把進貨標成作廢
  const direct: any = await users.clerk.client.from('ga_purchase_receipts').update({ voided_at: new Date().toISOString(), void_reason: '偷改' }).eq('id', rc.id);
  expect(direct.error || (direct.data ?? []).length === 0).toBeTruthy();
  expect((await dbReceipt(rc.id)).voided_at).toBeNull();
  expect((await send('clerk', 'post', voidUrl(po.id, rc.id), voidBody(rc))).status).toBe(200);
});
