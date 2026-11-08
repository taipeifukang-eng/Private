import { expect, test } from '@playwright/test';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { assertCalendarBaseline, calTitle, cleanupCalendar, googleConnection, googleLinks, mockControl, mockReset, mockSnapshot, seedCompanyEvent } from '../support/m5-calendar-fixtures';
import { cell, contextFor, dayPanel, openCalendar, watchErrors } from '../support/m5-calendar-ui';

// W24 e2e：Google 同步的畫面流程（全部 mock，D17）。
//  連結：點「連結 Google」導向 Google 授權頁（以 page.route 攔截，不連真實 Google），模擬 Google 導回回調網址，畫面顯示已連結並完成首次同步；
//  Q20：同步失敗與授權失效時，頁頂常駐警示（只有管理者看得到）；Q19：取消公司行事時 Google 事件真的刪除；中斷連結。
// 桌機 1440 與手機 390 各跑一次；Google 連線只有一列（id=1），前後都還原。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(['cal_creator', 'cal_editor', 'cal_google', 'cal_all']);
  users = s.users;
  teardownUsers = s.teardown;
});
test.afterAll(async () => {
  const probe = await apiForUser(users.cal_google).catch(() => null);
  if (probe) {
    await mockReset(probe).catch(() => undefined);
    await probe.dispose();
  }
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});
const eventBody = (tag: string, over: Record<string, unknown> = {}) => ({
  title: calTitle(tag), event_type: 'meeting', start_date: '2099-03-10', end_date: '2099-03-10', is_all_day: true, ...over,
});

test('連結 Google：導向授權頁（只要最小權限）、導回後顯示已連結並完成首次同步；頁頂沒有警示', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  // 前一個 project（桌機）留下的連線與 mock 狀態先清掉，讓兩個 project 都從「尚未連結」開始
  const reset = await apiForUser(users.cal_google);
  if (await googleConnection()) await reset.post('/api/workspace/calendar/google/disconnect', { data: {} });
  await mockReset(reset);
  await reset.dispose();
  const creator = await apiForUser(users.cal_creator);
  await seedCompanyEvent(creator, `e2e-before-connect-${testInfo.project.name}`);
  await creator.dispose();

  const ctx = await contextFor(browser, users.cal_google);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openCalendar(page, '2099-03-10');
    const panel = page.getByTestId('google-panel');
    await expect(panel).toContainText('尚未連結');

    let authUrl = '';
    // D17：不連真實 Google。Playwright 不會攔截伺服器 307 轉過去的網址（實測會真的連到 accounts.google.com），
    // 所以攔截的是「連結」這個請求本身：由測試取回伺服器的 307 與它設定的 state cookie，改回一個假的授權頁；其他 google 網域的請求一律中止。
    const external: string[] = [];
    await ctx.route(/^https?:\/\/([^/]*\.)?(google\.com|googleapis\.com|gstatic\.com)\//, async (route) => {
      external.push(route.request().url());
      await route.abort();
    });
    await ctx.route('**/api/organization/calendar/google/connect', async (route) => {
      const res = await route.fetch({ maxRedirects: 0 });
      authUrl = res.headers()['location'] || '';
      const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
      await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'set-cookie': cookies }, body: '<html><body>mock google consent</body></html>' });
    });
    await panel.getByRole('link', { name: '連結 Google' }).click();
    await expect.poll(() => authUrl, { timeout: 15_000 }).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    const u = new URL(authUrl);
    expect(u.searchParams.get('scope')!.split(' ')).toContain('https://www.googleapis.com/auth/calendar.events.owned');
    expect(u.searchParams.get('scope')).not.toMatch(/auth\/calendar(\s|$)/); // 不要求整個日曆權限
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3002/api/organization/calendar/google/callback');

    // 模擬使用者在 Google 按同意後，Google 把瀏覽器導回「回調網址」
    await page.goto(`/api/organization/calendar/google/callback?code=mock-code&state=${encodeURIComponent(u.searchParams.get('state')!)}`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/workspace\/index\.html#\/work\//); // 舊網址 /organization/calendar 已轉到新版
    await expect(page.getByTestId('calendar-notice')).toContainText('已連結並同步');
    await expect(page.getByTestId('google-panel')).toContainText('已連結');
    await expect(page.getByTestId('google-panel')).toContainText('授權帳號：mock-google@example.test');
    await expect(page.getByTestId('google-panel').getByRole('button', { name: '立即同步' })).toBeVisible();
    await expect(page.getByTestId('google-banner')).toHaveCount(0);
    expect((await mockSnapshot(await apiForUser(users.cal_google))).events.some((e) => e.summary?.includes('e2e-before-connect'))).toBe(true);
    expect(await noPageOverflow(page)).toBe(true);
    expect(external).toEqual([]); // 瀏覽器沒有發出任何 google 網域的請求（連真實 Google 一律中止並讓測試失敗）
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q20：同步失敗時頁頂常駐警示「有 N 筆待同步」（只有管理者看得到）；補同步成功後警示消失', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const control = await apiForUser(users.cal_google);
  const creator = await apiForUser(users.cal_creator);
  await mockControl(control, { failTitles: ['FAILME'] });
  const r = await creator.post('/api/workspace/calendar/company-events', { data: eventBody(`e2e-FAILME-${testInfo.project.name}`) });
  expect(r.status()).toBe(201);
  expect((await r.json()).googleSync.status).toBe('failed');

  const ctx = await contextFor(browser, users.cal_google);
  const nonManager = await contextFor(browser, users.cal_editor);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-03-10');
    const banner = page.getByTestId('google-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('有 1 筆行事待同步到 Google');
    // 在頁面最上方（標題之上）
    const bannerBox = (await banner.boundingBox())!;
    const headingBox = (await page.getByRole('heading', { name: '年度行事曆', exact: true }).boundingBox())!;
    expect(bannerBox.y).toBeLessThan(headingBox.y);
    await expect(page.getByTestId('google-panel')).toContainText('1 筆待同步');

    // 沒有 Google 管理權限的人看不到警示
    const other = await nonManager.newPage();
    await applyProjectViewport(other, testInfo);
    await openCalendar(other, '2099-03-10');
    await expect(other.getByTestId('google-banner')).toHaveCount(0);
    await expect(other.getByTestId('google-panel')).toHaveCount(0);

    // 立即同步：Google 仍然拒絕那一筆 -> 訊息說明有失敗，警示還在
    await page.getByTestId('google-panel').getByRole('button', { name: '立即同步' }).click();
    await expect(page.getByTestId('calendar-notice')).toContainText('1 筆失敗');
    await expect(banner).toContainText('有 1 筆行事待同步到 Google');
    // 排除問題後再同步：警示消失
    await mockControl(control, { failTitles: [] });
    await page.getByTestId('google-panel').getByRole('button', { name: '立即同步' }).click();
    await expect(page.getByTestId('calendar-notice')).toContainText('已同步');
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('google-panel')).not.toContainText('筆待同步');
  } finally {
    await ctx.close();
    await nonManager.close();
    await control.dispose();
    await creator.dispose();
  }
});

test('Q20：授權失效時頁頂警示說明要重新連結；立即同步按鈕收起、重新連結變醒目；檢查授權顯示失敗原因', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const control = await apiForUser(users.cal_google);
  const creator = await apiForUser(users.cal_creator);
  await mockControl(control, { tokenInvalid: true });
  const r = await creator.post('/api/workspace/calendar/company-events', { data: eventBody(`e2e-authfail-${testInfo.project.name}`) });
  expect((await r.json()).googleSync.message).toContain('授權已失效');
  const ctx = await contextFor(browser, users.cal_google);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-03-10');
    const banner = page.getByTestId('google-banner');
    await expect(banner).toContainText('Google 授權已失效');
    await expect(banner).toContainText('筆行事待同步到 Google');
    const panel = page.getByTestId('google-panel');
    await expect(panel).toContainText('授權需更新');
    await expect(panel.getByRole('button', { name: '立即同步' })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: '重新連結' })).toHaveClass(/attention/);
    await expect(panel).toContainText('同步待處理：Google 授權已失效');
    await panel.getByRole('button', { name: '檢查授權' }).click();
    await expect(panel.getByRole('alert')).toContainText('授權已失效');

    // 重新授權後（這裡以 Google 恢復正常 + 管理者按同步代替重新走一次授權）警示消失
    await mockControl(control, { tokenInvalid: false });
    const sync = await control.post('/api/workspace/calendar/google/sync', { data: {} });
    expect(sync.status()).toBe(200);
    await openCalendar(page, '2099-03-10');
    await expect(page.getByTestId('google-banner')).toHaveCount(0);
    await expect(page.getByTestId('google-panel')).toContainText('已連結');
    await panel.getByRole('button', { name: '檢查授權' }).click();
    await expect(panel).toContainText('Google 回報包含日曆事件寫入權限');
  } finally {
    await ctx.close();
    await control.dispose();
    await creator.dispose();
  }
});

test('Q19：在畫面取消公司行事，Google 上的對應事件真的被刪除；別人手動建立的事件不動', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const control = await apiForUser(users.cal_google);
  const creator = await apiForUser(users.cal_creator);
  await mockControl(control, { addEvents: [{ id: `human-${testInfo.project.name}`, summary: '同事手動建立' }] });
  const seeded = await seedCompanyEvent(creator, `e2e-cancel-${testInfo.project.name}`, { start_date: '2099-03-15', end_date: '2099-03-15' });
  const googleId = async () => (await googleLinks()).find((l) => l.source_key === `company:${seeded.id}`)?.google_event_id;
  const id = await googleId();
  expect(id).toBeTruthy();
  expect((await mockSnapshot(control)).events.some((e) => e.id === id)).toBe(true);

  const ctx = await contextFor(browser, users.cal_all);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-03-15');
    const entry = dayPanel(page).locator('li[data-source="company"]').filter({ hasText: seeded.title });
    await entry.getByRole('button', { name: '取消行事' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: '取消公司行事' })).toContainText('Google 日曆上對應的事件會一併刪除');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('calendar-notice')).toContainText('公司行事已取消');
    await expect(cell(page, '2099-03-15')).not.toContainText(seeded.title);
    const snap = await mockSnapshot(control);
    expect(snap.events.some((e) => e.id === id)).toBe(false);
    expect(snap.events.some((e) => e.id === `human-${testInfo.project.name}`)).toBe(true);
    expect(snap.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/events/${id}`))).toBe(true);
  } finally {
    await ctx.close();
    await control.dispose();
    await creator.dispose();
  }
});

test('中斷連結：先確認，說明 Google 上已同步的行程不會刪除；中斷後回到尚未連結，事件仍在 Google 上', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const control = await apiForUser(users.cal_google);
  const before = (await mockSnapshot(control)).events.length;
  expect(before).toBeGreaterThan(0);
  const ctx = await contextFor(browser, users.cal_google);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-03-10');
    const panel = page.getByTestId('google-panel');
    await panel.getByRole('button', { name: '解除連結' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '解除 Google 連結' });
    await expect(dialog).toContainText('已同步到 Google 的行程不會刪除');
    await dialog.getByRole('button', { name: '保留連結' }).click();
    expect(await googleConnection()).not.toBeNull();
    await panel.getByRole('button', { name: '解除連結' }).click();
    await dialog.getByRole('button', { name: '確定解除' }).click();
    await expect(page.getByTestId('calendar-notice')).toContainText('既有 Google 行事保留不刪除');
    await expect(panel).toContainText('尚未連結');
    expect(await googleConnection()).toBeNull();
    expect((await mockSnapshot(control)).events.length).toBe(before);
  } finally {
    await ctx.close();
    await control.dispose();
  }
});
