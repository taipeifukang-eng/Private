import { expect, test } from '@playwright/test';
import { gaNavTo, gaNavToIn, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 G09 冒煙層：設備保固管理與維修紀錄（含設施版）：導覽進入、標題、主要 API 200、兩個分頁切換、無 pageerror、無水平溢出。
// 設備查看帳號有設備保固與維修紀錄；店長只有維修紀錄（沒有保固頁）；只讀測試：不建立任何資料。

test('設備查看：設備保固管理與設備維修紀錄（逐筆與每台修過幾次兩個分頁）都能開，API 200，無錯誤與溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/') && calls.push(`${r.status()} ${new URL(r.url()).pathname}`));
    await gaNavToIn(page, '設備管理', '保固管理');
    await expect(visibleHeading(page, '設備保固管理')).toBeVisible();
    await expect(page.getByRole('list', { name: '設備保固統計' }).locator('visible=true')).toBeVisible();
    await gaNavToIn(page, '設備管理', '維修紀錄');
    await expect(visibleHeading(page, '設備維修紀錄')).toBeVisible();
    await page.getByRole('tab', { name: '每台修過幾次' }).locator('visible=true').click();
    await expect.poll(() => calls.some((c) => c === '200 /api/workspace/general-affairs/asset-maintenance/summary')).toBe(true);
    await page.getByRole('tab', { name: '逐筆紀錄' }).locator('visible=true').click();
    await expect.poll(() => calls.some((c) => c === '200 /api/workspace/general-affairs/asset-maintenance/history')).toBe(true);
    expect(calls.filter((c) => !c.startsWith('200 '))).toEqual([]);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店長：側欄有維修紀錄、沒有保固管理；維修紀錄頁可開（只看自己門市）', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_store_manager_b', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設備管理', '維修紀錄').catch(() => undefined);
    const labels = (await sideLabels(page)).map((t) => t.trim());
    expect(labels.some((t) => t.startsWith('保固管理'))).toBe(false);
    await expect(visibleHeading(page, '設備維修紀錄').or(visibleHeading(page, '設施維修紀錄'))).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
