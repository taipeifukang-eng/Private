import { expect, test } from '@playwright/test';
import { pageFor } from '../support/g01-ui';

// WP5（只跑 DEV）：舊版選單連到新版頁面。需要 DEV 伺服器以 WORKSPACE_ENABLED=true 與 WORKSPACE_AUDIENCE=all 啟動。
// 管理員登入後，舊版選單裡至少有一個指向 /workspace/index.html#/open/<kind> 的連結，點開後進到新版並開出對應頁籤。
test('舊版選單連結直接進新版頁面，且可回舊版', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await pageFor(browser, 'admin', testInfo);
  try {
    await page.goto('/');
    const links = page.locator('a[href^="/workspace/index.html#/open/"]');
    await expect.poll(async () => links.count()).toBeGreaterThan(0);
    const href = await links.first().getAttribute('href');
    await page.goto(href!);
    await expect(page).toHaveURL(/\/workspace\/index\.html#\/open\//);
    await expect(page.getByTestId('back-to-legacy').first()).toBeVisible({ timeout: 60_000 });
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
