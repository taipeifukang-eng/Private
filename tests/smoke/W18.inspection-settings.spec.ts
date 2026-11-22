import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W18 冒煙層：巡店範本與評級設定頁可開啟；三個設定類別都能切換；
// 滿分總和、評級 snapshot 說明、回補規則影響筆數可見；沒有 pageerror、console 錯誤與水平溢出。

test('巡店範本與計分設定（管理員）：三個類別都可切換，Q5–Q8 提示可見', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '模板管理');
    await expect(page.getByRole('heading', { name: '巡店範本與計分設定', exact: true })).toBeVisible();
    await expect(page.getByTestId('score-total')).toBeVisible();
    await page.getByLabel('設定類別').selectOption('grades');
    await expect(page.getByTestId('grade-snapshot-note')).toContainText('完成當時');
    await page.getByLabel('設定類別').selectOption('bonus');
    await expect(page.getByTestId('bonus-impact')).toContainText('筆等待改善的項目會受影響');
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
