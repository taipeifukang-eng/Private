import { expect, test, type Page } from '@playwright/test';
import { apiForUser, setupCv01, TEST_ORIGIN, type CvFixtures } from '../support/cv01-fixtures';

// CV01 e2e：單店店長（VW001，只有 view_own）從新版工作台
//  1. 導覽選單看得到「活動檢視」，無權限帳號看不到；
//  2. 在每月人員狀態開「活動檢視」，只看到已發布給店長的活動（ALL、SM），看不到 SUP／INV／DRAFT；
//  3. 打開活動規劃，門市只有被任命的 VW001。
// 桌機 1440 與手機 390 各跑一次；資料只用 VW/ZT 測試門市與 2099 年活動。

let fx: CvFixtures;
test.beforeAll(async () => {
  test.setTimeout(180_000);
  fx = await setupCv01(['A_single_mgr', 'K_no_perm']);
});
test.afterAll(async () => {
  if (!fx) return;
  expect(await fx.teardown(), '清除 fixture').toEqual([]);
});

async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}

async function pageFor(browser: import('@playwright/test').Browser, key: string) {
  const api = await apiForUser(fx.users[key]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}

test('店長：導覽有活動檢視；每月人員狀態只看到發布給店長的活動與任命門市', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const ctx = await pageFor(browser, 'A_single_mgr');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await openMenu(page);
    await expect(page.locator('.workspace-menu .catalog-item[title="活動檢視"]')).toBeVisible();
    await expect(page.locator('a.catalog-item[title^="活動管理"]')).toHaveCount(0); // 只有 view_own：沒有管理頁入口
    await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
    await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    await page.getByLabel('月份').fill('2099-05');
    await page.getByRole('button', { name: '查詢人員' }).click();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    await page.getByRole('button', { name: '活動檢視' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`${fx.namePrefix}-SM`)).toBeVisible();
    await expect(dialog.getByText(`${fx.namePrefix}-ALL`)).toBeVisible();
    for (const hidden of ['SUP', 'INV', 'DRAFT']) await expect(dialog.getByText(`${fx.namePrefix}-${hidden}`)).toHaveCount(0);
    await dialog.getByRole('row', { name: new RegExp(`${fx.namePrefix}-SM`) }).getByRole('button', { name: '查看活動規劃' }).click();
    await expect(dialog.getByText(fx.stores.VW001.name).first()).toBeVisible();
    await expect(dialog.getByText(fx.stores.ZT01.name)).toHaveCount(0);
    if (mobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('無權限帳號：導覽沒有活動檢視', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await pageFor(browser, 'K_no_perm');
  try {
    const page = await ctx.newPage();
    await openMenu(page);
    await expect(page.locator('.workspace-menu .catalog-item[title="活動檢視"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
