import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { addMember, cleanupM5Org, createAuthUser, orgName, seedOrgTree, seedWork, type OrgTree } from '../support/m5-org-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W21 冒煙層：公司組織（樹狀／唯讀組織圖）與部門管理可從選單開啟；只有組織檢視的人選單沒有部門管理。
// 沒有 pageerror、console 錯誤與水平溢出。資料只用本次建立、代碼 M5W21-<RUNID> 的組織單位。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let tree: OrgTree;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['org_full', 'org_view']);
  users = s.users;
  teardownUsers = s.teardown;
  await cleanupM5Org(Object.values(users).map((u) => u.id));
  tree = await seedOrgTree();
  const p1 = await createAuthUser('w21-s-p1');
  const p2 = await createAuthUser('w21-s-p2');
  await addMember(tree.deptA, p1.id);
  await seedWork(tree, { u1: p1.id, u2: p2.id });
});
test.afterAll(async () => {
  expect(await cleanupM5Org(Object.values(users).map((u) => u.id)), '殘留單位').toBe(0);
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

test('公司組織：樹狀預設；切到組織圖看到唯讀卡片，點卡片換側欄；編輯中不能切到組織圖', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, 'org_full');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openFromMenu(page, '公司組織');
    await expect(page.getByRole('heading', { name: '公司組織', exact: true })).toBeVisible();
    await expect(page.getByTestId('view-tree')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('組織架構')).toBeVisible();
    await expect(page.getByText(orgName('A'), { exact: true }).first()).toBeVisible();

    await page.getByTestId('view-chart').click();
    await expect(page.getByTestId('org-chart')).toBeVisible();
    const cards = page.getByTestId('chart-card');
    await expect(cards.filter({ has: page.getByText(orgName('HQ'), { exact: true }) })).toHaveCount(1);
    await expect(cards.filter({ has: page.getByText(orgName('A'), { exact: true }) })).toHaveCount(1);
    await expect(cards.filter({ has: page.getByText(orgName('B'), { exact: true }) })).toHaveCount(0); // 預設不含停用
    await page.getByLabel('包含停用單位').check();
    await expect(cards.filter({ has: page.getByText(orgName('B'), { exact: true }) })).toHaveCount(1);
    await expect(cards.filter({ has: page.getByText(orgName('B'), { exact: true }) })).toContainText('停用');
    // 唯讀：沒有拖曳、沒有調整層級按鈕
    await expect(page.getByRole('button', { name: '調整層級' })).toHaveCount(0);
    await expect(page.locator('[draggable="true"]')).toHaveCount(0);
    // 點卡片：右側（手機在下方）單位資料換成該單位
    await cards.filter({ has: page.getByText(orgName('C'), { exact: true }) }).click();
    await expect(page.getByRole('heading', { level: 2, name: orgName('C'), exact: true })).toBeVisible();
    // 停用單位的成員／主管入口仍在（Q10）
    await cards.filter({ has: page.getByText(orgName('B'), { exact: true }) }).click();
    await expect(page.getByRole('button', { name: '設定成員', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '設定主管', exact: true })).toBeVisible();

    // 切回樹狀，進入調整層級後組織圖按鈕停用
    await page.getByTestId('view-tree').click();
    await page.getByRole('button', { name: '調整層級' }).click();
    await expect(page.getByTestId('view-chart')).toBeDisabled();
    await page.getByRole('button', { name: '取消調整' }).click();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('部門管理：選單開啟、列出部門、停用部門要勾「包含停用」；進入部門成員頁看到主責／協作／代理欄', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, 'org_full');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openFromMenu(page, '部門管理');
    await expect(page.getByRole('heading', { name: '部門管理', exact: true })).toBeVisible();
    await page.getByLabel('搜尋部門').fill('M5W21-');
    const row = (tag: string) => page.locator('tbody tr').filter({ hasText: orgName(tag) });
    await expect(row('A')).toHaveCount(1);
    await expect(row('B')).toHaveCount(0);
    await page.getByLabel('包含停用部門').check();
    await expect(row('B')).toHaveCount(1);
    await row('A').getByRole('button', { name: '開啟部門' }).click();
    await page.getByRole('button', { name: '成員', exact: true }).click();
    for (const h of ['組織角色', '主責', '協作', '代理']) await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    await expect(page.getByTestId('member-row')).toHaveCount(1);
    await expect(page.getByTestId('count-PRIMARY')).toHaveText('2');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有組織檢視的帳號：選單有公司組織、沒有部門管理（Q9）', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await contextFor(browser, 'org_view');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="公司組織"]')).toHaveCount(1);
    await expect(page.locator('.workspace-menu button.catalog-item[title="部門管理"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
