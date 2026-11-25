import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-att-inv 冒煙層（桌機 1440 與手機 390 由 project viewport 決定）：進貨發票清單、新增與編輯頁、採購單「發票與請款」分頁與登錄憑證、廠商頁銀行欄位。
// 金額自動算與手改、差異原因（尾差 5 元內免）、缺圖紅標、錯誤白話、搜尋與分頁、無權限不顯示入口與金額（含管理員身分無角色）、無 pageerror／console 錯誤、無水平溢出。
// 帳號：vue_workspace_ga45_clerk（請款管理）、vue_workspace_ga45_viewer（請款檢視、無廠商權限）、vue_workspace_ga_purchaser（無請款權限）、無權限與管理員身分無角色。
const KEYS: Ga45Key[] = ['clerk', 'viewer', 'purchaser', 'nobody', 'admin', 'vendor_mgr'];
const INV = '/api/workspace/general-affairs/purchase-invoices';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let vendor: any;
let po: any;
let receipt: any;
let invoice: any;
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGa45Vendor('SMK');
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('SMK1'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 冒煙品項', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: crypto.randomUUID() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  receipt = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: 10 }], p_key: crypto.randomUUID() });
  // 一張缺圖的三聯式發票（連結這張進貨單）
  const r = await apis.clerk.post(INV, { data: { invoice_type: 'TRIPLE', invoice_no: `QSMK${String(Date.now()).slice(-6)}`, invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: [{ receipt_id: receipt.id }], idempotency_key: crypto.randomUUID() } });
  expect(r.status(), await r.text()).toBe(201);
  invoice = (await r.json()).data;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('請款管理（總務採購）：側欄有「進貨發票」；清單可開、缺圖紅標與搜尋；新增發票表單金額自動算、手改稅額、類型切換；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toContain('進貨發票');
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(INV) && calls.push(String(r.status())));
    await nav(page, '進貨發票');
    await expect(visibleHeading(page, '進貨發票')).toBeVisible();
    await expect(page.getByTestId('new-invoice').locator('visible=true')).toBeVisible();
    await page.getByTestId('inv-search').locator('visible=true').fill(invoice.invoice_no);
    await expect(page.locator('[data-testid="inv-card"]:visible')).toHaveCount(1);
    await expect(page.getByTestId('inv-total').locator('visible=true')).toHaveText('共 1 張');
    await expect(page.getByTestId('inv-missing').locator('visible=true')).toHaveText('缺圖');
    await expect(page.getByTestId('inv-amount').locator('visible=true')).toContainText('1,050');
    expect(await noPageOverflow(page)).toBe(true);
    // 搜尋特殊字元：% 當一般字元，找不到
    await page.getByTestId('inv-search').locator('visible=true').fill('%');
    await expect(page.getByText('找不到符合的發票').locator('visible=true')).toBeVisible();
    await page.getByTestId('inv-search').locator('visible=true').fill('');
    // 只看缺圖篩選
    await page.getByTestId('inv-filter-missing').locator('visible=true').check();
    await expect.poll(() => calls.length).toBeGreaterThan(2);
    await page.getByTestId('inv-filter-missing').locator('visible=true').uncheck();
    // 開啟既有發票：缺圖紅字、金額欄位唯讀以外可改、圖片面板在
    await page.getByTestId('inv-search').locator('visible=true').fill(invoice.invoice_no);
    await page.locator('[data-testid="inv-card"]:visible').first().getByTestId('open-invoice').click();
    await expect(page.getByTestId('ie-missing').locator('visible=true')).toContainText('缺圖');
    await expect(page.getByTestId('ie-images').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('ie-link').locator('visible=true')).toHaveCount(1);
    await expect(page.getByTestId('ie-total').locator('visible=true')).toContainText('1,050');
    expect(await noPageOverflow(page)).toBe(true);
    // 新增發票
    await nav(page, '進貨發票');
    await page.getByTestId('new-invoice').locator('visible=true').click();
    await expect(visibleHeading(page, '新增發票')).toBeVisible();
    const form = page.getByTestId('invoice-form').locator('visible=true');
    await expect(form).toBeVisible();
    await form.getByTestId('ie-untaxed').fill('1000');
    await expect(form.getByTestId('ie-tax')).toHaveValue('50');
    await expect(form.getByTestId('ie-total')).toContainText('1,050');
    await form.getByTestId('ie-tax').fill('53');
    await expect(form.getByTestId('ie-total')).toContainText('1,053');
    await form.getByTestId('ie-untaxed').fill('2000');
    await expect(form.getByTestId('ie-tax')).toHaveValue('53'); // 手改過的稅額保留
    // 換成收據：金額欄位換成含稅金額，稅額 0
    await form.getByTestId('ie-type').selectOption('RECEIPT');
    await expect(form.getByTestId('ie-total-input')).toBeVisible();
    await expect(form.getByTestId('ie-noimg-reason')).toBeVisible();
    await form.getByTestId('ie-total-input').fill('500');
    await expect(form.getByTestId('ie-total')).toContainText('500');
    // 未來日期：白話提示
    await form.getByTestId('ie-type').selectOption('E_INVOICE');
    await form.getByTestId('ie-date').fill('2999-01-01');
    await expect(form.getByTestId('ie-date-future')).toContainText('不能是未來');
    // 沒填號碼直接儲存：白話錯誤，沒有寫入
    await form.getByTestId('ie-date').fill(today());
    await form.getByTestId('ie-save').click();
    await expect(page.getByTestId('ie-error').locator('visible=true')).toContainText('發票號碼');
    expect(await noPageOverflow(page)).toBe(true);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('新增發票：連結進貨單後差異超過尾差要填原因、5 元內免；儲存後缺圖紅標；作廢需要原因', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '進貨發票');
    await page.getByTestId('new-invoice').locator('visible=true').click();
    const form = page.getByTestId('invoice-form').locator('visible=true');
    await expect(form).toBeVisible();
    // 連結進貨單（搜尋採購單號）
    await form.getByTestId('ie-receipt-search').fill(po.po_no);
    await expect(form.getByTestId('ie-option').first()).toBeVisible();
    await form.getByTestId('ie-option').first().getByRole('button', { name: '加入' }).click();
    await expect(form.getByTestId('ie-link')).toHaveCount(1);
    await expect(form.getByTestId('ie-vendor-name')).toContainText(vendor.name);
    await form.getByTestId('ie-type').selectOption('E_INVOICE');
    await form.getByTestId('ie-no').fill(`QSM2${String(Date.now()).slice(-6)}`);
    await form.getByTestId('ie-untaxed').fill('1000'); // 含稅 1050，與進貨一致
    await expect(form.getByTestId('ie-diff-reason')).toHaveCount(0);
    await form.getByTestId('ie-tax').fill('55'); // 含稅 1055，差 5 元：尾差免原因
    await expect(form.getByTestId('ie-diff-reason')).toHaveCount(0);
    await expect(form.getByTestId('ie-tail')).toContainText('尾差');
    await form.getByTestId('ie-tax').fill('56'); // 差 6 元：要原因
    await expect(form.getByTestId('ie-diff-reason')).toBeVisible();
    await form.getByTestId('ie-diff-reason').fill('廠商加收小額運費');
    await form.getByTestId('ie-save').click();
    await expect(page.getByTestId('ie-saved').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('ie-missing').locator('visible=true')).toContainText('缺圖');
    await expect(page.getByTestId('ie-warning').locator('visible=true').first()).toBeVisible();
    // 作廢：沒有原因擋下，填了才作廢
    await page.getByTestId('ie-void').locator('visible=true').click();
    await page.getByTestId('void-confirm').click();
    await expect(page.getByTestId('void-error')).toContainText('作廢原因');
    await page.getByTestId('void-reason').fill('測試作廢');
    await page.getByTestId('void-confirm').click();
    await expect(page.getByTestId('ie-voided').locator('visible=true')).toContainText('測試作廢');
    await expect(page.getByTestId('ie-save')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('採購單詳情「發票與請款」分頁：請款管理者看得到金額與登錄憑證；請款檢視者看得到金額沒有登錄憑證與新增發票；沒有請款權限的採購人員沒有分頁', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const open = async (key: string) => {
    const made = await pageForUser(browser, states[key], testInfo);
    await openGaCenter(made.page);
    await nav(made.page, '採購單');
    await made.page.getByTestId('po-search').locator('visible=true').fill(po.po_no);
    await expect(made.page.locator('[data-testid="po-card"]:visible')).toHaveCount(1);
    await made.page.locator('[data-testid="po-card"]:visible').first().getByTestId('open-detail').click();
    await expect(made.page.getByTestId('po-detail')).toBeVisible();
    return made;
  };
  let m = await open('clerk');
  try {
    await expect(m.page.getByTestId('pd-tab-pay')).toBeVisible();
    // ga-improve-b1 小錯字：這張進貨單已連結發票，採購單詳情的進貨紀錄不再顯示「登錄憑證」連結（原本斷言為可見，隨規格更新；未連結的進貨單仍顯示，見下方 rc2 的案例）
    await expect(m.page.getByTestId('reg-voucher-' + receipt.receipt_no)).toHaveCount(0);
    await m.page.getByTestId('pd-tab-pay').click();
    await expect(m.page.getByTestId('pp-received')).toContainText('1,050');
    await expect(m.page.getByTestId('pp-claimed')).toContainText('0');
    await expect(m.page.getByTestId('pp-claimable')).toContainText('1,050');
    await expect(m.page.getByTestId('pp-new-invoice')).toBeVisible();
    // 這張進貨已連發票（缺圖）：顯示發票與缺圖紅標、沒有「登錄憑證」按鈕
    await expect(m.page.getByTestId('pp-invoice').first()).toBeVisible();
    await expect(m.page.getByTestId('pp-missing').first()).toHaveText('缺圖');
    await expect(m.page.getByTestId('pp-voucher').first()).toHaveText('已連發票');
    await expect(m.page.getByTestId('pp-voucher-' + receipt.receipt_no)).toHaveCount(0);
    expect(await noPageOverflow(m.page)).toBe(true);
    expect(m.errors).toEqual([]);
  } finally {
    await m.ctx.close();
  }
  m = await open('viewer');
  try {
    await m.page.getByTestId('pd-tab-pay').click();
    await expect(m.page.getByTestId('pp-received')).toContainText('1,050');
    await expect(m.page.getByTestId('pp-new-invoice')).toHaveCount(0);
    await expect(m.page.locator('[data-testid^="pp-voucher-"]')).toHaveCount(0);
    await expect(m.page.getByTestId('reg-voucher-' + receipt.receipt_no)).toHaveCount(0);
    expect(m.errors).toEqual([]);
  } finally {
    await m.ctx.close();
  }
  m = await open('purchaser');
  try {
    await expect(m.page.getByTestId('pd-tab-pay')).toHaveCount(0);
    await expect(m.page.getByTestId('po-payment-panel')).toHaveCount(0);
    await expect(m.page.getByTestId('pp-received')).toHaveCount(0);
    expect(m.errors).toEqual([]);
  } finally {
    await m.ctx.close();
  }
});

test('登錄憑證：沒有發票的進貨登錄「免開發票」要填原因，登錄後分頁顯示狀態與原因；可改回尚未登錄', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('SMK3'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 憑證品項', unit: '個', quantity: 3, unit_price: 100 }], p_create_key: crypto.randomUUID() });
  const po2 = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const rc2 = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po2.id, p_header: {}, p_lines: [{ po_item_id: po2.items[0].id, delivered_qty: 3 }], p_key: crypto.randomUUID() });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '採購單');
    await page.getByTestId('po-search').locator('visible=true').fill(po2.po_no);
    await page.locator('[data-testid="po-card"]:visible').first().getByTestId('open-detail').click();
    await expect(page.getByTestId('po-detail')).toBeVisible();
    await page.getByTestId('reg-voucher-' + rc2.receipt_no).click();
    await expect(page.getByTestId('v-note')).toBeVisible();
    await page.getByTestId('v-save').click();
    await expect(page.getByTestId('v-error')).toContainText('原因');
    await page.getByTestId('v-note').fill('對方只給送貨單');
    await page.getByTestId('v-save').click();
    await expect(page.getByTestId('pp-notice')).toContainText('已登錄');
    await expect(page.getByTestId('pp-voucher').first()).toHaveText('免開發票／僅收據');
    await expect(page.getByText('說明：對方只給送貨單')).toBeVisible();
    // 改回尚未登錄
    await page.getByTestId('pp-voucher-' + rc2.receipt_no).click();
    await page.getByTestId('v-none').check();
    await page.getByTestId('v-save').click();
    await expect(page.getByTestId('pp-voucher').first()).toHaveText('尚未登錄');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有請款權限：採購人員、無權限、管理員身分（無角色）側欄沒有「進貨發票」，API 403；請款檢視者看得到清單但沒有新增按鈕', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const key of ['purchaser', 'nobody', 'admin']) {
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page).catch(() => undefined);
      const labels = await sideLabels(page).catch(() => [] as string[]);
      expect(labels, key).not.toContain('進貨發票');
      const r = await page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, INV);
      expect(r, key).toBe(403);
      expect(errors.filter((e) => !/403/.test(e)), key).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
  const { ctx, page, errors } = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toContain('進貨發票');
    await nav(page, '進貨發票');
    await expect(visibleHeading(page, '進貨發票')).toBeVisible();
    await expect(page.getByTestId('new-invoice')).toHaveCount(0);
    await expect(page.locator('[data-testid="inv-card"]:visible').first()).toBeVisible();
    await page.locator('[data-testid="inv-card"]:visible').first().getByTestId('open-invoice').click();
    await expect(page.getByTestId('ie-readonly').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('ie-save')).toHaveCount(0);
    await expect(page.getByTestId('ie-seller')).toHaveCount(0); // 沒有廠商權限：賣方統編欄位不出現
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('廠商頁銀行欄位：廠商管理者在表單填銀行名稱、分行、帳號、戶名，儲存後詳情看得到；沒有帳務權限者看不到', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const v = await seedGa45Vendor('SMKBK', { bank_name: null, bank_branch: null, bank_account: null, bank_account_name: null });
  const { ctx, page, errors } = await pageForUser(browser, states.vendor_mgr, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '廠商資料');
    await expect(visibleHeading(page, '廠商資料')).toBeVisible();
    await page.getByTestId('vendor-search').locator('visible=true').fill(v.name);
    await expect(page.locator('[data-testid="vendor-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="vendor-card"]:visible').first().getByTestId('open-detail').click();
    await expect(page.getByTestId('vd-bank-name').locator('visible=true')).toHaveText('—');
    await page.getByTestId('vd-edit').locator('visible=true').click();
    const form = page.getByTestId('vendor-form').locator('visible=true');
    await expect(form).toBeVisible();
    await form.locator('[data-testid^="vf-step-"]').last().click();
    await form.getByTestId('vf-bank-name').fill('測試商業銀行');
    await form.getByTestId('vf-bank-branch').fill('信義分行');
    await form.getByTestId('vf-bank-account').fill('012345678901');
    await form.getByTestId('vf-bank-account-name').fill(v.name);
    await form.getByTestId('vf-save').click();
    await expect(page.getByTestId('vendor-saved').locator('visible=true')).toBeVisible();
    await page.locator('[data-testid="vendor-card"]:visible').first().getByTestId('open-detail').click();
    await expect(page.getByTestId('vd-bank-name').locator('visible=true')).toHaveText('測試商業銀行');
    await expect(page.getByTestId('vd-bank-account').locator('visible=true')).toHaveText('012345678901');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 請款檢視者沒有廠商權限：廠商頁沒有入口、API 403，銀行資料不外露
  const viewer = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openGaCenter(viewer.page);
    expect(await sideLabels(viewer.page)).not.toContain('廠商資料');
    const body = await viewer.page.evaluate(async (id) => { const r = await fetch('/api/workspace/general-affairs/vendors/' + id, { credentials: 'same-origin' }); return { status: r.status, text: await r.text() }; }, v.id);
    expect(body.status).toBe(403);
    expect(body.text).not.toContain('012345678901');
  } finally {
    await viewer.ctx.close();
  }
});
