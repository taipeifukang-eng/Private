import { expect, test } from '@playwright/test';
import { loginAs, TEST_ORIGIN } from '../support/auth';
import { GPS_BASE, applyProjectViewport, grantGeolocation, noPageOverflow, openNativeNew } from '../support/i01-fixtures';
import { ed, photoInput, waitUnlocked } from '../support/w14-ui';

// W14／W15 冒煙層：新增巡店編輯頁可開啟（管理員、督導），表單 API 200，
// 沒有 pageerror／console 錯誤與水平溢出；拍照 input 具後鏡頭屬性；簽名標籤為「店長／當班主管確認簽名」；
// 桌機 1440、手機 390 兩個 project 都跑。

for (const role of ['admin', 'supervisor']) {
  test(`新增巡店編輯頁（${role}）：能開啟、表單 API 200、拍照屬性與簽名標籤正確`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const ctx = await loginAs(browser, role);
    await grantGeolocation(ctx, TEST_ORIGIN, GPS_BASE);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && !/geolocation|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
      const api = page.waitForResponse((r) => r.url().includes('/api/workspace/inspection-form?') && r.request().method() === 'GET');
      await openNativeNew(page);
      expect((await api).status()).toBe(200);
      await waitUnlocked(page);
      await expect(photoInput(page, 0)).toHaveAttribute('capture', 'environment');
      await expect(photoInput(page, 0)).toHaveAttribute('accept', 'image/*');
      await expect(ed(page).getByText('店長／當班主管確認簽名')).toBeVisible();
      await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeEnabled();
      await expect(page.locator('.notice.error')).toHaveCount(0);
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
