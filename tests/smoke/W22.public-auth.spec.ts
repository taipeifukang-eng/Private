import { expect, test, type Page } from '@playwright/test';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { cleanupM5Users } from '../support/m5-fixtures';
import { createAuthUser } from '../support/m5-org-fixtures';
import { loginViaUi } from '../support/w22-ui';

// W22 冒煙層：登入、註冊、忘記密碼、重設密碼從原網址轉到新版公開頁，畫面完整、沒有 console 錯誤與水平溢出；
// 登入頁有忘記密碼與註冊連結（Q15），沒有「測試環境」字樣與門市數量；沒有角色的帳號登入後看到「帳號待管理員開通」。

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test.beforeAll(async () => {
  expect(await cleanupM5Users(), '清除上次殘留').toEqual([]);
});
test.afterAll(async () => {
  expect(await cleanupM5Users(), '清除帳號').toEqual([]);
});

test('登入頁：原網址 /login 轉到新版；有忘記密碼與註冊連結；沒有測試環境字樣與門市數量；無錯誤無溢出', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  await page.goto('/login', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/workspace\/index\.html#\/login$/);
  await expect(page.getByRole('heading', { name: '登入菁英作業台' })).toBeVisible();
  await expect(page.getByTestId('login-forgot')).toBeVisible();
  await expect(page.getByTestId('login-register')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/測試環境|測試工作區|測試區|間門市|正在同步/);
  await noPageOverflow(page);
  expect(errors).toEqual([]);
  // 連結可用
  await page.getByTestId('login-forgot').click();
  await expect(page.getByRole('heading', { name: '忘記密碼' })).toBeVisible();
  await page.goBack();
  await page.getByTestId('login-register').click();
  await expect(page.getByRole('heading', { name: '建立帳號' })).toBeVisible();
});

test('工作台未登入畫面（/workspace/）同樣有連結且沒有測試環境字樣', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('login-forgot')).toBeVisible();
  await expect(page.getByTestId('login-register')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/測試環境|測試工作區|測試區/);
  // 未登入時 session 回 401 是預期的
  expect(errors.filter((e) => !/401/.test(e))).toEqual([]);
});

test('註冊、忘記密碼頁：原網址轉到新版，表單欄位齊全，無錯誤無溢出', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  await page.goto('/register', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/register$/);
  const form = page.getByTestId('register-form');
  for (const label of ['姓名', '電子郵件', '密碼', '確認密碼']) await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.goto('/forgot-password', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/forgot-password$/);
  await expect(page.getByTestId('forgot-form').getByLabel('電子郵件')).toBeVisible();
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test('重設密碼頁：沒有登入狀態顯示「連結無效」並引導重新申請；連結失敗帶 error 時只顯示固定文字', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  await page.goto('/reset-password', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/reset-password$/);
  await expect(page.getByTestId('reset-invalid')).toContainText('連結無效或已過期');
  await expect(page.getByRole('link', { name: '重新申請重設連結' })).toBeVisible();
  await page.goto('/workspace/index.html#/reset-password?error=%3Cb%3Eevil%3C%2Fb%3E', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' }); // 同一頁只換 hash 不會重新掛載，重新載入才是真實的「點信件連結」
  const invalid = page.getByTestId('reset-invalid');
  await expect(invalid).toContainText('重設連結已失效或已使用過，請重新申請');
  await expect(invalid).not.toContainText('evil');
  await noPageOverflow(page);
  // 401 是預期的（沒有登入狀態），不算錯誤
  expect(errors.filter((e) => !/401/.test(e))).toEqual([]);
});

test('Q15 沒有任何角色的帳號登入後看到「帳號待管理員開通」，不是空白工作台；可登出', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  const user = await createAuthUser('w22-smoke-pending');
  await loginViaUi(page, user.email, user.password);
  const pending = page.getByTestId('pending-activation');
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await expect(pending.getByRole('heading', { name: '帳號待管理員開通' })).toBeVisible();
  await expect(page.getByTestId('pending-text')).toContainText('目前還沒有被指派任何角色');
  await expect(page.locator('.menu-toggle')).toHaveCount(0);
  await noPageOverflow(page);
  await pending.getByRole('button', { name: '登出' }).click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  expect(errors.filter((e) => !/401/.test(e))).toEqual([]);
});
