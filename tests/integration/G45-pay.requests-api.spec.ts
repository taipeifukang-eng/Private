import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { taipeiToday } from '../support/m7m8-po-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-pay（API 層）：請款單 /payment-requests/**、/payment-settings。
// 每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣（資料庫語意；profiles.role=admin 無角色被擋；只有 payment.view 不能寫）、400 輸入驗證、
// 409（STALE、非法狀態轉移、累計超過上限、已付款鎖定）、固定識別冪等，並用 service role 回讀資料庫（含不可修改的操作紀錄）。
// 沒有核准流程，申請人可自己標已付款（P4）。測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記、年份 2038、只用 DEV；結束只清自己的。
const P = '/api/workspace/general-affairs';
const PR = `${P}/payment-requests`;
const SET = `${P}/payment-settings`;
const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'novendor', 'purchaser', 'nobody', 'admin'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})), headers: r.headers(), text: undefined as string | undefined });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const itemId = (p: any, line: number) => p.items.find((i: any) => i.line_no === line).id as string;
const today = () => { const d = taipeiToday(); return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; };

let vendor: any;
let po: any;
let rc: any[] = [];
let po2: any;
let rcShort: any;
async function newReceipt(vendorId: string, qty: number, deliver: number, tag: string) {
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(tag), vendor_id: vendorId }, p_items: [{ item_name: 'QA-GA45 品項', unit: '個', quantity: qty, unit_price: 100 }], p_create_key: key() });
  const placed = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const r = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: placed.id, p_header: {}, p_lines: [{ po_item_id: itemId(placed, 1), delivered_qty: deliver }], p_key: key() });
  return { po: placed, receipt: r };
}
const mk = (receiptId: string, over: Record<string, unknown> = {}) => ({ vendor_id: vendor.id, lines: [{ receipt_id: receiptId }], idempotency_key: key(), ...over });
async function createPr(who: string, receiptId: string, over: Record<string, unknown> = {}) {
  const r = await send(who, 'post', PR, mk(receiptId, over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as any;
}
const act = (who: string, p: any, action: string, extra: Record<string, unknown> = {}, expected = p.updated_at) =>
  send(who, 'post', `${PR}/${p.id}/actions`, { action, expected_updated_at: expected, idempotency_key: key(), ...extra });
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbEvents = async (id: string) => ((await db().from('ga_payment_request_events').select('*').eq('pr_id', id).order('created_at')).data || []) as any[];

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
  vendor = await seedGa45Vendor(`PAY${(seq += 1)}`);
  // 主採購單：10 件 x 100，6 次各收 1 件（每次進貨含稅 105），方便各測試用不同進貨單
  const first = await newReceipt(vendor.id, 10, 1, `PAY${(seq += 1)}`);
  po = first.po;
  rc = [first.receipt];
  for (let i = 0; i < 7; i += 1) {
    rc.push(await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: 1 }], p_key: key() }));
  }
  // 短收採購單：訂 10 只收 6，累計驗入含稅 630
  const s = await newReceipt(vendor.id, 10, 6, `PAY${(seq += 1)}`);
  po2 = s.po;
  rcShort = s.receipt;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

test('未登入 401、Origin 不符 403、不支援的方法與路徑、id 格式', async () => {
  const noAuth = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await noAuth.get(PR)).status()).toBe(401);
    expect((await noAuth.get(`${PR}/export?month=2038-01`)).status()).toBe(401);
    expect((await noAuth.get(SET)).status()).toBe(401);
    expect((await noAuth.post(PR, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  } finally {
    await noAuth.dispose();
  }
  expect((await apis.clerk.post(PR, { data: mk(rc[0].id), headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await apis.clerk.put(SET, { data: { tolerance_amount: 9, expected_updated_at: new Date().toISOString() }, headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await apis.clerk.post(`${PR}/${crypto.randomUUID()}/actions`, { data: {}, headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
  expect((await send('clerk', 'delete', `${PR}/${crypto.randomUUID()}`)).status).toBe(405);
  expect((await get('clerk', `${PR}/not-a-uuid`)).status).toBe(400);
  expect((await send('clerk', 'post', `${PR}/${crypto.randomUUID()}/nothing`)).status).toBe(404);
  expect((await send('clerk', 'post', `${SET}/extra`)).status).toBe(404);
  expect((await send('clerk', 'post', SET)).status).toBe(405);
});

test('權限矩陣（資料庫語意）：總務、會計、檢視者、無廠商權限者可讀；採購角色、無權限者、管理員身分無角色 403；只有 view 不能寫', async () => {
  for (const who of ['clerk', 'accountant', 'viewer', 'novendor']) {
    for (const p of [PR, SET, `${PR}/export?month=2038-01`]) expect((await get(who, p)).status, `${who} ${p}`).toBe(200);
  }
  for (const who of ['purchaser', 'nobody', 'admin']) {
    for (const p of [PR, SET, `${PR}/export?month=2038-01`, `${PR}/candidates`]) expect((await get(who, p)).status, `${who} ${p}`).toBe(403);
  }
  for (const who of ['viewer', 'purchaser', 'nobody', 'admin']) {
    expect((await send(who, 'post', PR, mk(rc[0].id))).status, `${who} 建立`).toBe(403);
    expect((await send(who, 'put', SET, { tolerance_amount: 9, expected_updated_at: new Date().toISOString() })).status, `${who} 設定`).toBe(403);
  }
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
  const list = await get('viewer', PR);
  expect(list.body.permissions).toMatchObject({ canView: true, canManage: false, vendorVisible: false });
  expect((await get('clerk', PR)).body.permissions).toMatchObject({ canManage: true, vendorVisible: true });
});

test('建立請款單：201、單號格式、金額與銀行快照回讀；同識別重送回原結果；不同內容同識別 409；400 驗證不寫入', async () => {
  const body = mk(rc[0].id, { notes: '第一張', expected_pay_date: today() });
  const r = await send('clerk', 'post', PR, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const p = r.body.data;
  expect(p.pr_no).toMatch(/^PY-\d{8}-\d{3,}$/);
  expect(p).toMatchObject({ status: 'DRAFT', amount_untaxed: 100, tax_amount: 5, amount_total: 105, line_count: 1 });
  expect(p.bank_snapshot.bank_account).toBe('123-456-789012');
  const row = await dbPr(p.id);
  expect(row).toMatchObject({ status: 'DRAFT', vendor_id: vendor.id, created_by: users.clerk.id, amount_total: 105 });
  expect(row.bank_snapshot.bank_name).toBe('測試銀行');
  const ev = await dbEvents(p.id);
  expect(ev.map((e) => e.event_type)).toEqual(['create']);
  expect(ev[0].actor_id).toBe(users.clerk.id);
  const again = await send('clerk', 'post', PR, body);
  expect(again.status).toBe(200);
  expect(again.body.replay).toBe(true);
  expect(again.body.data.id).toBe(p.id);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(1);
  const clash = await send('clerk', 'post', PR, { ...body, notes: '不同內容' });
  expect(clash.status).toBe(409);
  expect(clash.body.code).toBe('IDEMPOTENCY_CONFLICT');

  const before = (await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count;
  const noKey = mk(rc[1].id); delete (noKey as any).idempotency_key;
  expect((await send('clerk', 'post', PR, noKey)).body.error).toContain('識別');
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ vendor_id: 'bad' }, '廠商'],
    [{ lines: [] }, '至少'],
    [{ lines: [{ receipt_id: 'bad' }] }, '格式'],
    [{ lines: [{ receipt_id: rc[1].id, claim_untaxed: -1 }] }, '整數'],
    [{ lines: [{ receipt_id: rc[1].id, claim_untaxed: 1.5 }] }, '整數'],
    [{ expected_pay_date: '2038-02-30' }, '格式'],
    [{ notes: 'x'.repeat(501) }, '500'],
    [{ status: 'PAID' }, '不支援的欄位'],
    [{ lines: [{ receipt_id: rc[1].id, amount_total: 1 }] }, '不支援的明細欄位'],
  ];
  for (const [over, part] of cases) {
    const x = await send('clerk', 'post', PR, mk(rc[1].id, over));
    expect(x.status, JSON.stringify(over)).toBe(400);
    expect(x.body.error as string, JSON.stringify(over)).toContain(part);
    expect(x.body.error as string).not.toMatch(/SQLSTATE|violates|constraint/);
  }
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(before);
});

test('狀態流程：草稿修改、送出、退回（必填原因）、再送出、標已付款（申請人自己標，P4）、已付款鎖定；操作紀錄完整且不可修改刪除', async () => {
  let p = await createPr('clerk', rc[1].id);
  // 修改草稿：版本檢查
  const upd = await send('clerk', 'patch', `${PR}/${p.id}`, { notes: '改備註', expected_updated_at: p.updated_at });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  const stale = await send('clerk', 'patch', `${PR}/${p.id}`, { notes: '舊版本', expected_updated_at: p.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  expect((await send('clerk', 'patch', `${PR}/${p.id}`, { notes: 'x' })).status).toBe(400);
  p = upd.body.data;
  // 草稿不能直接標已付款（沒有核准也一定要先送出）
  const early = await act('clerk', p, 'mark_paid', { pay_method: 'CASH' });
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('INVALID_STATE');
  // 送出
  const sub = await act('clerk', p, 'submit');
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  p = sub.body.data;
  expect(p.status).toBe('SUBMITTED');
  expect(p.submitted_by_name).toBeTruthy();
  // 重送同識別：回原結果，不重複記錄
  const idem = key();
  const noReason = await act('accountant', p, 'return', {});
  expect(noReason.status).toBe(400);
  expect(noReason.body.error).toContain('退回原因');
  const ret = await send('accountant', 'post', `${PR}/${p.id}/actions`, { action: 'return', reason: '金額要再確認', expected_updated_at: p.updated_at, idempotency_key: idem });
  expect(ret.status, JSON.stringify(ret.body)).toBe(200);
  const retAgain = await send('accountant', 'post', `${PR}/${p.id}/actions`, { action: 'return', reason: '金額要再確認', expected_updated_at: p.updated_at, idempotency_key: idem });
  expect(retAgain.status).toBe(200);
  expect(retAgain.body.replay).toBe(true);
  const retClash = await send('accountant', 'post', `${PR}/${p.id}/actions`, { action: 'return', reason: '不同原因', expected_updated_at: p.updated_at, idempotency_key: idem });
  expect(retClash.status).toBe(409);
  expect(retClash.body.code).toBe('IDEMPOTENCY_CONFLICT');
  p = ret.body.data;
  expect(p).toMatchObject({ status: 'DRAFT', last_return_reason: '金額要再確認' });
  // 退回後已送出才能退的規則：草稿不能再退回
  expect((await act('clerk', p, 'return', { reason: 'x' })).status).toBe(409);
  // 再送出、標已付款：申請人自己標（clerk 建立也自己付款）
  p = (await act('clerk', p, 'submit')).body.data;
  const badMethod = await act('clerk', p, 'mark_paid', { pay_method: 'CREDIT' });
  expect(badMethod.status).toBe(400);
  const future = await act('clerk', p, 'mark_paid', { pay_method: 'CASH', paid_date: '2999-01-01' });
  expect(future.status).toBe(400);
  const paid = await act('clerk', p, 'mark_paid', { pay_method: 'TRANSFER', paid_date: today(), paid_ref: '88888' });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  p = paid.body.data;
  expect(p).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_ref: '88888' });
  expect(p.paid_by_name).toBeTruthy();
  const row = await dbPr(p.id);
  expect(row).toMatchObject({ status: 'PAID', paid_by: users.clerk.id, created_by: users.clerk.id });
  // 已付款鎖定：不能改內容、不能退回、不能再付款；只能備註與作廢
  expect((await send('clerk', 'patch', `${PR}/${p.id}`, { notes: '想改', expected_updated_at: p.updated_at })).status).toBe(409);
  expect((await act('accountant', p, 'return', { reason: 'x' })).status).toBe(409);
  expect((await act('accountant', p, 'mark_paid', { pay_method: 'CASH' })).status).toBe(409);
  expect((await act('accountant', p, 'submit')).status).toBe(409);
  const note = await act('accountant', p, 'note', { note: '會計備註' });
  expect(note.status, JSON.stringify(note.body)).toBe(200);
  expect((await act('accountant', note.body.data, 'note', {})).status).toBe(400);
  // 操作紀錄：誰、何時、順序，且資料庫擋 UPDATE／DELETE
  const ev = await dbEvents(p.id);
  expect(ev.map((e) => e.event_type)).toEqual(['create', 'update', 'submit', 'return', 'submit', 'mark_paid', 'note']);
  expect(ev.every((e) => e.actor_id && e.created_at)).toBe(true);
  expect(ev.find((e) => e.event_type === 'return').actor_id).toBe(users.accountant.id);
  expect(ev.find((e) => e.event_type === 'mark_paid').payload.self_paid).toBe(true);
  const upE = await db().from('ga_payment_request_events').update({ reason: '竄改' }).eq('id', ev[0].id);
  expect(upE.error, '事件表不可修改').toBeTruthy();
  const delE = await db().from('ga_payment_request_events').delete().eq('id', ev[0].id);
  expect(delE.error, '事件表不可刪除').toBeTruthy();
  expect((await dbEvents(p.id)).length).toBe(ev.length);
});

test('作廢：草稿可不填原因；已送出與已付款必填；作廢釋放額度；已作廢什麼都不能做', async () => {
  const d = await createPr('clerk', rc[2].id);
  const vd = await act('clerk', d, 'void', {});
  expect(vd.status, JSON.stringify(vd.body)).toBe(200);
  expect(vd.body.data.status).toBe('VOID');
  expect((await act('clerk', vd.body.data, 'note', { note: 'x' })).status).toBe(409);
  expect((await act('clerk', vd.body.data, 'void', { reason: 'x' })).status).toBe(409);
  // 釋放額度：同一進貨可重新請款
  const again = await createPr('clerk', rc[2].id);
  const sub = (await act('clerk', again, 'submit')).body.data;
  const noReason = await act('clerk', sub, 'void', {});
  expect(noReason.status).toBe(400);
  expect(noReason.body.error).toContain('原因');
  const ok = await act('clerk', sub, 'void', { reason: '重複請款' });
  expect(ok.status).toBe(200);
  expect(ok.body.data).toMatchObject({ status: 'VOID', void_reason: '重複請款' });
  const paidDraft = await createPr('clerk', rc[3].id);
  const paid = (await act('clerk', (await act('clerk', paidDraft, 'submit')).body.data, 'mark_paid', { pay_method: 'CASH' })).body.data;
  expect((await act('accountant', paid, 'void', {})).status).toBe(400);
  const vp = await act('accountant', paid, 'void', { reason: '付款退回' });
  expect(vp.status, JSON.stringify(vp.body)).toBe(200);
  expect((await dbEvents(paid.id)).map((e) => e.event_type)).toContain('void');
  // 管理權限的人（會計）可作廢別人建立的請款單；檢視者不行
  const other = await createPr('clerk', rc[4].id);
  expect((await act('viewer', other, 'void', {})).status).toBe(403);
});

test('累計請款上限：超過累計驗入含稅額加尾差直接 409 擋下；短收以累計驗入計；5 元尾差可過；分批請款；尾差可調整', async () => {
  // 短收：累計驗入 630，最多請 635。claim_untaxed 600 + 稅 35（手改）= 635 通過；多 1 元被擋
  const over = await send('clerk', 'post', PR, mk(rcShort.id, { vendor_id: vendor.id, lines: [{ receipt_id: rcShort.id, claim_untaxed: 600, claim_tax: 36 }] }));
  expect(over.status).toBe(409);
  expect(over.body.code).toBe('OVER_CLAIM');
  expect(over.body.error).toContain('拒收、未到貨');
  const full = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 600, claim_tax: 35 }] }));
  expect(full.status, JSON.stringify(full.body)).toBe(201);
  expect(full.body.data.amount_total).toBe(635);
  // 已佔滿，再請任何金額都被擋（同進貨單不能重複請超過）
  const more = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 1, claim_tax: 1 }] }));
  expect(more.status).toBe(409);
  // 作廢後額度釋放
  const vd = await act('clerk', full.body.data, 'void', {});
  expect(vd.status).toBe(200);
  const retry = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 300, claim_tax: 15 }] }));
  expect(retry.status, JSON.stringify(retry.body)).toBe(201);
  const rest = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 300, claim_tax: 20 }] }));
  expect(rest.status, JSON.stringify(rest.body)).toBe(201); // 分批：315 + 320 = 635 剛好
  expect((await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 1, claim_tax: 0 }] }))).status).toBe(409);
  await act('clerk', retry.body.data, 'void', {});
  await act('clerk', rest.body.data, 'void', {});
});

test('候選進貨：只列有驗收、尚有額度、未作廢的進貨；列表與詳情與資料庫一致；篩選與 400', async () => {
  const c = await get('clerk', `${PR}/candidates?vendorId=${vendor.id}&pageSize=100`);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  const ids = (c.body.data as any[]).map((x) => x.receipt_id);
  expect(ids).toContain(rc[5].id);
  const row = (c.body.data as any[]).find((x) => x.receipt_id === rc[5].id);
  expect(row).toMatchObject({ receipt_total: 105, tolerance: 5, tax_rate: 0.05 });
  expect((await get('clerk', `${PR}/candidates?vendorId=bad`)).status).toBe(400);
  const list = await get('clerk', `${PR}?vendorId=${vendor.id}&pageSize=100`);
  expect(list.status).toBe(200);
  const dbCount = (await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count;
  expect(list.body.total).toBe(dbCount);
  expect(list.body.global).toHaveProperty('submitted_count');
  expect((await get('clerk', `${PR}?status=NOPE`)).status).toBe(400);
  expect((await get('clerk', `${PR}?month=2038-13`)).status).toBe(400);
  expect((await get('clerk', `${PR}?vendorId=bad`)).status).toBe(400);
  const paidOnly = await get('clerk', `${PR}?status=PAID&vendorId=${vendor.id}`);
  expect((paidOnly.body.data as any[]).every((x) => x.status === 'PAID')).toBe(true);
  expect((await get('clerk', `${PR}?pageSize=1000`)).body.data.length).toBeLessThanOrEqual(100);
});

test('帳務機密：沒有廠商權限者統編與銀行遮蔽（API 與資料庫語意一致）；有權限者看得到；快照不隨廠商改帳號而變，草稿可重抓', async () => {
  const p = await createPr('clerk', rc[5].id);
  const asClerk = await get('clerk', `${PR}/${p.id}`);
  expect(asClerk.body.data.vendor_masked).toBe(false);
  expect(asClerk.body.data.bank_snapshot.bank_account).toBe('123-456-789012');
  expect(asClerk.body.data.vendor_tax_id_snapshot).toBe(vendor.tax_id);
  for (const who of ['viewer', 'novendor']) {
    const d = await get(who, `${PR}/${p.id}`);
    expect(d.status, who).toBe(200);
    expect(d.body.data.vendor_masked, who).toBe(true);
    expect(d.body.data.vendor_tax_id_snapshot, who).toBeNull();
    expect(d.body.data.bank_snapshot, who).toEqual({});
    expect(JSON.stringify(d.body), who).not.toContain('123-456-789012');
    const l = await get(who, `${PR}?vendorId=${vendor.id}`);
    expect(JSON.stringify(l.body), who).not.toContain('123-456-789012');
  }
  // 廠商改帳號：既有請款單快照不變；草稿重抓才更新
  await db().from('ga_vendors').update({ bank_account: '999-000-111222' }).eq('id', vendor.id);
  const same = await get('clerk', `${PR}/${p.id}`);
  expect(same.body.data.bank_snapshot.bank_account).toBe('123-456-789012');
  const re = await act('clerk', same.body.data, 'refresh_bank');
  expect(re.status, JSON.stringify(re.body)).toBe(200);
  expect(re.body.data.bank_snapshot.bank_account).toBe('999-000-111222');
  const submitted = (await act('clerk', re.body.data, 'submit')).body.data;
  await db().from('ga_vendors').update({ bank_account: '555-555-555555' }).eq('id', vendor.id);
  expect((await act('clerk', submitted, 'refresh_bank')).status).toBe(409);
  expect((await get('clerk', `${PR}/${p.id}`)).body.data.bank_snapshot.bank_account).toBe('999-000-111222');
  await db().from('ga_vendors').update({ bank_account: '123-456-789012' }).eq('id', vendor.id);
});

test('對帳匯出 CSV：月份必填、UTF-8 BOM、公式注入防護、無廠商權限者省略統編與銀行欄、檢視者可匯出、其他角色 403', async () => {
  const month = today().slice(0, 7);
  expect((await get('clerk', `${PR}/export`)).status).toBe(400);
  expect((await get('clerk', `${PR}/export?month=2038-13`)).status).toBe(400);
  expect((await get('clerk', `${PR}/export?month=${month}&vendorId=bad`)).status).toBe(400);
  expect((await get('clerk', `${PR}/export?month=${month}&status=X`)).status).toBe(400);
  // 廠商名稱以 = 開頭的快照：直接改資料庫快照驗公式注入防護
  const target = (await db().from('ga_payment_requests').select('id,pr_no').eq('vendor_id', vendor.id).limit(1).single()).data as any;
  const orig = (await db().from('ga_payment_requests').select('vendor_name_snapshot').eq('id', target.id).single()).data as any;
  await db().from('ga_payment_requests').update({ vendor_name_snapshot: '=HYPERLINK("http://x")' }).eq('id', target.id);
  try {
    const res = await apis.accountant.get(`${PR}/export?month=${month}&vendorId=${vendor.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain(encodeURIComponent('請款對帳'));
    const buf = await res.body();
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8').slice(1);
    const [head, ...rest] = text.split('\r\n');
    expect(head).toContain('請款單號');
    expect(head).toContain('廠商統編');
    expect(head).toContain('帳號');
    expect(text).toContain(target.pr_no);
    expect(text).toContain(`'=HYPERLINK("http://x")`.replace(/"/g, '""'));
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(rest.filter(Boolean).length).toBeGreaterThan(0);
    expect(text).toContain(vendor.tax_id);
    // 無廠商權限：欄位整欄省略，內容也沒有統編與帳號
    for (const who of ['viewer', 'novendor']) {
      const r2 = await apis[who].get(`${PR}/export?month=${month}&vendorId=${vendor.id}`);
      expect(r2.status(), who).toBe(200);
      const t2 = (await r2.body()).toString('utf8');
      expect(t2.split('\r\n')[0], who).not.toContain('廠商統編');
      expect(t2.split('\r\n')[0], who).not.toContain('帳號');
      expect(t2, who).not.toContain(vendor.tax_id);
      expect(t2, who).not.toContain('123-456-789012');
    }
    // 篩到沒有資料的月份：只有表頭
    const empty = await apis.clerk.get(`${PR}/export?month=2038-01&vendorId=${vendor.id}`);
    expect(empty.status()).toBe(200);
    expect((await empty.body()).toString('utf8').split('\r\n').filter(Boolean)).toHaveLength(1);
  } finally {
    await db().from('ga_payment_requests').update({ vendor_name_snapshot: orig.vendor_name_snapshot }).eq('id', target.id);
  }
});

test('請款設定：讀取需 view、修改需 manage；尾差 0 至 100 整數；版本檢查；調整後立即影響上限；買受人統編 8 碼；有調整紀錄', async () => {
  const g = await get('viewer', SET);
  expect(g.status).toBe(200);
  expect(g.body.data).toMatchObject({ tolerance_amount: 5, can_edit: false });
  const ga = await get('clerk', SET);
  expect(ga.body.data.can_edit).toBe(true);
  const ver = ga.body.data.updated_at as string;
  const put = (who: string, data: Record<string, unknown>) => send(who, 'put', SET, data);
  expect((await put('clerk', { tolerance_amount: 5 })).status).toBe(400); // 缺版本
  for (const bad of ['101', '-1', '5.5', 'abc', '']) {
    const r = await put('clerk', { tolerance_amount: bad, expected_updated_at: ver });
    expect(r.status, bad).toBe(400);
    expect(r.body.error as string).toContain('0 到 100');
  }
  expect((await put('clerk', { buyer_tax_id: '123', expected_updated_at: ver })).status).toBe(400);
  expect((await put('clerk', { approval_threshold: 1, expected_updated_at: ver })).status).toBe(400);
  expect((await put('clerk', { expected_updated_at: ver })).status).toBe(400);
  // 尾差改 0：短收進貨單最多只能請 630
  const ok = await put('clerk', { tolerance_amount: 0, buyer_title: 'QA-GA45 抬頭', buyer_tax_id: '12345678', expected_updated_at: ver });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  try {
    const now = await get('clerk', SET);
    expect(now.body.data).toMatchObject({ tolerance_amount: 0, buyer_title: 'QA-GA45 抬頭', buyer_tax_id: '12345678' });
    expect(now.body.data.history.length).toBeGreaterThan(0);
    const stale = await put('accountant', { tolerance_amount: 9, expected_updated_at: ver });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE');
    const over = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 600, claim_tax: 31 }] }));
    expect(over.status).toBe(409);
    const edge = await send('clerk', 'post', PR, mk(rcShort.id, { lines: [{ receipt_id: rcShort.id, claim_untaxed: 600, claim_tax: 30 }] }));
    expect(edge.status, JSON.stringify(edge.body)).toBe(201);
    await act('clerk', edge.body.data, 'void', {});
    // 列印頁用：詳情帶買受人
    const any = (await db().from('ga_payment_requests').select('id').eq('vendor_id', vendor.id).limit(1).single()).data as any;
    expect((await get('viewer', `${PR}/${any.id}`)).body.buyer).toMatchObject({ title: 'QA-GA45 抬頭', tax_id: '12345678' });
  } finally {
    const cur = await get('clerk', SET);
    await put('clerk', { tolerance_amount: 5, buyer_title: null, buyer_tax_id: null, expected_updated_at: cur.body.data.updated_at });
    const back = await get('clerk', SET);
    expect(back.body.data).toMatchObject({ tolerance_amount: 5, buyer_title: null, buyer_tax_id: null });
  }
});

test('發票規則：缺圖的發票不能放進請款單（建立 409）；免開發票類型可請款並帶出發票號碼；差異超過尾差要原因、5 元內免', async () => {
  const inv = async (type: string, extra: Record<string, unknown>) => {
    const r = await send('clerk', 'post', `${P}/purchase-invoices`, {
      invoice_type: type, invoice_date: today(), vendor_id: vendor.id, receipts: [{ receipt_id: rc[6].id }], idempotency_key: key(), ...extra,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as any;
  };
  const triple = await inv('TRIPLE', { invoice_no: `QA${String(Date.now()).slice(-8)}`, amount_untaxed: 100 });
  expect(triple.missing_image).toBe(true);
  const blocked = await send('clerk', 'post', PR, mk(rc[6].id, { lines: [{ receipt_id: rc[6].id, invoice_id: triple.id }] }));
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('INVOICE_MISSING_IMAGE');
  await send('clerk', 'post', `${P}/purchase-invoices/${triple.id}/actions`, { action: 'void', reason: '測試用', expected_updated_at: triple.updated_at, idempotency_key: key() });
  const noInv = await inv('NO_INVOICE', { amount_total: 105 });
  const ok = await send('clerk', 'post', PR, mk(rc[6].id, { lines: [{ receipt_id: rc[6].id, invoice_id: noInv.id }] }));
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  expect(ok.body.data.lines[0]).toMatchObject({ invoice_id: noInv.id, invoice_missing_image: false, claim_total: 105 });
  // 差異：請款 112（相差 7）要原因；110（相差 5）免
  await act('clerk', ok.body.data, 'void', {});
  const need = await send('clerk', 'post', PR, mk(rc[6].id, { lines: [{ receipt_id: rc[6].id, invoice_id: noInv.id, claim_untaxed: 100, claim_tax: 12 }] }));
  expect(need.status).toBe(400);
  expect(need.body.code).toBe('DIFF_REASON_REQUIRED');
  const withReason = await send('clerk', 'post', PR, mk(rc[6].id, { lines: [{ receipt_id: rc[6].id, invoice_id: noInv.id, claim_untaxed: 100, claim_tax: 12, diff_reason: '運費' }] }));
  expect(withReason.status, JSON.stringify(withReason.body)).toBe(201);
  expect(withReason.body.data.lines[0].diff_reason).toBe('運費');
  await act('clerk', withReason.body.data, 'void', {});
  const tail = await send('clerk', 'post', PR, mk(rc[6].id, { lines: [{ receipt_id: rc[6].id, invoice_id: noInv.id, claim_untaxed: 100, claim_tax: 10, diff_reason: '不需要' }] }));
  expect(tail.status, JSON.stringify(tail.body)).toBe(201);
  expect(tail.body.data.lines[0].diff_reason).toBeNull();
  // 已被有效請款單使用的發票不能作廢
  const vInv = await send('clerk', 'post', `${P}/purchase-invoices/${noInv.id}/actions`, { action: 'void', reason: '想作廢', expected_updated_at: (await get('clerk', `${P}/purchase-invoices/${noInv.id}`)).body.data.updated_at, idempotency_key: key() });
  expect(vInv.status).toBe(409);
  await act('clerk', tail.body.data, 'void', {});
});
