import { expect, test, request as pwRequest, type Browser, type Page } from '@playwright/test';
import { adminDb, apiForUser, cleanupM5Users } from '../support/m5-fixtures';
import { createAuthUser, createPlainRole, grantRole } from '../support/m5-org-fixtures';
import { applyProjectViewport } from '../support/w04-ui';
import { fillAndSubmitLogin, loginViaUi, openLogin } from '../support/w22-ui';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = require('../support/credentials.cjs') as { getAccount: (k: string) => { email: string; password: string } };

// W22 端對端：註冊 -> 登入 -> 待開通；忘記密碼；重設密碼；登入後回原頁（只允許站內路徑）。
// 信件 mock（D17）：測試站對 @example.test 不寄信。只建立與刪除 m5p-test-w22-* 帳號與 m5p_test_w22e2e 角色。

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401|403/.test(m.text()) && errors.push(m.text()));
  return errors;
}
const uniq = () => Math.random().toString(36).slice(2, 8);
let role: { id: string };

test.beforeAll(async () => {
  test.setTimeout(120_000);
  expect(await cleanupM5Users(), '清除上次殘留').toEqual([]);
  role = await createPlainRole('w22e2e');
});
test.afterAll(async () => {
  expect(await cleanupM5Users(), '清除帳號與角色').toEqual([]);
});

async function sessionContext(browser: Browser, user: { email: string; password: string; id: string }) {
  const api = await apiForUser({ key: 'w22', ...user } as never);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: 'http://localhost:3002', storageState: state });
}

test('註冊：欄位驗證為中文；成功後出現前往登入；用新帳號登入看到「帳號待管理員開通」，管理員開通後按重新檢查進入工作台', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await applyProjectViewport(page, testInfo);
  const errors = watchErrors(page);
  const email = `m5p-test-w22-e2e-${uniq()}@example.test`;
  await page.goto('/register', { waitUntil: 'networkidle' });
  const form = page.getByTestId('register-form');
  const submit = () => form.getByRole('button', { name: '註冊' }).click();
  await form.getByLabel('電子郵件').fill(email);
  await submit();
  await expect(page.getByRole('alert')).toHaveText('請輸入姓名');
  await form.getByLabel('姓名').fill('W22 e2e');
  await form.getByLabel('密碼', { exact: true }).fill('12345');
  await form.getByLabel('確認密碼').fill('12345');
  await submit();
  await expect(page.getByRole('alert')).toHaveText('密碼至少需要 6 個字元');
  await form.getByLabel('密碼', { exact: true }).fill('abcdef');
  await form.getByLabel('確認密碼').fill('abcdeg');
  await submit();
  await expect(page.getByRole('alert')).toHaveText('密碼不一致');
  await form.getByLabel('確認密碼').fill('abcdef');
  await submit();
  await expect(page.getByTestId('register-done')).toContainText('註冊完成');
  const row = (await adminDb().from('profiles').select('id,full_name').eq('email', email).single()).data;
  expect(row.full_name).toBe('W22 e2e');
  expect((await adminDb().from('user_roles').select('id').eq('user_id', row.id)).data).toEqual([]);

  await page.getByTestId('register-to-login').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await fillAndSubmitLogin(page, email, 'abcdef');
  const pending = page.getByTestId('pending-activation');
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await expect(pending).toContainText('帳號待管理員開通');
  // 管理員開通（這裡直接指派角色）後按「重新檢查」
  await grantRole(row.id, role.id);
  await pending.getByRole('button', { name: '重新檢查' }).click();
  await expect(page.locator('.menu-toggle')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pending-activation')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('註冊：信箱重複時顯示中文提示，不出現英文原文', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const user = await createAuthUser(`w22-dup-${uniq()}`);
  await page.goto('/register', { waitUntil: 'networkidle' });
  const form = page.getByTestId('register-form');
  await form.getByLabel('姓名').fill('重複');
  await form.getByLabel('電子郵件').fill(user.email);
  await form.getByLabel('密碼', { exact: true }).fill('abcdef');
  await form.getByLabel('確認密碼').fill('abcdef');
  await form.getByRole('button', { name: '註冊' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('已經註冊');
  expect(await alert.innerText()).not.toMatch(/[A-Za-z]{4,}/);
});

test('忘記密碼：已註冊與未註冊的信箱看到一模一樣的提示；信箱格式錯誤時提示中文', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const known = await createAuthUser(`w22-forgot-${uniq()}`);
  const texts: string[] = [];
  for (const email of [known.email, `m5p-test-w22-nobody-${uniq()}@example.test`]) {
    await page.goto('/forgot-password', { waitUntil: 'networkidle' });
    await page.getByTestId('forgot-form').getByLabel('電子郵件').fill(email);
    await page.getByRole('button', { name: '寄送重設信' }).click();
    const done = page.getByTestId('forgot-done');
    await expect(done).toBeVisible();
    texts.push(await done.innerText());
  }
  expect(texts[0]).toBe(texts[1]);
  expect(texts[0]).toContain('若此信箱已註冊');
  await page.goto('/forgot-password', { waitUntil: 'networkidle' });
  await page.getByTestId('forgot-form').getByLabel('電子郵件').fill('not-an-email');
  await page.getByRole('button', { name: '寄送重設信' }).click();
  await expect(page.getByRole('alert')).toHaveText('請輸入有效的電子郵件');
});

test('重設密碼：驗證密碼規則（Q16 最短 6 字元）、顯示強度，成功後自動回登入頁，舊密碼失效、新密碼可登入', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const user = await createAuthUser(`w22-reset-${uniq()}`);
  const ctx = await sessionContext(browser, user); // 等同於從重設信連結換得的登入狀態
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await page.goto('/reset-password', { waitUntil: 'networkidle' });
    const form = page.getByTestId('reset-form');
    await expect(form).toBeVisible();
    const submit = () => form.getByRole('button', { name: '設定新密碼' }).click();
    await form.getByLabel('新密碼', { exact: true }).fill('12345');
    await form.getByLabel('確認新密碼').fill('12345');
    await submit();
    await expect(page.getByRole('alert')).toHaveText('密碼長度至少需要 6 個字元');
    await form.getByLabel('新密碼', { exact: true }).fill('abcdef');
    await form.getByLabel('確認新密碼').fill('abcdeg');
    await submit();
    await expect(page.getByRole('alert')).toHaveText('兩次輸入的密碼不一致');
    await expect(page.getByTestId('reset-strength')).toContainText('弱');
    await form.getByLabel('新密碼', { exact: true }).fill('Abcdef1!x');
    await expect(page.getByTestId('reset-strength')).toContainText('強');
    await form.getByLabel('確認新密碼').fill('Abcdef1!x');
    await form.getByLabel('顯示密碼').check();
    await expect(form.getByLabel('新密碼', { exact: true })).toHaveAttribute('type', 'text');
    await submit();
    await expect(page.getByTestId('reset-done')).toContainText('密碼已成功重設');
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 10_000 }); // 三秒後自動前往登入頁
    expect(errors).toEqual([]);
    // 重設用的登入狀態已清除
    expect((await page.request.get('/api/workspace/session')).status()).toBe(401);
  } finally {
    await ctx.close();
  }
  const fresh = await pwRequest.newContext({ baseURL: 'http://localhost:3002', extraHTTPHeaders: { Origin: 'http://localhost:3002' } });
  expect((await fresh.post('/api/workspace/login', { data: { email: user.email, password: user.password } })).status()).toBe(401);
  expect((await fresh.post('/api/workspace/login', { data: { email: user.email, password: 'Abcdef1!x' } })).status()).toBe(200);
  await fresh.dispose();
});

test('登入錯誤：顯示中文提示且仍停在登入頁；錯誤後可再登入', async ({ page }, testInfo) => {
  await applyProjectViewport(page, testInfo);
  const user = await createAuthUser(`w22-bad-${uniq()}`);
  await grantRole(user.id, role.id);
  await loginViaUi(page, user.email, 'wrong-password-1');
  await expect(page.getByRole('alert')).toContainText('帳號或密碼不正確');
  await expect(page.getByTestId('login-form')).toBeVisible();
  await fillAndSubmitLogin(page, user.email, user.password);
  await expect(page.locator('.menu-toggle')).toBeVisible({ timeout: 20_000 });
});

test('登入後回原頁：站內路徑會回去（舊網址轉新版）；外部網址與雙斜線一律忽略、只進工作台', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const admin = getAccount('admin');
  // 站內路徑：/activity-management（舊網址）-> 登入後回到該路徑 -> 轉新版活動檢視
  {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      await openLogin(page, '/activity-management');
      await fillAndSubmitLogin(page, admin.email, admin.password);
      await expect(page.getByRole('heading', { name: '活動檢視', exact: true })).toBeVisible({ timeout: 45_000 });
      expect(new URL(page.url()).origin).toBe('http://localhost:3002');
    } finally {
      await ctx.close();
    }
  }
  for (const unsafe of ['https://evil.example/phish', '//evil.example/phish', '/\\evil.example', 'javascript:alert(1)', '/login']) {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3002' });
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      await openLogin(page, unsafe);
      await fillAndSubmitLogin(page, admin.email, admin.password);
      await expect(page.locator('.menu-toggle')).toBeVisible({ timeout: 45_000 });
      expect(new URL(page.url()).origin, unsafe).toBe('http://localhost:3002');
      expect(requests.some((u) => new URL(u).hostname.includes('evil.example')), unsafe).toBe(false);
    } finally {
      await ctx.close();
    }
  }
});
