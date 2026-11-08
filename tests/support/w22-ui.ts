import { expect, type Page } from '@playwright/test';

/** 從原網址 /login 轉到新版登入頁，填帳密送出（不等待結果）。redirect 為登入後回原頁的站內路徑。 */
export async function openLogin(page: Page, redirect?: string) {
  await page.goto(redirect === undefined ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('login-form')).toBeVisible();
}
export async function fillAndSubmitLogin(page: Page, email: string, password: string) {
  const form = page.getByTestId('login-form');
  await form.getByLabel('帳號或電子郵件').fill(email);
  await form.getByLabel('密碼').fill(password);
  await form.getByRole('button', { name: '登入工作台' }).click();
}
export async function loginViaUi(page: Page, email: string, password: string, redirect?: string) {
  await openLogin(page, redirect);
  await fillAndSubmitLogin(page, email, password);
}
