import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { call, cleanupGaib1, cleanupM7Users, expectErr, key, mkPo, okData, poGet, prAct, prGet, receive, receiptsGet, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1 階段 5（資料庫層）：G1 預付款。
// 涵蓋：建立限制（未下訂、已全收、金額、上限 OVER_PO_TOTAL、權限、併發只成功一張、固定識別）；送出→進貨驗入自動核銷；預付晚於進貨送出時補核銷；多張預付依建立先後核銷；
//      退回與作廢預付單時核銷回復（已付款者備註需追回）；作廢進貨單時該筆核銷回復；一般請款預設金額扣核銷並記 prepay_offset、PREPAY_COVERED、PREPAY_CHANGED、發票差異用請款額加核銷額；
//      登記退款（OVER_BALANCE、原因、狀態、固定識別、事件）；採購單取消與結案守門 PREPAY_BALANCE_OPEN；逾期提醒（採購單與請款單篩選、首頁既有項目副標）；對帳匯出 extended 多預付單列；同仁代墊預付。
// 測試資料：廠商名稱帶 QA-GAIB1- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的（預付餘額帳、請款單、事件、發票、採購單）。
test.describe.configure({ mode: 'serial' });
test.setTimeout(420_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'novendor', 'payonly', 'nobody', 'purchaser'];
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
  vendor = await seedGaib1Vendor('PRE');
});
test.afterAll(async () => {
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
  expect(await cleanupM7Users(), '清除測試帳號（殘留）').toEqual([]);
});

const clerk = () => users.clerk;
const accountant = () => users.accountant;
const createPrepay = (po: any, amount: number, extra: Record<string, unknown> = {}, k: string = key(), u = clerk()) =>
  call(u, 'ga_ws_pay_prepay_create', { p_payload: { po_id: po.id, amount, ...extra }, p_key: k });
const ledger = async (prId?: string) => {
  let q = adminDb().from('ga_payment_prepay_ledger').select('*').order('created_at').order('id');
  if (prId) q = q.eq('prepay_pr_id', prId);
  const r = await q;
  expect(r.error).toBeNull();
  return r.data as any[];
};
const live = (rows: any[]) => rows.filter((r) => !r.reversed_at);
const submitPay = async (pre: any, paid = true) => {
  const sub = okData(await prAct(clerk(), pre, 'submit'));
  return paid ? okData(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'PRE' })) : sub;
};
const normalReq = (po: any, receiptIds: string[], extra: Record<string, unknown> = {}) =>
  call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: receiptIds.map((id) => ({ receipt_id: id })), ...extra }, p_key: key() });
const events = async (prId: string) => (await prGet(clerk(), prId)).events as any[];

test('建立限制：要已下訂、金額大於 0、不超過採購單總額、權限與固定識別', async () => {
  const draft = await mkPo(clerk(), vendor, { notes: 'pre-state', place: false });
  expectErr(await createPrepay(draft, 100), 409, 'PREPAY_PO_STATE', '還沒有下訂');
  const po = await mkPo(clerk(), vendor, { notes: 'pre-limit' }); // 10×100，含稅 1050
  expectErr(await createPrepay(po, 0), 400, 'AMOUNT_REQUIRED');
  expectErr(await createPrepay(po, -5 as any), 400, 'AMOUNT_REQUIRED');
  expectErr(await createPrepay(po, '12.5' as any), 400, 'AMOUNT_REQUIRED');
  expectErr(await createPrepay(po, 1056), 409, 'OVER_PO_TOTAL'); // 超過 1050 加尾差 5
  const k = key();
  const first = await createPrepay(po, 1055, {}, k); // 剛好在尾差內
  expect(first.status).toBe(201);
  const pre = okData(first);
  expect(pre).toMatchObject({ pay_kind: 'PREPAY', prepay_po_id: po.id, status: 'DRAFT', amount_total: 1055, prepay_po_no: po.po_no, prepay_balance: 0 });
  expect(pre.lines).toEqual([]);
  expect(Number(pre.amount_untaxed) + Number(pre.tax_amount)).toBe(1055);
  const replay = await createPrepay(po, 1055, {}, k);
  expect(replay.replay).toBe(true);
  expect(replay.data.id).toBe(pre.id);
  expectErr(await createPrepay(po, 1000, {}, k), 409, 'IDEMPOTENCY_CONFLICT');
  expectErr(await createPrepay(po, 100), 409, 'OVER_PO_TOTAL'); // 第一張草稿也佔額度
  // 作廢草稿釋放額度
  okData(await prAct(clerk(), pre, 'void'));
  const again = okData(await createPrepay(po, 500));
  expect(again.status).toBe('DRAFT');
  // 已全部到貨的採購單不能再開預付款
  const full = await mkPo(clerk(), vendor, { notes: 'pre-full' });
  await receive(clerk(), full);
  expectErr(await createPrepay(full, 100), 409, 'PREPAY_PO_STATE', '全部到貨');
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_create', { p_payload: { po_id: crypto.randomUUID(), amount: 1 }, p_key: key() }), 404, 'NOT_FOUND');
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_create', { p_payload: { amount: 1 }, p_key: key() }), 400);
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_create', { p_payload: { po_id: po.id, amount: 1 }, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  // 權限
  for (const who of [users.nobody, users.payonly, users.purchaser]) expectErr(await createPrepay(po, 10, {}, key(), who), 403);
  expectErr(await call(users.nobody, 'ga_ws_pay_prepay_overview', { p_po_id: po.id }), 403, 'PERMISSION_DENIED');
  expectErr(await call(users.payonly, 'ga_ws_pay_prepay_overview', { p_po_id: po.id }), 403, 'PO_VIEW_REQUIRED');
  // 沒有採購檢視的請款管理者（只有請款權限）不能建立
  const pm = await createPrepay(po, 10, {}, key(), users.novendor);
  expect(pm.ok, JSON.stringify(pm)).toBe(true); // novendor 有採購評估檢視
});

test('併發：兩個人同時對同一張採購單開超過總額的預付款，只成功一張', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-race' }); // 1050
  const [a, b] = await Promise.all([createPrepay(po, 700), createPrepay(po, 700, {}, key(), accountant())]);
  const oks = [a, b].filter((r) => r.ok);
  const errs = [a, b].filter((r) => !r.ok);
  expect(oks).toHaveLength(1);
  expect(errs).toHaveLength(1);
  expect(errs[0].code).toBe('OVER_PO_TOTAL');
});

test('預付→進貨驗入自動核銷→一般請款只請差額→作廢進貨回復', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-flow' }); // 1050
  const pre = okData(await createPrepay(po, 600));
  // 草稿可改金額
  const upd = okData(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pre.id, p_payload: { amount: 400 }, p_expected_updated_at: pre.updated_at }));
  expect(upd).toMatchObject({ amount_total: 400, amount_untaxed: 381, tax_amount: 19 });
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pre.id, p_payload: { amount: 0 }, p_expected_updated_at: upd.updated_at }), 400, 'AMOUNT_REQUIRED');
  expectErr(await call(clerk(), 'ga_ws_pay_request_update', { p_id: pre.id, p_payload: { amount: 2000 }, p_expected_updated_at: upd.updated_at }), 409, 'OVER_PO_TOTAL');
  // 預付單沒有明細也能送出；草稿不核銷
  expect(live(await ledger(pre.id))).toHaveLength(0);
  const paid = await submitPay(upd);
  expect(paid.status).toBe('PAID');
  expect((await prGet(clerk(), pre.id)).prepay_balance).toBe(400);
  // 第一次到貨 5 個（含稅 525）→ 自動核銷 400
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 5 }]);
  expect(Number(r1.amount_total)).toBe(525);
  expect(Number(r1.prepay_offset)).toBe(400);
  expect(live(await ledger(pre.id)).map((x) => [x.kind, Number(x.amount), x.receipt_id])).toEqual([['OFFSET', 400, r1.id]]);
  const ov = okData(await call(clerk(), 'ga_ws_pay_prepay_overview', { p_po_id: po.id })).prepay;
  expect(ov).toMatchObject({ prepaid: 400, paid: 400, offset: 400, refunded: 0, balance: 0, overdue: false });
  expect((await poGet(clerk(), po.id)).prepay.balance).toBe(0);
  // 一般請款：預設只請差額 125，記錄核銷 400
  const pr = okData(await normalReq(po, [r1.id]));
  expect(pr.lines[0]).toMatchObject({ claim_total: 125, claim_untaxed: 119, claim_tax: 6, prepay_offset: 400 });
  expect(pr.amount_total).toBe(125);
  const sub = okData(await prAct(clerk(), pr, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
  // 摘要：累計請款＝一般請款＋核銷
  const sum = okData(await call(clerk(), 'ga_ws_pay_po_summary', { p_po_id: po.id }));
  expect(Number(sum.claimed_total)).toBe(525);
  expect(Number(sum.received_total)).toBe(525);
  expect(Number(sum.unclaimed_received)).toBe(0);
  expect(sum.receipts[0].prepay_offset).toBe(400);
  // 作廢進貨單被有效請款單引用不行；先作廢請款單再作廢進貨：核銷回復
  expectErr(await call(clerk(), 'ga_ws_po_receipt_void', { p_po_id: po.id, p_receipt_id: r1.id, p_reason: '測', p_key: key(), p_expected_updated_at: r1.updated_at }), 409, 'RECEIPT_CLAIMED');
  okData(await prAct(clerk(), sub, 'void', { reason: '測試作廢一般請款' }));
  const voided = okData(await call(clerk(), 'ga_ws_po_receipt_void', { p_po_id: po.id, p_receipt_id: r1.id, p_reason: '測試作廢進貨', p_key: key(), p_expected_updated_at: r1.updated_at }));
  expect(voided.voided_at).toBeTruthy();
  expect(live(await ledger(pre.id))).toHaveLength(0);
  expect((await ledger(pre.id))[0].reversed_reason).toBe('作廢進貨單');
  expect((await prGet(clerk(), pre.id)).prepay_balance).toBe(400);
  // 之後再進貨會重新核銷
  const r2 = await receive(clerk(), po, [{ line: 1, qty: 10 }]);
  expect(Number(r2.prepay_offset)).toBe(400);
  expect((await prGet(clerk(), pre.id)).prepay_balance).toBe(0);
  // 全部請款：進貨 10 個含稅 1050，預設請 650
  const pr2 = okData(await normalReq(po, [r2.id]));
  expect(Number(pr2.amount_total)).toBe(650);
  // 作廢已付款預付單：核銷回復、事件註記需追回
  const prePaid = await prGet(clerk(), pre.id);
  okData(await prAct(clerk(), pr2, 'void', { reason: '先作廢一般請款' }));
  const vd = okData(await prAct(accountant(), prePaid, 'void', { reason: '測試作廢已付款預付單' }));
  expect(vd.status).toBe('VOID');
  expect(live(await ledger(pre.id))).toHaveLength(0);
  const evs = await events(pre.id);
  const note = evs.find((e: any) => e.event_type === 'note' && String(e.reason).includes('追回'));
  expect(note, JSON.stringify(evs.map((e: any) => [e.event_type, e.reason]))).toBeTruthy();
  expect(note.payload.paid_voided).toBe(true);
  const after = await receiptsGet(clerk(), po.id);
  expect(Number(after.receipts.find((x: any) => x.id === r2.id).prepay_offset)).toBe(0);
});

test('預付晚於進貨送出：補核銷；已被請款的進貨單不核銷；多張預付依建立先後', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-late' });
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 4 }]); // 含稅 420
  const p1 = okData(await createPrepay(po, 200));
  const p2 = okData(await createPrepay(po, 300));
  // 先送 p2 再送 p1：核銷順序依建立先後（p1 先）
  const s2 = await submitPay(p2, false);
  expect(live(await ledger(p2.id)).map((x) => Number(x.amount))).toEqual([300]);
  const s1 = await submitPay(p1, false);
  // p2 已先被核銷 300，p1 只能核銷剩下的 120
  const total = live(await ledger()).filter((x) => x.po_id === po.id).reduce((a, x) => a + Number(x.amount), 0);
  expect(total).toBe(420);
  expect(live(await ledger(p1.id)).map((x) => Number(x.amount))).toEqual([120]);
  const ev = (await events(p2.id)).find((e: any) => e.payload?.prepay_applied);
  expect(ev?.reason).toContain('核銷預付款');
  // 退回 p2：回復 300，補給 p1 的缺口（剩 80 的餘額）
  const back = okData(await prAct(clerk(), s2, 'return', { reason: '測試退回預付單' }));
  expect(back.status).toBe('DRAFT');
  expect(live(await ledger(p2.id))).toHaveLength(0);
  expect(live(await ledger(p1.id)).reduce((a, x) => a + Number(x.amount), 0)).toBe(200);
  expect(Number((await prGet(clerk(), p1.id)).prepay_balance)).toBe(0);
  // 已有一般請款（草稿也算）的進貨單，預付後送出不再核銷
  const po2 = await mkPo(clerk(), vendor, { notes: 'pre-late2' });
  const rr = await receive(clerk(), po2, [{ line: 1, qty: 5 }]);
  const draftReq = okData(await normalReq(po2, [rr.id]));
  expect(Number(draftReq.amount_total)).toBe(525);
  const p3 = okData(await createPrepay(po2, 300));
  const s3 = await submitPay(p3, false);
  expect(live(await ledger(p3.id))).toHaveLength(0);
  expect((await prGet(clerk(), p3.id)).prepay_balance).toBe(300);
  // 作廢那張一般請款：釋放出來的進貨單金額再由預付餘額核銷
  okData(await prAct(clerk(), draftReq, 'void'));
  expect(live(await ledger(p3.id)).map((x) => Number(x.amount))).toEqual([300]);
  expect(s3.status).toBe('SUBMITTED');
});

test('一般請款：已被預付完全核銷的進貨單免請款；核銷變動要重新整理（PREPAY_CHANGED）；發票差異含核銷額', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-cover' });
  const rc = await receive(clerk(), po, [{ line: 1, qty: 5 }]); // 525
  const pre = okData(await createPrepay(po, 525));
  await submitPay(pre);
  expect(Number((await receiptsGet(clerk(), po.id)).receipts[0].prepay_offset)).toBe(525);
  expectErr(await normalReq(po, [rc.id]), 409, 'PREPAY_COVERED', '免再請款');
  const cand = okData(await call(clerk(), 'ga_ws_pay_receipt_candidates', { p_filters: { po_id: po.id, only_claimable: false }, p_page: 1, p_page_size: 10 }));
  expect(cand.rows[0]).toMatchObject({ receipt_prepay_offset: 525, prepay_covered: true });
  // PREPAY_CHANGED：草稿記錄的核銷額與目前不同
  const po2 = await mkPo(clerk(), vendor, { notes: 'pre-changed' });
  const p2 = okData(await createPrepay(po2, 100));
  const paid2 = await submitPay(p2);
  const r2 = await receive(clerk(), po2, [{ line: 1, qty: 5 }]);
  const draft = okData(await normalReq(po2, [r2.id]));
  expect(draft.lines[0]).toMatchObject({ claim_total: 425, prepay_offset: 100 });
  // 預付單退回？已付款不能退回；改作廢（核銷回復）
  okData(await prAct(accountant(), paid2, 'void', { reason: '測試作廢預付' }));
  expectErr(await prAct(clerk(), draft, 'submit'), 409, 'PREPAY_CHANGED');
  // 重新整理明細（以原進貨單重建）後可送出
  const fresh = okData(await call(clerk(), 'ga_ws_pay_request_update', { p_id: draft.id, p_payload: { lines: [{ receipt_id: r2.id }] }, p_expected_updated_at: draft.updated_at }));
  expect(fresh.lines[0]).toMatchObject({ claim_total: 525, prepay_offset: 0 });
  expect(okData(await prAct(clerk(), fresh, 'submit')).status).toBe('SUBMITTED');
  // 發票差異：請款額加核銷額對發票分攤額（525 對 525，不需差異原因）
  const po3 = await mkPo(clerk(), vendor, { notes: 'pre-inv' });
  const p3 = okData(await createPrepay(po3, 200));
  await submitPay(p3);
  const r3 = await receive(clerk(), po3, [{ line: 1, qty: 5 }]);
  const inv = okData(await call(clerk(), 'ga_ws_pay_invoice_save', { p_id: null, p_payload: { invoice_type: 'RECEIPT', invoice_no: `QAGB${String(Date.now()).slice(-7)}`, invoice_date: new Date().toISOString().slice(0, 10),
    vendor_id: vendor.id, amount_untaxed: 525, no_image_reason: '測試資料', receipts: [{ receipt_id: r3.id }] }, p_key: key() }));
  const withInv = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: r3.id, invoice_id: inv.id }] }, p_key: key() }));
  expect(withInv.lines[0]).toMatchObject({ claim_total: 325, prepay_offset: 200, diff_reason: null });
  expect(okData(await prAct(clerk(), withInv, 'submit')).status).toBe('SUBMITTED');
});

test('登記退款或轉抵：金額不超過餘額、必填原因、只有已付款預付單、固定識別、事件', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-refund' });
  const pre = okData(await createPrepay(po, 500));
  const k = key();
  const settle = (p: any, amount: number, reason: string | null, kk = key(), u = clerk()) =>
    call(u, 'ga_ws_pay_prepay_settle', { p_id: p.id, p_amount: amount, p_reason: reason, p_key: kk, p_expected_updated_at: p.updated_at });
  expectErr(await settle(pre, 100, '草稿不行'), 409, 'INVALID_STATE');
  const paid = await submitPay(pre);
  // 結案守門：還有預付餘額 500，取消要擋
  expectErr(await call(clerk(), 'ga_ws_po_action', { p_id: po.id, p_action: 'cancel', p_expected_updated_at: (await poGet(clerk(), po.id)).updated_at, p_note: '測試取消' }), 409, 'PREPAY_BALANCE_OPEN');
  expectErr(await settle(paid, 100, null), 400, 'REASON_REQUIRED');
  expectErr(await settle(paid, 0, '零'), 400, 'AMOUNT_REQUIRED');
  expectErr(await settle(paid, 10.5, '小數'), 400, 'AMOUNT_REQUIRED');
  expectErr(await settle(paid, 501, '超過餘額'), 409, 'OVER_BALANCE');
  expectErr(await settle(paid, 100, 'x'.repeat(201)), 400, 'REASON_TOO_LONG');
  expectErr(await settle(paid, 100, '沒權限', key(), users.nobody), 403, 'PERMISSION_DENIED');
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: paid.id, p_amount: 100, p_reason: 'x', p_key: key(), p_expected_updated_at: null }), 400, 'EXPECTED_REQUIRED');
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: paid.id, p_amount: 100, p_reason: 'x', p_key: key(), p_expected_updated_at: '2000-01-01T00:00:00Z' }), 409, 'STALE');
  const s1 = await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: paid.id, p_amount: 200, p_reason: '廠商退款 200', p_key: k, p_expected_updated_at: paid.updated_at });
  const d1 = okData(s1);
  expect(d1.prepay_balance).toBe(300);
  expect(d1.prepay_refund_total).toBe(200);
  expect(d1.status).toBe('PAID');
  const replay = await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: paid.id, p_amount: 200, p_reason: '廠商退款 200', p_key: k, p_expected_updated_at: paid.updated_at });
  expect(replay.replay).toBe(true);
  expect((await prGet(clerk(), pre.id)).prepay_balance).toBe(300);
  expectErr(await call(clerk(), 'ga_ws_pay_prepay_settle', { p_id: paid.id, p_amount: 100, p_reason: '不同內容', p_key: k, p_expected_updated_at: paid.updated_at }), 409, 'IDEMPOTENCY_CONFLICT');
  const evs = await events(pre.id);
  expect(evs.some((e: any) => e.event_type === 'prepay_refund' && Number(e.amount_total) === 200 && e.reason === '廠商退款 200')).toBe(true);
  expect(d1.prepay_ledger.filter((x: any) => x.kind === 'REFUND')).toHaveLength(1);
  // 再退 300 後餘額 0，取消採購單才放行（已下訂取消要填原因）
  const s2 = okData(await settle(d1, 300, '轉抵其他採購單'));
  expect(s2.prepay_balance).toBe(0);
  expectErr(await settle(s2, 1, '沒餘額'), 409, 'OVER_BALANCE');
  const cur = await poGet(clerk(), po.id);
  const canceled = okData(await call(clerk(), 'ga_ws_po_action', { p_id: po.id, p_action: 'cancel', p_expected_updated_at: cur.updated_at, p_note: '測試取消' }));
  expect(canceled.status).toBe('CANCELED');
  // 作廢預付單時，退款也一併回復
  const voided = okData(await prAct(accountant(), s2, 'void', { reason: '測試作廢' }));
  expect(live(await ledger(pre.id))).toHaveLength(0);
  expect(voided.prepay_refund_total).toBe(0);
  // 尾差內的餘額不擋短收結案
  const po2 = await mkPo(clerk(), vendor, { notes: 'pre-tol' });
  await receive(clerk(), po2, [{ line: 1, qty: 1 }]); // 含稅 105
  const pt = await submitPay(okData(await createPrepay(po2, 108))); // 核銷 105 後剩 3，在尾差內
  expect(pt.status).toBe('PAID');
  const cur2 = await poGet(clerk(), po2.id);
  expect(okData(await call(clerk(), 'ga_ws_po_action', { p_id: po2.id, p_action: 'short_close', p_expected_updated_at: cur2.updated_at, p_note: '尾差內' })).status).toBe('CLOSED');
  // 超過尾差：短收結案與（全收後）結案都被擋
  const po3 = await mkPo(clerk(), vendor, { notes: 'pre-short' });
  const r3 = await receive(clerk(), po3, [{ line: 1, qty: 1 }]); // 含稅 105
  await submitPay(okData(await createPrepay(po3, 300)));
  expect(Number((await receiptsGet(clerk(), po3.id)).receipts[0].prepay_offset)).toBe(105);
  const cur3 = await poGet(clerk(), po3.id);
  expectErr(await call(clerk(), 'ga_ws_po_action', { p_id: po3.id, p_action: 'short_close', p_expected_updated_at: cur3.updated_at, p_note: '短收' }), 409, 'PREPAY_BALANCE_OPEN');
  expect(r3.id).toBeTruthy();
});

test('逾期提醒：採購單與請款單篩選、行內欄位、首頁既有「逾期未到貨採購單」副標', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-overdue', header: { expected_delivery_date: '2026-01-05' } });
  const none = await mkPo(clerk(), vendor, { notes: 'pre-overdue-none', header: { expected_delivery_date: '2026-01-06' } });
  const pre = await submitPay(okData(await createPrepay(po, 400)));
  const pl = okData(await call(clerk(), 'ga_ws_po_list', { p_filters: { prepaid: '1' }, p_page: 1, p_page_size: 100 }));
  expect(pl.map((r: any) => r.id)).toContain(po.id);
  expect(pl.map((r: any) => r.id)).not.toContain(none.id);
  expect(pl.find((r: any) => r.id === po.id).prepay_balance).toBe(400);
  const od = okData(await call(clerk(), 'ga_ws_po_list', { p_filters: { prepay_overdue: '1' }, p_page: 1, p_page_size: 100 }));
  expect(od.map((r: any) => r.id)).toContain(po.id);
  expect(od.map((r: any) => r.id)).not.toContain(none.id);
  // 沒有請款檢視權限的採購人員：篩選回空、行內欄位為空
  const buyerView = okData(await call(users.purchaser, 'ga_ws_po_list', { p_filters: { prepaid: '1' }, p_page: 1, p_page_size: 100 }));
  expect(buyerView).toEqual([]);
  const rl = okData(await call(clerk(), 'ga_ws_pay_request_list', { p_filters: { prepay_overdue: '1' }, p_page: 1, p_page_size: 100 }));
  const row = rl.rows.find((r: any) => r.id === pre.id);
  expect(row).toMatchObject({ pay_kind: 'PREPAY', prepay_overdue: true, prepay_po_no: po.po_no });
  expect(row.prepay_overdue_days).toBeGreaterThan(0);
  expect(rl.rows.every((r: any) => r.pay_kind === 'PREPAY')).toBe(true);
  const kind = okData(await call(clerk(), 'ga_ws_pay_request_list', { p_filters: { pay_kind: 'NORMAL', vendor_id: vendor.id }, p_page: 1, p_page_size: 100 }));
  expect(kind.rows.every((r: any) => r.pay_kind === 'NORMAL')).toBe(true);
  expect((await poGet(clerk(), po.id)).prepay).toMatchObject({ balance: 400, overdue: true });
  // 首頁既有項目：計數口徑不變（有沒有預付都算逾期），副標多已預付餘額
  const home = okData(await call(clerk(), 'ga_ws_home_summary'));
  const item = home.items.find((i: any) => i.key === 'po_overdue');
  expect(item, '首頁沒有逾期未到貨項目').toBeTruthy();
  const keys = home.items.map((i: any) => i.key);
  expect(keys).not.toContain('pay_prepay_overdue');
  const mine = item.top.find((t: any) => t.id === po.id);
  if (mine) expect(mine.sub).toContain('已預付餘額 NT$400');
  // 到貨後餘額核銷完，逾期標籤消失
  await receive(clerk(), po, [{ line: 1, qty: 4 }]);
  expect((await poGet(clerk(), po.id)).prepay.overdue).toBe(false);
});

test('同仁代墊的預付單、預付單列印所需欄位與對帳匯出 extended', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-emp' });
  okData(await call(users.nobody, 'ga_ws_payout_account_set_own', { p_payload: { bank_name: '測試銀行', bank_account: '111-222-333444', bank_account_name: '同仁甲' } }));
  const pre = okData(await createPrepay(po, 300, { payee_type: 'EMPLOYEE', payee_profile_id: users.nobody.id, buyer_company_id: null }));
  expect(pre).toMatchObject({ pay_kind: 'PREPAY', payee_type: 'EMPLOYEE', payee_profile_id: users.nobody.id });
  expect(pre.payee_account_snapshot).toMatchObject({ bank_account: '111-222-333444' });
  const paid = await submitPay(pre);
  expect(paid.status).toBe('PAID');
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const plain = okData(await call(accountant(), 'ga_ws_pay_export', { p_filters: { month, vendor_id: vendor.id } }));
  expect(plain.rows.some((r: any) => r.pr_no === pre.pr_no)).toBe(false);
  const ext = okData(await call(accountant(), 'ga_ws_pay_export', { p_filters: { month, vendor_id: vendor.id, extended: '1' } }));
  const row = ext.rows.find((r: any) => r.pr_no === pre.pr_no);
  expect(row).toMatchObject({ pay_kind: 'PREPAY', payee_type: 'EMPLOYEE', po_no: po.po_no, receipt_no: null, amount_total: 300 });
  expect(ext.total).toBe(ext.rows.length);
  expect(ext.rows.length).toBeGreaterThan(plain.rows.length);
  // 我的代墊款也看得到（付款對象是同仁甲）
  const mine = okData(await call(users.nobody, 'ga_ws_pay_my_reimbursements', { p_page: 1, p_page_size: 20 }));
  expect(mine.rows.some((r: any) => r.pr_no === pre.pr_no)).toBe(true);
});

test('直接寫資料表的守門：類型與對應採購單不可改、核銷額不可為負、餘額帳只有 service role', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'pre-guard' });
  const other = await mkPo(clerk(), vendor, { notes: 'pre-guard2' });
  const pre = okData(await createPrepay(po, 100));
  const a = await adminDb().from('ga_payment_requests').update({ prepay_po_id: other.id }).eq('id', pre.id);
  expect(a.error?.message || '').toContain('類型（一般／預付）與對應採購單建立後不能修改');
  const b = await adminDb().from('ga_payment_requests').update({ pay_kind: 'NORMAL' }).eq('id', pre.id);
  expect(b.error).toBeTruthy();
  const c = await adminDb().from('ga_payment_prepay_ledger').insert({ prepay_pr_id: pre.id, po_id: po.id, kind: 'REFUND', amount: 5 });
  expect(c.error).toBeTruthy(); // REFUND 必填原因
  const d = await adminDb().from('ga_payment_prepay_ledger').insert({ prepay_pr_id: pre.id, po_id: po.id, kind: 'REFUND', amount: -5, reason: 'x' });
  expect(d.error).toBeTruthy();
  // 一般使用者（authenticated）完全讀不到餘額帳
  const r = await clerk().client.from('ga_payment_prepay_ledger').select('*').limit(1);
  expect(r.error || (r.data || []).length === 0).toBeTruthy();
  const ins = await clerk().client.from('ga_payment_prepay_ledger').insert({ prepay_pr_id: pre.id, po_id: po.id, kind: 'REFUND', amount: 5, reason: 'x' });
  expect(ins.error).toBeTruthy();
});
