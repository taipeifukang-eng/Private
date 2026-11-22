import { expect, type Page } from '@playwright/test';
import { openFromMenu } from './m3-fixtures';

// W16／W17／P04 畫面測試共用：開啟頁面（走功能選單與列表按鈕，與使用者操作一致）。

export const work = (page: Page) => page.locator('section.work-page:visible');
/** 2099-08-05 → 2099/8/5（列表與詳情用的 zh-TW 日期格式）。 */
export const zhDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}/${m}/${day}`;
};

/** 從巡店列表開啟某一筆的詳情：切到該月份、選門市、查詢，再按該日期那一列的「查看明細」。 */
export async function openInspectionDetail(page: Page, o: { month: string; store: string; date: string; type?: 'supervisor' | 'manager' }) {
  await openFromMenu(page, '巡店列表');
  await expect(work(page).getByRole('heading', { name: '巡店列表' })).toBeVisible();
  await work(page).locator('input[type=month]').fill(o.month);
  const storeSelect = work(page).locator('form.filter-bar select').first();
  const options = await storeSelect.locator('option').all();
  for (const option of options) {
    if ((await option.textContent())?.includes(o.store)) {
      await storeSelect.selectOption((await option.getAttribute('value'))!);
      break;
    }
  }
  if (o.type) await work(page).getByLabel('巡店類型').selectOption(o.type);
  await work(page).getByRole('button', { name: '查詢紀錄' }).click();
  await expect(work(page).getByText(`${o.month} 巡店紀錄`)).toBeVisible();
  const row = work(page).locator('tbody tr').filter({ hasText: zhDate(o.date) }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '查看明細' }).click();
  await expect(work(page).getByRole('heading', { name: '巡店紀錄明細' })).toBeVisible();
}

/** 從詳情頁開啟列印報表預覽。 */
export async function openPrintPreview(page: Page) {
  await work(page).getByRole('button', { name: '列印報表預覽' }).click();
  await expect(work(page).getByRole('heading', { name: '巡店報表預覽' })).toBeVisible();
  await expect(work(page).getByTestId('print-report')).toBeVisible();
}

/** 開啟待改善追蹤列表。 */
export async function openImprovements(page: Page) {
  await openFromMenu(page, '待改善追蹤');
  await expect(work(page).getByRole('heading', { name: '待改善追蹤' })).toBeVisible();
}
/** 待改善列表中，含該巡店日期與門市代碼的那一列。 */
export const improvementRows = (page: Page, o: { date: string; store: string }) =>
  work(page).locator('tbody tr').filter({ hasText: o.store }).filter({ hasText: o.date });
