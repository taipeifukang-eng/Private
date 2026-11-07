import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W18 E2E（M4 Q5–Q8）。設定頁讀取以 page.route 換成固定資料（不改 DEV 的實際設定）：
//  Q8 滿分總和 220 不警告、225 警告（只警告）；Q5 評級說明；Q6 儲存前顯示等待改善筆數；Q7 前端先擋重疊（不送出 POST）。

const work = (page: Page) => page.locator('section.work-page:visible');
const grades = Array.from({ length: 11 }, (_, g) => ({ grade: g, min_score: [0, 121, 131, 141, 151, 161, 171, 181, 191, 215, 220][g] }));
const tpl = (id: string, max: number, active = true) => ({ id, section: 's1', section_name: '區塊一', section_order: 1, item_name: `項目${id}`, item_description: '', item_order: 1, max_score: max, is_active: active, checklist_items: [] });
const bonus = [
  { id: 'r1', day_from: 0, day_to: 3, bonus_score: 20, description: '3天內', sort_order: 1, is_active: true },
  { id: 'r2', day_from: 4, day_to: 5, bonus_score: 10, description: '4-5天', sort_order: 2, is_active: true },
  { id: 'r3', day_from: 6, day_to: 7, bonus_score: 5, description: '6-7天', sort_order: 3, is_active: true },
];
async function mockSettings(page: Page, templates: unknown[], pending = 7) {
  await page.route('**/api/workspace/inspection-settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { version: 1, templates, grades, bonus, pendingImprovements: pending } });
    } else {
      mockedPosts.push(route.request().url());
      await route.fulfill({ status: 500, json: { error: '不應送出' } });
    }
  });
}
let mockedPosts: string[] = [];
test.beforeEach(() => {
  mockedPosts = [];
});

test('Q8 滿分總和：220 不警告；225 醒目警告但不阻擋；停用的項目不計', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await mockSettings(page, [tpl('a', 120), tpl('b', 100), tpl('c', 30, false)]);
    await openFromMenu(page, '模板管理');
    await expect(work(page).getByTestId('score-total')).toHaveText('220');
    await expect(work(page).getByTestId('score-warning')).toHaveCount(0);
    await page.close();

    const page2 = await ctx.newPage();
    await applyProjectViewport(page2, testInfo);
    await mockSettings(page2, [tpl('a', 120), tpl('b', 105)]);
    await openFromMenu(page2, '模板管理');
    await expect(work(page2).getByTestId('score-total')).toHaveText('225');
    const warn = work(page2).getByTestId('score-warning');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('不等於 220');
    await expect(warn).toContainText('從 220 分起算');
    // 只警告：新增項目的按鈕仍可按
    await expect(work(page2).getByRole('button', { name: '新增檢查項目' })).toBeEnabled();
    expect(await noPageOverflow(page2)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('Q5／Q6：評級頁說明以完成當時為準；回補規則頁與編輯頁在儲存前顯示受影響筆數', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await mockSettings(page, [tpl('a', 220)], 7);
    await openFromMenu(page, '模板管理');
    await work(page).getByLabel('設定類別').selectOption('grades');
    await expect(work(page).getByTestId('grade-snapshot-note')).toContainText('不影響已完成的巡店單');
    await work(page).getByLabel('設定類別').selectOption('bonus');
    await expect(work(page).getByTestId('bonus-impact')).toContainText('目前有 7 筆等待改善的項目會受影響');
    await work(page).getByRole('button', { name: '編輯規則' }).first().click();
    await expect(work(page).getByTestId('bonus-impact')).toContainText('目前有 7 筆等待改善的項目會受影響');
    await expect(work(page).getByText('停用最長的規則後，日後新產生的改善期限會變短')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('Q7：新增與既有啟用規則天數重疊時，前端先擋下並說明與哪一條重疊，不送出儲存；空缺（9–10 天）可以送出', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await mockSettings(page, [tpl('a', 220)], 0);
    await openFromMenu(page, '模板管理');
    await work(page).getByLabel('設定類別').selectOption('bonus');
    await work(page).getByRole('button', { name: '新增回補規則' }).click();
    await work(page).getByLabel('起始天數').fill('2');
    await work(page).getByLabel('結束天數').fill('9');
    await work(page).getByRole('button', { name: '儲存設定' }).click();
    await expect(work(page).getByRole('alert')).toContainText('回補天數範圍不能重疊');
    await expect(work(page).getByRole('alert')).toContainText('0–3 天');
    expect(mockedPosts, '被擋下時不會送出儲存').toEqual([]);
    // 改成 9–10（與 0–7 之間有空缺）：不會被前端擋下，會送出 POST（這裡的假伺服器回 500，只確認有送出）
    await work(page).getByLabel('起始天數').fill('9');
    await work(page).getByLabel('結束天數').fill('10');
    await work(page).getByRole('button', { name: '儲存設定' }).click();
    await expect.poll(() => mockedPosts.length).toBe(1);
  } finally {
    await ctx.close();
  }
});
