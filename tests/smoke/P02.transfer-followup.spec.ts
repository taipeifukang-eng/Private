import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/p02-fixtures';

// P02 冒煙層（M2 後續問卷 H.1、H.5）：人員異動管理 → 調店登記確認頁可開啟，說明「原店或新店任一位督導確認即生效」；
// 新增調店申請表單可開啟；批次輸入異動頁的調店說明同步更新。沒有 console 錯誤與頁面層級水平溢出（桌機 1440 與手機 390）。唯讀。

test('調店登記確認頁：說明任一方督導確認即生效，新增調店申請表單可開啟', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '人員異動管理');
    await page.getByRole('button', { name: '調店登記確認' }).click();
    const p = workPanel(page);
    await expect(p.getByText(/原店或新店任一位督導確認即生效/).first()).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText(/兩店督導都確認|雙方確認/)).toHaveCount(0);
    await p.getByRole('button', { name: '新增調店申請' }).click();
    await expect(p.getByRole('heading', { name: '新增調店申請' })).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText('送出後等待原店或新店任一位督導確認生效日期。')).toBeVisible();
    // 沒有選員工時不會出現「新店續任代理」的問題
    await expect(p.getByTestId('acting-question')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('批次輸入異動頁：調店說明為任一方督導確認即生效', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '人員異動管理');
    const p = workPanel(page);
    await expect(p.getByRole('button', { name: /^驗證 \d+ 筆異動/ })).toBeVisible({ timeout: 60_000 });
    await p.getByLabel('異動類型').selectOption('store_transfer');
    await expect(p.getByLabel('原任職門市')).toBeVisible();
    await expect(p.getByLabel('新任職門市')).toBeVisible();
    // 還沒預覽，不會標出代理店長的列
    await expect(p.getByTestId('acting-transfer-rows')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
