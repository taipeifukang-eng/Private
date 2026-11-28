import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, todayIso, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// GAAUTO 付款日到期自動標記已付款 e2e（DEV；資料只用 VW／ZT 門市、2038 年；結束清掉自己建立的資料）。
//   劇本 1（資料庫與 API）：多張水電請款單（最早帳單期限、預計付款日優先、沒有日期、草稿、人工已付款、已作廢）→ 以 service role 手動呼叫排程函式（測試用途，用 p_as_of 與 p_pr_ids 限定範圍）
//     → 只有到期的已送出單變已付款，paid_date＝付款日、pay_method＝TRANSFER、沒有付款人、事件 auto=true；重跑不重複；一般登入者不能呼叫排程函式；守門擋下直接改表。
//     → 取消自動付款：原因必填、只限自動標記、人工已付款擋下、無權限者擋下、改回已送出並清付款欄位；之後排程不會再標回；之後仍可手動標記已付款。
//   劇本 2（畫面）：送出前看到「到期後系統會自動標記」→ 排程後清單與詳情顯示「系統自動標記（付款日 YYYY/MM/DD）」與「取消自動付款」→ 在畫面取消（原因必填）→ 回已送出並說明不會再自動。
const P = '/api/workspace/general-affairs';
const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly'];
test.describe.configure({ mode: 'serial' });
test.setTimeout(360_000);
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
const key = () => crypto.randomUUID();
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const db = () => adminDb();
const vis = (page: any, id: string) => page.getByTestId(id).locator('visible=true');
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const events = async (id: string) => ((await db().from('ga_payment_request_events').select('*').eq('pr_id', id).order('created_at')).data || []) as any[];
const ident = () => `QA-GAUP-${String(Date.now()).slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;
/** 手動呼叫排程函式（測試用途；以 service role，限定 p_pr_ids 與 p_as_of，不會動到其他資料）。 */
async function runCron(ids: string[], asOf: string) {
  const r = await db().rpc('ga_apply_due_payment_requests', { p_as_of: asOf, p_pr_ids: ids });
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data as { ok: boolean; as_of: string; marked: number; failed: number; ids: string[] };
}
async function shot(testInfo: any, page: any, name: string) {
  const dir = process.env.GAAUTO_SHOTS;
  if (!dir || !String(testInfo.project.name).startsWith('desktop')) return;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/** 建立水電請款單：帳單各帶一個繳費期限（null＝沒有期限），可帶預計付款日；submit=true 就送出（不勾自動標記帳單，避免混進別的規則）。 */
async function mkRequest(payee: any, st: any, o: { dues: Array<string | null>; expected?: string | null; submit?: boolean }) {
  const stores4 = [st.VW001, st.VW002, st.ZT01, st.ZT02];
  const bills: any[] = [];
  for (let i = 0; i < o.dues.length; i += 1) {
    const b = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01', store_id: stores4[i].id, expense_type: 'ELECTRICITY', service_identifier: ident(), amount: 500 + i, due_date: o.dues[i] });
    await addBillAttachment(users.clerk.client, b.id, users.clerk.id);
    bills.push(b);
  }
  const c = await apis.clerk.post(`${P}/payment-requests`, {
    data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: bills.map((b) => b.id), auto_mark_paid: false, ...(o.expected ? { expected_pay_date: o.expected } : {}), idempotency_key: key() },
  });
  expect(c.status(), await c.text()).toBe(201);
  let pr = (await c.json()).data;
  if (o.submit !== false) {
    const s = await apis.clerk.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: key() } });
    expect(s.status(), await s.text()).toBe(200);
    pr = (await s.json()).data;
  }
  return pr as any;
}
const act = (who: string, id: string, body: Record<string, unknown>) => apis[who].post(`${P}/payment-requests/${id}/actions`, { data: { idempotency_key: key(), ...body } });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('劇本 1 排程判定與取消自動付款：日期判定、只處理已送出、重跑不重複、取消後不會被標回', async () => {
  const st = await stores();
  const payee = await seedPayee('AP1');
  const r1 = await mkRequest(payee, st, { dues: ['2038-03-20', '2038-03-10'] }); // 沒填預計付款日：最早期限 03-10
  const r2 = await mkRequest(payee, st, { dues: ['2038-03-01'], expected: '2038-05-10' }); // 預計付款日優先
  const r3 = await mkRequest(payee, st, { dues: [null] }); // 沒有任何日期
  const r4 = await mkRequest(payee, st, { dues: ['2038-03-01'], submit: false }); // 草稿
  const r5 = await mkRequest(payee, st, { dues: ['2038-03-05'] }); // 人工標記已付款
  const r6 = await mkRequest(payee, st, { dues: ['2038-03-06'] }); // 已作廢
  const all = [r1, r2, r3, r4, r5, r6].map((r) => r.id as string);

  // 人工標記 r5 已付款（付款方式現金）、作廢 r6
  const paid = await act('accountant', r5.id, { action: 'mark_paid', pay_method: 'CASH', paid_date: todayIso(), expected_updated_at: (await dbPr(r5.id)).updated_at });
  expect(paid.status(), await paid.text()).toBe(200);
  const voided = await act('accountant', r6.id, { action: 'void', reason: '測試作廢', expected_updated_at: (await dbPr(r6.id)).updated_at });
  expect(voided.status(), await voided.text()).toBe(200);

  // 一般登入者不能呼叫排程函式；匿名也不行
  const denied = await users.clerk.client.rpc('ga_apply_due_payment_requests', { p_as_of: '2038-04-01', p_pr_ids: all });
  expect(denied.error, '登入者不能呼叫排程函式').not.toBeNull();

  // 還沒到期（最早期限 03-10，今天設 03-09）：一張都不標
  expect(await runCron(all, '2038-03-09')).toMatchObject({ marked: 0, failed: 0, ids: [] });
  // 2038-04-01：只有 r1（最早期限 03-10）到期；r2 預計付款日 05-10 未到、r3 沒日期、r4 草稿、r5 人工已付款、r6 已作廢
  const first = await runCron(all, '2038-04-01');
  expect(first).toMatchObject({ marked: 1, failed: 0, ids: [r1.id] });
  const a1 = await dbPr(r1.id);
  expect(a1).toMatchObject({ status: 'PAID', paid_date: '2038-03-10', pay_method: 'TRANSFER', paid_by: null, paid_ref: null, paid_auto: true, auto_pay_off: false });
  expect(a1.paid_at).not.toBeNull();
  const ev1 = (await events(r1.id)).filter((e) => e.event_type === 'mark_paid');
  expect(ev1).toHaveLength(1);
  expect(ev1[0]).toMatchObject({ actor_id: null, from_status: 'SUBMITTED', to_status: 'PAID', reason: '付款日到期，系統自動標記已付款' });
  expect(ev1[0].payload).toMatchObject({ auto: true, paid_date: '2038-03-10', pay_method: 'TRANSFER', pay_method_defaulted: true, date_source: 'bill_due_date', as_of: '2038-04-01' });
  expect((await dbPr(r2.id)).status).toBe('SUBMITTED');
  expect((await dbPr(r3.id)).status).toBe('SUBMITTED');
  expect((await dbPr(r4.id)).status).toBe('DRAFT');
  const m5 = await dbPr(r5.id);
  expect(m5).toMatchObject({ status: 'PAID', pay_method: 'CASH', paid_auto: false });
  expect(m5.paid_by).toBe(users.accountant.id);
  expect((await dbPr(r6.id)).status).toBe('VOID');

  // 冪等：再跑一次不重複標記、不重複寫事件
  expect(await runCron(all, '2038-04-01')).toMatchObject({ marked: 0, failed: 0, ids: [] });
  expect((await events(r1.id)).filter((e) => e.event_type === 'mark_paid')).toHaveLength(1);
  // 預計付款日優先：2038-05-10 才輪到 r2，paid_date 是預計付款日（不是帳單期限 03-01，也不是執行日）
  expect(await runCron(all, '2038-05-10')).toMatchObject({ marked: 1, ids: [r2.id] });
  expect(await dbPr(r2.id)).toMatchObject({ status: 'PAID', paid_date: '2038-05-10', paid_auto: true });
  expect((await events(r2.id)).find((e) => e.event_type === 'mark_paid')?.payload).toMatchObject({ date_source: 'expected_pay_date' });
  // 沒有日期的單、草稿永遠不處理
  expect(await runCron(all, '2099-01-01')).toMatchObject({ marked: 0 });
  expect((await dbPr(r3.id)).status).toBe('SUBMITTED');
  expect((await dbPr(r4.id)).status).toBe('DRAFT');

  // 守門：直接改表不能設自動付款標記、不能把自動標記的已付款單改回已送出、不能清掉自動標記
  const forge = await db().from('ga_payment_requests').update({ paid_auto: true }).eq('id', r3.id);
  expect(forge.error?.message || '').toContain('只有付款日到期的自動排程可以標記自動付款');
  const back = await db().from('ga_payment_requests').update({ status: 'SUBMITTED' }).eq('id', r1.id);
  expect(back.error?.message || '').toContain('請款單狀態不能從');
  const clear = await db().from('ga_payment_requests').update({ paid_auto: false }).eq('id', r1.id);
  expect(clear.error?.message || '').toMatch(/已付款的請款單，付款資訊不能修改|只能用「取消自動付款」清除/);

  // ---- 取消自動付款
  const cur1 = await dbPr(r1.id);
  // 沒有原因 → 400
  const noReason = await act('clerk', r1.id, { action: 'cancel_auto_pay', expected_updated_at: cur1.updated_at });
  expect(noReason.status()).toBe(400);
  // 沒有請款管理權限（只有水電）→ 403
  const nopower = await act('billonly', r1.id, { action: 'cancel_auto_pay', reason: '不該成功', expected_updated_at: cur1.updated_at });
  expect(nopower.status()).toBe(403);
  // 人工標記的已付款單不能取消自動付款
  const manual = await act('clerk', r5.id, { action: 'cancel_auto_pay', reason: '人工的不行', expected_updated_at: m5.updated_at });
  expect(manual.status()).toBe(409);
  expect((await manual.json()).code).toBe('NOT_AUTO_PAID');
  // 版本不符 → 409 STALE
  const stale = await act('clerk', r1.id, { action: 'cancel_auto_pay', reason: '版本舊', expected_updated_at: '2038-01-01T00:00:00Z' });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe('STALE');
  // 成功取消（同一個識別碼重送回原結果）
  const k = key();
  const ok = await apis.clerk.post(`${P}/payment-requests/${r1.id}/actions`, { data: { action: 'cancel_auto_pay', reason: '實際還沒匯款', expected_updated_at: cur1.updated_at, idempotency_key: k } });
  expect(ok.status(), await ok.text()).toBe(200);
  const okBody = await ok.json();
  expect(okBody.data).toMatchObject({ status: 'SUBMITTED', paid_auto: false, auto_pay_off: true, paid_date: null, paid_at: null, paid_by: null });
  const replay = await apis.clerk.post(`${P}/payment-requests/${r1.id}/actions`, { data: { action: 'cancel_auto_pay', reason: '實際還沒匯款', expected_updated_at: cur1.updated_at, idempotency_key: k } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).replay).toBe(true);
  const after = await dbPr(r1.id);
  expect(after).toMatchObject({ status: 'SUBMITTED', paid_auto: false, auto_pay_off: true, paid_date: null, paid_ref: null, paid_by: null, paid_at: null, pay_method: null });
  const cancelEv = (await events(r1.id)).filter((e) => e.event_type === 'cancel_auto_pay');
  expect(cancelEv).toHaveLength(1);
  expect(cancelEv[0]).toMatchObject({ from_status: 'PAID', to_status: 'SUBMITTED', reason: '實際還沒匯款', actor_id: users.clerk.id });
  // 取消後付款日早就過了，排程也不會再標回（就算再跑好幾次）
  for (const asOf of ['2038-04-02', '2038-12-31', '2099-01-01']) expect(await runCron(all, asOf)).toMatchObject({ marked: 0, ids: [] });
  expect((await dbPr(r1.id)).status).toBe('SUBMITTED');
  // 已經是已送出，不能再取消
  const twice = await act('clerk', r1.id, { action: 'cancel_auto_pay', reason: '再取消', expected_updated_at: after.updated_at });
  expect(twice.status()).toBe(409);
  // 取消後仍可手動標記已付款：付款人是會計、不是自動標記；之後不能再取消自動付款
  const manualPay = await act('accountant', r1.id, { action: 'mark_paid', pay_method: 'TRANSFER', expected_updated_at: after.updated_at });
  expect(manualPay.status(), await manualPay.text()).toBe(200);
  const mp = await dbPr(r1.id);
  expect(mp).toMatchObject({ status: 'PAID', paid_auto: false });
  expect(mp.paid_by).toBe(users.accountant.id);
  const noCancel = await act('clerk', r1.id, { action: 'cancel_auto_pay', reason: '人工標記後不能取消', expected_updated_at: mp.updated_at });
  expect((await noCancel.json()).code).toBe('NOT_AUTO_PAID');
  // 自動標記的 r2 可以作廢（作廢規則不變）
  const v2 = await act('accountant', r2.id, { action: 'void', reason: '測試作廢自動標記的單', expected_updated_at: (await dbPr(r2.id)).updated_at });
  expect(v2.status(), await v2.text()).toBe(200);
  expect(await dbPr(r2.id)).toMatchObject({ status: 'VOID', paid_auto: true });
  // 取消不能用在已作廢的單
  const cv = await act('clerk', r2.id, { action: 'cancel_auto_pay', reason: '作廢後取消', expected_updated_at: (await dbPr(r2.id)).updated_at });
  expect(cv.status()).toBe(409);
});

test('劇本 2 畫面：送出前提示→排程後顯示「系統自動標記（付款日）」與清單標籤→畫面取消自動付款（原因必填）→回已送出並說明不再自動', async ({ browser }, testInfo) => {
  const st = await stores();
  const payee = await seedPayee('AP2');
  const early = await mkRequest(payee, st, { dues: ['2038-06-15'] });
  const late = await mkRequest(payee, st, { dues: ['2038-09-30'], expected: '2038-09-30' });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await side(page, '請款單').click();
    // 還沒到期：詳情提示到期後會自動標記
    await vis(page, 'pr-search').fill(late.pr_no);
    await vis(page, 'open-pr').click();
    await expect(vis(page, 'pu-status')).toHaveText('已送出');
    await expect(vis(page, 'pu-auto-hint')).toContainText('付款日 2038/09/30 到期後，系統會自動標記已付款');
    await expect(vis(page, 'pu-cancel-auto')).toHaveCount(0);
    await shot(testInfo, page, '01-送出後提示');

    // 排程（測試用途手動呼叫）：early 到期、late 還沒
    expect(await runCron([early.id, late.id], '2038-06-15')).toMatchObject({ marked: 1, ids: [early.id] });
    await page.reload();
    await openGaCenter(page);
    await openGaSide(page);
    await side(page, '請款單').click();
    await vis(page, 'pr-search').fill(early.pr_no);
    // 清單可辨識
    const card = page.locator('[data-testid="pr-card"]:visible').first();
    await expect(card.getByTestId('pr-status')).toHaveText('已付款');
    await expect(card.getByTestId('pr-auto-paid')).toHaveText('系統自動標記');
    await expect(card).toContainText('2038-06-15 付款');
    await shot(testInfo, page, '02-清單自動標記');
    // 詳情顯示自動標記與取消按鈕
    await vis(page, 'open-pr').click();
    await expect(vis(page, 'pu-status')).toHaveText('已付款');
    await expect(vis(page, 'pu-auto-paid')).toContainText('系統自動標記（付款日 2038/06/15）');
    await expect(vis(page, 'pu-events')).toContainText('付款日到期，系統自動標記已付款');
    await expect(vis(page, 'pu-events')).toContainText('系統');
    await expect(vis(page, 'pu-cancel-auto')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await shot(testInfo, page, '03-詳情自動標記');
    // 取消：沒填原因被擋
    await vis(page, 'pu-cancel-auto').click();
    await expect(vis(page, 'pu-cancel-reason')).toBeVisible();
    await vis(page, 'pu-cancel-confirm').click();
    await expect(vis(page, 'pu-cancel-error')).toContainText('原因');
    expect((await dbPr(early.id)).status).toBe('PAID');
    await shot(testInfo, page, '04-取消對話框');
    await vis(page, 'pu-cancel-reason').fill('實際還沒匯款');
    await vis(page, 'pu-cancel-confirm').click();
    await expect(vis(page, 'pu-status')).toHaveText('已送出');
    await expect(vis(page, 'pu-auto-cancelled')).toContainText('系統不會再自動標記');
    await expect(vis(page, 'pu-auto-hint')).toContainText('已取消自動付款');
    await expect(vis(page, 'pu-events')).toContainText('取消自動付款');
    await expect(vis(page, 'pu-events')).toContainText('實際還沒匯款');
    await shot(testInfo, page, '05-取消後');
    expect(await dbPr(early.id)).toMatchObject({ status: 'SUBMITTED', auto_pay_off: true, paid_auto: false, paid_date: null });
    // 再跑排程也不會標回
    expect(await runCron([early.id, late.id], '2038-12-31')).toMatchObject({ marked: 1, ids: [late.id] });
    expect((await dbPr(early.id)).status).toBe('SUBMITTED');
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('劇本 3 過期付款日與退回草稿：過期日照付款日標記並標示早於建立日；取消自動付款後退回草稿再送出，又會自動付款', async () => {
  const st = await stores();
  const payee = await seedPayee('AP3');
  const r = await mkRequest(payee, st, { dues: ['2020-01-15'] });
  // 付款日早於建立日：照該日期標記，事件帶 date_before_created
  expect(await runCron([r.id], '2038-04-01')).toMatchObject({ marked: 1, failed: 0, ids: [r.id] });
  expect(await dbPr(r.id)).toMatchObject({ status: 'PAID', paid_date: '2020-01-15', paid_auto: true });
  const ev = (await events(r.id)).find((e) => e.event_type === 'mark_paid' && e.payload?.auto === true);
  expect(ev?.payload).toMatchObject({ date_before_created: true, date_source: 'bill_due_date', paid_date: '2020-01-15' });
  // 取消自動付款 → 不再自動
  const c = await act('clerk', r.id, { action: 'cancel_auto_pay', reason: '測試取消', expected_updated_at: (await dbPr(r.id)).updated_at });
  expect(c.status(), await c.text()).toBe(200);
  expect(await dbPr(r.id)).toMatchObject({ status: 'SUBMITTED', auto_pay_off: true });
  expect(await runCron([r.id], '2038-04-02')).toMatchObject({ marked: 0 });
  // 退回草稿：取消旗標清除；重新送出後排程又會處理
  const ret = await act('accountant', r.id, { action: 'return', reason: '測試退回', expected_updated_at: (await dbPr(r.id)).updated_at });
  expect(ret.status(), await ret.text()).toBe(200);
  expect(await dbPr(r.id)).toMatchObject({ status: 'DRAFT', auto_pay_off: false });
  const sub = await act('clerk', r.id, { action: 'submit', expected_updated_at: (await dbPr(r.id)).updated_at });
  expect(sub.status(), await sub.text()).toBe(200);
  expect(await runCron([r.id], '2038-04-03')).toMatchObject({ marked: 1, ids: [r.id] });
  // 同仁代墊款不自動：排程篩選條件只收廠商（沒有同仁單時至少確認不影響廠商單）
  expect((await dbPr(r.id)).payee_type).toBe('VENDOR');
});
