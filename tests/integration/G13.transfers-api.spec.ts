import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, rpcClientFor, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedServiceRequest, seedTransfer,
  setupM7Users, type M7User,
} from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G13 調撥單 API（/api/workspace/general-affairs/inventory/transfers/**）整合層。
// 涵蓋：權限矩陣（401／403；調撥管理、庫存交易管理、料件查看三個權限缺哪個講清楚；舊式管理員沒有後備）與 Origin、建單 400 驗證與 DB 回讀（台北日期單號、備註不被清空）、
//      C8 目的位置缺設定被擋、Q14 庫存不足只警告、建單冪等與併發、交出／運送中／收貨 DB 回讀（餘額、流水、明細關聯、時間軸）、狀態條件 409、版本 STALE、動作冪等、
//      兩人同時按只成功一次、庫存不足整體回復、收貨失敗整體回復、取消（退回來源庫存／不退、結構化異常、不能退回沒交出的）、C9「未收」只註記仍可收貨且沒有 reopen、
//      C10 目的門市店長回報只寫標記（其他人 403）、C11 逾期天數設定與逾期篩選與統計、列表精確統計與分頁與搜尋、C12 名單身分遮蔽、需求單連結（剩餘量、單位換算、不覆蓋進行中處理單）、網址預填與「未能帶入」、選項搜尋分頁。
// 餘額一律用 seedBalance 直接種；只有調撥動作本身的測試才真的過帳，流水用 DEV 專用清除函式清掉（cleanupM7M8）。
const BASE = '/api/workspace/general-affairs/inventory';
const T = `${BASE}/transfers`;
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'ga_staff', 'navigation', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'ga_inv_location_view', 'ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'supervisor', 'denied'];
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let partCat: { id: string };
let gaUserId = '';
let originalDays = 3;

const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p = '') => j(await apis[k].get(`${T}${p}`));
const send = async (k: string, method: 'post' | 'patch', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${T}${p}`, { data: data ?? {} }));
const key = () => crypto.randomUUID();
const ids = (res: any) => ((res.body.data || []) as any[]).map((r) => r.id as string);

type Made = { src: any; dest: any; part: any; srcQty: number };
/** 來源（中央倉庫）＋目的（ZT01 門市位置）＋有採購單位（1 箱 = 12 個）的料件；兩邊都有位置料件設定，來源有庫存。 */
async function mk(suffix: string, o: { srcQty?: number; destCfg?: boolean; srcCfg?: boolean; srcOver?: Record<string, unknown>; destStore?: string; partOver?: Record<string, unknown> } = {}): Promise<Made> {
  const src = await seedLocation(null, `${suffix}-S`, o.srcOver);
  const dest = await seedLocation(o.destStore || 'ZT01', `${suffix}-D`);
  const part = await seedPart(partCat.id, `${suffix}-P`, { purchase_unit: '箱', purchase_to_base_rate: 12, allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: true, ...o.partOver });
  if (o.srcCfg !== false) await seedLocationPart(src.id, part.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  if (o.destCfg !== false) await seedLocationPart(dest.id, part.id);
  const srcQty = o.srcQty ?? 50;
  if (srcQty) await seedBalance(src.id, part.id, srcQty);
  return { src, dest, part, srcQty };
}
const body = (m: Made, over: Record<string, unknown> = {}) => ({
  source_location_id: m.src.id, destination_location_id: m.dest.id, part_id: m.part.id, quantity: 2, input_unit_type: 'PURCHASE', reason: m7Name('調撥原因'), idempotency_key: key(), ...over,
});
const create = (k: string, m: Made, over: Record<string, unknown> = {}) => send(k, 'post', '', body(m, over));
const act = (k: string, id: string, action: string, expected: string, over: Record<string, unknown> = {}) =>
  send(k, 'post', `/${id}/actions`, { action, expected_updated_at: expected, idempotency_key: key(), ...over });
/** 建單並回傳 id 與最新版本。 */
async function newTransfer(m: Made, over: Record<string, unknown> = {}, k = 'ga_works') {
  const r = await create(k, m, over);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.data.id as string, no: r.body.data.transfer_no as string, v: r.body.data.updated_at as string };
}
const dbT = async (id: string) => (await adminDb().from('ga_inventory_transfers').select('*').eq('id', id).single()).data as any;
const dbItems = async (id: string) => ((await adminDb().from('ga_inventory_transfer_items').select('*').eq('transfer_id', id).order('created_at')).data || []) as any[];
const dbEvents = async (id: string) => ((await adminDb().from('ga_inventory_transfer_events').select('*').eq('transfer_id', id).order('created_at').order('id')).data || []) as any[];
const dbBal = async (loc: string, part: string) => (await adminDb().from('ga_inventory_balances').select('*').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any;
const bal = async (loc: string, part: string) => Number((await dbBal(loc, part))?.quantity_base ?? 0);
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at').order('transaction_no')).data || []) as any[];
const countTransfers = async (like: string) => ((await adminDb().from('ga_inventory_transfers').select('id').like('reason', like)).data || []).length;
const taipeiDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  const made = await setupM7Users(['roster_supervisor', 'roster_area_manager', 'admin_ungranted']);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of ['roster_supervisor', 'roster_area_manager', 'admin_ungranted']) apis[k] = await apiForUser(users[k] as any);
  partCat = await seedCategory('part', 'TR');
  const prof = (await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-works@example.test').single()).data as any;
  gaUserId = prof.id;
  originalDays = Number(((await adminDb().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).single()).data as any).overdue_days);
});
test.afterAll(async () => {
  // 還原逾期天數（全站單列設定，測試改過一定要還原）
  await adminDb().from('ga_inventory_transfer_settings').update({ overdue_days: originalDays }).eq('id', true);
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含調撥與過帳流水）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
});

// ----------------------------------------------------------------------------- 權限與 Origin
test('讀取權限矩陣：未登入 401；無相關權限也不在門市名單 403；調撥、交易、餘額查看者與名單身分可讀；舊式管理員沒有後備', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of ['', '/settings', '/options', '/prefill', '/00000000-0000-4000-8000-000000000000']) expect((await anon.get(`${T}${p}`)).status(), p).toBe(401);
  expect((await anon.post(T, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon.dispose();
  for (const k of ['denied', 'ga_inv_location_view', 'ga_equipment_view', 'admin_ungranted']) {
    for (const p of ['', '/settings']) expect((await get(k, p)).status, `${k} ${p}`).toBe(403);
  }
  for (const k of ['ga_works', 'ga_staff', 'navigation', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'store_manager', 'ga_store_manager_b', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    expect((await get(k, '')).status, k).toBe(200);
    expect((await get(k, '/settings')).status, k).toBe(200);
  }
  const perm = async (k: string) => (await get(k, '')).body.permissions;
  expect(await perm('ga_works')).toMatchObject({ canOperate: true, canCreate: true, canSetOverdue: true, internal: true, problem: '' });
  expect(await perm('navigation')).toMatchObject({ canOperate: false, internal: true });
  expect((await perm('navigation')).problem).toContain('調撥管理');
  const txnOnly = await perm('ga_inv_txn_only');
  expect(txnOnly.canOperate).toBe(false);
  const missing = (p: string) => p.split('您缺少：')[1];
  expect(missing(txnOnly.problem)).toBe('調撥管理、料件查看'); // 只有庫存交易管理：缺另外兩個
  const trOnly = await perm('ga_inv_transfer_only');
  expect(missing(trOnly.problem)).toBe('庫存交易管理、料件查看');
  expect(missing((await perm('navigation')).problem)).toContain('調撥管理');
  expect(await perm('store_manager')).toMatchObject({ canCreate: false, internal: false, canReport: true });
  expect(await perm('roster_supervisor')).toMatchObject({ canCreate: false, internal: false, canReport: false });
});

test('寫入權限矩陣：缺哪個權限講清楚且資料庫沒有任何寫入；資料庫函式本身也檢查（直接呼叫）；Origin 不符 403', async () => {
  const m = await mk('PERM');
  const tag = m7Name('PERM-REASON');
  for (const [k, text] of [
    ['navigation', '調撥管理'], ['ga_inv_txn_only', '調撥管理'], ['ga_inv_transfer_only', '庫存交易管理'], ['ga_inv_transfer_only', '料件查看'],
  ] as const) {
    const r = await create(k, m, { reason: tag });
    expect(r.status, k + JSON.stringify(r.body)).toBe(403);
    expect(r.body.error, k).toContain(text);
  }
  for (const k of ['store_manager', 'ga_store_manager_b', 'supervisor', 'roster_supervisor', 'ga_inv_location_view', 'denied', 'admin_ungranted']) {
    expect((await create(k, m, { reason: tag })).status, k).toBe(403);
  }
  expect(await countTransfers(tag)).toBe(0);
  // 真的建一張，再用不夠權限的人做每一個動作
  const t = await newTransfer(m);
  for (const k of ['navigation', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'store_manager', 'roster_supervisor', 'admin_ungranted']) {
    for (const a of ['confirm_source', 'cancel']) expect((await act(k, t.id, a, t.v, { note: '試試看' })).status, `${k} ${a}`).toBe(403);
  }
  expect((await dbT(t.id)).status).toBe('REQUESTED');
  expect(await dbTx(m.src.id, m.part.id)).toEqual([]);
  // 資料庫函式本身：沒有三個權限的人直接呼叫也被擋（不是只有 API 擋）
  const client = await rpcClientFor('navigation');
  const direct = await callFn(client, 'ga_ws_inv_transfer_action', { p_transfer_id: t.id, p_action: 'confirm_source', p_expected_updated_at: t.v, p_idempotency_key: key() });
  expect(direct).toMatchObject({ ok: false, status: 403 });
  expect(direct.error).toContain('調撥管理');
  const direct2 = await callFn(client, 'ga_ws_inv_transfer_create', { p_source_location_id: m.src.id, p_destination_location_id: m.dest.id, p_part_id: m.part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: tag, p_notes: null, p_shipping_method: null, p_request_id: null, p_idempotency_key: key() });
  expect(direct2).toMatchObject({ ok: false, status: 403 });
  expect(await countTransfers(tag)).toBe(0);
  // Origin
  const evil = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await storageStateFor('ga_works'), extraHTTPHeaders: { Origin: 'http://evil.example' } });
  expect((await evil.post(T, { data: body(m, { reason: tag }) })).status()).toBe(403);
  expect((await evil.post(`${T}/${t.id}/actions`, { data: { action: 'confirm_source', expected_updated_at: t.v, idempotency_key: key() } })).status()).toBe(403);
  expect((await evil.patch(`${T}/settings`, { data: { overdue_days: 9, expected_updated_at: t.v } })).status()).toBe(403);
  await evil.dispose();
  expect(await countTransfers(tag)).toBe(0);
  expect((await dbT(t.id)).status).toBe('REQUESTED');
  expect((await get('ga_works', '/not-a-uuid')).status).toBe(400);
  expect((await get('ga_works', '/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  expect((await get('ga_works', '/settings/else')).status).toBe(404);
});

// ----------------------------------------------------------------------------- 建單
test('建單驗證 400：位置、料件、數量、原因、運送方式、識別碼、系統欄位；沒有任何寫入', async () => {
  const m = await mk('VAL');
  const tag = m7Name('VAL-REASON');
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ['來源缺', { source_location_id: '' }, /來源位置/],
    ['目的缺', { destination_location_id: 'x' }, /目的位置/],
    ['同位置', { destination_location_id: m.src.id }, /不可相同/],
    ['料件缺', { part_id: '' }, /料件/],
    ['數量 0', { quantity: 0 }, /數量/],
    ['數量負', { quantity: -1 }, /數量/],
    ['數量 5 位小數', { quantity: '0.12345' }, /4 位小數/],
    ['數量文字', { quantity: 'abc' }, /數量/],
    ['原因空白', { reason: '   ' }, /調撥原因/],
    ['原因過長', { reason: 'x'.repeat(201) }, /200 字/],
    ['備註過長', { notes: 'x'.repeat(501) }, /500 字/],
    ['運送方式', { shipping_method: '飛機' }, /運送方式/],
    ['單位', { input_unit_type: 'BOX' }, /單位類型/],
    ['需求單格式', { request_id: 'x' }, /需求單/],
    ['識別碼缺', { idempotency_key: '' }, /識別碼/],
    ['系統欄位', { status: 'RECEIVED' }, /不支援的欄位/],
    ['明細陣列（舊格式）', { items: [] }, /不支援的欄位/],
  ];
  for (const [label, over, re] of bad) {
    const r = await create('ga_works', m, { reason: tag, ...over });
    expect(r.status, label).toBe(400);
    expect(r.body.error, label).toMatch(re);
  }
  expect((await send('ga_works', 'post', '', null)).status).toBe(400);
  expect(await countTransfers(tag)).toBe(0);
});

test('建單成功 DB 回讀：台北日期單號、狀態、建立人、明細、時間軸；庫存不動；運送方式與備註存入', async () => {
  const m = await mk('CRT');
  const before = taipeiDate();
  const tag = m7Name('CRT-REASON');
  const r = await create('ga_works', m, { reason: tag, notes: '內部備註 CRT', shipping_method: '總務配送' });
  const after = taipeiDate();
  expect(r.status).toBe(201);
  expect(r.body.replay).toBe(false);
  const no = r.body.data.transfer_no as string;
  expect(no).toMatch(/^GAT-\d{8}-\d{5}$/);
  expect([before, after]).toContain(no.slice(4, 12));
  const t = await dbT(r.body.data.id);
  expect(t).toMatchObject({ transfer_no: no, status: 'REQUESTED', reason: tag, notes: '內部備註 CRT', shipping_method: '總務配送', created_by: gaUserId, source_location_id: m.src.id, destination_location_id: m.dest.id });
  expect(t.source_confirmed_at).toBeNull();
  const items = await dbItems(t.id);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ part_id: m.part.id, input_unit_type: 'PURCHASE', source_transaction_id: null, receipt_transaction_id: null });
  expect(Number(items[0].quantity_input)).toBe(2);
  const ev = await dbEvents(t.id);
  expect(ev.map((e) => e.action)).toEqual(['create']);
  expect(ev[0]).toMatchObject({ to_status: 'REQUESTED', created_by: gaUserId });
  expect(await bal(m.src.id, m.part.id)).toBe(50);
  expect(await dbBal(m.dest.id, m.part.id)).toBeNull();
  expect(await dbTx(m.src.id, m.part.id)).toEqual([]);
  expect(r.body.warnings).toEqual([]);
});

test('C8 目的位置沒設定這個料件不能建單（附前往位置設定的資訊）；其他建單檢查：來源沒設定、位置或料件停用／刪除、採購單位無效', async () => {
  const tag = m7Name('C8-REASON');
  const m = await mk('C8', { destCfg: false });
  const r = await create('ga_works', m, { reason: tag });
  expect(r.status).toBe(422);
  expect(r.body.code).toBe('DESTINATION_PART_NOT_CONFIGURED');
  expect(r.body.error).toContain('目的位置');
  expect(r.body.shortcut).toBe('locations');
  expect(r.body.location_id).toBe(m.dest.id);
  // 設定存在但已停用：同樣被擋；補回啟用後就能建
  const cfg = await seedLocationPart(m.dest.id, m.part.id, { is_active: false });
  expect((await create('ga_works', m, { reason: tag })).body.code).toBe('DESTINATION_PART_NOT_CONFIGURED');
  await adminDb().from('ga_inventory_location_parts').update({ is_active: true }).eq('id', cfg.id);
  expect((await create('ga_works', m, { reason: tag })).status).toBe(201);
  expect(await countTransfers(tag)).toBe(1);
  // 來源沒設定
  const m2 = await mk('C8B', { srcCfg: false });
  const r2 = await create('ga_works', m2, { reason: tag });
  expect(r2.status).toBe(422);
  expect(r2.body.code).toBe('SOURCE_PART_NOT_CONFIGURED');
  // 位置停用、料件停用、位置刪除、不存在
  const m3 = await mk('C8C', { srcQty: 0 });
  await adminDb().from('ga_inventory_locations').update({ is_active: false }).eq('id', m3.dest.id);
  expect(await create('ga_works', m3, { reason: tag })).toMatchObject({ status: 409, body: { code: 'LOCATION_INACTIVE' } });
  await adminDb().from('ga_inventory_locations').update({ is_active: true }).eq('id', m3.dest.id);
  // 位置被刪除（軟刪除，不能還原，所以用另一組）
  const m6 = await mk('C8F', { srcQty: 0 });
  const cur6 = ((await adminDb().from('ga_inventory_locations').select('updated_at').eq('id', m6.src.id).single()).data as any).updated_at;
  const del = await j(await apis.ga_works.delete(`${BASE}/locations/${m6.src.id}`, { data: { deletion_reason: '測試刪除', expected_updated_at: cur6 } }));
  expect(del.status, JSON.stringify(del.body)).toBe(200);
  expect(await create('ga_works', m6, { reason: tag })).toMatchObject({ status: 404, body: { code: 'LOCATION_NOT_FOUND' } });
  await adminDb().from('ga_parts').update({ is_active: false }).eq('id', m3.part.id);
  expect(await create('ga_works', m3, { reason: tag })).toMatchObject({ status: 409, body: { code: 'PART_INACTIVE' } });
  await adminDb().from('ga_parts').update({ is_active: true }).eq('id', m3.part.id);
  expect((await create('ga_works', m3, { part_id: '00000000-0000-4000-8000-000000000000', reason: tag })).body.code).toBe('PART_NOT_FOUND');
  // 沒有採購單位換算的料件不能用採購單位
  const m4 = await mk('C8D', { partOver: { purchase_unit: null, purchase_to_base_rate: null } });
  expect(await create('ga_works', m4, { reason: tag, input_unit_type: 'PURCHASE' })).toMatchObject({ status: 422, body: { code: 'INVALID_PURCHASE_UNIT' } });
  expect((await create('ga_works', m4, { reason: tag, input_unit_type: 'BASE' })).status).toBe(201);
  expect(await countTransfers(tag)).toBe(2);
});

test('Q14 來源庫存不足仍可建單但回警告；冪等：同識別重送只有一張、內容不同 409；同時 6 次連點只建一張', async () => {
  const m = await mk('IDM', { srcQty: 10 });
  const tag = m7Name('IDM-REASON');
  const low = await create('ga_works', m, { reason: tag, quantity: 2 }); // 2 箱 = 24 個，庫存只有 10
  expect(low.status).toBe(201);
  expect(low.body.warnings[0]).toMatchObject({ code: 'LOW_STOCK', balance: 10, need: 24 });
  expect(low.body.warnings[0].message).toContain('庫存不足');
  const k = key();
  const a = await create('ga_works', m, { reason: tag + 'A', idempotency_key: k });
  const b = await create('ga_works', m, { reason: tag + 'A', idempotency_key: k });
  expect([a.status, b.status]).toEqual([201, 200]);
  expect(b.body.replay).toBe(true);
  expect(b.body.data.id).toBe(a.body.data.id);
  expect(await countTransfers(tag + 'A')).toBe(1);
  const c = await create('ga_works', m, { reason: tag + 'A', idempotency_key: k, quantity: 3 });
  expect(c.status).toBe(409);
  expect(c.body.code).toBe('IDEMPOTENCY_CONFLICT');
  const kk = key();
  const many = await Promise.all(Array.from({ length: 6 }, () => create('ga_works', m, { reason: tag + 'B', idempotency_key: kk })));
  expect(many.filter((x) => x.status === 201)).toHaveLength(1);
  expect(many.every((x) => x.status === 201 || x.status === 200)).toBe(true);
  expect(new Set(many.map((x) => x.body.data.id)).size).toBe(1);
  expect(await countTransfers(tag + 'B')).toBe(1);
});

// ----------------------------------------------------------------------------- 動作：主流程與 DB 回讀
test('主流程 DB 回讀：確認交出（扣來源、ISSUE 流水關聯）→ 運送中 → 收貨（入目的、RECEIPT 流水關聯）；備註不被清空；時間軸逐步記錄；詳情與 abilities', async () => {
  const m = await mk('FLOW');
  const t = await newTransfer(m, { notes: '建單備註 FLOW', shipping_method: undefined });
  const d0 = await get('ga_works', `/${t.id}`);
  expect(d0.status).toBe(200);
  expect(d0.body.data.abilities).toMatchObject({ confirm_source: true, ship: false, receive: false, cancel: true, problem: '' });
  // 確認交出：2 箱 = 24 個
  const c = await act('ga_works', t.id, 'confirm_source', t.v, { note: '倉庫已交出', shipping_method: '總務配送' });
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  expect(c.body.data).toMatchObject({ status: 'SOURCE_CONFIRMED', shipping_method: '總務配送' });
  expect(await bal(m.src.id, m.part.id)).toBe(26);
  const txs = await dbTx(m.src.id, m.part.id);
  expect(txs).toHaveLength(1);
  expect(txs[0]).toMatchObject({ transaction_type: 'ISSUE', reference_type: 'INVENTORY_TRANSFER', reference_id: t.id, reason: `調撥交出：${t.no}`, notes: '倉庫已交出' });
  expect(Number(txs[0].quantity_base)).toBe(-24);
  let items = await dbItems(t.id);
  expect(items[0].source_transaction_id).toBe(txs[0].id);
  expect(items[0].receipt_transaction_id).toBeNull();
  let row = await dbT(t.id);
  expect(row).toMatchObject({ status: 'SOURCE_CONFIRMED', source_confirmed_by: gaUserId, notes: '建單備註 FLOW', shipping_method: '總務配送' });
  expect(row.source_confirmed_at).not.toBeNull();
  // 運送中
  const s = await act('ga_works', t.id, 'ship', c.body.data.updated_at, { note: '物流取件' });
  expect(s.status).toBe(200);
  row = await dbT(t.id);
  expect(row).toMatchObject({ status: 'IN_TRANSIT', notes: '建單備註 FLOW' });
  expect(row.shipped_at).not.toBeNull();
  expect(await dbBal(m.dest.id, m.part.id)).toBeNull(); // 收貨之前目的庫存不增加
  // 收貨（另一個總務角色帳號）
  const rc = await act('ga_staff', t.id, 'receive', s.body.data.updated_at, { note: '門市已點收' });
  expect(rc.status, JSON.stringify(rc.body)).toBe(200);
  expect(rc.body.data.status).toBe('RECEIVED');
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
  expect(await bal(m.src.id, m.part.id)).toBe(26);
  const rtx = await dbTx(m.dest.id, m.part.id);
  expect(rtx).toHaveLength(1);
  expect(rtx[0]).toMatchObject({ transaction_type: 'RECEIPT', reference_type: 'INVENTORY_TRANSFER', reference_id: t.id, reason: `調撥收貨：${t.no}`, notes: '門市已點收' });
  items = await dbItems(t.id);
  expect(items[0].receipt_transaction_id).toBe(rtx[0].id);
  row = await dbT(t.id);
  expect(row).toMatchObject({ status: 'RECEIVED', notes: '建單備註 FLOW' });
  expect(row.received_by).not.toBeNull();
  expect(row.received_by).not.toBe(gaUserId); // 收貨的是另一個帳號
  const ev = await dbEvents(t.id);
  expect(ev.map((e) => `${e.action}:${e.from_status}>${e.to_status}`)).toEqual(['create:null>REQUESTED', 'confirm_source:REQUESTED>SOURCE_CONFIRMED', 'ship:SOURCE_CONFIRMED>IN_TRANSIT', 'receive:IN_TRANSIT>RECEIVED']);
  expect(ev.map((e) => e.note)).toEqual(['建單備註 FLOW', '倉庫已交出', '物流取件', '門市已點收']);
  const d = await get('ga_works', `/${t.id}`);
  expect(d.body.data.status).toBe('RECEIVED');
  expect(d.body.data.abilities).toMatchObject({ confirm_source: false, ship: false, receive: false, cancel: false });
  expect(d.body.data.events).toHaveLength(4);
  expect(d.body.data.events[1]).toMatchObject({ action: 'confirm_source', note: '倉庫已交出' });
  expect(d.body.data.events[1].creator_name).toBeTruthy();
  expect(d.body.data.items[0].part.name).toBe(m.part.name);
  expect(JSON.stringify(d.body)).not.toContain(gaUserId); // 不回傳使用者 id
  // G12 流水能辨識來源單據
  const tl = await j(await apis.ga_works.get(`${BASE}/transactions?locationId=${m.src.id}&source=transfer`));
  expect(tl.body.data[0].transfer_no).toBe(t.no);
});

test('動作驗證 400；狀態條件 409（錯誤的順序）；沒有 reopen；不存在的單 404', async () => {
  const m = await mk('STT');
  const t = await newTransfer(m);
  const base = { expected_updated_at: t.v, idempotency_key: key() };
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ['沒有動作', { action: '' }, /調撥動作/],
    ['reopen', { action: 'reopen' }, /調撥動作/],
    ['缺版本', { action: 'confirm_source', expected_updated_at: '' }, /expected_updated_at/],
    ['版本格式', { action: 'confirm_source', expected_updated_at: 'abc' }, /版本資訊格式/],
    ['缺識別碼', { action: 'confirm_source', idempotency_key: '' }, /識別碼/],
    ['取消沒原因', { action: 'cancel' }, /必須填寫原因/],
    ['異常其他沒說明', { action: 'cancel', exception_type: 'OTHER' }, /其他/],
    ['異常類型錯誤', { action: 'cancel', exception_type: 'NOT_RECEIVED' }, /異常類型/],
    ['退回庫存非布林', { action: 'cancel', note: 'x', return_stock: 'yes' }, /退回來源庫存/],
    ['退回庫存用在別的動作', { action: 'ship', return_stock: true }, /只能用在取消/],
    ['未知欄位', { action: 'confirm_source', status: 'RECEIVED' }, /不支援的欄位/],
    ['備註過長', { action: 'ship', note: 'x'.repeat(501) }, /500 字/],
    ['門市回報缺類型', { action: 'store_report' }, /問題類型/],
  ];
  for (const [label, over, re] of bad) {
    const r = await send('ga_works', 'post', `/${t.id}/actions`, { ...base, ...over });
    expect(r.status, label).toBe(400);
    expect(r.body.error, label).toMatch(re);
  }
  expect((await send('ga_works', 'post', `/${t.id}/actions`, null)).status).toBe(400);
  // 狀態條件：還沒交出不能運送中、收貨、註記未收
  for (const a of ['ship', 'receive', 'mark_unreceived']) {
    const r = await act('ga_works', t.id, a, t.v);
    expect(r.status, a).toBe(409);
    expect(r.body.code, a).toBe('INVALID_STATE');
  }
  expect((await dbT(t.id)).status).toBe('REQUESTED');
  expect((await act('ga_works', '00000000-0000-4000-8000-000000000000', 'confirm_source', t.v)).status).toBe(404);
  expect((await send('ga_works', 'post', '/not-a-uuid/actions', {})).status).toBe(400);
  // 完成後的動作
  const c = await act('ga_works', t.id, 'confirm_source', t.v);
  expect((await act('ga_works', t.id, 'confirm_source', c.body.data.updated_at)).body.code).toBe('INVALID_STATE');
  const r = await act('ga_works', t.id, 'receive', c.body.data.updated_at);
  expect(r.status).toBe(200);
  for (const a of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived']) {
    const x = await act('ga_works', t.id, a, r.body.data.updated_at, { note: '收貨之後' });
    expect(x.status, a).toBe(409);
  }
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
  expect(await bal(m.src.id, m.part.id)).toBe(26);
});

test('版本 STALE：兩人看到同一版本，第二個人按下去回 409 STALE，庫存只扣一次；動作冪等：同識別重送回原結果、不同動作用同識別 409', async () => {
  const m = await mk('STL');
  const t = await newTransfer(m);
  const a = await act('ga_works', t.id, 'confirm_source', t.v);
  expect(a.status).toBe(200);
  const b = await act('ga_staff', t.id, 'confirm_source', t.v);
  expect(b.status).toBe(409);
  expect(b.body.code).toBe('STALE');
  expect(await dbTx(m.src.id, m.part.id)).toHaveLength(1);
  // 冪等：同一個識別碼、同一個版本重送（連點、網路重試）
  const m2 = await mk('STL2');
  const t2 = await newTransfer(m2);
  const k = key();
  const r1 = await send('ga_works', 'post', `/${t2.id}/actions`, { action: 'confirm_source', expected_updated_at: t2.v, idempotency_key: k });
  const r2 = await send('ga_works', 'post', `/${t2.id}/actions`, { action: 'confirm_source', expected_updated_at: t2.v, idempotency_key: k });
  expect([r1.status, r2.status]).toEqual([200, 200]);
  expect(r1.body.replay).toBe(false);
  expect(r2.body.replay).toBe(true);
  expect(await dbTx(m2.src.id, m2.part.id)).toHaveLength(1);
  expect(await bal(m2.src.id, m2.part.id)).toBe(26);
  const r3 = await send('ga_works', 'post', `/${t2.id}/actions`, { action: 'ship', expected_updated_at: r1.body.data.updated_at, idempotency_key: k });
  expect(r3.status).toBe(409);
  expect(r3.body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await dbT(t2.id)).status).toBe('SOURCE_CONFIRMED');
});

test('併發：兩個總務同時按「確認交出」只成功一次；同一人連點 6 次（同識別）只扣一次庫存；兩人同時收貨只入庫一次', async () => {
  const m = await mk('CON');
  const t = await newTransfer(m);
  const [x, y] = await Promise.all([act('ga_works', t.id, 'confirm_source', t.v), act('ga_staff', t.id, 'confirm_source', t.v)]);
  expect([x.status, y.status].sort()).toEqual([200, 409]);
  expect((x.status === 409 ? x : y).body.code).toMatch(/STALE|INVALID_STATE/);
  expect(await dbTx(m.src.id, m.part.id)).toHaveLength(1);
  expect(await bal(m.src.id, m.part.id)).toBe(26);
  const v = (x.status === 200 ? x : y).body.data.updated_at as string;
  const [p, q] = await Promise.all([act('ga_works', t.id, 'receive', v), act('ga_staff', t.id, 'receive', v)]);
  expect([p.status, q.status].sort()).toEqual([200, 409]);
  expect(await dbTx(m.dest.id, m.part.id)).toHaveLength(1);
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
  // 連點
  const m2 = await mk('CON2');
  const t2 = await newTransfer(m2);
  const k = key();
  const many = await Promise.all(Array.from({ length: 6 }, () => send('ga_works', 'post', `/${t2.id}/actions`, { action: 'confirm_source', expected_updated_at: t2.v, idempotency_key: k })));
  expect(many.every((r) => r.status === 200)).toBe(true);
  expect(many.filter((r) => r.body.replay === false)).toHaveLength(1);
  expect(await dbTx(m2.src.id, m2.part.id)).toHaveLength(1);
  expect(await bal(m2.src.id, m2.part.id)).toBe(26);
});

test('失敗整體回復：來源庫存不足交出失敗、單子維持原狀、沒有流水；補庫存後可交出；允許負庫存的位置可交出；收貨時目的設定被停用失敗、狀態與庫存不變', async () => {
  const m = await mk('RBK', { srcQty: 10 });
  const t = await newTransfer(m);
  const f = await act('ga_works', t.id, 'confirm_source', t.v, { note: '要失敗' });
  expect(f.status).toBe(409);
  expect(f.body.code).toBe('INSUFFICIENT_STOCK');
  expect(f.body.error).toContain('庫存不足');
  expect((await dbT(t.id)).status).toBe('REQUESTED');
  expect(await dbTx(m.src.id, m.part.id)).toEqual([]);
  expect(await bal(m.src.id, m.part.id)).toBe(10);
  expect(await dbEvents(t.id)).toHaveLength(1); // 只有建單
  const cur = (await dbT(t.id)).updated_at as string;
  await adminDb().from('ga_inventory_balances').update({ quantity_base: 30 }).eq('location_id', m.src.id).eq('part_id', m.part.id);
  const ok = await act('ga_works', t.id, 'confirm_source', cur);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await bal(m.src.id, m.part.id)).toBe(6);
  // 允許負庫存
  const neg = await mk('RBN', { srcQty: 5, srcOver: { allow_negative_stock: true } });
  const tn = await newTransfer(neg);
  expect((await act('ga_works', tn.id, 'confirm_source', tn.v)).status).toBe(200);
  expect(await bal(neg.src.id, neg.part.id)).toBe(-19);
  // 收貨時目的設定被停用：審查補強後資料庫在調撥進行中就擋下停用（OPEN_TRANSFERS，細節見「審查補強 1」），所以改驗：停用被擋、狀態與庫存不變、仍可收貨
  const rv = await act('ga_works', t.id, 'ship', ok.body.data.updated_at);
  const off = await adminDb().from('ga_inventory_location_parts').update({ is_active: false }).eq('location_id', m.dest.id).eq('part_id', m.part.id);
  expect(off.error?.message ?? '').toContain('OPEN_TRANSFERS');
  expect((await dbT(t.id)).status).toBe('IN_TRANSIT');
  expect(await dbBal(m.dest.id, m.part.id)).toBeNull();
  expect(await dbTx(m.dest.id, m.part.id)).toEqual([]);
  expect((await dbItems(t.id))[0].receipt_transaction_id).toBeNull();
  expect((await act('ga_works', t.id, 'receive', rv.body.data.updated_at)).status).toBe(200);
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
});

// ----------------------------------------------------------------------------- 取消
test('Q12 取消：未交出直接取消；已交出可勾退回來源庫存（流水與調撥單關聯）或不退；退回一個沒交出的單 422；結構化異常類型；收貨後不能取消', async () => {
  // (a) 還沒交出：取消不動庫存；勾退回 422
  const a = await mk('CNA');
  const ta = await newTransfer(a);
  const bad = await act('ga_works', ta.id, 'cancel', ta.v, { note: '不要了', return_stock: true });
  expect(bad.status).toBe(422);
  expect(bad.body.code).toBe('NOTHING_TO_RETURN');
  expect((await dbT(ta.id)).status).toBe('REQUESTED');
  const ca = await act('ga_works', ta.id, 'cancel', ta.v, { note: '不要了' });
  expect(ca.status).toBe(200);
  expect(await dbT(ta.id)).toMatchObject({ status: 'CANCELED', cancel_reason: '不要了', exception_type: null });
  expect(await bal(a.src.id, a.part.id)).toBe(50);
  expect(await dbTx(a.src.id, a.part.id)).toEqual([]);
  // (b) 已交出 + 退回來源庫存
  const b = await mk('CNB');
  const tb = await newTransfer(b);
  const cb = await act('ga_works', tb.id, 'confirm_source', tb.v);
  expect(await bal(b.src.id, b.part.id)).toBe(26);
  const rb = await act('ga_works', tb.id, 'cancel', cb.body.data.updated_at, { note: '客戶取消', return_stock: true });
  expect(rb.status, JSON.stringify(rb.body)).toBe(200);
  expect(rb.body.data.returned_items).toBe(1);
  expect(await bal(b.src.id, b.part.id)).toBe(50);
  expect(await dbBal(b.dest.id, b.part.id)).toBeNull();
  const txs = await dbTx(b.src.id, b.part.id);
  expect(txs.map((x) => x.transaction_type)).toEqual(['ISSUE', 'RECEIPT']);
  expect(txs[1]).toMatchObject({ reference_type: 'INVENTORY_TRANSFER', reference_id: tb.id, reason: `調撥取消退回來源：${tb.no}` });
  expect(txs[1].metadata).toMatchObject({ action: 'return_stock' });
  const ib = (await dbItems(tb.id))[0];
  expect(ib.return_transaction_id).toBe(txs[1].id);
  expect(ib.receipt_transaction_id).toBeNull();
  expect(await dbT(tb.id)).toMatchObject({ status: 'CANCELED', cancel_reason: '客戶取消' });
  const evb = await dbEvents(tb.id);
  expect(evb[evb.length - 1]).toMatchObject({ action: 'cancel', to_status: 'CANCELED', note: '客戶取消' });
  expect(evb[evb.length - 1].metadata.return_stock).toBe(true);
  // G12 流水辨識「調撥退回來源庫存」
  const ret = await j(await apis.ga_works.get(`${BASE}/transactions?locationId=${b.src.id}&source=return_stock`));
  expect(ret.body.data).toHaveLength(1);
  expect(ret.body.data[0]).toMatchObject({ return_stock: true, transfer_no: tb.no });
  // (c) 已交出 + 不退回：來源庫存維持被扣
  const c = await mk('CNC');
  const tc = await newTransfer(c);
  const cc = await act('ga_works', tc.id, 'confirm_source', tc.v);
  const rc = await act('ga_works', tc.id, 'cancel', cc.body.data.updated_at, { note: '料件遺失', return_stock: false });
  expect(rc.status).toBe(200);
  expect(await bal(c.src.id, c.part.id)).toBe(26);
  expect((await dbItems(tc.id))[0].return_transaction_id).toBeNull();
  expect(await dbTx(c.src.id, c.part.id)).toHaveLength(1);
  // (d) 運送中 + 結構化異常類型（損壞）
  const d = await mk('CND');
  const td = await newTransfer(d);
  const cd = await act('ga_works', td.id, 'confirm_source', td.v);
  const sd = await act('ga_works', td.id, 'ship', cd.body.data.updated_at);
  const xd = await act('ga_works', td.id, 'cancel', sd.body.data.updated_at, { exception_type: 'DAMAGED', note: '外箱破損' });
  expect(xd.status).toBe(200);
  expect(await dbT(td.id)).toMatchObject({ status: 'CANCELED', exception_type: 'DAMAGED', cancel_reason: '調撥異常：損壞｜外箱破損' });
  expect(await bal(d.src.id, d.part.id)).toBe(26);
  expect(await dbBal(d.dest.id, d.part.id)).toBeNull();
  // 異常終結不填說明（類型不是其他）也可以
  const e = await mk('CNE');
  const te = await newTransfer(e);
  const ce = await act('ga_works', te.id, 'confirm_source', te.v);
  const xe = await act('ga_works', te.id, 'cancel', ce.body.data.updated_at, { exception_type: 'SHORT_RECEIVED', return_stock: true });
  expect(xe.status).toBe(200);
  expect(await dbT(te.id)).toMatchObject({ exception_type: 'SHORT_RECEIVED', cancel_reason: '調撥異常：少收' });
  expect(await bal(e.src.id, e.part.id)).toBe(50);
  // 已取消的單不能再處理
  for (const k of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived']) expect((await act('ga_works', ta.id, k, ca.body.data.updated_at, { note: 'x' })).status, k).toBe(409);
});

test('C9「未收」只是註記：單子仍待收貨、不動庫存、可重複註記、之後仍可收貨；沒有 reopen；備註不會覆蓋建單備註', async () => {
  const m = await mk('C9');
  const t = await newTransfer(m, { notes: '建單備註 C9' });
  expect((await act('ga_works', t.id, 'mark_unreceived', t.v, { note: '太早' })).status).toBe(409);
  const c = await act('ga_works', t.id, 'confirm_source', t.v);
  const u1 = await act('ga_works', t.id, 'mark_unreceived', c.body.data.updated_at, { note: '門市說還沒到' });
  expect(u1.status, JSON.stringify(u1.body)).toBe(200);
  expect(u1.body.data.status).toBe('SOURCE_CONFIRMED');
  let row = await dbT(t.id);
  expect(row).toMatchObject({ status: 'SOURCE_CONFIRMED', unreceived_note: '門市說還沒到', notes: '建單備註 C9', exception_type: null, cancel_reason: null });
  expect(row.unreceived_marked_at).not.toBeNull();
  expect(row.unreceived_marked_by).toBe(gaUserId);
  expect(await bal(m.src.id, m.part.id)).toBe(26);
  expect(await dbBal(m.dest.id, m.part.id)).toBeNull();
  // 仍可運送中、可再次註記（預設文字）、仍可收貨
  const d1 = await get('ga_works', `/${t.id}`);
  expect(d1.body.data.abilities).toMatchObject({ receive: true, ship: true, cancel: true, mark_unreceived: true });
  expect(d1.body.data.unreceived_marked_at).toBeTruthy();
  const s = await act('ga_works', t.id, 'ship', u1.body.data.updated_at);
  const u2 = await act('ga_works', t.id, 'mark_unreceived', s.body.data.updated_at);
  expect(u2.status).toBe(200);
  expect((await dbT(t.id)).unreceived_note).toBe('目的位置回報尚未收到');
  const rc = await act('ga_works', t.id, 'receive', u2.body.data.updated_at, { note: '終於到了' });
  expect(rc.status).toBe(200);
  row = await dbT(t.id);
  expect(row.status).toBe('RECEIVED');
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
  expect((await dbEvents(t.id)).map((e) => e.action)).toEqual(['create', 'confirm_source', 'mark_unreceived', 'ship', 'mark_unreceived', 'receive']);
  // 沒有 reopen
  const re = await act('ga_works', t.id, 'reopen', rc.body.data.updated_at);
  expect(re.status).toBe(400);
  expect(re.body.error).toContain('調撥動作');
});

// ----------------------------------------------------------------------------- C10 店長回報
test('C10 目的門市店長可回報問題（只寫標記與時間軸，不動狀態與庫存）；非目的門市店長、督導、區經理、總務都不能用門市回報；回報後列表與統計看得到', async () => {
  const m = await mk('C10'); // 目的 = ZT01 門市位置；store_manager 是 ZT01 店長
  const t = await newTransfer(m);
  const tag = (await dbT(t.id)).reason as string;
  // 還沒交出：不能回報
  expect((await act('store_manager', t.id, 'store_report', t.v, { report_type: 'NOT_ARRIVED' })).status).toBe(409);
  const c = await act('ga_works', t.id, 'confirm_source', t.v);
  const v = c.body.data.updated_at as string;
  const balBefore = [await bal(m.src.id, m.part.id), await dbBal(m.dest.id, m.part.id)];
  // 沒權限的人
  for (const k of ['ga_store_manager_b', 'supervisor', 'roster_supervisor', 'roster_area_manager', 'ga_works', 'navigation', 'denied']) {
    const r = await act(k, t.id, 'store_report', v, { report_type: 'NOT_ARRIVED', note: '偷偷回報' });
    expect([403, 404], k).toContain(r.status);
  }
  expect((await dbT(t.id)).store_report_type).toBeNull();
  // 驗證
  expect((await act('store_manager', t.id, 'store_report', v, { report_type: 'BAD' })).status).toBe(400);
  expect((await act('store_manager', t.id, 'store_report', v, { report_type: 'OTHER' })).status).toBe(400);
  // 店長不能做調撥動作
  for (const a of ['receive', 'cancel', 'mark_unreceived', 'ship']) expect((await act('store_manager', t.id, a, v, { note: '我想收' })).status, a).toBe(403);
  // 成功
  const k = key();
  const r1 = await send('store_manager', 'post', `/${t.id}/actions`, { action: 'store_report', expected_updated_at: v, idempotency_key: k, report_type: 'DAMAGED', note: '外箱破損' });
  expect(r1.status, JSON.stringify(r1.body)).toBe(200);
  const row = await dbT(t.id);
  expect(row).toMatchObject({ status: 'SOURCE_CONFIRMED', store_report_type: 'DAMAGED', store_report_note: '外箱破損' });
  expect(row.store_reported_at).not.toBeNull();
  expect([await bal(m.src.id, m.part.id), await dbBal(m.dest.id, m.part.id)]).toEqual(balBefore);
  expect(await dbTx(m.dest.id, m.part.id)).toEqual([]);
  const ev = (await dbEvents(t.id)).pop();
  expect(ev).toMatchObject({ action: 'store_report', note: '外箱破損', from_status: 'SOURCE_CONFIRMED', to_status: 'SOURCE_CONFIRMED' });
  expect(ev.metadata.report_type).toBe('DAMAGED');
  // 冪等重送
  const r2 = await send('store_manager', 'post', `/${t.id}/actions`, { action: 'store_report', expected_updated_at: v, idempotency_key: k, report_type: 'DAMAGED', note: '外箱破損' });
  expect(r2.status).toBe(200);
  expect(r2.body.replay).toBe(true);
  expect((await dbEvents(t.id)).filter((e) => e.action === 'store_report')).toHaveLength(1);
  // 舊版本 STALE
  expect((await act('store_manager', t.id, 'store_report', v, { report_type: 'OTHER', note: '再回報' })).body.code).toBe('STALE');
  // 總務看得到紅標與統計
  const list = await get('ga_works', `?search=${encodeURIComponent(tag)}`);
  expect(list.body.data[0]).toMatchObject({ has_store_report: true, store_report_type: 'DAMAGED', store_report_note: '外箱破損' });
  expect(list.body.stats.reported).toBeGreaterThanOrEqual(1);
  expect(ids(await get('ga_works', `?reported=true&search=${encodeURIComponent(tag)}`))).toEqual([t.id]);
  expect(ids(await get('ga_works', `?reported=false&search=${encodeURIComponent(m7Name('不存在'))}`))).toEqual([]);
  // 店長自己看得到自己的回報；也看得到「回報問題」按鈕能力
  const sm = await get('store_manager', `/${t.id}`);
  expect(sm.body.data.abilities).toMatchObject({ store_report: true, receive: false, cancel: false, confirm_source: false });
  expect(sm.body.data.store_report_note).toBe('外箱破損');
  const other = await get('ga_store_manager_b', `/${t.id}`);
  expect(other.status).toBe(404);
  const sup = await get('roster_supervisor', `/${t.id}`);
  expect(sup.body.data.abilities.store_report).toBe(false);
  // 收貨後仍可回報（例如點收後才發現數量不足），已取消不行
  const rc = await act('ga_works', t.id, 'receive', (await dbT(t.id)).updated_at);
  expect(rc.status).toBe(200);
  expect((await act('store_manager', t.id, 'store_report', rc.body.data.updated_at, { report_type: 'SHORT_QUANTITY' })).status).toBe(200);
});

// ----------------------------------------------------------------------------- C11 逾期
test('C11 逾期天數設定與逾期篩選：預設 3 天；超過才算逾期；改設定後判斷跟著變；版本 STALE；權限；驗證', async () => {
  const s0 = await get('ga_works', '/settings');
  expect(s0.body.data.overdue_days).toBe(originalDays);
  // 先設成 3，造三張：交出 5 天前（逾期）、2 天前（不逾期）、5 天前但已收貨（不逾期）
  let cur = s0.body.data.updated_at as string;
  const set = async (days: unknown, k = 'ga_works', expected: string | null = cur) => send(k, 'patch', '/settings', { overdue_days: days, expected_updated_at: expected });
  const r3 = await set(3);
  expect(r3.status, JSON.stringify(r3.body)).toBe(200);
  cur = r3.body.data.updated_at;
  const a = await mk('OVA'), b = await mk('OVB'), c = await mk('OVC');
  const day = 86_400_000;
  const mkSeed = async (m: Made, label: string, status: string, ago: number) => {
    const t = await seedTransfer(m.src.id, m.dest.id, m.part.id, label, status);
    await adminDb().from('ga_inventory_transfers').update({ source_confirmed_at: new Date(Date.now() - ago * day).toISOString() }).eq('id', t.id);
    return t.id as string;
  };
  const ta = await mkSeed(a, 'OVA', 'IN_TRANSIT', 5);
  const tb = await mkSeed(b, 'OVB', 'SOURCE_CONFIRMED', 2);
  const tc = await mkSeed(c, 'OVC', 'RECEIVED', 5);
  const q = (extra = '') => `?search=${encodeURIComponent(m7Name('OV'))}${extra}`;
  const all = await get('ga_works', q());
  expect(all.body.stats.overdue).toBe(1);
  expect(all.body.data.find((x: any) => x.id === ta)).toMatchObject({ is_overdue: true, days_since_issued: 5 });
  expect(all.body.data.find((x: any) => x.id === tb)).toMatchObject({ is_overdue: false, days_since_issued: 2 });
  expect(all.body.data.find((x: any) => x.id === tc)).toMatchObject({ is_overdue: false, days_since_issued: null });
  expect(ids(await get('ga_works', q('&overdue=true')))).toEqual([ta]);
  expect((await get('ga_works', q('&overdue=true'))).body.total).toBe(1);
  // 改成 1 天：兩張在途的都逾期；改成 7 天：沒有
  const r1 = await set(1);
  cur = r1.body.data.updated_at;
  expect((await get('ga_works', q())).body.stats.overdue).toBe(2);
  expect(ids(await get('ga_works', q('&overdue=true'))).sort()).toEqual([ta, tb].sort());
  const r7 = await set(7);
  cur = r7.body.data.updated_at;
  expect((await get('ga_works', q())).body.stats.overdue).toBe(0);
  expect(ids(await get('ga_works', q('&overdue=true')))).toEqual([]);
  expect((await get('ga_works', '/settings')).body.data.overdue_days).toBe(7);
  expect(Number((await adminDb().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).single()).data!.overdue_days)).toBe(7);
  // 驗證與權限
  for (const bad of [0, 91, 1.5, 'abc', null]) expect((await set(bad)).status, String(bad)).toBe(400);
  expect((await send('ga_works', 'patch', '/settings', { overdue_days: 5 })).status).toBe(400);
  const stale = await set(5, 'ga_works', s0.body.data.updated_at);
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  for (const k of ['navigation', 'ga_inv_txn_only', 'store_manager', 'roster_supervisor', 'denied']) expect((await set(5, k)).status, k).toBe(403);
  expect((await get('ga_works', '/settings')).body.data.overdue_days).toBe(7);
  // 還原
  expect((await set(originalDays)).status).toBe(200);
  expect((await get('ga_works', '/settings')).body.data.overdue_days).toBe(originalDays);
});

// ----------------------------------------------------------------------------- 列表與詳情
test('列表：伺服端精確統計對資料庫核對、分頁上限 100、搜尋特殊字元不壞、狀態與位置篩選、排序；每個狀態都有', async () => {
  const marker = m7Name('LST');
  const m = await mk('LST');
  const created: string[] = [];
  for (let i = 0; i < 5; i += 1) created.push((await newTransfer(m, { reason: `${marker} ${i}` })).id);
  const c1 = await act('ga_works', created[1], 'confirm_source', (await dbT(created[1])).updated_at);
  await act('ga_works', created[2], 'confirm_source', (await dbT(created[2])).updated_at).then((r) => act('ga_works', created[2], 'ship', r.body.data.updated_at));
  await act('ga_works', created[3], 'cancel', (await dbT(created[3])).updated_at, { note: '取消' });
  void c1;
  const res = await get('ga_works', `?search=${encodeURIComponent(marker)}&pageSize=2&page=2`);
  expect(res.status).toBe(200);
  expect(res.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  expect(res.body.data).toHaveLength(2);
  expect(res.body.stats).toMatchObject({ all: 5, REQUESTED: 2, SOURCE_CONFIRMED: 1, IN_TRANSIT: 1, RECEIVED: 0, CANCELED: 1 });
  const db = ((await adminDb().from('ga_inventory_transfers').select('status').like('reason', `${marker}%`)).data || []) as any[];
  for (const st of ['REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT', 'CANCELED']) expect(res.body.stats[st], st).toBe(db.filter((x) => x.status === st).length);
  expect((await get('ga_works', `?search=${encodeURIComponent(marker)}&pageSize=1000`)).body.meta.pageSize).toBe(100);
  expect(ids(await get('ga_works', `?search=${encodeURIComponent(marker)}&status=CANCELED`))).toEqual([created[3]]);
  expect((await get('ga_works', `?search=${encodeURIComponent(marker)}&status=CANCELED`)).body.total).toBe(1);
  expect((await get('ga_works', `?status=BOGUS`)).status).toBe(400);
  expect((await get('ga_works', `?locationId=not-uuid`)).status).toBe(400);
  expect((await get('ga_works', `?locationId=${m.dest.id}&search=${encodeURIComponent(marker)}`)).body.total).toBe(5);
  expect((await get('ga_works', `?locationId=${m.src.id}&search=${encodeURIComponent(marker)}`)).body.total).toBe(5);
  expect((await get('ga_works', `?locationId=00000000-0000-4000-8000-000000000000&search=${encodeURIComponent(marker)}`)).body.total).toBe(0);
  // 搜尋含逗號、括號、雙引號：不會壞（舊版會 400／500）
  for (const term of ['a,b', '(x)', '"q"', "50%_", '\\']) expect((await get('ga_works', `?search=${encodeURIComponent(term)}`)).status, term).toBe(200);
  // 單號搜尋
  const one = await dbT(created[0]);
  expect(ids(await get('ga_works', `?search=${encodeURIComponent(one.transfer_no)}`))).toEqual([created[0]]);
  // 列內容：位置、料件、明細、abilities，不回使用者 id
  const row = res.body.data[0];
  expect(row.source_location.name).toBe(m.src.name);
  expect(row.destination_location.store).toBeTruthy();
  expect(row.items[0].part.name).toBe(m.part.name);
  expect(row.abilities).toBeTruthy();
  expect(row).not.toHaveProperty('created_by');
  expect(JSON.stringify(res.body)).not.toContain(gaUserId);
});

test('C12 名單身分（店長、督導、區經理）唯讀：只看跟自己門市有關的單、內部備註與未收註記與時間軸備註遮蔽、搜尋不能搜備註；店長回報說明保留', async () => {
  const m = await mk('C12');
  const other = await mk('C12B', { destStore: 'VW001' });
  const t = await newTransfer(m, { notes: '內部備註-機密-C12', reason: m7Name('C12-R1') });
  const o = await newTransfer(other, { reason: m7Name('C12-R2') });
  const c = await act('ga_works', t.id, 'confirm_source', t.v, { note: '內部交出備註-C12' });
  const u = await act('ga_works', t.id, 'mark_unreceived', c.body.data.updated_at, { note: '內部未收註記-C12' });
  await act('store_manager', t.id, 'store_report', u.body.data.updated_at, { report_type: 'OTHER', note: '店長回報說明-C12' });
  const tag = (await dbT(t.id)).reason as string;
  for (const k of ['store_manager', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    const list = await get(k, `?search=${encodeURIComponent(tag)}`);
    expect(list.status, k).toBe(200);
    expect(ids(list), k).toEqual([t.id]);
    const text = JSON.stringify(list.body);
    for (const secret of ['內部備註-機密-C12', '內部交出備註-C12', '內部未收註記-C12']) expect(text, `${k} ${secret}`).not.toContain(secret);
    expect(list.body.permissions).toMatchObject({ internal: false, canCreate: false });
    expect(list.body.data[0].notes).toBeNull();
    const d = await get(k, `/${t.id}`);
    expect(d.status, k).toBe(200);
    const dt = JSON.stringify(d.body);
    for (const secret of ['內部備註-機密-C12', '內部交出備註-C12', '內部未收註記-C12']) expect(dt, `${k} detail ${secret}`).not.toContain(secret);
    expect(dt).toContain('店長回報說明-C12');
    expect(d.body.data.events.find((e: any) => e.action === 'confirm_source').note).toBeNull();
    expect(d.body.data.abilities).toMatchObject({ confirm_source: false, ship: false, receive: false, cancel: false, mark_unreceived: false });
    // 搜尋備註沒有作用（遮蔽的欄位不能拿來猜內容）
    expect(ids(await get(k, `?search=${encodeURIComponent('內部備註-機密-C12')}`)), k).toEqual([]);
    expect((await get(k, `/${o.id}`)).status, `${k} 別店的單`).toBe(404);
  }
  // 別家門市（VW001 店長）只看得到自己門市的單
  const b = await get('ga_store_manager_b', `?search=${encodeURIComponent(m7Name('C12'))}`);
  expect(ids(b)).toEqual([o.id]);
  // 總務看得到全部內部欄位
  const ga = JSON.stringify((await get('ga_works', `/${t.id}`)).body);
  for (const secret of ['內部備註-機密-C12', '內部交出備註-C12', '內部未收註記-C12']) expect(ga).toContain(secret);
  expect(ids(await get('ga_works', `?search=${encodeURIComponent('內部備註-機密-C12')}`))).toEqual([t.id]);
});

// ----------------------------------------------------------------------------- 需求單連結
test('需求單連結：驗證需求單、剩餘需求量（含單位換算）、處理單與單據連結、各動作同步、不覆蓋進行中處理單、已結案與不存在被擋', async () => {
  const m = await mk('REQ');
  const req = await seedServiceRequest('ZT01', m.part.id, 'REQ-A', 'IN_PROGRESS', gaUserId);
  await adminDb().from('ga_service_requests').update({ desired_quantity: 36, desired_unit: '個' }).eq('id', req.id);
  const tag = m7Name('REQ-REASON');
  // 36 個需求；調撥 2 箱 = 24 個：可以
  const t1 = await create('ga_works', m, { request_id: req.id, reason: tag, quantity: 2 });
  expect(t1.status, JSON.stringify(t1.body)).toBe(201);
  const ful = (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', req.id).single()).data as any;
  expect(ful).toMatchObject({ status: 'TRANSFER', unit: '個', current_step: '已建立調撥單，等待來源確認' });
  expect(Number(ful.requested_quantity)).toBe(36);
  const docs = async () => ((await adminDb().from('ga_part_fulfillment_documents').select('*').eq('fulfillment_id', ful.id).order('created_at')).data || []) as any[];
  expect(await docs()).toHaveLength(1);
  expect(await docs()).toMatchObject([{ document_type: 'TRANSFER', document_id: t1.body.data.id, document_no: t1.body.data.transfer_no, status: 'REQUESTED' }]);
  expect(Number((await docs())[0].quantity)).toBe(24);
  // 單據數量以需求單的單位（個）記錄：24；剩餘 12 個。再調 40 個超過、10 個可以。
  const over = await create('ga_works', m, { request_id: req.id, reason: tag, quantity: 40, input_unit_type: 'BASE' });
  expect(over.status).toBe(422);
  expect(over.body.code).toBe('EXCEEDS_REMAINING_REQUEST');
  expect(over.body.error).toContain('剩餘需求量');
  const ok2 = await create('ga_works', m, { request_id: req.id, reason: tag, quantity: 10, input_unit_type: 'BASE' });
  expect(ok2.status).toBe(201);
  expect(await docs()).toHaveLength(2);
  // 動作同步到單據與處理單
  const c = await act('ga_works', t1.body.data.id, 'confirm_source', t1.body.data.updated_at);
  expect((await docs())[0].status).toBe('SOURCE_CONFIRMED');
  expect(((await adminDb().from('ga_part_fulfillments').select('current_step').eq('id', ful.id).single()).data as any).current_step).toBe('來源已交出，等待運送');
  const s = await act('ga_works', t1.body.data.id, 'ship', c.body.data.updated_at);
  expect(((await adminDb().from('ga_part_fulfillments').select('current_step').eq('id', ful.id).single()).data as any).current_step).toBe('調撥運送中');
  const r = await act('ga_works', t1.body.data.id, 'receive', s.body.data.updated_at);
  expect(r.status).toBe(200);
  const f2 = (await adminDb().from('ga_part_fulfillments').select('*').eq('id', ful.id).single()).data as any;
  expect(f2.status).toBe('TRANSFER');
  expect(Number(f2.fulfilled_quantity)).toBe(24); // 以需求單的單位（個）記：2 箱 = 24 個
  expect((await docs())[0].status).toBe('RECEIVED');
  // 取消另一張：處理單進入異常，單據取消
  const x = await act('ga_works', ok2.body.data.id, 'cancel', ok2.body.data.updated_at, { note: '改採購' });
  expect(x.status).toBe(200);
  expect((await docs())[1].status).toBe('CANCELED');
  expect(((await adminDb().from('ga_part_fulfillments').select('status,current_step').eq('id', ful.id).single()).data as any)).toMatchObject({ status: 'EXCEPTION', current_step: '調撥已取消，請重新決定處理方式' });
  // 不覆蓋進行中的其他處理方式
  const req2 = await seedServiceRequest('ZT01', m.part.id, 'REQ-B', 'IN_PROGRESS', gaUserId);
  const f3 = (await adminDb().from('ga_part_fulfillments').insert({ request_id: req2.id, status: 'PURCHASING', requested_quantity: 5, unit: '個', current_step: '已向廠商下單', created_by: gaUserId }).select('*').single()).data as any;
  const t3 = await create('ga_works', m, { request_id: req2.id, reason: tag, quantity: 1, input_unit_type: 'BASE' });
  expect(t3.status).toBe(201);
  expect(((await adminDb().from('ga_part_fulfillments').select('status,current_step').eq('id', f3.id).single()).data as any)).toMatchObject({ status: 'PURCHASING', current_step: '已向廠商下單' });
  expect(((await adminDb().from('ga_part_fulfillment_documents').select('status').eq('fulfillment_id', f3.id)).data as any[]).length).toBe(1);
  await act('ga_works', t3.body.data.id, 'confirm_source', t3.body.data.updated_at);
  expect(((await adminDb().from('ga_part_fulfillments').select('status,current_step').eq('id', f3.id).single()).data as any)).toMatchObject({ status: 'PURCHASING', current_step: '已向廠商下單' });
  // 已結案的需求單、不存在的需求單、料件不符
  const req3 = await seedServiceRequest('ZT01', m.part.id, 'REQ-C', 'COMPLETED', gaUserId);
  expect(await create('ga_works', m, { request_id: req3.id, reason: tag })).toMatchObject({ status: 409, body: { code: 'REQUEST_CLOSED' } });
  expect(await create('ga_works', m, { request_id: '00000000-0000-4000-8000-000000000000', reason: tag })).toMatchObject({ status: 404, body: { code: 'REQUEST_NOT_FOUND' } });
  const other = await mk('REQ2');
  const req4 = await seedServiceRequest('ZT01', other.part.id, 'REQ-D', 'IN_PROGRESS', gaUserId);
  expect(await create('ga_works', m, { request_id: req4.id, reason: tag })).toMatchObject({ status: 422, body: { code: 'REQUEST_PART_MISMATCH' } });
  // 處理單已結案不能再連結
  const req5 = await seedServiceRequest('ZT01', m.part.id, 'REQ-E', 'IN_PROGRESS', gaUserId);
  await adminDb().from('ga_part_fulfillments').insert({ request_id: req5.id, status: 'COMPLETED', requested_quantity: 5, created_by: gaUserId });
  expect(await create('ga_works', m, { request_id: req5.id, reason: tag })).toMatchObject({ status: 409, body: { code: 'REQUEST_CLOSED' } });
});

test('網址預填 API：驗證並帶入需求單、料件、數量與單位換算、來源與目的位置；無法帶入的列在 unresolved；沒有建單權限 403', async () => {
  const m = await mk('PRE');
  const req = await seedServiceRequest('ZT01', m.part.id, 'PRE-A', 'IN_PROGRESS', gaUserId);
  await adminDb().from('ga_service_requests').update({ desired_quantity: 3, desired_unit: '箱' }).eq('id', req.id);
  const zt01 = (await adminDb().from('stores').select('id').eq('store_code', 'ZT01').single()).data as any;
  const qs = (o: Record<string, string>) => `/prefill?${new URLSearchParams(o)}`;
  const full = await get('ga_works', qs({ fromRequestId: req.id, requestNo: req.request_no, partId: m.part.id, quantity: '3', sourceLocationId: m.src.id, destinationStoreId: zt01.id, reason: '需求單調撥', notes: '預填備註' }));
  expect(full.status, JSON.stringify(full.body)).toBe(200);
  expect(full.body.unresolved).toEqual([]);
  expect(full.body.values).toMatchObject({ request_id: req.id, request_no: req.request_no, part_id: m.part.id, quantity: 3, input_unit_type: 'PURCHASE', source_location_id: m.src.id, reason: '需求單調撥', notes: '預填備註' });
  expect(full.body.values.destination_location_id).toBe(m.dest.id); // 門市有設定這個料件的位置優先
  expect(full.body.shown.source.name).toBe(m.src.name);
  expect(full.body.shown.destination.store).toBeTruthy();
  expect(full.body.shown.part).toMatchObject({ part_id: m.part.id, source_balance: 50, destination_configured: true });
  // 單位對不上：以基本單位帶入並提醒
  await adminDb().from('ga_service_requests').update({ desired_unit: '包' }).eq('id', req.id);
  const odd = await get('ga_works', qs({ fromRequestId: req.id, quantity: '3' }));
  expect(odd.body.values.input_unit_type).toBe('BASE');
  expect(odd.body.notices.join('')).toContain('「包」');
  // 沒給 partId 時用需求單的料件、沒給門市時用需求單的門市
  expect(odd.body.values.part_id).toBe(m.part.id);
  expect(odd.body.values.destination_location_id).toBeTruthy();
  // 無法帶入：壞需求單、不存在需求單、壞數量、停用的料件、沒設定的來源、沒有位置的門市、壞 uuid
  const bad = await get('ga_works', qs({ fromRequestId: 'x', partId: 'y', quantity: '0', sourceLocationId: 'z', destinationStoreId: 'w' }));
  expect(bad.body.unresolved.map((u: any) => u.field).sort()).toEqual(['destinationStoreId', 'fromRequestId', 'partId', 'quantity', 'sourceLocationId']);
  expect(bad.body.values).toMatchObject({ request_id: null, part_id: null, quantity: null, source_location_id: null, destination_location_id: null });
  const gone = await get('ga_works', qs({ fromRequestId: '00000000-0000-4000-8000-000000000000', partId: '00000000-0000-4000-8000-000000000000' }));
  expect(gone.body.unresolved.map((u: any) => u.field).sort()).toEqual(['fromRequestId', 'partId']);
  const closed = await seedServiceRequest('ZT01', m.part.id, 'PRE-B', 'CANCELED', gaUserId);
  expect((await get('ga_works', qs({ fromRequestId: closed.id }))).body.unresolved[0]).toMatchObject({ field: 'fromRequestId' });
  const idle = await mk('PRE4', { srcQty: 0 }); // 有庫存的料件不能停用（G11 守衛），用沒有庫存的
  await adminDb().from('ga_parts').update({ is_active: false }).eq('id', idle.part.id);
  expect((await get('ga_works', qs({ partId: idle.part.id }))).body.unresolved[0].reason).toContain('已停用');
  const noCfg = await mk('PRE2', { srcCfg: false });
  expect((await get('ga_works', qs({ partId: noCfg.part.id, sourceLocationId: noCfg.src.id }))).body.unresolved[0]).toMatchObject({ field: 'sourceLocationId' });
  const vw = (await adminDb().from('stores').select('id').eq('store_code', 'ZT05').single()).data as any;
  expect((await get('ga_works', qs({ destinationStoreId: vw.id }))).body.unresolved[0]).toMatchObject({ field: 'destinationStoreId' });
  // 目的位置沒設定料件：仍帶入位置，提醒要先設定
  const nd = await mk('PRE3', { destCfg: false });
  const nn = await get('ga_works', qs({ partId: nd.part.id, destinationStoreId: zt01.id }));
  expect(nn.body.notices.join('')).toContain('還沒有設定這個料件');
  // 長度截斷與沒有權限
  expect((await get('ga_works', qs({ reason: 'x'.repeat(400), notes: 'y'.repeat(900) }))).body.values.reason).toHaveLength(200);
  for (const k of ['navigation', 'store_manager', 'denied', 'ga_inv_location_view']) expect((await get(k, qs({ partId: m.part.id }))).status, k).toBe(403);
  // 審查補強後預填門檻與建單相同（調撥管理、庫存交易管理、料件查看三個都要有），只有調撥管理的人也是 403 並說明缺哪個權限。
  const only = await get('ga_inv_transfer_only', qs({ partId: m.part.id }));
  expect(only.status).toBe(403);
  expect(JSON.stringify(only.body)).toContain('三個權限');
});

test('建單選項：位置搜尋與分頁；來源位置的料件與目的位置是否已設定（C8）、來源庫存；沒有料件查看時說明；權限與壞參數', async () => {
  const m = await mk('OPT', { destCfg: false });
  const extra: any[] = [];
  for (let i = 0; i < 22; i += 1) {
    const p = await seedPart(partCat.id, `OPT-X${String(i).padStart(2, '0')}`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
    await seedLocationPart(m.src.id, p.id);
    extra.push(p);
  }
  const locs = await get('ga_works', `/options?type=locations&search=${encodeURIComponent(m.dest.name)}`);
  expect(locs.status).toBe(200);
  expect(locs.body.data.map((x: any) => x.id)).toEqual([m.dest.id]);
  expect(locs.body.data[0].store).toBeTruthy();
  expect(locs.body.data[0]).not.toHaveProperty('description');
  const parts = await get('ga_works', `/options?type=parts&locationId=${m.src.id}&destinationLocationId=${m.dest.id}&pageSize=100`);
  expect(parts.body.total).toBe(23);
  const main = parts.body.data.find((x: any) => x.part_id === m.part.id);
  expect(main).toMatchObject({ source_balance: 50, destination_configured: false });
  await seedLocationPart(m.dest.id, m.part.id);
  const again = await get('ga_works', `/options?type=parts&locationId=${m.src.id}&destinationLocationId=${m.dest.id}&search=${encodeURIComponent(m.part.name)}`);
  expect(again.body.data).toHaveLength(1);
  expect(again.body.data[0].destination_configured).toBe(true);
  const page = await get('ga_works', `/options?type=parts&locationId=${m.src.id}`);
  expect(page.body.data).toHaveLength(20);
  expect(page.body.meta.total).toBe(23);
  expect(page.body.data[0].destination_configured).toBeNull();
  // 沒有料件查看：只能看到說明
  const noPart = await get('ga_inv_transfer_only', `/options?type=parts&locationId=${m.src.id}`);
  expect(noPart.status).toBe(200);
  expect(noPart.body).toMatchObject({ partCatalogAccess: false, data: [] });
  expect(noPart.body.message).toContain('料件查看');
  expect((await get('ga_works', `/options?type=parts`)).status).toBe(400);
  expect((await get('ga_works', `/options?type=parts&locationId=x`)).status).toBe(400);
  expect((await get('ga_works', `/options?type=nope`)).status).toBe(400);
  for (const k of ['navigation', 'store_manager', 'denied', 'roster_supervisor']) expect((await get(k, `/options?type=locations`)).status, k).toBe(403);
});

test('C2 位置停用卡單：有進行中調撥的位置不能停用（G11 守衛與調撥一起運作）；調撥結束後可停用', async () => {
  const m = await mk('C2T');
  const t = await newTransfer(m);
  const cur = ((await adminDb().from('ga_inventory_locations').select('updated_at').eq('id', m.dest.id).single()).data as any).updated_at;
  const r = await j(await apis.ga_works.patch(`${BASE}/locations/${m.dest.id}`, { data: { is_active: false, expected_updated_at: cur } }));
  expect(r.status).toBe(409);
  expect(r.body.code).toBe('OPEN_TRANSFERS');
  expect((await dbT(t.id)).status).toBe('REQUESTED');
  const x = await act('ga_works', t.id, 'cancel', t.v, { note: '結束' });
  expect(x.status).toBe(200);
  const cur2 = ((await adminDb().from('ga_inventory_locations').select('updated_at').eq('id', m.dest.id).single()).data as any).updated_at;
  const r2 = await j(await apis.ga_works.patch(`${BASE}/locations/${m.dest.id}`, { data: { is_active: false, expected_updated_at: cur2 } }));
  expect(r2.status, JSON.stringify(r2.body)).toBe(200);
  expect(((await adminDb().from('ga_inventory_locations').select('is_active').eq('id', m.dest.id).single()).data as any).is_active).toBe(false);
});

// ----------------------------------------------------------------------------- 審查補強（2026-11-11 第 3 批審查）
test('審查補強 1：進行中調撥使用的料件不能停用或軟刪除（交出後來源餘額 0 也一樣），否則收貨會 PART_INACTIVE 卡死；位置料件設定同理；完成後才放行', async () => {
  const m = await mk('RV1', { srcQty: 24 });
  const t = await newTransfer(m, { quantity: 2 });
  const c = await act('ga_works', t.id, 'confirm_source', t.v);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  expect(await bal(m.src.id, m.part.id)).toBe(0); // 來源餘額已 0，但單子在途中
  const off = await adminDb().from('ga_parts').update({ is_active: false }).eq('id', m.part.id);
  expect(off.error?.message ?? '').toContain('OPEN_TRANSFERS');
  // 軟刪除一律同時把 is_active 設為 false（正式刪除料件的資料庫函式也是）；只改 deleted_at 的直接更新會被料件驗證函式忽略，不算刪除。
  const del = await adminDb().from('ga_parts').update({ is_active: false, deleted_at: new Date().toISOString(), deleted_by: gaUserId, deletion_reason: '審查補強測試' }).eq('id', m.part.id);
  expect(del.error?.message ?? '').toContain('OPEN_TRANSFERS');
  expect((await adminDb().from('ga_parts').select('is_active,deleted_at').eq('id', m.part.id).single()).data as any).toMatchObject({ is_active: true, deleted_at: null });
  // 位置料件設定：用資料表直接更新（等同舊版畫面）也被擋（來源有進行中、目的有進行中）
  for (const loc of [m.src.id, m.dest.id]) {
    const lp = (await adminDb().from('ga_inventory_location_parts').select('id').eq('location_id', loc).eq('part_id', m.part.id).single()).data as any;
    const a = await adminDb().from('ga_inventory_location_parts').update({ is_active: false }).eq('id', lp.id);
    expect(a.error?.message ?? '', 'is_active').toContain('OPEN_TRANSFERS');
    const b = await adminDb().from('ga_inventory_location_parts').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('id', lp.id);
    expect(b.error?.message ?? '', 'deleted').toContain('OPEN_TRANSFERS');
  }
  // 位置換門市：進行中的待處理單也鎖住（目的門市不能被偷換）
  const vw = (await adminDb().from('stores').select('id').eq('store_code', 'VW001').single()).data as any;
  const mv = await adminDb().from('ga_inventory_locations').update({ store_id: vw.id }).eq('id', m.dest.id);
  expect(mv.error?.message ?? '').toContain('OPEN_TRANSFERS');
  // 收貨仍能完成
  const r = await act('ga_works', t.id, 'receive', c.body.data.updated_at);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(await bal(m.dest.id, m.part.id)).toBe(24);
  // 收貨後目的有庫存：停用料件改被庫存擋
  const after = await adminDb().from('ga_parts').update({ is_active: false }).eq('id', m.part.id);
  expect(after.error?.message ?? '').toContain('HAS_STOCK');
  // 沒有庫存也沒有進行中調撥的料件可以停用
  const free = await mk('RV1F', { srcQty: 0 });
  const ok = await adminDb().from('ga_parts').update({ is_active: false }).eq('id', free.part.id);
  expect(ok.error).toBeNull();
});

test('審查補強 3：同一張需求單第一次連結時三人同時建單，三張都成功、只有一個處理單、三筆單據連結（不會撞唯一鍵 500）', async () => {
  const m = await mk('RV3');
  const req = await seedServiceRequest('ZT01', m.part.id, 'RV3-A', 'IN_PROGRESS', gaUserId);
  await adminDb().from('ga_service_requests').update({ desired_quantity: 36, desired_unit: '個' }).eq('id', req.id);
  const tag = m7Name('RV3-REASON');
  const rs = await Promise.all([
    create('ga_works', m, { request_id: req.id, reason: tag, quantity: 1 }),
    create('ga_staff', m, { request_id: req.id, reason: tag, quantity: 1 }),
    create('ga_works', m, { request_id: req.id, reason: tag, quantity: 1 }),
  ]);
  expect(rs.map((r) => r.status), JSON.stringify(rs.map((r) => r.body))).toEqual([201, 201, 201]);
  const fuls = ((await adminDb().from('ga_part_fulfillments').select('id').eq('request_id', req.id)).data || []) as any[];
  expect(fuls).toHaveLength(1);
  const docs = ((await adminDb().from('ga_part_fulfillment_documents').select('quantity').eq('fulfillment_id', fuls[0].id)).data || []) as any[];
  expect(docs).toHaveLength(3);
  expect(docs.reduce((s, d) => s + Number(d.quantity), 0)).toBe(36); // 3 箱 = 36 個，剛好等於需求量
  // 第四張超過剩餘量：整筆被擋、不多一張單
  const over = await create('ga_works', m, { request_id: req.id, reason: tag, quantity: 1 });
  expect(over.status).toBe(422);
  expect(await countTransfers(tag)).toBe(3);
});

test('審查補強 6、13：建單預先驗證領用規則（不允許拆包、最小領用量、不允許小數），不會建單成功才在交出時失敗；同識別但單位不同視為衝突', async () => {
  const m = await mk('RV6', { partOver: { allow_unpacking: false, allow_fractional_issue: false, minimum_issue_qty: 6 } });
  const tag = m7Name('RV6-REASON');
  const unpack = await create('ga_works', m, { reason: tag, quantity: 18, input_unit_type: 'BASE' }); // 18 個 = 1.5 箱
  expect(unpack.status).toBe(422);
  expect(unpack.body.code).toBe('UNPACKING_NOT_ALLOWED');
  const min = await create('ga_works', m, { reason: tag, quantity: 4, input_unit_type: 'BASE' });
  expect(min.body.code).toBe('MINIMUM_ISSUE_NOT_MET');
  const frac = await create('ga_works', m, { reason: tag, quantity: 12.5, input_unit_type: 'BASE' });
  expect(frac.body.code).toBe('FRACTIONAL_NOT_ALLOWED');
  expect(await countTransfers(tag)).toBe(0);
  // 整箱可以，也能順利交出（建單時沒被擋的單，交出不會因領用規則失敗）
  const ok = await create('ga_works', m, { reason: tag, quantity: 1, input_unit_type: 'PURCHASE' });
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  const c = await act('ga_works', ok.body.data.id, 'confirm_source', ok.body.data.updated_at);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  // 一般料件：同識別、同數量、單位不同 -> 識別衝突
  const m2 = await mk('RV6B');
  const k2 = key();
  expect((await create('ga_works', m2, { quantity: 2, input_unit_type: 'PURCHASE', idempotency_key: k2 })).status).toBe(201);
  const diff = await create('ga_works', m2, { quantity: 2, input_unit_type: 'BASE', idempotency_key: k2 });
  expect(diff.status).toBe(409);
  expect(diff.body.code).toBe('IDEMPOTENCY_CONFLICT');
  const same = await create('ga_works', m2, { quantity: 2, input_unit_type: 'PURCHASE', idempotency_key: k2 });
  expect(same.body.replay).toBe(true);
});

test('審查補強 8：同一張需求單有兩張調撥單時，取消其中一張，處理單仍是調撥中；兩張都取消才變異常', async () => {
  const m = await mk('RV8');
  const req = await seedServiceRequest('ZT01', m.part.id, 'RV8-A', 'IN_PROGRESS', gaUserId);
  await adminDb().from('ga_service_requests').update({ desired_quantity: 36, desired_unit: '個' }).eq('id', req.id);
  const a = await create('ga_works', m, { request_id: req.id, quantity: 1 });
  const b = await create('ga_works', m, { request_id: req.id, quantity: 1 });
  expect([a.status, b.status]).toEqual([201, 201]);
  const ful = async () => (await adminDb().from('ga_part_fulfillments').select('status,current_step').eq('request_id', req.id).single()).data as any;
  const ca = await act('ga_works', a.body.data.id, 'cancel', a.body.data.updated_at, { note: '先取消一張' });
  expect(ca.status, JSON.stringify(ca.body)).toBe(200);
  expect(await ful()).toMatchObject({ status: 'TRANSFER' });
  expect((await ful()).current_step).toContain('其他調撥單仍在進行中');
  const cb = await act('ga_works', b.body.data.id, 'cancel', b.body.data.updated_at, { note: '全部取消' });
  expect(cb.status).toBe(200);
  expect(await ful()).toMatchObject({ status: 'EXCEPTION' });
});

test('審查補強 B1：取消原因（總務填的內部備註）對唯讀名單身分遮蔽，只留異常類型標籤；總務看得到全部', async () => {
  const m = await mk('RVB1');
  const t1 = await newTransfer(m, { reason: m7Name('RVB1-R1') });
  const c1 = await act('ga_works', t1.id, 'confirm_source', t1.v);
  const x1 = await act('ga_works', t1.id, 'cancel', c1.body.data.updated_at, { exception_type: 'DAMAGED', note: '內部取消備註-廠商出貨錯誤-RVB1' });
  expect(x1.status, JSON.stringify(x1.body)).toBe(200);
  const t2 = await newTransfer(m, { reason: m7Name('RVB1-R2') });
  const x2 = await act('ga_works', t2.id, 'cancel', t2.v, { note: '內部純取消備註-RVB1' });
  expect(x2.status).toBe(200);
  for (const k of ['store_manager', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    const d1 = await get(k, `/${t1.id}`);
    expect(d1.status, k).toBe(200);
    expect(JSON.stringify(d1.body), `${k} detail`).not.toContain('內部取消備註');
    expect(d1.body.data.cancel_reason, k).toBe('調撥異常：損壞');
    const d2 = await get(k, `/${t2.id}`);
    expect(JSON.stringify(d2.body), `${k} detail2`).not.toContain('內部純取消備註');
    expect(d2.body.data.cancel_reason, k).toBeNull();
    const list = await get(k, `?search=${encodeURIComponent(m7Name('RVB1'))}`);
    expect(JSON.stringify(list.body), `${k} list`).not.toContain('內部取消備註');
    expect(JSON.stringify(list.body), `${k} list2`).not.toContain('內部純取消備註');
  }
  const ga1 = (await get('ga_works', `/${t1.id}`)).body.data;
  expect(ga1.cancel_reason).toContain('內部取消備註-廠商出貨錯誤-RVB1');
  expect((await get('ga_works', `/${t2.id}`)).body.data.cancel_reason).toBe('內部純取消備註-RVB1');
});

test('審查補強 B6：網址預填讀需求單與餘額，門檻與建單相同（三個權限都要有）；缺哪個講清楚', async () => {
  const m = await mk('RVB6');
  const req = await seedServiceRequest('ZT01', m.part.id, 'RVB6-A', 'IN_PROGRESS', gaUserId);
  const q = `/prefill?${new URLSearchParams({ fromRequestId: req.id, sourceLocationId: m.src.id })}`;
  expect((await get('ga_works', q)).status).toBe(200);
  const a = await get('ga_inv_transfer_only', q);
  expect(a.status).toBe(403);
  expect(a.body.error).toContain('庫存交易管理');
  const b = await get('ga_inv_txn_only', q);
  expect(b.status).toBe(403);
  expect(b.body.error).toContain('調撥管理');
  for (const k of ['navigation', 'store_manager', 'roster_supervisor', 'denied']) expect((await get(k, q)).status, k).toBe(403);
});

test('審查補強 B4：過帳包裝不接受登入者直接帶參考單據（不能偽造調撥流水）；一般過帳與調撥動作的內部呼叫不受影響', async () => {
  const m = await mk('RVB4', { srcQty: 10 });
  const client = await rpcClientFor('ga_works');
  const fake = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: m.src.id, p_part_id: m.part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: '偽造', p_notes: null, p_idempotency_key: key(), p_reference_type: 'INVENTORY_TRANSFER', p_reference_id: crypto.randomUUID(), p_metadata: {} });
  expect(fake).toMatchObject({ ok: false, status: 403, code: 'REFERENCE_NOT_ALLOWED' });
  const fake2 = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: m.src.id, p_part_id: m.part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: '偽造', p_notes: null, p_idempotency_key: key(), p_metadata: { transfer_no: 'GAT-FAKE' } });
  expect(fake2.code).toBe('REFERENCE_NOT_ALLOWED');
  expect(await dbTx(m.src.id, m.part.id)).toEqual([]);
  expect(await bal(m.src.id, m.part.id)).toBe(10);
  // 一般過帳（沒有參考單據）仍可
  const okPost = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: m.src.id, p_part_id: m.part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: '一般領用', p_notes: null, p_idempotency_key: key() });
  expect(okPost.ok, JSON.stringify(okPost)).toBe(true);
  // 調撥動作交出：流水帶調撥參考
  const t = await newTransfer(m, { quantity: 1, input_unit_type: 'BASE' });
  const c = await act('ga_works', t.id, 'confirm_source', t.v);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  const tx = (await dbTx(m.src.id, m.part.id)).filter((x) => x.reference_type === 'INVENTORY_TRANSFER');
  expect(tx).toHaveLength(1);
  expect(tx[0].reference_id).toBe(t.id);
});
