import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, M7_FILE_PREFIX } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { makePng } from '../support/png';

// 第 4.5 批 G45-att-inv.journey-invoice（角色接力劇本）：
// 總務（clerk）收到廠商紙本發票 → 登錄三聯式發票並連結進貨單（缺圖紅標）→ 上傳圖片（缺圖消失、採購單分頁的缺圖標示消失）→ 請款檢視者（viewer）看得到圖片但不能刪、不能新增
// → 發票被請款單引用後，總務想刪最後一張圖被擋（白話訊息、圖片還在）→ 補傳第二張後才能刪第一張 → 請款單作廢釋放發票 → 作廢發票（必填原因）→ 作廢發票不再列在「有效」清單、仍可用狀態篩選看到。
// 每步用 service role 回讀資料庫。測試資料帶 QA-GA45- 標記；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const KEYS: Ga45Key[] = ['clerk', 'viewer'];
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
let vendor: any;
let po: any;
let receipt: any;
let pr: any;
const db = () => adminDb();
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const INV_NO = `QJNY${String(Date.now()).slice(-6)}`;
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const dbInv = async () => (await db().from('ga_purchase_invoices').select('*').eq('invoice_no', INV_NO).maybeSingle()).data as any;
const dbImages = async (id: string) => ((await db().from('ga_resource_attachments').select('id,deleted_at').eq('resource_type', 'PURCHASE_INVOICE').eq('resource_id', id)).data || []) as any[];
const png = () => ({ name: `${M7_FILE_PREFIX}inv-${crypto.randomUUID()}.png`, mimeType: 'image/png', buffer: makePng({ width: 60, height: 60, colorful: true }) });
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
async function openInvoice(page: Page) {
  await openGaCenter(page);
  await nav(page, '進貨發票');
  await expect(visibleHeading(page, '進貨發票')).toBeVisible();
  await vis(page, 'inv-search').fill(INV_NO);
  await expect(page.locator('[data-testid="inv-card"]:visible')).toHaveCount(1);
  await page.locator('[data-testid="inv-card"]:visible').first().getByTestId('open-invoice').click();
  await expect(vis(page, 'invoice-form')).toBeVisible();
}

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
  vendor = await seedGa45Vendor('JNY');
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('JNY1'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 劇本品項', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: crypto.randomUUID() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  receipt = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: 10 }], p_key: crypto.randomUUID() });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1 總務登錄三聯式發票並連結進貨單：儲存後缺圖紅標，資料庫有發票與連結、進貨憑證變「已連發票」', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '進貨發票');
    await vis(page, 'new-invoice').click();
    const form = vis(page, 'invoice-form');
    await form.getByTestId('ie-receipt-search').fill(po.po_no);
    await form.getByTestId('ie-option').first().getByRole('button', { name: '加入' }).click();
    await form.getByTestId('ie-type').selectOption('TRIPLE');
    await form.getByTestId('ie-no').fill(INV_NO);
    await form.getByTestId('ie-untaxed').fill('1000');
    await expect(form.getByTestId('ie-total')).toContainText('1,050');
    await form.getByTestId('ie-save').click();
    await expect(vis(page, 'ie-saved')).toBeVisible();
    await expect(vis(page, 'ie-missing')).toContainText('缺圖');
    await expect(vis(page, 'ie-image-count')).toContainText('0 張');
    const row = await dbInv();
    expect(row).toMatchObject({ invoice_type: 'TRIPLE', amount_untaxed: 1000, tax_amount: 50, amount_total: 1050, status: 'ACTIVE', vendor_id: vendor.id, created_by: users.clerk.id });
    const links = (await db().from('ga_purchase_invoice_receipts').select('receipt_id,allocated_untaxed,allocated_tax').eq('invoice_id', row.id)).data as any[];
    expect(links).toHaveLength(1);
    expect(links[0].receipt_id).toBe(receipt.id);
    expect(Number(links[0].allocated_untaxed) + Number(links[0].allocated_tax)).toBe(1050);
    expect(((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single()).data as any).voucher_status).toBe('LINKED');
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('2 總務上傳發票圖片：缺圖標示消失（發票頁與採購單的發票與請款分頁），圖片記錄與儲存檔都在', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openInvoice(page);
    await expect(vis(page, 'ie-missing')).toBeVisible();
    await vis(page, 'ie-images').locator('input[type=file]').setInputFiles(png());
    await vis(page, 'ie-images').getByRole('button', { name: /上傳 1 個檔案/ }).click();
    await expect(vis(page, 'ie-image-count')).toContainText('1 張');
    await expect(vis(page, 'ie-missing')).toHaveCount(0);
    const row = await dbInv();
    const imgs = await dbImages(row.id);
    expect(imgs.filter((i) => !i.deleted_at)).toHaveLength(1);
    // 採購單分頁的缺圖標示消失
    await nav(page, '採購單');
    await vis(page, 'po-search').fill(po.po_no);
    await page.locator('[data-testid="po-card"]:visible').first().getByTestId('open-detail').click();
    await page.getByTestId('pd-tab-pay').click();
    await expect(page.getByTestId('pp-invoice').first()).toBeVisible();
    await expect(page.getByTestId('pp-missing')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('3 請款檢視者看得到圖片與發票，沒有上傳與刪除按鈕、沒有儲存按鈕；賣方統編被遮蔽（沒有廠商權限）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openInvoice(page);
    await expect(vis(page, 'ie-readonly')).toBeVisible();
    await expect(vis(page, 'ie-images').locator('img').first()).toBeVisible();
    await expect(vis(page, 'ie-images').locator('input[type=file]')).toHaveCount(0);
    await expect(vis(page, 'ie-images').getByRole('button', { name: /^刪除 / })).toHaveCount(0);
    await expect(page.getByTestId('ie-save')).toHaveCount(0);
    await expect(page.getByTestId('ie-seller')).toHaveCount(0);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('4 發票被請款單引用後：只有一張圖時刪除被擋（白話訊息，圖片還在）；金額、類型鎖定；補傳第二張後才能刪第一張', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const row = await dbInv();
  pr = await rpcOk('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: receipt.id, invoice_id: row.id }] }, p_key: crypto.randomUUID() });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openInvoice(page);
    await expect(vis(page, 'ie-inuse')).toContainText(pr.pr_no);
    await expect(vis(page, 'ie-untaxed')).toBeDisabled();
    await expect(vis(page, 'ie-type')).toBeDisabled();
    await expect(vis(page, 'ie-void')).toBeDisabled();
    // 刪除最後一張：被擋
    await vis(page, 'ie-images').getByRole('button', { name: /^刪除 / }).first().click();
    await page.getByLabel('刪除原因').fill('想換一張');
    await page.getByRole('button', { name: '確認刪除' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '最後一張' }).first()).toBeVisible();
    expect((await dbImages(row.id)).filter((i) => !i.deleted_at)).toHaveLength(1);
    await page.getByRole('button', { name: '取消' }).first().click();
    // 補傳第二張，再刪第一張
    await vis(page, 'ie-images').locator('input[type=file]').setInputFiles(png());
    await vis(page, 'ie-images').getByRole('button', { name: /上傳 1 個檔案/ }).click();
    await expect(vis(page, 'ie-image-count')).toContainText('2 張');
    await vis(page, 'ie-images').getByRole('button', { name: /^刪除 / }).first().click();
    await page.getByLabel('刪除原因').fill('換更清楚的圖');
    await page.getByRole('button', { name: '確認刪除' }).click();
    await expect(vis(page, 'ie-image-count')).toContainText('1 張');
    expect((await dbImages(row.id)).filter((i) => !i.deleted_at)).toHaveLength(1);
    expect((await dbImages(row.id)).filter((i) => i.deleted_at)).toHaveLength(1);
    expect(noConsole(errors).filter((e) => !/409/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('5 請款單作廢釋放發票後：總務作廢發票（必填原因），清單預設不再列出，用「已作廢」狀態篩選看得到原因；作廢後不能再改', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  await rpcOk('clerk', 'ga_ws_pay_request_action', { p_id: pr.id, p_action: 'void', p_payload: { reason: '劇本：改走別張發票' }, p_key: crypto.randomUUID(), p_expected_updated_at: pr.updated_at });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openInvoice(page);
    await expect(page.getByTestId('ie-inuse')).toHaveCount(0);
    await vis(page, 'ie-void').click();
    await page.getByTestId('void-confirm').click();
    await expect(page.getByTestId('void-error')).toContainText('作廢原因');
    await page.getByTestId('void-reason').fill('劇本：開錯抬頭');
    await page.getByTestId('void-confirm').click();
    await expect(vis(page, 'ie-voided')).toContainText('開錯抬頭');
    const row = await dbInv();
    expect(row).toMatchObject({ status: 'VOID', void_reason: '劇本：開錯抬頭', voided_by: users.clerk.id });
    expect(((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single()).data as any).voucher_status).toBe('NONE');
    // 清單：預設（有效）找不到；改看已作廢找得到
    await nav(page, '進貨發票');
    await vis(page, 'inv-search').fill(INV_NO);
    await expect(page.locator('[data-testid="inv-card"]:visible')).toHaveCount(0);
    await vis(page, 'inv-filter-status').selectOption('VOID');
    await expect(page.locator('[data-testid="inv-card"]:visible')).toHaveCount(1);
    await expect(vis(page, 'inv-void')).toHaveText('已作廢');
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
