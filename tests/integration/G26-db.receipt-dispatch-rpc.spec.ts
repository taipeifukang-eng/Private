import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { anonClient, PERM, setupPoUsers, seedRequest, seedVendor, taipeiToday, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G26（資料庫層）到貨驗入、配發轉設備、型號對應料件、序號補填：ga_ws_po_receive／dispatch／receipts_get、ga_ws_onboarding_set_serial、ga_parts.equipment_template_id。
// 涵蓋：權限矩陣（未登入、缺任一個權限講清楚、核准人只能看、不另要求設備管理權限 D11）、狀態限制、庫存入帳與 DB 回讀（流水、餘額、進貨明細、事件、需求單時間軸）、
//      部分到貨與補送、超收擋（D13）、破損拒收與短收須原因、單位換算、改位置或改收替代料須變更原因、冪等與衝突、併發不超收、日期規則、
//      直接建設備（整數量、不入庫存、來源連結、保固、購價、供應商快照）、只登錄品項、多列原子性（任一列失敗整筆回復）、
//      配發（型號決定、先進先出跨進貨明細、分次、序號、保固起算、可配發量、整筆回復含已出庫的流水、冪等與併發）、序號補填（誰能補、改要原因、同型號不可重複、留紀錄）、
//      料件對應型號（啟用才能設定、可清空、型號被停用後保留）、以及 BEGIN…ROLLBACK 的資料庫層測試。
// 到貨日使用過去日期（2020 年；到貨日不可晚於今天，所以不能用保留年份 2038）；資產編號流水由 DEV 清除函式一併清掉。
// 測試資料：名稱與備註一律帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8 含 ga_dev_cleanup_m7m8_purchasing）。
test.describe.configure({ mode: 'serial' });

const root = path.resolve(__dirname, '..', '..');
const KEYS: PoKey[] = ['purchaser', 'purchaser_eq', 'review_only', 'stock_only', 'part_only', 'no_partview', 'no_review', 'no_txn', 'part_manage', 'viewer', 'approver', 'nobody', 'admin', 'eq_manage', 'storemgr_a', 'storemgr_b'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let partA: any; // 有箱單位（12、允許拆封）、對應型號 tpl1
let partBox: any; // 有箱單位（4）、不允許拆封，對應型號 tpl2
let partB: any; // 沒有對應型號
let partS: any; // 替代料（單位個）
let partBox2: any; // 基本單位「台」（用來測替代料單位不合）
let partDead: any;
let loc: any;
let loc2: any;
let locNoPart: any;
let vendor: any;
let tpl1: any; // 保固 12 個月
let tpl2: any; // 沒有預設保固
let tplNoCode: any; // 分類沒有第二層代碼 → 無法產生資產編號
let eqCatId: string;
let seq = 0;
const key = () => crypto.randomUUID();
const db = () => adminDb();
const fn = (who: PoKey, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const today = () => {
  const d = taipeiToday();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};
const items = (partId: string, qty: number, price: number, extra: Record<string, unknown> = {}) => [{ part_id: partId, quantity: qty, unit_price: price, ...extra }];
const header = (over: Record<string, unknown> = {}) => ({ notes: m7Name(`RC${(seq += 1)}`), vendor_id: vendor.id, receiving_location_id: loc.id, ...over });
async function mk(who: PoKey, its: unknown, h: Record<string, unknown> = {}) {
  const r = await fn(who, 'ga_ws_po_create', { p_header: header(h), p_items: its, p_create_key: key() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
}
const act = (who: PoKey, po: any, action: string, note: string | null = null) => fn(who, 'ga_ws_po_action', { p_id: po.id, p_action: action, p_expected_updated_at: po.updated_at, p_note: note });
/** 一張已下訂的單（含稅總額 ≤ 門檻，免核准）。 */
async function ordered(its: unknown, h: Record<string, unknown> = {}, opts: { backdate?: string } = {}) {
  const draft = await mk('purchaser', its, h);
  const r = await act('purchaser', draft, 'place_order');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (opts.backdate) await db().from('ga_purchase_orders').update({ ordered_at: `${opts.backdate}T00:00:00+08:00` }).eq('id', draft.id);
  return r.data as any;
}
const itemId = (po: any, line = 1) => po.items.find((i: any) => i.line_no === line).id as string;
const recv = (who: PoKey, po: any, lines: unknown[], hdr: Record<string, unknown> = {}, k: string = key()) => fn(who, 'ga_ws_po_receive', { p_po_id: po.id, p_header: hdr, p_lines: lines, p_key: k });
const disp = (who: PoKey, p: { item: string; store: string; qty: number; tpl?: string | null; reason?: string | null; src?: string | null; serials?: unknown; notes?: string | null; key?: string }) =>
  fn(who, 'ga_ws_po_dispatch', {
    p_po_item_id: p.item, p_store_id: p.store, p_quantity: p.qty, p_template_id: p.tpl ?? null, p_template_reason: p.reason ?? null, p_source_location_id: p.src ?? null,
    p_serials: p.serials ?? null, p_notes: p.notes ?? null, p_key: p.key ?? key(),
  });
const full = (po: any, line = 1, qty?: number) => ({ po_item_id: itemId(po, line), delivered_qty: qty ?? Number(po.items.find((i: any) => i.line_no === line).quantity) });
const balance = async (locationId: string, partId: string) => Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', locationId).eq('part_id', partId).maybeSingle()).data?.quantity_base ?? 0);
const txOf = async (partId: string, locationId?: string) => {
  let q = db().from('ga_inventory_transactions').select('*').eq('part_id', partId);
  if (locationId) q = q.eq('location_id', locationId);
  return ((await q.order('created_at')).data || []) as any[];
};
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbItem = async (id: string) => (await db().from('ga_purchase_order_items').select('*').eq('id', id).single()).data as any;
const dbReceipts = async (poId: string) => ((await db().from('ga_purchase_receipts').select('*').eq('po_id', poId).order('created_at')).data || []) as any[];
const dbReceiptItems = async (receiptId: string) => ((await db().from('ga_purchase_receipt_items').select('*').eq('receipt_id', receiptId)).data || []) as any[];
const dbEvents = async (id: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', id).order('created_at').order('id')).data || []) as any[];
const dbEquipBySource = async (poId: string) => ((await db().from('ga_equipment').select('*').eq('source_purchase_order_id', poId).order('created_at').order('id')).data || []) as any[];
const dbDispatches = async (itemId_: string) => ((await db().from('ga_stock_dispatches').select('*').eq('po_item_id', itemId_).order('created_at')).data || []) as any[];
function expectErr(r: any, status: number, code?: string, part?: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  if (code) expect(r.code, JSON.stringify(r)).toBe(code);
  if (part) expect(r.error as string).toContain(part);
  expect(typeof r.error).toBe('string');
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
/** 把一個可配發的庫存準備好：下單、到貨（可指定到貨日）。回傳 po。 */
async function stocked(part: any, qty: number, opts: { date?: string; backdate?: string; hdr?: Record<string, unknown> } = {}) {
  const po = await ordered(items(part.id, qty, 100), opts.hdr || {}, { backdate: opts.backdate });
  const r = await recv('purchaser', po, [full(po)], opts.date ? { received_date: opts.date } : {});
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return po;
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  const cat = await seedCategory('part', 'RC');
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機），無法測試資產編號');
  eqCatId = eqCat.data.id;
  tpl1 = await seedEquipmentTemplate(eqCatId, 'RC-T1', { default_warranty_months: 12, description: '測試用雷射印表機' });
  tpl2 = await seedEquipmentTemplate(eqCatId, 'RC-T2', { default_warranty_months: null });
  const noCodeCat = await seedCategory('equipment', 'RC-NOCODE');
  tplNoCode = await seedEquipmentTemplate(noCodeCat.id, 'RC-T3');
  partA = await seedPart(cat.id, 'RC-A', { purchase_unit: '箱', purchase_to_base_rate: 12, allow_unpacking: true, equipment_template_id: tpl1.id });
  partBox = await seedPart(cat.id, 'RC-BOX', { purchase_unit: '箱', purchase_to_base_rate: 4, equipment_template_id: tpl2.id });
  partB = await seedPart(cat.id, 'RC-B');
  partS = await seedPart(cat.id, 'RC-S');
  partBox2 = await seedPart(cat.id, 'RC-BOX2', { base_unit: '台' });
  partDead = await seedPart(cat.id, 'RC-DEAD', { is_active: false });
  loc = await seedLocation(null, 'RC-W');
  loc2 = await seedLocation(null, 'RC-W2');
  locNoPart = await seedLocation(null, 'RC-W3');
  for (const p of [partA, partB, partS, partBox, partBox2]) {
    await seedLocationPart(loc.id, p.id);
    await seedLocationPart(loc2.id, p.id);
  }
  vendor = await seedVendor('RC-A');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含採購單、進貨、配發、由採購建立的設備與資產編號流水）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const left = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8 T%');
  expect(left.count, '採購單殘留').toBe(0);
  const eq = await db().from('ga_equipment').select('id', { count: 'exact', head: true }).not('source_purchase_order_id', 'is', null);
  const stale = await db().from('ga_equipment').select('id', { count: 'exact', head: true }).like('name', '[自動測試]M7M8 T%');
  expect(stale.count, '測試設備殘留').toBe(0);
  expect(eq.count === null || eq.count >= 0).toBe(true);
});

// ----------------------------------------------------------------------------- 權限矩陣
test('權限矩陣：未登入全部拒絕；缺任一個採購權限講清楚；核准人與檢視人只能看；管理員不繞過；內部輔助函式與資料表不開放', async () => {
  const po = await ordered(items(partB.id, 2, 100));
  const anon = anonClient();
  for (const [name, args] of [
    ['ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [full(po)], p_key: key() }],
    ['ga_ws_po_dispatch', { p_po_item_id: itemId(po), p_store_id: sid.VW001, p_quantity: 1, p_template_id: null, p_template_reason: null, p_source_location_id: null, p_serials: null, p_notes: null, p_key: key() }],
    ['ga_ws_po_receipts_get', { p_po_id: po.id }],
    ['ga_ws_onboarding_set_serial', { p_equipment_id: crypto.randomUUID(), p_serial: 'X', p_reason: null }],
  ] as [string, Record<string, unknown>][]) {
    const r = await callFn(anon, name, args);
    expect(r.ok, `${name} 未登入`).toBe(false);
    expect([0, 401], `${name} 未登入`).toContain(r.status);
  }
  const cases: [PoKey, string, string][] = [
    ['review_only', 'TRANSACTION_PERMISSION_REQUIRED', '庫存交易管理、料件查看'],
    ['stock_only', 'PERMISSION_DENIED', '採購評估管理、料件查看'],
    ['part_only', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理'],
    ['no_partview', 'PART_VIEW_REQUIRED', '料件查看'],
    ['no_review', 'PERMISSION_DENIED', '採購評估管理'],
    ['no_txn', 'TRANSACTION_PERMISSION_REQUIRED', '庫存交易管理'],
    ['viewer', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理、料件查看'],
    ['approver', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理、料件查看'],
    ['nobody', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理、料件查看'],
    ['admin', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理、料件查看'],
    ['eq_manage', 'PERMISSION_DENIED', '採購評估管理、庫存交易管理、料件查看'],
  ];
  const r0 = (await dbReceipts(po.id)).length;
  const bPerm = await balance(loc.id, partB.id);
  for (const [who, code, missing] of cases) {
    const r = await recv(who, po, [full(po)]);
    expectErr(r, 403, code, `您缺少：${missing}`);
    const d = await disp(who, { item: itemId(po), store: sid.VW001, qty: 1, tpl: tpl1.id });
    expectErr(d, 403, code, `您缺少：${missing}`);
  }
  expect((await dbReceipts(po.id)).length, '沒有寫入任何進貨紀錄').toBe(r0);
  expect(await balance(loc.id, partB.id), '沒有入帳').toBe(bPerm);
  // 檢視：採購評估檢視、採購管理、核准人都能看進貨與配發明細；只有庫存或料件權限的不行
  for (const who of ['viewer', 'approver', 'purchaser', 'review_only'] as PoKey[]) expect((await fn(who, 'ga_ws_po_receipts_get', { p_po_id: po.id })).status, who).toBe(200);
  for (const who of ['stock_only', 'part_only', 'nobody', 'admin', 'eq_manage'] as PoKey[]) {
    const r = await fn(who, 'ga_ws_po_receipts_get', { p_po_id: po.id });
    expectErr(r, 403, 'PERMISSION_DENIED');
  }
  expectErr(await fn('purchaser', 'ga_ws_po_receipts_get', { p_po_id: crypto.randomUUID() }), 404, 'NOT_FOUND');
  // 內部輔助函式不開放給登入者
  for (const [name, args] of [
    ['ga_po_make_equipment', { p_template_id: tpl1.id, p_store_id: sid.VW001, p_serial: null, p_receipt_date: today(), p_unit_price: 1, p_po_id: po.id, p_po_item_id: itemId(po), p_receipt_item_id: null, p_dispatch_id: null, p_request_id: null }],
    ['ga_po_receipt_data', { p_id: crypto.randomUUID() }], ['ga_po_dispatch_data', { p_id: crypto.randomUUID() }], ['ga_next_receipt_no', {}], ['ga_next_dispatch_no', {}],
    ['ga_po_unit_type', { p_part_id: partB.id, p_unit: '個' }], ['ga_po_serial_conflict', { p_template_id: tpl1.id, p_serial: 'x' }],
    ['ga_po_request_timeline', { p_request_id: crypto.randomUUID(), p_type: 'x', p_title: 'x', p_desc: null, p_meta: {}, p_uid: users.purchaser.id }],
  ] as [string, Record<string, unknown>][]) {
    const r = await callFn(users.purchaser.client, name, args);
    expect(r.ok === false || r.status === 0, `${name} 不可被登入者呼叫`).toBe(true);
  }
  // 四張新資料表不開放登入者直接讀寫
  for (const t of ['ga_purchase_receipts', 'ga_purchase_receipt_items', 'ga_stock_dispatches', 'ga_equipment_serial_events']) {
    const sel = await users.purchaser.client.from(t).select('id').limit(1);
    expect(sel.data === null || (sel.data as any[]).length === 0, `${t} 不可直接讀`).toBe(true);
    const ins = await users.purchaser.client.from(t).insert({ id: crypto.randomUUID() });
    expect(ins.error, `${t} 不可直接寫`).not.toBeNull();
  }
});

// ----------------------------------------------------------------------------- 狀態限制
test('狀態限制：草稿、已核准未下訂、已取消、已全部到貨、已結案都不能登錄到貨', async () => {
  const draft = await mk('purchaser', items(partB.id, 1, 100));
  const e1 = await recv('purchaser', draft, [{ po_item_id: itemId(draft), delivered_qty: 1 }]);
  expectErr(e1, 409, 'INVALID_STATE', '還沒有下訂');
  expect(e1.current_status).toBe('DRAFT');
  const canceled = await ordered(items(partB.id, 1, 100));
  expect((await act('purchaser', canceled, 'cancel', '不要了')).ok).toBe(true);
  expectErr(await recv('purchaser', canceled, [full(canceled)]), 409, 'INVALID_STATE', '已取消');
  const done = await ordered(items(partB.id, 1, 100));
  const ok = await recv('purchaser', done, [full(done)]);
  expect(ok.status).toBe(201);
  expectErr(await recv('purchaser', done, [full(done)]), 409, 'INVALID_STATE', '已經全部到貨');
  const closed = (await act('purchaser', ok.po, 'close')).data;
  expect(closed.status).toBe('CLOSED');
  expectErr(await recv('purchaser', done, [full(done)]), 409, 'INVALID_STATE', '已結案');
  expectErr(await recv('purchaser', { id: crypto.randomUUID() }, [full(done)]), 404, 'NOT_FOUND');
  // 沒有任何一筆因為被擋而寫入
  expect((await dbReceipts(draft.id)).length + (await dbReceipts(canceled.id)).length).toBe(0);
  expect((await dbReceipts(done.id)).length).toBe(1);
});

// ----------------------------------------------------------------------------- 到貨驗入（STOCK）
test('登錄到貨即驗入：入帳、流水、餘額、進貨明細、事件、需求單時間軸都與 DB 回讀一致', async () => {
  const req = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-RC', { part_id: partB.id, desired_quantity: 5 });
  const po = await ordered(items(partB.id, 5, 100, { request_id: req.id }));
  const before = Date.now();
  const bBase = await balance(loc.id, partB.id);
  const r = await recv('purchaser', po, [full(po)], { delivery_note_no: ' DN-001 ', notes: m7Name('到貨備註') });
  expect(r.status).toBe(201);
  expect(r.idempotent_replay).toBe(false);
  const rc = r.data;
  expect(rc.receipt_no).toMatch(new RegExp(`^RC-${taipeiToday()}-\\d{3,}$`));
  expect(rc).toMatchObject({ po_id: po.id, received_date: today(), delivery_note_no: 'DN-001', created_by: users.purchaser.id });
  expect(rc).not.toHaveProperty('idempotency_key');
  expect(rc.items).toHaveLength(1);
  expect(rc.items[0]).toMatchObject({ fulfil_mode: 'STOCK', location_id: loc.id, received_part_id: partB.id, change_reason: null });
  expect([rc.items[0].delivered_qty, rc.items[0].accepted_qty, rc.items[0].rejected_qty, rc.items[0].accepted_base].map(Number)).toEqual([5, 5, 0, 5]);
  expect(r.po.status).toBe('RECEIVED');
  // DB 回讀：流水（參考單據、原因、中繼資料）、餘額
  const txs = (await txOf(partB.id, loc.id)).filter((t) => t.reference_id === po.id);
  expect(txs).toHaveLength(1);
  expect(txs[0]).toMatchObject({ transaction_type: 'RECEIPT', reference_type: 'GA_PURCHASE_ORDER', reference_id: po.id, created_by: users.purchaser.id });
  expect(Number(txs[0].quantity_base)).toBe(5);
  expect(txs[0].reason).toContain(rc.receipt_no);
  expect(txs[0].metadata).toMatchObject({ po_no: po.po_no, receipt_no: rc.receipt_no });
  expect(Date.parse(txs[0].occurred_at)).toBeGreaterThan(before - 60_000);
  expect(await balance(loc.id, partB.id)).toBe(bBase + 5);
  expect(rc.items[0].inventory_transaction_id).toBe(txs[0].id);
  // 進貨明細、品項、採購單、事件
  const ris = await dbReceiptItems(rc.id);
  expect(ris).toHaveLength(1);
  expect(Number(ris[0].dispatched_qty)).toBe(0);
  expect(Number((await dbItem(itemId(po))).received_qty)).toBe(5);
  expect((await dbPo(po.id)).status).toBe('RECEIVED');
  const ev = (await dbEvents(po.id)).filter((e) => e.event_type === 'receive');
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ from_status: 'ORDERED', to_status: 'RECEIVED', actor_id: users.purchaser.id });
  expect(ev[0].payload).toMatchObject({ receipt_no: rc.receipt_no, delivery_note_no: 'DN-001' });
  // 需求單時間軸（內部可見）
  const tl = ((await db().from('ga_service_request_events').select('*').eq('request_id', req.id).eq('event_type', 'PURCHASE_ORDER_RECEIVED')).data || []) as any[];
  expect(tl).toHaveLength(1);
  expect(tl[0]).toMatchObject({ visibility: 'INTERNAL', created_by: users.purchaser.id });
  expect(tl[0].title).toContain(po.po_no);
  // 查詢：進貨與可配發量
  const g = await fn('viewer', 'ga_ws_po_receipts_get', { p_po_id: po.id });
  expect(g.data.receipts).toHaveLength(1);
  expect(g.data.items[0]).toMatchObject({ fulfil_mode: 'STOCK' });
  expect([g.data.items[0].received_qty, g.data.items[0].remaining_qty, g.data.items[0].received_base, g.data.items[0].dispatched_base, g.data.items[0].dispatchable_base].map(Number)).toEqual([5, 0, 5, 0, 5]);
});

test('部分到貨與補送：部分到貨要填原因；超過剩餘可收量擋（D13）；補滿才變全部到貨；短收結案後不能取消', async () => {
  const po = await ordered(items(partB.id, 5, 100));
  const it = itemId(po);
  const b0 = await balance(loc.id, partB.id);
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2 }]), 400, 'REASON_REQUIRED', '短收');
  expect(await balance(loc.id, partB.id)).toBe(b0);
  expect(await dbReceipts(po.id)).toHaveLength(0);
  const p1 = await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '廠商分批出貨' }]);
  expect(p1.status).toBe(201);
  expect(p1.po.status).toBe('PARTIALLY_RECEIVED');
  expect(Number((await dbItem(it)).received_qty)).toBe(2);
  expect(await balance(loc.id, partB.id)).toBe(b0 + 2);
  const over = await recv('purchaser', p1.po, [{ po_item_id: it, delivered_qty: 4 }]);
  expectErr(over, 409, 'OVER_RECEIVE', '超過剩餘可收量 3');
  expect(Number(over.remaining)).toBe(3);
  expect(await balance(loc.id, partB.id), '超收被擋，庫存沒有增加').toBe(b0 + 2);
  expect((await dbReceipts(po.id)).length).toBe(1);
  expect(Number((await dbItem(it)).received_qty)).toBe(2);
  const p2 = await recv('purchaser', p1.po, [{ po_item_id: it, delivered_qty: 3 }]); // 剛好補滿，不需原因
  expect(p2.status).toBe(201);
  expect(p2.po.status).toBe('RECEIVED');
  expect(await balance(loc.id, partB.id)).toBe(b0 + 5);
  expect((await dbEvents(po.id)).filter((e) => e.event_type === 'receive').map((e) => [e.from_status, e.to_status])).toEqual([['ORDERED', 'PARTIALLY_RECEIVED'], ['PARTIALLY_RECEIVED', 'RECEIVED']]);
  // 短收結案：部分到貨後以原因結案；有到貨紀錄的單不能取消
  const po2 = await ordered(items(partB.id, 4, 100));
  const q = await recv('purchaser', po2, [{ po_item_id: itemId(po2), delivered_qty: 1, reason: '其餘廠商缺貨' }]);
  expectErr(await act('purchaser', q.po, 'cancel', '想取消'), 409, 'HAS_RECEIPTS');
  const sc = await act('purchaser', q.po, 'short_close', '廠商停產');
  expect(sc.data.status).toBe('CLOSED');
  expectErr(await recv('purchaser', po2, [{ po_item_id: itemId(po2), delivered_qty: 3, reason: 'x' }]), 409, 'INVALID_STATE');
});

test('破損拒收：驗入量小於到貨量須原因；驗入量不可大於到貨量；全數拒收不入庫、可補送', async () => {
  const po = await ordered(items(partB.id, 5, 100));
  const it = itemId(po);
  const b0 = await balance(loc.id, partB.id);
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 5, accepted_qty: 3 }]), 400, 'REASON_REQUIRED', '破損或拒收');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 3, accepted_qty: 4, reason: 'x' }]), 400, 'ACCEPTED_EXCEEDS_DELIVERED');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 0, reason: 'x' }]), 400, 'INVALID_QUANTITY');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 1.23456 }]), 400, 'INVALID_QUANTITY');
  expect(await balance(loc.id, partB.id)).toBe(b0);
  const r = await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 5, accepted_qty: 3, reason: '2 台外箱破損退回' }]);
  expect(r.status).toBe(201);
  expect(r.po.status).toBe('PARTIALLY_RECEIVED');
  const ri = (await dbReceiptItems(r.data.id))[0];
  expect([ri.delivered_qty, ri.accepted_qty, ri.rejected_qty, ri.accepted_base].map(Number)).toEqual([5, 3, 2, 3]);
  expect(ri.reason).toBe('2 台外箱破損退回');
  expect(await balance(loc.id, partB.id)).toBe(b0 + 3);
  expect(Number((await dbItem(it)).received_qty), '破損的不算已驗入').toBe(3);
  // 破損的 2 台不算收到：剩餘可收 2；全數拒收一次（驗入 0）不入庫、狀態與已驗入量不變
  const none = await recv('purchaser', r.po, [{ po_item_id: it, delivered_qty: 2, accepted_qty: 0, reason: '補送的也是壞的，整批退回' }]);
  expect(none.status).toBe(201);
  expect(none.po.status).toBe('PARTIALLY_RECEIVED');
  expect(await balance(loc.id, partB.id)).toBe(b0 + 3);
  expect((await txOf(partB.id, loc.id)).filter((t) => t.reference_id === po.id)).toHaveLength(1);
  expect(Number((await dbItem(it)).received_qty)).toBe(3);
  const fin = await recv('purchaser', none.po, [{ po_item_id: it, delivered_qty: 2 }]);
  expect(fin.po.status).toBe('RECEIVED');
  expect(await balance(loc.id, partB.id)).toBe(b0 + 5);
  // 第一次就全數拒收：狀態維持已下訂
  const po2 = await ordered(items(partB.id, 2, 100));
  const rej = await recv('purchaser', po2, [{ po_item_id: itemId(po2), delivered_qty: 2, accepted_qty: 0, reason: '整批規格不符' }]);
  expect(rej.po.status).toBe('ORDERED');
  expect(await dbReceipts(po2.id)).toHaveLength(1);
});

test('單位換算：用採購單位（箱）驗入，庫存以基本單位入帳', async () => {
  const po = await ordered(items(partA.id, 2, 1200, { unit: '箱' }));
  expect(Number(po.items[0].quantity_base)).toBe(24);
  const a0 = await balance(loc.id, partA.id);
  const r1 = await recv('purchaser', po, [{ po_item_id: itemId(po), delivered_qty: 1, reason: '先到一箱' }]);
  expect(r1.status).toBe(201);
  expect(await balance(loc.id, partA.id)).toBe(a0 + 12);
  const ri = (await dbReceiptItems(r1.data.id))[0];
  expect([ri.accepted_qty, ri.accepted_base].map(Number)).toEqual([1, 12]);
  const tx = (await txOf(partA.id, loc.id)).find((t) => t.reference_id === po.id)!;
  expect(tx.input_unit_type).toBe('PURCHASE');
  expect(Number(tx.quantity_input)).toBe(1);
  expect(Number(tx.quantity_base)).toBe(12);
  const r2 = await recv('purchaser', r1.po, [{ po_item_id: itemId(po), delivered_qty: 1 }]);
  expect(r2.po.status).toBe('RECEIVED');
  expect(await balance(loc.id, partA.id)).toBe(a0 + 24);
});

test('改收貨位置、改收替代料：須變更原因並留在進貨明細；單位不合、停用料件、位置沒設定該料件都擋', async () => {
  const po = await ordered(items(partB.id, 6, 100));
  const it = itemId(po);
  const b0 = await balance(loc.id, partB.id);
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', location_id: loc2.id }]), 400, 'CHANGE_REASON_REQUIRED', '收貨位置');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', received_part_id: partS.id }]), 400, 'CHANGE_REASON_REQUIRED', '替代料件');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', received_part_id: partBox2.id, change_reason: '缺貨' }]), 422, 'SUBSTITUTE_UNIT_MISMATCH', '台');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', received_part_id: partDead.id, change_reason: '缺貨' }]), 409, 'PART_INACTIVE');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', location_id: locNoPart.id, change_reason: '換倉' }]), 422, 'LOCATION_PART_NOT_CONFIGURED');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', location_id: crypto.randomUUID(), change_reason: '換倉' }]), 404, 'LOCATION_NOT_FOUND');
  expect(await dbReceipts(po.id), '被擋的都沒有留下進貨紀錄').toHaveLength(0);
  expect(await balance(loc.id, partB.id)).toBe(b0);
  const r = await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '分批', location_id: loc2.id, change_reason: '主倉滿了先放二號倉' }]);
  expect(r.status).toBe(201);
  expect(r.data.items[0]).toMatchObject({ location_id: loc2.id, change_reason: '主倉滿了先放二號倉' });
  expect(await balance(loc2.id, partB.id)).toBeGreaterThanOrEqual(2);
  expect(await balance(loc.id, partB.id)).toBe(b0);
  const s0 = await balance(loc.id, partS.id);
  const r2 = await recv('purchaser', r.po, [{ po_item_id: it, delivered_qty: 4, received_part_id: partS.id, change_reason: '廠商缺貨，改出替代料' }]);
  expect(r2.status).toBe(201);
  expect(r2.po.status).toBe('RECEIVED');
  expect(r2.data.items[0]).toMatchObject({ received_part_id: partS.id, change_reason: '廠商缺貨，改出替代料' });
  expect(await balance(loc.id, partS.id), '替代料入的是替代料自己的庫存').toBe(s0 + 4);
  expect(await balance(loc.id, partB.id)).toBe(b0);
  expect((await dbItem(it)).part_id, '採購單品項本身不變').toBe(partB.id);
});

test('冪等：同識別同內容回原結果、沒有重複入帳；同識別不同內容 409；缺識別 400', async () => {
  const po = await ordered(items(partB.id, 3, 100));
  const it = itemId(po);
  const k = key();
  const b0 = await balance(loc.id, partB.id);
  const lines = [{ po_item_id: it, delivered_qty: 3 }];
  const first = await recv('purchaser', po, lines, {}, k);
  expect(first.status).toBe(201);
  const again = await recv('purchaser', po, lines, {}, k);
  expect(again.status).toBe(200);
  expect(again.idempotent_replay).toBe(true);
  expect(again.data.id).toBe(first.data.id);
  expect(again.data.receipt_no).toBe(first.data.receipt_no);
  expect(await balance(loc.id, partB.id), '重送沒有再入帳').toBe(b0 + 3);
  expect(await dbReceipts(po.id)).toHaveLength(1);
  expect((await txOf(partB.id, loc.id)).filter((t) => t.reference_id === po.id)).toHaveLength(1);
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: 'x' }], {}, k), 409, 'IDEMPOTENCY_CONFLICT');
  const other = await ordered(items(partB.id, 3, 100));
  expectErr(await recv('purchaser', other, [full(other)], {}, k), 409, 'IDEMPOTENCY_CONFLICT');
  expect(await dbReceipts(other.id)).toHaveLength(0);
  expectErr(await fn('purchaser', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: lines, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  expectErr(await recv('purchaser', po, lines, {}, 'k'.repeat(65)), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  // 輸入格式
  expectErr(await recv('purchaser', other, [], {}), 400, 'LINES_REQUIRED');
  expectErr(await recv('purchaser', other, Array.from({ length: 51 }, () => full(other)), {}), 400, 'TOO_MANY_ITEMS');
  expectErr(await recv('purchaser', other, [full(other), full(other)], {}), 400, 'DUPLICATE_ITEM');
  expectErr(await recv('purchaser', other, [{ po_item_id: crypto.randomUUID(), delivered_qty: 1 }], {}), 404, 'ITEM_NOT_FOUND');
  expectErr(await recv('purchaser', other, [{ po_item_id: 'nope', delivered_qty: 1 }], {}), 400, 'LINE_INVALID');
  expectErr(await recv('purchaser', other, [{ po_item_id: itemId(po), delivered_qty: 1 }], {}), 404, 'ITEM_NOT_FOUND'); // 別張單的品項
  expect(await dbReceipts(other.id)).toHaveLength(0);
});

test('併發：兩個人同時登錄全數到貨只有一個成功，不超收；同識別同時送兩次只入帳一次', async () => {
  const po = await ordered(items(partB.id, 3, 100));
  const b0 = await balance(loc.id, partB.id);
  const [x, y] = await Promise.all([recv('purchaser', po, [full(po)]), recv('purchaser', po, [full(po)])]);
  const statuses = [x.status, y.status].sort();
  expect(statuses, JSON.stringify([x, y])).toEqual([201, 409]);
  const loser = x.status === 409 ? x : y;
  expect(['INVALID_STATE', 'OVER_RECEIVE']).toContain(loser.code);
  expect(await balance(loc.id, partB.id), '只入帳一次').toBe(b0 + 3);
  expect(await dbReceipts(po.id)).toHaveLength(1);
  expect(Number((await dbItem(itemId(po))).received_qty)).toBe(3);
  // 同識別同時送
  const po2 = await ordered(items(partB.id, 3, 100));
  const k = key();
  const [a, b] = await Promise.all([recv('purchaser', po2, [full(po2)], {}, k), recv('purchaser', po2, [full(po2)], {}, k)]);
  expect([a.status, b.status].sort(), JSON.stringify([a, b])).toEqual([200, 201]);
  expect(a.data.id).toBe(b.data.id);
  expect(await dbReceipts(po2.id)).toHaveLength(1);
  expect(await balance(loc.id, partB.id)).toBe(b0 + 6);
});

test('到貨日期：不可晚於今天、必須有效、不可早於下訂日；補登過去日期流水用該日期', async () => {
  const po = await ordered(items(partB.id, 2, 100), {}, { backdate: '2020-01-01' });
  const it = itemId(po);
  const line = [{ po_item_id: it, delivered_qty: 2 }];
  expectErr(await recv('purchaser', po, line, { received_date: '2038-01-01' }), 400, 'FUTURE_DATE');
  expectErr(await recv('purchaser', po, line, { received_date: '2020-02-30' }), 400, 'DATE_INVALID');
  expectErr(await recv('purchaser', po, line, { received_date: '2020/02/01' }), 400, 'DATE_INVALID');
  expectErr(await recv('purchaser', po, line, { received_date: '2019-12-31' }), 422, 'DATE_BEFORE_ORDER', '下訂日');
  expectErr(await recv('purchaser', po, line, { delivery_note_no: 'x'.repeat(61) }), 400, 'DELIVERY_NOTE_TOO_LONG');
  expectErr(await recv('purchaser', po, line, { notes: 'x'.repeat(501) }), 400, 'NOTES_TOO_LONG');
  expectErr(await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: 'x'.repeat(201), accepted_qty: 1 }]), 400, 'REASON_TOO_LONG');
  expect(await dbReceipts(po.id)).toHaveLength(0);
  const r = await recv('purchaser', po, line, { received_date: '2020-03-01' });
  expect(r.status).toBe(201);
  expect(r.data.received_date).toBe('2020-03-01');
  const tx = (await txOf(partB.id, loc.id)).find((t) => t.reference_id === po.id)!;
  expect(tx.occurred_at.slice(0, 10)).toBe('2020-03-01');
});

// ----------------------------------------------------------------------------- 直接建設備、只登錄、多列
test('直接建設備（D16）：到貨驗入就在同一交易建設備送門市，不入庫存；帶型號、購價、保固、供應商與來源連結；整數量', async () => {
  const po = await ordered([{ item_name: m7Name('直送印表機'), quantity: 3, unit_price: 800, unit: '台', fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl1.id }]);
  const it = itemId(po);
  const r = await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 2, reason: '先到兩台' }]);
  expect(r.status).toBe(201);
  expect(r.po.status).toBe('PARTIALLY_RECEIVED');
  const eq = await dbEquipBySource(po.id);
  expect(eq).toHaveLength(2);
  const ri = (await dbReceiptItems(r.data.id))[0];
  const ordd = await dbPo(po.id);
  for (const e of eq) {
    expect(e).toMatchObject({
      store_id: sid.ZT01, category_id: eqCatId, template_id: tpl1.id, name: tpl1.name, brand: tpl1.brand, model: tpl1.model, status: 'ACTIVE',
      purchased_at: today(), warranty_start_date: today(), has_warranty: true, vendor_id: vendor.id, vendor_name_snapshot: vendor.name,
      source_purchase_order_id: po.id, source_po_item_id: it, source_receipt_item_id: ri.id, source_dispatch_id: null, source_request_id: null,
      onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', serial_number: null, created_by: users.purchaser.id,
    });
    expect(Number(e.purchase_amount)).toBe(800);
    expect(e.asset_code).toMatch(new RegExp(`^IC02${taipeiToday()}\\d{3}$`));
    expect(e.notes).toContain(ordd.po_no);
    const end = new Date(`${today()}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 12);
    expect(e.warranty_end_date).toBe(end.toISOString().slice(0, 10));
  }
  expect(new Set(eq.map((e) => e.asset_code)).size, '資產編號不重複').toBe(2);
  const noTx = await db().from('ga_inventory_transactions').select('id', { count: 'exact', head: true }).eq('reference_id', po.id);
  expect(noTx.count, '直接建設備不入庫存').toBe(0);
  expect(r.data.items[0].equipment).toHaveLength(2);
  // 非整數量：整筆擋，沒有多建設備
  expectErr(await recv('purchaser', r.po, [{ po_item_id: it, delivered_qty: 0.5, reason: 'x' }]), 422, 'ASSET_QUANTITY_INTEGER');
  expect(await dbEquipBySource(po.id)).toHaveLength(2);
  expect(await dbReceipts(po.id)).toHaveLength(1);
  // 補收最後一台；該台的資產編號也是新的
  const r2 = await recv('purchaser', r.po, [{ po_item_id: it, delivered_qty: 1 }]);
  expect(r2.po.status).toBe('RECEIVED');
  const eq3 = await dbEquipBySource(po.id);
  expect(eq3).toHaveLength(3);
  expect(new Set(eq3.map((e) => e.asset_code)).size).toBe(3);
  // 型號沒有預設保固：不標有保固
  const po2 = await ordered([{ item_name: m7Name('直送二'), quantity: 1, unit_price: 500, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.VW001, equipment_template_id: tpl2.id }]);
  expect((await recv('purchaser', po2, [full(po2)])).status).toBe(201);
  const [e2] = await dbEquipBySource(po2.id);
  expect(e2).toMatchObject({ has_warranty: false, warranty_end_date: null, warranty_start_date: today(), store_id: sid.VW001 });
});

test('直接建設備遇到問題整筆回復：型號已停用、型號所屬分類無法產生資產編號；整數量多列中第二列失敗第一列也不留', async () => {
  const tplLate = await seedEquipmentTemplate(eqCatId, 'RC-T4');
  const poLate = await ordered([{ item_name: m7Name('停用型號'), quantity: 1, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tplLate.id }]);
  await db().from('ga_equipment_templates').update({ is_active: false }).eq('id', tplLate.id);
  expectErr(await recv('purchaser', poLate, [full(poLate)]), 422, 'TEMPLATE_INVALID');
  expect(await dbReceipts(poLate.id)).toHaveLength(0);
  expect(Number((await dbItem(itemId(poLate))).received_qty)).toBe(0);
  const poCode = await ordered([{ item_name: m7Name('無編號'), quantity: 1, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tplNoCode.id }]);
  expectErr(await recv('purchaser', poCode, [full(poCode)]), 422, 'ASSET_CODE_UNAVAILABLE', '第二層分類代碼');
  expect(await dbReceipts(poCode.id)).toHaveLength(0);
  expect(await dbEquipBySource(poCode.id)).toHaveLength(0);
  // 多列：第一列是入庫存（先成功）、第二列直接建設備但型號無法取號 → 第一列的入帳也要回復
  const poMix = await ordered([
    { part_id: partB.id, quantity: 2, unit_price: 100 },
    { item_name: m7Name('壞型號'), quantity: 1, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tplNoCode.id },
  ]);
  const b0 = await balance(loc.id, partB.id);
  expectErr(await recv('purchaser', poMix, [full(poMix, 1), full(poMix, 2)]), 422, 'ASSET_CODE_UNAVAILABLE');
  expect(await balance(loc.id, partB.id), '第一列入帳已回復').toBe(b0);
  expect(await dbReceipts(poMix.id)).toHaveLength(0);
  expect((await txOf(partB.id, loc.id)).filter((t) => t.reference_id === poMix.id)).toHaveLength(0);
  expect((await dbPo(poMix.id)).status).toBe('ORDERED');
  expect(Number((await dbItem(itemId(poMix, 1))).received_qty)).toBe(0);
});

test('只登錄（NO_STOCK）與一次登錄多種品項：不入庫、不建設備；多列一起成功', async () => {
  const po = await ordered([
    { part_id: partB.id, quantity: 2, unit_price: 100 },
    { item_name: m7Name('自由品名'), quantity: 4, unit_price: 50, unit: '包' },
    { item_name: m7Name('直送設備'), quantity: 1, unit_price: 700, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl2.id },
  ]);
  expect(po.items.map((i: any) => i.fulfil_mode)).toEqual(['STOCK', 'NO_STOCK', 'DIRECT_ASSET']);
  const b0 = await balance(loc.id, partB.id);
  // 只登錄的品項不能指定位置或料件
  expectErr(await recv('purchaser', po, [{ po_item_id: itemId(po, 2), delivered_qty: 4, location_id: loc.id }]), 400, 'LINE_INVALID', '不入庫存');
  const r = await recv('purchaser', po, [full(po, 1), full(po, 2), full(po, 3)], { notes: m7Name('三種') });
  expect(r.status).toBe(201);
  expect(r.po.status).toBe('RECEIVED');
  expect(r.data.items.map((i: any) => i.fulfil_mode)).toEqual(['STOCK', 'NO_STOCK', 'DIRECT_ASSET']);
  expect(await balance(loc.id, partB.id)).toBe(b0 + 2);
  const txs = (await txOf(partB.id, loc.id)).filter((t) => t.reference_id === po.id);
  expect(txs).toHaveLength(1);
  const allTx = await db().from('ga_inventory_transactions').select('id', { count: 'exact', head: true }).eq('reference_id', po.id);
  expect(allTx.count, '只有入庫存那一列有流水').toBe(1);
  expect((await dbEquipBySource(po.id)).length, '只有直接建設備那一列建了設備').toBe(1);
  const ris = await dbReceiptItems(r.data.id);
  expect(ris.find((x) => x.po_item_id === itemId(po, 2))).toMatchObject({ inventory_transaction_id: null, location_id: null, received_part_id: null });
  expect(Number((await dbItem(itemId(po, 2))).received_qty)).toBe(4);
});

test('多列原子性：第二列超收或位置沒設定料件，第一列的入帳也整筆回復', async () => {
  const po = await ordered([{ part_id: partB.id, quantity: 2, unit_price: 100 }, { part_id: partS.id, quantity: 2, unit_price: 100 }]);
  const b0 = await balance(loc.id, partB.id);
  const s0 = await balance(loc.id, partS.id);
  expectErr(await recv('purchaser', po, [full(po, 1), { po_item_id: itemId(po, 2), delivered_qty: 3 }]), 409, 'OVER_RECEIVE');
  expectErr(await recv('purchaser', po, [full(po, 1), { po_item_id: itemId(po, 2), delivered_qty: 2, location_id: locNoPart.id, change_reason: '換倉' }]), 422, 'LOCATION_PART_NOT_CONFIGURED');
  expect(await balance(loc.id, partB.id)).toBe(b0);
  expect(await balance(loc.id, partS.id)).toBe(s0);
  expect(await dbReceipts(po.id)).toHaveLength(0);
  expect((await dbPo(po.id)).status).toBe('ORDERED');
  expect(Number((await dbItem(itemId(po, 1))).received_qty)).toBe(0);
  expect((await dbEvents(po.id)).filter((e) => e.event_type === 'receive')).toHaveLength(0);
});

// ----------------------------------------------------------------------------- 配發
test('配發：同一交易出庫 N、建 N 筆設備、帶型號購價保固、序號可空、連結採購單與進貨明細；不另要求設備管理權限（D11）；店長立即有貼標待辦', async () => {
  const po = await stocked(partA, 6);
  const it = itemId(po);
  const rc = (await dbReceipts(po.id))[0];
  const ri = (await dbReceiptItems(rc.id))[0];
  const a0 = await balance(loc.id, partA.id);
  expect(a0).toBeGreaterThanOrEqual(6);
  const k = key();
  const r = await disp('purchaser', { item: it, store: sid.VW001, qty: 3, serials: ['SN-A1', ' sn-a2 '], notes: m7Name('配發備註'), key: k });
  expect(r.status, JSON.stringify(r)).toBe(201);
  expect(r.idempotent_replay).toBe(false);
  const d = r.data;
  expect(d.dispatch_no).toMatch(new RegExp(`^DSP-${taipeiToday()}-\\d{3,}$`));
  expect(d).toMatchObject({ po_item_id: it, part_id: partA.id, store_id: sid.VW001, quantity: 3, equipment_template_id: tpl1.id, source_location_id: loc.id, created_by: users.purchaser.id, request_id: null });
  expect(d).not.toHaveProperty('idempotency_key');
  expect(d.equipment).toHaveLength(3);
  expect(d.equipment.map((e: any) => e.serial_number)).toEqual(['SN-A1', 'sn-a2', null]);
  // 庫存：ISSUE 3、參考單據與原因
  expect(await balance(loc.id, partA.id)).toBe(a0 - 3);
  const issue = (await txOf(partA.id, loc.id)).filter((t) => t.reference_id === po.id && t.transaction_type === 'ISSUE');
  expect(issue).toHaveLength(1);
  expect(Number(issue[0].quantity_base)).toBe(-3);
  expect(issue[0].reason).toContain(d.dispatch_no);
  expect(d.issue_transaction_id).toBe(issue[0].id);
  // 設備：型號、分類、購價（每台未稅單價）、保固、來源連結、貼標狀態
  const eq = (await dbEquipBySource(po.id)).filter((e) => e.source_dispatch_id === d.id);
  expect(eq).toHaveLength(3);
  for (const e of eq) {
    expect(e).toMatchObject({
      store_id: sid.VW001, template_id: tpl1.id, category_id: eqCatId, name: tpl1.name, brand: tpl1.brand, model: tpl1.model, source_po_item_id: it, source_receipt_item_id: ri.id,
      source_dispatch_id: d.id, warranty_start_date: today(), has_warranty: true, vendor_id: vendor.id, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO',
    });
    expect(Number(e.purchase_amount)).toBe(100);
    expect(e.asset_code).toMatch(/^IC02\d{11}$/);
  }
  expect(new Set(eq.map((e) => e.asset_code)).size).toBe(3);
  // 進貨明細、品項、事件
  expect(Number((await dbReceiptItems(rc.id))[0].dispatched_qty)).toBe(3);
  expect(Number((await dbItem(it)).dispatched_qty)).toBe(3);
  const ev = (await dbEvents(po.id)).filter((e) => e.event_type === 'dispatch');
  expect(ev).toHaveLength(1);
  expect(ev[0].payload).toMatchObject({ dispatch_no: d.dispatch_no, quantity: 3, store_id: sid.VW001 });
  expect(ev[0].payload.distribution).toEqual([{ receipt_item_id: ri.id, received_date: today(), quantity: 3 }]);
  // 查詢可配發量：6 − 3 = 3
  const g = await fn('purchaser', 'ga_ws_po_receipts_get', { p_po_id: po.id });
  expect([g.data.items[0].received_base, g.data.items[0].dispatched_base, g.data.items[0].dispatchable_base].map(Number)).toEqual([6, 3, 3]);
  expect(g.data.dispatches).toHaveLength(1);
  expect(g.data.dispatches[0].equipment).toHaveLength(3);
  expect(g.data.items[0].part_equipment_template_id).toBe(tpl1.id);
  // 店長立即有貼標待辦：VW001 店長看得到這 3 台，ZT01 店長看不到
  const mine = await callFn(users.storemgr_a.client, 'ga_ws_onboarding_list', { p_statuses: ['NEEDS_EQUIPMENT_PHOTO'], p_asset_type: 'EQUIPMENT', p_store_id: null, p_search: tpl1.name, p_limit: 200, p_offset: 0 });
  expect(mine.ok).toBe(true);
  const mineIds = (mine.data.rows as any[]).map((x) => x.id);
  for (const e of eq) expect(mineIds).toContain(e.id);
  const other = await callFn(users.storemgr_b.client, 'ga_ws_onboarding_list', { p_statuses: ['NEEDS_EQUIPMENT_PHOTO'], p_asset_type: 'EQUIPMENT', p_store_id: null, p_search: tpl1.name, p_limit: 200, p_offset: 0 });
  const otherIds = (other.data.rows as any[]).map((x) => x.id);
  for (const e of eq) expect(otherIds).not.toContain(e.id);
});

test('先進先出：分次配發、一次跨多個進貨明細，每台設備帶自己那批的保固起算日；配發完再配發回 409', async () => {
  const po = await ordered(items(partB.id, 6, 100), {}, { backdate: '2020-01-01' });
  const it = itemId(po);
  const rA = await recv('purchaser', po, [{ po_item_id: it, delivered_qty: 3, reason: '分批' }], { received_date: '2020-03-01' });
  const rB = await recv('purchaser', rA.po, [{ po_item_id: it, delivered_qty: 3 }], { received_date: '2020-05-01' });
  expect(rB.po.status).toBe('RECEIVED');
  const riA = (await dbReceiptItems(rA.data.id))[0];
  const riB = (await dbReceiptItems(rB.data.id))[0];
  // partB 沒有對應型號：沒選型號回 422（也不會動庫存）
  const b0 = await balance(loc.id, partB.id);
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 1 }), 422, 'TEMPLATE_REQUIRED');
  expect(await balance(loc.id, partB.id)).toBe(b0);
  const d1 = await disp('purchaser', { item: it, store: sid.VW001, qty: 4, tpl: tpl1.id });
  expect(d1.status, JSON.stringify(d1)).toBe(201);
  const starts = d1.data.equipment.map((e: any) => e.warranty_start_date);
  expect(starts).toEqual(['2020-03-01', '2020-03-01', '2020-03-01', '2020-05-01']);
  expect(d1.data.equipment.map((e: any) => e.warranty_end_date)).toEqual(['2021-03-01', '2021-03-01', '2021-03-01', '2021-05-01']);
  expect(d1.data.equipment.map((e: any) => e.source_receipt_item_id)).toEqual([riA.id, riA.id, riA.id, riB.id]);
  expect(Number((await dbReceiptItems(rA.data.id))[0].dispatched_qty)).toBe(3);
  expect(Number((await dbReceiptItems(rB.data.id))[0].dispatched_qty)).toBe(1);
  const ev = (await dbEvents(po.id)).filter((e) => e.event_type === 'dispatch');
  expect(ev[0].payload.distribution).toEqual([{ receipt_item_id: riA.id, received_date: '2020-03-01', quantity: 3 }, { receipt_item_id: riB.id, received_date: '2020-05-01', quantity: 1 }]);
  const d2 = await disp('purchaser', { item: it, store: sid.ZT01, qty: 2, tpl: tpl2.id });
  expect(d2.status).toBe(201);
  expect(d2.data.equipment.map((e: any) => e.warranty_start_date)).toEqual(['2020-05-01', '2020-05-01']);
  expect(d2.data.equipment.every((e: any) => e.warranty_end_date === null)).toBe(true); // tpl2 沒有預設保固
  expect(await balance(loc.id, partB.id)).toBe(b0 - 6);
  expect((await dbEquipBySource(po.id)).length).toBe(6);
  expect(Number((await dbItem(it)).dispatched_qty)).toBe(6);
  expect((await dbDispatches(it)).map((x) => x.quantity)).toEqual([4, 2]);
  const r = await disp('purchaser', { item: it, store: sid.VW001, qty: 1, tpl: tpl1.id });
  expectErr(r, 409, 'NOTHING_TO_DISPATCH');
  expect(await balance(loc.id, partB.id)).toBe(b0 - 6);
});

test('配發超過可配發量、序號重複、庫存不夠、型號取不到資產編號：整筆回復（連已出庫的流水、配發單、進貨已配發量都不留）', async () => {
  const po = await stocked(partA, 2);
  const it = itemId(po);
  const snap = async () => ({
    bal: await balance(loc.id, partA.id), eq: (await dbEquipBySource(po.id)).length, disp: (await dbDispatches(it)).length,
    dq: Number((await dbItem(it)).dispatched_qty), tx: (await txOf(partA.id, loc.id)).length,
  });
  const s0 = await snap();
  const over = await disp('purchaser', { item: it, store: sid.VW001, qty: 3 });
  expectErr(over, 409, 'OVER_DISPATCH', '可配發量 2');
  expect(Number(over.available)).toBe(2);
  expect(await snap()).toEqual(s0);
  // 與既有同型號設備序號重複（不分大小寫）；清單內重複
  await seedEquipment('ZT01', eqCatId, 'RC-DUP', { template_id: tpl1.id, serial_number: 'DUP-1' });
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 2, serials: ['OK-1', 'dup-1'] }), 409, 'SERIAL_DUPLICATE', 'dup-1');
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 2, serials: ['x1', 'X1'] }), 409, 'SERIAL_DUPLICATE', '重複');
  expect(await snap()).toEqual(s0);
  // 庫存被別人調整掉（配發量還在，實際庫存不夠，位置不允許負庫存）
  const adj = await callFn(users.purchaser.client, 'ga_ws_inv_post', {
    p_transaction_type: 'ADJUST_OUT', p_location_id: loc.id, p_part_id: partA.id, p_quantity: await balance(loc.id, partA.id), p_input_unit_type: 'BASE', p_reason: '測試盤點調整', p_notes: null,
    p_idempotency_key: key(), p_occurred_at: null, p_reference_type: null, p_reference_id: null, p_metadata: {},
  });
  expect(adj.ok, JSON.stringify(adj)).toBe(true);
  const s1 = await snap();
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 2 }), 409, 'INSUFFICIENT_STOCK');
  expect(await snap()).toEqual(s1);
  expect((await dbDispatches(it)).length, '配發單也回復').toBe(0);
  // 補回庫存，改試型號取不到資產編號：發生在出庫與配發單寫入之後，也要整筆回復
  await callFn(users.purchaser.client, 'ga_ws_inv_post', {
    p_transaction_type: 'ADJUST_IN', p_location_id: loc.id, p_part_id: partA.id, p_quantity: 5, p_input_unit_type: 'BASE', p_reason: '測試補回', p_notes: null,
    p_idempotency_key: key(), p_occurred_at: null, p_reference_type: null, p_reference_id: null, p_metadata: {},
  });
  const s2 = await snap();
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 2, tpl: tplNoCode.id, reason: '測試換型號' }), 422, 'ASSET_CODE_UNAVAILABLE');
  expect(await snap(), '出庫流水、配發單、設備、已配發量都沒留下').toEqual(s2);
  expect(Number((await dbReceiptItems((await dbReceipts(po.id))[0].id))[0].dispatched_qty)).toBe(0);
});

test('配發規則：數量與識別、門市、品項種類、型號決定（沿用對應、改型號要原因、對應被停用要改選）、來源位置', async () => {
  const po = await stocked(partA, 8);
  const it = itemId(po);
  const common = { item: it, store: sid.VW001 };
  expectErr(await disp('purchaser', { ...common, qty: 0 }), 400, 'INVALID_QUANTITY');
  expectErr(await disp('purchaser', { ...common, qty: 201 }), 400, 'INVALID_QUANTITY');
  expectErr(await disp('purchaser', { ...common, qty: 1.5 }), 400, 'INVALID_QUANTITY');
  expectErr(await fn('purchaser', 'ga_ws_po_dispatch', { p_po_item_id: it, p_store_id: sid.VW001, p_quantity: 1, p_template_id: null, p_template_reason: null, p_source_location_id: null, p_serials: null, p_notes: null, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  expectErr(await disp('purchaser', { ...common, qty: 1, key: 'k'.repeat(65) }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  expectErr(await disp('purchaser', { ...common, qty: 1, serials: ['a', 'b'] }), 400, 'TOO_MANY_SERIALS');
  expectErr(await disp('purchaser', { ...common, qty: 1, serials: { a: 1 } }), 400, 'SERIALS_INVALID');
  expectErr(await disp('purchaser', { ...common, qty: 1, serials: ['x'.repeat(101)] }), 400, 'SERIAL_TOO_LONG');
  expectErr(await disp('purchaser', { ...common, qty: 1, notes: 'x'.repeat(501) }), 400, 'NOTES_TOO_LONG');
  expectErr(await disp('purchaser', { ...common, qty: 1, tpl: tpl2.id, reason: 'x'.repeat(201) }), 400, 'REASON_TOO_LONG');
  expectErr(await disp('purchaser', { item: crypto.randomUUID(), store: sid.VW001, qty: 1 }), 404, 'ITEM_NOT_FOUND');
  expectErr(await disp('purchaser', { item: it, store: crypto.randomUUID(), qty: 1 }), 404, 'STORE_NOT_FOUND');
  expectErr(await disp('purchaser', { ...common, qty: 1, src: loc2.id }), 409, 'NOTHING_TO_DISPATCH', '這個位置');
  expectErr(await disp('purchaser', { ...common, qty: 1, src: crypto.randomUUID() }), 404, 'LOCATION_NOT_FOUND');
  // 型號：料件對應 tpl1；選別的型號要原因
  expectErr(await disp('purchaser', { ...common, qty: 1, tpl: tpl2.id }), 400, 'TEMPLATE_REASON_REQUIRED');
  expectErr(await disp('purchaser', { ...common, qty: 1, tpl: crypto.randomUUID(), reason: '換型號' }), 422, 'TEMPLATE_INVALID');
  const dChange = await disp('purchaser', { ...common, qty: 1, tpl: tpl2.id, reason: '門市實際要的是這一款' });
  expect(dChange.status, JSON.stringify(dChange)).toBe(201);
  expect(dChange.data).toMatchObject({ equipment_template_id: tpl2.id, template_change_reason: '門市實際要的是這一款' });
  expect(dChange.data.equipment[0]).toBeTruthy();
  expect((await db().from('ga_equipment').select('template_id,name').eq('id', dChange.data.equipment[0].id).single()).data).toMatchObject({ template_id: tpl2.id, name: tpl2.name });
  // 選了和對應相同的型號不需要原因
  expect((await disp('purchaser', { ...common, qty: 1, tpl: tpl1.id })).status).toBe(201);
  // 料件對應的型號之後被停用：沒手選要改選；手選其他型號並填原因可以
  const tplOld = await seedEquipmentTemplate(eqCatId, 'RC-T5');
  const partM = await seedPart((await db().from('ga_parts').select('category_id').eq('id', partB.id).single()).data!.category_id, 'RC-M', { equipment_template_id: tplOld.id });
  await seedLocationPart(loc.id, partM.id);
  const poM = await stocked(partM, 2);
  await db().from('ga_equipment_templates').update({ is_active: false }).eq('id', tplOld.id);
  expectErr(await disp('purchaser', { item: itemId(poM), store: sid.VW001, qty: 1 }), 422, 'TEMPLATE_INVALID', '停用');
  expectErr(await disp('purchaser', { item: itemId(poM), store: sid.VW001, qty: 1, tpl: tpl2.id }), 400, 'TEMPLATE_REASON_REQUIRED');
  expect((await disp('purchaser', { item: itemId(poM), store: sid.VW001, qty: 1, tpl: tpl2.id, reason: '原型號已停用，改款' })).status).toBe(201);
  // 品項種類與狀態：直接建設備的品項、還沒到貨的單、只登錄的品項都不能配發
  const poDirect = await ordered([{ item_name: m7Name('直送X'), quantity: 1, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: tpl2.id }]);
  expectErr(await disp('purchaser', { item: itemId(poDirect), store: sid.VW001, qty: 1, tpl: tpl2.id }), 409, 'NOT_DISPATCHABLE', '直接建立設備');
  const poNo = await ordered([{ item_name: m7Name('自由Y'), quantity: 1, unit_price: 100 }]);
  expectErr(await disp('purchaser', { item: itemId(poNo), store: sid.VW001, qty: 1, tpl: tpl2.id }), 409, 'NOT_DISPATCHABLE');
  const poWait = await ordered(items(partA.id, 1, 100));
  expectErr(await disp('purchaser', { item: itemId(poWait), store: sid.VW001, qty: 1 }), 409, 'INVALID_STATE', '還沒有驗入');
  // 料件有採購單位且不允許拆封：配發量必須是整箱（庫存規則照舊），否則整筆擋下並回復；整箱（4 台）可以
  const poBox = await ordered(items(partBox.id, 1, 400, { unit: '箱' }));
  expect((await recv('purchaser', poBox, [full(poBox)])).status).toBe(201);
  const bx0 = await balance(loc.id, partBox.id);
  expect(bx0).toBeGreaterThanOrEqual(4);
  expectErr(await disp('purchaser', { item: itemId(poBox), store: sid.VW001, qty: 3 }), 422, 'UNPACKING_NOT_ALLOWED', '整數倍');
  expect(await balance(loc.id, partBox.id)).toBe(bx0);
  expect(await dbDispatches(itemId(poBox))).toHaveLength(0);
  const dBox = await disp('purchaser', { item: itemId(poBox), store: sid.ZT01, qty: 4 });
  expect(dBox.status, JSON.stringify(dBox)).toBe(201);
  expect(dBox.data.equipment).toHaveLength(4);
  expect(dBox.data.equipment.every((e: any) => Number(e.purchase_amount) === 100), '箱價 400 ÷ 4 = 每台 100').toBe(true);
  // 有設備管理權限的人也一樣可以（只是不需要）
  expect((await disp('purchaser_eq', { ...common, qty: 1 })).status).toBe(201);
});

test('配發冪等與併發：同識別重送回原結果不重複出庫；同識別不同內容 409；兩個人同時配發只有一個成功、不超配', async () => {
  const po = await stocked(partA, 4);
  const it = itemId(po);
  const k = key();
  const a0 = await balance(loc.id, partA.id);
  const first = await disp('purchaser', { item: it, store: sid.VW001, qty: 2, serials: ['IDEM-1', 'IDEM-2'], key: k });
  expect(first.status).toBe(201);
  const again = await disp('purchaser', { item: it, store: sid.VW001, qty: 2, serials: ['IDEM-1', 'IDEM-2'], key: k });
  expect(again.status).toBe(200);
  expect(again.idempotent_replay).toBe(true);
  expect(again.data.id).toBe(first.data.id);
  expect(again.data.equipment.map((e: any) => e.id)).toEqual(first.data.equipment.map((e: any) => e.id));
  expect(await balance(loc.id, partA.id), '只出庫一次').toBe(a0 - 2);
  expect((await dbEquipBySource(po.id)).length).toBe(2);
  expect(await dbDispatches(it)).toHaveLength(1);
  expectErr(await disp('purchaser', { item: it, store: sid.VW001, qty: 1, key: k }), 409, 'IDEMPOTENCY_CONFLICT');
  expectErr(await disp('purchaser', { item: it, store: sid.ZT01, qty: 2, serials: ['IDEM-1', 'IDEM-2'], key: k }), 409, 'IDEMPOTENCY_CONFLICT');
  // 併發：剩 2 台，兩個人各要 2 台
  const [x, y] = await Promise.all([disp('purchaser', { item: it, store: sid.VW001, qty: 2 }), disp('purchaser_eq', { item: it, store: sid.ZT01, qty: 2 })]);
  expect([x.status, y.status].sort(), JSON.stringify([x, y])).toEqual([201, 409]);
  expect(['OVER_DISPATCH', 'NOTHING_TO_DISPATCH']).toContain([x, y].find((r) => r.status === 409)!.code);
  expect(await balance(loc.id, partA.id)).toBe(a0 - 4);
  expect((await dbEquipBySource(po.id)).length).toBe(4);
  expect(Number((await dbItem(it)).dispatched_qty)).toBe(4);
  // 同識別同時送：只配發一次
  const po2 = await stocked(partA, 2);
  const k2 = key();
  const [p, q] = await Promise.all([disp('purchaser', { item: itemId(po2), store: sid.VW001, qty: 2, key: k2 }), disp('purchaser', { item: itemId(po2), store: sid.VW001, qty: 2, key: k2 })]);
  expect([p.status, q.status].sort(), JSON.stringify([p, q])).toEqual([200, 201]);
  expect(p.data.id).toBe(q.data.id);
  expect((await dbEquipBySource(po2.id)).length).toBe(2);
});

// ----------------------------------------------------------------------------- 序號補填
test('序號補填：該門市店長與設備管理權限者可補；已有值要改須原因並留紀錄；同型號不可重複；其他人 403', async () => {
  const po = await stocked(partA, 3);
  const d = await disp('purchaser', { item: itemId(po), store: sid.VW001, qty: 3, serials: ['KEEP-1'] });
  expect(d.status).toBe(201);
  const [e1, e2, e3] = d.data.equipment as any[];
  expect(e1.serial_number).toBe('KEEP-1');
  const set = (who: PoKey, id: string, serial: string, reason: string | null = null) => fn(who, 'ga_ws_onboarding_set_serial', { p_equipment_id: id, p_serial: serial, p_reason: reason });
  // 不能補填的人
  expectErr(await set('storemgr_b', e2.id, 'SN-B'), 403, 'PERMISSION_DENIED');
  expectErr(await set('purchaser', e2.id, 'SN-B'), 403, 'PERMISSION_DENIED');
  expectErr(await set('nobody', e2.id, 'SN-B'), 403, 'PERMISSION_DENIED');
  expectErr(await set('admin', e2.id, 'SN-B'), 403, 'PERMISSION_DENIED');
  expect((await db().from('ga_equipment').select('serial_number').eq('id', e2.id).single()).data!.serial_number).toBeNull();
  // 該門市店長補填（貼標時）
  const ok = await set('storemgr_a', e2.id, ' SN-E2 ');
  expect(ok.status, JSON.stringify(ok)).toBe(200);
  expect(ok.data).toMatchObject({ id: e2.id, serial_number: 'SN-E2', changed: true });
  expect((await db().from('ga_equipment').select('serial_number,updated_by').eq('id', e2.id).single()).data).toMatchObject({ serial_number: 'SN-E2', updated_by: users.storemgr_a.id });
  const evs = ((await db().from('ga_equipment_serial_events').select('*').eq('equipment_id', e2.id)).data || []) as any[];
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ old_serial: null, new_serial: 'SN-E2', reason: null, actor_id: users.storemgr_a.id });
  // 相同內容（不分大小寫）不算變更、不再寫紀錄
  const same = await set('storemgr_a', e2.id, 'sn-e2');
  expect(same.data.changed).toBe(false);
  expect(((await db().from('ga_equipment_serial_events').select('id').eq('equipment_id', e2.id)).data || []).length).toBe(1);
  // 已有序號要改：須原因
  expectErr(await set('storemgr_a', e2.id, 'SN-E2-NEW'), 400, 'REASON_REQUIRED', 'SN-E2');
  const chg = await set('storemgr_a', e2.id, 'SN-E2-NEW', '貼錯了序號');
  expect(chg.data).toMatchObject({ serial_number: 'SN-E2-NEW', changed: true });
  const evs2 = ((await db().from('ga_equipment_serial_events').select('*').eq('equipment_id', e2.id).order('created_at')).data || []) as any[];
  expect(evs2.map((x) => [x.old_serial, x.new_serial, x.reason])).toEqual([[null, 'SN-E2', null], ['SN-E2', 'SN-E2-NEW', '貼錯了序號']]);
  // 同型號序號不可重複（不分大小寫）；別的型號可以用同一個序號
  expectErr(await set('eq_manage', e3.id, 'sn-e2-new'), 409, 'SERIAL_DUPLICATE');
  expectErr(await set('eq_manage', e3.id, 'KEEP-1'), 409, 'SERIAL_DUPLICATE');
  const e4 = await seedEquipment('ZT01', eqCatId, 'RC-OTHER', { template_id: tpl2.id, brand: 'OTHER-BRAND', model: 'OTHER-MODEL' });
  expect((await set('eq_manage', e4.id, 'SN-E2-NEW')).status, '不同型號可以重複').toBe(200);
  // 設備管理權限者可補任何門市
  const byManager = await set('eq_manage', e3.id, 'SN-E3');
  expect(byManager.data).toMatchObject({ serial_number: 'SN-E3', changed: true });
  // 格式與狀態
  expectErr(await set('eq_manage', e3.id, '   '), 400, 'SERIAL_REQUIRED');
  expectErr(await set('eq_manage', e3.id, 'x'.repeat(101)), 400, 'SERIAL_TOO_LONG');
  expectErr(await set('eq_manage', e3.id, 'SN-E3B', 'x'.repeat(201)), 400, 'REASON_TOO_LONG');
  expectErr(await set('eq_manage', crypto.randomUUID(), 'SN-ZZ'), 404, 'NOT_FOUND');
  await db().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', e3.id);
  expectErr(await set('eq_manage', e3.id, 'SN-E3C', '補'), 409, 'INVALID_STATE');
});

// ----------------------------------------------------------------------------- 料件對應型號
test('料件對應設備型號（D14）：啟用中的型號才能設定、可清空、同型號可被多個料件指向；型號被停用後既有對應保留，改別的欄位不受影響', async () => {
  const cat = (await db().from('ga_parts').select('category_id').eq('id', partB.id).single()).data!.category_id as string;
  const tplOn = await seedEquipmentTemplate(eqCatId, 'RC-T6');
  const tplOff = await seedEquipmentTemplate(eqCatId, 'RC-T7', { is_active: false });
  const tplDel = await seedEquipmentTemplate(eqCatId, 'RC-T8', { deleted_at: new Date().toISOString() });
  const p1 = await seedPart(cat, 'RC-MAP1');
  const p2 = await seedPart(cat, 'RC-MAP2');
  const upd = (id: string, patch: Record<string, unknown>) => callFn(users.part_manage.client, 'ga_ws_update_part_guarded', { p_part_id: id, p_patch: patch, p_expected_updated_at: null });
  // 設定（透過料件修改函式）
  const set1 = await upd(p1.id, { equipment_template_id: tplOn.id });
  expect(set1.ok, JSON.stringify(set1)).toBe(true);
  expect(set1.data.equipment_template_id).toBe(tplOn.id);
  expect((await db().from('ga_parts').select('equipment_template_id').eq('id', p1.id).single()).data!.equipment_template_id).toBe(tplOn.id);
  // 同型號可以被另一個料件指向
  expect((await upd(p2.id, { equipment_template_id: tplOn.id })).ok).toBe(true);
  // 停用或已刪除的型號不能新設定
  for (const bad of [tplOff.id, tplDel.id, crypto.randomUUID()]) expectErr(await upd(p2.id, { equipment_template_id: bad }), 422, 'TEMPLATE_INVALID', '設備型號');
  expect((await db().from('ga_parts').select('equipment_template_id').eq('id', p2.id).single()).data!.equipment_template_id, '被擋就維持原對應').toBe(tplOn.id);
  // 型號被停用後，既有對應保留；改其他欄位不受影響（觸發器只在對應變更時檢查）
  await db().from('ga_equipment_templates').update({ is_active: false }).eq('id', tplOn.id);
  const rename = await upd(p1.id, { description: '改說明' });
  expect(rename.ok, JSON.stringify(rename)).toBe(true);
  expect(rename.data.equipment_template_id).toBe(tplOn.id);
  // 可清空
  const clear = await upd(p1.id, { equipment_template_id: null });
  expect(clear.ok).toBe(true);
  expect(clear.data.equipment_template_id).toBeNull();
  // 資料表層：登入者以舊版路徑（PostgREST 直接更新）也一樣被檢查；服務角色寫入同樣被擋
  const viaRest = await users.part_manage.client.from('ga_parts').update({ equipment_template_id: tplOff.id }).eq('id', p2.id).select('id');
  expect(viaRest.error?.message ?? '', 'PostgREST 直接更新也擋').toContain('設備型號');
  const viaAdmin = await db().from('ga_parts').update({ equipment_template_id: tplDel.id }).eq('id', p2.id);
  expect(viaAdmin.error?.message ?? '').toContain('設備型號');
  const insBad = await db().from('ga_parts').insert({ category_id: cat, name: m7Name('RC-MAP3'), base_unit: '個', specs: {}, tags: [], equipment_template_id: tplOff.id });
  expect(insBad.error?.message ?? '', '新增料件時也檢查').toContain('設備型號');
  // 沒有料件管理權限的人不能改對應
  const denied = await callFn(users.purchaser.client, 'ga_ws_update_part_guarded', { p_part_id: p2.id, p_patch: { equipment_template_id: null }, p_expected_updated_at: null });
  expect(denied.ok).toBe(false);
  expect(denied.status).toBe(403);
});

// ----------------------------------------------------------------------------- 資料庫層（BEGIN…ROLLBACK）
function runSqlDo(body: string, tag: string): string {
  const sql = `DO $$\n${body}\nEND $$;`;
  const file = path.join(os.tmpdir(), `g26db-${tag}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const run = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', shell: true });
    return `${run.stdout}\n${run.stderr}`.replace(/\\"/g, '"');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

test('資料庫層（交易內執行、結束一律回復）：整條流程（開單、下訂、到貨、配發）在一個交易內一致；資料表檢查限制擋下不合理的資料；事件表仍不可改刪', async () => {
  test.setTimeout(240_000);
  const uid = users.purchaser.id;
  const balBefore = await balance(loc.id, partA.id);
  const out = runSqlDo(`
DECLARE
  v_uid uuid := '${uid}';
  v_r jsonb; v_po uuid; v_upd timestamptz; v_it uuid; v_rc jsonb; v_d jsonb; v_rid uuid; v_ri uuid;
  n_eq integer; n_tx integer; v_bal numeric; v_disp numeric; v_recv numeric; v_status text;
  c_acc text := 'none'; c_disp text := 'none'; c_qty text := 'none'; c_evt text := 'none'; c_dispq text := 'none'; c_sn text := 'none';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_r := public.ga_ws_po_create(jsonb_build_object('notes', '${m7Name('DB26')}', 'vendor_id', '${vendor.id}', 'receiving_location_id', '${loc.id}'),
    jsonb_build_array(jsonb_build_object('part_id', '${partA.id}', 'quantity', 4, 'unit_price', 100)), 'g26-db-' || gen_random_uuid());
  IF (v_r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'create failed: %', v_r; END IF;
  v_po := (v_r->'data'->>'id')::uuid; v_upd := (v_r->'data'->>'updated_at')::timestamptz; v_it := (v_r->'data'->'items'->0->>'id')::uuid;
  v_r := public.ga_ws_po_action(v_po, 'place_order', v_upd, NULL);
  IF (v_r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'order failed: %', v_r; END IF;
  v_rc := public.ga_ws_po_receive(v_po, '{}'::jsonb, jsonb_build_array(jsonb_build_object('po_item_id', v_it, 'delivered_qty', 4)), 'g26-rc-' || gen_random_uuid());
  IF (v_rc->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'receive failed: %', v_rc; END IF;
  v_rid := (v_rc->'data'->>'id')::uuid;
  SELECT id INTO v_ri FROM public.ga_purchase_receipt_items WHERE receipt_id = v_rid;
  v_d := public.ga_ws_po_dispatch(v_it, '${sid.VW001}', 3, NULL, NULL, NULL, '["DB26-A","DB26-B"]'::jsonb, NULL, 'g26-dp-' || gen_random_uuid());
  IF (v_d->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'dispatch failed: %', v_d; END IF;
  SELECT count(*) INTO n_eq FROM public.ga_equipment WHERE source_purchase_order_id = v_po;
  SELECT count(*) INTO n_tx FROM public.ga_inventory_transactions WHERE reference_id = v_po;
  SELECT quantity_base INTO v_bal FROM public.ga_inventory_balances WHERE location_id = '${loc.id}' AND part_id = '${partA.id}';
  SELECT dispatched_qty INTO v_disp FROM public.ga_purchase_order_items WHERE id = v_it;
  SELECT received_qty INTO v_recv FROM public.ga_purchase_order_items WHERE id = v_it;
  SELECT status INTO v_status FROM public.ga_purchase_orders WHERE id = v_po;
  -- 資料表檢查限制：驗入量不可大於到貨量；已配發量不可超過驗入量；配發數量必須為正；序號紀錄新序號不可空；事件仍不可改刪
  BEGIN UPDATE public.ga_purchase_receipt_items SET accepted_qty = delivered_qty + 1 WHERE id = v_ri; EXCEPTION WHEN OTHERS THEN c_acc := SQLSTATE; END;
  BEGIN UPDATE public.ga_purchase_receipt_items SET dispatched_qty = accepted_base + 1 WHERE id = v_ri; EXCEPTION WHEN OTHERS THEN c_disp := SQLSTATE; END;
  BEGIN UPDATE public.ga_purchase_receipt_items SET rejected_qty = 1 WHERE id = v_ri; EXCEPTION WHEN OTHERS THEN c_qty := SQLSTATE; END;
  BEGIN UPDATE public.ga_stock_dispatches SET quantity = 0 WHERE po_item_id = v_it; EXCEPTION WHEN OTHERS THEN c_dispq := SQLSTATE; END;
  BEGIN INSERT INTO public.ga_equipment_serial_events (equipment_id, new_serial) VALUES ((SELECT id FROM public.ga_equipment WHERE source_purchase_order_id = v_po LIMIT 1), NULL); EXCEPTION WHEN OTHERS THEN c_sn := SQLSTATE; END;
  BEGIN DELETE FROM public.ga_purchase_order_events WHERE po_id = v_po AND event_type = 'dispatch'; EXCEPTION WHEN OTHERS THEN c_evt := SQLSTATE; END;
  RAISE EXCEPTION 'G26DB:eq=%,tx=%,bal=%,disp=%,recv=%,status=%,acc=%,dsp=%,qty=%,evt=%,dq=%,sn=%:END', n_eq, n_tx, v_bal, v_disp, v_recv, v_status, c_acc, c_disp, c_qty, c_evt, c_dispq, c_sn;`, 'flow');
  const m = /G26DB:([^:]*?):END/.exec(out);
  expect(m, out.slice(0, 1500)).not.toBeNull();
  const v = Object.fromEntries(m![1].split(',').map((kv) => kv.split('=')));
  expect(v).toMatchObject({ eq: '3', tx: '2', disp: '3.0000', recv: '4.0000', status: 'RECEIVED', acc: '23514', dsp: '23514', qty: '23514', evt: 'GA002', dq: '23514', sn: '23502' });
  expect(Number(v.bal), '交易內庫存 = 交易前 + 到貨 4 − 配發 3').toBe(balBefore + 1);
  // 整個交易已回復：沒有留下這張測試採購單、進貨、配發、設備、流水
  const left = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', `${m7Name('DB26')}%`);
  expect(left.count).toBe(0);
  const eqLeft = await db().from('ga_equipment').select('id', { count: 'exact', head: true }).like('serial_number', 'DB26-%');
  expect(eqLeft.count).toBe(0);
  const dd = await db().from('ga_stock_dispatches').select('id', { count: 'exact', head: true }).eq('created_by', uid).like('notes', `${m7Name('DB26')}%`);
  expect(dd.count).toBe(0);
  expect(await balance(loc.id, partA.id), '回復後庫存與交易前相同').toBe(balBefore);
});
