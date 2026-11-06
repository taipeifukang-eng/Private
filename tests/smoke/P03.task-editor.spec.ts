import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// P03 冒煙層：建立新任務編輯器可開啟，跨部門支援人員入口需先選部門。

test('建立新任務編輯器：從任務管理開啟；選了部門才能加入跨部門支援人員；沒有 pageerror', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '任務管理');
    await page.getByRole('button', { name: '建立新任務' }).click();
    await expect(page.getByRole('heading', { name: '建立新任務', exact: true })).toBeVisible();
    const toggle = page.getByLabel('區段 1 加入跨部門支援人員');
    await expect(toggle).toBeDisabled();
    await page.getByLabel('區段 1 部門').selectOption('營業部');
    await expect(toggle).toBeEnabled();
    await toggle.check();
    await expect(page.locator('.support-list').first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
