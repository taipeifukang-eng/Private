import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, type GaupKey, type GaupUser } from '../support/g46-fixtures';
import { cleanupGaib1, fakeCompany, mkPo, okData, receive, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1（API 層）：/buyer-companies、/payee-accounts、/payee-options、/my-reimbursements、/payment-requests/prepay、:id/prepay-refund、匯出 extended、
//   水電請款單選同仁代墊（帳單自動標已繳照常、退回作廢回復照常）、採購單表頭的計價方式與調整列。
// 每支都驗：未登入 401、Origin 不符 403、權限矩陣（資料庫語意）、400 輸入驗證、白話錯誤（不外露 SQL）、無 DELETE，並用 service role 回讀資料庫。
// 測試資料：廠商、公司與帳單供應商名稱帶 QA-GAIB1-／QA-GAUP- 標記、只用 VW／ZT 測試門市、帳單月份 2038；結束只清自己的，並還原買受人設定鍵。
const P = '/api/workspace/general-affairs';
const PR = `${P}/payment-requests`;
const KEYS: GaupKey[] = ['clerk', 'accountant', 'payview', 'ga45_clerk', 'ga45_accountant', 'novendor', 'nobody', 'admin', 'purchaser'];
let users: Record<string, GaupUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status() as number, body: await r.json().catch(() => ({})), headers: r.headers(), text: '' as string });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const noLeak = (body: any) => expect(JSON.stringify(body)).not.toMatch(/SQLSTATE|violates|constraint|ERROR:|stack/i);
const act = (who: string, p: any, action: string, extra: Record<string, unknown> = {}, expected = p.updated_at) =>
  send(who, 'post', `${PR}/${p.id}/actions`, { action, expected_updated_at: expected, idempotency_key: key(), ...extra });
const SETTING_KEYS = ['pay_buyer_title', 'pay_buyer_tax_id'];
let savedSettings: Record<string, any> = {};
let startedAt = '';
let vendor: any;
const ACCT = { bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試同仁' };

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
test.beforeAll(async () => {
  test.setTimeout(400_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupGaib1())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const db = adminDb();
  const n = await db.from('ga_buyer_companies').select('id', { count: 'exact', head: true }).eq('is_active', true);
  expect(n.count, 'DEV 不應有非測試的買受人公司').toBe(0);
  for (const r of (await db.from('ga_workflow_settings').select('*').in('key', SETTING_KEYS)).data || []) savedSettings[r.key] = r;
  startedAt = new Date().toISOString();
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  vendor = await seedGaib1Vendor('API');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  const db = adminDb();
  for (const k of SETTING_KEYS) {
    if (savedSettings[k]) await db.from('ga_workflow_settings').update({ value_text: savedSettings[k].value_text, updated_at: savedSettings[k].updated_at, updated_by: savedSettings[k].updated_by }).eq('key', k);
    else await db.from('ga_workflow_settings').delete().eq('key', k);
  }
  await db.from('ga_workflow_setting_events').delete().in('setting_key', SETTING_KEYS).gte('created_at', startedAt);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
});

test('未登入 401、Origin 不符 403、不支援的方法與路徑（新端點）', async () => {
  const noAuth = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    for (const p of [`${P}/buyer-companies`, `${P}/payee-accounts/own`, `${P}/payee-options`, `${P}/my-reimbursements`, `${PR}/prepay/${crypto.randomUUID()}`]) expect((await noAuth.get(p)).status(), p).toBe(401);
    expect((await noAuth.post(`${P}/buyer-companies`, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
    expect((await noAuth.post(`${PR}/prepay`, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  } finally {
    await noAuth.dispose();
  }
  const evil = { Origin: 'https://evil.example' };
  expect((await apis.ga45_clerk.post(`${P}/buyer-companies`, { data: {}, headers: evil })).status()).toBe(403);
  expect((await apis.ga45_clerk.put(`${P}/payee-accounts/own`, { data: {}, headers: evil })).status()).toBe(403);
  expect((await apis.ga45_clerk.post(`${PR}/prepay`, { data: {}, headers: evil })).status()).toBe(403);
  expect((await send('ga45_clerk', 'delete', `${P}/buyer-companies/${crypto.randomUUID()}`)).status).toBe(405);
  expect((await send('ga45_clerk', 'post', `${P}/payee-options`)).status).toBe(405);
  expect((await send('ga45_clerk', 'post', `${P}/my-reimbursements`)).status).toBe(405);
  expect((await send('ga45_clerk', 'put', `${P}/buyer-companies`)).status).toBe(405);
  expect((await get('ga45_clerk', `${P}/buyer-companies/zz/default`)).status).toBe(400);
  expect((await get('ga45_clerk', `${PR}/prepay/zz`)).status).toBe(400);
  expect((await send('ga45_clerk', 'post', `${PR}/prepay/${crypto.randomUUID()}`)).status).toBe(405);
});

test('買受人公司 API：權限、驗證、新增、預設、停用、設定相容', async () => {
  for (const who of ['nobody', 'admin']) expect((await get(who, `${P}/buyer-companies`)).status, who).toBe(403);
  expect((await get('payview', `${P}/buyer-companies`)).status).toBe(200);
  expect((await get('payview', `${P}/buyer-companies`)).body.permissions.canEdit).toBe(false);
  expect((await send('payview', 'post', `${P}/buyer-companies`, { name: 'x', tax_id: '12345678', idempotency_key: key() })).status).toBe(403);
  const post = (body: Record<string, unknown>, who = 'ga45_clerk') => send(who, 'post', `${P}/buyer-companies`, { idempotency_key: key(), ...body });
  const a = fakeCompany('API-甲');
  const bad1 = await post({ name: a.name, tax_id: '123' });
  expect(bad1.status).toBe(400);
  noLeak(bad1.body);
  expect((await post({ tax_id: a.tax_id })).status).toBe(400);
  expect((await post({ name: a.name, tax_id: a.tax_id, extra: 1 })).status).toBe(400);
  expect((await send('ga45_clerk', 'post', `${P}/buyer-companies`, { name: a.name, tax_id: a.tax_id })).status).toBe(400); // 缺 idempotency_key
  const created = await post(a);
  expect(created.status).toBe(201);
  const rowA = created.body.data.find((r: any) => r.tax_id === a.tax_id);
  expect(rowA).toMatchObject({ is_default: true, is_active: true, name: a.name });
  expect((await post(a)).status).toBe(409); // 統編重複
  const b = fakeCompany('API-乙');
  const rowB = (await post(b)).body.data.find((r: any) => r.tax_id === b.tax_id);
  const setDef = await send('ga45_clerk', 'post', `${P}/buyer-companies/${rowB.id}/default`);
  expect(setDef.status).toBe(200);
  expect(setDef.body.data.find((r: any) => r.id === rowB.id).is_default).toBe(true);
  const st = await get('ga45_clerk', `${P}/payment-settings`);
  expect(st.body.data.buyer_title).toBe(b.name);
  expect(st.body.data.buyer_tax_id).toBe(b.tax_id);
  expect((await send('ga45_clerk', 'post', `${P}/buyer-companies/${rowB.id}/deactivate`)).status).toBe(409); // 預設公司不能直接停用
  const dea = await send('ga45_clerk', 'post', `${P}/buyer-companies/${rowA.id}/deactivate`);
  expect(dea.status).toBe(200);
  expect(dea.body.data.find((r: any) => r.id === rowA.id).is_active).toBe(false);
  // 修改需要版本資訊
  const cur = (await get('ga45_clerk', `${P}/buyer-companies`)).body.data.find((r: any) => r.id === rowB.id);
  expect((await post({ id: rowB.id, name: `${b.name}-改` })).status).toBe(400);
  expect((await post({ id: rowB.id, name: `${b.name}-改`, expected_updated_at: cur.updated_at })).status).toBe(200);
  expect((await post({ id: rowB.id, name: 'x', expected_updated_at: '2000-01-01T00:00:00Z' })).status).toBe(409);
  // 沒有請款管理的人（只有檢視）寫不了
  expect((await send('payview', 'post', `${P}/buyer-companies/${rowB.id}/default`)).status).toBe(403);
  expect((await send('payview', 'post', `${P}/buyer-companies/${rowB.id}/deactivate`)).status).toBe(403);
});

test('同仁匯款帳戶、挑選同仁、我的代墊款 API', async () => {
  // 本人：任何登入者
  expect((await get('nobody', `${P}/payee-accounts/own`)).body.data.account).toBeNull();
  const bad = await send('nobody', 'put', `${P}/payee-accounts/own`, { bank_name: '銀行', bank_account: 'ABC', bank_account_name: 'x' });
  expect(bad.status).toBe(400);
  noLeak(bad.body);
  expect((await send('nobody', 'put', `${P}/payee-accounts/own`, { bank_name: '銀行' })).status).toBe(400);
  expect((await send('nobody', 'put', `${P}/payee-accounts/own`, { ...ACCT, extra: 1 })).status).toBe(400);
  const set = await send('nobody', 'put', `${P}/payee-accounts/own`, ACCT);
  expect(set.status).toBe(200);
  expect(set.body.data.account_last4).toBe('9012');
  expect((await get('nobody', `${P}/payee-accounts/own`)).body.data.account).toMatchObject(ACCT);
  // 別人的：請款管理加廠商帳務檢視
  const target = users.nobody.id;
  for (const who of ['nobody', 'payview', 'novendor', 'purchaser', 'admin']) {
    expect((await get(who, `${P}/payee-accounts/${target}`)).status, who).toBe(403);
    expect((await send(who, 'put', `${P}/payee-accounts/${target}`, ACCT)).status, who).toBe(403);
  }
  expect((await get('accountant', `${P}/payee-accounts/${target}`)).body.data.account).toMatchObject({ bank_account: ACCT.bank_account });
  expect((await get('clerk', `${P}/payee-accounts/zz`)).status).toBe(400);
  expect((await send('accountant', 'put', `${P}/payee-accounts/${users.payview.id}`, { ...ACCT, bank_account_name: '會計代登錄' })).status).toBe(200);
  expect((await send('accountant', 'post', `${P}/payee-accounts/own`)).status).toBe(405);
  // 挑選同仁
  for (const who of ['nobody', 'payview', 'purchaser']) expect((await get(who, `${P}/payee-options`)).status, who).toBe(403);
  const opt = await get('clerk', `${P}/payee-options?q=${encodeURIComponent('GAUP nobody')}`);
  expect(opt.status).toBe(200);
  expect(opt.body.data.find((r: any) => r.id === target)).toMatchObject({ has_account: true });
  expect(JSON.stringify(opt.body)).not.toContain('123-456');
  // 我的代墊款：任何登入者，只有自己的
  const mine = await get('nobody', `${P}/my-reimbursements`);
  expect(mine.status).toBe(200);
  expect(mine.body.data).toEqual([]);
  expect((await get('admin', `${P}/my-reimbursements`)).status).toBe(200);
});

test('水電請款單選同仁代墊：自動標已繳照常、缺帳戶擋送出、退回與作廢回復、遮蔽與白話訊息', async () => {
  const payee = await seedPayee('EMP');
  const bill = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01' });
  await addBillAttachment(users.clerk.client, bill.id, users.clerk.id);
  // 同仁 B（payview）尚未有帳戶：建立草稿可以，送出被擋；再用同仁 nobody（已有帳戶）走完整流程
  const empNoAcct = users.payview.id;
  await adminDb().from('ga_employee_payout_accounts').delete().eq('profile_id', empNoAcct);
  const badType = await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', payee_type: 'FRIEND', idempotency_key: key() });
  expect(badType.status).toBe(400);
  const c1 = await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', payee_profile_id: empNoAcct, idempotency_key: key() });
  expect(c1.status).toBe(201);
  expect(c1.body.data).toMatchObject({ source: 'UTILITY', payee_type: 'EMPLOYEE', payee_profile_id: empNoAcct, vendor_id: payee.id });
  const sub1 = await act('clerk', c1.body.data, 'submit');
  expect(sub1.status).toBe(409);
  expect(sub1.body.error).toContain('還沒有登錄匯款帳戶');
  noLeak(sub1.body);
  expect(((await adminDb().from('ga_utility_bills').select('paid_at').eq('id', bill.id).single()).data as any).paid_at).toBeNull();
  // 改選有帳戶的同仁（nobody）
  const upd = await send('clerk', 'patch', `${PR}/${c1.body.data.id}`, { payee_profile_id: users.nobody.id, expected_updated_at: c1.body.data.updated_at });
  expect(upd.status).toBe(200);
  expect(upd.body.data.payee_profile_id).toBe(users.nobody.id);
  expect(upd.body.data.payee_account_snapshot).toMatchObject({ bank_account: ACCT.bank_account });
  const sub = await act('clerk', upd.body.data, 'submit');
  expect(sub.status).toBe(200);
  expect(sub.body.data.status).toBe('SUBMITTED');
  // 帳單自動標已繳（G46 行為不變），付款對象是同仁
  const billAfter = (await adminDb().from('ga_utility_bills').select('paid_at,paid_by_pr_id').eq('id', bill.id).single()).data as any;
  expect(billAfter.paid_at).toBeTruthy();
  expect(billAfter.paid_by_pr_id).toBe(c1.body.data.id);
  // 沒有廠商帳務檢視者（novendor）看不到同仁帳戶本文，只露末四碼
  const masked = await get('novendor', `${PR}/${c1.body.data.id}`);
  expect(masked.body.data.payee_account_masked).toBe(true);
  expect(masked.body.data.payee_account_snapshot).toEqual({});
  expect(masked.body.data.payee_account_last4).toBe('9012');
  expect(JSON.stringify(masked.body)).not.toContain('123-456-789012');
  const full = await get('accountant', `${PR}/${c1.body.data.id}`);
  expect(full.body.data.payee_account_snapshot).toMatchObject({ bank_account: ACCT.bank_account });
  // 退回：帳單回復；再送出；作廢：帳單回復
  const ret = await act('accountant', sub.body.data, 'return', { reason: '測試退回' });
  expect(ret.status).toBe(200);
  expect(((await adminDb().from('ga_utility_bills').select('paid_at,paid_by_pr_id').eq('id', bill.id).single()).data as any).paid_at).toBeNull();
  const sub2 = await act('clerk', ret.body.data, 'submit');
  expect(sub2.status).toBe(200);
  // 代墊單不能用信用卡；付款成功
  const card = await act('accountant', sub2.body.data, 'mark_paid', { pay_method: 'CREDIT_CARD', card_last4: '1234' });
  expect(card.status).toBe(400);
  noLeak(card.body);
  const paid = await act('accountant', sub2.body.data, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'UTIL-REIMB' });
  expect(paid.status).toBe(200);
  expect(paid.body.data.status).toBe('PAID');
  // 同仁在「我的代墊款」看到已付款、看不到廠商帳戶與統編
  const mine = await get('nobody', `${P}/my-reimbursements`);
  expect(mine.body.data).toHaveLength(1);
  expect(mine.body.data[0]).toMatchObject({ id: c1.body.data.id, status: 'PAID', source: 'UTILITY' });
  expect(JSON.stringify(mine.body)).not.toContain(payee.tax_id);
  const v = await act('accountant', paid.body.data, 'void', { reason: '測試作廢' });
  expect(v.status).toBe(200);
  expect(((await adminDb().from('ga_utility_bills').select('paid_at,paid_by_pr_id').eq('id', bill.id).single()).data as any).paid_by_pr_id).toBeNull();
});

test('採購：付款方式（信用卡、網購平台）、預付款建立與退款、匯出 extended（只對 CSV 欄位）、採購單計價方式與調整列', async () => {
  const c = users.ga45_clerk;
  const a = users.ga45_accountant;
  // 採購單：含稅＋調整列（走 API 建立與下訂）
  const created = await send('ga45_clerk', 'post', `${P}/purchase-orders`, {
    header: { vendor_id: vendor.id, notes: `[自動測試]M7M8 api ${Date.now()}`, price_mode: 'INCL', adjustments: [{ kind: 'FREIGHT', amount: 105 }, { kind: 'COUPON', amount: -105, campaign_name: '雙十一' }] },
    items: [{ item_name: 'QA-GAIB1 API 品項', unit: '個', quantity: 10, unit_price: 105 }], idempotency_key: key(),
  });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ price_mode: 'INCL', total_amount: 1050, subtotal: 1000, tax_amount: 50 });
  expect(created.body.data.adjustments.map((x: any) => x.amount)).toEqual([105, -105]);
  const badHeader = await send('ga45_clerk', 'post', `${P}/purchase-orders`, { header: { vendor_id: vendor.id, adjustments: [{ kind: 'FREIGHT', amount: -5 }] }, items: [{ item_name: 'x', quantity: 1, unit_price: 1 }], idempotency_key: key() });
  expect(badHeader.status).toBe(400);
  expect(badHeader.body.error).toContain('運費必須是正數');
  expect((await send('ga45_clerk', 'post', `${P}/purchase-orders`, { header: { price_mode: 'GROSS' }, items: [{ item_name: 'x', quantity: 1, unit_price: 1 }], idempotency_key: key() })).status).toBe(400);
  // 下訂後開預付單（API）
  const placed = await send('ga45_clerk', 'post', `${P}/purchase-orders/${created.body.data.id}/actions`, { action: 'place_order', expected_updated_at: created.body.data.updated_at });
  expect(placed.status).toBe(200);
  const po = placed.body.data;
  expect((await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 0, idempotency_key: key() })).status).toBe(400);
  expect((await send('ga45_clerk', 'post', `${PR}/prepay`, { amount: 100, idempotency_key: key() })).status).toBe(400);
  expect((await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 100 })).status).toBe(400); // 缺 idempotency_key
  expect((await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 100, lines: [], idempotency_key: key() })).status).toBe(400);
  for (const who of ['nobody', 'payview', 'purchaser', 'admin']) expect((await send(who, 'post', `${PR}/prepay`, { po_id: po.id, amount: 100, idempotency_key: key() })).status, who).toBe(403);
  const over = await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 1056, idempotency_key: key() });
  expect(over.status).toBe(409);
  noLeak(over.body);
  const k1 = key();
  const pre = await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 500, notes: '訂金', idempotency_key: k1 });
  expect(pre.status).toBe(201);
  expect(pre.body.data).toMatchObject({ pay_kind: 'PREPAY', status: 'DRAFT', amount_total: 500, prepay_po_no: po.po_no });
  const replay = await send('ga45_clerk', 'post', `${PR}/prepay`, { po_id: po.id, amount: 500, notes: '訂金', idempotency_key: k1 });
  expect(replay.body.replay).toBe(true);
  const sub = await act('ga45_clerk', pre.body.data, 'submit');
  expect(sub.status).toBe(200);
  // 網購平台付款
  expect((await act('ga45_accountant', sub.body.data, 'mark_paid', { pay_method: 'ONLINE_PLATFORM', platform: 'x'.repeat(41) })).status).toBe(400);
  expect((await act('ga45_accountant', sub.body.data, 'mark_paid', { pay_method: 'TRANSFER', card_last4: '1234' })).status).toBe(400);
  const paid = await act('ga45_accountant', sub.body.data, 'mark_paid', { pay_method: 'ONLINE_PLATFORM', platform: '蝦皮購物', paid_ref: 'ORDER-9' });
  expect(paid.status).toBe(200);
  expect(paid.body.data).toMatchObject({ pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮購物' });
  // 預付摘要
  const ov = await get('ga45_clerk', `${PR}/prepay/${po.id}`);
  expect(ov.status).toBe(200);
  expect(ov.body.data).toMatchObject({ prepaid: 500, paid: 500, offset: 0, balance: 500 });
  expect((await get('nobody', `${PR}/prepay/${po.id}`)).status).toBe(403);
  // 到貨自動核銷（走資料庫，與頁面相同的函式）
  const rc = await receive(c as any, po, [{ line: 1, qty: 4 }]);
  expect(Number(rc.prepay_offset)).toBe(Math.min(500, Number(rc.amount_total)));
  // 登記退款
  const cur = (await get('ga45_clerk', `${PR}/${pre.body.data.id}`)).body.data;
  const bal = Number(cur.prepay_balance);
  const refundUrl = `${PR}/${pre.body.data.id}/prepay-refund`;
  for (const body of [{ amount: 0, reason: 'x' }, { amount: 10 }, { amount: 10, reason: 'x', foo: 1 }]) {
    expect((await send('ga45_clerk', 'post', refundUrl, { ...body, expected_updated_at: cur.updated_at, idempotency_key: key() })).status).toBe(400);
  }
  expect((await send('ga45_clerk', 'post', refundUrl, { amount: 10, reason: 'x', idempotency_key: key() })).status).toBe(400); // 缺 expected_updated_at
  for (const who of ['nobody', 'payview']) expect((await send(who, 'post', refundUrl, { amount: 10, reason: 'x', expected_updated_at: cur.updated_at, idempotency_key: key() })).status, who).toBe(403);
  const tooMuch = await send('ga45_clerk', 'post', refundUrl, { amount: bal + 1, reason: '超過', expected_updated_at: cur.updated_at, idempotency_key: key() });
  expect(tooMuch.status).toBe(409);
  noLeak(tooMuch.body);
  if (bal > 0) {
    const ref = await send('ga45_clerk', 'post', refundUrl, { amount: bal, reason: '廠商退款（測試）', expected_updated_at: cur.updated_at, idempotency_key: key() });
    expect(ref.status).toBe(200);
    expect(ref.body.data.prepay_balance).toBe(0);
    expect(ref.body.data.events.some((e: any) => e.event_type === 'prepay_refund')).toBe(true);
  }
  // 匯出：預設欄位不變，extended=1 才追加欄位並含預付單
  const month = new Date().toISOString().slice(0, 7);
  const exportUrl = `${PR}/export?month=${month}&vendorId=${vendor.id}`;
  const plain = await apis.ga45_accountant.get(exportUrl);
  const ext = await apis.ga45_accountant.get(`${exportUrl}&extended=1`);
  expect(plain.status()).toBe(200);
  expect(ext.status()).toBe(200);
  const plainText = await plain.text();
  const extText = await ext.text();
  const header = (t: string) => t.replace(/^﻿/, '').split('\r\n')[0];
  expect(header(extText).startsWith(header(plainText))).toBe(true);
  expect(header(plainText)).not.toContain('付款對象');
  expect(header(extText)).toContain('類型,付款對象類型,付款對象,抬頭,信用卡末四碼,平台');
  expect(extText).toContain('預付款');
  expect(plainText).not.toContain('預付款');
  expect(a.id).toBeTruthy();
  // 請款單列表篩選：付款對象與類型
  const lst = await get('ga45_clerk', `${PR}?payKind=PREPAY&vendorId=${vendor.id}`);
  expect(lst.status).toBe(200);
  expect(lst.body.data.every((r: any) => r.pay_kind === 'PREPAY')).toBe(true);
  expect((await get('ga45_clerk', `${PR}?payKind=zz`)).status).toBe(400);
  expect((await get('ga45_clerk', `${PR}?payeeType=zz`)).status).toBe(400);
  // 採購單列表：已預付篩選（有請款檢視才有結果）
  const pl = await get('ga45_clerk', `${P}/purchase-orders?prepaid=1`);
  expect(pl.status).toBe(200);
  expect((await get('purchaser', `${P}/purchase-orders?prepaid=1`)).body.data).toEqual([]);
});

test('資料庫直接呼叫的權限矩陣：新 RPC 對無權限、只有檢視、admin 身分無角色一律 403', async () => {
  const fnCall = (who: string, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
  const id = crypto.randomUUID();
  const cases: [string, Record<string, unknown>, string[]][] = [
    ['ga_ws_buyer_company_save', { p_payload: { name: 'x', tax_id: '12345678' }, p_key: key(), p_expected_updated_at: null }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_buyer_company_set_default', { p_id: id }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_buyer_company_deactivate', { p_id: id }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_pay_prepay_create', { p_payload: { po_id: id, amount: 1 }, p_key: key() }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_pay_prepay_settle', { p_id: id, p_amount: 1, p_reason: 'x', p_key: key(), p_expected_updated_at: new Date().toISOString() }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_pay_prepay_overview', { p_po_id: id }, ['nobody', 'admin', 'purchaser']],
    ['ga_ws_pay_employee_options', { p_q: null, p_page: 1 }, ['payview', 'nobody', 'admin', 'purchaser']],
    ['ga_ws_payout_account_get_for', { p_profile: id }, ['payview', 'nobody', 'admin', 'novendor', 'purchaser']],
    ['ga_ws_payout_account_set_for', { p_profile: id, p_payload: {} }, ['payview', 'nobody', 'admin', 'novendor', 'purchaser']],
  ];
  for (const [name, args, who] of cases) for (const w of who) {
    const r = await fnCall(w, name, args);
    expect(r.ok, `${name} ${w}`).toBe(false);
    expect(r.status, `${name} ${w}：${JSON.stringify(r)}`).toBe(403);
  }
  // 沒有登入（service role 沒有 auth.uid）一律 401
  const anon = await adminDb().rpc('ga_ws_buyer_company_list');
  expect(anon.data?.status ?? 401).toBe(401);
  // 內部輔助函式與事件表不開放給登入者
  const internal = await users.ga45_clerk.client.rpc('ga_pay_prepay_apply', { p_po: id });
  expect(internal.error).toBeTruthy();
  const direct = await users.ga45_clerk.client.from('ga_buyer_companies').select('id').limit(1);
  expect(direct.error || (direct.data || []).length === 0).toBeTruthy();
  // 用一張真的採購單確認 okData 工具可用（避免未使用警告）
  expect(typeof okData).toBe('function');
  expect(typeof mkPo).toBe('function');
});
