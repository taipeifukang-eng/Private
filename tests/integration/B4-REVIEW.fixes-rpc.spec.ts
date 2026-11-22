import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedBalance, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, seedRequest, seedReview, seedVendor, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// 第 4 批審查後補強（2026-11-16）資料庫層整合：
//   1 短收結案釋出需求量、結案的單不再當成評估的重送；3 驗入基本單位量用實際入帳料件的換算率；4 處理單已處理量單位統一；
//   5 直接建設備遇到要求序號的分類提早擋；8 庫存出庫重送不重寫事件；11 直接建設備單次最多 200 台；
//   14 舊版收貨保護涵蓋只填來源需求單的手開採購單；16 非料件需求不建料件處理單；17 草稿改掉連結後處理單據列同步移除。
// 測試資料：名稱與備註一律帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的。
test.describe.configure({ mode: 'serial' });

const KEYS: PoKey[] = ['purchaser', 'rq_staff'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let part: any;
let boxPart: any;
let loc: any;
let vendor: any;
let eqCatId: string;
let seq = 0;
const key = () => crypto.randomUUID();
const db = () => adminDb();
const fn = (who: PoKey, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const header = (over: Record<string, unknown> = {}) => ({ notes: m7Name(`RV${(seq += 1)}`), vendor_id: vendor.id, receiving_location_id: loc.id, ...over });
async function mk(its: unknown, h: Record<string, unknown> = {}) {
  const r = await fn('purchaser', 'ga_ws_po_create', { p_header: header(h), p_items: its, p_create_key: key() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
}
const act = (po: any, action: string, note: string | null = null) => fn('purchaser', 'ga_ws_po_action', { p_id: po.id, p_action: action, p_expected_updated_at: po.updated_at, p_note: note });
async function step(po: any, action: string, note: string | null = null) {
  const r = await act(po, action, note);
  expect(r.ok, `${action}: ${JSON.stringify(r)}`).toBe(true);
  return r.data as any;
}
const recv = (po: any, lines: unknown[]) => fn('purchaser', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: lines, p_key: key() });
const itemId = (po: any, line = 1) => po.items.find((i: any) => i.line_no === line).id as string;
const line = (p: any, qty: number, price: number, extra: Record<string, unknown> = {}) => ({ part_id: p.id, quantity: qty, unit_price: price, ...extra });
const ful = async (requestId: string) => (await db().from('ga_part_fulfillments').select('*').eq('request_id', requestId).is('deleted_at', null).maybeSingle()).data as any;
const docs = async (fulId: string) => ((await db().from('ga_part_fulfillment_documents').select('*').eq('fulfillment_id', fulId).eq('document_type', 'PURCHASE')).data || []) as any[];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  const cat = await seedCategory('part', 'RV');
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機），無法測試資產編號');
  eqCatId = eqCat.data.id;
  part = await seedPart(cat.id, 'RV-P1');
  boxPart = await seedPart(cat.id, 'RV-BOX', { purchase_unit: '箱', purchase_to_base_rate: 12 });
  loc = await seedLocation(null, 'RV-W');
  await seedLocationPart(loc.id, part.id);
  await seedLocationPart(loc.id, boxPart.id);
  vendor = await seedVendor('RV-A');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
});

test('審查 1：短收結案後沒到貨的量釋出，可再開單補足；評估再選「進入採購」產生新草稿而不是回傳已結案的單', async () => {
  const req = await seedRequest(sid.VW001, users.purchaser.id, 'RV1', { part_id: part.id, desired_quantity: 10 });
  const review = await seedReview(req.id, users.purchaser.id, { approved_quantity: 10, final_amount: 1000, vendor_id: vendor.id, receiving_location_id: loc.id });
  const first = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: review.id });
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(first.data.items[0].quantity).toBe(10);
  let po = await step(first.data, 'place_order');
  const r = await recv(po, [{ po_item_id: itemId(po), delivered_qty: 6, reason: '廠商缺貨' }]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  // 短收結案前：占滿 10
  const before = await fn('purchaser', 'ga_ws_po_request_remaining', { p_request_id: req.id });
  expect(before.data).toMatchObject({ committed_base: 10, remaining_base: 0 });
  po = await step(r.po, 'short_close', '廠商停產');
  expect(po.status).toBe('CLOSED');
  const after = await fn('purchaser', 'ga_ws_po_request_remaining', { p_request_id: req.id });
  expect(after.data).toMatchObject({ committed_base: 6, remaining_base: 4 });
  // 評估再選進入採購：不是重送，而是產生新草稿（剩餘 4）
  const again = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: review.id });
  expect(again.ok, JSON.stringify(again)).toBe(true);
  expect(again.replay).toBe(false);
  expect(again.data.id).not.toBe(po.id);
  expect(again.data.items[0].quantity).toBe(4);
  // 補足後又占滿：6 已到貨 + 4 新草稿
  const full = await fn('purchaser', 'ga_ws_po_request_remaining', { p_request_id: req.id });
  expect(full.data).toMatchObject({ committed_base: 10, remaining_base: 0 });
});

test('審查 3、4：驗入基本單位量用實際入帳料件的換算率；處理單已處理量換成需求單單位', async () => {
  const req = await seedRequest(sid.VW001, users.purchaser.id, 'RV3', { part_id: boxPart.id, desired_quantity: 24 });
  const po = await mk([line(boxPart, 2, 1200, { unit: '箱', request_id: req.id })]);
  const o = await step(po, 'place_order');
  // 開單後料件的採購單位換算率被改（新料件還沒有庫存前可改）：驗入量要照現在的換算率入帳，進貨明細的基本單位量要一致
  const upd = await db().from('ga_parts').update({ purchase_to_base_rate: 10 }).eq('id', boxPart.id);
  expect(upd.error?.message ?? '').toBe('');
  const r = await recv(o, [{ po_item_id: itemId(o), delivered_qty: 1, reason: '分批到貨' }]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const ri = (await db().from('ga_purchase_receipt_items').select('*').eq('receipt_id', r.data.id)).data as any[];
  expect(Number(ri[0].accepted_base)).toBe(10);
  const bal = (await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', boxPart.id).maybeSingle()).data as any;
  expect(Number(bal.quantity_base)).toBe(10);
  await db().from('ga_parts').update({ purchase_to_base_rate: 12 }).eq('id', boxPart.id);
  // 處理單已處理量：需求 24 個、採購 2 箱（開單時 1 箱 = 12 個）到貨 1 箱 → 12 個（不是 1）
  const f = await ful(req.id);
  expect(f, '採購連結建立料件處理單').toBeTruthy();
  expect(Number(f.fulfilled_quantity)).toBe(12);
});

test('審查 5：直接建設備遇到要求序號的分類，送出就擋下並建議改走入庫存再配發', async () => {
  const serCat = await seedCategory('equipment', 'RV-SER', { requires_serial_number: true });
  const tpl = await seedEquipmentTemplate(serCat.id, 'RV-TS');
  const po = await mk([{ item_name: m7Name('RV 要求序號設備'), quantity: 1, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl.id }]);
  const r = await act(po, 'place_order');
  expect(r.ok).toBe(false);
  expect(r.status).toBe(422);
  expect(r.code).toBe('SERIAL_REQUIRED_DIRECT');
  expect(r.error as string).toContain('配發');
});

test('審查 11：直接建設備單次最多 200 台', async () => {
  const tpl = await seedEquipmentTemplate(eqCatId, 'RV-T1');
  const po = await mk([{ item_name: m7Name('RV 大量設備'), quantity: 201, unit_price: 1, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl.id }]);
  const o = await step(po, 'place_order');
  const r = await recv(o, [{ po_item_id: itemId(o), delivered_qty: 201 }]);
  expect(r.ok).toBe(false);
  expect(r.status).toBe(422);
  expect(r.code).toBe('ASSET_QUANTITY_LIMIT');
  const made = await db().from('ga_equipment').select('id', { count: 'exact', head: true }).eq('source_purchase_order_id', o.id);
  expect(made.count).toBe(0);
  // 分次：200 台可以
  const ok = await recv(o, [{ po_item_id: itemId(o), delivered_qty: 200, reason: '分次到貨' }]);
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
});

test('審查 8：庫存出庫同識別重送回原結果，不重寫需求單與處理單事件；需求單狀態往前走後重送仍回原結果', async () => {
  const stockLoc = await seedLocation(null, 'RV-S');
  await seedLocationPart(stockLoc.id, part.id);
  await seedBalance(stockLoc.id, part.id, 20);
  const req = await seedRequest(sid.VW001, users.rq_staff.id, 'RV8', { part_id: part.id, desired_quantity: 3, main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE' });
  const k = key();
  const args = { p_id: req.id, p_location_id: stockLoc.id, p_part_id: part.id, p_quantity: 2, p_input_unit_type: 'BASE', p_reason: '審查補強', p_notes: null, p_substitute_reason: null, p_key: k };
  const a = await fn('rq_staff', 'ga_ws_req_stock_issue', args);
  expect(a.ok, JSON.stringify(a)).toBe(true);
  const evCount = async () => ({
    req: ((await db().from('ga_service_request_events').select('id').eq('request_id', req.id).eq('event_type', 'STOCK_ISSUED')).data || []).length,
    ful: ((await db().from('ga_part_fulfillment_events').select('id').eq('fulfillment_id', a.data.fulfillment_id).eq('event_type', 'STOCK_ISSUED')).data || []).length,
  });
  expect(await evCount()).toEqual({ req: 1, ful: 1 });
  const b = await fn('rq_staff', 'ga_ws_req_stock_issue', args);
  expect(b.ok, JSON.stringify(b)).toBe(true);
  expect(b.idempotent_replay).toBe(true);
  expect(b.data.transaction.transaction_no).toBe(a.data.transaction.transaction_no);
  expect(await evCount()).toEqual({ req: 1, ful: 1 });
  // 需求單狀態往前走之後重送，仍回原結果（不是 409）
  await db().from('ga_service_requests').update({ main_status: 'WAITING_STORE_CONFIRMATION' }).eq('id', req.id);
  const c = await fn('rq_staff', 'ga_ws_req_stock_issue', args);
  expect(c.ok, JSON.stringify(c)).toBe(true);
  expect(c.idempotent_replay).toBe(true);
  expect(await evCount()).toEqual({ req: 1, ful: 1 });
  const bal = (await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', stockLoc.id).eq('part_id', part.id).maybeSingle()).data as any;
  expect(Number(bal.quantity_base)).toBe(18);
});

test('審查 14：舊版收貨保護涵蓋只填來源需求單（沒連評估）的手開採購單', async () => {
  const req = await seedRequest(sid.VW001, users.purchaser.id, 'RV14', { part_id: part.id, desired_quantity: 5 });
  const review = await seedReview(req.id, users.purchaser.id, { approved_quantity: 5 });
  const po = await mk([line(part, 5, 10, { request_id: req.id })], { source_request_id: req.id });
  expect(po.purchase_review_id ?? null).toBeNull();
  const ins = await db().from('ga_inventory_transactions').insert({
    transaction_type: 'RECEIPT', location_id: loc.id, part_id: part.id, quantity_input: 1, input_unit_type: 'BASE', quantity_base: 1, reference_type: 'GA_PURCHASE_REVIEW', reference_id: review.id, reason: '舊版收貨',
  });
  expect(ins.error?.message ?? '').toContain('PURCHASE_ORDER_EXISTS');
  // 取消後解除保護（這裡只確認訊息來源是保護，不實際入庫）
  await step(po, 'cancel', '測試取消');
});

test('審查 16、17：非料件需求不建料件處理單；草稿改掉連結後處理單的採購單據列同步移除', async () => {
  const other = await seedRequest(sid.VW001, users.purchaser.id, 'RV16', { resource_type: 'OTHER_PURCHASE', part_id: null, desired_quantity: 1 });
  await mk([{ item_name: m7Name('RV 非料件'), quantity: 1, unit_price: 100, fulfil_mode: 'NO_STOCK', request_id: other.id }]);
  expect(await ful(other.id), '非料件需求不建處理單').toBeNull();
  const req = await seedRequest(sid.VW001, users.purchaser.id, 'RV17', { part_id: part.id, desired_quantity: 5 });
  const po = await mk([line(part, 5, 10, { request_id: req.id })]);
  const f = await ful(req.id);
  expect(f).toBeTruthy();
  expect((await docs(f.id)).map((d) => d.document_id)).toEqual([po.id]);
  const upd = await fn('purchaser', 'ga_ws_po_update', { p_id: po.id, p_header: {}, p_items: [line(part, 5, 10)], p_expected_updated_at: po.updated_at });
  expect(upd.ok, JSON.stringify(upd)).toBe(true);
  expect(await docs(f.id), '改掉連結後單據列移除').toEqual([]);
});
