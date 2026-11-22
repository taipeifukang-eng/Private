import { expect, test } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { assertCalendarBaseline, cleanupCalendar, mockReset } from '../support/m5-calendar-fixtures';
import { contextFor, openCalendar, watchErrors } from '../support/m5-calendar-ui';

// W24 冒煙層：Google 同步區（全部 mock，D17）。管理者看得到同步區與連結鈕；沒有權限的人看不到；
// 未連結時沒有頁頂警示；畫面沒有 console 錯誤與水平溢出（桌機 1440 與手機 390）。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(['cal_plain', 'cal_google']);
  users = s.users;
  teardownUsers = s.teardown;
  const probe = await apiForUser(users.cal_plain);
  await mockReset(probe);
  await probe.dispose();
});
test.afterAll(async () => {
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

test('Google 管理者：看得到同步區（尚未連結、說明單向與加註、連結按鈕指向授權網址）；沒有警示；無錯誤無溢出', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_google);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openCalendar(page, '2099-03-10');
    const panel = page.getByTestId('google-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('尚未連結');
    await expect(panel).toContainText('單向同步公司行事與已發布政府假日');
    await expect(panel).toContainText('請勿在此修改，請回系統');
    await expect(panel).toContainText('目標日曆：mock-calendar@group.calendar.google.com');
    const link = panel.getByRole('link', { name: '連結 Google' });
    await expect(link).toHaveAttribute('href', /\/api\/organization\/calendar\/google\/connect$/);
    await expect(page.getByTestId('google-banner')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '立即同步' })).toHaveCount(0); // 未連結不能同步
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有 Google 管理權限的人：沒有同步區也沒有警示，狀態 API 回 403 不會讓畫面出錯', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_plain);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    const statusCalls: number[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/calendar/google/status') && statusCalls.push(r.status()));
    await openCalendar(page, '2099-03-10');
    await expect(page.getByTestId('google-panel')).toHaveCount(0);
    await expect(page.getByTestId('google-banner')).toHaveCount(0);
    expect(statusCalls).toEqual([]); // 根本不會去問狀態
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
