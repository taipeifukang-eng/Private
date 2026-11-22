import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { deleteRunMasters, M4_MONTH, runIdOrThrow, seedMaster } from '../support/m4-fixtures';

// W13 E2E（M4 Q1–Q4）：預設月份（最新有資料）、換月份後統計只算該月已完成、草稿標記、舊版欄位、比較入口位置。
// 資料：ZT 測試門市、保留月份 2099-03／2099-04（備註帶 ZT<runId>-M4 標記，測後刪除）。

const work = (page: Page) => page.locator('section.work-page:visible');
const stat = (page: Page, key: string) => work(page).locator(`[data-stat="${key}"]`);

test.beforeAll(async () => {
  runIdOrThrow();
  const m = M4_MONTH.stats;
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${m}-05`, status: 'completed', total: 220, tag: 'e2e-a' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${m}-06`, status: 'completed', total: 175, tag: 'e2e-b', bonus: 3 });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${m}-07`, status: 'completed', total: 150, tag: 'e2e-c' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${m}-08`, status: 'draft', tag: 'e2e-d' });
  await seedMaster({ store: 'ZT02', inspector: 'admin', date: `${m}-09`, status: 'draft', tag: 'e2e-draft-only' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${M4_MONTH.latest}-03`, status: 'completed', total: 200, tag: 'e2e-latest' });
  await seedMaster({ store: 'ZT03', inspector: 'ops_manager', date: `${M4_MONTH.latest}-04`, status: 'completed', total: 200, type: 'manager', tag: 'e2e-manager' });
  await seedMaster({ store: 'ZT03', inspector: 'ops_manager', date: `${M4_MONTH.latest}-05`, status: 'draft', type: 'manager', tag: 'e2e-manager-draft' });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

test('預設停在最新有資料的月份；切到上個月後統計只算已完成；表格補回評級徽章與含改善加分', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '巡店列表');
    await expect(work(page).getByRole('heading', { name: '巡店列表' })).toBeVisible();
    // Q4：預設月份＝最新有資料的月份（2099-04），而不是今天所在月份
    await expect(work(page).getByText(`${M4_MONTH.latest} 巡店紀錄`)).toBeVisible();
    await expect(work(page).locator('input[type=month]')).toHaveValue(M4_MONTH.latest);
    // 切到 2099-03（月曆上一個月）：Q1 卡片只算所選月份、Q2 只算已完成
    await work(page).getByRole('button', { name: '上個月' }).click();
    await expect(work(page).getByText(`${M4_MONTH.stats} 巡店紀錄`)).toBeVisible();
    await expect(stat(page, 'total')).toHaveText('3');
    await expect(stat(page, 'excellent')).toHaveText('1');
    await expect(stat(page, 'good')).toHaveText('1');
    await expect(stat(page, 'improve')).toHaveText('1');
    // 表格：包含草稿在內的 5 筆（本月 ZT01 四筆＋ZT02 一筆），已完成單有評級徽章
    const rows = work(page).locator('tbody tr');
    await expect(rows).toHaveCount(5);
    const bonusRow = rows.filter({ has: page.getByTestId('bonus-note') });
    await expect(bonusRow).toHaveCount(1);
    await expect(bonusRow.getByTestId('bonus-note')).toContainText('含改善 +3');
    await expect(bonusRow.locator('td[data-col="grade"] .grade-badge')).toHaveText('6');
    await expect(rows.locator('td[data-col="grade"] .grade-badge.tone-top')).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有草稿的門市留在「尚未巡店」並標「有草稿未送出」', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openFromMenu(page, '巡店列表');
    await expect(work(page).getByText(`${M4_MONTH.latest} 巡店紀錄`)).toBeVisible();
    await work(page).locator('input[type=month]').fill(M4_MONTH.stats);
    const storeSelect = work(page).locator('form.filter-bar select').first();
    await storeSelect.selectOption((await storeSelect.locator('option', { hasText: 'ZT02' }).first().getAttribute('value'))!);
    await work(page).getByRole('button', { name: '查詢紀錄' }).click();
    await expect(work(page).getByText(`${M4_MONTH.stats} 巡店紀錄`)).toBeVisible();
    const unvisited = work(page).getByTestId('coverage-unvisited');
    await expect(unvisited).toContainText('尚未巡店（1）');
    await expect(unvisited.locator('li[data-draft="true"]')).toHaveCount(1);
    await expect(unvisited.getByText('有草稿未送出')).toBeVisible();
    await expect(work(page).getByTestId('coverage-visited')).toContainText('已巡店（0）');
  } finally {
    await ctx.close();
  }
});

test('巡店比較入口只在經理巡店分頁：表頭按鈕要有經理單；每列「比較督導巡店」只給已完成的經理單', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'ops_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openFromMenu(page, '巡店列表');
    await expect(work(page).getByRole('heading', { name: '巡店列表' })).toBeVisible();
    // 督導分頁：沒有比較入口
    await expect(work(page).getByTestId('compare-entry')).toHaveCount(0);
    await work(page).getByLabel('巡店類型').selectOption('manager');
    await work(page).getByRole('button', { name: '查詢紀錄' }).click();
    await expect(work(page).getByText(`${M4_MONTH.latest} 巡店紀錄`)).toBeVisible();
    await expect(work(page).getByTestId('compare-entry')).toBeVisible();
    const rows = work(page).locator('tbody tr');
    await expect(rows).toHaveCount(2);
    const completed = rows.filter({ hasText: '已完成' });
    await expect(completed.getByRole('button', { name: '比較督導巡店' })).toHaveCount(1);
    const draft = rows.filter({ hasText: '草稿' });
    await expect(draft.getByRole('button', { name: '比較督導巡店' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
