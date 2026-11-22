import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { adminDb, cleanupM6InventoryResults, inventoryResultFileName, inventoryResultOrderNo, inventoryResultXlsx, runIdOrThrow } from '../support/m6-fixtures';

/**
 * M6 第一批 W25（2026-11-22 盤點權限問卷）：盤點匯入／刪除權限分開的多角色劇本（桌機 1440、手機 390 各跑一次）。
 * 劇本：盤點組（有匯入與刪除）匯入 2038-03 的 VW001 測試批次 -> 店長（管轄 VW001）與另一位店長打開盤點結果分析，
 *   看得到資料但完全沒有「匯入」「刪除」按鈕（隱藏，不是反灰）-> 只有刪除權限的帳號看不到匯入、可刪除並確認結案。
 * 資料：檔名 m6w25perm-<runId>-…，只刪自己的（依檔名）。
 */
const db = adminDb();
const MONTH = '2038-03';
const batchRows = async (fileName: string) => ((await db.from('inventory_result_batches').select('id').eq('source_file_name', fileName)).data || []) as { id: string }[];

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6InventoryResults();
});
test.afterAll(async () => {
  await cleanupM6InventoryResults();
});

const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
async function openAnalysis(browser: Browser, who: string, problems: string[]) {
  const ctx = await loginAs(browser, who);
  const page = await ctx.newPage();
  watch(page, problems);
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="盤點管理"]').click();
  await expect(page.getByRole('heading', { name: '盤點結果分析報表' })).toBeVisible();
  return { ctx, page };
}
const setMonth = async (page: Page) => {
  await page.locator('form.module-filters input[type=month]').fill(MONTH);
};
async function queryAndPick(page: Page, orderNo: string) {
  await setMonth(page);
  await page.getByRole('button', { name: '查詢盤點' }).click();
  const select = page.getByLabel('盤點批次');
  const option = select.locator('option', { hasText: orderNo });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  await select.selectOption(value!);
  await expect(page.locator('.batch-information')).toBeVisible();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('盤點組匯入 -> 店長只能看（沒有匯入／刪除按鈕）-> 只有刪除權限者刪除', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'jm' : 'jd';
  const fileName = inventoryResultFileName(tag);
  const orderNo = inventoryResultOrderNo(tag);
  const problems: string[] = [];

  // ---- 盤點組：匯入
  {
    const { ctx, page } = await openAnalysis(browser, 'inventory_team', problems);
    try {
      await setMonth(page);
      await expect(page.getByRole('button', { name: '匯入盤點 Excel' })).toBeVisible();
      await page.getByRole('button', { name: '匯入盤點 Excel' }).click();
      await page.locator('.import-file input[type=file]').setInputFiles({ name: fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: inventoryResultXlsx(tag) });
      await page.getByRole('button', { name: '確認匯入' }).click();
      await expect(page.getByRole('status')).toContainText('已匯入 1 批');
      expect(await batchRows(fileName)).toHaveLength(1);
      // 盤點組自己看得到匯入與刪除
      await queryAndPick(page, orderNo);
      await expect(page.getByRole('button', { name: '刪除', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '匯入爭議再次盤點' })).toBeVisible();
      if (mobile) expect(await noOverflow(page)).toBe(true);
    } finally {
      await ctx.close();
    }
  }

  // ---- 店長（ga_store_manager_b 管轄 VW001 看得到批次；store_manager 管轄 ZT01）：只能看，按鈕完全不在畫面上
  for (const who of ['ga_store_manager_b', 'store_manager']) {
    const { ctx, page } = await openAnalysis(browser, who, problems);
    try {
      await expect(page.getByRole('heading', { name: '盤點結果分析報表' })).toBeVisible();
      await expect(page.getByRole('button', { name: '匯入盤點 Excel' }), `${who} 匯入按鈕`).toHaveCount(0);
      if (who === 'ga_store_manager_b') {
        await queryAndPick(page, orderNo);
        await expect(page.locator('.batch-information'), '看得到批次資料').toContainText(fileName);
      }
      await expect(page.getByRole('button', { name: '刪除', exact: true }), `${who} 刪除按鈕`).toHaveCount(0);
      await expect(page.getByRole('button', { name: '匯入爭議再次盤點' }), `${who} 再次盤點匯入按鈕`).toHaveCount(0);
      await expect(page.locator('.recount-import'), `${who} 再次盤點區塊`).toHaveCount(0);
      if (mobile) expect(await noOverflow(page)).toBe(true);
    } finally {
      await ctx.close();
    }
  }

  // ---- 只有刪除權限者：沒有匯入按鈕、可以刪除
  {
    const { ctx, page } = await openAnalysis(browser, 'inventory_delete', problems);
    try {
      await expect(page.getByRole('button', { name: '匯入盤點 Excel' })).toHaveCount(0);
      await queryAndPick(page, orderNo);
      await expect(page.getByRole('button', { name: '匯入爭議再次盤點' })).toHaveCount(0);
      await page.getByRole('button', { name: '刪除', exact: true }).click();
      await page.getByRole('button', { name: '確認刪除' }).click();
      await expect.poll(async () => (await batchRows(fileName)).length, { timeout: 20_000 }).toBe(0);
    } finally {
      await ctx.close();
    }
  }
  expect(problems).toEqual([]);
});
