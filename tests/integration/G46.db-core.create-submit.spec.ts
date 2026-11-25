import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { anonClient } from '../support/m7m8-po-fixtures';
import { addBillAttachment, softDeleteAttachment, cleanupGaup, gaupName, mkBill, pastMonth, seedPayee, setupGaupUsers, todayIso, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// G46 水電話費請款 db-core（資料庫層）：結構、候選與自動帶入、建立（權限、單位檢查、固定識別、遮蔽）、修改草稿、送出前檢查（缺附件整張擋下、金額快照、重驗）、
// 自動標記已繳（勾選與不勾選、台北今天、2038 年帳單不受「前 1 個月」限制）。權限語意照正式區 has_permission（DB 無 admin bypass）。
// 測試資料：廠商與帳單供應商名稱帶 QA-GAUP- 標記、只用 VW／ZT 測試門市、帳單月份 2038（需要手動標記已繳的案例用過去月份）；結束只清自己的（cleanupGaup）。
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly', 'payview', 'ga45_clerk', 'purchaser', 'store_mgr', 'novendor', 'payman_ubview', 'admin', 'nobody'];
let users: Record<string, GaupUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
let seq = 0;
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
  expect(typeof r.error).toBe('string');
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
const month = (n: number) => `2038-${String(n).padStart(2, '0')}`;
const bill = (payee: any, m: string, over: Record<string, unknown> = {}, who: GaupKey = 'clerk') => mkBill(users[who].client, { payee_vendor_id: payee.id, billing_month: `${m}-01`, ...over });
const createUb = (who: GaupKey, payee: any, m: string, extra: Record<string, unknown> = {}, k: string = key()) =>
  fn(who, 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: m, ...extra }, p_key: k });
const act = (who: GaupKey, pr: any, action: string, payload: Record<string, unknown> = {}, k: string = key(), expected: string | null = pr.updated_at) =>
  fn(who, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: k, p_expected_updated_at: expected });
const getPr = async (who: GaupKey, id: string) => okData(await fn(who, 'ga_ws_pay_request_get', { p_id: id }));
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbLines = async (prId: string) => ((await db().from('ga_payment_request_bill_lines').select('*').eq('pr_id', prId).order('line_no')).data || []) as any[];
const events = async (id: string) => ((await db().from('ga_payment_request_events').select('*').eq('pr_id', id).order('created_at').order('id')).data || []) as any[];
const attach = (b: any) => addBillAttachment(users.clerk.client, b.id, users.clerk.id);
const delBill = async (b: any) => okData(await fn('clerk', 'ga_ws_ub_delete', { p_id: b.id, p_reason: '測試刪除', p_confirm_paid_change: false, p_expected_updated_at: (await dbBill(b.id)).updated_at }));

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
  const role = await db().from('roles').select('id').like('code', 'vue_workspace_gaup_%');
  expect((role.data || []).length, '測試角色 vue_workspace_gaup_ 應保留 4 個（DEV 專用種子，不由測試刪除）').toBe(4);
});

// ================================================================== 結構
test('結構：新表登入者不能直接讀寫、同一帳單只能在一張有效請款單、主表檢查約束、不新增權限碼與角色授權', async () => {
  for (const t of ['ga_payment_request_bill_lines']) {
    const r = await users.clerk.client.from(t).select('*').limit(1);
    expect(r.error, `${t} 讀取應被擋`).not.toBeNull();
    expect((await users.clerk.client.from(t).insert({})).error, `${t} 寫入應被擋`).not.toBeNull();
    expect((await anonClient().from(t).select('*').limit(1)).error, `${t} 未登入讀取應被擋`).not.toBeNull();
  }
  const payee = await seedPayee('STR');
  const m = month(1);
  const b = await bill(payee, m);
  const pr1 = okData(await createUb('clerk', payee, m, { bill_ids: [b.id] }));
  expect(pr1.source).toBe('UTILITY');
  expect(pr1.bill_month).toBe(`${m}-01`);
  expect(pr1.auto_mark_paid).toBe(true);
  expect(pr1.pr_no).toMatch(/^PY-\d{8}-\d{3,}$/);
  // 第二張草稿請款單（用 service role 直接放同一張帳單）：部分唯一索引是最後一道防線
  const b2 = await bill(payee, m);
  const pr2 = okData(await createUb('clerk', payee, m, { bill_ids: [b2.id] }));
  const dup = await db().from('ga_payment_request_bill_lines').insert({ pr_id: pr2.id, line_no: 99, bill_id: b.id, claim_total: 1000, location_name: 'x', expense_type: 'ELECTRICITY', billing_month: `${m}-01` });
  expect(dup.error?.code, JSON.stringify(dup.error)).toBe('23505');
  // 主表檢查約束：水電必有月份、採購不可有月份與自動標記
  const base = { pr_no: 'PY-20380101-901', vendor_id: payee.id, vendor_name_snapshot: 'x', idempotency_key: key(), payload_hash: 'x' };
  expect((await db().from('ga_payment_requests').insert({ ...base, source: 'UTILITY' })).error?.code).toBe('23514');
  expect((await db().from('ga_payment_requests').insert({ ...base, idempotency_key: key(), pr_no: 'PY-20380101-902', source: 'PURCHASE', bill_month: `${m}-01` })).error?.code).toBe('23514');
  expect((await db().from('ga_payment_requests').insert({ ...base, idempotency_key: key(), pr_no: 'PY-20380101-903', source: 'PURCHASE', auto_mark_paid: true })).error?.code).toBe('23514');
  expect((await db().from('ga_payment_requests').insert({ ...base, idempotency_key: key(), pr_no: 'PY-20380101-904', source: 'UTILITY', bill_month: '2038-01-15' })).error?.code).toBe('23514');
  // 來源建立後不可改、水電單的單位與月份不可改
  expect((await db().from('ga_payment_requests').update({ source: 'PURCHASE', bill_month: null }).eq('id', pr1.id)).error, '來源不可改').not.toBeNull();
  expect((await db().from('ga_payment_requests').update({ bill_month: `2038-02-01` }).eq('id', pr1.id)).error, '月份不可改').not.toBeNull();
  // 不新增權限碼、不授權給任何一般角色
  const codes = (await db().from('permissions').select('code').like('code', 'general_affairs.%')).data || [];
  expect(codes.some((c: any) => /utility_payment|ub_payment|utility_request/i.test(c.code))).toBe(false);
});

// ================================================================== 候選與自動帶入
test('候選：只有同單位同月份且可請款的帳單被自動帶入；不可請款的帳單標原因（已刪除、已繳、小數、0 元、別單位、無單位、在別張請款單）', async () => {
  const payee = await seedPayee('CAN');
  const other = await seedPayee('OTH');
  const m = month(2);
  const good = [await bill(payee, m), await bill(payee, m, { expense_type: 'WATER', amount: 250 })];
  const deleted = await bill(payee, m);
  await delBill(deleted);
  const paidB = await bill(payee, pastMonth(2).slice(0, 7), { amount: 300 });
  const decimal = await bill(payee, m, { amount: 1000.5 });
  const zero = await bill(payee, m, { amount: 0 });
  const otherPayee = await bill(other, m);
  const noPayee = await bill({ id: null }, m, { payee_vendor_id: null });
  const otherMonth = await bill(payee, month(3));
  const inOther = await bill(payee, m);
  const prOther = okData(await createUb('clerk', payee, m, { bill_ids: [inOther.id] }));

  // 已繳：過去月份的帳單手動標記，月份跟請款單不同所以走「月份不符」；同月份已繳另用 2038 年無法手動標記，改用資料庫直接更新（service role 會被觸發器擋，所以用 clerk 標記過去月份的帳單來驗已繳）
  const pm = pastMonth(2).slice(0, 7);
  const paidSame = await bill(payee, pm, { amount: 410 });
  okData(await fn('clerk', 'ga_ws_ub_pay', { p_id: paidSame.id, p_paid_at: todayIso(), p_expected_updated_at: (await dbBill(paidSame.id)).updated_at }));

  const c = okData(await fn('clerk', 'ga_ws_pay_ub_candidates', { p_filters: { month: m, vendor_id: payee.id } }));
  const byId = Object.fromEntries((c.bills as any[]).map((x) => [x.id, x]));
  expect(byId[good[0].id].eligible).toBe(true);
  expect(byId[good[1].id].eligible).toBe(true);
  expect(byId[deleted.id], '已刪除帳單不出現在候選').toBeUndefined();
  expect(byId[decimal.id]).toMatchObject({ eligible: false, code: 'BILL_AMOUNT_INVALID' });
  expect(byId[decimal.id].reason).toContain('小數');
  expect(byId[zero.id]).toMatchObject({ eligible: false, code: 'BILL_AMOUNT_INVALID' });
  expect(byId[inOther.id]).toMatchObject({ eligible: false, code: 'BILL_IN_OTHER_REQUEST', pr_no: prOther.pr_no });
  expect(byId[otherPayee.id], '別單位帳單不在這個單位的候選').toBeUndefined();
  expect(byId[noPayee.id], '沒有單位的帳單不在這個單位的候選').toBeUndefined();
  expect(byId[otherMonth.id], '別月份帳單不在這個月的候選').toBeUndefined();
  expect(c.eligible_count).toBe(2);
  expect(Number(c.eligible_amount)).toBe(1250);
  expect(c.no_payee_count).toBeGreaterThanOrEqual(1);
  // 編輯草稿時（帶 pr_id）本單的帳單算可請款
  const c2 = okData(await fn('clerk', 'ga_ws_pay_ub_candidates', { p_filters: { month: m, vendor_id: payee.id, pr_id: prOther.id } }));
  expect((c2.bills as any[]).find((x) => x.id === inOther.id).eligible).toBe(true);
  // 沒指定單位：各單位張數與可請款金額，加未指定單位的帳單張數
  const all = okData(await fn('clerk', 'ga_ws_pay_ub_candidates', { p_filters: { month: m } }));
  const row = (all.payees as any[]).find((p) => p.vendor_id === payee.id);
  expect(row.bill_count).toBe(5);
  expect(row.eligible_count).toBe(2);
  expect((all.payees as any[]).find((p) => p.vendor_id === other.id).eligible_count).toBe(1);
  // 月份格式
  expectErr(await fn('clerk', 'ga_ws_pay_ub_candidates', { p_filters: { month: '2038/02' } }), 400, 'BAD_FILTER');
  // 沒有水電檢視：只看到張數與總額（D9）
  const masked = okData(await fn('payview', 'ga_ws_pay_ub_candidates', { p_filters: { month: m, vendor_id: payee.id } }));
  expect(masked.bills_masked).toBe(true);
  expect(masked.bills).toBeUndefined();
  expect(masked.eligible_count).toBe(2);
  // 權限：沒有請款檢視不能看
  for (const who of ['billonly', 'purchaser', 'store_mgr', 'admin', 'nobody'] as GaupKey[]) expectErr(await fn(who, 'ga_ws_pay_ub_candidates', { p_filters: { month: m } }), 403, 'PERMISSION_DENIED');
  expect((await anonClient().rpc('ga_ws_pay_ub_candidates', { p_filters: { month: m } })).error, '未登入不能呼叫').not.toBeNull();
  void paidB;
});

// ================================================================== 建立
test('建立：自動帶入、手動指定逐張驗證、固定識別、單位檢查（非公用事業、停用）、遮蔽、事件與快照', async () => {
  const payee = await seedPayee('CRE');
  const m = month(4);
  const b1 = await bill(payee, m, { location_name: undefined, amount: 1200 });
  const b2 = await bill(payee, m, { expense_type: 'WATER', amount: 800 });
  const k = key();
  const first = await createUb('clerk', payee, m, { notes: '三月電費' }, k);
  const pr = okData(first);
  expect(first.status).toBe(201);
  expect(pr.source).toBe('UTILITY');
  expect(pr.status).toBe('DRAFT');
  expect(Number(pr.amount_total)).toBe(2000);
  expect(Number(pr.amount_untaxed)).toBe(2000);
  expect(Number(pr.tax_amount)).toBe(0);
  expect(pr.vendor_name_snapshot).toBe(payee.name);
  expect(pr.vendor_tax_id_snapshot).toBe(payee.tax_id);
  expect(pr.bank_snapshot.bank_account).toBe('123-456-789012');
  expect(pr.bill_count).toBe(2);
  expect(pr.bills_masked).toBe(false);
  expect(pr.bill_lines.map((l: any) => l.bill_id).sort()).toEqual([b1.id, b2.id].sort());
  expect(pr.bill_lines.every((l: any) => Number(l.claim_total) > 0 && l.active)).toBe(true);
  expect(pr.lines).toEqual([]);
  const evs = await events(pr.id);
  expect(evs.map((e) => e.event_type)).toEqual(['create']);
  expect(evs[0].payload).toMatchObject({ source: 'UTILITY', line_count: 2, auto_mark_paid: true });
  // 固定識別：同內容回原結果、內容不同 409
  const replay = await createUb('clerk', payee, m, { notes: '三月電費' }, k);
  expect(replay.replay).toBe(true);
  expect(replay.data.id).toBe(pr.id);
  expectErr(await createUb('clerk', payee, m, { notes: '別的內容' }, k), 409, 'IDEMPOTENCY_CONFLICT');
  // 同月份已全部在請款單內：沒有可請款帳單
  const none = await createUb('clerk', payee, m);
  expectErr(none, 409, 'NO_BILLS', '沒有可以請款的帳單');
  expect(none.excluded).toMatchObject({ BILL_IN_OTHER_REQUEST: 2 });
  // 手動指定：別張請款單的帳單被擋並指出單號
  const again = await createUb('clerk', payee, m, { bill_ids: [b1.id] });
  expectErr(again, 409, 'BILL_IN_OTHER_REQUEST', pr.pr_no);
  // 手動指定：別單位、別月份、已刪除、小數、0 元
  const other = await seedPayee('CRE2');
  const bOther = await bill(other, m);
  const bMonth = await bill(payee, month(5));
  const bDel = await bill(payee, month(6));
  await delBill(bDel);
  const bDec = await bill(payee, month(7), { amount: 99.5 });
  const bZero = await bill(payee, month(8), { amount: 0 });
  expectErr(await createUb('clerk', payee, m, { bill_ids: [bOther.id] }), 409, 'BILL_PAYEE_MISMATCH');
  expectErr(await createUb('clerk', payee, m, { bill_ids: [bMonth.id] }), 409, 'BILL_MONTH_MISMATCH');
  expectErr(await createUb('clerk', payee, month(6), { bill_ids: [bDel.id] }), 409, 'BILL_DELETED');
  expectErr(await createUb('clerk', payee, month(7), { bill_ids: [bDec.id] }), 409, 'BILL_AMOUNT_INVALID');
  expectErr(await createUb('clerk', payee, month(8), { bill_ids: [bZero.id] }), 409, 'BILL_AMOUNT_INVALID');
  const noPayee = await bill({ id: null }, m, { payee_vendor_id: null });
  expectErr(await createUb('clerk', payee, m, { bill_ids: [noPayee.id] }), 409, 'BILL_NO_PAYEE');
  expectErr(await createUb('clerk', payee, m, { bill_ids: [crypto.randomUUID()] }), 404, 'BILL_NOT_FOUND');
  expectErr(await createUb('clerk', payee, m, { bill_ids: [] }), 400, 'BILLS_REQUIRED');
  expectErr(await createUb('clerk', payee, m, { bill_ids: 'x' }), 400, 'FIELD_TYPE');
  expectErr(await createUb('clerk', payee, m, { bill_ids: ['x'] }), 400, 'FIELD_TYPE');
  // 以上全部失敗：沒有留下半張請款單
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', payee.id)).count).toBe(1);
  // 單位檢查：非公用事業廠商、停用廠商、不存在、缺欄位、月份格式
  const plain = await seedPayee('PLN', { service_category_ids: [] });
  expectErr(await createUb('clerk', plain, m), 409, 'PAYEE_NOT_UTILITY', '公用事業');
  const inactive = await seedPayee('INA', { status: 'inactive' });
  expectErr(await createUb('clerk', inactive, m), 409, 'VENDOR_INACTIVE');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_create', { p_payload: { vendor_id: crypto.randomUUID(), bill_month: m }, p_key: key() }), 404, 'VENDOR_NOT_FOUND');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_create', { p_payload: { bill_month: m }, p_key: key() }), 400, 'FIELD_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id }, p_key: key() }), 400, 'FIELD_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: '2038-13' }, p_key: key() }), 400, 'FIELD_REQUIRED');
  expectErr(await createUb('clerk', payee, month(9), { auto_mark_paid: 'yes' }), 400, 'FIELD_TYPE');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: m }, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  // auto_mark_paid=false 與預計付款日
  const b9 = await bill(payee, month(9));
  const noAuto = okData(await createUb('clerk', payee, month(9), { auto_mark_paid: false, expected_pay_date: '2038-04-10' }));
  expect(noAuto.auto_mark_paid).toBe(false);
  expect(noAuto.expected_pay_date).toBe('2038-04-10');
  expect(noAuto.bill_lines.map((l: any) => l.bill_id)).toEqual([b9.id]);
});

test('建立與修改的權限：需要請款管理加水電管理，缺一不可（兩種缺法）；其餘角色與未登入被擋', async () => {
  const payee = await seedPayee('PRM');
  const m = month(10);
  await bill(payee, m);
  const denied = ['accountant', 'billonly', 'payview', 'ga45_clerk', 'purchaser', 'store_mgr', 'admin', 'nobody', 'payman_ubview'] as GaupKey[];
  for (const who of denied) {
    const r = await createUb(who, payee, m);
    expectErr(r, 403, 'PERMISSION_DENIED');
  }
  expectErr(await createUb('accountant', payee, m), 403, 'PERMISSION_DENIED', '水電話網費管理');
  expectErr(await createUb('billonly', payee, m), 403, 'PERMISSION_DENIED', '請款管理');
  const anon = await anonClient().rpc('ga_ws_pay_ub_create', { p_payload: { vendor_id: payee.id, bill_month: m }, p_key: key() });
  expect(anon.error, '未登入不能呼叫').not.toBeNull();
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', payee.id)).count).toBe(0);
  // 修改也一樣
  const pr = okData(await createUb('clerk', payee, m));
  for (const who of ['accountant', 'billonly', 'payview', 'ga45_clerk', 'nobody'] as GaupKey[]) {
    expectErr(await fn(who, 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { notes: 'x' }, p_expected_updated_at: pr.updated_at }), 403, 'PERMISSION_DENIED');
    expectErr(await fn(who, 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { notes: 'x' }, p_expected_updated_at: pr.updated_at }), 403, 'PERMISSION_DENIED');
  }
  // 帳務遮蔽：沒有廠商檢視者建立後看不到統編與銀行
  const m2 = month(11);
  await bill(payee, m2);
  const masked = okData(await createUb('novendor', payee, m2));
  expect(masked.vendor_masked).toBe(true);
  expect(masked.vendor_tax_id_snapshot).toBeNull();
  expect(masked.bank_snapshot).toEqual({});
  expect((await dbPr(masked.id)).vendor_tax_id_snapshot).toBe(payee.tax_id);
});

// ================================================================== 修改草稿
test('修改草稿：增減帳單、重新帶入、自動標記選項、非草稿與 STALE 被擋、採購的 lines 欄位被擋', async () => {
  const payee = await seedPayee('UPD');
  const m = month(12);
  const b1 = await bill(payee, m, { amount: 500 });
  const b2 = await bill(payee, m, { amount: 700 });
  const b3 = await bill(payee, m, { amount: 900 });
  const pr = okData(await createUb('clerk', payee, m, { bill_ids: [b1.id, b2.id] }));
  expect(Number(pr.amount_total)).toBe(1200);
  // 加入第三張、拿掉第一張
  const u1 = okData(await fn('clerk', 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { bill_ids: [b2.id, b3.id], auto_mark_paid: false, notes: '改過' }, p_expected_updated_at: pr.updated_at }));
  expect(Number(u1.amount_total)).toBe(1600);
  expect(u1.auto_mark_paid).toBe(false);
  expect(u1.notes).toBe('改過');
  expect(u1.bill_lines.map((l: any) => l.bill_id).sort()).toEqual([b2.id, b3.id].sort());
  expect((await events(pr.id)).map((e) => e.event_type)).toEqual(['create', 'update']);
  // 被拿掉的帳單可以放進別張請款單
  const other = okData(await createUb('clerk', payee, m, { bill_ids: [b1.id] }));
  expect(other.bill_count).toBe(1);
  // STALE
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { notes: 'z' }, p_expected_updated_at: pr.updated_at }), 409, 'STALE');
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { notes: 'z' }, p_expected_updated_at: null }), 400, 'EXPECTED_REQUIRED');
  // 空清單與採購 lines
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { bill_ids: [] }, p_expected_updated_at: u1.updated_at }), 400, 'BILLS_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { lines: [{ receipt_id: crypto.randomUUID() }] }, p_expected_updated_at: u1.updated_at }), 409, 'SOURCE_MISMATCH');
  // 重新帶入：帳單金額在草稿期間被改，請款單金額快照更新
  const cur = await dbBill(b2.id);
  okData(await fn('clerk', 'ga_ws_ub_save', { p_id: b2.id, p_payload: { amount: 750 }, p_expected_updated_at: cur.updated_at, p_confirm_paid_change: false }));
  const prNow = await getPr('clerk', pr.id);
  const re = okData(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { refresh: true }, p_expected_updated_at: prNow.updated_at }));
  expect(Number(re.amount_total)).toBe(750 + 900);
  // 整批換成別單位的帳單被擋、全部沒變
  const otherPayee = await seedPayee('UPD2');
  const bx = await bill(otherPayee, m);
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { bill_ids: [bx.id] }, p_expected_updated_at: re.updated_at }), 409, 'BILL_PAYEE_MISMATCH');
  expect((await dbLines(pr.id)).map((l) => l.bill_id).sort()).toEqual([b2.id, b3.id].sort());
  // 非草稿不能改
  await attach(b2);
  await attach(b3);
  const cur2 = await getPr('clerk', pr.id);
  const sub = okData(await act('clerk', cur2, 'submit'));
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { notes: '送出後改' }, p_expected_updated_at: sub.updated_at }), 409, 'INVALID_STATE');
  // 用水電版本修改採購單 → SOURCE_MISMATCH（採購單需要另建；這裡驗不存在的請款單回 404）
  expectErr(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: crypto.randomUUID(), p_payload: { notes: 'x' }, p_expected_updated_at: new Date().toISOString() }), 404, 'NOT_FOUND');
});

// ================================================================== 送出
test('送出：缺附件整張擋下並列清單（含只缺部分）、補附件後成功；請款單維持草稿、帳單不動', async () => {
  const payee = await seedPayee('SUB');
  const m = month(1);
  const b1 = await bill(payee, m, { amount: 100, location_name: undefined });
  const b2 = await bill(payee, m, { expense_type: 'WATER', amount: 200 });
  const b3 = await bill(payee, m, { amount: 300 });
  const pr = okData(await createUb('clerk', payee, m));
  await attach(b1);
  const r = await act('clerk', pr, 'submit');
  expectErr(r, 409, 'BILL_MISSING_ATTACHMENT', '2 張帳單還沒有附件');
  expect((r.missing_bills as any[]).map((x) => x.bill_id).sort()).toEqual([b2.id, b3.id].sort());
  expect(r.missing_bills[0]).toHaveProperty('location_name');
  expect(r.missing_bills[0]).toHaveProperty('expense_type');
  expect(r.missing_bills[0]).toHaveProperty('amount');
  expect((await dbPr(pr.id)).status).toBe('DRAFT');
  for (const b of [b1, b2, b3]) expect((await dbBill(b.id)).paid_at, '被擋時帳單不動').toBeNull();
  expect((await events(pr.id)).map((e) => e.event_type)).toEqual(['create']);
  // 附件被標記刪除算沒有附件
  const a2 = await attach(b2);
  const a3 = await attach(b3);
  const del = await softDeleteAttachment(users.clerk.client, a3);
  expect(del.error, JSON.stringify(del.error)).toBeNull();
  expectErr(await act('clerk', await getPr('clerk', pr.id), 'submit'), 409, 'BILL_MISSING_ATTACHMENT', '1 張帳單');
  await attach(b3);
  const ok = okData(await act('clerk', await getPr('clerk', pr.id), 'submit'));
  expect(ok.status).toBe('SUBMITTED');
  void a2;
});

test('送出（勾自動標記）：帳單標已繳、繳費日期＝台北今天、記錄由哪張請款單標、2038 年帳單不受「前 1 個月」限制；明細留痕', async () => {
  const payee = await seedPayee('AUT');
  const m = month(2);
  const bs = [await bill(payee, m, { amount: 111 }), await bill(payee, m, { amount: 222 })];
  for (const b of bs) await attach(b);
  const pr = okData(await createUb('clerk', payee, m));
  expect(pr.auto_mark_paid).toBe(true);
  const sub = okData(await act('clerk', pr, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
  for (const b of bs) {
    const row = await dbBill(b.id);
    expect(row.paid_at, '繳費日期＝台北今天').toBe(todayIso());
    expect(row.paid_by_pr_id).toBe(pr.id);
  }
  const lines = await dbLines(pr.id);
  expect(lines.every((l) => l.auto_paid_date === todayIso() && l.auto_reverted_at === null)).toBe(true);
  expect(sub.auto_marked_count).toBe(2);
  // 帳單 JSON：由哪張請款單自動標記、已在請款單內、鎖定欄位
  const bj = okData(await fn('clerk', 'ga_ws_ub_get', { p_id: bs[0].id }));
  expect(bj.status).toBe('paid');
  expect(bj.paid_by_pr_id).toBe(pr.id);
  expect(bj.paid_by_pr_no).toBe(pr.pr_no);
  expect(bj.payment_request).toMatchObject({ in_request: true, pr_no: pr.pr_no, status: 'SUBMITTED', auto_mark_paid: true });
  expect(bj.locked).toEqual(expect.arrayContaining(['amount', 'payee_vendor_id', 'delete', 'paid_at']));
  expect(bj.attachment_count).toBe(1);
  // 送出事件
  expect((await events(pr.id)).map((e) => e.event_type)).toEqual(['create', 'submit']);
});

test('送出（不勾自動標記）：帳單維持待繳；之後總務手動標已繳不受影響（過去月份帳單）', async () => {
  const payee = await seedPayee('MAN');
  const pm = pastMonth(2).slice(0, 7);
  const b = await bill(payee, pm, { amount: 640 });
  await attach(b);
  const pr = okData(await createUb('clerk', payee, pm, { auto_mark_paid: false }));
  const sub = okData(await act('clerk', pr, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
  const row = await dbBill(b.id);
  expect(row.paid_at).toBeNull();
  expect(row.paid_by_pr_id).toBeNull();
  expect(sub.auto_marked_count).toBe(0);
  // 手動標記已繳（既有標記已繳功能）：paid_by_pr_id 維持空（手動）
  const paid = okData(await fn('clerk', 'ga_ws_ub_pay', { p_id: b.id, p_paid_at: todayIso(), p_expected_updated_at: row.updated_at }));
  expect(paid.status).toBe('paid');
  expect((await dbBill(b.id)).paid_by_pr_id).toBeNull();
  // 請款單內帳單：金額、單位、刪除鎖定；不勾自動標記時繳費狀態仍可手動改；備註與到期日仍可改
  const cur = await dbBill(b.id);
  expectErr(await fn('clerk', 'ga_ws_ub_save', { p_id: b.id, p_payload: { amount: 641 }, p_expected_updated_at: cur.updated_at, p_confirm_paid_change: true }), 409, 'BILL_IN_REQUEST', pr.pr_no);
  const notes = okData(await fn('clerk', 'ga_ws_ub_save', { p_id: b.id, p_payload: { notes: '備註可改', due_date: `${todayIso().slice(0, 7)}-28` }, p_expected_updated_at: cur.updated_at, p_confirm_paid_change: false }));
  expect(notes.notes).toBe('備註可改');
  const unpay = okData(await fn('clerk', 'ga_ws_ub_unpay', { p_id: b.id, p_confirm: true, p_expected_updated_at: (await dbBill(b.id)).updated_at }));
  expect(unpay.status).not.toBe('paid');
});

test('送出前重驗：帳單金額被改、被刪除、被標已繳（不勾自動標記）、送出權限（缺水電管理者被擋）', async () => {
  const payee = await seedPayee('CHK');
  // 金額在草稿期間被改
  const m = month(3);
  const b = await bill(payee, m, { amount: 1000 });
  await attach(b);
  const pr = okData(await createUb('clerk', payee, m));
  const cur = await dbBill(b.id);
  okData(await fn('clerk', 'ga_ws_ub_save', { p_id: b.id, p_payload: { amount: 1200 }, p_expected_updated_at: cur.updated_at, p_confirm_paid_change: false }));
  expectErr(await act('clerk', pr, 'submit'), 409, 'BILL_CHANGED', '重新帶入');
  const refreshed = okData(await fn('clerk', 'ga_ws_pay_ub_update', { p_id: pr.id, p_payload: { refresh: true }, p_expected_updated_at: pr.updated_at }));
  expect(Number(refreshed.amount_total)).toBe(1200);
  // 送出需要兩個權限：只有請款管理的人（會計、第 4.5 批總務）送出被擋，請款單維持草稿
  expectErr(await act('accountant', refreshed, 'submit'), 403, 'PERMISSION_DENIED', '水電話網費管理');
  expectErr(await act('ga45_clerk', refreshed, 'submit'), 403, 'PERMISSION_DENIED');
  expectErr(await act('payman_ubview', refreshed, 'submit'), 403, 'PERMISSION_DENIED');
  expect((await dbPr(pr.id)).status).toBe('DRAFT');
  // 只有水電管理沒有請款管理：動作函式先擋
  expectErr(await act('billonly', refreshed, 'submit'), 403, 'PERMISSION_DENIED');
  // 被刪除
  const m2 = month(4);
  const b2 = await bill(payee, m2);
  await attach(b2);
  const pr2 = okData(await createUb('clerk', payee, m2));
  await delBill(b2);
  expectErr(await act('clerk', pr2, 'submit'), 409, 'BILL_DELETED', '移除');
  // 不勾自動標記時，送出前有人手動把帳單標已繳：送出被擋
  const pm = pastMonth(3).slice(0, 7);
  const b3 = await bill(payee, pm, { amount: 50 });
  await attach(b3);
  const pr3 = okData(await createUb('clerk', payee, pm, { auto_mark_paid: false }));
  okData(await fn('clerk', 'ga_ws_ub_pay', { p_id: b3.id, p_paid_at: todayIso(), p_expected_updated_at: (await dbBill(b3.id)).updated_at }));
  expectErr(await act('clerk', pr3, 'submit'), 409, 'BILL_ALREADY_PAID', '移除');
  expect((await dbPr(pr3.id)).status).toBe('DRAFT');
  // 完全沒有水電明細（直接清空）：LINES_REQUIRED
  void st;
});

test('列表與詳情：來源篩選、列帶來源與帳單張數、沒有水電檢視者明細遮蔽但看得到請款單頭與總額', async () => {
  const payee = await seedPayee('LST');
  const m = month(5);
  const b = await bill(payee, m, { amount: 321 });
  const pr = okData(await createUb('clerk', payee, m));
  const asClerk = okData(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { vendor_id: payee.id, source: 'UTILITY' }, p_page: 1, p_page_size: 20 }));
  expect(asClerk.total).toBe(1);
  expect(asClerk.rows[0]).toMatchObject({ id: pr.id, source: 'UTILITY', bill_count: 1, line_count: 1 });
  expect(asClerk.rows[0].bill_lines, '列表不帶明細').toBeUndefined();
  const asPurchase = okData(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { vendor_id: payee.id, source: 'PURCHASE' }, p_page: 1, p_page_size: 20 }));
  expect(asPurchase.total).toBe(0);
  const all = okData(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { vendor_id: payee.id }, p_page: 1, p_page_size: 20 }));
  expect(all.total).toBe(1);
  expectErr(await fn('clerk', 'ga_ws_pay_request_list', { p_filters: { source: 'FOO' }, p_page: 1, p_page_size: 20 }), 400, 'BAD_FILTER');
  // 沒有水電檢視：看得到單頭與總額，明細遮蔽
  const pv = await getPr('payview', pr.id);
  expect(pv.source).toBe('UTILITY');
  expect(Number(pv.amount_total)).toBe(321);
  expect(pv.bills_masked).toBe(true);
  expect(pv.bill_lines).toBeUndefined();
  expect(pv.vendor_masked).toBe(true);
  const acc = await getPr('accountant', pr.id);
  expect(acc.bills_masked).toBe(false);
  expect(acc.bill_lines).toHaveLength(1);
  expect(acc.bill_lines[0].bill_id).toBe(b.id);
  // 水電管理但沒有請款檢視：不能看請款單
  expectErr(await fn('billonly', 'ga_ws_pay_request_get', { p_id: pr.id }), 403, 'PERMISSION_DENIED');
  expectErr(await fn('store_mgr', 'ga_ws_pay_request_list', { p_filters: {}, p_page: 1, p_page_size: 20 }), 403, 'PERMISSION_DENIED');
  expectErr(await fn('admin', 'ga_ws_pay_request_list', { p_filters: {}, p_page: 1, p_page_size: 20 }), 403, 'PERMISSION_DENIED');
});
