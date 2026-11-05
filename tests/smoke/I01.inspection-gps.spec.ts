import { expect, test } from '@playwright/test';
import { loginAs, TEST_ORIGIN } from '../support/auth';
import { applyProjectViewport, gpsPanel, grantGeolocation, GPS_BASE, noPageOverflow, openNativeNew, workPage } from '../support/i01-fixtures';

// I01 冒煙層：新版「新增巡店」頁可開、進頁自動定位、定位成功後解鎖；
// 沒有 pageerror、console 錯誤與頁面層級水平溢出；舊版 /inspection/new 同樣載得起來。
// 不建立任何資料。

test('新增巡店頁冒煙 admin：自動定位成功即解鎖，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    await grantGeolocation(ctx, TEST_ORIGIN, GPS_BASE);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openNativeNew(page);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
    await expect(workPage(page).getByLabel('巡店門市')).toBeEnabled();
    await expect(workPage(page).getByTestId('gps-guide-link')).toHaveText('定位開不了？看教學');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('舊版新增巡店頁冒煙 admin：進頁自動定位並顯示定位區塊', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    await grantGeolocation(ctx, TEST_ORIGIN, GPS_BASE);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/inspection/new?type=supervisor', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('gps-panel')).toHaveAttribute('data-gps-status', 'success', { timeout: 60_000 });
    // 舊版頁面在桌機寬度本來就有頁面層級捲動（非本次改動），不在此檢查水平溢出。
  } finally {
    await ctx.close();
  }
});
