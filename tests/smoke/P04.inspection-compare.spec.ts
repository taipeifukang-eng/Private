import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { work } from '../support/m4b-ui';

// P04 冒煙層：巡店比較頁可開啟（有「巡店比較」與「經理巡店」權限者）；督導沒有選單入口。
test('巡店比較（經理）：能開啟、門市選單可用、沒有錯誤與溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'ops_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const api = page.waitForResponse((r) => r.url().includes('/api/workspace/inspection-compare') && r.request().method() === 'GET');
    await openFromMenu(page, '巡店比較');
    expect((await api).status()).toBe(200);
    await expect(work(page).getByRole('heading', { name: '督導與經理巡店比較' })).toBeVisible();
    await expect(work(page).getByLabel('比較門市')).toBeVisible();
    await expect(work(page).locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('督導沒有巡店比較入口（只有巡店比較＋經理巡店權限都有的人才看得到）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'supervisor');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="巡店列表"]')).toBeVisible();
    await expect(page.locator('.workspace-menu button.catalog-item[title="巡店比較"]')).toHaveCount(0);
    const res = await page.request.get('/api/workspace/inspection-compare');
    expect(res.status()).toBe(403);
  } finally {
    await ctx.close();
  }
});
