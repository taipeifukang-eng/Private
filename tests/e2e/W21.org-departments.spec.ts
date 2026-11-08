import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import {
  activeManagerIds,
  activeMemberIds,
  addMember,
  cleanupM5Org,
  createAuthUser,
  orgName,
  profileDepartment,
  seedOrgTree,
  seedWork,
  unitRow,
  type OrgTree,
} from '../support/m5-org-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W21 e2e（M5 Q10、Q11、人員職掌統計抽屜、組織圖卡片）：
//  停用部門在畫面上調整成員與主管（含移出）、改名不動人員資料的部門文字、兩個頁面都能開人員職掌抽屜。
// 桌機 1440 與手機 390 各跑一次。資料只用本次建立、代碼 M5W21-<RUNID> 的組織單位與 m5p-test-* 帳號。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let tree: OrgTree;
let p1: { id: string; email: string };
let p2: { id: string; email: string };
let p3: { id: string; email: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['org_full']);
  users = s.users;
  teardownUsers = s.teardown;
  await cleanupM5Org(Object.values(users).map((u) => u.id));
  tree = await seedOrgTree();
  p1 = await createAuthUser('w21-e-p1');
  p2 = await createAuthUser('w21-e-p2');
  p3 = await createAuthUser('w21-e-p3');
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
const unitButton = (page: Page, tag: string) => page.locator('.unit-button').filter({ has: page.getByText(orgName(tag), { exact: true }) });
async function openOrganization(page: Page) {
  await openFromMenu(page, '公司組織');
  await expect(page.getByRole('heading', { name: '公司組織', exact: true })).toBeVisible();
  await page.getByLabel('包含停用單位').check();
}
async function saveEditor(page: Page) {
  await page.getByRole('button', { name: '儲存組織資料' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '確認儲存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '組織資料已儲存' })).toBeVisible({ timeout: 30_000 });
}

test('Q10：停用的部門在畫面上仍可設定成員與主管，也能移出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'org_full');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openOrganization(page);
    await unitButton(page, 'B').click();
    await expect(page.getByRole('heading', { level: 2, name: orgName('B'), exact: true })).toBeVisible();
    await expect(page.getByText('停用 · 含下層共')).toBeVisible();

    // 設定成員：加入 p3
    await page.getByRole('button', { name: '設定成員', exact: true }).click();
    await expect(page.getByRole('heading', { name: '設定成員', exact: true })).toBeVisible();
    await expect(page.getByText('此操作目前無權限')).toHaveCount(0);
    await page.getByLabel('搜尋人員').fill(p3.email);
    await page.locator('.people-list label.person input').first().check();
    await saveEditor(page);
    expect(await activeMemberIds(tree.deptB)).toEqual([p3.id]);

    // 移出成員
    await page.locator('.selected-person').getByRole('button', { name: '移除' }).click();
    await saveEditor(page);
    expect(await activeMemberIds(tree.deptB)).toEqual([]);

    // 設定主管：回公司組織頁再進主管
    await openOrganization(page);
    await unitButton(page, 'B').click();
    await page.getByRole('button', { name: '設定主管', exact: true }).click();
    await expect(page.getByRole('heading', { name: '設定主管', exact: true })).toBeVisible();
    await page.getByLabel('搜尋人員').fill(p3.email);
    await page.locator('.people-list label.person input').first().check();
    await saveEditor(page);
    expect(await activeManagerIds(tree.deptB)).toEqual([p3.id]);
    await page.getByRole('button', { name: '移除' }).first().click();
    await saveEditor(page);
    expect(await activeManagerIds(tree.deptB)).toEqual([]);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q11：在畫面上把部門改名，人員資料的部門文字維持舊名稱', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'org_full');
  const before = await unitRow(tree.deptC);
  try {
    // 先讓 p2 成為部門 C 的成員（種子帳號沒有在 C），確認同步文字是目前名稱
    await addMember(tree.deptC, p2.id);
    expect(await profileDepartment(p2.id)).toBe(before.name);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openOrganization(page);
    await unitButton(page, 'C').click();
    await page.getByRole('button', { name: '編輯單位', exact: true }).click();
    await expect(page.getByRole('heading', { name: '編輯組織單位', exact: true })).toBeVisible();
    const renamed = orgName('C-renamed');
    await page.getByLabel('單位名稱').fill(renamed);
    await page.getByRole('button', { name: '儲存組織資料' }).click();
    await expect(page.getByRole('status').filter({ hasText: '組織資料已儲存' })).toBeVisible({ timeout: 30_000 });
    expect((await unitRow(tree.deptC)).name).toBe(renamed);
    expect(await profileDepartment(p2.id), '改名不同步人員資料').toBe(before.name);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('人員職掌統計：部門管理的成員表與公司組織都能開抽屜，數字只算該部門的有效職掌', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'org_full');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    const checkDrawer = async () => {
      const drawer = page.getByTestId('person-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('stat-PRIMARY')).toHaveText('2');
      await expect(drawer.getByTestId('stat-COLLABORATOR')).toHaveText('1');
      await expect(drawer.getByTestId('stat-BACKUP')).toHaveText('0');
      await expect(drawer).toContainText(orgName('A')); // 部門名稱
      await expect(drawer).toContainText(orgName('work-a1'));
      await expect(drawer).toContainText(orgName('work-a2'));
      await expect(drawer).not.toContainText(orgName('work-c1')); // 別的部門不給
      await expect(drawer).not.toContainText(orgName('work-a-off')); // 停用職掌不算
      await expect(drawer).not.toContainText('工作交接');
      await drawer.getByRole('button', { name: '關閉' }).click();
      await expect(drawer).toHaveCount(0);
    };

    // 部門管理
    await openFromMenu(page, '部門管理');
    await page.getByLabel('搜尋部門').fill('M5W21-');
    await page.locator('tbody tr').filter({ has: page.getByText(orgName('A'), { exact: true }) }).getByRole('button', { name: '開啟部門' }).click();
    await page.getByRole('button', { name: '成員', exact: true }).click();
    await expect(page.getByTestId('count-PRIMARY')).toHaveText('2');
    await expect(page.getByTestId('count-COLLABORATOR')).toHaveText('1');
    await expect(page.getByTestId('count-BACKUP')).toHaveText('0');
    await page.getByTestId('member-row').getByRole('button').click();
    await checkDrawer();

    // 公司組織
    await openOrganization(page);
    await unitButton(page, 'A').click();
    await page.getByTestId('member-link').click();
    await checkDrawer();
    // 非部門類型（總部）的成員不提供抽屜
    await unitButton(page, 'HQ').click();
    await expect(page.getByTestId('member-link')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
