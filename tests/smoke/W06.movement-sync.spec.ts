import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/w05-fixtures';

// W06 冒煙層：每月人員狀態頁能開啟並查詢保留月份；人員異動管理的批次輸入選「復職」時出現
// 「復職不一定回原店」的提示；沒有 console 錯誤與頁面層級水平溢出（桌機 1440 與手機 390）。不建立任何資料。

test('每月人員狀態頁：載入、查詢保留月份，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '每月人員狀態');
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    await page.getByLabel('月份').fill('2099-07');
    await page.getByRole('button', { name: '查詢人員' }).click();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('人員異動批次輸入：選「復職」顯示可指定復職門市的提示，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '人員異動管理');
    const p = workPanel(page);
    await expect(p.getByTestId('return-store-hint')).toHaveCount(0);
    await p.getByLabel('異動類型').selectOption({ label: '復職' });
    await expect(p.getByTestId('return-store-hint')).toContainText('復職不一定回原店');
    await p.getByLabel('異動類型').selectOption({ label: '離職' });
    await expect(p.getByTestId('return-store-hint')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
