import { expect, test } from '@playwright/test';

// T00 基礎建設自我檢查：測試站可用、工作台首頁可載入、沒有 pageerror、手機不橫向溢出。
// 不登入、不寫入任何資料。

test('session API 不是 503（伺服器已通過 DEV 守衛）', async ({ request }) => {
  const res = await request.get('/api/workspace/session');
  expect([200, 401]).toContain(res.status());
});

test('工作台首頁可載入且沒有 pageerror、沒有水平溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const res = await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(page.locator('#app')).toBeAttached();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
