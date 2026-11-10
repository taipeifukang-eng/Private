import { expect, test } from '@playwright/test';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 Q29 冒煙層：上線貼標進度頁（側欄入口、標題、進度 API 200、無 pageerror、390 寬無水平溢出）。
// 總務、設備／設施查看者、兩店店長有入口；無權限者沒有入口，API 403。只讀測試：不建立任何資料。
test('總務與店長：側欄「上線貼標進度」開新版頁籤；進度 API 200；整體摘要；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  for (const role of ['ga_works', 'store_manager', 'ga_store_manager_b', 'ga_equipment_view', 'ga_facility_view']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      const calls: string[] = [];
      page.on('response', (r) => r.url().includes('/general-affairs/onboarding/progress') && calls.push(String(r.status())));
      await gaNavTo(page, '上線貼標進度');
      await expect(visibleHeading(page, '上線貼標進度')).toBeVisible();
      await expect(page.getByTestId('progress-summary').locator('visible=true')).toBeVisible();
      await expect.poll(() => calls.length, { message: role }).toBeGreaterThanOrEqual(1);
      expect(calls.every((c) => c === '200'), role).toBe(true);
      expect(await noPageOverflow(page), role).toBe(true);
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('無權限者沒有入口，進度 API 403', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'denied', testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaOnboardingProgress).toBe(false);
    expect(await page.evaluate(async () => (await fetch('/api/workspace/general-affairs/onboarding/progress')).status)).toBe(403);
  } finally {
    await ctx.close();
  }
  const withMenu = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await openGaCenter(withMenu.page);
    expect(await sideLabels(withMenu.page)).toContain('上線貼標進度');
  } finally {
    await withMenu.ctx.close();
  }
});
