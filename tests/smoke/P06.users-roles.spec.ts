import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAuthUser } from '../support/m5-org-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// P06 冒煙層：使用者管理（新增使用者連到註冊頁、待開通標籤與篩選）與角色權限管理（DEV 測試角色開關）。
// 沒有 pageerror、console 錯誤與水平溢出。帳號為 m5p-test-*，結束時只刪自己建立的帳號。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let pendingEmail = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['user_editor', 'role_assigner']);
  users = s.users;
  teardownUsers = s.teardown;
  pendingEmail = (await createAuthUser('p06-smoke-pending', { employeeCode: 'ZTP06SMOKE' })).email;
});
test.afterAll(async () => {
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

async function contextFor(browser: Browser, key: string): Promise<BrowserContext> {
  const api = await apiForUser(users[key]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: 'http://localhost:3002', storageState: state });
}
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('使用者管理：「新增使用者」是連到公開註冊頁的連結（沒有直接建立視窗）；待開通人數與標籤、篩選', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, 'user_editor');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openFromMenu(page, '使用者管理');
    await expect(page.getByRole('heading', { name: '使用者管理', exact: true })).toBeVisible();
    const link = page.getByTestId('add-user-link');
    await expect(link).toHaveText('新增使用者');
    await expect(link).toHaveAttribute('href', '/register');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // 沒有直接建立視窗
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 待開通
    const filter = page.getByTestId('pending-filter');
    await expect(filter).toBeVisible();
    await expect(filter).toContainText('待開通');
    await expect(filter).toContainText('位');
    await expect(page.getByTestId('pending-count')).not.toHaveText('0', { timeout: 30_000 });
    const total = Number(await page.getByTestId('pending-count').innerText());
    expect(total).toBeGreaterThanOrEqual(1);
    await page.getByLabel('搜尋姓名／帳號／員編').fill(pendingEmail);
    const row = page.locator('tbody tr').filter({ hasText: pendingEmail });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('pending-tag')).toHaveText('待開通');
    // 篩選：只留待開通帳號；有角色的操作者本人（search 清空後）不在列
    await page.getByLabel('搜尋姓名／帳號／員編').fill('');
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr').filter({ hasText: users.user_editor.email })).toHaveCount(0);
    await expect(page.locator('tbody tr').filter({ hasText: pendingEmail })).toHaveCount(1);
    await expect(page.getByText(`${total} 位使用者`)).toBeVisible();
    await filter.click();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('角色權限管理：「顯示 DEV 測試角色」開關預設關閉，勾選後重新載入', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, 'role_assigner');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openFromMenu(page, '角色權限管理');
    await expect(page.getByRole('heading', { name: '角色權限管理', exact: true })).toBeVisible();
    const toggle = page.getByLabel('顯示 DEV 測試角色');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    const loaded = page.waitForResponse((r) => r.url().includes('/api/workspace/roles?includeDevRoles=true'));
    await toggle.check();
    expect((await loaded).status()).toBe(200);
    await expect(page.getByTestId('hidden-dev-roles')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
