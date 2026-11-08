import { expect, test } from '@playwright/test';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { assertCalendarBaseline, calTitle, cleanupCalendar, mockReset, seedCompanyEvent } from '../support/m5-calendar-fixtures';
import { cell, contextFor, dayPanel, openCalendar, watchErrors } from '../support/m5-calendar-ui';

// W23 冒煙層：年度行事曆從導覽開啟是 workspace 分頁；月曆、全年清單、導覽按鈕可用；
// 各權限帳號看到的按鈕不同（三個獨立權限 + Google 管理）；舊網址 /organization/calendar 轉到新版（含 Google 回調帶來的結果）。
// 行事資料只用保留年度 2099；桌機 1440 與手機 390 各跑一次。

const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday', 'cal_google', 'cal_admin_ungranted', 'cal_all'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let company: { id: string; title: string };
let personalTitle = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  const creator = await apiForUser(users.cal_creator);
  company = await seedCompanyEvent(creator, 'smoke-company', { event_type: 'meeting', start_date: '2099-03-10', end_date: '2099-03-10', location: '總部', description: '冒煙測試' });
  await creator.dispose();
  const owner = await apiForUser(users.cal_plain);
  personalTitle = calTitle('smoke-personal');
  const r = await owner.post('/api/workspace/calendar/personal-events', { data: { title: personalTitle, start_date: '2099-03-10', end_date: '2099-03-11', is_all_day: true } });
  expect(r.status(), await r.text()).toBe(201);
  await owner.dispose();
  const probe = await apiForUser(users.cal_plain);
  await mockReset(probe);
  await probe.dispose();
});
test.afterAll(async () => {
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

test('Q17 一般同仁（沒有任何行事曆權限）：從導覽開啟，是 workspace 分頁；有月曆；沒有警示、Google 區與匯入鈕；無錯誤無溢出', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_plain);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openFromMenu(page, '年度行事曆');
    await expect(page.getByRole('heading', { name: '年度行事曆', exact: true })).toBeVisible();
    await expect(page.getByTestId('month-grid')).toBeVisible();
    // 是工作台分頁，沒有另開舊站視窗
    expect(ctx.pages()).toHaveLength(1);
    expect(page.url()).toContain('/workspace/index.html');
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
    const y = now.find((p) => p.type === 'year')!.value;
    const m = now.find((p) => p.type === 'month')!.value;
    await expect(page.getByTestId('calendar-title')).toHaveText(`${y} 年 ${m} 月`);
    const cells = await page.getByTestId('month-grid').locator('button.cell').count();
    expect(cells % 7).toBe(0);
    expect(cells).toBeGreaterThanOrEqual(28);
    await expect(page.getByTestId('google-banner')).toHaveCount(0);
    await expect(page.getByTestId('google-panel')).toHaveCount(0);
    await expect(page.getByTestId('holiday-import-open')).toHaveCount(0);
    await expect(page.getByTestId('calendar-new')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('月曆與全年清單：2099 年 3 月看得到公司行事與個人行程；上下月、上下年、今天、來源篩選、全年 12 個月清單都能用', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_plain);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openCalendar(page, '2099-03-10');
    await expect(page.getByTestId('calendar-title')).toHaveText('2099 年 3 月');
    const target = cell(page, '2099-03-10');
    await expect(target).toContainText(company.title);
    await expect(target).toContainText(personalTitle);
    // 個人行程是兩天的：隔天也有
    await expect(cell(page, '2099-03-11')).toContainText(personalTitle);
    await expect(cell(page, '2099-03-12')).not.toContainText(personalTitle);

    // 所選日期面板
    const panel = dayPanel(page);
    await expect(panel.getByText('2099/3/10', { exact: true })).toBeVisible();
    await expect(panel.locator('li[data-source="company"]')).toContainText(company.title);
    await expect(panel.locator('li[data-source="personal"]')).toContainText(personalTitle);
    await expect(panel.locator('li[data-source="company"]')).toContainText('地點：總部');

    // 來源篩選：只勾個人行程時公司行事消失
    await page.getByRole('button', { name: '公司行事', exact: true }).first().click();
    await expect(target).not.toContainText(company.title);
    await expect(target).toContainText(personalTitle);
    await page.getByRole('button', { name: '公司行事', exact: true }).first().click();
    await expect(target).toContainText(company.title);

    // 上一月、下一月、上一年、下一年
    await page.getByRole('button', { name: '下一個月' }).click();
    await expect(page.getByTestId('calendar-title')).toHaveText('2099 年 4 月');
    await page.getByRole('button', { name: '上一個月' }).click();
    await page.getByRole('button', { name: '上一個月' }).click();
    await expect(page.getByTestId('calendar-title')).toHaveText('2099 年 2 月');
    await page.getByRole('button', { name: '下一年' }).click();
    await expect(page.getByTestId('calendar-title')).toHaveText('2100 年 2 月');
    await page.getByRole('button', { name: '上一年' }).click();
    await expect(page.getByTestId('calendar-title')).toHaveText('2099 年 2 月');
    await page.getByRole('button', { name: '今天' }).click();
    await expect(page.getByTestId('calendar-title')).not.toHaveText(/2099/);

    // 全年清單：12 個月、三月有兩筆
    await openCalendar(page, '2099-03-10');
    await page.getByRole('button', { name: '全年清單' }).click();
    await expect(page.getByTestId('calendar-title')).toHaveText('2099 年');
    const months = page.getByTestId('year-list').locator('section.year-month');
    await expect(months).toHaveCount(12);
    await expect(months.nth(2).getByTestId('month-count')).toHaveText('2');
    await expect(months.nth(0).getByTestId('month-count')).toHaveText('0');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('按鈕依權限顯示：新增公司行事、修改／取消、匯入假日、Google 同步區各自獨立；管理員沒被授予就沒有編輯鈕', async ({ browser }, testInfo) => {
  // [帳號, 新增公司行事, 編輯/取消, 匯入假日, Google 區]
  const matrix: [string, boolean, boolean, boolean, boolean][] = [
    ['cal_plain', false, false, false, false],
    ['cal_creator', true, false, false, false],
    ['cal_editor', true, true, false, false],
    ['cal_holiday', false, false, true, false],
    ['cal_google', false, false, false, true],
    ['cal_admin_ungranted', false, false, false, true],
    ['cal_all', true, true, true, true],
  ];
  for (const [key, create, edit, imp, google] of matrix) {
    const ctx = await contextFor(browser, users[key]);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      await openCalendar(page, '2099-03-10');
      const panel = dayPanel(page);
      const companyRow = panel.locator('li[data-source="company"]');
      await expect(companyRow, key).toContainText(company.title);
      expect(await panel.getByRole('button', { name: '新增公司行事' }).count() > 0, `${key} 新增公司行事`).toBe(create);
      expect(await companyRow.getByRole('button', { name: '編輯', exact: true }).count() > 0, `${key} 編輯`).toBe(edit);
      expect(await companyRow.getByRole('button', { name: '取消行事' }).count() > 0, `${key} 取消行事`).toBe(edit);
      await expect(companyRow.getByRole('button', { name: '異動紀錄' }), `${key} 異動紀錄（所有人都能看）`).toBeVisible();
      expect(await page.getByTestId('holiday-import-open').count() > 0, `${key} 匯入假日`).toBe(imp);
      expect(await page.getByTestId('google-panel').count() > 0, `${key} Google 區`).toBe(google);
      // 個人行程只有建立者有編輯／刪除；其他人（含有全部權限的人）沒有
      const personalRow = panel.locator('li[data-source="personal"]');
      const own = key === 'cal_plain';
      expect(await personalRow.getByRole('button', { name: '刪除' }).count() > 0, `${key} 刪除個人行程`).toBe(own);
    } finally {
      await ctx.close();
    }
  }
});

test('舊網址 /organization/calendar 轉到新版；Google 授權回調帶來的結果顯示成訊息（成功與失敗）', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_google);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await page.goto('/organization/calendar', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/workspace\/index\.html#\/work\//); // 307 轉到「開啟頁面」後，開成工作頁籤
    await expect(page.getByTestId('calendar-page')).toBeVisible();

    await page.goto('/organization/calendar?google_calendar=connected&google_detail=' + encodeURIComponent('已連結並同步 3 筆公司行事與假日'), { waitUntil: 'networkidle' });
    await expect(page.getByTestId('calendar-notice')).toContainText('已連結並同步 3 筆公司行事與假日');

    await page.goto('/organization/calendar?google_calendar=error&google_detail=' + encodeURIComponent('已取消 Google 授權'), { waitUntil: 'networkidle' });
    await expect(page.getByRole('alert').filter({ hasText: '已取消 Google 授權' })).toBeVisible();

    await page.goto('/organization/calendar?google_calendar=connected_with_errors&google_detail=' + encodeURIComponent('已連結；2 筆完成，1 筆待重試'), { waitUntil: 'networkidle' });
    await expect(page.getByRole('alert').filter({ hasText: '1 筆待重試' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('資料庫保留資料：本測試的行事都在 2099 年，且帶測試標記', async () => {
  const { data } = await adminDb().from('organization_calendar_events').select('title,start_date').like('title', '[自動測試]M5W23 %');
  for (const r of data || []) expect(String(r.start_date).startsWith('2099-')).toBe(true);
});
