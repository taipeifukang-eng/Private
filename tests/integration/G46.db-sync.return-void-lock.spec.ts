import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, stores } from '../support/m7m8-fixtures';
import { anonClient } from '../support/m7m8-po-fixtures';
import { seedGa45Vendor } from '../support/m7m8-ga45-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, pastMonth, seedPayee, setupGaupUsers, softDeleteAttachment, todayIso, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// G46 水電話費請款 db-sync（資料庫層）：退回、作廢、標已付款時帳單的自動回復（只回復「因這張請款單自動標記」的帳單，手動標記的不動、會計不需水電管理）、
// 作廢釋放帳單、已付款鎖定、帳單端鎖定（D7）與補填繳費單位、最後一個附件鎖、帳單 JSON 欄位與遮蔽、併發、對帳匯出（含遮蔽）、
// 來源隔離（採購函式操作水電單與反向都回 SOURCE_MISMATCH）、採購與水電並存時採購端數字不受影響、事件完整。
// 權限語意照正式區 has_permission。測試資料：廠商與帳單供應商名稱帶 QA-GAUP- 標記、只用 VW／ZT 測試門市、帳單月份 2038（手動標記已繳的案例用過去月份）；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly', 'payview', 'ga45_clerk', 'ga45_accountant', 'payman_ubview', 'novendor', 'store_mgr', 'admin'];
let users: Record<string, GaupUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const fn = (who: GaupKey, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
function expectErr(r: any, status: number, code?: string, part?: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  if (code) expect(r.code, JSON.stringify(r)).toBe(code);
  if (part) expect(r.error as string).toContain(part);
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
const bill = (payee: any, m: string, over: Record<string, unknown> = {}) => mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: `${m}-01`, ...over });
const createUb = (payee: any, m: string, extra: Record<string, unknown> = {}, who: GaupKey = 'clerk') =>
  fn(who, 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: m, ...extra }, p_key: key() });
const act = (who: GaupKey, pr: any, action: string, payload: Record<string, unknown> = {}, k: string = key(), expected: string | null = pr.updated_at) =>
  fn(who, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: k, p_expected_updated_at: expected });
const getPr = async (who: GaupKey, id: string) => okData(await fn(who, 'ga_ws_pay_request_get', { p_id: id }));
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbLines = async (prId: string) => ((await db().from('ga_payment_request_bill_lines').select('*').eq('pr_id', prId).order('line_no')).data || []) as any[];
const events = async (id: string) => ((await db().from('ga_payment_request_events').select('*').eq('pr_id', id).order('created_at').order('id')).data || []) as any[];
const attach = (b: any) => addBillAttachment(users.clerk.client, b.id, users.clerk.id);
const month = (n: number) => `2038-${String(n).padStart(2, '0')}`;
const PM = pastMonth(2).slice(0, 7);
/** 建立一張已送出（勾自動標記）的請款單：n 張帳單，每張都有附件。 */
async function submitted(payee: any, m: string, amounts: number[], auto = true) {
  const bills = [] as any[];
  for (const a of amounts) {
    const b = await bill(payee, m, { amount: a });
    await attach(b);
    bills.push(b);
  }
  const pr = okData(await createUb(payee, m, { auto_mark_paid: auto }));
  const sub = okData(await act('clerk', pr, 'submit'));
  return { bills, pr: sub };
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
});
test.afterAll(async () => {
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GAUP-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

// ================================================================== 退回、重送、標已付款、作廢
test('主劇本：送出（自動標記）→會計退回（帳單回待繳）→總務修改重送→會計標已付款（帳單不變、已付款鎖定）→會計作廢（帳單回待繳、可再請款）；會計不需水電管理', async () => {
  const payee = await seedPayee('MAIN');
  const m = month(1);
  const { bills, pr } = await submitted(payee, m, [100, 200, 300]);
  for (const b of bills) expect((await dbBill(b.id)).paid_by_pr_id).toBe(pr.id);
  expect(pr.auto_marked_count).toBe(3);
  // 退回：原因必填；用沒有任何水電權限的第 4.5 批會計也能退回（同步情境放行）
  expectErr(await act('ga45_accountant', pr, 'return', {}), 400, 'REASON_REQUIRED');
  const ret = okData(await act('ga45_accountant', pr, 'return', { reason: '金額要再確認' }));
  expect(ret.status).toBe('DRAFT');
  for (const b of bills) {
    const row = await dbBill(b.id);
    expect(row.paid_at).toBeNull();
    expect(row.paid_by_pr_id).toBeNull();
  }
  let lines = await dbLines(pr.id);
  expect(lines.every((l) => l.auto_revert_reason === 'RETURN' && l.auto_reverted_at && l.active)).toBe(true);
  expect(ret.auto_reverted_count).toBe(3);
  expect(ret.auto_marked_count).toBe(0);
  // 退回後明細仍占用帳單（D10）：別張請款單不能放這些帳單
  expectErr(await createUb(payee, m, { bill_ids: [bills[0].id] }), 409, 'BILL_IN_OTHER_REQUEST', pr.pr_no);
  // 草稿內的帳單金額與單位不鎖：總務拿掉一張、重送
  const edited = okData(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { bill_ids: [bills[0].id, bills[1].id] }, p_expected_updated_at: ret.updated_at }));
  expect(Number(edited.amount_total)).toBe(300);
  const again = okData(await act('clerk', edited, 'submit'));
  expect(again.status).toBe('SUBMITTED');
  for (const b of bills.slice(0, 2)) expect((await dbBill(b.id)).paid_by_pr_id).toBe(pr.id);
  expect((await dbBill(bills[2].id)).paid_at, '被拿掉的帳單不動').toBeNull();
  lines = await dbLines(pr.id);
  expect(lines.every((l) => l.auto_reverted_at === null && l.auto_paid_date === todayIso())).toBe(true);
  // 標已付款：帳單不變
  const before = await Promise.all(bills.slice(0, 2).map((b) => dbBill(b.id)));
  const paid = okData(await act('accountant', again, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'GU-REF' }));
  expect(paid.status).toBe('PAID');
  const after = await Promise.all(bills.slice(0, 2).map((b) => dbBill(b.id)));
  expect(after.map((b) => [b.paid_at, b.paid_by_pr_id, b.updated_at])).toEqual(before.map((b) => [b.paid_at, b.paid_by_pr_id, b.updated_at]));
  // 已付款鎖定
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { notes: 'x' }, p_expected_updated_at: paid.updated_at }), 409, 'INVALID_STATE');
  expectErr(await fn('clerk', 'ga_ws_ub_save', { p_id: bills[0].id, p_payload: { amount: 999 }, p_expected_updated_at: after[0].updated_at, p_confirm_paid_change: true }), 409, 'BILL_IN_REQUEST', '已付款');
  expectErr(await act('accountant', paid, 'return', { reason: 'x' }), 409, 'INVALID_STATE');
  // 作廢：已付款作廢必填原因；帳單回待繳、明細釋放
  expectErr(await act('accountant', paid, 'void', {}), 400, 'REASON_REQUIRED');
  const voided = okData(await act('accountant', paid, 'void', { reason: '重複付款' }));
  expect(voided.status).toBe('VOID');
  for (const b of bills.slice(0, 2)) {
    const row = await dbBill(b.id);
    expect(row.paid_at).toBeNull();
    expect(row.paid_by_pr_id).toBeNull();
  }
  lines = await dbLines(pr.id);
  expect(lines.every((l) => l.active === false && l.auto_revert_reason === 'VOID')).toBe(true);
  // 釋放後可再請款（新請款單），而作廢的單據明細保留
  const next = okData(await createUb(payee, m));
  expect(next.bill_count).toBe(3);
  expect((await dbLines(pr.id)).length).toBe(2);
  // 事件完整
  expect((await events(pr.id)).map((e) => e.event_type)).toEqual(['create', 'submit', 'return', 'update', 'submit', 'mark_paid', 'void']);
  // 已作廢不能再改
  expectErr(await act('accountant', voided, 'note', { note: 'x' }), 409, 'INVALID_STATE');
});

test('手動與自動並存：作廢兩張請款單，自動標的回待繳、手動標的不動；退回後手動標已繳的帳單，之後作廢也不動', async () => {
  const payee = await seedPayee('MIX');
  const m = PM;
  // 請款單 A：勾自動；請款單 B：不勾，總務手動標記
  const a = await submitted(payee, m, [111]);
  const b = await submitted(payee, m, [222], false);
  expect((await dbBill(a.bills[0].id)).paid_by_pr_id).toBe(a.pr.id);
  const bBill = await dbBill(b.bills[0].id);
  expect(bBill.paid_at).toBeNull();
  okData(await fn('clerk', 'ga_ws_ub_pay', { p_id: bBill.id, p_paid_at: todayIso(), p_expected_updated_at: bBill.updated_at }));
  expect((await dbBill(bBill.id)).paid_by_pr_id, '手動標記沒有請款單記錄').toBeNull();
  okData(await act('accountant', a.pr, 'void', { reason: '作廢自動單' }));
  okData(await act('accountant', b.pr, 'void', { reason: '作廢手動單' }));
  expect((await dbBill(a.bills[0].id)).paid_at, '自動標記的回待繳').toBeNull();
  expect((await dbBill(bBill.id)).paid_at, '手動標記的不動').toBe(todayIso());
  const bLines = await dbLines(b.pr.id);
  expect(bLines[0].auto_reverted_at, '沒有自動標記就沒有回復留痕').toBeNull();
  expect(bLines[0].active).toBe(false);
  // 退回後手動標記：先自動標記→退回（回待繳）→總務手動標已繳→作廢：手動標的不動
  const c = await submitted(payee, m, [333]);
  const cr = okData(await act('accountant', c.pr, 'return', { reason: '先退回' }));
  const cBill = await dbBill(c.bills[0].id);
  expect(cBill.paid_at).toBeNull();
  okData(await fn('clerk', 'ga_ws_ub_pay', { p_id: cBill.id, p_paid_at: todayIso(), p_expected_updated_at: cBill.updated_at }));
  okData(await act('accountant', cr, 'void', { reason: '作廢' }));
  const cAfter = await dbBill(cBill.id);
  expect(cAfter.paid_at, '手動標記的不動').toBe(todayIso());
  expect(cAfter.paid_by_pr_id).toBeNull();
  // 草稿作廢（沒有自動標記過）：帳單不動、明細釋放
  const d = await bill(payee, m, { amount: 44 });
  const dPr = okData(await createUb(payee, m, { bill_ids: [d.id] }));
  okData(await act('clerk', dPr, 'void', { reason: '不要了' }));
  expect((await dbBill(d.id)).paid_at).toBeNull();
  expect((await dbLines(dPr.id))[0].active).toBe(false);
});

test('帳單端鎖定：已送出的請款單內，金額、單位、月份、刪除、勾自動標記時的繳費狀態鎖定；備註可改；草稿內不鎖；補填繳費單位只填空值', async () => {
  const payee = await seedPayee('LCK');
  const m = month(2);
  const { bills, pr } = await submitted(payee, m, [500]);
  const b = bills[0];
  const cur = async () => (await dbBill(b.id)).updated_at;
  const save = async (p: Record<string, unknown>) => fn('clerk', 'ga_ws_ub_save', { p_id: b.id, p_payload: p, p_expected_updated_at: await cur(), p_confirm_paid_change: true });
  expectErr(await save({ amount: 501 }), 409, 'BILL_IN_REQUEST', pr.pr_no);
  expectErr(await save({ expense_type: 'WATER' }), 409, 'BILL_IN_REQUEST');
  expectErr(await save({ payee_vendor_id: null }), 409, 'BILL_IN_REQUEST');
  expectErr(await fn('clerk', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '刪', p_confirm_paid_change: true, p_expected_updated_at: await cur() }), 409, 'BILL_IN_REQUEST');
  expectErr(await fn('clerk', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: await cur() }), 409, 'BILL_IN_REQUEST', '繳費狀態由請款單管理');
  okData(await save({ notes: '備註可以改', reference_no: 'REF-1' }));
  const j = okData(await fn('clerk', 'ga_ws_ub_get', { p_id: b.id }));
  expect(j.notes).toBe('備註可以改');
  expect(j.locked).toContain('paid_at');
  // 草稿內的帳單不鎖
  const d = await bill(payee, month(3), { amount: 70 });
  const dPr = okData(await createUb(payee, month(3), { bill_ids: [d.id] }));
  okData(await fn('clerk', 'ga_ws_ub_save', { p_id: d.id, p_payload: { amount: 71 }, p_expected_updated_at: (await dbBill(d.id)).updated_at, p_confirm_paid_change: false }));
  expect((await fn('clerk', 'ga_ws_ub_get', { p_id: d.id })).data.locked).toEqual([]);
  expect(dPr.status).toBe('DRAFT');
  // 補填繳費單位：只填空值、最多 200 筆、已刪除與已有單位的跳過
  const empty1 = await bill({ id: null }, month(4), { payee_vendor_id: null });
  const empty2 = await bill({ id: null }, month(4), { payee_vendor_id: null, expense_type: 'WATER' });
  const emptyDel = await bill({ id: null }, month(4), { payee_vendor_id: null, expense_type: 'PHONE' });
  okData(await fn('clerk', 'ga_ws_ub_delete', { p_id: emptyDel.id, p_reason: '刪', p_confirm_paid_change: false, p_expected_updated_at: (await dbBill(emptyDel.id)).updated_at }));
  const target = await seedPayee('FIL');
  const r = okData(await fn('clerk', 'ga_ws_ub_set_payee', { p_ids: [empty1.id, empty2.id, emptyDel.id, d.id, crypto.randomUUID()], p_vendor: target.id }));
  expect(r.updated).toBe(2);
  expect(new Set((r.skipped as any[]).map((x) => x.reason))).toEqual(new Set(['DELETED', 'HAS_PAYEE', 'NOT_FOUND']));
  expect((await dbBill(empty1.id)).payee_vendor_id).toBe(target.id);
  expect((await dbBill(d.id)).payee_vendor_id, '已有單位的不改').toBe(payee.id);
  expectErr(await fn('clerk', 'ga_ws_ub_set_payee', { p_ids: [], p_vendor: target.id }), 400, 'IDS_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_ub_set_payee', { p_ids: Array.from({ length: 201 }, () => crypto.randomUUID()), p_vendor: target.id }), 400, 'TOO_MANY');
  const plain = await seedPayee('PLN', { service_category_ids: [] });
  expectErr(await fn('clerk', 'ga_ws_ub_set_payee', { p_ids: [empty2.id], p_vendor: plain.id }), 409, 'PAYEE_NOT_UTILITY');
  for (const who of ['payview', 'accountant', 'ga45_clerk', 'store_mgr', 'admin'] as GaupKey[]) expectErr(await fn(who, 'ga_ws_ub_set_payee', { p_ids: [empty2.id], p_vendor: target.id }), 403, 'PERMISSION_DENIED');
  // 帳單儲存帶 payee_vendor_id：只能選公用事業且合作中的廠商
  const e3 = await bill({ id: null }, month(5), { payee_vendor_id: null });
  expectErr(await fn('clerk', 'ga_ws_ub_save', { p_id: e3.id, p_payload: { payee_vendor_id: plain.id }, p_expected_updated_at: e3.updated_at, p_confirm_paid_change: false }), 409, 'PAYEE_NOT_UTILITY');
  const saved = okData(await fn('clerk', 'ga_ws_ub_save', { p_id: e3.id, p_payload: { payee_vendor_id: target.id }, p_expected_updated_at: e3.updated_at, p_confirm_paid_change: false }));
  expect(saved.payee_vendor_id).toBe(target.id);
  expect(saved.payee_vendor_name).toBe(target.name);
  // 繳費單位下拉：水電檢視或管理者可讀，只有 id 與名稱
  const opts = okData(await fn('clerk', 'ga_ws_ub_payees', {}));
  expect(opts.find((x: any) => x.id === target.id)).toEqual({ id: target.id, name: target.name });
  expect(opts.find((x: any) => x.id === plain.id)).toBeUndefined();
  for (const who of ['payview', 'store_mgr', 'admin'] as GaupKey[]) expectErr(await fn(who, 'ga_ws_ub_payees', {}), 403, 'PERMISSION_DENIED');
  expect(okData(await fn('billonly', 'ga_ws_ub_payees', {})).length).toBeGreaterThan(0);
  // 帳單列表新篩選：請款狀態與繳費單位
  const inReq = okData(await fn('clerk', 'ga_ws_ub_list', { p_filters: { request: 'in_request', payee: payee.id }, p_page: 1, p_page_size: 50 }));
  expect(inReq.rows.map((x: any) => x.id).sort()).toEqual([b.id, d.id].sort());
  const none = okData(await fn('clerk', 'ga_ws_ub_list', { p_filters: { request: 'none', payee: payee.id }, p_page: 1, p_page_size: 50 }));
  expect(none.rows).toEqual([]);
  const noPayee = okData(await fn('clerk', 'ga_ws_ub_list', { p_filters: { payee: 'none', month: month(4) }, p_page: 1, p_page_size: 50 }));
  expect(noPayee.rows.every((x: any) => x.payee_vendor_id === null)).toBe(true);
  expectErr(await fn('clerk', 'ga_ws_ub_list', { p_filters: { request: 'x' }, p_page: 1, p_page_size: 5 }), 400, 'BAD_FILTER');
  expectErr(await fn('clerk', 'ga_ws_ub_list', { p_filters: { payee: 'x' }, p_page: 1, p_page_size: 5 }), 400, 'BAD_FILTER');
  // 帳單 JSON 遮蔽：只有水電管理（沒有請款檢視）看得到「已在請款單內」但看不到單號；有請款檢視者看得到單號
  const asBillonly = okData(await fn('billonly', 'ga_ws_ub_get', { p_id: b.id }));
  expect(asBillonly.payment_request).toEqual({ in_request: true });
  expect(asBillonly.paid_by_pr_no).toBeNull();
  expect(asBillonly.paid_by_pr_id).toBe(pr.id);
  const asAcc = okData(await fn('accountant', 'ga_ws_ub_get', { p_id: b.id }));
  expect(asAcc.payment_request.pr_no).toBe(pr.pr_no);
});

test('最後一個附件鎖：帳單在已送出或已付款請款單內，最後一個附件不能刪；有第二個附件或請款單退回後可以刪', async () => {
  const payee = await seedPayee('ATT');
  const m = month(6);
  const b = await bill(payee, m, { amount: 90 });
  const a1 = await attach(b);
  const pr = okData(await createUb(payee, m, { auto_mark_paid: false }));
  // 草稿內可以刪（送出時才檢查）
  const d0 = await softDeleteAttachment(users.clerk.client, a1);
  expect(d0.error, JSON.stringify(d0.error)).toBeNull();
  const a2 = await attach(b);
  const sub = okData(await act('clerk', pr, 'submit'));
  const blocked = await softDeleteAttachment(users.clerk.client, a2);
  expect(blocked.error?.message ?? '').toContain('BILL_LAST_ATTACHMENT_LOCKED');
  expect(blocked.error?.message ?? '').toContain(pr.pr_no);
  const a3 = await attach(b);
  const ok = await softDeleteAttachment(users.clerk.client, a2);
  expect(ok.error, JSON.stringify(ok.error)).toBeNull();
  expect((await softDeleteAttachment(users.clerk.client, a3)).error?.message ?? '').toContain('BILL_LAST_ATTACHMENT_LOCKED');
  // 退回後解除
  okData(await act('accountant', sub, 'return', { reason: '退回' }));
  expect((await softDeleteAttachment(users.clerk.client, a3)).error).toBeNull();
});

// ================================================================== 併發
test('併發：兩人同時用同一張帳單建立請款單只有一個成功；送出與手動標已繳併發結果一致；退回與作廢併發結果一致', async () => {
  const payee = await seedPayee('CON');
  const m = month(7);
  const b = await bill(payee, m, { amount: 10 });
  const [r1, r2] = await Promise.all([createUb(payee, m, { bill_ids: [b.id] }), createUb(payee, m, { bill_ids: [b.id] })]);
  const oks = [r1, r2].filter((r) => r.ok);
  expect(oks.length, JSON.stringify([r1, r2])).toBe(1);
  const bad = [r1, r2].find((r) => !r.ok);
  expect(['BILL_IN_OTHER_REQUEST', 'DUPLICATE']).toContain(bad.code);
  expect((await db().from('ga_payment_request_bill_lines').select('id', { count: 'exact', head: true }).eq('bill_id', b.id).eq('active', true)).count).toBe(1);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', payee.id)).count, '失敗的那張沒有留下').toBe(1);

  // 送出（自動標記）與手動標已繳併發（過去月份的帳單才能手動標）
  for (let round = 0; round < 3; round += 1) {
    const p2 = await seedPayee(`CON2${round}`);
    const pb = await bill(p2, PM, { amount: 20 + round });
    await attach(pb);
    const pr = okData(await createUb(p2, PM));
    const fresh = await dbBill(pb.id);
    const [sub, pay] = await Promise.all([
      act('clerk', pr, 'submit'),
      fn('clerk', 'ga_ws_ub_pay', { p_id: pb.id, p_paid_at: todayIso(), p_expected_updated_at: fresh.updated_at }),
    ]);
    const row = await dbBill(pb.id);
    const prRow = await dbPr(pr.id);
    expect(row.paid_at, JSON.stringify({ sub, pay })).toBe(todayIso());
    if (sub.ok) {
      expect(prRow.status).toBe('SUBMITTED');
      expect(row.paid_by_pr_id, '送出成功時由請款單標記（手動標記併發時不重複、不遺漏）').toBe(pr.id);
    } else {
      expect(['BILL_ALREADY_PAID', 'STALE']).toContain(sub.code);
      expect(prRow.status).toBe('DRAFT');
      expect(row.paid_by_pr_id).toBeNull();
    }
  }

  // 退回與作廢併發：結果要自洽（請款單狀態與帳單、明細對得上）
  const p3 = await seedPayee('CON3');
  const s = await submitted(p3, month(8), [30, 40]);
  const [rt, vd] = await Promise.all([act('accountant', s.pr, 'return', { reason: '併發退回' }), act('ga45_accountant', s.pr, 'void', { reason: '併發作廢' })]);
  expect([rt.ok, vd.ok].filter(Boolean).length, JSON.stringify([rt, vd])).toBeGreaterThanOrEqual(1);
  const fin = await dbPr(s.pr.id);
  const lns = await dbLines(s.pr.id);
  for (const bb of s.bills) {
    const row = await dbBill(bb.id);
    expect(row.paid_at, '退回或作廢後帳單都回待繳').toBeNull();
    expect(row.paid_by_pr_id).toBeNull();
  }
  expect(lns.every((l) => l.active === (fin.status !== 'VOID'))).toBe(true);
  expect(['DRAFT', 'VOID']).toContain(fin.status);
});

// ================================================================== 對帳匯出與遮蔽
test('對帳匯出：來源預設採購不含水電、來源水電每張帳單一列；沒有水電檢視者每張請款單一列；沒有廠商權限者省略統編與銀行', async () => {
  const payee = await seedPayee('EXP');
  const m = month(9);
  const { bills, pr } = await submitted(payee, m, [150, 250]);
  const ym = todayIso().slice(0, 7);
  const ub = okData(await fn('accountant', 'ga_ws_pay_export', { p_filters: { month: ym, vendor_id: payee.id, status: 'SUBMITTED', source: 'UTILITY' } }));
  expect(ub.source).toBe('UTILITY');
  expect(ub.total).toBe(2);
  expect(ub.rows.map((r: any) => r.amount_total).map(Number).sort()).toEqual([150, 250]);
  expect(ub.rows[0]).toMatchObject({ pr_no: pr.pr_no, status: 'SUBMITTED', bill_month: `${m}-01`, auto_mark_paid: true, bills_masked: false, vendor_tax_id: payee.tax_id, bank_account: '123-456-789012' });
  expect(ub.rows[0].location_name).toBeTruthy();
  expect(ub.include_vendor_secret).toBe(true);
  // 預設與 PURCHASE：不含水電
  for (const src of [undefined, 'PURCHASE']) {
    const p = okData(await fn('accountant', 'ga_ws_pay_export', { p_filters: { month: ym, vendor_id: payee.id, status: 'SUBMITTED', ...(src ? { source: src } : {}) } }));
    expect(p.total, `source=${src}`).toBe(0);
    expect(p.rows).toEqual([]);
  }
  // 沒有水電檢視：每張請款單一列、帳單欄位留空、金額是請款單總額
  const pv = okData(await fn('payview', 'ga_ws_pay_export', { p_filters: { month: ym, vendor_id: payee.id, status: 'SUBMITTED', source: 'UTILITY' } }));
  expect(pv.bills_masked).toBe(true);
  expect(pv.total).toBe(1);
  expect(pv.rows[0]).toMatchObject({ pr_no: pr.pr_no, bills_masked: true, vendor_tax_id: null, bank_account: null });
  expect(Number(pv.rows[0].amount_total)).toBe(400);
  expect(pv.rows[0].location_name).toBeUndefined();
  expect(pv.include_vendor_secret).toBe(false);
  // 沒有廠商權限（novendor：有請款與水電權限、沒有廠商檢視）
  const nv = okData(await fn('novendor', 'ga_ws_pay_export', { p_filters: { month: ym, vendor_id: payee.id, status: 'SUBMITTED', source: 'UTILITY' } }));
  expect(nv.rows[0].vendor_tax_id).toBeNull();
  expect(nv.rows[0].bank_account).toBeNull();
  expect(nv.rows[0].location_name).toBeTruthy();
  // 輸入驗證與權限
  expectErr(await fn('accountant', 'ga_ws_pay_export', { p_filters: { month: ym, source: 'FOO' } }), 400, 'BAD_FILTER');
  expectErr(await fn('accountant', 'ga_ws_pay_export', { p_filters: { source: 'UTILITY' } }), 400, 'BAD_FILTER');
  for (const who of ['billonly', 'store_mgr', 'admin'] as GaupKey[]) expectErr(await fn(who, 'ga_ws_pay_export', { p_filters: { month: ym, source: 'UTILITY' } }), 403, 'PERMISSION_DENIED');
  void bills;
});

// ================================================================== 來源隔離與採購並存
test('來源隔離與採購並存：採購函式操作水電單、水電函式操作採購單都回 SOURCE_MISMATCH；水電單存在時採購端的額度、分析、匯出不變', async () => {
  const vendor = await seedGa45Vendor(`GUMIX${Date.now() % 100000}`);
  const itemOf = (po: any) => po.items.find((i: any) => i.line_no === 1).id as string;
  const draft = okData(await fn('ga45_clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('GU-MIX'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GAUP 採購品', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: key() }));
  const po = okData(await fn('ga45_clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null }));
  const receipt = okData(await fn('ga45_clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemOf(po), delivered_qty: 10 }], p_key: key() }));
  const ym = todayIso().slice(0, 7);
  const purchasePr = okData(await fn('ga45_clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: receipt.id }] }, p_key: key() }));
  expect(purchasePr.source).toBe('PURCHASE');
  expect(purchasePr.bill_month).toBeNull();
  expect(purchasePr.auto_mark_paid).toBe(false);
  expect(purchasePr.lines.length).toBe(1);
  const submittedPurchase = okData(await act('ga45_clerk', purchasePr, 'submit'));

  const snap = async () => ({
    summary: okData(await fn('ga45_clerk', 'ga_ws_pay_po_summary', { p_po_id: po.id })),
    exp: okData(await fn('ga45_accountant', 'ga_ws_pay_export', { p_filters: { month: ym, vendor_id: vendor.id, status: 'SUBMITTED' } })),
    get: okData(await fn('ga45_accountant', 'ga_ws_pay_request_get', { p_id: purchasePr.id })),
    list: okData(await fn('ga45_accountant', 'ga_ws_pay_request_list', { p_filters: { vendor_id: vendor.id }, p_page: 1, p_page_size: 50 })),
    analysis: (okData(await fn('ga45_clerk', 'ga_ws_purchase_analysis', { p_year_month: ym, p_page: 1, p_page_size: 100 })).orders as any[]).filter((o) => o.vendor_label === vendor.name),
    detail: okData(await fn('ga45_clerk', 'ga_ws_po_get', { p_id: po.id })),
    candidates: okData(await fn('ga45_clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id }, p_page: 1, p_page_size: 50 })),
  });
  const before = JSON.stringify(await snap());
  // 水電請款單與採購請款單並存
  const payee = await seedPayee('MIXP');
  const mb = await bill(payee, month(10), { amount: 777 });
  await attach(mb);
  const upr = okData(await createUb(payee, month(10)));
  okData(await act('clerk', upr, 'submit'));
  expect(JSON.stringify(await snap()), '水電單存在時，採購端的額度、分析、匯出、列表、可請款進貨都不變').toBe(before);
  // 列表：兩種來源並存，來源篩選與總數
  const bothUtil = okData(await fn('accountant', 'ga_ws_pay_request_list', { p_filters: { source: 'UTILITY', status: 'SUBMITTED' }, p_page: 1, p_page_size: 100 }));
  expect(bothUtil.rows.every((r: any) => r.source === 'UTILITY')).toBe(true);
  expect(bothUtil.rows.some((r: any) => r.id === upr.id)).toBe(true);
  const purchaseOnly = okData(await fn('accountant', 'ga_ws_pay_request_list', { p_filters: { source: 'PURCHASE', vendor_id: vendor.id }, p_page: 1, p_page_size: 100 }));
  expect(purchaseOnly.rows.map((r: any) => r.id)).toEqual([purchasePr.id]);
  // 「待付款」整體口徑：水電單自然被計入（兩種來源都是已送出的請款單）
  const g = (await fn('accountant', 'ga_ws_pay_request_list', { p_filters: {}, p_page: 1, p_page_size: 1 })).global;
  expect(g.submitted_count).toBeGreaterThanOrEqual(2);
  // 來源隔離：用採購函式操作水電單
  const ulines = await db().from('ga_payment_request_lines').insert({ pr_id: upr.id, line_no: 1, po_id: po.id, receipt_id: receipt.id, claim_untaxed: 1, claim_tax: 0, claim_total: 1 });
  expect(ulines.error, '採購明細不能放進水電請款單（觸發器 SOURCE_MISMATCH）').not.toBeNull();
  expect(ulines.error?.message ?? '').toContain('SOURCE_MISMATCH');
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: upr.id, p_payload: { lines: [{ receipt_id: receipt.id }] }, p_expected_updated_at: upr.updated_at }), 409, 'SOURCE_MISMATCH');
  // 反向：用水電版本修改採購單
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: purchasePr.id, p_payload: { notes: 'x' }, p_expected_updated_at: submittedPurchase.updated_at }), 409, 'SOURCE_MISMATCH');
  expect((await dbPr(purchasePr.id)).notes ?? null).toBeNull();
  // 水電明細不能放進採購請款單
  const bad = await db().from('ga_payment_request_bill_lines').insert({ pr_id: purchasePr.id, line_no: 1, bill_id: mb.id, claim_total: 777, location_name: 'x', expense_type: 'ELECTRICITY', billing_month: `${month(10)}-01` });
  expect(bad.error?.message ?? '').toContain('SOURCE_MISMATCH');
  void st;
  void anonClient;
});
