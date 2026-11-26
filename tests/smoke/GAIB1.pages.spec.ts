import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { openGaCenter, pageForUser } from '../support/g01-ui';
import { assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { cleanupGaib1, fakeCompany, seedGaib1Vendor } from '../support/gaib1-fixtures';
import { dlg, expectNoOverflow, heading, navTo, real, vis } from '../support/gaib1-ui';

// ga-improve-b1 畫面冒煙（桌機 1440 與手機 390 由 project 決定；最後一個桌機測試再用 1920×1080 看一遍）：
//   採購單編輯（含稅切換、調整列、買受人抬頭、即時合計）、採購單清單與詳情（調整列、預付摘要、已預付標籤）、請款單列表（類型與付款對象篩選、預付與代墊標籤）、
//   預付請款單頁（預付摘要、核銷帳、登記退款）、同仁代墊請款單頁（匯款帳戶遮蔽與顯示）、請款設定（買受人公司清單）、請款單列印（抬頭、預付款、付款對象）、我的代墊款（頂端工具列）。
//   每一頁都檢查：無 pageerror／console 錯誤、整頁無水平溢出、內層容器無橫向溢出。
// 帳號：DEV 真實角色 vue_workspace_ga45_*（總務、會計、檢視者、無廠商權限）與只有登入權的臨時帳號；資料標記 QA-GAIB1-，結束只清自己的。
const P = '/api/workspace/general-affairs';
const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'novendor', 'nobody'];
const key = () => crypto.randomUUID();
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let vendor: any;
let companyA: any;
let companyB: any;
let po1: any; // 含稅、運費＋折價券、預付 500 已付款（信用卡）、逾期未到貨
let po1No = '';
let prepay: any;
let draftPo: any; // 含稅草稿
let req: any; // 同仁代墊的一般請款單（已送出）
const ymd = (offsetDays: number) => new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);

async function post(who: string, path: string, data: unknown) {
  const r = await apis[who].post(`${P}${path}`, { data });
  expect(r.status(), `${path}: ${await r.text()}`).toBeLessThan(300);
  return (await r.json()) as any;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(400_000);
  await assertGaBaseline();
  const left = await cleanupGaib1();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGaib1Vendor('SM');
  const a = fakeCompany('SM-甲');
  const b = fakeCompany('SM-乙');
  await post('clerk', '/buyer-companies', { ...a, idempotency_key: key() });
  const rows = (await post('clerk', '/buyer-companies', { ...b, idempotency_key: key() })).data as any[];
  companyA = rows.find((r) => r.tax_id === a.tax_id);
  companyB = rows.find((r) => r.tax_id === b.tax_id);
  const note = (t: string) => `[自動測試]M7M8 GAIB1-SM ${t}`;
  const mkPo = async (header: Record<string, unknown>, items: unknown[], place: boolean) => {
    const c = (await post('clerk', '/purchase-orders', { header: { vendor_id: vendor.id, notes: note('po'), ...header }, items, idempotency_key: key() })).data;
    if (!place) return c;
    return (await post('clerk', `/purchase-orders/${c.id}/actions`, { action: 'place_order', expected_updated_at: c.updated_at })).data;
  };
  const item = (qty: number, price: number) => ({ item_name: 'QA-GAIB1 冒煙品項', unit: '個', quantity: qty, unit_price: price, fulfil_mode: 'NO_STOCK' });
  // PO1：含稅 10×105＋運費 100＋折價券 −50＝1,100，抬頭選乙，預計到貨日在過去（逾期）
  po1 = await mkPo(
    { price_mode: 'INCL', buyer_company_id: companyB.id, expected_delivery_date: ymd(-3), adjustments: [{ kind: 'FREIGHT', amount: 100 }, { kind: 'COUPON', label: '雙十一折價券', amount: -50, campaign_name: '雙十一', original_price: 1200 }] },
    [item(10, 105)],
    true,
  );
  po1No = po1.po_no;
  const pre = (await post('clerk', '/payment-requests/prepay', { po_id: po1.id, amount: 500, notes: '冒煙預付', idempotency_key: key() })).data;
  const sub = (await post('clerk', `/payment-requests/${pre.id}/actions`, { action: 'submit', expected_updated_at: pre.updated_at, idempotency_key: key() })).data;
  prepay = (await post('accountant', `/payment-requests/${pre.id}/actions`, { action: 'mark_paid', pay_method: 'CREDIT_CARD', card_last4: '1234', paid_ref: 'CC-SM', expected_updated_at: sub.updated_at, idempotency_key: key() })).data;
  draftPo = await mkPo({ price_mode: 'INCL', adjustments: [{ kind: 'DISCOUNT', amount: -20 }] }, [item(2, 105)], false);
  // 同仁（nobody）登錄匯款帳戶；PO2 收貨後開一般請款單，付款對象選同仁並送出
  const own = await apis.nobody.put(`${P}/payee-accounts/own`, { data: { bank_name: '測試銀行', bank_branch: '測試分行', bank_account: '123-456-789012', bank_account_name: '測試同仁' } });
  expect(own.status(), await own.text()).toBe(200);
  const po2 = await mkPo({}, [item(4, 100)], true);
  const rc = await post('clerk', `/purchase-orders/${po2.id}/receipts`, { header: {}, lines: [{ po_item_id: po2.items[0].id, delivered_qty: 4, accepted_qty: 4 }], idempotency_key: key() });
  const receiptId = (rc.receiving.receipts as any[])[0].id;
  const draft = (await post('clerk', '/payment-requests', { vendor_id: vendor.id, lines: [{ receipt_id: receiptId }], payee_type: 'EMPLOYEE', payee_profile_id: users.nobody.id, buyer_company_id: companyA.id, idempotency_key: key() })).data;
  req = (await post('clerk', `/payment-requests/${draft.id}/actions`, { action: 'submit', expected_updated_at: draft.updated_at, idempotency_key: key() })).data;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function openPoDetail(page: any, no: string) {
  await navTo(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dlg(page).getByTestId('po-detail')).toBeVisible();
}
async function openPr(page: any, prNo: string) {
  await navTo(page, '請款單');
  await expect(heading(page, '請款單')).toBeVisible();
  await vis(page, 'pr-search').fill(prNo);
  const card = page.locator('[data-testid="pr-card"]:visible', { hasText: prNo });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-pr').click();
}

test('採購單編輯：含稅切換、調整列即時合計、買受人抬頭；草稿載入含稅單價；已下訂鎖定；無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await navTo(page, '採購單');
    await vis(page, 'new-po').click();
    await expect(heading(page, '新增採購單')).toBeVisible();
    const form = page.getByTestId('po-form').locator('visible=true');
    await expect(form.getByTestId('pe-price-mode')).toHaveValue('EXCL');
    await form.getByTestId('pe-mode-free-0').check();
    await form.getByTestId('pe-name-0').fill('QA-GAIB1 試算');
    await form.getByTestId('pe-qty-0').fill('10');
    await form.getByTestId('pe-price-0').fill('100');
    // 未稅：1,000＋稅 50＝1,050
    await expect(form.getByTestId('pe-subtotal')).toHaveText('$1,000');
    await expect(form.getByTestId('pe-total')).toHaveText('$1,050');
    // 調整列：運費 +100、折價券 −50（輸入正數）→ 未稅 1,050、稅 53（52.5 進位）、含稅 1,103
    await form.getByTestId('pe-adj-add-FREIGHT').click();
    await form.getByTestId('pe-adj-amount-0').fill('100');
    await form.getByTestId('pe-adj-add-COUPON').click();
    await form.getByTestId('pe-adj-amount-1').fill('50');
    await expect(form.getByTestId('pe-adj-sign-1')).toContainText('−');
    await expect(form.getByTestId('pe-subtotal')).toHaveText('$1,050');
    await expect(form.getByTestId('pe-total')).toHaveText('$1,103');
    // 切成含稅：輸入合計就是含稅總額 1,000＋100−50＝1,050，未稅 1,000，稅額用減的 50
    await form.getByTestId('pe-price-mode').selectOption('INCL');
    await expect(form.getByTestId('pe-price-mode-hint')).toContainText('切換後單價的意義會改變');
    await expect(form.getByText('單價（含稅）')).toBeVisible();
    await expect(form.getByTestId('pe-total')).toHaveText('$1,050');
    await expect(form.getByTestId('pe-subtotal')).toHaveText('$1,000');
    await expect(form.getByTestId('pe-tax')).toHaveText('$50');
    // 折扣超過品項金額：總額不能為負
    await form.getByTestId('pe-adj-amount-1').fill('5000');
    await expect(form.getByTestId('pe-total-error')).toBeVisible();
    await form.getByTestId('pe-adj-amount-1').fill('50');
    await expect(form.getByTestId('pe-total-error')).toHaveCount(0);
    // 買受人抬頭下拉有兩家假公司，預設公司（甲）顯示在「沿用預設」選項
    await expect(form.getByTestId('pe-buyer').locator('option')).toHaveCount(3);
    await expect(form.getByTestId('pe-buyer')).toContainText(companyA.name);
    await expect(form.getByTestId('pe-buyer')).toContainText(companyB.name);
    await expectNoOverflow(page, '採購單新增');
    // 草稿採購單載入：含稅單價顯示輸入的含稅單價，調整列帶出
    await page.getByTestId('back-list').locator('visible=true').click();
    await navTo(page, '採購單');
    await vis(page, 'po-search').fill(draftPo.po_no);
    await page.locator('[data-testid="po-card"]:visible', { hasText: draftPo.po_no }).getByTestId('open-detail').click();
    await dlg(page).getByTestId('act-edit').click();
    const f2 = page.getByTestId('po-form').locator('visible=true');
    await expect(f2.getByTestId('pe-price-mode')).toHaveValue('INCL');
    await expect(f2.getByTestId('pe-price-0')).toHaveValue('105');
    await expect(f2.getByTestId('pe-adj-amount-0')).toHaveValue('20');
    await expect(f2.getByTestId('pe-total')).toHaveText('$190');
    await expectNoOverflow(page, '採購單編輯草稿');
    // 已下訂：計價方式、調整列鎖定
    await page.getByTestId('back-list').locator('visible=true').click();
    await openPoDetail(page, po1No);
    await dlg(page).getByTestId('act-edit').click();
    const f3 = page.getByTestId('po-form').locator('visible=true');
    await expect(f3.getByTestId('pe-notes-only')).toHaveCount(0); // 提示在表單外
    await expect(page.getByTestId('pe-notes-only').locator('visible=true')).toBeVisible();
    await expect(f3.getByTestId('pe-price-mode')).toBeDisabled();
    await expect(f3.getByTestId('pe-adj-amount-0')).toBeDisabled();
    await expect(f3.getByTestId('pe-buyer')).toBeDisabled();
    await expectNoOverflow(page, '採購單編輯已下訂');
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('採購單清單與詳情：已預付標籤與篩選；詳情有計價方式、買受人抬頭、調整列、預付摘要、新增預付請款；無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await navTo(page, '採購單');
    await vis(page, 'po-search').fill(po1No);
    const card = page.locator('[data-testid="po-card"]:visible', { hasText: po1No });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('po-prepaid')).toContainText('已預付 $500');
    await expect(card.getByTestId('po-prepaid')).toContainText('逾期未到貨');
    await vis(page, 'po-search').fill('');
    await vis(page, 'po-filter-prepaid').check();
    await expect(page.locator('[data-testid="po-card"]:visible', { hasText: po1No })).toHaveCount(1);
    await expect(page.locator('[data-testid="po-card"]:visible', { hasText: draftPo.po_no })).toHaveCount(0);
    await expectNoOverflow(page, '採購單清單');
    await vis(page, 'po-filter-prepaid').uncheck();
    await openPoDetail(page, po1No);
    const d = dlg(page);
    await expect(d.getByTestId('pd-price-mode')).toHaveText('單價含稅');
    await expect(d.getByTestId('pd-buyer')).toContainText(companyB.name);
    await expect(d.getByTestId('pd-total')).toContainText('$1,100');
    await expect(d.getByTestId('pd-adj')).toHaveCount(2);
    await expect(d.getByTestId('pd-adj-amount').first()).toHaveText('+$100');
    await expect(d.getByTestId('pd-adj-amount').nth(1)).toHaveText('−$50');
    await expect(d.getByTestId('pd-adj-carry').first()).toContainText('尚未併入進貨單');
    await expect(d.getByTestId('pd-prepaid')).toHaveText('$500');
    await expect(d.getByTestId('pd-prepay-balance')).toHaveText('$500');
    await expect(d.getByTestId('pd-prepay-overdue')).toContainText('超過預計到貨日');
    await expect(d.getByTestId('act-prepay')).toBeVisible();
    await expectNoOverflow(page, '採購單詳情');
    // 新增預付請款對話框
    await d.getByTestId('act-prepay').click();
    const pf = page.getByTestId('prepay-form');
    await expect(pf).toBeVisible();
    await pf.getByTestId('prepay-amount').fill('300');
    await expect(pf.getByTestId('prepay-split')).toContainText('未稅 $286');
    await pf.getByTestId('prepay-payee-employee').check();
    await expect(pf.getByTestId('prepay-payee-search')).toBeVisible();
    await expectNoOverflow(page, '新增預付請款');
    await pf.getByTestId('prepay-cancel').click();
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('請款單列表：類型與付款對象篩選、預付與同仁代墊標籤、逾期預付篩選；請款設定的買受人公司清單；無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await navTo(page, '請款單');
    await expect(heading(page, '請款單')).toBeVisible();
    await vis(page, 'pr-filter-kind').selectOption('PREPAY');
    const pcard = page.locator('[data-testid="pr-card"]:visible', { hasText: prepay.pr_no });
    await expect(pcard).toHaveCount(1);
    await expect(pcard.getByTestId('pr-kind')).toHaveText('預付款');
    await expect(pcard.getByTestId('pr-prepay-info')).toContainText('預付餘額 $500');
    await expect(pcard.getByTestId('pr-prepay-info')).toContainText('逾期未到貨');
    await expect(page.locator('[data-testid="pr-card"]:visible', { hasText: req.pr_no })).toHaveCount(0);
    await expectNoOverflow(page, '請款單列表（預付）');
    await vis(page, 'pr-filter-kind').selectOption('');
    await vis(page, 'pr-filter-payee').selectOption('EMPLOYEE');
    const ecard = page.locator('[data-testid="pr-card"]:visible', { hasText: req.pr_no });
    await expect(ecard).toHaveCount(1);
    await expect(ecard.getByTestId('pr-payee-kind')).toHaveText('同仁代墊');
    await expect(ecard.getByTestId('pr-payee')).toContainText('M7M8 GA45 nobody');
    await vis(page, 'pr-filter-payee').selectOption('');
    await vis(page, 'pr-prepay-overdue-toggle').check();
    await expect(page.locator('[data-testid="pr-card"]:visible', { hasText: prepay.pr_no })).toHaveCount(1);
    await expect(vis(page, 'pr-prepay-overdue-chip')).toBeVisible();
    await vis(page, 'pr-prepay-overdue-clear').click();
    // 請款設定：買受人公司清單（兩家假公司，甲為預設）
    await vis(page, 'pr-settings').click();
    const form = vis(page, 'pay-settings-form');
    await expect(form).toBeVisible();
    // DEV 裡可能還有其他測試留下的已停用公司，只數本測試建立的兩家
    await expect(form.getByTestId('ps-company').filter({ hasText: /-C-SM-/ })).toHaveCount(2);
    await expect(form.getByTestId('ps-company-default')).toHaveCount(1);
    await expect(form.getByTestId('ps-company').filter({ hasText: companyA.name }).getByTestId('ps-company-default')).toBeVisible();
    await expect(form.getByTestId('ps-title')).toHaveValue(companyA.name);
    await expect(form.getByTestId('ps-tax')).toHaveValue(companyA.tax_id);
    await expectNoOverflow(page, '請款設定');
    await form.getByTestId('ps-close').click();
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('預付請款單頁：預付摘要、核銷帳、已付款資訊（信用卡末四碼）、登記退款；列印頁有預付款標題與所選抬頭；無錯誤、無溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await openPr(page, prepay.pr_no);
    await expect(vis(page, 'pe-kind')).toHaveText('預付款');
    await expect(vis(page, 'pe-prepay-po')).toHaveText(po1No);
    await expect(vis(page, 'pe-prepay-total')).toHaveText('$500');
    await expect(vis(page, 'pe-prepay-balance')).toHaveText('$500');
    await expect(vis(page, 'pe-prepay-overdue')).toBeVisible();
    await expect(vis(page, 'pe-paid-info')).toContainText('信用卡');
    await expect(vis(page, 'pe-paid-info')).toContainText('1234');
    await expect(vis(page, 'pe-buyer-text')).toContainText(companyB.name);
    await expectNoOverflow(page, '預付請款單');
    // 登記退款：金額、原因必填、不能超過餘額
    await vis(page, 'pe-prepay-refund-btn').click();
    await vis(page, 'ref-confirm').click();
    await expect(vis(page, 'ref-error')).toBeVisible();
    await vis(page, 'ref-amount').fill('9999');
    await vis(page, 'ref-reason').fill('冒煙：超額');
    await vis(page, 'ref-confirm').click();
    await expect(vis(page, 'ref-error')).toContainText(/餘額|超過/);
    await expectNoOverflow(page, '登記退款');
    await page.getByRole('button', { name: '取消', exact: true }).locator('visible=true').last().click();
    // 列印頁
    await vis(page, 'pe-print').click();
    await expect(vis(page, 'pp-sheet')).toBeVisible();
    await expect(vis(page, 'pp-prepay-title')).toBeVisible();
    await expect(vis(page, 'pp-buyer')).toContainText(companyB.name);
    await expect(vis(page, 'pp-buyer-tax')).toContainText(companyB.tax_id);
    await expect(vis(page, 'pp-prepay-po')).toHaveText(po1No);
    await expect(vis(page, 'pp-paid')).toContainText('1234');
    await expectNoOverflow(page, '預付請款單列印');
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('同仁代墊請款單頁：會計看得到完整匯款帳戶；沒有廠商帳務檢視權限者只看到末四碼；列印頁抬頭用所選公司；無錯誤、無溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  for (const who of ['accountant', 'novendor'] as const) {
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await openGaCenter(page);
      await openPr(page, req.pr_no);
      await expect(vis(page, 'pe-kind-employee')).toBeVisible();
      await expect(vis(page, 'pe-payee-name')).toContainText('M7M8 GA45 nobody');
      if (who === 'accountant') {
        await expect(vis(page, 'pe-payee-account')).toContainText('123-456-789012');
        await expect(vis(page, 'pe-payee-register')).toBeVisible();
      } else {
        await expect(vis(page, 'pe-payee-masked')).toContainText('9012');
        await expect(page.getByText('123-456-789012')).toHaveCount(0);
        await expect(vis(page, 'pe-payee-register')).toHaveCount(0);
      }
      await expect(vis(page, 'pe-buyer-text')).toContainText(companyA.name);
      await expectNoOverflow(page, `同仁代墊請款單（${who}）`);
      if (who === 'accountant') {
        // 標記已付款：同仁代墊只能選轉帳、現金、支票；選信用卡類不會出現
        await vis(page, 'pe-paid').click();
        const opts = await dlg(page).getByTestId('act-method').locator('option').allTextContents();
        expect(opts).toEqual(['轉帳', '現金', '支票']);
        await expect(dlg(page).getByTestId('act-employee-hint')).toBeVisible();
        await expectNoOverflow(page, '標記已付款（同仁代墊）');
        await dlg(page).getByRole('button', { name: '取消', exact: true }).click();
        await vis(page, 'pe-print').click();
        await expect(vis(page, 'pp-payee')).toContainText('M7M8 GA45 nobody');
        await expect(vis(page, 'pp-payee-account')).toContainText('123-456-789012');
        await expect(vis(page, 'pp-buyer')).toContainText(companyA.name);
        await expect(vis(page, 'pp-bank')).toHaveCount(0);
        await expectNoOverflow(page, '同仁代墊請款單列印');
      }
      expect(real(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('我的代墊款（頂端工具列，任何登入者）：匯款帳戶只露末四碼、只看到自己已送出的代墊請款單；無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.nobody, testInfo);
  try {
    await page.goto('/workspace/index.html');
    await page.getByTestId('open-my-reimbursements').click();
    const d = page.getByTestId('my-reimbursements');
    await expect(d).toBeVisible();
    await expect(d.getByTestId('mr-account')).toContainText('9012');
    await expect(d.getByTestId('mr-row')).toHaveCount(1);
    await expect(d.getByTestId('mr-row')).toContainText(req.pr_no);
    await expect(d.getByTestId('mr-row')).toContainText('已送出');
    await expect(d.getByText('123-456-789012')).toHaveCount(0);
    await expectNoOverflow(page, '我的代墊款');
    await d.getByTestId('mr-edit-account').click();
    await expect(page.getByTestId('payout-form')).toBeVisible();
    await expect(page.getByTestId('payout-account')).toHaveValue('123-456-789012'); // 本人看得到自己的完整帳戶
    await expectNoOverflow(page, '編輯我的匯款帳戶');
    await page.getByTestId('payout-cancel').click();
    await d.getByTestId('mr-close').click();
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('桌機 1920×1080：採購單、請款單、預付請款單、同仁代墊請款單、請款設定都沒有水平溢出', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '1920×1080 只在桌機 project 補跑一次');
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGaCenter(page);
    await openPoDetail(page, po1No);
    await expectNoOverflow(page, '1920 採購單詳情');
    await dlg(page).getByTestId('pd-close').click();
    await openPr(page, prepay.pr_no);
    await expect(vis(page, 'pe-prepay')).toBeVisible();
    await expectNoOverflow(page, '1920 預付請款單');
    await openPr(page, req.pr_no);
    await expect(vis(page, 'pe-payee-box')).toBeVisible();
    await expectNoOverflow(page, '1920 同仁代墊請款單');
    await navTo(page, '請款單');
    await vis(page, 'pr-settings').click();
    await expect(vis(page, 'pay-settings-form')).toBeVisible();
    await expectNoOverflow(page, '1920 請款設定');
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
