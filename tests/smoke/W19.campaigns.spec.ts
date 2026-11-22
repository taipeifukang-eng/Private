import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W19 / P05 冒煙層：活動管理列表可開啟；門市設定與特殊日期兩個視窗可開；
// 列表有狀態欄（依日期）；沒有 pageerror、console 錯誤與水平溢出。

test('活動管理（管理員）：列表、門市設定、特殊日期可開啟', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '活動管理');
    await expect(page.getByRole('heading', { name: '活動管理', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增活動' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '狀態' })).toBeVisible();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    await page.getByRole('button', { name: '特殊日期' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '新增特殊日期' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
    await page.getByRole('button', { name: '門市設定' }).click();
    await expect(page.getByRole('dialog').getByLabel('門市')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('活動管理（denied 無權限帳號）：選單沒有活動管理', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="活動管理"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
