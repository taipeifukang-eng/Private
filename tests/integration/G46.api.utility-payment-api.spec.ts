import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, pastMonth, seedPayee, setupGaupUsers, todayIso, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// G46 水電話費請款（API 層）：/payment-requests（來源篩選、source=UTILITY 建立、修改、動作、utility-candidates、匯出 CSV）、/utility-bills（繳費單位下拉、批次補填、新篩選、鎖定）、附件最後一個鎖。
// 每支都驗：未登入 401、Origin 不符 403、權限矩陣（資料庫語意；profiles.role=admin 無角色被擋）、400 輸入驗證、409（缺附件、重複請款、鎖定、STALE）、
// 錯誤訊息白話（不外露 SQL 或代碼）、CSV 內容（BOM、中文欄位、文字格式、公式注入、遮蔽），並用 service role 回讀資料庫。
// 測試資料：廠商與帳單供應商名稱帶 QA-GAUP- 標記、只用 VW／ZT 測試門市、帳單月份 2038（手動標記的案例用過去月份）；結束只清自己的。
const P = '/api/workspace/general-affairs';
const PR = `${P}/payment-requests`;
const UB = `${P}/utility-bills`;
const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly', 'payview', 'ga45_clerk', 'novendor', 'store_mgr', 'admin', 'nobody', 'purchaser'];
let users: Record<string, GaupUser> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status() as number, body: await r.json().catch(() => ({})), headers: r.headers(), text: '' as string });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const month = (n: number) => `2038-${String(n).padStart(2, '0')}`;
const bill = (payee: any, m: string, over: Record<string, unknown> = {}) => mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: `${m}-01`, ...over });
const attach = (b: any) => addBillAttachment(users.clerk.client, b.id, users.clerk.id);
const createUb = (who: string, payee: any, m: string, extra: Record<string, unknown> = {}) =>
  send(who, 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: m, idempotency_key: key(), ...extra });
const act = (who: string, p: any, action: string, extra: Record<string, unknown> = {}, expected = p.updated_at) =>
  send(who, 'post', `${PR}/${p.id}/actions`, { action, expected_updated_at: expected, idempotency_key: key(), ...extra });
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const noLeak = (body: any) => expect(JSON.stringify(body)).not.toMatch(/SQLSTATE|violates|constraint|ERROR:|stack/i);

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
});

test('未登入 401、Origin 不符 403、不支援的方法與路徑', async () => {
  const noAuth = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    for (const p of [`${PR}/utility-candidates?month=2038-03`, `${UB}/payees`]) expect((await noAuth.get(p)).status(), p).toBe(401);
    expect((await noAuth.post(`${UB}/set-payee`, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
    expect((await noAuth.post(PR, { data: { source: 'UTILITY' }, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  } finally {
    await noAuth.dispose();
  }
  const evil = { Origin: 'https://evil.example' };
  expect((await apis.clerk.post(`${UB}/set-payee`, { data: {}, headers: evil })).status()).toBe(403);
  expect((await apis.clerk.post(PR, { data: { source: 'UTILITY', vendor_id: crypto.randomUUID(), bill_month: '2038-03', idempotency_key: key() }, headers: evil })).status()).toBe(403);
  expect((await send('clerk', 'post', `${PR}/utility-candidates`)).status).toBe(405);
  expect((await send('clerk', 'post', `${UB}/payees`)).status).toBe(405);
  expect((await send('clerk', 'put', `${UB}/set-payee`)).status).toBe(405);
  expect((await get('clerk', `${PR}/utility-candidates`)).status).toBe(400);
  expect((await get('clerk', `${PR}/utility-candidates?month=2038-03&vendor_id=zz`)).status).toBe(400);
});

test('權限矩陣：候選與請款單讀取需請款檢視；繳費單位下拉需水電檢視；補填需水電管理；店長、管理員身分無角色、採購角色全部 403', async () => {
  for (const who of ['clerk', 'accountant', 'payview', 'novendor']) expect((await get(who, `${PR}/utility-candidates?month=2038-03`)).status, `${who} 候選`).toBe(200);
  for (const who of ['billonly', 'store_mgr', 'admin', 'nobody', 'purchaser']) {
    const r = await get(who, `${PR}/utility-candidates?month=2038-03`);
    expect(r.status, `${who} 候選`).toBe(403);
    noLeak(r.body);
  }
  for (const who of ['clerk', 'accountant', 'billonly', 'novendor']) expect((await get(who, `${UB}/payees`)).status, `${who} payees`).toBe(200);
  for (const who of ['payview', 'store_mgr', 'admin', 'nobody', 'ga45_clerk']) expect((await get(who, `${UB}/payees`)).status, `${who} payees`).toBe(403);
  const payee = await seedPayee('API1');
  const b = await bill(payee, month(1), { payee_vendor_id: null });
  for (const who of ['accountant', 'payview', 'store_mgr', 'admin', 'nobody']) {
    const r = await send(who, 'post', `${UB}/set-payee`, { ids: [b.id], vendor_id: payee.id });
    expect(r.status, `${who} 補填`).toBe(403);
  }
  expect((await dbBill(b.id)).payee_vendor_id).toBeNull();
  // 管理員身分：請款入口與請款寫入都不放行
  expect((await get('admin', PR)).status).toBe(403);
  expect((await createUb('admin', payee, month(1))).status).toBe(403);
});

test('payees 下拉只回 id 與名稱（不含統編與銀行）；公用事業以外或停用的廠商不出現', async () => {
  const payee = await seedPayee('API2');
  const plain = await seedPayee('API3', { service_category_ids: [] });
  const inactive = await seedPayee('API4', { status: 'inactive' });
  const r = await get('clerk', `${UB}/payees`);
  expect(r.status).toBe(200);
  const mine = (r.body.data as any[]).find((x) => x.id === payee.id);
  expect(mine).toEqual({ id: payee.id, name: payee.name });
  expect((r.body.data as any[]).some((x) => x.id === plain.id || x.id === inactive.id)).toBe(false);
  expect(JSON.stringify(r.body)).not.toContain(payee.tax_id);
  expect(JSON.stringify(r.body)).not.toContain('123-456-789012');
});

test('建立水電話費請款單（API）：驗證、權限、固定識別、候選與來源篩選、遮蔽', async () => {
  const payee = await seedPayee('API5');
  const m = month(2);
  const b1 = await bill(payee, m, { amount: 700 });
  const b2 = await bill(payee, m, { amount: 300, expense_type: 'WATER' });
  // 400
  expect((await send('clerk', 'post', PR, { source: 'UTILITY', bill_month: m, idempotency_key: key() })).status).toBe(400);
  expect((await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, idempotency_key: key() })).status).toBe(400);
  expect((await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: m })).status, '缺固定識別').toBe(400);
  expect((await createUb('clerk', payee, m, { bill_ids: [] })).status).toBe(400);
  expect((await createUb('clerk', payee, m, { bill_ids: ['x'] })).status).toBe(400);
  expect((await createUb('clerk', payee, m, { auto_mark_paid: 'yes' })).status).toBe(400);
  expect((await createUb('clerk', payee, m, { lines: [] })).status).toBe(400);
  expect((await send('clerk', 'post', PR, { source: 'FOO', vendor_id: payee.id, bill_month: m, idempotency_key: key() })).status).toBe(400);
  // 權限：缺水電管理、缺請款管理
  const d1 = await createUb('accountant', payee, m);
  expect(d1.status).toBe(403);
  expect(d1.body.error).toContain('水電話網費管理');
  expect((await createUb('billonly', payee, m)).status).toBe(403);
  expect((await createUb('ga45_clerk', payee, m)).status).toBe(403);
  expect((await createUb('payview', payee, m)).status).toBe(403);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', payee.id)).count).toBe(0);
  // 成功（自動帶入）與固定識別重送
  const k = key();
  const first = await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: m, notes: '二月電水費', idempotency_key: k });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const pr = first.body.data;
  expect(pr).toMatchObject({ source: 'UTILITY', status: 'DRAFT', auto_mark_paid: true, bill_count: 2 });
  expect(Number(pr.amount_total)).toBe(1000);
  expect(pr.bill_lines).toHaveLength(2);
  const replay = await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: m, notes: '二月電水費', idempotency_key: k });
  expect(replay.status).toBe(200);
  expect(replay.body.replay).toBe(true);
  expect((await send('clerk', 'post', PR, { source: 'UTILITY', vendor_id: payee.id, bill_month: m, notes: '別的內容', idempotency_key: k })).status).toBe(409);
  // 沒有可請款帳單：白話訊息與原因統計
  const none = await createUb('clerk', payee, m);
  expect(none.status).toBe(409);
  expect(none.body.code).toBe('NO_BILLS');
  expect(none.body.error).toContain('沒有可以請款的帳單');
  expect(none.body.excluded).toMatchObject({ BILL_IN_OTHER_REQUEST: 2 });
  noLeak(none.body);
  // 候選：同一張帳單在別張請款單內顯示原因與單號
  const cand = await get('clerk', `${PR}/utility-candidates?month=${m}&vendor_id=${payee.id}`);
  expect(cand.status).toBe(200);
  const cb = (cand.body.data.bills as any[]).find((x) => x.id === b1.id);
  expect(cb).toMatchObject({ eligible: false, code: 'BILL_IN_OTHER_REQUEST', pr_no: pr.pr_no });
  const own = await get('clerk', `${PR}/utility-candidates?month=${m}&vendor_id=${payee.id}&pr_id=${pr.id}`);
  expect((own.body.data.bills as any[]).every((x) => x.eligible)).toBe(true);
  const list = await get('clerk', `${PR}/utility-candidates?month=${m}`);
  expect((list.body.data.payees as any[]).find((x) => x.vendor_id === payee.id)).toMatchObject({ bill_count: 2, eligible_count: 0 });
  // 列表：來源篩選與列欄位；沒有水電檢視者明細遮蔽；沒有廠商權限者看不到統編與銀行
  const lst = await get('clerk', `${PR}?source=UTILITY&vendorId=${payee.id}`);
  expect(lst.status).toBe(200);
  expect(lst.body.data.map((r: any) => r.id)).toEqual([pr.id]);
  expect(lst.body.data[0]).toMatchObject({ source: 'UTILITY', bill_count: 2 });
  expect(lst.body.permissions).toMatchObject({ canCreateUtility: true, billsVisible: true });
  expect((await get('clerk', `${PR}?source=PURCHASE&vendorId=${payee.id}`)).body.data).toEqual([]);
  expect((await get('clerk', `${PR}?source=FOO`)).status).toBe(400);
  const pv = await get('payview', `${PR}/${pr.id}`);
  expect(pv.status).toBe(200);
  expect(pv.body.data.bills_masked).toBe(true);
  expect(pv.body.data.bill_lines).toBeUndefined();
  expect(pv.body.data.vendor_tax_id_snapshot).toBeNull();
  expect(pv.body.permissions).toMatchObject({ canCreateUtility: false, billsVisible: false });
  const nv = await get('novendor', `${PR}/${pr.id}`);
  expect(nv.body.data.vendor_masked).toBe(true);
  expect(nv.body.data.bank_snapshot).toEqual({});
  expect(nv.body.data.bill_lines).toHaveLength(2);
  void b2;
});

test('修改與動作（API）：缺附件被擋並列清單、補附件後送出（自動標記）、會計退回與作廢帳單回復、不可混用 lines 與 bill_ids', async () => {
  const payee = await seedPayee('API6');
  const m = month(3);
  const b1 = await bill(payee, m, { amount: 120, location_name: undefined });
  const b2 = await bill(payee, m, { amount: 480, expense_type: 'PHONE' });
  const b3 = await bill(payee, m, { amount: 60, expense_type: 'WATER' });
  const created = await createUb('clerk', payee, m, { bill_ids: [b1.id, b2.id] });
  expect(created.status).toBe(201);
  let pr = created.body.data;
  // PATCH：加一張、拿掉一張、關自動標記
  const patched = await send('clerk', 'patch', `${PR}/${pr.id}`, { bill_ids: [b2.id, b3.id], auto_mark_paid: false, expected_updated_at: pr.updated_at });
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  expect(patched.body.data.auto_mark_paid).toBe(false);
  expect(Number(patched.body.data.amount_total)).toBe(540);
  pr = patched.body.data;
  const back = await send('clerk', 'patch', `${PR}/${pr.id}`, { auto_mark_paid: true, notes: '改回自動標記', expected_updated_at: pr.updated_at });
  expect(back.status).toBe(200);
  expect(back.body.data.auto_mark_paid).toBe(true);
  pr = back.body.data;
  // 錯誤：STALE、缺版本、混用、空清單、權限
  expect((await send('clerk', 'patch', `${PR}/${pr.id}`, { notes: 'x', expected_updated_at: created.body.data.updated_at })).status).toBe(409);
  expect((await send('clerk', 'patch', `${PR}/${pr.id}`, { notes: 'x' })).status).toBe(400);
  expect((await send('clerk', 'patch', `${PR}/${pr.id}`, { bill_ids: [b2.id], lines: [], expected_updated_at: pr.updated_at })).status).toBe(400);
  expect((await send('clerk', 'patch', `${PR}/${pr.id}`, { bill_ids: [], expected_updated_at: pr.updated_at })).status).toBe(400);
  expect((await send('accountant', 'patch', `${PR}/${pr.id}`, { bill_ids: [b2.id], expected_updated_at: pr.updated_at })).status).toBe(403);
  const mixed = await send('clerk', 'patch', `${PR}/${pr.id}`, { lines: [{ receipt_id: crypto.randomUUID() }], expected_updated_at: pr.updated_at });
  expect(mixed.status).toBe(409);
  expect(mixed.body.code).toBe('SOURCE_MISMATCH');
  // 送出：缺附件（b2 有附件、b3 沒有）→ 409 列清單，請款單與帳單不動
  await attach(b2);
  const blocked = await act('clerk', pr, 'submit');
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('BILL_MISSING_ATTACHMENT');
  expect(blocked.body.error).toContain('1 張帳單還沒有附件');
  expect(blocked.body.missing_bills.map((x: any) => x.bill_id)).toEqual([b3.id]);
  noLeak(blocked.body);
  expect((await dbBill(b3.id)).paid_at).toBeNull();
  // 會計與第 4.5 批總務不能送出（缺水電管理）
  expect((await act('accountant', pr, 'submit')).status).toBe(403);
  expect((await act('ga45_clerk', pr, 'submit')).status).toBe(403);
  await attach(b3);
  const sub = await act('clerk', pr, 'submit');
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  expect(sub.body.data.status).toBe('SUBMITTED');
  expect(sub.body.data.auto_marked_count).toBe(2);
  for (const b of [b2, b3]) expect((await dbBill(b.id)).paid_by_pr_id).toBe(pr.id);
  // 帳單 API：已在請款單內、鎖定、鎖定時修改被擋的白話訊息
  const bj = await get('clerk', `${UB}/${b2.id}`);
  expect(bj.body.data).toMatchObject({ status: 'paid', paid_by_pr_id: pr.id });
  expect(bj.body.data.payment_request).toMatchObject({ in_request: true, pr_no: pr.pr_no, status: 'SUBMITTED' });
  expect(bj.body.data.locked).toEqual(expect.arrayContaining(['amount', 'delete', 'paid_at']));
  const bb = await get('billonly', `${UB}/${b2.id}`);
  expect(bb.body.data.payment_request).toEqual({ in_request: true });
  const edit = await send('clerk', 'patch', `${UB}/${b2.id}`, { amount: 481, expected_updated_at: (await dbBill(b2.id)).updated_at, confirm_paid_change: true });
  expect(edit.status).toBe(409);
  expect(edit.body.code).toBe('BILL_IN_REQUEST');
  expect(edit.body.error).toContain(pr.pr_no);
  noLeak(edit.body);
  const unpay = await send('clerk', 'post', `${UB}/${b2.id}/unpay`, { confirm: true, expected_updated_at: (await dbBill(b2.id)).updated_at });
  expect(unpay.status).toBe(409);
  expect(unpay.body.code).toBe('BILL_IN_REQUEST');
  // 最後一個附件鎖（API 刪除附件走使用者身分，資料庫觸發器擋）
  const att = await db().from('ga_resource_attachments').select('id').eq('resource_type', 'UTILITY_BILL').eq('resource_id', b2.id).is('deleted_at', null);
  const del = await send('clerk', 'delete', `${P}/attachments/${att.data![0].id}`, { deletion_reason: '想刪' });
  expect(del.status).toBe(409);
  expect(del.body.code).toBe('BILL_LAST_ATTACHMENT_LOCKED');
  noLeak(del.body);
  // 會計退回（帳單回待繳）、再送出、標已付款、作廢
  const ret = await act('accountant', sub.body.data, 'return', { reason: 'API 退回' });
  expect(ret.status, JSON.stringify(ret.body)).toBe(200);
  expect(ret.body.data.status).toBe('DRAFT');
  for (const b of [b2, b3]) expect((await dbBill(b.id)).paid_at).toBeNull();
  const again = await act('clerk', ret.body.data, 'submit');
  expect(again.status).toBe(200);
  const paid = await act('accountant', again.body.data, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'API-REF' });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  expect(paid.body.data.status).toBe('PAID');
  for (const b of [b2, b3]) expect((await dbBill(b.id)).paid_by_pr_id, '標已付款帳單不變').toBe(pr.id);
  const voidNoReason = await act('accountant', paid.body.data, 'void', {});
  expect(voidNoReason.status).toBe(400);
  const vd = await act('accountant', paid.body.data, 'void', { reason: '重複付款' });
  expect(vd.status).toBe(200);
  expect(vd.body.data.status).toBe('VOID');
  for (const b of [b2, b3]) expect((await dbBill(b.id)).paid_at).toBeNull();
  void b1;
});

test('帳單 API：繳費單位儲存與篩選、批次補填（白話回報略過原因）、新篩選驗證', async () => {
  const payee = await seedPayee('API7');
  const plain = await seedPayee('API8', { service_category_ids: [] });
  const m = month(4);
  const e1 = await bill(payee, m, { payee_vendor_id: null, provider_name: `QA-GAUP-${crypto.randomUUID().slice(0, 8)}-PRV` });
  const e2 = await bill(payee, m, { payee_vendor_id: null, expense_type: 'WATER' });
  // 儲存帶繳費單位
  const bad = await send('clerk', 'patch', `${UB}/${e1.id}`, { payee_vendor_id: plain.id, expected_updated_at: e1.updated_at });
  expect(bad.status).toBe(409);
  expect(bad.body.code).toBe('PAYEE_NOT_UTILITY');
  expect(bad.body.error).toContain('公用事業');
  const ok = await send('clerk', 'patch', `${UB}/${e1.id}`, { payee_vendor_id: payee.id, expected_updated_at: e1.updated_at });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.data).toMatchObject({ payee_vendor_id: payee.id, payee_vendor_name: payee.name });
  // 批次補填
  expect((await send('clerk', 'post', `${UB}/set-payee`, { ids: [], vendor_id: payee.id })).status).toBe(400);
  expect((await send('clerk', 'post', `${UB}/set-payee`, { ids: [e2.id] })).status).toBe(400);
  expect((await send('clerk', 'post', `${UB}/set-payee`, { ids: ['x'], vendor_id: payee.id })).status).toBe(400);
  expect((await send('clerk', 'post', `${UB}/set-payee`, { ids: [e2.id], vendor_id: plain.id })).status).toBe(409);
  const done = await send('clerk', 'post', `${UB}/set-payee`, { ids: [e1.id, e2.id, crypto.randomUUID()], vendor_id: payee.id });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  expect(done.body.data.updated).toBe(1);
  expect(new Set(done.body.data.skipped.map((s: any) => s.reason))).toEqual(new Set(['HAS_PAYEE', 'NOT_FOUND']));
  expect((await dbBill(e2.id)).payee_vendor_id).toBe(payee.id);
  // 列表新篩選
  const byPayee = await get('clerk', `${UB}?payee=${payee.id}&month=${m}`);
  expect(byPayee.status).toBe(200);
  expect(byPayee.body.data.map((x: any) => x.id).sort()).toEqual([e1.id, e2.id].sort());
  expect((await get('clerk', `${UB}?payee=none&month=${m}`)).body.data.every((x: any) => x.payee_vendor_id === null)).toBe(true);
  expect((await get('clerk', `${UB}?request=in_request&payee=${payee.id}`)).body.data).toEqual([]);
  expect((await get('clerk', `${UB}?request=none&payee=${payee.id}&month=${m}`)).body.total).toBe(2);
  expect((await get('clerk', `${UB}?request=x`)).status).toBe(400);
  expect((await get('clerk', `${UB}?payee=x`)).status).toBe(400);
  // 檢視者可讀不可補填
  expect((await get('payview', `${UB}?payee=${payee.id}`)).status).toBe(403);
});

test('對帳 CSV：預設採購不含水電；source=UTILITY 欄位、BOM、中文、文字格式、公式注入、沒有廠商權限整欄省略、沒有水電檢視每張請款單一列', async () => {
  const payee = await seedPayee('API9', { tax_id: '03000001' });
  const m = month(5);
  // 門市欄位用不屬於任何門市的據點名稱（以 + 開頭）與以 = 開頭的識別號碼，驗證公式注入防護；帳單供應商仍帶標記，清除函式找得到
  const bs = [
    await bill(payee, m, { amount: 1500, service_identifier: '00123-9', store_id: '', location_name: '+cmd|calc' }),
    await bill(payee, m, { amount: 500, expense_type: 'WATER', service_identifier: '=W9', store_id: '', location_name: 'QA-GAUP 據點二' }),
  ];
  for (const b of bs) await attach(b);
  const created = await createUb('clerk', payee, m);
  expect(created.status).toBe(201);
  const sub = await act('clerk', created.body.data, 'submit');
  expect(sub.status).toBe(200);
  const ym = todayIso().slice(0, 7);
  const text = async (who: string, p: string) => {
    const r = await apis[who].get(p);
    return { status: r.status(), text: await r.text(), headers: r.headers() };
  };
  // 預設（採購）：沒有水電列，檔名與欄位維持原樣
  const def = await text('accountant', `${PR}/export?month=${ym}&vendorId=${payee.id}`);
  expect(def.status).toBe(200);
  expect(def.text).toContain('採購單號');
  expect(def.text).not.toContain('PY-');
  expect(def.headers['content-disposition']).toContain(encodeURIComponent('請款對帳-'));
  // 水電
  const ut = await text('accountant', `${PR}/export?month=${ym}&vendorId=${payee.id}&source=UTILITY`);
  expect(ut.status).toBe(200);
  expect(ut.text.charCodeAt(0)).toBe(0xfeff);
  expect(ut.headers['content-disposition']).toContain(encodeURIComponent('水電話費請款對帳-'));
  expect(ut.headers['x-export-rows']).toBe('2');
  const lines = ut.text.trim().split('\r\n');
  expect(lines[0]).toContain('帳單月份');
  expect(lines[0]).toContain('電號／水號／用戶號碼');
  expect(lines[0]).toContain('統編');
  expect(lines[0]).not.toContain('採購單號');
  expect(lines).toHaveLength(3);
  expect(ut.text).toContain('"=""03000001"""'); // 統編文字格式
  expect(ut.text).toContain('"=""00123-9"""'); // 識別號碼文字格式
  expect(ut.text).toContain("'+cmd|calc"); // 據點名稱公式注入防護
  expect(ut.text).toContain("'=W9"); // 識別號碼公式注入防護
  expect(ut.text).toContain('電費');
  expect(ut.text).toContain('已送出');
  expect(ut.text).toContain(',是'); // 自動標記
  // 沒有廠商權限：整欄省略
  const nv = await text('novendor', `${PR}/export?month=${ym}&vendorId=${payee.id}&source=UTILITY`);
  expect(nv.status).toBe(200);
  expect(nv.text).not.toContain('統編');
  expect(nv.text).not.toContain('03000001');
  // 沒有水電檢視：每張請款單一列，帳單欄位空白
  const pv = await text('payview', `${PR}/export?month=${ym}&vendorId=${payee.id}&source=UTILITY`);
  expect(pv.status).toBe(200);
  expect(pv.headers['x-export-rows']).toBe('1');
  expect(pv.text).not.toContain('00123-9');
  // 錯誤與權限
  expect((await text('accountant', `${PR}/export?month=${ym}&source=FOO`)).status).toBe(400);
  expect((await text('accountant', `${PR}/export?source=UTILITY`)).status).toBe(400);
  for (const who of ['billonly', 'store_mgr', 'admin', 'nobody']) expect((await text(who, `${PR}/export?month=${ym}&source=UTILITY`)).status, who).toBe(403);
  void pastMonth;
});
