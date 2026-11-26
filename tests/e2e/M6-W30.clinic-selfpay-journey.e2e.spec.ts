import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser, cleanupM6Clinic, clinicFileName, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { batchesOf, db, itemsOf, objectExists, pricesOf, screenshotPaths } from '../support/clinic-api';
import { clinicFixture, TINY_PNG } from '../support/clinic-selfpay-fixtures';

/**
 * M6 第三批 3a W30 診所自費藥毛利：多角色劇本（桌機 1440、手機 390 各跑一次）。自造測試檔（真實樣本尚未提供）。
 * 角色：cs_none（沒有任何診所權限，沒有選單、API 403）、cs_title_mgr（區經理：匯入價格主檔、關帳開帳、刪批次）、
 *   cs_calc_a（店長，綁 VW001：匯入診所檔與截圖，貼上與多選，D3、D2、D4）、cs_calc_b（另一間店，看不到 VW001）。
 * 劇本：無權限者沒有入口 -> 區經理匯入 VW001 價格檔、看歷史價格、關帳再開帳 -> 店長匯入診所檔（D3 取消再確認、D2 未匹配擋下、主檔成功含貼上與多選截圖、D4 重複確認）
 *   -> 看明細（成本與毛利可見）-> 別間店店長看不到 -> 區經理刪批次，截圖物件一併消失 -> 店長看不到刪除按鈕。
 * 診所請款明細 PDF 與截圖回看視窗（W31）不在本劇本內。
 */
const db_ = db();
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const f = (tag: string) => clinicFileName(tag);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const xlsx = (fixture: string, tag: string) => ({ name: f(tag), mimeType: XLSX_MIME, buffer: clinicFixture(fixture) });
const png = (n: number) => ({ name: `e2e-shot-${n}.png`, mimeType: 'image/png', buffer: Buffer.concat([TINY_PNG, Buffer.from(`-${n}`)]) });

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Clinic();
  ({ users, teardown } = await setupM6Users(['cs_none', 'cs_title_mgr', 'cs_calc_a', 'cs_calc_b']));
  sid = await testStoreIds();
});
test.afterAll(async () => {
  const r = await cleanupM6Clinic(db_, Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left).toEqual([]);
  expect(r.leftoverObjects, '桶內不應留下測試截圖').toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  const api = await apiForUser(users[who]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
const MENU = '診所自費藥毛利計算';
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator(`.workspace-menu button.catalog-item[title="${MENU}"]`);
const root = (page: Page) => page.locator('[data-testid=clinic-selfpay]');
const tid = (page: Page, id: string) => root(page).locator(`[data-testid=${id}]`);
async function openPage(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: MENU, exact: true })).toBeVisible();
  await expect(tid(page, 'store-select')).toBeVisible();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
const setMonth = async (page: Page, ym: string) => { await tid(page, 'month-input').fill(ym); };
/** 模擬 Ctrl+V 貼上一張圖片（剪貼簿內是一個 png 檔）。 */
async function pasteImage(page: Page, bytes: number[]) {
  await page.evaluate((arr) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(arr)], 'clip.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
  }, bytes);
}

test('無權限者沒有入口；區經理匯入價格主檔與關帳；店長匯入診所檔（D3、D2、D4）、看成本毛利；別店看不到；區經理刪批次並清掉截圖', async ({ browser }, testInfo) => {
  test.setTimeout(480_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const problems: string[] = [];

  // ---- 無權限者：選單沒有入口，API 403
  {
    const ctx = await ctxFor(browser, 'cs_none');
    const page = await ctx.newPage();
    try {
      await openMenu(page);
      await expect(page.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
      await expect(menuItem(page), 'cs_none 不應看到診所自費藥毛利計算').toHaveCount(0);
      expect((await ctx.request.get('/api/workspace/clinic-selfpay/batches')).status()).toBe(403);
      expect((await ctx.request.get('/api/workspace/clinic-selfpay/stores')).status()).toBe(403);
    } finally {
      await ctx.close();
    }
  }

  // ---- 區經理：價格主檔
  const mgrCtx = await ctxFor(browser, 'cs_title_mgr');
  const mgr = await mgrCtx.newPage();
  watch(mgr, problems);
  try {
    await openPage(mgr);
    await expect(tid(mgr, 'tab-calc')).toBeVisible();
    await expect(tid(mgr, 'tab-mapping')).toBeVisible();
    await tid(mgr, 'store-select').selectOption(sid.VW001);
    await setMonth(mgr, '2038-11');
    await tid(mgr, 'tab-mapping').click();
    await expect(tid(mgr, 'no-mappings')).toBeVisible();
    await tid(mgr, 'price-file').setInputFiles(xlsx('price-multi-month.xlsx', 'e2e-price'));
    await expect(tid(mgr, 'price-message')).toContainText('月價匯入成功：7 筆');
    await expect(tid(mgr, 'price-message')).toContainText('2038-10、2038-11');
    await expect(tid(mgr, 'price-message')).toContainText('1 筆重複健保碼');
    await expect(tid(mgr, 'mapping-row')).toHaveCount(4);
    expect((await pricesOf(sid.VW001, '2038-11')).length).toBe(4);
    if (mobile) expect(await noOverflow(mgr), '手機主檔分頁不橫向溢出').toBe(true);
    // 歷史價格
    await tid(mgr, 'mapping-row').first().click();
    await expect(mgr.getByRole('dialog', { name: '歷史會員價與成本' })).toBeVisible();
    await expect(mgr.locator('[data-testid=history-row]')).toHaveCount(2); // 2038-11 與 2038-10
    await mgr.getByRole('button', { name: '關閉', exact: true }).click();
    // 關帳 -> 開帳
    await expect(tid(mgr, 'closed-badge')).toContainText('2038-11 未關帳');
    await tid(mgr, 'close-btn').click();
    await mgr.getByRole('dialog', { name: '關帳主檔' }).locator('[data-testid=close-confirm]').click();
    await expect(tid(mgr, 'closed-badge')).toContainText('2038-11 已關帳');
    await tid(mgr, 'close-btn').click();
    await mgr.getByRole('dialog', { name: '開帳主檔' }).locator('[data-testid=close-confirm]').click();
    await expect(tid(mgr, 'closed-badge')).toContainText('2038-11 未關帳');
  } finally {
    // 區經理頁籤保持開啟，最後用來刪批次
  }

  // ---- 店長（綁 VW001）
  const smCtx = await ctxFor(browser, 'cs_calc_a');
  const sm = await smCtx.newPage();
  watch(sm, problems);
  try {
    await openPage(sm);
    await expect(tid(sm, 'tab-mapping'), '店長沒有主檔管理分頁').toHaveCount(0);
    await expect(tid(sm, 'store-select')).toBeDisabled(); // 只有一間門市
    await expect(tid(sm, 'store-select').locator('option')).toHaveCount(1);
    await setMonth(sm, '2038-11');
    await expect(tid(sm, 'import-btn')).toBeDisabled();

    // 多選截圖（2 張）+ 貼上（1 張）
    await tid(sm, 'shot-input').setInputFiles([png(1), png(2)]);
    await expect(tid(sm, 'shot-thumb')).toHaveCount(2);
    await pasteImage(sm, Array.from(TINY_PNG));
    await expect(tid(sm, 'shot-thumb')).toHaveCount(3);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-october.xlsx', 'e2e-oct'));
    await expect(tid(sm, 'import-btn')).toBeEnabled();
    if (mobile) expect(await noOverflow(sm), '手機計算頁不橫向溢出').toBe(true);

    // D3：十月檔、選十一月 -> 確認視窗；先取消
    await tid(sm, 'import-btn').click();
    const dlg = sm.locator('[data-testid=confirm-dialog]');
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('data-code', 'PERIOD_MISMATCH');
    await expect(sm.locator('[data-testid=confirm-message]')).toHaveText('檔案是 10 月，與你選的 11 月不同，確定嗎？');
    await sm.locator('[data-testid=confirm-cancel]').click();
    await expect(tid(sm, 'batch-message')).toContainText('已取消匯入');
    expect((await batchesOf(sid.VW001, f('e2e-oct'))).length, '取消後沒有寫入').toBe(0);
    // 再按一次，這次確定
    await tid(sm, 'import-btn').click();
    await expect(dlg).toBeVisible();
    await sm.locator('[data-testid=confirm-ok]').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 3 筆');
    await expect(tid(sm, 'batch-message')).toContainText('2038-10');
    const oct = (await batchesOf(sid.VW001, f('e2e-oct')))[0];
    expect(oct.year_month).toBe('2038-10');
    expect(screenshotPaths(oct.screenshot_path)).toHaveLength(3);
    // 匯入成功後表單清空
    await expect(tid(sm, 'shot-thumb')).toHaveCount(0);

    // D2：未匹配藥品整批擋下，列出缺少的健保代碼與藥名
    await tid(sm, 'shot-input').setInputFiles([png(3)]);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-unmatched.xlsx', 'e2e-unm'));
    await tid(sm, 'import-btn').click();
    await expect(tid(sm, 'unmatched-list')).toBeVisible();
    await expect(tid(sm, 'unmatched-row')).toHaveCount(2);
    await expect(tid(sm, 'unmatched-list')).toContainText('ZTU000001');
    await expect(tid(sm, 'unmatched-list')).toContainText('測試未匹配藥乙');
    await expect(tid(sm, 'batch-message')).toContainText('尚未有DPOS商品資訊');
    expect((await batchesOf(sid.VW001, f('e2e-unm'))).length).toBe(0);

    // 主檔成功（十一月）：換檔案，截圖保留（上一次被擋下沒有清空）
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-basic.xlsx', 'e2e-basic'));
    await tid(sm, 'import-btn').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 8 筆，匹配 8 筆，未匹配 0 筆');
    await expect(tid(sm, 'unmatched-list')).toHaveCount(0);
    const basic = (await batchesOf(sid.VW001, f('e2e-basic')))[0];
    expect(basic).toMatchObject({ year_month: '2038-11', clinic_code: 'ZT038001', item_count: 8 });
    const basicShots = screenshotPaths(basic.screenshot_path);
    expect(basicShots).toHaveLength(1);
    for (const p of basicShots) expect(await objectExists(p)).toBe(true);
    // 明細：成本與毛利可見（計算器畫面可見，PDF 才不可含）
    await expect(tid(sm, 'report-info')).toContainText('測試診所甲（ZT038001）');
    await expect(tid(sm, 'report-info')).toContainText('2038-11-01 ~ 2038-11-30');
    await expect(tid(sm, 'sum-items')).toHaveText('8');
    await expect(tid(sm, 'sum-matched')).toHaveText('8');
    await expect(tid(sm, 'sum-unmatched')).toHaveText('0');
    await expect(tid(sm, 'report-row')).toHaveCount(8);
    await expect(tid(sm, 'cell-cost').first()).toHaveText('60');
    await expect(tid(sm, 'cell-profit').first()).toHaveText('400'); // (100-60)*10
    const dbItems = await itemsOf(basic.id);
    expect(Number(dbItems[0].gross_profit_amount)).toBe(400);
    if (mobile) expect(await noOverflow(sm), '手機明細不橫向溢出').toBe(true);

    // D4：同門市同月同診所再匯入 -> 確認 -> 仍新增，舊批次保留
    await tid(sm, 'shot-input').setInputFiles([png(4)]);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-basic.xlsx', 'e2e-basic2'));
    await tid(sm, 'import-btn').click();
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('data-code', 'DUPLICATE_BATCH');
    await expect(sm.locator('[data-testid=confirm-message]')).toContainText('已有診所 ZT038001 的匯入批次');
    await sm.locator('[data-testid=confirm-ok]').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 8 筆');
    expect((await batchesOf(sid.VW001, f('e2e-basic'))).length, '舊批次保留').toBe(1);
    expect((await batchesOf(sid.VW001, f('e2e-basic2'))).length, '新增一個').toBe(1);
    await expect(tid(sm, 'batch-row')).toHaveCount(3);
    // 沒有刪除按鈕（店長沒有刪批次權限）
    await expect(tid(sm, 'delete-batch')).toHaveCount(0);
    // 點歷史批次可看明細
    await tid(sm, 'batch-row').filter({ hasText: '2038-10' }).click();
    await expect(tid(sm, 'sum-items')).toHaveText('3');
  } finally {
    await smCtx.close();
  }

  // ---- 另一間店的店長：看不到 VW001 的批次
  {
    const ctx = await ctxFor(browser, 'cs_calc_b');
    const page = await ctx.newPage();
    watch(page, problems);
    try {
      await openPage(page);
      await expect(tid(page, 'store-select').locator('option')).toHaveCount(1);
      await expect(tid(page, 'store-select')).toContainText('VW002');
      await expect(tid(page, 'no-batches')).toBeVisible();
      await expect(tid(page, 'batch-row')).toHaveCount(0);
      const first = (await batchesOf(sid.VW001, f('e2e-basic')))[0];
      expect((await ctx.request.get(`/api/workspace/clinic-selfpay/batches/${first.id}`)).status()).toBe(403);
    } finally {
      await ctx.close();
    }
  }

  // ---- 區經理：看批次、刪除；截圖物件一併消失
  try {
    await mgr.reload({ waitUntil: 'networkidle' });
    await openPage(mgr);
    await tid(mgr, 'store-select').selectOption(sid.VW001);
    await expect(tid(mgr, 'batch-row')).toHaveCount(3);
    const target = (await batchesOf(sid.VW001, f('e2e-basic2')))[0];
    const shotsOfTarget = screenshotPaths(target.screenshot_path);
    expect(shotsOfTarget.length).toBeGreaterThan(0);
    for (const p of shotsOfTarget) expect(await objectExists(p)).toBe(true);
    await tid(mgr, 'batch-row').and(mgr.locator(`[data-batch="${target.id}"]`)).locator('[data-testid=delete-batch]').click();
    const dialog = mgr.getByRole('dialog', { name: '刪除匯入批次' });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-testid=delete-confirm]').click();
    await expect(tid(mgr, 'batch-message')).toContainText('匯入批次已刪除');
    await expect(tid(mgr, 'batch-row')).toHaveCount(2);
    for (const p of shotsOfTarget) expect(await objectExists(p), `${p} 應已刪除`).toBe(false);
    expect((await batchesOf(sid.VW001, f('e2e-basic2'))).length).toBe(0);
    expect(await itemsOf(target.id)).toEqual([]);
    // 其他批次不受影響
    const kept = (await batchesOf(sid.VW001, f('e2e-basic')))[0];
    for (const p of screenshotPaths(kept.screenshot_path)) expect(await objectExists(p)).toBe(true);
  } finally {
    await mgrCtx.close();
  }
  expect(problems, `console／頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});
