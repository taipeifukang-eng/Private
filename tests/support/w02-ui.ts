import { expect, type Page } from '@playwright/test';

/** 開啟新版「資料匯出」頁（從全站功能選單）。 */
export async function openNativeExport(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="資料匯出"]').click();
  await expect(page.getByRole('heading', { name: '每月人員資料匯出', exact: true })).toBeVisible();
}

/** 切換年月（年份是數字欄位、月份是下拉）。 */
export async function pickMonth(page: Page, month: string) {
  const [y, m] = month.split('-');
  await page.locator('[data-export-year]').fill(y);
  await page.locator('[data-export-year]').dispatchEvent('change');
  // 只有「可看門市列表」的角色會載入門市；先等到該月份的門市請求回來（若有發出）。
  const loaded = page.waitForResponse((r) => r.url().includes(`monthly-export/stores?year_month=${month}`), { timeout: 8_000 }).catch(() => null);
  await page.locator('[data-export-month]').selectOption(String(Number(m)));
  await loaded;
  await page.waitForFunction(() => !document.body.innerText.includes('載入中…'), undefined, { timeout: 30_000 });
}

export const ALL_EXPORT_BUTTONS = [
  'download',
  'actual-staff-points',
  'roster-preview',
  'roster',
  'transport',
  'single-item-bonus',
  'talent-cultivation-bonus',
  'meal-allowance',
  'spring-festival-bonus',
  'support-hours',
] as const;

export async function visibleExportButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-export]')).map((b) => (b as HTMLElement).dataset.export || ''));
}

export async function readStats(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll('[data-export-stats] [data-stat]').forEach((el) => {
      out[(el as HTMLElement).dataset.stat || ''] = (el.textContent || '').trim();
    });
    return out;
  });
}

export async function readStoreRows(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.export-store-list li')).map((li) => ({
      code: (li as HTMLElement).dataset.store || '',
      status: (li as HTMLElement).dataset.status || '',
      checked: (li.querySelector('input') as HTMLInputElement).checked,
      disabled: (li.querySelector('input') as HTMLInputElement).disabled,
      text: (li.textContent || '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
