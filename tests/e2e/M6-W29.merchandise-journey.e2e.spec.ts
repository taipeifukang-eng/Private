import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Products, cleanupM6Stockout, productCode, runIdOrThrow, setupM6Users, stockoutCode, type M6User } from '../support/m6-fixtures';
import { addDays, taipeiDate } from '../../lib/stockout/response';

/**
 * M6 第二批 W29：商品部缺貨回報多角色劇本（桌機 1440、手機 390 各跑一次）。
 * 角色：so_plain（沒有缺貨權限，沒有入口）、so_store_a（店長，管轄 VW001）、so_responder（商品部，只有回覆權限）。
 * 劇本：店長用商品搜尋（80ms、舊請求不覆蓋新結果、選定後帶名稱單位並聚焦數量）送出缺貨回報 -> 近 7 天重複回報要確認
 *   -> 商品部看到待回覆並回覆 -> 店長看到已回覆（回覆預設展開）-> 店長再回報同商品，看到商品部回覆提醒 -> 店長刪除回報（confirm 文字）
 *   -> 最後一筆刪除，目前回覆被清掉、歷程保留。
 * 資料：商品主檔 ZT2038-<runId>-… 與缺貨回報用同一前綴，只刪自己的。
 */
const db = adminDb();
const today = () => taipeiDate(new Date());
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Stockout();
  await cleanupM6Products();
  ({ users, teardown } = await setupM6Users(['so_store_a', 'so_responder', 'so_plain']));
});
test.afterAll(async () => {
  await cleanupM6Stockout();
  await cleanupM6Products();
  const left = await teardown();
  expect(left).toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  const api = await apiForUser(users[who]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator('.workspace-menu button.catalog-item[title="商品部"]');
async function openMerchandise(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: '商品部管理', exact: true })).toBeVisible();
  await expect(page.locator('.merchandise-page').getByText('載入中…')).toHaveCount(0);
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const root = (page: Page) => page.locator('.merchandise-page');
const group = (page: Page, code: string) => page.locator(`.merchandise-page .group[data-product="${code}"]`);
const searchBox = (page: Page) => page.getByPlaceholder('搜尋商品編號 / 品名');
const stat = (page: Page, name: string) => page.locator(`.merchandise-page [data-stat=${name}]`);
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
const reportCount = async (code: string) => ((await db.from('stockout_reports').select('id').eq('product_code', code)).data || []).length;

test('無權限者沒有入口；店長回報、商品部回覆、店長再回報看到提醒、刪除結案', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const code = stockoutCode(`${tag}-MAIN`);
  const e1 = stockoutCode(`${tag}-E1`);
  const e12 = stockoutCode(`${tag}-E12`);
  expect((await db.from('products_master').insert([
    { product_code: code, product_name: `缺貨劇本商品${tag}`, unit: '瓶', is_active: true },
    { product_code: e1, product_name: '搜尋競爭甲', unit: '盒', is_active: true },
    { product_code: e12, product_name: '搜尋競爭乙', unit: '條', is_active: true },
    { product_code: productCode(`${tag}-OFF`), product_name: '停用商品不出現', unit: '', is_active: false },
  ])).error).toBeNull();

  // ---- 無權限者：選單沒有「商品部」，直接打 API 也被擋
  {
    const ctx = await ctxFor(browser, 'so_plain');
    const page = await ctx.newPage();
    try {
      await openMenu(page);
      await expect(page.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
      await expect(menuItem(page), 'so_plain 不應看到商品部').toHaveCount(0);
      expect((await ctx.request.get('/api/workspace/stockout')).status()).toBe(403);
      expect(await page.locator('.workspace-menu').innerText()).not.toContain('併購');
    } finally {
      await ctx.close();
    }
  }

  // ---- 店長：搜尋、帶入、送出、重複提示
  const problems: string[] = [];
  const managerCtx = await ctxFor(browser, 'so_store_a');
  const manager = await managerCtx.newPage();
  watch(manager, problems);
  try {
    await openMerchandise(manager);
    await expect(root(manager)).toContainText('缺貨商品管理');
    // 只有提交權限：沒有「全部門市／我的門市」分頁切換，也沒有回覆按鈕
    await expect(manager.getByRole('button', { name: '全部門市' })).toHaveCount(0);
    await manager.getByRole('button', { name: '新增缺貨回報' }).click();
    const dialog = manager.getByRole('dialog', { name: '新增缺貨回報' });
    const codeInput = dialog.getByLabel('商品編號');

    // 搜尋：舊請求不覆蓋新結果（第一個請求被延遲，較新的請求先回來）
    let seen = 0;
    await manager.route('**/api/workspace/products-master/search*', async (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') || '';
      seen += 1;
      if (q === e1) await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await codeInput.fill(e1);
    await manager.waitForTimeout(160); // 80ms debounce 後第一個（被延遲的）請求已送出
    await codeInput.fill(e12);
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await manager.waitForTimeout(1200); // 舊請求此時才回來，不得覆蓋
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await expect(dialog.getByRole('option')).toContainText(e12);
    expect(seen).toBeGreaterThanOrEqual(2);
    await manager.unroute('**/api/workspace/products-master/search*');

    // 輸入編號前綴：只出現啟用商品；停用的不會出現
    await codeInput.fill(stockoutCode(`${tag}-`));
    await expect(dialog.getByRole('option')).toHaveCount(3);
    await expect(dialog).not.toContainText('停用商品不出現');
    // 選定：帶入名稱（唯讀）與單位，並聚焦需求數量
    await codeInput.fill(code);
    await dialog.getByRole('option', { name: new RegExp(code) }).click();
    await expect(dialog.getByLabel('商品名稱')).toHaveValue(`缺貨劇本商品${tag}`);
    await expect(dialog.getByLabel('商品名稱')).toHaveAttribute('readonly', '');
    await expect(dialog.locator('[data-unit]')).toHaveText('瓶');
    await expect(dialog.getByLabel('需求數量')).toBeFocused();
    await dialog.getByLabel('需求數量').fill('5');
    await dialog.getByRole('button', { name: '送出回報' }).click();
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    await expect(root(manager).locator('.notice').filter({ hasText: `已送出缺貨回報「${code}」` })).toBeVisible();
    const g = group(manager, code);
    await expect(g).toBeVisible();
    await expect(g.locator('[data-status]')).toHaveText('待回覆');
    expect(await reportCount(code)).toBe(1);
    const row = (await db.from('stockout_reports').select('*').eq('product_code', code).single()).data;
    expect(row).toMatchObject({ required_qty: 5, reported_by: users.so_store_a.id, status: 'pending' });

    // 近 7 天重複回報：提示後確認才送出
    await manager.getByRole('button', { name: '新增缺貨回報' }).click();
    await dialog.getByLabel('商品編號').fill(code);
    await dialog.getByRole('option', { name: new RegExp(code) }).click();
    await dialog.getByLabel('需求數量').fill('2');
    await dialog.getByRole('button', { name: '送出回報' }).click();
    const warn = dialog.locator('[data-duplicate]');
    await expect(warn).toContainText('7 天內已回報過');
    expect(await reportCount(code)).toBe(1);
    await dialog.getByRole('button', { name: '取消' }).click();
    const discard = manager.getByRole('dialog', { name: '放棄未儲存內容？' });
    if (await discard.count()) await discard.getByRole('button', { name: '放棄' }).click();
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    expect(await reportCount(code)).toBe(1);
    if (mobile) expect(await noOverflow(manager), '手機店長清單不橫向溢出').toBe(true);
  } finally {
    // 店長頁面稍後還要用，這裡不關
  }

  // ---- 商品部：看到待回覆，回覆
  const staffCtx = await ctxFor(browser, 'so_responder');
  const staff = await staffCtx.newPage();
  watch(staff, problems);
  try {
    await openMerchandise(staff);
    await expect(staff.getByRole('button', { name: '全部門市' })).toBeVisible(); // 預設分頁是全部門市
    await searchBox(staff).fill(code);
    await expect(group(staff, code)).toBeVisible();
    await expect(group(staff, code).locator('[data-status]')).toHaveText('待回覆');
    await expect(stat(staff, 'pending')).toHaveText('1');
    await expect(stat(staff, 'responded')).toHaveText('0');
    // 回覆：必填檢查
    await group(staff, code).getByRole('button', { name: '回覆', exact: true }).click();
    const reply = staff.getByRole('dialog', { name: '回覆缺貨商品' });
    await expect(reply).toContainText('共 1 間門市回報，合計需求 5 件');
    await reply.getByRole('button', { name: '送出回覆' }).click();
    await expect(reply.getByRole('alert')).toContainText('回覆內容不得為空');
    await reply.getByLabel(/回覆內容/).fill('廠商缺貨，預計下週到貨');
    await reply.getByRole('button', { name: '送出回覆' }).click();
    await expect(reply.getByRole('alert')).toContainText('請填寫預計到貨日');
    await reply.getByLabel('預計到貨日').fill(addDays(today(), 3));
    await reply.getByRole('button', { name: '送出回覆' }).click();
    await expect(staff.getByRole('dialog')).toHaveCount(0);
    // 回覆後切到「已回覆」，看得到
    await expect(group(staff, code).locator('[data-status]')).toHaveText('已回覆');
    await expect(stat(staff, 'responded')).toHaveText('1');
    await expect(stat(staff, 'pending')).toHaveText('0');
    await group(staff, code).locator('.head-main').click();
    await expect(group(staff, code).locator('[data-reply]')).toContainText('廠商缺貨，預計下週到貨');
    await expect(group(staff, code).locator('[data-reply]')).toContainText(`預計到貨日：${addDays(today(), 3)}`);
    // 再次編輯回覆 -> 歷程出現更早的一筆
    await group(staff, code).getByRole('button', { name: '編輯回覆' }).click();
    await staff.getByRole('dialog', { name: '編輯回覆' }).getByLabel(/回覆內容/).fill('改為下週三到貨');
    await staff.getByRole('dialog', { name: '編輯回覆' }).getByRole('button', { name: '更新回覆' }).click();
    await expect(staff.getByRole('dialog')).toHaveCount(0);
    await expect(group(staff, code).locator('[data-reply]')).toContainText('改為下週三到貨');
    await group(staff, code).getByRole('button', { name: '展開回覆歷程' }).click();
    await expect(group(staff, code).locator('.history')).toContainText('廠商缺貨，預計下週到貨');
    // 商品部沒有任何「刪除回覆」按鈕（舊版也沒有）
    await expect(group(staff, code).getByRole('button', { name: /刪除回覆/ })).toHaveCount(0);
    const resp = (await db.from('stockout_product_responses').select('*').eq('product_code', code)).data!;
    expect(resp).toHaveLength(1);
    expect((await db.from('stockout_product_response_history').select('id').eq('product_code', code)).data).toHaveLength(2);
    // 注意：DEV 資料庫有舊版就有的觸發器（回覆寫入時把同商品 pending 回報改成 responded），所以資料欄位會被資料庫改寫；
    // 新版 API 不依賴也不寫這個欄位，畫面狀態一律由目前有效回覆即時算出（C3）。
    if (mobile) expect(await noOverflow(staff), '手機商品部清單不橫向溢出').toBe(true);
  } finally {
    await staffCtx.close();
  }

  // ---- 店長：看到已回覆（預設展開），再回報同商品看到提醒，刪除結案
  try {
    await manager.reload({ waitUntil: 'networkidle' });
    await openMerchandise(manager);
    await manager.getByRole('button', { name: '全部', exact: true }).click();
    await searchBox(manager).fill(code);
    const g = group(manager, code);
    await expect(g.locator('[data-status]')).toHaveText('已回覆');
    await expect(g.locator('[data-reply]')).toContainText('改為下週三到貨'); // 店長視角：已回覆預設展開
    await expect(g.getByRole('button', { name: '編輯回覆' })).toHaveCount(0); // 沒有回覆權限，沒有回覆按鈕
    await expect(g.getByRole('button', { name: '回覆', exact: true })).toHaveCount(0);

    await manager.getByRole('button', { name: '新增缺貨回報' }).click();
    const dialog = manager.getByRole('dialog', { name: '新增缺貨回報' });
    await dialog.getByLabel('商品編號').fill(code);
    await dialog.getByRole('option', { name: new RegExp(code) }).click();
    const alert = manager.getByRole('dialog', { name: '商品部回覆提醒' });
    await expect(alert).toContainText(`此商品預計到貨日為: ${addDays(today(), 3)}`);
    await expect(alert).toContainText('改為下週三到貨');
    await alert.getByRole('button', { name: '我知道了' }).click();
    await expect(dialog.getByLabel('需求數量')).toBeFocused(); // 關閉提醒後回到需求數量
    await expect(dialog.locator('[data-existing]')).toContainText('此商品已有商品部回覆');
    await dialog.getByLabel('需求數量').fill('3');
    await dialog.getByRole('button', { name: '送出回報' }).click();
    await dialog.locator('[data-duplicate]').getByRole('button', { name: '仍要送出' }).click(); // 7 天內同門市同商品，確認後仍送出
    await expect(manager.getByRole('dialog')).toHaveCount(0);
    expect(await reportCount(code)).toBe(2);
    const latest = (await db.from('stockout_reports').select('status,required_qty').eq('product_code', code).order('created_at', { ascending: false }).limit(1).single()).data;
    expect(latest).toMatchObject({ required_qty: 3, status: 'responded' }); // 回報時已有有效回覆

    // 刪除：confirm 文字，取消不刪，確定才刪
    await manager.getByRole('button', { name: '全部', exact: true }).click();
    await searchBox(manager).fill(code);
    await expect(group(manager, code).getByText('門市回報明細')).toBeVisible();
    const del = group(manager, code).getByRole('button', { name: /刪除 .* 的回報/ });
    await expect(del).toHaveCount(2);
    await del.first().click();
    const confirmDialog = manager.getByRole('dialog', { name: '刪除回報' });
    await expect(confirmDialog).toContainText('確定刪除這筆回報？');
    await confirmDialog.getByRole('button', { name: '取消' }).click();
    expect(await reportCount(code)).toBe(2);
    await del.first().click();
    await confirmDialog.getByRole('button', { name: '確定刪除' }).click();
    await expect(root(manager).locator('.notice').filter({ hasText: '已刪除這筆回報' })).toBeVisible();
    expect(await reportCount(code)).toBe(1);
    expect((await db.from('stockout_product_responses').select('id').eq('product_code', code)).data).toHaveLength(1); // 還有回報，回覆保留
    await expect(group(manager, code).getByText('門市回報明細')).toBeVisible(); // 重新載入後群組維持展開
    const lastDel = group(manager, code).getByRole('button', { name: /刪除 .* 的回報/ });
    await expect(lastDel).toHaveCount(1);
    await lastDel.click();
    await confirmDialog.getByRole('button', { name: '確定刪除' }).click();
    await expect(group(manager, code)).toHaveCount(0);
    expect(await reportCount(code)).toBe(0);
    // 結案：最後一筆刪除，商品部目前回覆被清掉，歷程保留
    expect((await db.from('stockout_product_responses').select('id').eq('product_code', code)).data).toHaveLength(0);
    expect((await db.from('stockout_product_response_history').select('id').eq('product_code', code)).data).toHaveLength(2);
    await expect(root(manager)).toContainText('目前沒有任何缺貨回報');
    expect(await root(manager).innerText()).not.toContain('併購');
    if (mobile) expect(await noOverflow(manager), '手機結案後不橫向溢出').toBe(true);
    expect(problems, `console／頁面錯誤：${problems.join(' | ')}`).toEqual([]);
  } finally {
    await managerCtx.close();
  }
});
