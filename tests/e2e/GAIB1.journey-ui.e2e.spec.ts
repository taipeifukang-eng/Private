import crypto from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import { openGaCenter } from '../support/g01-ui';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, type GaupKey, type GaupUser } from '../support/g46-fixtures';
import { cleanupGaib1, fakeCompany, seedGaib1Vendor } from '../support/gaib1-fixtures';
import { dlg, expectNoOverflow, heading, navTo, pickIn, real, vis } from '../support/gaib1-ui';
import { stores } from '../support/m7m8-fixtures';

// ga-improve-b1 e2e 多角色劇本（循序；桌機 1440 project 跑一次，同仁用手機 390 視窗；每個畫面都檢查整頁與內層容器沒有橫向溢出）：
//   1. 預付款接力：總務建含稅採購單（運費＋折價券、抬頭）→ 下訂（預計到貨日已過）→ 總務開預付單（畫面）→ 送出 → 會計標已付款（信用卡末四碼）→ 逾期提醒（採購單與請款單列表）
//      → 到貨驗入（畫面提示併入調整列與預付核銷）→ 登錄憑證連結不顯示 → 一般請款只請差額（預設扣核銷）→ 會計付款（網購平台）→ 採購單結案。
//   2. 預付回復：已付款預付單作廢 → 核銷回復（帳本與採購單摘要）；登記退款；預付餘額未清時取消採購單被擋。
//   3. 同仁代墊採購：總務選同仁 → 送出被擋（同仁尚未登錄匯款帳戶）→ 同仁（手機）登錄帳戶 → 總務重抓帳戶並送出 → 會計看到帳戶、標已付款（只能轉帳、現金、支票）→ 同仁看到已付款；
//      會計不能核付自己的代墊款（SELF_PAYEE）。
//   4. 同仁代墊水電：總務為門市先繳的帳單開水電請款單、付款對象選同仁 → 送出（帳單自動標已繳）→ 會計退回（帳單回待繳）→ 再送出 → 會計付款。
//   5. 付款方式與多家抬頭：請款設定新增兩家假公司、換預設 → 採購單與請款單各選不同抬頭 → 會計用信用卡（末四碼）付款 → 列印頁用所選抬頭 → 公司改名不影響已送出請款單 → 對帳 CSV extended 有新欄位。
// 帳號：DEV 真實角色（vue_workspace_ga45_*、vue_workspace_gaup_*）與臨時帳號；資料標記 QA-GAIB1-／QA-GAUP-、帳單月份 2038；只清自己的。
const P = '/api/workspace/general-affairs';
const KEYS: GaupKey[] = ['clerk', 'accountant', 'ga45_clerk', 'ga45_accountant', 'nobody', 'payview'];
const key = () => crypto.randomUUID();
const db = () => adminDb();
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let vendor: any;
const ymd = (offsetDays: number) => new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
const tag = (t: string) => `QA-GAIB1 ${t}`;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.setTimeout(420_000);

type Who = { ctx: BrowserContext; page: Page; errors: string[] };
async function open(browser: Browser, who: string, phone = false): Promise<Who> {
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: states[who], serviceWorkers: 'block',
    ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
async function post(who: string, path: string, data: unknown, expectOk = true) {
  const r = await apis[who].post(`${P}${path}`, { data });
  if (expectOk) expect(r.status(), `${path}: ${await r.text()}`).toBeLessThan(300);
  return { status: r.status() as number, body: (await r.json().catch(() => ({}))) as any };
}
const item = (qty: number, price: number) => ({ item_name: 'QA-GAIB1 劇本品項', unit: '個', quantity: qty, unit_price: price, fulfil_mode: 'NO_STOCK' });
async function apiPo(header: Record<string, unknown>, items: unknown[], place = true) {
  const c = (await post('ga45_clerk', '/purchase-orders', { header: { vendor_id: vendor.id, notes: `[自動測試]M7M8 GAIB1-J ${key().slice(0, 6)}`, ...header }, items, idempotency_key: key() })).body.data;
  if (!place) return c;
  return (await post('ga45_clerk', `/purchase-orders/${c.id}/actions`, { action: 'place_order', expected_updated_at: c.updated_at })).body.data;
}
async function apiReceive(po: any, qty: number) {
  const r = await post('ga45_clerk', `/purchase-orders/${po.id}/receipts`, { header: {}, lines: [{ po_item_id: po.items[0].id, delivered_qty: qty, accepted_qty: qty }], idempotency_key: key() });
  return { receipt: (r.body.receiving.receipts as any[]).find((x) => !x.voided_at), order: r.body.order };
}
const dbPr = async (notes: string) => (await db().from('ga_payment_requests').select('*').eq('notes', notes).single()).data as any;
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbLedger = async (prId: string) => ((await db().from('ga_payment_prepay_ledger').select('*').eq('prepay_pr_id', prId).order('created_at').order('id')).data || []) as any[];

test.beforeAll(async () => {
  test.setTimeout(400_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupGaib1())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGaib1Vendor('J');
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function openPoDetail(page: Page, no: string) {
  await navTo(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dlg(page).getByTestId('po-detail')).toBeVisible();
}
async function poAct(page: Page, action: string, note?: string, notice: RegExp = /已/) {
  const d = dlg(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  if (note !== undefined) await d.getByTestId('f-note').fill(note);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('pd-notice')).toContainText(notice);
}
async function openPr(page: Page, prNo: string) {
  await navTo(page, '請款單');
  await expect(heading(page, '請款單')).toBeVisible();
  await vis(page, 'pr-search').fill(prNo);
  const card = page.locator('[data-testid="pr-card"]:visible', { hasText: prNo });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-pr').click();
}
const prNoOnPage = async (page: Page) => (await page.locator('h1:visible').first().innerText()).match(/PY-\d{8}-\d{3,}/)![0];
async function confirmAction(page: Page, btn: string, fill?: { reason?: string }) {
  await vis(page, btn).click();
  if (fill?.reason !== undefined) await vis(page, 'act-reason').fill(fill.reason);
  await vis(page, 'act-confirm').click();
}

test('1. 預付款接力：含稅採購單（運費＋折價券）→ 下訂 → 預付 → 信用卡付款 → 逾期提醒 → 到貨自動核銷與併入調整列 → 一般請款只請差額 → 網購平台付款 → 結案', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機視窗，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  const companyB = fakeCompany('J1-乙');
  await post('ga45_clerk', '/buyer-companies', { ...fakeCompany('J1-甲'), idempotency_key: key() });
  const companyBRow = ((await post('ga45_clerk', '/buyer-companies', { ...companyB, idempotency_key: key() })).body.data as any[]).find((r) => r.tax_id === companyB.tax_id);
  let poNo = '';
  let poId = '';
  let prepayNo = '';
  let prepayId = '';
  // -------- 1.1 總務（桌機）用畫面建含稅採購單
  const clerk = await open(browser, 'ga45_clerk');
  try {
    await openGaCenter(clerk.page);
    await navTo(clerk.page, '採購單');
    await vis(clerk.page, 'new-po').click();
    const form = clerk.page.getByTestId('po-form').locator('visible=true');
    await pickIn(form, 'pe-vendor', vendor.name);
    await form.getByTestId('pe-mode-free-0').check();
    await form.getByTestId('pe-name-0').fill('QA-GAIB1 預付劇本品');
    await form.getByTestId('pe-unit-0').fill('個');
    await form.getByTestId('pe-qty-0').fill('10');
    await form.getByTestId('pe-price-mode').selectOption('INCL');
    await form.getByTestId('pe-price-0').fill('105');
    await form.getByTestId('pe-adj-add-FREIGHT').click();
    await form.getByTestId('pe-adj-amount-0').fill('100');
    await form.getByTestId('pe-adj-add-COUPON').click();
    await form.getByTestId('pe-adj-label-1').fill('雙十一折價券');
    await form.getByTestId('pe-adj-amount-1').fill('50');
    await form.getByTestId('pe-adj-campaign-1').fill('雙十一');
    await form.getByTestId('pe-buyer').selectOption(companyBRow.id);
    await form.getByTestId('pe-expected').fill(ymd(-2));
    await expect(form.getByTestId('pe-total')).toHaveText('$1,100');
    await form.getByTestId('pe-save').click();
    await expect(clerk.page.getByTestId('pe-saved').locator('visible=true')).toBeVisible();
    poNo = (await clerk.page.getByTestId('pe-po-no').locator('visible=true').textContent())!.trim();
    const po = (await db().from('ga_purchase_orders').select('*').eq('po_no', poNo).single()).data as any;
    poId = po.id;
    expect(po).toMatchObject({ price_mode: 'INCL', buyer_company_id: companyBRow.id, status: 'DRAFT' });
    expect(Number(po.total_amount)).toBe(1100);
    expect(Number(po.subtotal)).toBe(1048); // round(1100÷1.05)
    expect(Number(po.tax_amount)).toBe(52); // 1100−1048（用減的）
    const adj = ((await db().from('ga_purchase_order_adjustments').select('*').eq('po_id', poId).order('line_no')).data || []) as any[];
    expect(adj.map((a) => [a.kind, Number(a.amount)])).toEqual([['FREIGHT', 100], ['COUPON', -50]]);
    expect(adj[1]).toMatchObject({ label: '雙十一折價券', campaign_name: '雙十一' });
    await expectNoOverflow(clerk.page, '1.1 採購單編輯');
    // 下訂（含稅 1,100 沒超過核准門檻，直接下訂）
    await clerk.page.getByTestId('back-list').locator('visible=true').click();
    await openPoDetail(clerk.page, poNo);
    await poAct(clerk.page, 'place_order', '', /已下訂/);
    await expect(dlg(clerk.page).getByTestId('pd-status')).toHaveText('已下訂');
    // -------- 1.2 預付：預付餘額與預付請款（畫面）
    await dlg(clerk.page).getByTestId('act-prepay').click();
    const pf = clerk.page.getByTestId('prepay-form');
    await pf.getByTestId('prepay-amount').fill('500');
    await pf.getByTestId('prepay-notes').fill(tag('J1-預付'));
    await pf.getByTestId('prepay-submit').click();
    await expect(vis(clerk.page, 'pe-kind')).toHaveText('預付款');
    await expect(vis(clerk.page, 'pe-status')).toHaveText('草稿');
    prepayNo = await prNoOnPage(clerk.page);
    const pre = await dbPr(tag('J1-預付'));
    prepayId = pre.id;
    expect(pre).toMatchObject({ pay_kind: 'PREPAY', prepay_po_id: poId, status: 'DRAFT', buyer_company_id: companyBRow.id });
    expect(Number(pre.amount_total)).toBe(500);
    expect([Number(pre.amount_untaxed), Number(pre.tax_amount)]).toEqual([476, 24]); // round(500÷1.05)＝476
    await expectNoOverflow(clerk.page, '1.2 預付請款單（草稿）');
    await confirmAction(clerk.page, 'pe-submit');
    await expect(vis(clerk.page, 'pe-status')).toHaveText('已送出');
    expect(real(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
  // -------- 1.3 會計標已付款：信用卡末四碼
  const acc = await open(browser, 'ga45_accountant');
  try {
    await openGaCenter(acc.page);
    await openPr(acc.page, prepayNo);
    await expect(vis(acc.page, 'pe-prepay-total')).toHaveText('$500');
    await vis(acc.page, 'pe-paid').click();
    await dlg(acc.page).getByTestId('act-method').selectOption('CREDIT_CARD');
    await dlg(acc.page).getByTestId('act-card').fill('1234');
    await dlg(acc.page).getByTestId('act-ref').fill('J1-CC');
    await expectNoOverflow(acc.page, '1.3 標記已付款（信用卡）');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('已付款');
    await expect(vis(acc.page, 'pe-paid-info')).toContainText('卡號末四碼 1234');
    expect(await dbPr(tag('J1-預付'))).toMatchObject({ status: 'PAID', pay_method: 'CREDIT_CARD', pay_card_last4: '1234' });
    expect(real(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  // -------- 1.4 逾期提醒、到貨驗入、登錄憑證連結不顯示
  const clerk2 = await open(browser, 'ga45_clerk');
  let receiptNo = '';
  try {
    await openGaCenter(clerk2.page);
    await navTo(clerk2.page, '採購單');
    await vis(clerk2.page, 'po-search').fill(poNo);
    const card = clerk2.page.locator('[data-testid="po-card"]:visible', { hasText: poNo });
    await expect(card.getByTestId('po-prepaid')).toContainText('已預付 $500');
    await expect(card.getByTestId('po-prepaid')).toContainText('逾期未到貨');
    await navTo(clerk2.page, '請款單');
    await vis(clerk2.page, 'pr-prepay-overdue-toggle').check();
    await expect(clerk2.page.locator('[data-testid="pr-card"]:visible', { hasText: prepayNo })).toHaveCount(1);
    await vis(clerk2.page, 'pr-prepay-overdue-clear').click();
    await openPoDetail(clerk2.page, poNo);
    await dlg(clerk2.page).getByTestId('act-receipt').click();
    const rf = dlg(clerk2.page).getByTestId('receipt-form');
    await expect(rf.getByTestId('rc-adj-note')).toContainText('運費');
    await expect(rf.getByTestId('rc-adj-note')).toContainText('雙十一折價券');
    await expect(rf.getByTestId('rc-prepay-note')).toContainText('500');
    await rf.getByTestId('rc-delivered-0').fill('10');
    await expectNoOverflow(clerk2.page, '1.4 登錄到貨');
    await rf.getByTestId('rc-submit').click();
    await expect(dlg(clerk2.page).getByTestId('pd-notice')).toContainText('到貨已登錄');
    receiptNo = (await dlg(clerk2.page).getByTestId('pd-receipt').first().locator('strong').first().textContent())!.trim();
    await expect(dlg(clerk2.page).getByTestId('pd-receipt-total')).toContainText('$1,100');
    await expect(dlg(clerk2.page).getByTestId('pd-receipt-adj')).toContainText('運費');
    await expect(dlg(clerk2.page).getByTestId('pd-receipt-offset')).toContainText('$500');
    // 預付已核銷 500、已由已付款預付單核銷的進貨單不再顯示「登錄憑證」連結（小錯字）
    await expect(dlg(clerk2.page).getByTestId('reg-voucher-' + receiptNo)).toHaveCount(0);
    await expect(dlg(clerk2.page).getByTestId('pd-prepay-balance')).toHaveText('$0');
    await expect(dlg(clerk2.page).getByTestId('pd-prepay-offset')).toHaveText('$500');
    await expect(dlg(clerk2.page).getByTestId('pd-adj-carry').first()).toContainText(`已併入進貨單 ${receiptNo}`);
    const ledger = await dbLedger(prepayId);
    expect(ledger.filter((g) => !g.reversed_at).map((g) => [g.kind, Number(g.amount)])).toEqual([['OFFSET', 500]]);
    await expectNoOverflow(clerk2.page, '1.4 採購單詳情（到貨後）');
    await dlg(clerk2.page).getByTestId('pd-close').click();
    // -------- 1.5 一般請款：候選清單顯示已核銷，預設只請差額 600
    await navTo(clerk2.page, '請款單');
    await vis(clerk2.page, 'new-pr').click();
    await vis(clerk2.page, 'pe-search').fill(poNo);
    await expect(vis(clerk2.page, 'pe-cand-offset')).toContainText('$500');
    await vis(clerk2.page, 'pe-add-' + receiptNo).click();
    await expect(vis(clerk2.page, 'pe-line-offset')).toContainText('$500');
    await expect(vis(clerk2.page, 'pe-grand')).toContainText('600');
    await vis(clerk2.page, 'pe-notes').fill(tag('J1-差額'));
    await vis(clerk2.page, 'pe-save').click();
    await expect(vis(clerk2.page, 'pe-status')).toHaveText('草稿');
    const diff = await dbPr(tag('J1-差額'));
    expect(Number(diff.amount_total)).toBe(600);
    expect([Number(diff.amount_untaxed), Number(diff.tax_amount)]).toEqual([571, 29]);
    const lines = ((await db().from('ga_payment_request_lines').select('*').eq('pr_id', diff.id)).data || []) as any[];
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].prepay_offset)).toBe(500);
    await expectNoOverflow(clerk2.page, '1.5 一般請款單（扣預付核銷）');
    await confirmAction(clerk2.page, 'pe-submit');
    await expect(vis(clerk2.page, 'pe-status')).toHaveText('已送出');
    expect(real(clerk2.errors)).toEqual([]);
  } finally {
    await clerk2.ctx.close();
  }
  // -------- 1.6 會計用網購平台付款，總務結案採購單
  const acc2 = await open(browser, 'ga45_accountant');
  try {
    await openGaCenter(acc2.page);
    await openPr(acc2.page, (await dbPr(tag('J1-差額'))).pr_no);
    await vis(acc2.page, 'pe-paid').click();
    await dlg(acc2.page).getByTestId('act-method').selectOption('ONLINE_PLATFORM');
    await dlg(acc2.page).getByTestId('act-platform').fill('蝦皮');
    await dlg(acc2.page).getByTestId('act-ref').fill('ORDER-J1');
    await vis(acc2.page, 'act-confirm').click();
    await expect(vis(acc2.page, 'pe-paid-info')).toContainText('平台 蝦皮');
    expect(await dbPr(tag('J1-差額'))).toMatchObject({ status: 'PAID', pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮', pay_card_last4: null });
  } finally {
    await acc2.ctx.close();
  }
  const clerk3 = await open(browser, 'ga45_clerk');
  try {
    await openGaCenter(clerk3.page);
    await openPoDetail(clerk3.page, poNo);
    await poAct(clerk3.page, 'close', '', /已結案/);
    expect((await dbPo(poId)).status).toBe('CLOSED');
    expect(real(clerk3.errors)).toEqual([]);
  } finally {
    await clerk3.ctx.close();
  }
});

test('2. 預付回復：已付款預付單作廢 → 核銷回復；登記退款；預付餘額未清時取消採購單被擋', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機視窗，只在桌機 project 跑一次');
  test.setTimeout(600_000);
  // 採購單 C：預付 600（已付款）→ 到貨 5 個（525）自動核銷 525
  const poC = await apiPo({}, [item(10, 100)]);
  const preC = (await post('ga45_clerk', '/payment-requests/prepay', { po_id: poC.id, amount: 600, notes: tag('J2-C'), idempotency_key: key() })).body.data;
  const subC = (await post('ga45_clerk', `/payment-requests/${preC.id}/actions`, { action: 'submit', expected_updated_at: preC.updated_at, idempotency_key: key() })).body.data;
  await post('ga45_accountant', `/payment-requests/${preC.id}/actions`, { action: 'mark_paid', pay_method: 'TRANSFER', expected_updated_at: subC.updated_at, idempotency_key: key() });
  await apiReceive(poC, 5);
  expect((await dbLedger(preC.id)).filter((g) => !g.reversed_at).map((g) => Number(g.amount))).toEqual([525]);
  // 採購單 D：預付 400（已付款），沒有到貨
  const poD = await apiPo({}, [item(10, 100)]);
  const preD = (await post('ga45_clerk', '/payment-requests/prepay', { po_id: poD.id, amount: 400, notes: tag('J2-D'), idempotency_key: key() })).body.data;
  const subD = (await post('ga45_clerk', `/payment-requests/${preD.id}/actions`, { action: 'submit', expected_updated_at: preD.updated_at, idempotency_key: key() })).body.data;
  await post('ga45_accountant', `/payment-requests/${preD.id}/actions`, { action: 'mark_paid', pay_method: 'TRANSFER', expected_updated_at: subD.updated_at, idempotency_key: key() });
  const clerk = await open(browser, 'ga45_clerk');
  try {
    await openGaCenter(clerk.page);
    // C：作廢預付單（已付款，原因必填）→ 帳本顯示已回復、採購單預付摘要歸零
    await openPr(clerk.page, preC.pr_no);
    await expect(vis(clerk.page, 'pe-prepay-ledger-row')).toHaveCount(1);
    await expect(vis(clerk.page, 'pe-prepay-offset')).toHaveText('$525');
    await vis(clerk.page, 'pe-void-btn').click();
    await vis(clerk.page, 'act-confirm').click();
    await expect(vis(clerk.page, 'act-error')).toContainText('原因');
    await vis(clerk.page, 'act-reason').fill('J2 廠商改單，預付作廢');
    await vis(clerk.page, 'act-confirm').click();
    await expect(vis(clerk.page, 'pe-status')).toHaveText('已作廢');
    await expect(vis(clerk.page, 'pe-prepay-ledger-row').first()).toContainText('已回復');
    const lc = await dbLedger(preC.id);
    expect(lc.every((g) => g.reversed_at)).toBe(true);
    expect(await dbPr(tag('J2-C'))).toMatchObject({ status: 'VOID' });
    await expectNoOverflow(clerk.page, '2.1 預付單作廢後');
    // D：登記退款（原因必填、不超過餘額）
    await openPr(clerk.page, preD.pr_no);
    await expect(vis(clerk.page, 'pe-prepay-balance')).toHaveText('$400');
    await vis(clerk.page, 'pe-prepay-refund-btn').click();
    await vis(clerk.page, 'ref-amount').fill('500');
    await vis(clerk.page, 'ref-reason').fill('J2 超額');
    await vis(clerk.page, 'ref-confirm').click();
    await expect(vis(clerk.page, 'ref-error')).toBeVisible();
    await vis(clerk.page, 'ref-amount').fill('100');
    await vis(clerk.page, 'ref-reason').fill('廠商退回訂金 100');
    await vis(clerk.page, 'ref-confirm').click();
    await expect(vis(clerk.page, 'pe-prepay-refund')).toHaveText('$100');
    await expect(vis(clerk.page, 'pe-prepay-balance')).toHaveText('$300');
    expect(Number((await dbLedger(preD.id)).filter((g) => g.kind === 'REFUND' && !g.reversed_at)[0].amount)).toBe(100);
    // 預付餘額 300 大於尾差：取消採購單被擋，說明要先登記退款或等到貨核銷
    await openPoDetail(clerk.page, poD.po_no);
    await dlg(clerk.page).getByTestId('act-cancel').click();
    await dlg(clerk.page).getByTestId('f-note').fill('J2 想取消');
    await dlg(clerk.page).getByTestId('action-submit').click();
    await expect(dlg(clerk.page).getByTestId('action-error')).toContainText('預付款');
    expect((await dbPo(poD.id)).status).toBe('ORDERED');
    expect(real(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
});

test('3. 同仁代墊採購：選同仁 → 同仁尚未登錄帳戶送出被擋 → 同仁（手機）登錄 → 重抓帳戶送出 → 會計看到帳戶並付款（只能轉帳現金支票）→ 同仁看到已付款；會計不能核付自己的代墊款', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機＋手機視窗，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  const po = await apiPo({}, [item(4, 100)]);
  const rc = await apiReceive(po, 4);
  const clerk = await open(browser, 'ga45_clerk');
  let prNo = '';
  try {
    await openGaCenter(clerk.page);
    await navTo(clerk.page, '請款單');
    await vis(clerk.page, 'new-pr').click();
    await vis(clerk.page, 'pe-search').fill(po.po_no);
    await vis(clerk.page, 'pe-add-' + rc.receipt.receipt_no).click();
    await vis(clerk.page, 'pe-notes').fill(tag('J3-代墊'));
    await vis(clerk.page, 'pe-payee-employee').check();
    await vis(clerk.page, 'pe-payee-search').fill('GAUP nobody');
    const opt = clerk.page.locator('[data-testid="pe-payee-opt"]:visible', { hasText: 'GAUP nobody' });
    await expect(opt).toHaveCount(1);
    await expect(opt).toContainText('尚未登錄匯款帳戶');
    await expectNoOverflow(clerk.page, '3.1 選擇代墊同仁');
    await opt.click();
    await expect(vis(clerk.page, 'pe-payee-picked')).toContainText('GAUP nobody');
    await vis(clerk.page, 'pe-save').click();
    await expect(vis(clerk.page, 'pe-status')).toHaveText('草稿');
    prNo = await prNoOnPage(clerk.page);
    await expect(vis(clerk.page, 'pe-kind-employee')).toBeVisible();
    await expect(vis(clerk.page, 'pe-payee-no-account')).toBeVisible();
    expect(await dbPr(tag('J3-代墊'))).toMatchObject({ payee_type: 'EMPLOYEE', payee_profile_id: users.nobody.id, vendor_id: vendor.id });
    // 送出被擋：同仁還沒登錄匯款帳戶
    await vis(clerk.page, 'pe-submit').click();
    await vis(clerk.page, 'act-confirm').click();
    await expect(vis(clerk.page, 'act-error')).toContainText('匯款帳戶');
    expect((await dbPr(tag('J3-代墊'))).status).toBe('DRAFT');
    await clerk.page.getByRole('button', { name: '取消', exact: true }).locator('visible=true').last().click();
    expect(real(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
  // 同仁（手機 390）登錄匯款帳戶
  const emp = await open(browser, 'nobody', true);
  try {
    await emp.page.goto('/workspace/index.html');
    await emp.page.getByTestId('open-my-reimbursements').click();
    await expect(emp.page.getByTestId('mr-no-account')).toBeVisible();
    await expect(emp.page.getByTestId('mr-empty')).toBeVisible(); // 草稿不顯示
    await emp.page.getByTestId('mr-edit-account').click();
    await emp.page.getByTestId('payout-save').click();
    await expect(emp.page.getByTestId('payout-error')).toBeVisible(); // 欄位必填
    await emp.page.getByTestId('payout-bank').fill('測試銀行');
    await emp.page.getByTestId('payout-account').fill('abc');
    await emp.page.getByTestId('payout-name').fill('測試同仁');
    await emp.page.getByTestId('payout-save').click();
    await expect(emp.page.getByTestId('payout-error')).toContainText('帳號');
    await emp.page.getByTestId('payout-account').fill('123-456-789012');
    await expectNoOverflow(emp.page, '3.2 登錄匯款帳戶（手機）');
    await emp.page.getByTestId('payout-save').click();
    await expect(emp.page.getByTestId('mr-account')).toContainText('9012');
    await expectNoOverflow(emp.page, '3.2 我的代墊款（手機）');
    expect(real(emp.errors)).toEqual([]);
  } finally {
    await emp.ctx.close();
  }
  // 總務重抓同仁帳戶並送出
  const clerk2 = await open(browser, 'ga45_clerk');
  try {
    await openGaCenter(clerk2.page);
    await openPr(clerk2.page, prNo);
    await vis(clerk2.page, 'pe-refresh-bank').click();
    await expect(vis(clerk2.page, 'pe-payee-masked').or(vis(clerk2.page, 'pe-payee-account'))).toBeVisible();
    await confirmAction(clerk2.page, 'pe-submit');
    await expect(vis(clerk2.page, 'pe-status')).toHaveText('已送出');
    expect(real(clerk2.errors)).toEqual([]);
  } finally {
    await clerk2.ctx.close();
  }
  // 會計：看到完整同仁帳戶、付款方式只剩轉帳現金支票
  const acc = await open(browser, 'ga45_accountant');
  try {
    await openGaCenter(acc.page);
    await openPr(acc.page, prNo);
    await expect(vis(acc.page, 'pe-payee-account')).toContainText('123-456-789012');
    await vis(acc.page, 'pe-paid').click();
    expect(await dlg(acc.page).getByTestId('act-method').locator('option').allTextContents()).toEqual(['轉帳', '現金', '支票']);
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('已付款');
    expect(await dbPr(tag('J3-代墊'))).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_by: users.ga45_accountant.id });
    expect(real(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  // 同仁（手機）看到已付款
  const emp2 = await open(browser, 'nobody', true);
  try {
    await emp2.page.goto('/workspace/index.html');
    await emp2.page.getByTestId('open-my-reimbursements').click();
    await expect(emp2.page.getByTestId('mr-row')).toHaveCount(1);
    await expect(emp2.page.getByTestId('mr-row')).toContainText(prNo);
    await expect(emp2.page.getByTestId('mr-row')).toContainText('已付款');
    await expectNoOverflow(emp2.page, '3.3 我的代墊款已付款（手機）');
    expect(real(emp2.errors)).toEqual([]);
  } finally {
    await emp2.ctx.close();
  }
  // SELF_PAYEE：付款對象是會計本人，會計自己標已付款被擋；總務可以付
  await apis.ga45_accountant.put(`${P}/payee-accounts/own`, { data: { bank_name: '測試銀行', bank_account: '999-888-777666', bank_account_name: '會計本人' } });
  const po2 = await apiPo({}, [item(2, 100)]);
  const rc2 = await apiReceive(po2, 2);
  const self = (await post('ga45_clerk', '/payment-requests', { vendor_id: vendor.id, lines: [{ receipt_id: rc2.receipt.id }], payee_type: 'EMPLOYEE', payee_profile_id: users.ga45_accountant.id, notes: tag('J3-自己'), idempotency_key: key() })).body.data;
  await post('ga45_clerk', `/payment-requests/${self.id}/actions`, { action: 'submit', expected_updated_at: self.updated_at, idempotency_key: key() });
  const acc3 = await open(browser, 'ga45_accountant');
  try {
    await openGaCenter(acc3.page);
    await openPr(acc3.page, self.pr_no);
    await vis(acc3.page, 'pe-paid').click();
    await vis(acc3.page, 'act-confirm').click();
    await expect(vis(acc3.page, 'act-error')).toContainText('自己核付自己');
    expect((await dbPr(tag('J3-自己'))).status).toBe('SUBMITTED');
    expect(real(acc3.errors)).toEqual([]);
  } finally {
    await acc3.ctx.close();
  }
});

test('4. 同仁代墊水電：總務選同仁 → 送出（帳單自動標已繳）→ 會計退回（帳單回待繳）→ 再送出 → 會計付款；同仁看到已付款', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機＋手機視窗，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  const own = await apis.payview.put(`${P}/payee-accounts/own`, { data: { bank_name: '測試銀行', bank_account: '555-444-333222', bank_account_name: '水電同仁' } });
  expect(own.status(), await own.text()).toBe(200);
  const st = await stores();
  const payee = await seedPayee('JU');
  const bill = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01', store_id: st.VW001.id, expense_type: 'ELECTRICITY', service_identifier: 'E-JU01', amount: 1200 });
  await addBillAttachment(users.clerk.client, bill.id, users.clerk.id);
  const dbBill = async () => (await db().from('ga_utility_bills').select('*').eq('id', bill.id).single()).data as any;
  const clerk = await open(browser, 'clerk');
  let prNo = '';
  try {
    await openGaCenter(clerk.page);
    await navTo(clerk.page, '請款單');
    await vis(clerk.page, 'new-pr-utility').click();
    await vis(clerk.page, 'pu-month').fill('2038-03');
    await vis(clerk.page, 'pu-vendor').selectOption(payee.id);
    await expect(clerk.page.locator('[data-testid="pu-bill"]:visible')).toHaveCount(1);
    await vis(clerk.page, 'pu-notes').fill(tag('J4-水電代墊'));
    await vis(clerk.page, 'pu-payee-employee').check();
    await vis(clerk.page, 'pu-payee-search').fill('GAUP payview');
    const opt = clerk.page.locator('[data-testid="pu-payee-opt"]:visible', { hasText: 'GAUP payview' });
    await expect(opt).toContainText('已登錄匯款帳戶');
    await opt.click();
    await expectNoOverflow(clerk.page, '4.1 水電請款單選同仁代墊');
    await vis(clerk.page, 'pu-save').click();
    await expect(vis(clerk.page, 'pu-status')).toHaveText('草稿');
    prNo = await prNoOnPage(clerk.page);
    await expect(vis(clerk.page, 'pu-kind-employee')).toBeVisible();
    expect(await dbPr(tag('J4-水電代墊'))).toMatchObject({ source: 'UTILITY', payee_type: 'EMPLOYEE', payee_profile_id: users.payview.id, vendor_id: payee.id });
    await vis(clerk.page, 'pu-refresh-bank').click(); // 抓取同仁已登錄的匯款帳戶快照
    await expect(vis(clerk.page, 'pu-payee-account').or(vis(clerk.page, 'pu-payee-masked'))).toBeVisible();
    await confirmAction(clerk.page, 'pu-submit');
    await expect(vis(clerk.page, 'pu-status')).toHaveText('已送出');
    expect((await dbBill()).paid_at).not.toBeNull(); // 帳單自動標已繳
    expect(real(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
  const acc = await open(browser, 'accountant');
  try {
    await openGaCenter(acc.page);
    await openPr(acc.page, prNo);
    await expect(vis(acc.page, 'pu-payee-name')).toContainText('GAUP payview');
    await expect(vis(acc.page, 'pu-payee-account')).toContainText('555-444-333222');
    await expectNoOverflow(acc.page, '4.2 會計看水電代墊請款單');
    await confirmAction(acc.page, 'pu-return', { reason: 'J4 金額要再確認' });
    await expect(vis(acc.page, 'pu-status')).toHaveText('草稿');
    expect((await dbBill()).paid_at).toBeNull(); // 退回：自動標記的帳單回待繳
  } finally {
    await acc.ctx.close();
  }
  const clerk2 = await open(browser, 'clerk');
  try {
    await openGaCenter(clerk2.page);
    await openPr(clerk2.page, prNo);
    await expect(vis(clerk2.page, 'pu-returned')).toContainText('金額要再確認');
    await expect(vis(clerk2.page, 'pu-payee-employee')).toBeChecked();
    await confirmAction(clerk2.page, 'pu-submit');
    await expect(vis(clerk2.page, 'pu-status')).toHaveText('已送出');
    expect((await dbBill()).paid_at).not.toBeNull();
  } finally {
    await clerk2.ctx.close();
  }
  const acc2 = await open(browser, 'accountant');
  try {
    await openGaCenter(acc2.page);
    await openPr(acc2.page, prNo);
    await vis(acc2.page, 'pu-paid').click();
    expect(await dlg(acc2.page).getByTestId('act-method').locator('option').allTextContents()).toEqual(['轉帳', '現金', '支票']);
    await vis(acc2.page, 'act-confirm').click();
    await expect(vis(acc2.page, 'pu-status')).toHaveText('已付款');
    expect(await dbPr(tag('J4-水電代墊'))).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER' });
    expect(real(acc2.errors)).toEqual([]);
  } finally {
    await acc2.ctx.close();
  }
  const emp = await open(browser, 'payview', true);
  try {
    await emp.page.goto('/workspace/index.html');
    await emp.page.getByTestId('open-my-reimbursements').click();
    await expect(emp.page.getByTestId('mr-row')).toContainText(prNo);
    await expect(emp.page.getByTestId('mr-row')).toContainText('已付款');
    await expectNoOverflow(emp.page, '4.3 水電同仁的我的代墊款（手機）');
    expect(real(emp.errors)).toEqual([]);
  } finally {
    await emp.ctx.close();
  }
});

test('5. 多家抬頭與付款方式：請款設定新增兩家假公司並換預設 → 採購單與請款單各選抬頭 → 信用卡付款 → 列印用所選抬頭 → 公司改名不影響已送出請款單 → 對帳 CSV extended', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機視窗，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  // DEV 還沒有任何公司時才用畫面新增（前面的劇本留下的公司由 cleanup 清掉；這裡先確認乾淨）
  const cx = fakeCompany('J5-X');
  const cy = fakeCompany('J5-Y');
  const clerk = await open(browser, 'ga45_clerk');
  try {
    await openGaCenter(clerk.page);
    await navTo(clerk.page, '請款單');
    await vis(clerk.page, 'pr-settings').click();
    const form = vis(clerk.page, 'pay-settings-form');
    for (const c of [cx, cy]) {
      await form.getByTestId('ps-company-new-name').fill(c.name);
      await form.getByTestId('ps-company-new-tax').fill(c.tax_id);
      await form.getByTestId('ps-company-add').click();
      await expect(form.getByTestId('ps-company').filter({ hasText: c.name })).toHaveCount(1);
    }
    // 統編格式錯誤的提示
    await form.getByTestId('ps-company-new-name').fill('QA-GAIB1 錯誤');
    await form.getByTestId('ps-company-new-tax').fill('123');
    await form.getByTestId('ps-company-add').click();
    await expect(form.getByTestId('ps-company-error')).toContainText('8 碼');
    await form.getByTestId('ps-company-new-name').fill('');
    await form.getByTestId('ps-company-new-tax').fill('');
    await form.getByTestId('ps-company-default-' + cy.tax_id).click();
    await expect(form.getByTestId('ps-company').filter({ hasText: cy.name }).getByTestId('ps-company-default')).toBeVisible();
    await expect(form.getByTestId('ps-title')).toHaveValue(cy.name);
    await expectNoOverflow(clerk.page, '5.1 請款設定（兩家公司）');
    await form.getByTestId('ps-close').click();
    expect(real(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
  const rows = (await apis.ga45_clerk.get(`${P}/buyer-companies`).then((r: any) => r.json())).data as any[];
  const rowX = rows.find((r) => r.tax_id === cx.tax_id);
  const rowY = rows.find((r) => r.tax_id === cy.tax_id);
  // 採購單選抬頭 X（API 建立；畫面在採購單詳情驗證），收貨後在畫面開請款單改選抬頭 Y
  const po = await apiPo({ buyer_company_id: rowX.id }, [item(3, 100)]);
  const rc = await apiReceive(po, 3);
  const clerk2 = await open(browser, 'ga45_clerk');
  let prNo = '';
  try {
    await openGaCenter(clerk2.page);
    await openPoDetail(clerk2.page, po.po_no);
    await expect(dlg(clerk2.page).getByTestId('pd-buyer')).toContainText(cx.name);
    await dlg(clerk2.page).getByTestId('pd-close').click();
    await navTo(clerk2.page, '請款單');
    await vis(clerk2.page, 'new-pr').click();
    await vis(clerk2.page, 'pe-search').fill(po.po_no);
    await vis(clerk2.page, 'pe-add-' + rc.receipt.receipt_no).click();
    await vis(clerk2.page, 'pe-notes').fill(tag('J5-卡'));
    await vis(clerk2.page, 'pe-buyer').selectOption(rowY.id);
    await vis(clerk2.page, 'pe-save').click();
    await expect(vis(clerk2.page, 'pe-status')).toHaveText('草稿');
    prNo = await prNoOnPage(clerk2.page);
    expect((await dbPr(tag('J5-卡'))).buyer_company_id).toBe(rowY.id);
    await confirmAction(clerk2.page, 'pe-submit');
    await expect(vis(clerk2.page, 'pe-status')).toHaveText('已送出');
    const sent = await dbPr(tag('J5-卡'));
    expect([sent.buyer_title_snapshot, sent.buyer_tax_id_snapshot]).toEqual([cy.name, cy.tax_id]); // 送出時凍結抬頭快照
    expect(real(clerk2.errors)).toEqual([]);
  } finally {
    await clerk2.ctx.close();
  }
  const acc = await open(browser, 'ga45_accountant');
  try {
    await openGaCenter(acc.page);
    await openPr(acc.page, prNo);
    await vis(acc.page, 'pe-paid').click();
    await dlg(acc.page).getByTestId('act-method').selectOption('CREDIT_CARD');
    await dlg(acc.page).getByTestId('act-card').fill('4321');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-paid-info')).toContainText('卡號末四碼 4321');
    // 列印頁：抬頭是請款單選的 Y（不是採購單的 X、也不是預設）
    await vis(acc.page, 'pe-print-detail').click();
    await expect(vis(acc.page, 'pp-buyer')).toContainText(cy.name);
    await expect(vis(acc.page, 'pp-buyer-tax')).toContainText(cy.tax_id);
    await expect(vis(acc.page, 'pp-paid')).toContainText('4321');
    await expectNoOverflow(acc.page, '5.2 請款單列印');
    expect(real(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  // 公司改名：已送出請款單仍印原抬頭（快照）；草稿跟隨目前名稱
  const cur = (await apis.ga45_clerk.get(`${P}/buyer-companies`).then((r: any) => r.json())).data.find((r: any) => r.id === rowY.id);
  await post('ga45_clerk', '/buyer-companies', { id: rowY.id, name: `${cy.name}-改名`, expected_updated_at: cur.updated_at, idempotency_key: key() });
  const after = (await apis.ga45_clerk.get(`${P}/payment-requests/${(await dbPr(tag('J5-卡'))).id}`).then((r: any) => r.json())) as any;
  expect(after.buyer.title).toBe(cy.name);
  // 對帳 CSV：預設欄位不動；extended=1 多類型、付款對象類型、付款對象、抬頭、信用卡末四碼、平台
  const month = ymd(0).slice(0, 7);
  const plain = await (await apis.ga45_accountant.get(`${P}/payment-requests/export?month=${month}`)).text();
  const ext = await (await apis.ga45_accountant.get(`${P}/payment-requests/export?month=${month}&extended=1`)).text();
  const head = (t: string) => t.replace(/^﻿/, '').split(/\r?\n/)[0];
  expect(head(plain)).not.toContain('信用卡末四碼');
  expect(head(ext)).toContain('信用卡末四碼');
  expect(head(ext)).toContain('抬頭');
  expect(head(ext)).toContain('付款對象類型');
  expect(ext).toContain('4321');
  expect(ext).toContain(cy.name);
});
