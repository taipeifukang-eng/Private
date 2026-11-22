import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W09 冒煙層：已封存任務頁可開啟；導覽入口依 task.view_archived（舊 Navbar）。

test('已封存任務頁（管理員）：能開啟、列出封存紀錄；導覽入口依 task.view_archived（navigation 帳號看得到入口，點進去顯示無權限而不是白畫面）', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '已封存任務');
    await expect(page.getByRole('heading', { name: '已封存任務', exact: true })).toBeVisible();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
  const nav = await loginAs(browser, 'navigation');
  try {
    const page = await nav.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    const item = page.locator('.workspace-menu button.catalog-item[title="已封存任務"]');
    await expect(item, '舊版 Navbar 有 task.view_archived 就顯示').toHaveCount(1);
    await item.click();
    await expect(page.getByText(/權限已變更|沒有.*權限|無權限/).first()).toBeVisible();
  } finally {
    await nav.close();
  }
});
