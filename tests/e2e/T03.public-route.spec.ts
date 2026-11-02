/**
 * T03 公開頁路由機制（D14）：未登入存取 Next 原路徑 /public-demo/:token，
 * 應轉址到 /workspace/#/public-demo/:token 並直接顯示公開頁（不出現登入表單、不呼叫 session）。
 * 只讀取，不寫入任何資料。
 */
import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';

test('未登入：Next 原路徑轉址到 Vue 公開頁', async ({ page }) => {
  const sessionCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/workspace/session')) sessionCalls.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/public-demo/t03-token_1');
  await expect(page).toHaveURL(/\/workspace\/(index\.html)?#\/public-demo\/t03-token_1$/);
  await expect(page.getByTestId('public-demo')).toBeVisible();
  await expect(page.getByTestId('public-demo-token')).toHaveText('t03-token_1');
  await expect(page.locator('.login-layout')).toHaveCount(0);
  expect(sessionCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('未登入：直接開 hash 路由也能顯示；一般路徑仍是登入頁', async ({ page }) => {
  await page.goto('/workspace/index.html#/public-demo/direct1');
  await expect(page.getByTestId('public-demo-token')).toHaveText('direct1');
  await page.goto('/workspace/index.html');
  await expect(page.locator('.login-layout')).toBeVisible();
});

test('不安全 token 不轉址（交給原本的 Next 路由，不進入工作台）', async ({ page }) => {
  await page.goto('/public-demo/bad%20token');
  expect(page.url()).not.toContain('/workspace/');
});

test('已登入：從公開頁點「前往工作台」應進入工作台而非登入表單', async ({ browser }) => {
  const ctx = await loginAs(browser, 'admin');
  const page = await ctx.newPage();
  await page.goto('/workspace/index.html#/public-demo/fromlogin1');
  await expect(page.getByTestId('public-demo-token')).toHaveText('fromlogin1');
  await page.locator('a[href="#/"]').first().click();
  await expect(page.locator('.menu-toggle')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.login-layout')).toHaveCount(0);
  await ctx.close();
});
