import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W13 冒煙層：巡店列表可開啟、四張統計、月曆、表格欄位（評級、得分（滿分 10 分））；
// 沒有 pageerror、console 錯誤與水平溢出（桌機 1440、手機 390 兩個 project 都跑）。

test('巡店列表（管理員）：能開啟、統計與月曆可見、表頭補回舊版欄位', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const api = page.waitForResponse((r) => r.url().includes('/api/workspace/inspections?') && r.request().method() === 'GET');
    await openFromMenu(page, '巡店列表');
    expect((await api).status()).toBe(200);
    await expect(page.getByRole('heading', { name: '巡店列表', exact: true })).toBeVisible();
    await expect(page.getByTestId('inspection-stats')).toBeVisible();
    for (const key of ['total', 'excellent', 'good', 'improve']) await expect(page.locator(`[data-stat="${key}"]`)).toBeVisible();
    await expect(page.getByText('只統計', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: /巡店月曆/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '得分（滿分 10 分）' })).toBeAttached();
    await expect(page.getByRole('columnheader', { name: '分數' })).toBeAttached();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('巡店列表（督導）：沒有經理分頁時不出現比較入口；能開啟', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'supervisor');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '巡店列表');
    await expect(page.getByRole('heading', { name: '巡店列表', exact: true })).toBeVisible();
    await expect(page.getByTestId('compare-entry')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
