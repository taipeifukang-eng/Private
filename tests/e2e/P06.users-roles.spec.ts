import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAdminLevelRole, createAuthUser, createPlainRole, deleteAdminLevelRole, profileRole, userRoleRows } from '../support/m5-org-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// P06 e2e（M5 Q13、Q14）：把人改成管理員、或加進管理員等級角色之前，畫面先跳出醒目確認；取消就不會寫入。
// 重置密碼按鈕只有舊式身分為管理員的人看得到。桌機 1440 與手機 390 各跑一次。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let target: { id: string; email: string };
let plainRole: { id: string; code: string; name: string };
let ownerRole: { id: string; code: string; name: string } | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['user_editor', 'user_admin', 'role_assigner']);
  users = s.users;
  teardownUsers = s.teardown;
  await deleteAdminLevelRole();
  plainRole = await createPlainRole('p06e2eplain');
  ownerRole = await createAdminLevelRole();
  target = await createAuthUser('p06-e2e-target', { employeeCode: 'ZTP06E2E' });
});
test.afterAll(async () => {
  await deleteAdminLevelRole();
  expect(await teardownUsers(), '清除帳號與角色').toEqual([]);
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
async function openUsers(page: Page) {
  await openFromMenu(page, '使用者管理');
  await expect(page.getByRole('heading', { name: '使用者管理', exact: true })).toBeVisible();
  await page.getByLabel('搜尋姓名／帳號／員編').fill(target.email);
  await expect(page.locator('tbody tr').filter({ hasText: target.email })).toHaveCount(1);
}

test('Q13 使用者管理：改成管理員前先跳出醒目確認，取消不寫入、確認才寫入；改成主管不需確認', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'user_editor');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openUsers(page);
    const row = () => page.locator('tbody tr').filter({ hasText: target.email });
    // 重置密碼只有舊式管理員看得到
    await expect(row().getByRole('button', { name: '重置密碼' })).toHaveCount(0);

    await row().getByRole('button', { name: '變更角色' }).click();
    await page.getByRole('dialog').getByLabel('相容角色').selectOption('admin');
    await page.getByRole('button', { name: '確認變更' }).click();
    const warning = page.getByTestId('admin-grant-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('此人將擁有完整管理權限');
    expect(await profileRole(target.id), '確認前尚未寫入').toBe('member');
    // 取消：回到變更角色視窗、不寫入
    await page.getByRole('dialog').filter({ has: warning }).getByRole('button', { name: '取消' }).click();
    await expect(warning).toHaveCount(0);
    expect(await profileRole(target.id)).toBe('member');
    // 再來一次並確認
    await page.getByRole('button', { name: '確認變更' }).click();
    await expect(warning).toBeVisible();
    await page.getByTestId('admin-grant-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: '已更新使用者' })).toBeVisible({ timeout: 30_000 });
    expect(await profileRole(target.id)).toBe('admin');

    // 降級與改成主管都不需要這道確認
    await row().getByRole('button', { name: '變更角色' }).click();
    await page.getByRole('dialog').getByLabel('相容角色').selectOption('manager');
    await page.getByRole('button', { name: '確認變更' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已更新使用者' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('admin-grant-warning')).toHaveCount(0);
    await expect.poll(() => profileRole(target.id), { timeout: 30_000 }).toBe('manager');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q14 重置密碼按鈕：舊式身分是管理員的人看得到；持有使用者權限但不是管理員的人看不到', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, 'user_admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openUsers(page);
    await expect(page.locator('tbody tr').filter({ hasText: target.email }).getByRole('button', { name: '重置密碼' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('Q13 角色管理：加進一般角色直接成功；加進管理員等級角色先跳出醒目確認，取消不寫入、確認才寫入', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await contextFor(browser, 'role_assigner');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    const openRoleUsers = async (name: string) => {
      await openFromMenu(page, '角色權限管理');
      await page.getByLabel('搜尋角色').fill(name);
      await page.locator('tbody tr').filter({ hasText: name }).getByRole('button', { name: '查看／設定' }).click();
      await page.getByRole('button', { name: '使用者指派' }).click();
      await expect(page.getByLabel('批次指派員工編號')).toBeVisible();
    };

    // 一般角色：沒有確認、直接指派
    await openRoleUsers(plainRole.name);
    await page.getByLabel('批次指派員工編號').fill('ZTP06E2E');
    await page.getByRole('button', { name: '指派使用者' }).click();
    await expect(page.getByTestId('admin-grant-warning')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: '成功指派' }).first()).toBeVisible({ timeout: 30_000 });
    expect((await userRoleRows(target.id, plainRole.id)).length).toBe(1);

    if (!ownerRole) return; // DEV 已有 owner_role 角色：不動別人的角色
    await openRoleUsers(ownerRole.name);
    await page.getByLabel('批次指派員工編號').fill('ZTP06E2E');
    await page.getByRole('button', { name: '指派使用者' }).click();
    const warning = page.getByTestId('admin-grant-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('此人將擁有完整管理權限');
    expect(await userRoleRows(target.id, ownerRole.id), '確認前尚未寫入').toEqual([]);
    await page.getByRole('dialog').filter({ has: warning }).getByRole('button', { name: '取消' }).click();
    await expect(warning).toHaveCount(0);
    expect(await userRoleRows(target.id, ownerRole.id)).toEqual([]);
    await page.getByRole('button', { name: '指派使用者' }).click();
    await expect(warning).toBeVisible();
    await page.getByTestId('admin-grant-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: '成功指派' }).first()).toBeVisible({ timeout: 30_000 });
    expect((await userRoleRows(target.id, ownerRole.id)).length).toBe(1);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
