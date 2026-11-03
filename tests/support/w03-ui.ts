import { expect, type Page } from '@playwright/test';

/** 從全站功能選單開啟新版「業績管理」。 */
export async function openNativePerformance(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="業績管理"]').click();
  await expect(page.getByRole('heading', { name: '業績管理', exact: true })).toBeVisible();
}

export const panel = (page: Page) => page.locator('section.work-page:visible');

/** 選門市與年度並查詢；等到年度資料與閾值都載入。 */
export async function queryYear(page: Page, storeLabel: string | RegExp, year: number) {
  const p = panel(page);
  await p.getByLabel('門市', { exact: true }).selectOption({ label: typeof storeLabel === 'string' ? storeLabel : await optionLabel(page, storeLabel) });
  await p.getByLabel('年度').fill(String(year));
  const loaded = page.waitForResponse((r) => /performance-tools\/thresholds/.test(r.url()) && r.status() === 200, { timeout: 30_000 });
  await p.getByRole('button', { name: '查詢業績' }).click();
  await loaded;
  await expect(p.getByText('載入業績…')).toHaveCount(0, { timeout: 30_000 });
}

async function optionLabel(page: Page, re: RegExp) {
  const read = () => panel(page).getByLabel('門市', { exact: true }).locator('option').allTextContents();
  // 門市清單是非同步載入，先等到出現符合的選項。
  await expect.poll(async () => (await read()).some((l) => re.test(l)), { timeout: 30_000, message: `找不到門市選項 ${re}` }).toBe(true);
  return (await read()).find((l) => re.test(l))!;
}

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

/** 逐月業績明細表（第 N 月的所有儲存格文字）。 */
export async function readMonthRow(page: Page, month: number) {
  return panel(page)
    .locator('.performance-detail-table tbody tr')
    .nth(month - 1)
    .evaluate((tr) => Array.from(tr.children).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()));
}
