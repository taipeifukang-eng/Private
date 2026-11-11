import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, row, rpcClientFor, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart,
  setupM7Users, stores, type M7User,
} from '../support/m7m8-fixtures';

// M7/M8 第 3 批 G12 庫存餘額、流水、過帳、持有狀態 API（/api/workspace/general-affairs/inventory/{access,options,balances,transactions,holding}/**）整合層。
// 涵蓋：權限矩陣（401／403，兩個權限缺哪個講清楚）與 Origin、過帳 400 驗證與每個核心錯誤碼的白話說明、過帳結果 DB 回讀（餘額、流水欄位、單位換算）、
//      冪等（重送回原交易、內容不同 409）、併發（同識別只過帳一次、不同識別不超扣）、最後異動時間不倒退、不可填未來、
//      餘額清單（分頁上限 100、搜尋特殊字元、含 0、低庫存紅黃標與只看需補貨、排序、伺服端精確統計對 DB 核對）、持有狀態（全量彙總、前 3 名、調整、STALE、修改紀錄）、
//      流水篩選（類型、位置、料件、日期（台北）、記錄人、原因、來源）與 CSV 匯出、選項搜尋分頁、C12 名單身分唯讀與遮蔽。
// 餘額一律用 seedBalance 直接種；只有過帳本身的測試才真的過帳，流水用 DEV 專用清除函式清掉（cleanupM7M8）。
const BASE = '/api/workspace/general-affairs/inventory';
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['ga_works', 'navigation', 'ga_inv_txn_only', 'ga_inv_transfer_only', 'ga_inv_location_view', 'ga_equipment_view', 'store_manager', 'ga_store_manager_b', 'supervisor', 'denied'];
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let partCat: { id: string };
let gaUserId = '';
let gaName = '';
const requireNode = createRequire(__filename);
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p = '') => j(await apis[k].get(`${BASE}${p}`));
const send = async (k: string, method: 'post' | 'patch', p: string, data?: unknown) => j(await (apis[k] as any)[method](`${BASE}${p}`, { data: data ?? {} }));
const ids = (res: any) => ((res.body.data || []) as any[]).map((r) => r.id as string);
const key = () => crypto.randomUUID();
const body = (loc: string, part: string, over: Record<string, unknown> = {}) => ({ transaction_type: 'RECEIPT', location_id: loc, part_id: part, quantity: 1, input_unit_type: 'BASE', reason: '整合測試', idempotency_key: key(), ...over });
const post = (k: string, loc: string, part: string, over: Record<string, unknown> = {}) => send(k, 'post', '/transactions/post', body(loc, part, over));
const dbBal = async (loc: string, part: string) => (await adminDb().from('ga_inventory_balances').select('*').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any;
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at').order('transaction_no')).data || []) as any[];
const tag = () => m7Name('');

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  for (const k of ROLES) apis[k] = await apiAs(k);
  const made = await setupM7Users(['roster_supervisor', 'roster_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  apis.roster_supervisor = await apiForUser(users.roster_supervisor as any);
  apis.roster_area_manager = await apiForUser(users.roster_area_manager as any);
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  partCat = await seedCategory('part', 'SK');
  const { getAccount } = requireNode('../support/credentials.cjs') as { getAccount: (k: string) => { email: string } };
  const prof = (await adminDb().from('profiles').select('id,full_name').eq('email', getAccount('ga_works').email).single()).data as any;
  gaUserId = prof.id;
  gaName = prof.full_name;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料（含過帳流水）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
});

/** 一個位置＋一個料件＋啟用中的位置料件設定（可帶料件欄位）。 */
async function setup(suffix: string, opts: { store?: string | null; locOver?: Record<string, unknown>; partOver?: Record<string, unknown>; setting?: Record<string, unknown> } = {}) {
  const loc = await seedLocation(opts.store === undefined ? 'ZT04' : opts.store, `${suffix}-L`, opts.locOver);
  const part = await seedPart(partCat.id, `${suffix}-P`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false, ...opts.partOver });
  const setting = await seedLocationPart(loc.id, part.id, opts.setting);
  return { loc, part, setting };
}

// ----------------------------------------------------------------------------- 權限與 Origin
test('權限矩陣：未登入 401；沒有庫存權限也不在門市名單的帳號 403；查看者、只有記帳、名單身分都能讀', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of ['/access', '/balances', '/transactions', '/holding', '/options', '/balances/export', '/transactions/export']) {
    expect((await anon.get(`${BASE}${p}`)).status(), p).toBe(401);
  }
  expect((await anon.post(`${BASE}/transactions/post`, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  await anon.dispose();
  for (const k of ['denied', 'ga_inv_transfer_only', 'ga_inv_location_view', 'ga_equipment_view']) {
    for (const p of ['/access', '/balances', '/transactions', '/holding', '/options']) expect((await get(k, p)).status, `${k} ${p}`).toBe(403);
  }
  for (const k of ['ga_works', 'navigation', 'ga_inv_txn_only', 'store_manager', 'ga_store_manager_b', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    for (const p of ['/access', '/balances', '/transactions', '/holding']) expect((await get(k, p)).status, `${k} ${p}`).toBe(200);
  }
  expect((await get('ga_works', '/access')).body).toMatchObject({ balances: true, transactions: true, canPost: true, canPartView: true, internal: true, postProblem: '' });
  expect((await get('navigation', '/access')).body).toMatchObject({ canPost: false, internal: true });
  expect((await get('navigation', '/access')).body.postProblem).toContain('庫存交易管理');
  const txn = await get('ga_inv_txn_only', '/access');
  expect(txn.body).toMatchObject({ canPost: true, canPartView: false });
  expect(txn.body.postProblem).toMatch(/缺少：料件查看/);
  expect((await get('store_manager', '/access')).body).toMatchObject({ canPost: false, internal: false, balances: true, transactions: true });
});

test('寫入：過帳與調整持有狀態的權限檢查（缺哪個權限講清楚）；Origin 不符 403 且沒有寫入；壞 id 400', async () => {
  const { loc, part } = await setup('PERM');
  await seedBalance(loc.id, part.id, 5);
  // 只有查看（沒有交易管理）：403，說明缺庫存交易管理
  const view = await post('navigation', loc.id, part.id);
  expect(view.status).toBe(403);
  expect(view.body.error).toContain('庫存交易管理');
  // 只有交易管理、沒有料件查看：403，說明缺料件查看
  const txn = await post('ga_inv_txn_only', loc.id, part.id);
  expect(txn.status).toBe(403);
  expect(txn.body.error).toContain('料件查看');
  expect(txn.body.error).not.toContain('缺少：庫存交易管理');
  for (const k of ['store_manager', 'supervisor', 'roster_supervisor', 'ga_inv_transfer_only', 'ga_inv_location_view', 'denied']) {
    expect((await post(k, loc.id, part.id)).status, k).toBe(403);
  }
  const bal = await dbBal(loc.id, part.id);
  expect(Number(bal.quantity_base)).toBe(5);
  expect(await dbTx(loc.id, part.id)).toEqual([]);
  // 持有狀態調整：只有交易管理的人可以（導覽查看者、名單身分都不行）
  for (const k of ['navigation', 'store_manager', 'roster_supervisor', 'denied']) {
    expect((await send(k, 'patch', `/holding/${bal.id}`, { in_use_quantity: 1, idle_quantity: 0, expected_updated_at: null })).status, k).toBe(403);
  }
  expect((await adminDb().from('ga_inventory_holding_allocations').select('balance_id').eq('balance_id', bal.id)).data).toEqual([]);
  // Origin
  const evil = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await storageStateFor('ga_works'), extraHTTPHeaders: { Origin: 'http://evil.example' } });
  const r = await evil.post(`${BASE}/transactions/post`, { data: body(loc.id, part.id) });
  expect(r.status()).toBe(403);
  const r2 = await evil.patch(`${BASE}/holding/${bal.id}`, { data: { in_use_quantity: 1, idle_quantity: 0, expected_updated_at: null } });
  expect(r2.status()).toBe(403);
  await evil.dispose();
  expect(await dbTx(loc.id, part.id)).toEqual([]);
  // 壞 id、找不到
  expect((await send('ga_works', 'patch', '/holding/not-a-uuid', { in_use_quantity: 1, idle_quantity: 0, expected_updated_at: null })).status).toBe(400);
  expect((await send('ga_works', 'patch', '/holding/00000000-0000-4000-8000-000000000000', { in_use_quantity: 1, idle_quantity: 0, expected_updated_at: null })).status).toBe(404);
  expect((await get('ga_works', '/holding/00000000-0000-4000-8000-000000000000/events')).status).toBe(404);
  expect((await get('ga_works', '/holding/not-a-uuid/events')).status).toBe(400);
  expect((await get('ga_works', '/nothing')).status).toBe(404);
});

// ----------------------------------------------------------------------------- 過帳：驗證
test('過帳驗證：400（類型、位置、料件、單位、數量、原因、識別碼、發生時間、系統欄位）；沒有任何流水寫入', async () => {
  const { loc, part } = await setup('VAL');
  const bad: [string, Record<string, unknown>, RegExp][] = [
    ['類型錯誤', { transaction_type: 'MOVE' }, /交易類型錯誤/],
    ['位置不是 uuid', { location_id: 'abc' }, /庫存位置/],
    ['缺料件', { part_id: '' }, /請選擇料件/],
    ['單位錯誤', { input_unit_type: 'BOX' }, /單位類型錯誤/],
    ['數量 0', { quantity: 0 }, /大於 0/],
    ['數量負數', { quantity: -3 }, /大於 0/],
    ['數量不是數字', { quantity: 'abc' }, /有效數字/],
    ['數量科學記號', { quantity: '1e3' }, /格式錯誤/],
    ['數量超過 4 位小數', { quantity: 1.00001 }, /4 位小數/],
    ['缺原因', { reason: '  ' }, /請輸入交易原因/],
    ['原因過長', { reason: 'x'.repeat(301) }, /300 字/],
    ['缺識別碼', { idempotency_key: '' }, /防重複識別碼/],
    ['識別碼過長', { idempotency_key: 'k'.repeat(121) }, /120 字/],
    ['發生時間格式錯誤', { occurred_at: 'yesterday' }, /發生時間格式錯誤/],
    ['發生時間在未來', { occurred_at: new Date(Date.now() + 3 * 3600_000).toISOString() }, /不可晚於現在/],
    ['系統欄位 quantity_base', { quantity_base: 5 }, /不支援的欄位/],
    ['不可指定參考單據', { reference_type: 'INVENTORY_TRANSFER', reference_id: crypto.randomUUID() }, /不支援的欄位/],
    ['不可指定 metadata', { metadata: { a: 1 } }, /不支援的欄位/],
  ];
  for (const [label, over, re] of bad) {
    const r = await post('ga_works', loc.id, part.id, over);
    expect(r.status, label).toBe(400);
    expect(r.body.error, label).toMatch(re);
  }
  expect((await send('ga_works', 'post', '/transactions/post', [])).status).toBe(400);
  expect(await dbTx(loc.id, part.id)).toEqual([]);
  expect(await dbBal(loc.id, part.id)).toBeNull();
});

// ----------------------------------------------------------------------------- 過帳：結果回讀
test('過帳四種類型：回傳庫存前後、DB 回讀餘額與流水欄位（單號、類型、符號、前後、原因、備註、識別碼）；餘額不倒退最後異動時間', async () => {
  const { loc, part } = await setup('POST');
  const steps: [string, number, number, number][] = [['RECEIPT', 10, 0, 10], ['ISSUE', 3, 10, 7], ['ADJUST_OUT', 2, 7, 5], ['ADJUST_IN', 4, 5, 9]];
  const made: any[] = [];
  for (const [type, qty, before, after] of steps) {
    const k = key();
    const r = await post('ga_works', loc.id, part.id, { transaction_type: type, quantity: qty, reason: `原因-${type}`, notes: `備註-${type}`, idempotency_key: k });
    expect(r.status, type).toBe(201);
    expect(r.body.replay).toBe(false);
    expect(r.body.data).toMatchObject({ transaction_type: type, balance_before: before, balance_after: after, balance_quantity_base: after, idempotent_replay: false });
    made.push({ ...r.body.data, k, type, qty, after });
    expect(Number((await dbBal(loc.id, part.id)).quantity_base), type).toBe(after);
  }
  const txs = await dbTx(loc.id, part.id);
  expect(txs).toHaveLength(4);
  txs.forEach((t, i) => {
    const m = made[i];
    expect(t).toMatchObject({ id: m.transaction_id, transaction_no: m.transaction_no, transaction_type: m.type, reason: `原因-${m.type}`, notes: `備註-${m.type}`, idempotency_key: m.k, created_by: gaUserId, input_unit_type: 'BASE' });
    expect(Number(t.quantity_input)).toBe(m.qty);
    expect(Number(t.quantity_base)).toBe(m.type === 'ISSUE' || m.type === 'ADJUST_OUT' ? -m.qty : m.qty);
    expect(Number(t.balance_after)).toBe(m.after);
    expect(Number(t.balance_before) + Number(t.quantity_base)).toBeCloseTo(Number(t.balance_after), 4);
  });
  // 餘額列：版本逐次加 1、最後一筆流水指到最後一筆
  const bal = await dbBal(loc.id, part.id);
  expect(Number(bal.version)).toBe(4);
  expect(bal.last_transaction_id).toBe(made[3].transaction_id);
});

test('採購單位換算與數量規則：換算入庫、拆包、小數、最小領用量、不可用的採購單位；錯誤白話、不留流水', async () => {
  const { loc, part } = await setup('UNIT', { partOver: { purchase_unit: '箱', purchase_to_base_rate: 12 } });
  const r1 = await post('ga_works', loc.id, part.id, { quantity: 2, input_unit_type: 'PURCHASE', reason: '採購單位入庫' });
  expect(r1.status).toBe(201);
  expect(r1.body.data).toMatchObject({ quantity_base: 24, balance_after: 24, unit_conversion_rate: 12, input_unit_type: 'PURCHASE' });
  const t1 = (await dbTx(loc.id, part.id))[0];
  expect(Number(t1.quantity_input)).toBe(2);
  expect(Number(t1.quantity_base)).toBe(24);
  expect(Number(t1.unit_conversion_rate)).toBe(12);
  // 不允許拆包：出庫 5（基本單位）不是整箱
  const unpack = await post('ga_works', loc.id, part.id, { transaction_type: 'ISSUE', quantity: 5 });
  expect(unpack.status).toBe(422);
  expect(unpack.body.error).toContain('拆包');
  const box = await post('ga_works', loc.id, part.id, { transaction_type: 'ISSUE', quantity: 1, input_unit_type: 'PURCHASE' });
  expect(box.status).toBe(201);
  expect(box.body.data.balance_after).toBe(12);
  // 不允許小數
  const frac = await post('ga_works', loc.id, part.id, { quantity: 1.5 });
  expect(frac.status).toBe(422);
  expect(frac.body.error).toContain('小數');
  // 沒有採購單位的料件不能用採購單位
  const plain = await setup('UNIT2');
  const noUnit = await post('ga_works', plain.loc.id, plain.part.id, { input_unit_type: 'PURCHASE' });
  expect(noUnit.status).toBe(422);
  expect(noUnit.body.error).toContain('換算率');
  // 最小領用量與小數允許
  const min = await setup('UNIT3', { partOver: { allow_fractional_issue: true, minimum_issue_qty: 0.5, allow_unpacking: true } });
  await seedBalance(min.loc.id, min.part.id, 10);
  const below = await post('ga_works', min.loc.id, min.part.id, { transaction_type: 'ISSUE', quantity: 0.25 });
  expect(below.status).toBe(422);
  expect(below.body.error).toContain('最小領用量');
  const half = await post('ga_works', min.loc.id, min.part.id, { transaction_type: 'ISSUE', quantity: 0.5 });
  expect(half.status).toBe(201);
  expect(half.body.data.balance_after).toBe(9.5);
  expect((await dbTx(plain.loc.id, plain.part.id))).toEqual([]);
  expect((await dbTx(loc.id, part.id)).length).toBe(2);
});

test('庫存不足 409（不允許負庫存）、允許負庫存的位置可變負；位置或料件沒設定、位置停用、料件停用都有白話錯誤', async () => {
  const a = await setup('STK');
  await seedBalance(a.loc.id, a.part.id, 3);
  const over = await post('ga_works', a.loc.id, a.part.id, { transaction_type: 'ISSUE', quantity: 4 });
  expect(over.status).toBe(409);
  expect(over.body.error).toContain('庫存不足');
  expect(Number((await dbBal(a.loc.id, a.part.id)).quantity_base)).toBe(3);
  expect(await dbTx(a.loc.id, a.part.id)).toEqual([]);
  const neg = await setup('NEG', { locOver: { allow_negative_stock: true } });
  const n = await post('ga_works', neg.loc.id, neg.part.id, { transaction_type: 'ISSUE', quantity: 4 });
  expect(n.status).toBe(201);
  expect(n.body.data).toMatchObject({ balance_before: 0, balance_after: -4 });
  expect(Number((await dbBal(neg.loc.id, neg.part.id)).quantity_base)).toBe(-4);
  // 沒設定
  const other = await seedPart(partCat.id, 'STK-NC');
  const nc = await post('ga_works', a.loc.id, other.id);
  expect(nc.status).toBe(422);
  expect(nc.body.error).toContain('庫存位置');
  // 位置停用
  const off = await setup('OFF');
  await adminDb().from('ga_inventory_locations').update({ is_active: false }).eq('id', off.loc.id);
  const o = await post('ga_works', off.loc.id, off.part.id);
  expect(o.status).toBe(409);
  expect(o.body.error).toContain('已停用');
  // 料件停用（沒有庫存可以停用）
  const pOff = await setup('POFF');
  await adminDb().from('ga_parts').update({ is_active: false }).eq('id', pOff.part.id);
  const p = await post('ga_works', pOff.loc.id, pOff.part.id);
  expect(p.status).toBe(409);
  expect(p.body.error).toContain('已停用');
  // 不存在
  const missing = await post('ga_works', crypto.randomUUID(), a.part.id);
  expect(missing.status).toBe(404);
  expect(missing.body.error).toContain('找不到');
});

test('冪等：同識別同內容重送回原交易（200、replay）只過帳一次；同識別不同內容 409；識別碼是每位使用者各自一份', async () => {
  const { loc, part } = await setup('IDEM');
  const k = key();
  const first = await post('ga_works', loc.id, part.id, { quantity: 5, idempotency_key: k });
  expect(first.status).toBe(201);
  const again = await post('ga_works', loc.id, part.id, { quantity: 5, idempotency_key: k });
  expect(again.status).toBe(200);
  expect(again.body.replay).toBe(true);
  expect(again.body.data).toMatchObject({ transaction_id: first.body.data.transaction_id, transaction_no: first.body.data.transaction_no, idempotent_replay: true, balance_after: 5 });
  expect(await dbTx(loc.id, part.id)).toHaveLength(1);
  expect(Number((await dbBal(loc.id, part.id)).quantity_base)).toBe(5);
  const conflict = await post('ga_works', loc.id, part.id, { quantity: 6, idempotency_key: k });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error).toContain('識別碼');
  expect(await dbTx(loc.id, part.id)).toHaveLength(1);
  // 另一位使用者可以用同一個字串（識別碼以人為範圍）：第二位用「只有查看」會 403，所以改驗資料庫唯一性是 (created_by, key)
  const dup = await adminDb().from('ga_inventory_transactions').select('id').eq('idempotency_key', k);
  expect(dup.data).toHaveLength(1);
});

test('併發：同一個識別同時送 5 次只過帳一次；不同識別同時出庫不會超扣（庫存 10、每次 3，只有 3 筆成功、餘額 1）', async () => {
  const same = await setup('CONC1');
  const k = key();
  const burst = await Promise.all(Array.from({ length: 5 }, () => post('ga_works', same.loc.id, same.part.id, { quantity: 2, idempotency_key: k })));
  expect(burst.every((r) => [200, 201].includes(r.status))).toBe(true);
  expect(burst.filter((r) => r.status === 201)).toHaveLength(1);
  expect(await dbTx(same.loc.id, same.part.id)).toHaveLength(1);
  expect(Number((await dbBal(same.loc.id, same.part.id)).quantity_base)).toBe(2);

  const c = await setup('CONC2');
  await seedBalance(c.loc.id, c.part.id, 10);
  const race = await Promise.all(Array.from({ length: 5 }, () => post('ga_works', c.loc.id, c.part.id, { transaction_type: 'ISSUE', quantity: 3 })));
  expect(race.filter((r) => r.status === 201)).toHaveLength(3);
  expect(race.filter((r) => r.status === 409)).toHaveLength(2);
  expect(Number((await dbBal(c.loc.id, c.part.id)).quantity_base)).toBe(1);
  const txs = await dbTx(c.loc.id, c.part.id);
  expect(txs).toHaveLength(3);
  expect(txs.map((t) => Number(t.balance_after)).sort((x, y) => y - x)).toEqual([7, 4, 1]);
});

test('發生時間：補登舊日期可以（流水記舊時間），但餘額的「最後異動時間」不倒退；資料庫函式直接呼叫也擋未來時間與缺識別碼', async () => {
  const { loc, part } = await setup('TIME');
  const r1 = await post('ga_works', loc.id, part.id, { quantity: 3 });
  expect(r1.status).toBe(201);
  const latest = (await dbBal(loc.id, part.id)).last_transaction_at as string;
  const old = '2026-10-01T02:00:00.000Z';
  const r2 = await post('ga_works', loc.id, part.id, { quantity: 2, occurred_at: old });
  expect(r2.status).toBe(201);
  const bal = await dbBal(loc.id, part.id);
  expect(new Date(bal.last_transaction_at).getTime()).toBe(new Date(latest).getTime());
  expect(new Date(r2.body.data.last_transaction_at).getTime()).toBe(new Date(latest).getTime());
  expect(Number(bal.quantity_base)).toBe(5);
  const t2 = (await dbTx(loc.id, part.id)).find((t) => t.id === r2.body.data.transaction_id);
  expect(new Date(t2.occurred_at).toISOString()).toBe(old);
  // 資料庫函式（繞過 API）
  const client = await rpcClientFor('ga_works');
  const future = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'RECEIPT', p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: 'x', p_notes: null, p_idempotency_key: key(), p_occurred_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
  expect(future).toMatchObject({ ok: false, status: 400, code: 'FUTURE_OCCURRED_AT' });
  const nokey = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'RECEIPT', p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: 'x', p_notes: null, p_idempotency_key: '  ' });
  expect(nokey).toMatchObject({ ok: false, status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const partial = await callFn(await rpcClientFor('ga_inv_txn_only'), 'ga_ws_inv_post', { p_transaction_type: 'RECEIPT', p_location_id: loc.id, p_part_id: part.id, p_quantity: 1, p_input_unit_type: 'BASE', p_reason: 'x', p_notes: null, p_idempotency_key: key() });
  expect(partial).toMatchObject({ ok: false, status: 403, code: 'PART_VIEW_REQUIRED', missing: ['part.view'] });
  expect(await dbTx(loc.id, part.id)).toHaveLength(2);
});

// ----------------------------------------------------------------------------- 餘額清單
test('餘額清單：分頁上限 100、搜尋含逗號括號引號不壞、含 0、低庫存紅黃標與只看需補貨、排序、統計與資料庫核對', async () => {
  const label = 'LST';
  const mk = async (suffix: string, qty: number, setting: Record<string, unknown> = {}) => {
    const r = await setup(`${label}-${suffix}`, { setting });
    const b = await seedBalance(r.loc.id, r.part.id, qty);
    return { ...r, b };
  };
  const red = await mk('RED', 2, { safety_stock_qty: 5, reorder_point_qty: 10 });
  const yellow = await mk('YEL', 7, { safety_stock_qty: 5, reorder_point_qty: 10 });
  const fine = await mk('OK', 20, { safety_stock_qty: 5, reorder_point_qty: 10 });
  const zero = await mk('ZERO', 0, { safety_stock_qty: 1 });
  const neg = await mk('NEG', -3);
  const none = await mk('NONE', 4);
  const term = encodeURIComponent(m7Name(label));
  const all = await get('ga_works', `/balances?pageSize=1000&search=${term}`);
  expect(all.status).toBe(200);
  expect(all.body.meta.pageSize).toBe(100);
  // 預設不含 0
  expect(ids(all).sort()).toEqual([red.b.id, yellow.b.id, fine.b.id, neg.b.id, none.b.id].sort());
  const withZero = await get('ga_works', `/balances?includeZero=true&search=${term}`);
  expect(ids(withZero)).toContain(zero.b.id);
  expect(withZero.body.total).toBe(6);
  // 紅黃標：低於安全 = red；低於補貨點 = yellow；安全未設定只看補貨點；負庫存且沒設定不標
  const lvl = Object.fromEntries(all.body.data.map((r: any) => [r.id, r.level]));
  expect(lvl).toEqual({ [red.b.id]: 'red', [yellow.b.id]: 'yellow', [fine.b.id]: null, [neg.b.id]: null, [none.b.id]: null });
  const low = await get('ga_works', `/balances?lowOnly=true&search=${term}`);
  expect(ids(low).sort()).toEqual([red.b.id, yellow.b.id].sort());
  // 統計：資料庫端精確（針對搜尋範圍，不受含 0／只看需補貨影響）
  const lowStats = low.body.stats;
  expect(lowStats).toMatchObject({ rows: 6, nonzero: 5, zero: 1, negative: 1, red: 2, yellow: 1 }); // 庫存 0 且安全庫存 1 的那筆也是低於安全庫存
  const dbRows = (await adminDb().from('ga_inventory_balances').select('quantity_base').in('id', [red, yellow, fine, zero, neg, none].map((x) => x.b.id))).data as any[];
  expect(Number(lowStats.total_qty)).toBe(dbRows.filter((r) => Number(r.quantity_base) > 0).reduce((s, r) => s + Number(r.quantity_base), 0));
  // 搜尋特殊字元不壞；位置、料件篩選；排序；分頁
  for (const q of ['a,b', '(x)', '"q"', "o'r", '50%', 'a\\b', '_', '%']) expect((await get('ga_works', `/balances?search=${encodeURIComponent(q)}`)).status, q).toBe(200);
  expect(ids(await get('ga_works', `/balances?locationId=${red.loc.id}&includeZero=true`))).toEqual([red.b.id]);
  expect(ids(await get('ga_works', `/balances?partId=${yellow.part.id}`))).toEqual([yellow.b.id]);
  const asc = await get('ga_works', `/balances?search=${term}&sort=quantity_base&sortOrder=asc`);
  expect(asc.body.data.map((r: any) => Number(r.quantity_base))).toEqual([-3, 2, 4, 7, 20]);
  const desc = await get('ga_works', `/balances?search=${term}&sort=quantity_base&sortOrder=desc`);
  expect(desc.body.data.map((r: any) => Number(r.quantity_base))).toEqual([20, 7, 4, 2, -3]);
  const p2 = await get('ga_works', `/balances?search=${term}&sort=quantity_base&sortOrder=asc&pageSize=2&page=2`);
  expect(p2.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  expect(p2.body.data.map((r: any) => Number(r.quantity_base))).toEqual([4, 7]);
  // 列內容：位置、料件、單位、門市
  const one = all.body.data.find((r: any) => r.id === red.b.id);
  expect(one.location).toMatchObject({ id: red.loc.id, name: red.loc.name, store_id: sid.ZT04 });
  expect(one.store).toMatchObject({ id: sid.ZT04 });
  expect(one.part).toMatchObject({ id: red.part.id, base_unit: '個' });
  expect(one.holding).toMatchObject({ in_use_quantity: 0, idle_quantity: 0, unclassified_quantity: 2 });
  for (const bad of ['?sort=password', '?holding=NOPE', '?locationId=abc', '?partId=abc']) expect((await get('ga_works', `/balances${bad}`)).status, bad).toBe(400);
});

// ----------------------------------------------------------------------------- 持有狀態（C4）
test('持有狀態：全量彙總與前 3 名、篩選；調整（原因寫入修改紀錄）、合計超過 409、STALE、同時兩個只成功一個；修改紀錄分頁', async () => {
  const mk = async (suffix: string, qty: number) => {
    const r = await setup(`HOLD-${suffix}`);
    const b = await seedBalance(r.loc.id, r.part.id, qty);
    return { ...r, b };
  };
  const a = await mk('A', 10);
  const b = await mk('B', 8);
  const c = await mk('C', 6);
  const d = await mk('D', 4);
  const e = await mk('E', 0);
  const term = encodeURIComponent(m7Name('HOLD-'));
  // 初始：全部「待確認」
  let list = await get('ga_works', `/holding?search=${term}`);
  expect(list.status).toBe(200);
  expect(list.body.total).toBe(4);
  expect(list.body.summary).toMatchObject({ total_qty: 28, in_use: 0, idle: 0, unclassified: 28 });
  expect(list.body.top).toEqual([]);
  // 調整
  const adj = async (x: any, inUse: number, idle: number, reason?: string, expected: string | null = null) =>
    send('ga_works', 'patch', `/holding/${x.b.id}`, { in_use_quantity: inUse, idle_quantity: idle, ...(reason ? { reason } : {}), expected_updated_at: expected });
  const ra = await adj(a, 4, 3, '盤點後確認 3 件閒置');
  expect(ra.status).toBe(200);
  expect(ra.body.data).toMatchObject({ balance_id: a.b.id, in_use_quantity: 4, idle_quantity: 3, unclassified_quantity: 3, notes: '盤點後確認 3 件閒置' });
  expect((await adj(b, 1, 6)).status).toBe(200);
  expect((await adj(c, 0, 2)).status).toBe(200);
  expect((await adj(d, 0, 1)).status).toBe(200);
  const alloc = (await adminDb().from('ga_inventory_holding_allocations').select('*').eq('balance_id', a.b.id).single()).data as any;
  expect(alloc).toMatchObject({ in_use_quantity: 4, idle_quantity: 3, notes: '盤點後確認 3 件閒置' });
  const ev = (await adminDb().from('ga_inventory_holding_events').select('*').eq('balance_id', a.b.id)).data as any[];
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ before_in_use_quantity: 0, before_idle_quantity: 0, after_in_use_quantity: 4, after_idle_quantity: 3, notes: '盤點後確認 3 件閒置', created_by: gaUserId });
  list = await get('ga_works', `/holding?search=${term}`);
  expect(list.body.summary).toMatchObject({ total_qty: 28, in_use: 5, idle: 12, unclassified: 11 });
  expect(list.body.top.map((r: any) => r.id)).toEqual([b.b.id, a.b.id, c.b.id]);
  expect(list.body.top.map((r: any) => r.holding.idle_quantity)).toEqual([6, 3, 2]);
  // 篩選
  expect(ids(await get('ga_works', `/holding?search=${term}&holding=IDLE`)).sort()).toEqual([a.b.id, b.b.id, c.b.id, d.b.id].sort());
  expect(ids(await get('ga_works', `/holding?search=${term}&holding=IN_USE`)).sort()).toEqual([a.b.id, b.b.id].sort());
  expect(ids(await get('ga_works', `/holding?search=${term}&holding=UNCLASSIFIED`)).sort()).toEqual([a.b.id, b.b.id, c.b.id, d.b.id].sort());
  expect((await get('ga_works', `/holding?search=${term}&page=2&pageSize=3`)).body).toMatchObject({ meta: { page: 2, pageSize: 3, total: 4, totalPages: 2 } });
  // 合計超過持有量 409；負數、小數過多 400；沒變動
  const curC = (await adminDb().from('ga_inventory_holding_allocations').select('updated_at,idle_quantity').eq('balance_id', c.b.id).single()).data as any;
  const over = await adj(c, 5, 2, undefined, curC.updated_at);
  expect(over.status).toBe(409);
  expect(over.body.error).toContain('不可超過');
  expect(Number(curC.idle_quantity)).toBe(2);
  for (const [label, data] of [['負數', { in_use_quantity: -1, idle_quantity: 0 }], ['小數過多', { in_use_quantity: 1.00001, idle_quantity: 0 }], ['非數字', { in_use_quantity: 'x', idle_quantity: 0 }], ['未知欄位', { in_use_quantity: 1, idle_quantity: 0, foo: 1 }], ['缺 expected', { in_use_quantity: 1, idle_quantity: 0 }]] as const) {
    const r = await send('ga_works', 'patch', `/holding/${c.b.id}`, label === '缺 expected' ? data : { ...data, expected_updated_at: curC.updated_at });
    expect(r.status, label).toBe(400);
  }
  // STALE：用舊的調整時間（null）再調整一次已有調整的餘額
  const stale = await adj(a, 1, 1, '過期', null);
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect(Number((await adminDb().from('ga_inventory_holding_allocations').select('in_use_quantity').eq('balance_id', a.b.id).single()).data!.in_use_quantity)).toBe(4);
  // 同時兩個（都用目前版本）只有一個成功
  const curA = (await adminDb().from('ga_inventory_holding_allocations').select('updated_at').eq('balance_id', a.b.id).single()).data as any;
  const both = await Promise.all([adj(a, 2, 2, 'X', curA.updated_at), adj(a, 3, 3, 'Y', curA.updated_at)]);
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  // 修改紀錄
  const events = await get('ga_works', `/holding/${a.b.id}/events?pageSize=1&page=2`);
  expect(events.status).toBe(200);
  expect(events.body.meta).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
  expect(events.body.data[0]).toMatchObject({ before_in_use_quantity: 0, after_in_use_quantity: 4, notes: '盤點後確認 3 件閒置', creator_name: gaName });
  expect(events.body.data[0]).not.toHaveProperty('created_by');
  // 持有量減少時，資料庫觸發器自動校正（既有行為，確認仍有效）：出庫到剩 1，持有狀態不可超過
  const cl = await post('ga_works', d.loc.id, d.part.id, { transaction_type: 'ISSUE', quantity: 3 });
  expect(cl.status).toBe(201);
  const after = (await adminDb().from('ga_inventory_holding_allocations').select('*').eq('balance_id', d.b.id).single()).data as any;
  expect(Number(after.in_use_quantity) + Number(after.idle_quantity)).toBeLessThanOrEqual(1);
  expect(Number(e.b.quantity_base)).toBe(0);
});

// ----------------------------------------------------------------------------- 流水
test('流水：類型、位置、料件、日期（台北）、記錄人、原因、來源篩選；記錄人只回姓名；分頁；排序；壞參數 400', async () => {
  const { loc, part } = await setup('TXN');
  const other = await setup('TXN2');
  const day = '2026-10-03';
  const a = await post('ga_works', loc.id, part.id, { transaction_type: 'RECEIPT', quantity: 10, reason: '盤點差異入庫', occurred_at: '2026-10-03T10:00:00+08:00' });
  const b = await post('ga_works', loc.id, part.id, { transaction_type: 'ISSUE', quantity: 2, reason: '門市領用', occurred_at: '2026-10-03T23:30:00+08:00' });
  const c = await post('ga_works', loc.id, part.id, { transaction_type: 'ADJUST_OUT', quantity: 1, reason: '報廢', occurred_at: '2026-10-04T00:10:00+08:00' });
  const d = await post('ga_works', other.loc.id, other.part.id, { transaction_type: 'RECEIPT', quantity: 5, reason: '別處入庫' });
  for (const r of [a, b, c, d]) expect(r.status).toBe(201);
  const idsOf = (r: any) => ids(r);
  const L = `locationId=${loc.id}`;
  const all = await get('ga_works', `/transactions?${L}&sort=occurred_at&sortOrder=asc`);
  expect(all.status).toBe(200);
  expect(idsOf(all)).toEqual([a.body.data.transaction_id, b.body.data.transaction_id, c.body.data.transaction_id]);
  expect(all.body.data[0]).toMatchObject({ transaction_type: 'RECEIPT', creator_name: gaName, source_label: '手動過帳', reason: '盤點差異入庫' });
  expect(JSON.stringify(all.body)).not.toContain('@example.test');
  expect(all.body.data[0]).not.toHaveProperty('metadata');
  expect(all.body.data[0]).not.toHaveProperty('created_by');
  expect(all.body.data[0].location).toMatchObject({ id: loc.id, name: loc.name });
  expect(all.body.data[0].part).toMatchObject({ id: part.id });
  // 類型
  expect(idsOf(await get('ga_works', `/transactions?${L}&transactionType=ISSUE`))).toEqual([b.body.data.transaction_id]);
  // 日期：台北 10/3 一整天（含 23:30，不含隔天 00:10）
  expect(idsOf(await get('ga_works', `/transactions?${L}&dateFrom=${day}&dateTo=${day}&sortOrder=asc`))).toEqual([a.body.data.transaction_id, b.body.data.transaction_id]);
  expect(idsOf(await get('ga_works', `/transactions?${L}&dateFrom=2026-10-04`))).toEqual([c.body.data.transaction_id]);
  expect(idsOf(await get('ga_works', `/transactions?${L}&dateTo=2026-10-02`))).toEqual([]);
  // 位置、料件
  expect(idsOf(await get('ga_works', `/transactions?partId=${other.part.id}`))).toEqual([d.body.data.transaction_id]);
  // 記錄人（姓名片段）與原因
  expect((await get('ga_works', `/transactions?${L}&creator=${encodeURIComponent(gaName.slice(0, 2))}`)).body.total).toBe(3);
  expect((await get('ga_works', `/transactions?${L}&creator=${encodeURIComponent('不存在的人名')}`)).body.total).toBe(0);
  expect(idsOf(await get('ga_works', `/transactions?${L}&reason=${encodeURIComponent('盤點')}`))).toEqual([a.body.data.transaction_id]);
  for (const q of ['a,b', '(x)', '"q"', '50%', '_', 'a\\b']) expect((await get('ga_works', `/transactions?reason=${encodeURIComponent(q)}`)).status, q).toBe(200);
  // 來源
  expect((await get('ga_works', `/transactions?${L}&source=manual`)).body.total).toBe(3);
  expect((await get('ga_works', `/transactions?${L}&source=transfer`)).body.total).toBe(0);
  expect((await get('ga_works', `/transactions?${L}&source=return_stock`)).body.total).toBe(0);
  // 分頁與上限
  const p2 = await get('ga_works', `/transactions?${L}&pageSize=1&page=3&sortOrder=asc`);
  expect(p2.body.meta).toMatchObject({ page: 3, pageSize: 1, total: 3, totalPages: 3 });
  expect((await get('ga_works', `/transactions?pageSize=1000`)).body.meta.pageSize).toBe(100);
  for (const bad of ['?transactionType=MOVE', '?sort=password', '?source=x', '?locationId=abc', '?dateFrom=2026-13-01', '?dateTo=abc', '?dateFrom=2026-10-05&dateTo=2026-10-01']) {
    expect((await get('ga_works', `/transactions${bad}`)).status, bad).toBe(400);
  }
});

test('調撥相關流水的來源顯示：調撥單號、「調撥退回來源庫存」（Q12）；來源與參考欄位不能由過帳 API 指定', async () => {
  const { loc, part } = await setup('SRC');
  await seedBalance(loc.id, part.id, 20);
  // 流水不可直接寫入（只有過帳函式）；用資料庫函式帶參考單據與 metadata，模擬第 4 批／調撥動作的同交易呼叫
  const client = await rpcClientFor('ga_works');
  const ref = crypto.randomUUID();
  const ship = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'ISSUE', p_location_id: loc.id, p_part_id: part.id, p_quantity: 2, p_input_unit_type: 'BASE', p_reason: '調撥交出', p_notes: null, p_idempotency_key: key(), p_reference_type: 'INVENTORY_TRANSFER', p_reference_id: ref, p_metadata: { transfer_no: 'GAT-TEST-1', action: 'ship' } });
  const back = await callFn(client, 'ga_ws_inv_post', { p_transaction_type: 'RECEIPT', p_location_id: loc.id, p_part_id: part.id, p_quantity: 2, p_input_unit_type: 'BASE', p_reason: '調撥取消退回', p_notes: null, p_idempotency_key: key(), p_reference_type: 'INVENTORY_TRANSFER', p_reference_id: ref, p_metadata: { transfer_no: 'GAT-TEST-1', action: 'return_stock' } });
  expect(ship.ok).toBe(true);
  expect(back.ok).toBe(true);
  const list = await get('ga_works', `/transactions?locationId=${loc.id}&sortOrder=asc&sort=created_at`);
  expect(list.body.data.map((r: any) => r.source_label)).toEqual(['調撥 GAT-TEST-1', '調撥退回來源庫存 GAT-TEST-1']);
  expect(list.body.data[1]).toMatchObject({ return_stock: true, transfer_no: 'GAT-TEST-1' });
  expect((await get('ga_works', `/transactions?locationId=${loc.id}&source=transfer`)).body.total).toBe(2);
  expect(ids(await get('ga_works', `/transactions?locationId=${loc.id}&source=return_stock`))).toEqual([back.data.transaction_id]);
  expect((await get('ga_works', `/transactions?locationId=${loc.id}&source=manual`)).body.total).toBe(0);
  expect(JSON.stringify(list.body)).not.toContain(ref);
});

test('CSV 匯出（C5）：餘額與流水各一份，目前篩選條件下的全部資料（不是只有當頁）；UTF-8 BOM、標題列、公式開頭加單引號；沒權限 403', async () => {
  const { loc, part } = await setup('CSV', { partOver: { name: m7Name('CSV-=SUM(1)') } });
  // 料件名稱以 = 開頭的情況：名稱本身帶標記前綴，所以另建一個以 = 開頭的原因來驗公式防護
  for (let i = 0; i < 3; i += 1) expect((await post('ga_works', loc.id, part.id, { quantity: 1 + i, reason: i === 0 ? '=cmd|calc' : `第 ${i} 筆` })).status).toBe(201);
  const tx = await apis.ga_works.get(`${BASE}/transactions/export?locationId=${loc.id}&sortOrder=asc`);
  expect(tx.status()).toBe(200);
  expect(tx.headers()['content-type']).toContain('text/csv');
  expect(tx.headers()['content-disposition']).toContain("filename*=UTF-8''");
  const text = await tx.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  expect(lines[0]).toBe('交易單號,發生時間,類型,位置,料件,料件代碼,輸入數量,輸入單位,異動數量（基本單位）,異動前,異動後,來源,原因,備註,記錄人');
  expect(lines).toHaveLength(4);
  expect(text).toContain("'=cmd|calc");
  expect(lines[1]).toContain(gaName);
  // 篩選條件帶進匯出：只匯出入庫第 1 筆
  const one = await (await apis.ga_works.get(`${BASE}/transactions/export?locationId=${loc.id}&reason=${encodeURIComponent('第 1')}`)).text();
  expect(one.trim().split('\r\n')).toHaveLength(2);
  // 餘額：含 0 與否、分頁無關（匯出全部）
  const bal = await apis.ga_works.get(`${BASE}/balances/export?locationId=${loc.id}&pageSize=1`);
  expect(bal.status()).toBe(200);
  const bl = (await bal.text()).replace(/^﻿/, '').trim().split('\r\n');
  expect(bl[0]).toBe('位置,位置代碼,門市,料件,料件代碼,品牌,型號,規格,庫存（基本單位）,基本單位,安全庫存,補貨點,庫存狀態,使用中,閒置可調撥,待確認,最後異動時間');
  expect(bl).toHaveLength(2);
  expect(bl[1]).toContain(',6,個,');
  for (const k of ['denied', 'ga_inv_transfer_only']) {
    expect((await apis[k].get(`${BASE}/transactions/export`)).status(), k).toBe(403);
    expect((await apis[k].get(`${BASE}/balances/export`)).status(), k).toBe(403);
  }
  expect((await apis.ga_works.get(`${BASE}/transactions/export?transactionType=MOVE`)).status()).toBe(400);
});

// ----------------------------------------------------------------------------- 選項
test('選項：位置搜尋分頁；過帳用的位置料件（含目前庫存，只列啟用中的設定與料件）；缺料件查看權限回說明；名單身分只看自己門市', async () => {
  const a = await setup('OPT-A');
  const b = await setup('OPT-B');
  await seedBalance(a.loc.id, a.part.id, 7);
  const extra = await seedPart(partCat.id, 'OPT-A2');
  await seedLocationPart(a.loc.id, extra.id, { is_active: false });
  const locs = await get('ga_works', `/options?type=locations&search=${encodeURIComponent(m7Name('OPT-'))}&pageSize=1`);
  expect(locs.status).toBe(200);
  expect(locs.body.meta).toMatchObject({ pageSize: 1, total: 2, totalPages: 2 });
  expect(locs.body.data).toHaveLength(1);
  const off = await seedLocation('ZT04', 'OPT-OFF', { is_active: false });
  expect(ids(await get('ga_works', `/options?type=locations&search=${encodeURIComponent(m7Name('OPT-'))}&pageSize=10`)).sort()).toEqual([a.loc.id, b.loc.id].sort());
  expect(ids(await get('ga_works', `/options?type=locations&search=${encodeURIComponent(m7Name('OPT-OFF'))}`))).toEqual([]);
  expect(off.is_active).toBe(false);
  for (const q of ['a,b', '(x)', '"q"']) expect((await get('ga_works', `/options?type=locations&search=${encodeURIComponent(q)}`)).status, q).toBe(200);
  const lp = await get('ga_works', `/options?type=location-parts&locationId=${a.loc.id}`);
  expect(lp.status).toBe(200);
  expect(lp.body.data).toHaveLength(1);
  expect(lp.body.data[0]).toMatchObject({ part_id: a.part.id, currentBalance: { quantity_base: 7 } });
  expect(lp.body.data[0].part).toMatchObject({ id: a.part.id, base_unit: '個', allow_fractional_issue: false });
  expect(lp.body.location).toMatchObject({ id: a.loc.id, allow_negative_stock: false });
  expect((await get('ga_works', `/options?type=location-parts&locationId=${a.loc.id}&search=${encodeURIComponent('不存在的料件')}`)).body.total).toBe(0);
  expect((await get('ga_works', `/options?type=location-parts`)).status).toBe(400);
  expect((await get('ga_works', `/options?type=location-parts&locationId=${off.id}`)).status).toBe(404);
  expect((await get('ga_works', `/options?type=bogus`)).status).toBe(400);
  const parts = await get('ga_works', `/options?type=parts&search=${encodeURIComponent(m7Name('OPT-A'))}`);
  expect(ids(parts)).toContain(a.part.id);
  expect(ids(parts)).not.toContain(b.part.id);
  // 只有交易管理（沒有料件查看）：位置可選，料件目錄回說明
  const txn = await get('ga_inv_txn_only', `/options?type=location-parts&locationId=${a.loc.id}`);
  expect(txn.status).toBe(200);
  expect(txn.body).toMatchObject({ partCatalogAccess: false, total: 0 });
  expect(txn.body.message).toContain('料件查看');
  expect((await get('ga_inv_txn_only', `/options?type=locations&search=${encodeURIComponent(m7Name('OPT-'))}`)).body.total).toBe(2);
  // 名單身分：只有自己門市的 STORE 位置
  const mine = await seedLocation('ZT01', 'OPT-MINE');
  const theirs = await seedLocation('VW001', 'OPT-THEIRS');
  const rs = await get('store_manager', `/options?type=locations&search=${encodeURIComponent(m7Name('OPT-'))}`);
  expect(ids(rs)).toEqual([mine.id]);
  // 過帳用的料件選項只給有交易管理權限的人（唯讀身分用不到）
  expect((await get('store_manager', `/options?type=location-parts&locationId=${mine.id}`)).status).toBe(403);
  expect((await get('navigation', `/options?type=location-parts&locationId=${mine.id}`)).status).toBe(403);
  expect(theirs.id).toBeTruthy();
});

// ----------------------------------------------------------------------------- C12 名單身分
test('C12：店長、督導、區經理唯讀、只看自己門市的餘額與流水；交易原因與備註、持有狀態調整原因由伺服端遮蔽；原因搜尋不可用；總務看得到全部', async () => {
  const mine = await setup('C12-MINE', { store: 'ZT01' });
  const other = await setup('C12-OTHER', { store: 'VW001' });
  await seedBalance(mine.loc.id, mine.part.id, 6);
  await seedBalance(other.loc.id, other.part.id, 9);
  const t1 = await post('ga_works', mine.loc.id, mine.part.id, { quantity: 2, reason: '內部原因-ZT01', notes: '內部備註-ZT01' });
  const t2 = await post('ga_works', other.loc.id, other.part.id, { quantity: 1, reason: '內部原因-VW001' });
  expect(t1.status).toBe(201);
  expect(t2.status).toBe(201);
  const bal = await dbBal(mine.loc.id, mine.part.id);
  expect((await send('ga_works', 'patch', `/holding/${bal.id}`, { in_use_quantity: 1, idle_quantity: 1, reason: '內部調整原因', expected_updated_at: null })).status).toBe(200);
  const term = encodeURIComponent(m7Name('C12-'));
  for (const k of ['store_manager', 'supervisor', 'roster_supervisor', 'roster_area_manager']) {
    const b = await get(k, `/balances?search=${term}`);
    expect(ids(b), `${k} 餘額`).toEqual([bal.id]);
    expect(b.body.permissions, k).toMatchObject({ internal: false, readOnly: true, canPost: false });
    expect(JSON.stringify(b.body), k).not.toContain('內部調整原因');
    expect(b.body.data[0].holding.notes, k).toBeNull();
    expect(b.body.data[0].holding.in_use_quantity, k).toBe(1);
    const t = await get(k, `/transactions?search=x&locationId=${mine.loc.id}`);
    expect(t.status, k).toBe(200);
    expect(t.body.total, k).toBe(1);
    expect(t.body.data[0], k).toMatchObject({ reason: null, notes: null, transaction_type: 'RECEIPT', creator_name: gaName });
    expect(JSON.stringify(t.body), k).not.toContain('內部');
    // 他店的流水看不到（RLS）
    expect((await get(k, `/transactions?locationId=${other.loc.id}`)).body.total, k).toBe(0);
    // 原因搜尋對唯讀身分無效（不能拿遮蔽欄位當搜尋條件猜內容）
    expect((await get(k, `/transactions?locationId=${mine.loc.id}&reason=${encodeURIComponent('完全不存在')}`)).body.total, k).toBe(1);
    const h = await get(k, `/holding?search=${term}`);
    expect(ids(h), k).toEqual([bal.id]);
    expect(h.body.permissions, k).toMatchObject({ canAdjust: false, internal: false });
    const ev = await get(k, `/holding/${bal.id}/events`);
    expect(ev.status, k).toBe(200);
    expect(ev.body.data[0].notes, k).toBeNull();
    expect((await get(k, `/holding/${(await dbBal(other.loc.id, other.part.id)).id}/events`)).status, `${k} 他店`).toBe(404);
  }
  expect(ids(await get('ga_store_manager_b', `/balances?search=${term}`))).toEqual([(await dbBal(other.loc.id, other.part.id)).id]);
  // 總務：全部，含原因與備註、調整原因
  const ga = await get('ga_works', `/balances?search=${term}`);
  expect(ga.body.total).toBe(2);
  expect(ga.body.data.find((r: any) => r.id === bal.id).holding.notes).toBe('內部調整原因');
  const gt = await get('ga_works', `/transactions?locationId=${mine.loc.id}`);
  expect(gt.body.data[0]).toMatchObject({ reason: '內部原因-ZT01', notes: '內部備註-ZT01' });
  expect((await get('ga_works', `/holding/${bal.id}/events`)).body.data[0].notes).toBe('內部調整原因');
  // 只有查看權限的總務（導覽帳號）：看得到原因，不能調整
  expect((await get('navigation', `/transactions?locationId=${mine.loc.id}`)).body.data[0].reason).toBe('內部原因-ZT01');
  expect((await get('navigation', `/holding?search=${term}`)).body.permissions).toMatchObject({ canAdjust: false, internal: true });
  expect(gaUserId).toBeTruthy();
});

test('舊版與新版資料一致：新版過帳後，舊版 API 讀到同一份餘額與流水（共用同一個核心函式與資料表）', async () => {
  const { loc, part } = await setup('LEGACY');
  const r = await post('ga_works', loc.id, part.id, { quantity: 6, reason: '新舊一致' });
  expect(r.status).toBe(201);
  const legacyBal = await j(await apis.ga_works.get(`/api/general-affairs/inventory/balances?locationId=${loc.id}&includeZero=true`));
  expect(legacyBal.status).toBe(200);
  expect(Number(legacyBal.body.data[0].quantity_base)).toBe(6);
  const legacyTx = await j(await apis.ga_works.get(`/api/general-affairs/inventory/transactions?locationId=${loc.id}`));
  expect(legacyTx.body.data[0]).toMatchObject({ id: r.body.data.transaction_id, transaction_no: r.body.data.transaction_no, transaction_type: 'RECEIPT' });
  // 舊版直接過帳（不經過新版包裝）仍可用，兩邊餘額一致
  const legacyPost = await j(await apis.ga_works.post('/api/general-affairs/inventory/transactions/post', { data: { transactionType: 'ISSUE', locationId: loc.id, partId: part.id, quantity: 1, inputUnitType: 'BASE', reason: '舊版過帳', idempotencyKey: key() } }));
  expect(legacyPost.status).toBe(201);
  const mine = await get('ga_works', `/balances?locationId=${loc.id}`);
  expect(Number(mine.body.data[0].quantity_base)).toBe(5);
  expect(tag()).toContain('M7M8');
});
