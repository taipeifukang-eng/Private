import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { call, cleanupGaib1, cleanupM7Users, expectErr, fakeCompany, key, mkPo, okData, poGet, prAct, prGet, receive, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1 審查修正（資料庫層）：
//   H1 預付單不能放進貨明細；H2 進貨單已有預付核銷時請款加核銷不能超過進貨單含稅額；M1 調整列轉承接後核銷額超過進貨單時自動回復；
//   M3 同仁代墊單送出時以同仁目前的匯款帳戶覆寫快照；M4 已全收但預付餘額未處理的提醒欄位與篩選；M5 已下訂的採購單用到的公司不能改名稱與統編；
//   M6 送出時買受人公司已停用要擋；L4 公司儲存的防重複識別碼內容不同回衝突；L7 查看同仁帳戶留稽核事件、帳戶變更記變更前末四碼。
// 測試資料：廠商名稱帶 QA-GAIB1- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(420_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'novendor', 'payonly', 'nobody', 'perf_nopay'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let vendor: any;

test.beforeAll(async () => {
  await assertGaBaseline();
  const left = await cleanupGaib1();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupGa45Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  vendor = await seedGaib1Vendor('RVW');
});
test.afterAll(async () => {
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
  expect(await cleanupM7Users(), '清除測試帳號（殘留）').toEqual([]);
});

const clerk = () => users.clerk;
const accountant = () => users.accountant;
const empA = () => users.nobody;
const createPrepay = (po: any, amount: number, extra: Record<string, unknown> = {}) =>
  call(clerk(), 'ga_ws_pay_prepay_create', { p_payload: { po_id: po.id, amount, ...extra }, p_key: key() });
const submitPay = async (pre: any) => {
  const sub = okData(await prAct(clerk(), pre, 'submit'));
  return okData(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'RVW' }));
};
const liveLedger = async (receiptId: string) => {
  const r = await adminDb().from('ga_payment_prepay_ledger').select('*').eq('receipt_id', receiptId).eq('kind', 'OFFSET').is('reversed_at', null);
  expect(r.error).toBeNull();
  return (r.data as any[]).reduce((s, x) => s + Number(x.amount), 0);
};
const claimReq = (receiptId: string, extra: Record<string, unknown> = {}) =>
  call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: receiptId, ...extra }] }, p_key: key() });
const ACCT = { bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試同仁' };

test('H1：預付款請款單不能放進貨明細（改明細與直接寫入都擋），金額不被覆寫', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'rv-h1' });
  const other = await mkPo(clerk(), vendor, { notes: 'rv-h1-other' });
  const rc = await receive(clerk(), other);
  const pre = okData(await createPrepay(po, 500));
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pre.id, p_payload: { lines: [{ receipt_id: rc.id }] }, p_expected_updated_at: pre.updated_at }), 409, 'PREPAY_NO_LINES');
  const ins = await adminDb().from('ga_payment_request_lines').insert({ pr_id: pre.id, line_no: 1, po_id: other.id, receipt_id: rc.id, claim_untaxed: 1000, claim_tax: 50, claim_total: 1050 });
  expect(ins.error?.message || '').toContain('預付款請款單不能放進貨明細');
  const after = await prGet(clerk(), pre.id);
  expect(after.amount_total).toBe(500);
  expect(after.lines).toEqual([]);
});

test('H2：進貨單已有預付核銷時，明確給金額也不能請滿全額', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'rv-h2' }); // 10×100，含稅 1050
  const pre = await submitPay(okData(await createPrepay(po, 525)));
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 5 }]); // 525，核銷 525
  expect(Number(r1.prepay_offset)).toBe(525);
  const r2 = await receive(clerk(), po, [{ line: 1, qty: 5 }]);
  expect(Number(r2.prepay_offset)).toBe(0);
  expectErr(await claimReq(r1.id, { claim_untaxed: 500 }), 409, 'PREPAY_COVERED');
  expectErr(await claimReq(r1.id), 409, 'PREPAY_COVERED');
  // 只請核銷後剩的 0 以外的金額不可能；沒核銷的 R2 仍可正常請滿
  const ok = okData(await claimReq(r2.id, { claim_untaxed: 500 }));
  expect(ok.lines[0]).toMatchObject({ claim_total: 525, prepay_offset: 0 });
  expect(pre.status).toBe('PAID');
});

test('M1：調整列轉承接到後到的進貨單時，超過該進貨單金額的核銷自動回復', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'rv-m1', header: { adjustments: [{ kind: 'DISCOUNT', amount: -300 }] } });
  const total = Number(po.total_amount);
  await submitPay(okData(await createPrepay(po, total)));
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 5 }]);
  const r2 = await receive(clerk(), po, [{ line: 1, qty: 5 }]);
  const sumRc = async () => okData(await call(clerk(), 'ga_ws_pay_po_summary', { p_po_id: po.id })).receipts as any[];
  const before = await sumRc();
  const t1 = Number(before.find((x) => x.receipt_id === r1.id).total);
  const t2 = Number(before.find((x) => x.receipt_id === r2.id).total);
  expect(t1).toBeLessThan(t2); // 折扣由第一張承接
  expect(await liveLedger(r1.id)).toBe(t1);
  expect(await liveLedger(r2.id)).toBe(t2);
  // 作廢 R1：折扣轉給 R2，R2 變小；核銷額跟著縮到 R2 新的含稅額
  okData(await call(clerk(), 'ga_ws_po_receipt_void', { p_po_id: po.id, p_receipt_id: r1.id, p_reason: '測試作廢進貨', p_key: key(), p_expected_updated_at: r1.updated_at }));
  const n2 = (await sumRc()).find((x) => x.receipt_id === r2.id);
  expect(Number(n2.total)).toBeLessThan(t2);
  expect(await liveLedger(r2.id)).toBe(Number(n2.total));
  expect(Number(n2.prepay_offset)).toBe(Number(n2.total));
});

test('M3：同仁代墊單草稿後帳戶被改，送出時快照以最新帳戶為準；L7 查看與變更留稽核事件', async () => {
  okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: ACCT }));
  const po = await mkPo(clerk(), vendor, { notes: 'rv-m3' });
  const rc = await receive(clerk(), po);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], payee_type: 'EMPLOYEE', payee_profile_id: empA().id }, p_key: key() }));
  expect((await prGet(accountant(), pr.id)).payee_account_snapshot.bank_account).toBe('123-456-789012');
  // 草稿後同仁改了帳號
  const upd = okData(await call(empA(), 'ga_ws_payout_account_set_own', { p_payload: { bank_account: '555-666-777888' } }));
  expect(upd.changed_fields).toEqual(['bank_account']);
  const sub = okData(await prAct(clerk(), pr, 'submit'));
  expect((await prGet(accountant(), sub.id)).payee_account_snapshot.bank_account).toBe('555-666-777888');
  // 稽核：變更前末四碼、查看事件（只記末四碼，不含帳號本文）
  expect(okData(await call(accountant(), 'ga_ws_payout_account_get_for', { p_profile: empA().id })).account.bank_account).toBe('555-666-777888');
  const ev = await adminDb().from('ga_employee_payout_account_events').select('*').eq('profile_id', empA().id).order('created_at');
  const rows = ev.data as any[];
  const changed = rows.find((x) => x.via === 'SELF' && x.prev_last4 === '9012');
  expect(changed).toMatchObject({ account_last4: '7888' });
  const view = rows.filter((x) => x.via === 'VIEW');
  expect(view).toHaveLength(1);
  expect(view[0]).toMatchObject({ actor_id: accountant().id, account_last4: '7888', changed_fields: [] });
  const text = JSON.stringify(rows);
  expect(text).not.toContain('555-666-777888');
  expect(text).not.toContain('123-456-789012');
  // 本人查看自己的帳戶不留查看事件
  await call(empA(), 'ga_ws_payout_account_get_own');
  expect(((await adminDb().from('ga_employee_payout_account_events').select('id').eq('profile_id', empA().id).eq('via', 'VIEW')).data as any[]).length).toBe(1);
});

test('M4：已全部到貨但預付餘額還沒處理，採購單摘要與請款單列表會標出來', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'rv-m4' }); // 1050
  const pre = await submitPay(okData(await createPrepay(po, 1050)));
  // 實務上拒收或單價差會讓採購單全收但實收金額小於預付；這裡以半收加管理端把狀態改成 RECEIVED 模擬（只動測試自己的採購單）
  await receive(clerk(), po, [{ line: 1, qty: 6 }]); // 含稅 630，核銷 630
  const fx = await adminDb().from('ga_purchase_orders').update({ status: 'RECEIVED' }).eq('id', po.id);
  expect(fx.error, JSON.stringify(fx.error)).toBeNull();
  const cur = await poGet(clerk(), po.id);
  expect(cur.status).toBe('RECEIVED');
  expect(cur.prepay).toMatchObject({ unsettled: true, overdue: false });
  expect(Number(cur.prepay.balance)).toBeGreaterThan(0);
  const one = await prGet(clerk(), pre.id);
  expect(one.prepay_unsettled).toBe(true);
  const list = okData(await call(clerk(), 'ga_ws_pay_request_list', { p_filters: { pay_kind: 'PREPAY', prepay_overdue: '1' }, p_page: 1, p_page_size: 50 }));
  expect((list.rows as any[]).map((x) => x.id)).toContain(pre.id);
  // 登記退款後餘額清空，不再標示
  const cur2 = await prGet(clerk(), pre.id);
  okData(await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: pre.id, p_amount: Number(cur2.prepay_balance), p_reason: '廠商退款', p_key: key(), p_expected_updated_at: cur2.updated_at }));
  expect((await prGet(clerk(), pre.id)).prepay_unsettled).toBe(false);
});

test('M5／M6／L4：買受人公司已被下訂後的採購單用到就不能改名稱與統編；送出時公司已停用要擋；防重複識別碼內容不同回衝突', async () => {
  const save = (payload: Record<string, unknown>, expected: string | null = null, k: string = key()) =>
    call(clerk(), 'ga_ws_buyer_company_save', { p_payload: payload, p_key: k, p_expected_updated_at: expected });
  const fc = fakeCompany('RVW1');
  const k1 = key();
  const created = okData(await save(fc, null, k1));
  const row = (list: any) => (list.rows as any[]).find((x) => x.id === created.id);
  // L4：同 key 同內容重播；不同內容衝突
  const replay = await save(fc, null, k1);
  expect(replay.replay).toBe(true);
  expectErr(await save({ ...fc, name: fc.name + 'X' }, null, k1), 409, 'IDEMPOTENCY_CONFLICT');
  // M5：草稿採購單用到時可改名；下訂後不可改名也不可改統編，但可停用
  const draft = await mkPo(clerk(), vendor, { notes: 'rv-m5-draft', place: false, header: { buyer_company_id: created.id } });
  const renamed = okData(await save({ id: created.id, name: fc.name + '-改名' }, row(created).updated_at));
  expect(row(renamed).name).toBe(fc.name + '-改名');
  const placed = okData(await call(clerk(), 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null }));
  expect(placed.buyer_company_id ?? created.id).toBe(created.id);
  expectErr(await save({ id: created.id, name: fc.name + '-再改' }, row(renamed).updated_at), 409, 'BUYER_IN_USE');
  expectErr(await save({ id: created.id, tax_id: fakeCompany('x').tax_id }, row(renamed).updated_at), 409, 'BUYER_IN_USE');
  // M6：草稿請款單選了這家公司，公司被停用後送出被擋，改選有效公司後可送出
  const po = await mkPo(clerk(), vendor, { notes: 'rv-m6' });
  const rc = await receive(clerk(), po);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], buyer_company_id: created.id }, p_key: key() }));
  const off = okData(await save({ id: created.id, is_active: false }, row(renamed).updated_at));
  expect(row(off).is_active).toBe(false);
  expectErr(await prAct(clerk(), pr, 'submit'), 404, 'BUYER_NOT_FOUND');
  const dflt = { id: okData(await save(fakeCompany('RVW2'))).id as string };
  const fixed = okData(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { buyer_company_id: dflt.id }, p_expected_updated_at: (await prGet(clerk(), pr.id)).updated_at }));
  const sub = okData(await prAct(clerk(), fixed, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
});
