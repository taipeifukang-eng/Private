import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { adminDb, callFn, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedPart, assertGaBaseline, stores } from '../support/m7m8-fixtures';
import { anonClient, PERM, setupPoUsers, seedRequest, seedReview, seedVendor, taipeiToday, type PoKey, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G25（資料庫層）採購單 RPC 整合：ga_ws_po_create／update／from_review／action／get／list／price_history／vendor_options／settings／request_remaining。
// 涵蓋：權限矩陣（未登入、缺任一個權限講清楚、核准人只需核准權限、管理員不繞過、part.manage 可代替料件查看）、建單驗證與 DB 回讀（金額、稅額、單號、事件）、固定識別冪等與衝突、
//      供應商規則（只能選已建好且合作中的供應商、下訂快照、廠商改名後不變、帳務欄位依權限遮蔽）、核准門檻（剛好 5000 免、5001 要）、核准人限制（開單人、最後送核准人）、駁回須原因並退回草稿再送、
//      下訂後鎖定、取消與短收結案規則、版本衝突、需求量加總與超量原因（含單位換算、維修單擋、已取消釋放、併發）、由評估產生草稿、歷史價、清單分頁與搜尋跳脫與精確統計、設定與稽核、
//      以及 BEGIN…ROLLBACK 的資料庫層測試（事件不可改刪、單號擴位、舊版收貨並存保護）。
// 測試資料：名稱與備註一律帶 [自動測試]M7M8 標記、只用 VW／ZT 測試門市；結束只清自己的（cleanupM7M8 含 ga_dev_cleanup_m7m8_purchasing）。
test.describe.configure({ mode: 'serial' });

const root = path.resolve(__dirname, '..', '..');
const KEYS: PoKey[] = ['purchaser', 'purchaser2', 'purchaser_vendor', 'purchaser_vendor_manage', 'approver', 'approver2', 'purchaser_approver', 'review_only', 'stock_only', 'part_only', 'no_partview', 'no_review', 'no_txn', 'part_manage', 'viewer', 'nobody', 'admin'];
let users: Record<string, PoUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let part: any;
let part2: any;
let loc: any;
let vendor: any;
let eqTemplate: any;
let originalSettings: any[] = [];
let seq = 0;
const key = () => crypto.randomUUID();
const db = () => adminDb();
const fn = (who: PoKey, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const items = (partId: string, qty: number, price: number, extra: Record<string, unknown> = {}) => [{ part_id: partId, quantity: qty, unit_price: price, ...extra }];
const header = (over: Record<string, unknown> = {}) => ({ notes: m7Name(`PO${(seq += 1)}`), vendor_id: vendor.id, receiving_location_id: loc.id, ...over });
/** 建一張草稿採購單（預設 purchaser、一個庫存品項）；失敗就丟錯。 */
async function mk(who: PoKey, its: unknown, h: Record<string, unknown> = {}) {
  const r = await fn(who, 'ga_ws_po_create', { p_header: header(h), p_items: its, p_create_key: key() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
}
const act = (who: PoKey, po: any, action: string, note: string | null = null, expected: string = po.updated_at) =>
  fn(who, 'ga_ws_po_action', { p_id: po.id, p_action: action, p_expected_updated_at: expected, p_note: note });
/** 走到下一步並回傳新的單；失敗丟錯。 */
async function step(who: PoKey, po: any, action: string, note: string | null = null) {
  const r = await act(who, po, action, note);
  expect(r.ok, `${action}: ${JSON.stringify(r)}`).toBe(true);
  return r.data as any;
}
/** 一張已下訂的單（含稅總額 ≤ 門檻）。 */
const ordered = async (who: PoKey = 'purchaser', its: unknown = items(part.id, 1, 100), h: Record<string, unknown> = {}) => step(who, await mk(who, its, h), 'place_order');
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbItems = async (id: string) => ((await db().from('ga_purchase_order_items').select('*').eq('po_id', id).order('line_no')).data || []) as any[];
const dbEvents = async (id: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', id).order('created_at').order('id')).data || []) as any[];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  const cat = await seedCategory('part', 'PO');
  part = await seedPart(cat.id, 'PO-P1', { purchase_unit: '箱', purchase_to_base_rate: 12 });
  part2 = await seedPart(cat.id, 'PO-P2');
  loc = await seedLocation(null, 'PO-W');
  vendor = await seedVendor('A');
  const eqCat = await seedCategory('equipment', 'POE');
  eqTemplate = await seedEquipmentTemplate(eqCat.id, 'PO-T');
  originalSettings = ((await db().from('ga_workflow_settings').select('*')).data || []) as any[];
});
test.afterAll(async () => {
  // 還原設定（測試可能調整過門檻與稅率）
  for (const s of originalSettings) await db().from('ga_workflow_settings').update({ value_num: s.value_num, value_text: s.value_text }).eq('key', s.key);
  expect(await cleanupM7M8(), '清除總務測試資料（含採購單與測試供應商）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const left = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8 T%');
  expect(left.count, '採購單殘留').toBe(0);
});

// ----------------------------------------------------------------------------- 權限矩陣
test('權限矩陣（讀）：未登入全部拒絕；看得到採購單的是採購評估檢視、管理與核准人；其他一律 403', async () => {
  const anon = anonClient();
  for (const [name, args] of [
    ['ga_ws_po_list', {}], ['ga_ws_po_get', { p_id: crypto.randomUUID() }], ['ga_ws_po_settings_get', {}], ['ga_ws_po_vendor_options', {}],
    ['ga_ws_po_price_history', { p_part_id: part.id }], ['ga_ws_po_request_remaining', { p_request_id: crypto.randomUUID() }],
    ['ga_ws_po_create', { p_header: {}, p_items: [], p_create_key: 'x' }], ['ga_ws_po_action', { p_id: crypto.randomUUID(), p_action: 'submit', p_expected_updated_at: new Date().toISOString() }],
    ['ga_ws_po_update', { p_id: crypto.randomUUID(), p_header: {}, p_items: null, p_expected_updated_at: new Date().toISOString() }], ['ga_ws_po_from_review', { p_review_id: crypto.randomUUID() }],
    ['ga_ws_po_settings_set', { p_values: {}, p_expected_updated_at: new Date().toISOString() }],
  ] as [string, Record<string, unknown>][]) {
    const r = await callFn(anon, name, args);
    expect(r.ok, `${name} 未登入`).toBe(false);
    expect([0, 401], `${name} 未登入`).toContain(r.status);
  }
  // 內部輔助函式不開放給登入者直接呼叫
  for (const name of ['ga_next_po_no', 'ga_po_data', 'ga_po_perm_error', 'ga_po_insert', 'ga_dev_cleanup_m7m8_purchasing']) {
    const r = await callFn(users.purchaser.client, name, name === 'ga_po_data' || name === 'ga_po_perm_error' ? { p_id: crypto.randomUUID(), p_uid: users.purchaser.id } : {});
    expect(r.ok === false || r.status === 0, `${name} 不可被登入者呼叫`).toBe(true);
  }
  const po = await mk('purchaser', items(part.id, 1, 100));
  const canView: PoKey[] = ['purchaser', 'purchaser_vendor', 'approver', 'approver2', 'purchaser_approver', 'review_only', 'no_partview', 'no_review', 'no_txn', 'part_manage', 'viewer'].filter((k) => k !== 'no_review') as PoKey[];
  for (const k of [...canView, 'no_review'] as PoKey[]) {
    // no_review 只有庫存過帳與料件查看：沒有採購評估權限也不是核准人 → 看不到
    const expectView = k !== 'no_review';
    const list = await fn(k, 'ga_ws_po_list', {});
    const get = await fn(k, 'ga_ws_po_get', { p_id: po.id });
    const st = await fn(k, 'ga_ws_po_settings_get', {});
    expect(list.status, `${k} list`).toBe(expectView ? 200 : 403);
    expect(get.status, `${k} get`).toBe(expectView ? 200 : 403);
    expect(st.status, `${k} settings`).toBe(expectView ? 200 : 403);
  }
  for (const k of ['stock_only', 'part_only', 'nobody', 'admin'] as PoKey[]) {
    for (const [name, args] of [['ga_ws_po_list', {}], ['ga_ws_po_get', { p_id: po.id }], ['ga_ws_po_vendor_options', {}], ['ga_ws_po_price_history', { p_part_id: part.id }]] as [string, Record<string, unknown>][]) {
      const r = await fn(k, name, args);
      expect(r.status, `${k} ${name}`).toBe(403);
      expect(r.code).toBe('PERMISSION_DENIED');
    }
  }
  // 待簽核清單只有核准人看得到（採購人員也不行）
  expect((await fn('approver', 'ga_ws_po_list', { p_filters: { approvals: true } })).status).toBe(200);
  expect((await fn('approver2', 'ga_ws_po_list', { p_filters: { approvals: true } })).status).toBe(200);
  for (const k of ['purchaser', 'viewer', 'purchaser_vendor'] as PoKey[]) {
    const r = await fn(k, 'ga_ws_po_list', { p_filters: { approvals: true } });
    expect(r.status, k).toBe(403);
    expect(r.code).toBe('APPROVE_PERMISSION_REQUIRED');
  }
});

test('權限矩陣（寫）：三個權限缺哪個講清楚；核准權限不能代替；管理員（profiles.role = admin）不繞過；part.manage 可代替料件查看', async () => {
  const body = { p_header: header(), p_items: items(part.id, 1, 100) };
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
  ];
  const po = await mk('purchaser', items(part.id, 1, 100));
  const countNow = async () => (await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8 T%')).count;
  const c0 = await countNow();
  for (const [who, code, missing] of cases) {
    const r = await fn(who, 'ga_ws_po_create', { ...body, p_create_key: key() });
    expect(r.status, `${who} create`).toBe(403);
    expect(r.code, `${who} create`).toBe(code);
    expect(r.error, `${who} create`).toContain(`您缺少：${missing}`);
    // 動作與修改同一套權限語意
    for (const a of ['submit', 'place_order', 'cancel', 'withdraw', 'revoke_approval', 'short_close', 'close']) {
      const x = await act(who, po, a, '原因');
      expect(x.status, `${who} ${a}`).toBe(403);
      expect(x.error, `${who} ${a}`).toContain('您缺少：');
    }
    const u = await fn(who, 'ga_ws_po_update', { p_id: po.id, p_header: { notes: m7Name('x') }, p_items: null, p_expected_updated_at: po.updated_at });
    expect(u.status, `${who} update`).toBe(403);
  }
  // 沒有寫入：DB 回讀仍是原本一張草稿，沒有新增任何採購單
  expect((await dbPo(po.id)).status).toBe('DRAFT');
  expect(await countNow()).toBe(c0);
  // part.manage 可代替料件查看；核准人以外的帳號不能核准或調整設定
  const ok = await fn('part_manage', 'ga_ws_po_create', { ...body, p_create_key: key() });
  expect(ok.status).toBe(201);
  const noApprove = await act('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'approve');
  expect(noApprove.status).toBe(403);
  expect(noApprove.code).toBe('APPROVE_PERMISSION_REQUIRED');
  const setting = await fn('purchaser', 'ga_ws_po_settings_set', { p_values: { approval_threshold: 9000 }, p_expected_updated_at: new Date().toISOString() });
  expect(setting.status).toBe(403);
  expect(setting.code).toBe('APPROVE_PERMISSION_REQUIRED');
  // 持核准權限但沒有三個權限：不能開單、不能下訂
  expect((await fn('approver', 'ga_ws_po_create', { ...body, p_create_key: key() })).status).toBe(403);
});

// ----------------------------------------------------------------------------- 建單
test('建單：回傳與 DB 回讀一致（單號台北日期、金額稅額、品項、事件）；預設處理方式；單位換算', async () => {
  const day = taipeiToday();
  const before = Date.now();
  const r = await fn('purchaser', 'ga_ws_po_create', {
    p_header: header({ expected_delivery_date: '2038-02-01' }),
    p_items: [{ part_id: part.id, quantity: 2, unit: '箱', unit_price: 1000.5, notes: ' 備品 ' }, { item_name: ` ${m7Name('自由品名')} `, quantity: 3, unit_price: 0.3333, unit: '張' }],
    p_create_key: key(),
  });
  expect(r.status).toBe(201);
  expect(r.replay).toBe(false);
  const po = r.data;
  expect(po.po_no).toMatch(new RegExp(`^PO-${day}-\\d{3,}$`));
  expect(po).toMatchObject({ status: 'DRAFT', status_label: '草稿', vendor_id: vendor.id, receiving_location_id: loc.id, expected_delivery_date: '2038-02-01', created_by: users.purchaser.id });
  // 小計：round(2 × 1000.5) = 2001 加 round(3 × 0.3333) = 1 → 2002；稅 round(100.1) = 100；含稅 2102
  expect([po.subtotal, po.tax_amount, po.total_amount].map(Number)).toEqual([2002, 100, 2102]);
  expect(Number(po.tax_rate)).toBe(0.05);
  expect(po.approval_required).toBe(false);
  expect(po.items).toHaveLength(2);
  const row = await dbPo(po.id);
  expect(row).toMatchObject({ po_no: po.po_no, status: 'DRAFT', created_by: users.purchaser.id, updated_by: users.purchaser.id });
  expect([row.subtotal, row.tax_amount, row.total_amount].map(Number)).toEqual([2002, 100, 2102]);
  const its = await dbItems(po.id);
  expect(its.map((i) => i.line_no)).toEqual([1, 2]);
  expect(its[0]).toMatchObject({ part_id: part.id, unit: '箱', fulfil_mode: 'STOCK', notes: '備品' });
  expect([its[0].quantity, its[0].quantity_base, its[0].unit_price, its[0].line_amount].map(Number)).toEqual([2, 24, 1000.5, 2001]);
  expect(its[1]).toMatchObject({ part_id: null, item_name: m7Name('自由品名'), unit: '張', fulfil_mode: 'NO_STOCK' });
  expect([its[1].quantity_base, its[1].line_amount].map(Number)).toEqual([3, 1]);
  const ev = await dbEvents(po.id);
  expect(ev.map((e) => [e.event_type, e.from_status, e.to_status, e.actor_id])).toEqual([['create', null, 'DRAFT', users.purchaser.id]]);
  expect(Date.parse(ev[0].created_at)).toBeGreaterThan(before - 60_000);
  // 單號是遞增的流水
  const po2 = await mk('purchaser', items(part.id, 1, 100));
  const n = (no: string) => Number(no.split('-')[2]);
  expect(n(po2.po_no)).toBe(n(po.po_no) + 1);
  // get 回傳同一份資料
  const got = await fn('viewer', 'ga_ws_po_get', { p_id: po.id });
  expect(got.data.items).toHaveLength(2);
  expect(got.data.events.map((e: any) => e.event_type)).toEqual(['create']);
  expect(got.data).toHaveProperty('created_by_name');
});

test('建單驗證（400／404／409／422）：每個錯誤都是白話、而且沒有寫入任何資料', async () => {
  const baseCount = async () => (await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8 T%')).count;
  const c0 = await baseCount();
  const create = (h: Record<string, unknown>, its: unknown, k: string | null = key()) => fn('purchaser', 'ga_ws_po_create', { p_header: h, p_items: its, p_create_key: k });
  const ok = items(part.id, 1, 100);
  const bad: [string, any, number, string][] = [
    ['缺識別碼', await create(header(), ok, null), 400, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['品項不是清單', await create(header(), { a: 1 }), 400, 'ITEMS_INVALID'],
    ['品項是空清單', await create(header(), []), 400, 'ITEMS_REQUIRED'],
    ['51 個品項', await create(header(), Array.from({ length: 51 }, () => ok[0])), 400, 'TOO_MANY_ITEMS'],
    ['數量 0', await create(header(), items(part.id, 0, 100)), 400, 'INVALID_QUANTITY'],
    ['數量 5 位小數', await create(header(), items(part.id, 1.23456 as any, 100)), 400, 'INVALID_QUANTITY'],
    ['單價負數', await create(header(), items(part.id, 1, -1)), 400, 'INVALID_PRICE'],
    ['單位不合', await create(header(), items(part.id, 1, 100, { unit: '桶' })), 422, 'INVALID_UNIT'],
    ['沒有料件也沒有品名', await create(header(), [{ quantity: 1, unit_price: 1 }]), 400, 'ITEM_NAME_REQUIRED'],
    ['入庫沒有料件', await create(header(), [{ item_name: m7Name('x'), quantity: 1, unit_price: 1, fulfil_mode: 'STOCK' }]), 422, 'STOCK_NEEDS_PART'],
    ['處理方式錯誤', await create(header(), items(part.id, 1, 1, { fulfil_mode: 'MAGIC' })), 400, 'INVALID_FULFIL_MODE'],
    ['直接建設備沒有門市', await create(header(), items(part.id, 1, 1, { fulfil_mode: 'DIRECT_ASSET' })), 400, 'TARGET_STORE_REQUIRED'],
    ['直接建設備數量不是整數', await create(header(), [{ item_name: m7Name('tv'), quantity: 1.5, unit_price: 1, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01 }]), 422, 'ASSET_QUANTITY_INTEGER'],
    ['直接建設備型號不存在', await create(header(), [{ item_name: m7Name('tv'), quantity: 1, unit_price: 1, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: crypto.randomUUID() }]), 422, 'TEMPLATE_INVALID'],
    ['料件不存在', await create(header(), items(crypto.randomUUID(), 1, 1)), 404, 'PART_NOT_FOUND'],
    ['供應商不存在', await create(header({ vendor_id: crypto.randomUUID() }), ok), 422, 'VENDOR_NOT_FOUND'],
    ['日期格式', await create(header({ expected_delivery_date: '12/01' }), ok), 400, 'INVALID_DATE'],
    ['日期不存在', await create(header({ expected_delivery_date: '2038-02-30' }), ok), 400, 'INVALID_DATE'],
    ['收貨位置不存在', await create(header({ receiving_location_id: crypto.randomUUID() }), ok), 404, 'LOCATION_NOT_FOUND'],
    ['備註過長', await create(header({ notes: m7Name('x'.repeat(1001)) }), ok), 400, 'NOTES_TOO_LONG'],
    ['需求單不存在', await create(header(), items(part.id, 1, 1, { request_id: crypto.randomUUID() })), 404, 'REQUEST_NOT_FOUND'],
  ];
  for (const [what, r, status, code] of bad) {
    expect(r.ok, what).toBe(false);
    expect(r.status, what).toBe(status);
    expect(r.code, what).toBe(code);
    expect(typeof r.error, what).toBe('string');
    expect(r.error as string, what).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
  }
  expect(await baseCount(), '失敗的建單沒有留下任何資料').toBe(c0);
  // 停用的料件、已停用或暫停的供應商、已停用的收貨位置
  const cat = await seedCategory('part', 'PO-INACT');
  const dead = await seedPart(cat.id, 'PO-DEAD', { is_active: false });
  expect((await create(header(), items(dead.id, 1, 1))).code).toBe('PART_INACTIVE');
  const paused = await seedVendor('P', { status: 'paused' });
  const inactive = await seedVendor('I', { status: 'inactive' });
  expect((await create(header({ vendor_id: paused.id }), ok)).code).toBe('VENDOR_INACTIVE');
  expect((await create(header({ vendor_id: inactive.id }), ok)).code).toBe('VENDOR_INACTIVE');
  const off = await seedLocation(null, 'PO-OFF', { is_active: false });
  expect((await create(header({ receiving_location_id: off.id }), ok)).code).toBe('LOCATION_INACTIVE');
  expect(await baseCount()).toBe(c0);
  // 直接建設備：型號與門市有效就能存；沒有型號對應（料件沒有設定）時，送核准或下訂前必須選型號
  const direct = await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: [{ part_id: part.id, quantity: 2, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01 }], p_create_key: key() });
  expect(direct.status).toBe(201);
  expect((await dbItems(direct.data.id))[0]).toMatchObject({ fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: null });
  const noTpl = await act('purchaser', direct.data, 'place_order');
  expect([noTpl.status, noTpl.code]).toEqual([422, 'TEMPLATE_REQUIRED']);
  const withTpl = await fn('purchaser', 'ga_ws_po_update', { p_id: direct.data.id, p_header: {}, p_items: [{ part_id: part.id, quantity: 2, unit_price: 100, fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.ZT01, equipment_template_id: eqTemplate.id }], p_expected_updated_at: direct.data.updated_at });
  expect(withTpl.status).toBe(200);
  expect((await step('purchaser', withTpl.data, 'place_order')).status).toBe('ORDERED');
  // 草稿可以沒有供應商與到貨位置，但送核准或下訂前必須補齊
  const draft = await mk('purchaser', items(part.id, 1, 100), { vendor_id: null, receiving_location_id: null });
  expect(draft.vendor_id).toBeNull();
  const ord = await act('purchaser', draft, 'place_order');
  expect(ord.status).toBe(422);
  expect(ord.code).toBe('VENDOR_REQUIRED');
});

test('固定識別（冪等）：同一識別重送回原單、不重複建立；內容不同回 409', async () => {
  const k = key();
  const h = header();
  const its = items(part.id, 1, 100);
  const a = await fn('purchaser', 'ga_ws_po_create', { p_header: h, p_items: its, p_create_key: k });
  const b = await fn('purchaser', 'ga_ws_po_create', { p_header: h, p_items: its, p_create_key: k });
  expect([a.status, b.status]).toEqual([201, 200]);
  expect(b.replay).toBe(true);
  expect(b.data.id).toBe(a.data.id);
  const c = await fn('purchaser', 'ga_ws_po_create', { p_header: h, p_items: items(part.id, 2, 100), p_create_key: k });
  expect(c.status).toBe(409);
  expect(c.code).toBe('IDEMPOTENCY_CONFLICT');
  const rows = await db().from('ga_purchase_orders').select('id').eq('create_key', k);
  expect(rows.data).toHaveLength(1);
  // 不同帳號可以用同一個識別字串（識別只在自己的範圍內）
  const other = await fn('purchaser2', 'ga_ws_po_create', { p_header: header(), p_items: its, p_create_key: k });
  expect(other.status).toBe(201);
  expect(other.data.id).not.toBe(a.data.id);
});

test('併發：同時建單的單號不重複、依序遞增；同一識別同時送出只建立一張', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => fn(i % 2 ? 'purchaser' : 'purchaser2', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 1, 100), p_create_key: key() })));
  expect(results.every((r) => r.ok)).toBe(true);
  const nos = results.map((r) => r.data.po_no as string).sort();
  expect(new Set(nos).size).toBe(6);
  const nums = nos.map((n) => Number(n.split('-')[2]));
  expect(Math.max(...nums) - Math.min(...nums)).toBe(5);
  const k = key();
  const h = header();
  const same = await Promise.all(Array.from({ length: 4 }, () => fn('purchaser', 'ga_ws_po_create', { p_header: h, p_items: items(part.id, 1, 100), p_create_key: k })));
  expect(same.every((r) => r.ok)).toBe(true);
  expect(new Set(same.map((r) => r.data.id)).size).toBe(1);
  expect(same.filter((r) => r.status === 201)).toHaveLength(1);
});

// ----------------------------------------------------------------------------- 供應商
test('供應商：下訂寫入名稱、統編、付款條件快照；廠商改名與改統編後舊單不變；帳務欄位依廠商權限遮蔽', async () => {
  const v = await seedVendor('SNAP', { tax_id: '87654321', payment_terms: '月結 45 天' });
  const po = await mk('purchaser', items(part.id, 1, 100), { vendor_id: v.id });
  // 下訂前：快照還沒寫（採購人員沒有廠商權限，看不到統編）
  expect((await dbPo(po.id)).vendor_name_snapshot).toBeNull();
  const draftView = await fn('purchaser_vendor', 'ga_ws_po_get', { p_id: po.id });
  expect(draftView.data).toMatchObject({ vendor_name: v.name, vendor_tax_id: '87654321', vendor_payment_terms: '月結 45 天', vendor_billing_visible: true });
  const o = await step('purchaser', po, 'place_order');
  expect(await dbPo(po.id)).toMatchObject({ status: 'ORDERED', vendor_name_snapshot: v.name, vendor_tax_id_snapshot: '87654321', vendor_payment_terms_snapshot: '月結 45 天', ordered_by: users.purchaser.id });
  expect(o.vendor_name).toBe(v.name);
  // 廠商改名、改統編、停用之後，舊單快照不變
  await db().from('ga_vendors').update({ name: m7Name('V-SNAP-改名'), tax_id: '11112222', payment_terms: '現金', status: 'inactive' }).eq('id', v.id);
  const withBilling = await fn('purchaser_vendor', 'ga_ws_po_get', { p_id: po.id });
  expect(withBilling.data).toMatchObject({ vendor_name: v.name, vendor_current_name: m7Name('V-SNAP-改名'), vendor_tax_id: '87654321', vendor_payment_terms: '月結 45 天', vendor_current_status: 'inactive' });
  const manage = await fn('purchaser_vendor_manage', 'ga_ws_po_get', { p_id: po.id });
  expect(manage.data.vendor_tax_id).toBe('87654321');
  // 沒有廠商檢視或管理權限：只有名稱，統編與付款條件（含快照）整個沒有
  for (const who of ['purchaser', 'approver', 'viewer', 'part_manage'] as PoKey[]) {
    const g = await fn(who, 'ga_ws_po_get', { p_id: po.id });
    expect(g.data, who).toMatchObject({ vendor_name: v.name, vendor_tax_id: null, vendor_payment_terms: null, vendor_billing_visible: false });
    const text = JSON.stringify(g);
    expect(text, who).not.toContain('87654321');
    expect(text, who).not.toContain('11112222');
    expect(text, who).not.toContain('月結 45 天');
    expect(text, who).not.toContain('vendor_tax_id_snapshot');
    const l = await fn(who, 'ga_ws_po_list', { p_filters: { q: v.name.slice(-6) } });
    expect(JSON.stringify(l), who).not.toContain('87654321');
  }
  // 供應商選項：只列合作中（active），帳務欄位同樣依權限
  const optsAll = await fn('purchaser', 'ga_ws_po_vendor_options', { p_q: m7Name('V-') });
  expect(optsAll.status).toBe(200);
  const names = optsAll.data.map((x: any) => x.name);
  expect(names).toContain(vendor.name);
  expect(names).not.toContain(m7Name('V-SNAP-改名'));
  expect(optsAll.data.every((x: any) => x.tax_id === null && x.payment_terms === null)).toBe(true);
  expect(optsAll.billing_visible).toBe(false);
  const optsBilling = await fn('purchaser_vendor', 'ga_ws_po_vendor_options', { p_q: vendor.name });
  expect(optsBilling.data.find((x: any) => x.id === vendor.id)).toMatchObject({ tax_id: '12345678', payment_terms: '月結 30 天' });
  expect(optsBilling.billing_visible).toBe(true);
  expect((await fn('purchaser', 'ga_ws_po_vendor_options', { p_page_size: 1000 })).page_size).toBe(100);
  // 沒有名字相符的搜尋、% 與 _ 不當萬用字元
  expect((await fn('purchaser', 'ga_ws_po_vendor_options', { p_q: '%' })).total).toBe(0);
  expect((await fn('purchaser', 'ga_ws_po_vendor_options', { p_q: 'V_A' })).total).toBe(0);
  // 停用後，草稿改選這個供應商會被擋；已有草稿在下訂時也會被擋
  const draft = await mk('purchaser', items(part.id, 1, 100), { vendor_id: vendor.id });
  await db().from('ga_vendors').update({ status: 'paused' }).eq('id', vendor.id);
  try {
    const blocked = await act('purchaser', draft, 'place_order');
    expect(blocked.status).toBe(422);
    expect(blocked.code).toBe('VENDOR_INACTIVE');
    expect((await dbPo(draft.id)).status).toBe('DRAFT');
  } finally {
    await db().from('ga_vendors').update({ status: 'active' }).eq('id', vendor.id);
  }
});

// ----------------------------------------------------------------------------- 核准門檻與核准人
test('核准門檻：含稅總額剛好 5000 免核准（不能送核准、可直接下訂）；5001 必須核准才能下訂；門檻在送核准時快照', async () => {
  const exact = await mk('purchaser', items(part.id, 1, 4762));
  expect([exact.subtotal, exact.tax_amount, exact.total_amount].map(Number)).toEqual([4762, 238, 5000]);
  expect(exact.approval_required).toBe(false);
  const noNeed = await act('purchaser', exact, 'submit');
  expect(noNeed.status).toBe(409);
  expect(noNeed.code).toBe('NO_APPROVAL_NEEDED');
  expect((await dbPo(exact.id)).status).toBe('DRAFT');
  const done = await step('purchaser', exact, 'place_order');
  expect(done.status).toBe('ORDERED');
  expect(done.approval_threshold_snapshot).toBeNull();

  const over = await mk('purchaser', items(part.id, 1, 4763));
  expect(Number(over.total_amount)).toBe(5001);
  expect(over.approval_required).toBe(true);
  const early = await act('purchaser', over, 'place_order');
  expect(early.status).toBe(409);
  expect(early.code).toBe('APPROVAL_REQUIRED');
  expect((await dbPo(over.id)).status).toBe('DRAFT');
  const sub = await step('purchaser', over, 'submit');
  expect(sub).toMatchObject({ status: 'PENDING_APPROVAL', status_label: '待核准', submitted_by: users.purchaser.id, approval_required: true });
  expect(Number(sub.approval_threshold_snapshot)).toBe(5000);
  // 待核准不能直接下訂
  const pend = await act('purchaser', sub, 'place_order');
  expect(pend.status).toBe(409);
  expect(pend.code).toBe('INVALID_STATE');
  const approved = await step('approver', sub, 'approve', '同意');
  expect(approved).toMatchObject({ status: 'APPROVED', approved_by: users.approver.id, approval_note: '同意' });
  const placed = await step('purchaser', approved, 'place_order');
  expect(placed.status).toBe('ORDERED');
  const ev = await dbEvents(over.id);
  expect(ev.map((e) => [e.event_type, e.from_status, e.to_status, e.actor_id])).toEqual([
    ['create', null, 'DRAFT', users.purchaser.id], ['submit', 'DRAFT', 'PENDING_APPROVAL', users.purchaser.id],
    ['approve', 'PENDING_APPROVAL', 'APPROVED', users.approver.id], ['place_order', 'APPROVED', 'ORDERED', users.purchaser.id],
  ]);
  expect(ev[1].payload).toMatchObject({ total_amount: 5001, threshold: 5000 });
  // 多品項加總也算：兩個品項各 3000 未稅 → 含稅 6300 要核准
  const multi = await mk('purchaser', [...items(part.id, 1, 3000), ...items(part2.id, 1, 3000)]);
  expect(Number(multi.total_amount)).toBe(6300);
  expect(multi.approval_required).toBe(true);
});

test('核准人限制：不能核准或駁回自己開的單，也不能核准自己最後送出的單；管理員不繞過；兩個核准人只有一人成功', async () => {
  // 1. 同時持有開單三權限與核准權限的人：自己開的單自己不能核准或駁回
  const own = await step('purchaser_approver', await mk('purchaser_approver', items(part.id, 1, 6000)), 'submit');
  for (const a of ['approve', 'reject']) {
    const r = await act('purchaser_approver', own, a, '我自己來');
    expect(r.status, a).toBe(403);
    expect(r.code, a).toBe('SELF_APPROVAL');
    expect(r.error, a).toContain('開單人');
  }
  expect((await dbPo(own.id)).status).toBe('PENDING_APPROVAL');
  // 2. 別人開、他送核准：送核准的人（持核准權限）也不能核准
  const made = await mk('purchaser', items(part.id, 1, 6000));
  const submitted = await step('purchaser_approver', made, 'submit');
  expect(submitted.submitted_by).toBe(users.purchaser_approver.id);
  const sub = await act('purchaser_approver', submitted, 'approve');
  expect(sub.status).toBe(403);
  expect(sub.code).toBe('SELF_APPROVAL');
  expect(sub.error).toContain('最後一次送核准');
  // 3. 管理員（profiles.role = admin）沒有核准權限：不繞過；沒有權限的人一律 403
  for (const who of ['admin', 'purchaser', 'nobody', 'viewer', 'purchaser_vendor'] as PoKey[]) {
    const r = await act(who, submitted, 'approve');
    expect(r.status, who).toBe(403);
  }
  // 4. 一般核准人可以；同時兩個核准人，只有一個成功，另一個 409
  const [a, b] = await Promise.all([act('approver', submitted, 'approve', 'A'), act('approver2', submitted, 'approve', 'B')]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const loser = a.ok ? b : a;
  expect(['STALE', 'INVALID_STATE']).toContain(loser.code);
  const row = await dbPo(submitted.id);
  expect(row.status).toBe('APPROVED');
  expect([users.approver.id, users.approver2.id]).toContain(row.approved_by);
  const approveEvents = (await dbEvents(submitted.id)).filter((e) => e.event_type === 'approve');
  expect(approveEvents).toHaveLength(1);
  // 5. 核准人只有核准權限（沒有三個採購權限）時仍能看到金額、核准別人的單
  const another = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  const pendingList = await fn('approver2', 'ga_ws_po_list', { p_filters: { approvals: true } });
  expect(pendingList.data.map((x: any) => x.id)).toContain(another.id);
  expect(Number(pendingList.data.find((x: any) => x.id === another.id).total_amount)).toBe(6300);
  expect((await act('approver2', another, 'approve')).status).toBe(200);
});

test('駁回：必須填原因並退回草稿（記下駁回人與原因）；可修改再送；重新核准後下訂；撤回核准要原因', async () => {
  const sub = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  const noReason = await act('approver', sub, 'reject');
  expect(noReason.status).toBe(400);
  expect(noReason.code).toBe('REASON_REQUIRED');
  expect((await act('approver', sub, 'reject', '   ')).code).toBe('REASON_REQUIRED');
  expect((await dbPo(sub.id)).status).toBe('PENDING_APPROVAL');
  const rej = await step('approver', sub, 'reject', '單價太高，請再議價');
  expect(rej).toMatchObject({ status: 'DRAFT', last_reject_by: users.approver.id, last_reject_reason: '單價太高，請再議價', approved_by: null });
  expect(rej.last_reject_at).toBeTruthy();
  // 退回草稿後可以修改品項，再送核准
  const upd = await fn('purchaser', 'ga_ws_po_update', { p_id: rej.id, p_header: {}, p_items: items(part.id, 1, 5500), p_expected_updated_at: rej.updated_at });
  expect(upd.status).toBe(200);
  expect(Number(upd.data.total_amount)).toBe(5775);
  const again = await step('purchaser2', upd.data, 'submit');
  expect(again.submitted_by).toBe(users.purchaser2.id);
  const appr = await step('approver', again, 'approve');
  // 已核准：不能直接改品項；要改先撤回核准（原因必填）
  const locked = await fn('purchaser', 'ga_ws_po_update', { p_id: appr.id, p_header: {}, p_items: items(part.id, 1, 100), p_expected_updated_at: appr.updated_at });
  expect(locked.status).toBe(409);
  expect(locked.code).toBe('PO_LOCKED');
  expect((await act('purchaser', appr, 'revoke_approval')).code).toBe('REASON_REQUIRED');
  const revoked = await step('purchaser', appr, 'revoke_approval', '客戶要求改數量');
  expect(revoked).toMatchObject({ status: 'DRAFT', approved_by: null, approval_note: null });
  // 撤回核准後改成小額：免核准、直接下訂
  const small = await fn('purchaser', 'ga_ws_po_update', { p_id: revoked.id, p_header: {}, p_items: items(part.id, 1, 100), p_expected_updated_at: revoked.updated_at });
  expect(small.data.approval_required).toBe(false);
  expect((await step('purchaser', small.data, 'place_order')).status).toBe('ORDERED');
  const ev = (await dbEvents(sub.id)).map((e) => e.event_type);
  expect(ev).toEqual(['create', 'submit', 'reject', 'update', 'submit', 'approve', 'revoke_approval', 'update', 'place_order']);
  // 撤回送簽（withdraw）：待核准 → 草稿；核准人不能撤回（寫入權限不同）
  const w = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  expect((await act('approver', w, 'withdraw')).status).toBe(403);
  expect((await step('purchaser2', w, 'withdraw')).status).toBe('DRAFT');
});

// ----------------------------------------------------------------------------- 狀態與鎖定
test('合法流轉：每個動作在不允許的狀態一律 409（含白話的目前狀態）；版本衝突 409 STALE；缺版本 400', async () => {
  const draft = await mk('purchaser', items(part.id, 1, 100));
  const ord = await ordered();
  const cancelled = await step('purchaser', await mk('purchaser', items(part.id, 1, 100)), 'cancel');
  const closedPo = await dbPo((await ordered()).id); // 已下訂
  // 草稿：撤回、核准、駁回、撤回核准、短收結案、結案都不行
  for (const a of ['withdraw', 'revoke_approval', 'short_close', 'close']) {
    const r = await act('purchaser', draft, a, '原因');
    expect(r.status, `草稿 ${a}`).toBe(409);
    expect(r.code, `草稿 ${a}`).toBe('INVALID_STATE');
    expect(r.error, `草稿 ${a}`).toContain('草稿');
  }
  for (const a of ['approve', 'reject']) expect((await act('approver', draft, a, '原因')).status, `草稿 ${a}`).toBe(409);
  // 已下訂：送核准、再下訂、核准都不行
  for (const a of ['submit', 'place_order', 'withdraw', 'revoke_approval', 'close']) {
    const r = await act('purchaser', ord, a, '原因');
    expect(r.status, `已下訂 ${a}`).toBe(409);
    expect(r.error, `已下訂 ${a}`).toContain('已下訂');
  }
  expect((await act('approver', ord, 'approve')).status).toBe(409);
  // 已取消（終態）：什麼都不能做
  for (const a of ['submit', 'place_order', 'cancel', 'withdraw', 'revoke_approval', 'short_close', 'close']) {
    expect((await act('purchaser', cancelled, a, '原因')).status, `已取消 ${a}`).toBe(409);
  }
  expect(closedPo.status).toBe('ORDERED');
  // 版本：舊版本 409 STALE；缺版本 400；不支援的動作 400；找不到 404；NOTE 太長 400
  const stale = await act('purchaser', draft, 'cancel', null, '2020-01-01T00:00:00+00:00');
  expect(stale).toMatchObject({ status: 409, code: 'STALE' });
  expect((await fn('purchaser', 'ga_ws_po_action', { p_id: draft.id, p_action: 'cancel', p_expected_updated_at: null, p_note: null })).code).toBe('EXPECTED_REQUIRED');
  expect((await act('purchaser', draft, 'explode')).code).toBe('INVALID_ACTION');
  expect((await fn('purchaser', 'ga_ws_po_action', { p_id: crypto.randomUUID(), p_action: 'cancel', p_expected_updated_at: draft.updated_at, p_note: null })).status).toBe(404);
  expect((await act('purchaser', draft, 'cancel', 'x'.repeat(501))).code).toBe('NOTE_TOO_LONG');
  expect((await dbPo(draft.id)).status).toBe('DRAFT');
  // 兩個人同時處理同一張單：只有一個成功
  const race = await mk('purchaser', items(part.id, 1, 100));
  const [a, b] = await Promise.all([act('purchaser', race, 'place_order'), act('purchaser2', race, 'cancel')]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  // 版本衝突不會留下事件
  expect((await dbEvents(race.id)).length).toBe(2);
});

test('下訂後鎖定（D10）：品項、數量、單價、供應商不能改，只能改備註與預計到貨日；待核准與已核准、已結案、已取消完全鎖定', async () => {
  const po = await ordered('purchaser', items(part.id, 1, 100), { expected_delivery_date: '2038-03-01' });
  const base = (over: Record<string, unknown>, its: unknown = null, expected = po.updated_at) => fn('purchaser', 'ga_ws_po_update', { p_id: po.id, p_header: over, p_items: its, p_expected_updated_at: expected });
  for (const [what, r] of [
    ['改品項', await base({}, items(part.id, 5, 100))], ['改供應商', await base({ vendor_id: vendor.id })], ['改收貨位置', await base({ receiving_location_id: loc.id })],
  ] as [string, any][]) {
    expect(r.status, what).toBe(409);
    expect(r.code, what).toBe('PO_LOCKED');
  }
  expect(await dbItems(po.id)).toHaveLength(1);
  expect(Number((await dbItems(po.id))[0].quantity)).toBe(1);
  const ok = await base({ notes: m7Name('改備註'), expected_delivery_date: '2038-03-15' });
  expect(ok.status).toBe(200);
  expect(await dbPo(po.id)).toMatchObject({ notes: m7Name('改備註'), expected_delivery_date: '2038-03-15', status: 'ORDERED' });
  const ev = await dbEvents(po.id);
  expect(ev[ev.length - 1]).toMatchObject({ event_type: 'update', from_status: 'ORDERED', to_status: 'ORDERED' });
  expect(ev[ev.length - 1].payload.fields.sort()).toEqual(['expected_delivery_date', 'notes']);
  // 版本衝突
  expect((await base({ notes: m7Name('x') }, null, po.updated_at)).code).toBe('STALE');
  // 待核准與已核准：完全鎖定
  const pend = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  const lockPend = await fn('purchaser', 'ga_ws_po_update', { p_id: pend.id, p_header: { notes: m7Name('x') }, p_items: null, p_expected_updated_at: pend.updated_at });
  expect([lockPend.status, lockPend.code]).toEqual([409, 'PO_LOCKED']);
  expect(lockPend.error).toContain('撤回');
  const appr = await step('approver', pend, 'approve');
  const lockAppr = await fn('purchaser', 'ga_ws_po_update', { p_id: appr.id, p_header: { notes: m7Name('x') }, p_items: null, p_expected_updated_at: appr.updated_at });
  expect([lockAppr.status, lockAppr.code]).toEqual([409, 'PO_LOCKED']);
  expect(lockAppr.error).toContain('撤回核准');
  // 已取消：完全鎖定
  const canceled = await step('purchaser', await mk('purchaser', items(part.id, 1, 100)), 'cancel');
  const lockCancel = await fn('purchaser', 'ga_ws_po_update', { p_id: canceled.id, p_header: { notes: m7Name('x') }, p_items: null, p_expected_updated_at: canceled.updated_at });
  expect([lockCancel.status, lockCancel.code]).toEqual([409, 'PO_LOCKED']);
  // 草稿修改：替換品項、重算金額、換供應商，事件記錄改了哪些欄位
  const draft = await mk('purchaser', items(part.id, 1, 100));
  const edited = await fn('purchaser', 'ga_ws_po_update', { p_id: draft.id, p_header: { expected_delivery_date: '2038-04-01', vendor_id: null }, p_items: [...items(part.id, 2, 200), ...items(part2.id, 1, 50)], p_expected_updated_at: draft.updated_at });
  expect(edited.status).toBe(200);
  expect([edited.data.subtotal, edited.data.total_amount].map(Number)).toEqual([450, 473]);
  expect(edited.data.vendor_id).toBeNull();
  expect((await dbItems(draft.id)).map((i) => i.line_no)).toEqual([1, 2]);
  const last = (await dbEvents(draft.id)).pop();
  expect(last.payload.fields.sort()).toEqual(['expected_delivery_date', 'items', 'vendor_id']);
  expect((await fn('purchaser', 'ga_ws_po_update', { p_id: draft.id, p_header: { status: 'ORDERED' }, p_items: null, p_expected_updated_at: edited.data.updated_at })).status).toBe(200);
  expect((await dbPo(draft.id)).status).toBe('DRAFT');
  expect((await fn('purchaser', 'ga_ws_po_update', { p_id: draft.id, p_header: {}, p_items: null, p_expected_updated_at: null })).code).toBe('EXPECTED_REQUIRED');
  expect((await fn('purchaser', 'ga_ws_po_update', { p_id: crypto.randomUUID(), p_header: {}, p_items: null, p_expected_updated_at: draft.updated_at })).status).toBe(404);
});

test('取消與結案規則（D10）：下訂前取消原因選填；下訂後未到貨取消須填原因；已有到貨只能短收結案；全部到貨才能結案', async () => {
  // 下訂前取消（草稿、待核准、已核准）：不需要原因
  const d = await step('purchaser', await mk('purchaser', items(part.id, 1, 100)), 'cancel');
  expect(await dbPo(d.id)).toMatchObject({ status: 'CANCELED', cancel_reason: null, canceled_by: users.purchaser.id });
  expect((await dbPo(d.id)).canceled_at).toBeTruthy();
  const pend = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  expect((await step('purchaser2', pend, 'cancel', '客戶取消')).status).toBe('CANCELED');
  const appr = await step('approver', await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit'), 'approve');
  expect((await step('purchaser', appr, 'cancel')).status).toBe('CANCELED');
  // 已下訂、尚未到貨：必須填原因
  const o = await ordered();
  const noReason = await act('purchaser', o, 'cancel');
  expect([noReason.status, noReason.code]).toEqual([400, 'REASON_REQUIRED']);
  const c = await step('purchaser', o, 'cancel', '廠商缺貨');
  expect(await dbPo(o.id)).toMatchObject({ status: 'CANCELED', cancel_reason: '廠商缺貨' });
  // 沒有到貨的已下訂單不能短收結案或結案
  const o2 = await ordered();
  expect((await act('purchaser', o2, 'short_close', '原因')).error).toContain('改用取消');
  expect((await act('purchaser', o2, 'close')).status).toBe(409);
  // 已有到貨（部分到貨）：不能取消，只能短收結案（原因必填）；還沒到齊不能結案
  // 到貨驗入是第 4 批 C 的函式，這裡用 service role 模擬它會寫的結果（訂購量、已驗入量與狀態）。
  const partial = await ordered('purchaser', items(part.id, 5, 100));
  await db().from('ga_purchase_order_items').update({ received_qty: 3 }).eq('po_id', partial.id);
  await db().from('ga_purchase_orders').update({ status: 'PARTIALLY_RECEIVED' }).eq('id', partial.id);
  const cur = await dbPo(partial.id);
  const cancelHas = await act('purchaser', cur, 'cancel', '想取消');
  expect([cancelHas.status, cancelHas.code]).toEqual([409, 'HAS_RECEIPTS']);
  expect(cancelHas.error).toContain('短收結案');
  expect((await act('purchaser', cur, 'close')).error).toContain('短收結案');
  expect((await act('purchaser', cur, 'short_close')).code).toBe('REASON_REQUIRED');
  const sc = await step('purchaser', cur, 'short_close', '廠商只出貨 3 件');
  expect(await dbPo(partial.id)).toMatchObject({ status: 'CLOSED', short_close_reason: '廠商只出貨 3 件', closed_by: users.purchaser.id });
  // 結案後完全鎖定
  for (const a of ['cancel', 'short_close', 'close', 'place_order']) expect((await act('purchaser', sc, a, '原因')).status, a).toBe(409);
  // 全部到貨 → 結案（不用原因）；全部到貨也不能取消
  const full = await ordered('purchaser', items(part.id, 2, 100));
  await db().from('ga_purchase_order_items').update({ received_qty: 2 }).eq('po_id', full.id);
  await db().from('ga_purchase_orders').update({ status: 'RECEIVED' }).eq('id', full.id);
  const rec = await dbPo(full.id);
  expect((await act('purchaser', rec, 'cancel', '原因')).code).toBe('HAS_RECEIPTS');
  expect((await act('purchaser', rec, 'short_close', '原因')).error).toContain('結案');
  expect((await step('purchaser', rec, 'close')).status).toBe('CLOSED');
  expect(c.status).toBe('CANCELED');
  // 每一步都有事件：誰、什麼時候、備註
  const ev = await dbEvents(partial.id);
  expect(ev[ev.length - 1]).toMatchObject({ event_type: 'short_close', from_status: 'PARTIALLY_RECEIVED', to_status: 'CLOSED', actor_id: users.purchaser.id, note: '廠商只出貨 3 件' });
});

// ----------------------------------------------------------------------------- 需求量加總
test('需求量加總（D2、D3）：多張採購單加起來超過需求量要填超量原因；取消釋放；單位換算；維修單、已結案需求單、料件不同都擋', async () => {
  const req = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-A', { part_id: part.id, desired_quantity: 10, desired_unit: '個' });
  const lim = (id: string, exclude: string | null = null) => fn('viewer', 'ga_ws_po_request_remaining', { p_request_id: id, p_exclude_po_id: exclude });
  expect((await lim(req.id)).data).toMatchObject({ has_limit: true, requested_base: 10, committed_base: 0, remaining_base: 10, base_unit: '個' });
  const a = await mk('purchaser', items(part.id, 6, 100, { request_id: req.id }));
  expect((await lim(req.id)).data).toMatchObject({ committed_base: 6, remaining_base: 4 });
  expect((await lim(req.id, a.id)).data).toMatchObject({ committed_base: 0, remaining_base: 10 });
  // 第二張（另一家供應商）再 6 個：加起來 12 > 10，沒有原因被擋
  const v2 = await seedVendor('B');
  const over = await fn('purchaser', 'ga_ws_po_create', { p_header: header({ vendor_id: v2.id }), p_items: items(part.id, 6, 100, { request_id: req.id }), p_create_key: key() });
  expect([over.status, over.code]).toEqual([422, 'OVER_REQUEST_REASON_REQUIRED']);
  expect(over.requested_base).toBe(10);
  expect(over.committed_base).toBe(12);
  const withReason = await fn('purchaser', 'ga_ws_po_create', { p_header: header({ vendor_id: v2.id }), p_items: items(part.id, 6, 100, { request_id: req.id, over_request_reason: '預備庫存' }), p_create_key: key() });
  expect(withReason.status).toBe(201);
  expect((await dbItems(withReason.data.id))[0].over_request_reason).toBe('預備庫存');
  expect((await lim(req.id)).data).toMatchObject({ committed_base: 12, remaining_base: 0 });
  // 取消其中一張後釋放：第一張改成 6 個不再超量
  await step('purchaser', withReason.data, 'cancel');
  expect((await lim(req.id)).data).toMatchObject({ committed_base: 6, remaining_base: 4 });
  const fits = await mk('purchaser', items(part.id, 4, 100, { request_id: req.id }));
  expect(Number(fits.items[0].quantity_base)).toBe(4);
  // 修改草稿增加數量也會重新檢查（排除自己）
  const grow = await fn('purchaser', 'ga_ws_po_update', { p_id: fits.id, p_header: {}, p_items: items(part.id, 5, 100, { request_id: req.id }), p_expected_updated_at: fits.updated_at });
  expect([grow.status, grow.code]).toEqual([422, 'OVER_REQUEST_REASON_REQUIRED']);
  expect(Number((await dbItems(fits.id))[0].quantity)).toBe(4);
  // 單位換算：1 箱 = 12 個，需求 10 個，訂 1 箱就是 12 個，超量
  const unit = await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 1, 100, { unit: '箱', request_id: (await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-U', { part_id: part.id, desired_quantity: 10, desired_unit: '個' })).id }), p_create_key: key() });
  expect(unit.code).toBe('OVER_REQUEST_REASON_REQUIRED');
  // 需求單用採購單位：需求 1 箱 = 12 個，訂 12 個剛好
  const reqBox = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-BOX', { part_id: part.id, desired_quantity: 1, desired_unit: '箱' });
  expect((await lim(reqBox.id)).data).toMatchObject({ requested_base: 12, remaining_base: 12 });
  expect((await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 12, 10, { request_id: reqBox.id }), p_create_key: key() })).status).toBe(201);
  // 沒有需求量的需求單不限制
  const free = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FREE', { desired_quantity: null, part_id: null, resource_type: 'GENERAL_SUPPLY' });
  expect((await lim(free.id)).data).toMatchObject({ has_limit: false, remaining_base: null });
  expect((await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: [{ item_name: m7Name('雜項'), quantity: 999, unit_price: 1, request_id: free.id }], p_create_key: key() })).status).toBe(201);
  // 維修單不能走採購；已結案、駁回、取消的需求單不能開；料件和需求單不同要擋
  const repair = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-REPAIR', { request_type: 'REPAIR', resource_type: null, part_id: null });
  expect((await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 1, 1, { request_id: repair.id }), p_create_key: key() })).code).toBe('REPAIR_NOT_PURCHASE');
  for (const st of ['COMPLETED', 'REJECTED', 'CANCELED']) {
    const closed = await seedRequest(sid.ZT01, users.purchaser.id, `REQ-${st}`, { part_id: part.id, main_status: st });
    expect((await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 1, 1, { request_id: closed.id }), p_create_key: key() })).code, st).toBe('REQUEST_CLOSED');
  }
  const mism = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-MISMATCH', { part_id: part2.id });
  expect((await fn('purchaser', 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 1, 1, { request_id: mism.id }), p_create_key: key() })).code).toBe('REQUEST_PART_MISMATCH');
  expect((await lim(crypto.randomUUID())).status).toBe(404);
  expect((await fn('stock_only', 'ga_ws_po_request_remaining', { p_request_id: req.id })).status).toBe(403);
});

test('需求量加總：下訂前再檢查一次（需求單已被取消、或別張單搶先用掉）；併發建單不會一起超量', async () => {
  const req = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-RACE', { part_id: part.id, desired_quantity: 10, desired_unit: '個' });
  // 兩個人同時各開 6 個（需求 10）：序列化後一張成功，另一張因超量被擋
  const [x, y] = await Promise.all(['purchaser', 'purchaser2'].map((w) => fn(w as PoKey, 'ga_ws_po_create', { p_header: header(), p_items: items(part.id, 6, 100, { request_id: req.id }), p_create_key: key() })));
  expect([x.status, y.status].sort()).toEqual([201, 422]);
  expect((x.ok ? y : x).code).toBe('OVER_REQUEST_REASON_REQUIRED');
  const rows = await db().from('ga_purchase_order_items').select('id').eq('request_id', req.id);
  expect(rows.data).toHaveLength(1);
  // 需求單在下訂前被取消：不能下訂
  const po = x.ok ? x.data : y.data;
  await db().from('ga_service_requests').update({ main_status: 'CANCELED' }).eq('id', req.id);
  const blocked = await act('purchaser', po, 'place_order');
  expect([blocked.status, blocked.code]).toEqual([409, 'REQUEST_CLOSED']);
  expect((await dbPo(po.id)).status).toBe('DRAFT');
});

test('由評估產生草稿（D1）：連回需求單與評估、單價由評估金額推算、數量不超過剩餘量；重送回同一張；非採購評估與維修單被擋', async () => {
  const req = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FR', { part_id: part.id, desired_quantity: 10, desired_unit: '個' });
  const review = await seedReview(req.id, users.purchaser.id, { vendor_id: vendor.id, vendor_name: vendor.name, approved_quantity: 4, approved_unit: '個', final_amount: 8000, expected_delivery_date: '2038-05-01', receiving_location_id: loc.id });
  const r = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: review.id });
  expect([r.status, r.replay]).toEqual([201, false]);
  const po = r.data;
  expect(po).toMatchObject({ status: 'DRAFT', source_request_id: req.id, purchase_review_id: review.id, vendor_id: vendor.id, receiving_location_id: loc.id, expected_delivery_date: '2038-05-01', source_request_no: req.request_no });
  expect(po.items).toHaveLength(1);
  expect(po.items[0]).toMatchObject({ part_id: part.id, request_id: req.id, fulfil_mode: 'STOCK', unit: '個' });
  expect([po.items[0].quantity, po.items[0].unit_price, po.items[0].line_amount].map(Number)).toEqual([4, 2000, 8000]);
  expect(Number(po.total_amount)).toBe(8400);
  expect(po.notes).toContain('由採購評估自動產生');
  expect((await dbEvents(po.id))[0]).toMatchObject({ event_type: 'create_from_review', actor_id: users.purchaser.id });
  expect((await dbEvents(po.id))[0].payload).toMatchObject({ review_id: review.id, request_id: req.id });
  // 重送：回同一張（不重複產生）
  const again = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: review.id });
  expect([again.status, again.replay, again.data.id]).toEqual([200, true, po.id]);
  const dup = await db().from('ga_purchase_orders').select('id').eq('purchase_review_id', review.id);
  expect(dup.data).toHaveLength(1);
  // 同時重送也只產生一張
  const req2 = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FR2', { part_id: part.id, desired_quantity: 3, desired_unit: '個' });
  const rv2 = await seedReview(req2.id, users.purchaser.id, { approved_quantity: 9, approved_unit: '個', final_amount: 900 });
  const both = await Promise.all([fn('purchaser', 'ga_ws_po_from_review', { p_review_id: rv2.id }), fn('purchaser2', 'ga_ws_po_from_review', { p_review_id: rv2.id })]);
  expect(both.every((x) => x.ok), JSON.stringify(both.map((x) => (x.ok ? 'ok' : x)))).toBe(true);
  expect(new Set(both.map((x) => x.data.id)).size).toBe(1);
  // 核准量 9 超過需求 3：只帶剩餘量 3；單價仍用評估核准量推算（900 / 9 = 100）；沒有供應商（評估沒有）
  expect(both[0].data.items[0]).toMatchObject({ unit: '個' });
  expect([both[0].data.items[0].quantity, both[0].data.items[0].unit_price].map(Number)).toEqual([3, 100]);
  expect(both[0].data.vendor_id).toBeNull();
  // 取消後可以再產生（剩餘量回來）
  const canceled = await step('purchaser', both[0].data, 'cancel');
  const regen = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: rv2.id });
  expect([regen.status, regen.data.id === canceled.id]).toEqual([201, false]);
  // 需求量已被其他單用完：409
  const req3 = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FR3', { part_id: part.id, desired_quantity: 2, desired_unit: '個' });
  const rv3 = await seedReview(req3.id, users.purchaser.id, { approved_quantity: 2, approved_unit: '個' });
  await mk('purchaser', items(part.id, 2, 10, { request_id: req3.id }));
  const none = await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: rv3.id });
  expect([none.status, none.code]).toEqual([409, 'NO_REMAINING']);
  // 非採購評估、維修單、不存在
  const req4 = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FR4', { part_id: part.id });
  const rv4 = await seedReview(req4.id, users.purchaser.id, { decision: 'STOCK_ISSUE' });
  expect((await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: rv4.id })).code).toBe('REVIEW_NOT_PURCHASE');
  const rep = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-FR5', { request_type: 'REPAIR', resource_type: null, part_id: null, desired_quantity: null });
  const rv5 = await seedReview(rep.id, users.purchaser.id);
  expect((await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: rv5.id })).code).toBe('REPAIR_NOT_PURCHASE');
  expect((await fn('purchaser', 'ga_ws_po_from_review', { p_review_id: crypto.randomUUID() })).status).toBe(404);
  // 權限：缺三個權限擋、核准人也不行
  for (const who of ['review_only', 'approver', 'nobody'] as PoKey[]) expect((await fn(who, 'ga_ws_po_from_review', { p_review_id: rv2.id })).status, who).toBe(403);
});

// ----------------------------------------------------------------------------- 歷史價與清單
test('歷史價（D9）：只算已下訂以上、新到舊、筆數依設定；草稿、待核准、已核准、已取消不算；自由品名沒有', async () => {
  const cat = await seedCategory('part', 'PO-H');
  const hp = await seedPart(cat.id, 'PO-HP');
  const vB = await seedVendor('H');
  const mkHist = async (price: number, h: Record<string, unknown> = {}) => ordered('purchaser', items(hp.id, 2, price), { vendor_id: h.vendor_id ?? vendor.id, ...h });
  const o1 = await mkHist(101);
  const o2 = await mkHist(102, { vendor_id: vB.id });
  const o3 = await mkHist(103);
  await db().from('ga_purchase_orders').update({ ordered_at: '2038-01-01T00:00:00Z' }).eq('id', o1.id);
  await db().from('ga_purchase_orders').update({ ordered_at: '2038-01-02T00:00:00Z' }).eq('id', o2.id);
  await db().from('ga_purchase_orders').update({ ordered_at: '2038-01-03T00:00:00Z', status: 'CLOSED' }).eq('id', o3.id);
  await mk('purchaser', items(hp.id, 1, 999)); // 草稿
  await step('purchaser', await mk('purchaser', items(hp.id, 1, 998)), 'cancel'); // 已取消
  const pending = await step('purchaser', await mk('purchaser', items(hp.id, 1, 6000)), 'submit'); // 待核准
  const approved = await step('approver', await step('purchaser', await mk('purchaser', items(hp.id, 1, 6001)), 'submit'), 'approve'); // 已核准未下訂
  expect([pending.status, approved.status]).toEqual(['PENDING_APPROVAL', 'APPROVED']);
  const h = await fn('viewer', 'ga_ws_po_price_history', { p_part_id: hp.id });
  expect(h.status).toBe(200);
  expect(h.limit).toBe(5);
  expect(h.data.map((x: any) => Number(x.unit_price))).toEqual([103, 102, 101]);
  expect(h.data[0]).toMatchObject({ po_no: o3.po_no, ordered_date: '2038-01-03', vendor_name: vendor.name, quantity: 2, status: 'CLOSED' });
  expect(h.data[1].vendor_name).toBe(vB.name);
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: hp.id, p_limit: 2 })).data).toHaveLength(2);
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: hp.id, p_limit: 0 })).data).toHaveLength(1);
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: hp.id, p_limit: 99 })).limit).toBe(20);
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: part2.id })).data).toEqual([]);
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: null })).code).toBe('PART_REQUIRED');
  // 取消已下訂的單：不再算入歷史價
  const cancelOrdered = await step('purchaser', await dbPo(o1.id).then((r) => ({ ...r })), 'cancel', '取消');
  expect(cancelOrdered.status).toBe('CANCELED');
  expect((await fn('viewer', 'ga_ws_po_price_history', { p_part_id: hp.id })).data.map((x: any) => Number(x.unit_price))).toEqual([103, 102]);
});

test('清單：每頁最多 100、總數與統計精確（對 DB 核對）、篩選、搜尋跳脫、逾期、我開的；列表不含品項細節與內部欄位', async () => {
  // 補幾張不同狀態與到貨日的單
  const od = await ordered('purchaser', [{ item_name: `${m7Name('AB%CD')}`, quantity: 1, unit_price: 100 }], { expected_delivery_date: '2020-01-01' });
  const future = await ordered('purchaser2', items(part.id, 1, 100), { expected_delivery_date: '2099-01-01' });
  expect(future.status).toBe('ORDERED');
  const all = await fn('viewer', 'ga_ws_po_list', { p_page: 1, p_page_size: 1000 });
  expect([all.status, all.page_size]).toEqual([200, 100]);
  const rows = (await db().from('ga_purchase_orders').select('status,created_by,expected_delivery_date')).data as any[];
  expect(all.total).toBe(rows.length);
  expect(all.stats.total).toBe(rows.length);
  for (const s of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELED']) {
    expect(all.stats[s], s).toBe(rows.filter((r) => r.status === s).length);
  }
  const overdueDb = rows.filter((r) => ['ORDERED', 'PARTIALLY_RECEIVED'].includes(r.status) && r.expected_delivery_date && r.expected_delivery_date < `${taipeiToday().slice(0, 4)}-${taipeiToday().slice(4, 6)}-${taipeiToday().slice(6, 8)}`).length;
  expect(all.stats.overdue).toBe(overdueDb);
  expect(all.stats.overdue).toBeGreaterThan(0);
  const mine = await fn('purchaser2', 'ga_ws_po_list', { p_filters: { mine: true }, p_page_size: 100 });
  expect(mine.total).toBe(rows.filter((r) => r.created_by === users.purchaser2.id).length);
  expect(mine.stats.mine).toBe(mine.total);
  expect(mine.data.every((x: any) => x.created_by === users.purchaser2.id)).toBe(true);
  // 分頁：第二頁沒有重複、總數不變
  const p1 = await fn('viewer', 'ga_ws_po_list', { p_page: 1, p_page_size: 5 });
  const p2 = await fn('viewer', 'ga_ws_po_list', { p_page: 2, p_page_size: 5 });
  expect(p1.data).toHaveLength(5);
  expect(p2.total).toBe(p1.total);
  expect(p1.data.map((x: any) => x.id).filter((id: string) => p2.data.map((y: any) => y.id).includes(id))).toEqual([]);
  expect((await fn('viewer', 'ga_ws_po_list', { p_page: 0, p_page_size: 0 })).page).toBe(1);
  // 篩選：狀態、逾期、供應商
  const ordList = await fn('viewer', 'ga_ws_po_list', { p_filters: { statuses: ['ORDERED'] }, p_page_size: 100 });
  expect(ordList.total).toBe(rows.filter((r) => r.status === 'ORDERED').length);
  expect(ordList.data.every((x: any) => x.status === 'ORDERED')).toBe(true);
  const overdue = await fn('viewer', 'ga_ws_po_list', { p_filters: { overdue: true }, p_page_size: 100 });
  expect(overdue.total).toBe(overdueDb);
  expect(overdue.data.map((x: any) => x.id)).toContain(od.id);
  expect(overdue.data.map((x: any) => x.id)).not.toContain(future.id);
  expect(overdue.data.every((x: any) => x.overdue === true)).toBe(true);
  const byVendor = await fn('viewer', 'ga_ws_po_list', { p_filters: { vendor_id: vendor.id }, p_page_size: 100 });
  expect(byVendor.data.every((x: any) => x.vendor_id === vendor.id)).toBe(true);
  // 搜尋：單號、品名；% 與 _ 與反斜線不當萬用字元
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: od.po_no } })).data.map((x: any) => x.id)).toEqual([od.id]);
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: 'B%C' } })).data.map((x: any) => x.id)).toEqual([od.id]);
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: 'B_C' } })).total).toBe(0);
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: '%' } })).data.map((x: any) => x.id)).toEqual([od.id]);
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: '\\' } })).total).toBe(0);
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { q: vendor.name.slice(-3) }, p_page_size: 100 })).total).toBeGreaterThan(0);
  // 壞篩選 400
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { statuses: ['NOPE'] } })).code).toBe('FILTER_INVALID');
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: { vendor_id: 'x' } })).code).toBe('FILTER_INVALID');
  expect((await fn('viewer', 'ga_ws_po_list', { p_filters: [1] })).code).toBe('FILTER_INVALID');
  // 待簽核篩選：只列待核准
  const pend = await fn('approver', 'ga_ws_po_list', { p_filters: { approvals: true }, p_page_size: 100 });
  expect(pend.data.every((x: any) => x.status === 'PENDING_APPROVAL')).toBe(true);
  expect(pend.total).toBe(all.stats.PENDING_APPROVAL);
  // 列表欄位：有摘要，沒有帳務欄位、沒有內部備註與建單識別
  const sample = all.data[0];
  for (const k of ['id', 'po_no', 'status_label', 'vendor_name', 'total_amount', 'item_count', 'first_item_name', 'ordered_qty_base', 'received_qty', 'created_by_name']) expect(sample, k).toHaveProperty(k);
  for (const k of ['notes', 'create_key', 'create_hash', 'vendor_tax_id_snapshot', 'items', 'events']) expect(sample, k).not.toHaveProperty(k);
});

// ----------------------------------------------------------------------------- 設定
test('設定（核准門檻、稅率、歷史價筆數）：限核准人調整；版本衝突；驗證範圍；每次變更寫稽核；調整只影響之後送出的單', async () => {
  const get = await fn('viewer', 'ga_ws_po_settings_get', {});
  expect(get.data).toMatchObject({ approval_enabled: true, approval_threshold: 5000, price_history_limit: 5, request_overdue_confirm_days: 7, can_edit: false });
  expect(Number(get.data.tax_rate)).toBe(0.05);
  expect((await fn('approver', 'ga_ws_po_settings_get', {})).data.can_edit).toBe(true);
  const set = (who: PoKey, values: Record<string, unknown>, expected: string | null) => fn(who, 'ga_ws_po_settings_set', { p_values: values, p_expected_updated_at: expected });
  expect((await set('approver', { approval_threshold: 9000 }, null)).code).toBe('EXPECTED_REQUIRED');
  expect((await set('approver', { approval_threshold: 9000 }, '2020-01-01T00:00:00+00:00')).code).toBe('STALE');
  for (const [v, msg] of [
    [{ approval_threshold: -1 }, '數字'], [{ approval_threshold: 100000000 }, '99,999,999'], [{ tax_rate: 0.5 }, '0.3'], [{ price_history_limit: 0 }, '1 到 20'],
    [{ price_history_limit: 21 }, '1 到 20'], [{ price_history_limit: 2.5 }, '1 到 20'], [{ approval_enabled: 'maybe' }, '是或否'], [{ approval_threshold: 'abc' }, '數字'], [{ bogus: 1 }, '不支援'],
  ] as [Record<string, unknown>, string][]) {
    const r = await set('approver', v, get.data.updated_at);
    expect([r.status, r.code], JSON.stringify(v)).toEqual([400, 'SETTINGS_INVALID']);
    expect(r.error, JSON.stringify(v)).toContain(msg);
  }
  expect((await fn('approver', 'ga_ws_po_settings_get', {})).data.history).toEqual(get.data.history);
  // 先送一張 6000 未稅（含稅 6300）的單，快照門檻 5000
  const sub = await step('purchaser', await mk('purchaser', items(part.id, 1, 6000)), 'submit');
  try {
    const up = await set('approver', { approval_threshold: 8000, tax_rate: 0.1, price_history_limit: 3, approval_enabled: true }, get.data.updated_at);
    expect(up.status).toBe(200);
    expect(up.data).toMatchObject({ approval_threshold: 8000, price_history_limit: 3, can_edit: true });
    expect(Number(up.data.tax_rate)).toBe(0.1);
    // 稽核：每個有變動的鍵一筆（誰、舊值、新值）；沒變動的（啟用核准）不寫
    const events = (await db().from('ga_workflow_setting_events').select('*').eq('actor_id', users.approver.id).order('created_at')).data as any[];
    const changes = events.map((e) => [e.setting_key, Number(e.old_value_num), Number(e.new_value_num)]).sort();
    expect(changes).toEqual([['po_approval_threshold', 5000, 8000], ['po_price_history_limit', 5, 3], ['po_tax_rate', 0.05, 0.1]].sort());
    expect(up.data.history.length).toBe(3);
    expect(up.data.history[0]).toMatchObject({ actor_id: users.approver.id });
    expect((await db().from('ga_workflow_settings').select('updated_by').eq('key', 'po_approval_threshold').single()).data.updated_by).toBe(users.approver.id);
    // 舊版本再寫：STALE（版本已換）
    expect((await set('approver', { approval_threshold: 1 }, get.data.updated_at)).code).toBe('STALE');
    // 已送出的單保留當時的門檻快照；之後新單用新門檻與新稅率：未稅 6000 稅 10% = 6600 ≤ 8000 免核准
    expect(Number((await dbPo(sub.id)).approval_threshold_snapshot)).toBe(5000);
    const fresh = await mk('purchaser', items(part.id, 1, 6000));
    expect([Number(fresh.tax_rate), Number(fresh.total_amount), fresh.approval_required]).toEqual([0.1, 6600, false]);
    expect((await step('purchaser', fresh, 'place_order')).status).toBe('ORDERED');
    // 歷史價筆數用新設定
    const hist = await fn('viewer', 'ga_ws_po_price_history', { p_part_id: part.id });
    expect(hist.limit).toBe(3);
    // 關閉核准：再大的單也免核准
    const off = await set('approver', { approval_enabled: false }, up.data.updated_at);
    expect(off.data.approval_enabled).toBe(false);
    const big = await mk('purchaser', items(part.id, 1, 900_000));
    expect(big.approval_required).toBe(false);
    expect((await act('purchaser', big, 'submit')).code).toBe('NO_APPROVAL_NEEDED');
    expect((await step('purchaser', big, 'place_order')).status).toBe('ORDERED');
  } finally {
    for (const s of originalSettings) await db().from('ga_workflow_settings').update({ value_num: s.value_num, value_text: s.value_text }).eq('key', s.key);
  }
  expect(Number((await fn('viewer', 'ga_ws_po_settings_get', {})).data.approval_threshold)).toBe(5000);
});

// ----------------------------------------------------------------------------- 資料庫層（BEGIN…ROLLBACK）
function runSqlDo(body: string, tag: string): string {
  const sql = `DO $$\n${body}\nEND $$;`;
  const file = path.join(os.tmpdir(), `g25db-${tag}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const run = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', shell: true });
    return `${run.stdout}\n${run.stderr}`.replace(/\\"/g, '"');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

test('資料庫層（交易內執行、結束一律回復）：事件表不可改刪、單號滿 999 擴位、舊版收貨遇到有採購單的評估被擋', async () => {
  test.setTimeout(180_000);
  const day = taipeiToday();
  const req = await seedRequest(sid.ZT01, users.purchaser.id, 'REQ-DB', { part_id: part.id });
  const review = await seedReview(req.id, users.purchaser.id, { approved_quantity: 1, approved_unit: '個' });
  const out = runSqlDo(`
DECLARE
  v_uid uuid := '${users.purchaser.id}';
  v_po uuid;
  v_ev uuid;
  r_upd text := 'none'; r_del text := 'none'; r_null text := 'none'; r_cascade text := 'none'; r_next1 text; r_next2 text; r_legacy text := 'none'; r_other text := 'none'; r_cancel text := 'none';
BEGIN
  -- 1. 事件表不可修改或刪除；唯一例外是帳號刪除時把操作人設為空白
  INSERT INTO public.ga_purchase_orders (po_no, created_by, notes) VALUES ('PO-${day}-998', v_uid, '${m7Name('DBTEST')}') RETURNING id INTO v_po;
  INSERT INTO public.ga_purchase_order_events (po_id, event_type, actor_id, note) VALUES (v_po, 'create', v_uid, 'n') RETURNING id INTO v_ev;
  BEGIN UPDATE public.ga_purchase_order_events SET note = 'x' WHERE id = v_ev; EXCEPTION WHEN OTHERS THEN r_upd := SQLSTATE; END;
  BEGIN DELETE FROM public.ga_purchase_order_events WHERE id = v_ev; EXCEPTION WHEN OTHERS THEN r_del := SQLSTATE; END;
  BEGIN DELETE FROM public.ga_purchase_orders WHERE id = v_po; EXCEPTION WHEN OTHERS THEN r_cascade := SQLSTATE; END;
  BEGIN UPDATE public.ga_purchase_order_events SET actor_id = NULL WHERE id = v_ev; r_null := 'ok'; EXCEPTION WHEN OTHERS THEN r_null := SQLSTATE; END;
  -- 2. 單號：同一天最大流水 998 → 下一個 999 → 再下一個 1000（四位）
  r_next1 := public.ga_next_po_no();
  INSERT INTO public.ga_purchase_orders (po_no, created_by, notes) VALUES (r_next1, v_uid, '${m7Name('DBTEST2')}');
  r_next2 := public.ga_next_po_no();
  -- 3. 舊版需求單收貨（參考單據 GA_PURCHASE_REVIEW）：評估已有採購單 → 擋；取消後放行；沒有採購單的評估不受影響
  UPDATE public.ga_purchase_orders SET purchase_review_id = '${review.id}' WHERE id = v_po;
  BEGIN
    INSERT INTO public.ga_inventory_transactions (transaction_no, transaction_type, location_id, part_id, quantity_input, input_unit_type, unit_conversion_rate, quantity_base, balance_before, balance_after, reason, created_by, reference_type, reference_id)
    VALUES ('ZT-M7M8-DB-' || gen_random_uuid(), 'RECEIPT', '${loc.id}', '${part.id}', 1, 'BASE', 1, 1, 0, 1, 'ZT M7M8 legacy receipt', v_uid, 'GA_PURCHASE_REVIEW', '${review.id}');
    r_legacy := 'inserted';
  EXCEPTION WHEN OTHERS THEN r_legacy := left(SQLERRM, 20); END;
  BEGIN
    INSERT INTO public.ga_inventory_transactions (transaction_no, transaction_type, location_id, part_id, quantity_input, input_unit_type, unit_conversion_rate, quantity_base, balance_before, balance_after, reason, created_by, reference_type, reference_id)
    VALUES ('ZT-M7M8-DB-' || gen_random_uuid(), 'RECEIPT', '${loc.id}', '${part.id}', 1, 'BASE', 1, 1, 0, 1, 'ZT M7M8 legacy receipt other', v_uid, 'GA_PURCHASE_REVIEW', gen_random_uuid());
    r_other := 'inserted';
  EXCEPTION WHEN OTHERS THEN r_other := SQLSTATE; END;
  UPDATE public.ga_purchase_orders SET status = 'CANCELED' WHERE id = v_po;
  BEGIN
    INSERT INTO public.ga_inventory_transactions (transaction_no, transaction_type, location_id, part_id, quantity_input, input_unit_type, unit_conversion_rate, quantity_base, balance_before, balance_after, reason, created_by, reference_type, reference_id)
    VALUES ('ZT-M7M8-DB-' || gen_random_uuid(), 'RECEIPT', '${loc.id}', '${part.id}', 1, 'BASE', 1, 1, 0, 1, 'ZT M7M8 legacy receipt canceled', v_uid, 'GA_PURCHASE_REVIEW', '${review.id}');
    r_cancel := 'inserted';
  EXCEPTION WHEN OTHERS THEN r_cancel := SQLSTATE; END;
  RAISE EXCEPTION 'G25DB:upd=%,del=%,cascade=%,nullify=%,next1=%,next2=%,legacy=%,other=%,cancel=%:END', r_upd, r_del, r_cascade, r_null, r_next1, r_next2, r_legacy, r_other, r_cancel;`, 'db');
  const m = /G25DB:([^:]*?):END/.exec(out);
  expect(m, out.slice(0, 1200)).not.toBeNull();
  const v = Object.fromEntries(m![1].split(',').map((kv) => kv.split('=')));
  expect(v).toMatchObject({ upd: 'GA002', del: 'GA002', cascade: 'GA002', nullify: 'ok', next1: `PO-${day}-999`, next2: `PO-${day}-1000`, other: 'inserted', cancel: 'inserted' });
  expect(v.legacy).toBe('PURCHASE_ORDER_EXIST');
  // 整個交易已回復：沒有留下 DBTEST 採購單、沒有流水、事件沒變
  const leftover = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', `${m7Name('DBTEST')}%`);
  expect(leftover.count).toBe(0);
  const tx = await db().from('ga_inventory_transactions').select('id', { count: 'exact', head: true }).like('reason', 'ZT M7M8 legacy receipt%');
  expect(tx.count).toBe(0);
  // 單號格式與資料庫層權限：登入者不能直接寫三張表（RLS 沒有政策、沒有授權）
  const direct = await users.purchaser.client.from('ga_purchase_orders').select('id').limit(1);
  expect(direct.data === null || (direct.data as any[]).length === 0, '登入者不能直接讀採購單資料表').toBe(true);
  const ins = await users.purchaser.client.from('ga_purchase_orders').insert({ po_no: 'PO-HACK-001', notes: m7Name('hack') });
  expect(ins.error).not.toBeNull();
  const evDirect = await users.purchaser.client.from('ga_purchase_order_events').select('id').limit(1);
  expect(evDirect.data === null || (evDirect.data as any[]).length === 0).toBe(true);
  const settingsDirect = await users.purchaser.client.from('ga_workflow_settings').select('key').limit(1);
  expect(settingsDirect.data === null || (settingsDirect.data as any[]).length === 0).toBe(true);
});

test('權限碼與設定的資料庫現況：採購核准權限碼存在、不指派給任何非測試角色；預設設定值正確', async () => {
  const perm = await db().from('permissions').select('id,module,feature,code,action,is_active').eq('code', PERM.approve).single();
  expect(perm.data).toMatchObject({ module: 'general_affairs', feature: 'purchase_order', action: 'approve', is_active: true });
  const granted = await db().from('role_permissions').select('role_id, roles!inner(code)').eq('permission_id', perm.data.id);
  const codes = ((granted.data || []) as any[]).map((r) => r.roles.code as string);
  // 只有測試用角色（m7m8_test_*、DEV 種子角色 vue_workspace_ga_po_approver）掛了這個權限
  expect(codes.every((c) => c.startsWith('m7m8_test_') || c === 'vue_workspace_ga_po_approver'), JSON.stringify(codes)).toBe(true);
  const settings = Object.fromEntries(originalSettings.map((s: any) => [s.key, Number(s.value_num)]));
  expect(settings).toMatchObject({ po_approval_enabled: 1, po_approval_threshold: 5000, po_tax_rate: 0.05, request_overdue_confirm_days: 7, po_price_history_limit: 5 });
  // 登入者直接呼叫內部設定函式與清除函式被拒（只有 service_role）
  expect((await callFn(users.purchaser.client, 'ga_dev_cleanup_m7m8_purchasing', {})).ok).not.toBe(true);
});
