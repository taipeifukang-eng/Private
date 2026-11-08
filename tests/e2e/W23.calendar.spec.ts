import { expect, test, type Page } from '@playwright/test';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAuthUser, createPlainRole, grantRole } from '../support/m5-org-fixtures';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import {
  assertCalendarBaseline,
  auditRows,
  calTitle,
  cleanupCalendar,
  mockControl,
  mockReset,
  personalEventRow,
  publishedImports,
  seedResignedEmployee,
} from '../support/m5-calendar-fixtures';
import { cell, contextFor, dayPanel, openCalendar, watchErrors } from '../support/m5-calendar-ui';

// W23 e2e：年度行事曆的操作流程（桌機 1440 與手機 390）。
//  公司行事新增、修改、取消與異動紀錄；個人行程新增並分享、被分享的人只能看、撤回；Q18 搜尋排除停用與離職；
//  Q21 政府假日匯入：第一次直接發布，再次匯入先顯示差異、發布前二次確認。人事總處日曆為 mock（D17）。
// 行事資料只用保留年度 2099；標題帶測試標記，結束時只刪自己建立的資料。

const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const extra: string[] = [];
const uniq = () => Math.random().toString(36).slice(2, 8);
const Q18 = `Q18E${uniq()}`;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  const probe = await apiForUser(users.cal_plain);
  await mockReset(probe);
  await probe.dispose();
});
test.afterAll(async () => {
  for (const id of extra) await adminDb().auth.admin.deleteUser(id);
  const probe = await apiForUser(users.cal_plain).catch(() => null);
  if (probe) {
    await mockReset(probe).catch(() => undefined);
    await probe.dispose();
  }
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});
test.describe.configure({ mode: 'serial' });

async function submitForm(page: Page) {
  await page.getByTestId('event-form').getByRole('button', { name: /建立行事|儲存變更/ }).click();
}

test('公司行事：新增、修改成指定時間、查看異動紀錄、取消；取消的確認提到 Google；畫面與資料一致', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, users.cal_editor);
  const title = calTitle('e2e-company');
  let id = '';
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openCalendar(page, '2099-05-12');
    // 檢查：空白名稱被預檢擋下
    await page.getByRole('button', { name: '新增公司行事' }).click();
    const form = page.getByTestId('event-form');
    await expect(form).toBeVisible();
    await form.getByLabel('名稱').fill('   ');
    await submitForm(page);
    await expect(form.getByRole('alert')).toContainText('請輸入行事名稱');
    // 新增
    await form.getByLabel('名稱').fill(title);
    await form.locator('select[name="event_type"]').selectOption('activity');
    await form.getByLabel('地點（選填）').fill('第一會議室');
    await form.getByLabel('補充說明').fill('e2e 說明');
    await submitForm(page);
    await expect(page.getByTestId('calendar-notice')).toContainText('行事已建立');
    await expect(cell(page, '2099-05-12')).toContainText(title);
    const row = (await adminDb().from('organization_calendar_events').select('id,event_type,location,status').eq('title', title).single()).data;
    id = row.id;
    expect(row).toMatchObject({ event_type: 'activity', location: '第一會議室', status: 'active' });

    // 修改：改成指定時間
    const entry = dayPanel(page).locator('li[data-source="company"]').filter({ hasText: title });
    await entry.getByRole('button', { name: '編輯', exact: true }).click();
    await expect(form.getByLabel('名稱')).toHaveValue(title);
    await form.getByLabel('全天').uncheck();
    await form.getByLabel('開始時間').fill('09:30');
    await form.getByLabel('結束時間').fill('11:00');
    await submitForm(page);
    await expect(page.getByTestId('calendar-notice')).toContainText('行事已更新');
    await expect(cell(page, '2099-05-12')).toContainText('09:30');
    await expect(entry).toContainText('09:30-11:00');

    // 異動紀錄：新增、修改兩筆，修改那筆列出「時間方式 全天 → 指定時間」
    await entry.getByRole('button', { name: '異動紀錄' }).click();
    const history = page.getByTestId('history-dialog');
    await expect(history.getByTestId('history-row')).toHaveCount(2);
    await expect(history).toContainText('新增 ·');
    await expect(history).toContainText('全天 → 指定時間');
    await history.getByRole('button', { name: '關閉' }).click();

    // 取消：先看到確認（提到 Google 日曆上的事件會一併刪除），按保留不動
    await entry.getByRole('button', { name: '取消行事' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '取消公司行事' });
    await expect(confirm).toContainText('Google 日曆上對應的事件會一併刪除');
    await confirm.getByRole('button', { name: '保留行事' }).click();
    expect((await adminDb().from('organization_calendar_events').select('status').eq('id', id).single()).data.status).toBe('active');
    await entry.getByRole('button', { name: '取消行事' }).click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('calendar-notice')).toContainText('公司行事已取消');
    await expect(cell(page, '2099-05-12')).not.toContainText(title);
    expect((await auditRows(id)).map((a) => a.action)).toEqual(['created', 'updated', 'cancelled']);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('個人行程：新增並分享給同事；被分享的人看得到但不能改；建立者撤回後對方看不到', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const friend = await createAuthUser(`w23-e2e-friend-${uniq()}`);
  extra.push(friend.id);
  await adminDb().from('profiles').update({ full_name: `${Q18}friend` }).eq('id', friend.id);
  // 給一個沒有任何權限的角色：沒有任何角色的帳號登入後會是「帳號待管理員開通」說明頁（Q15），不是行事曆
  await grantRole(friend.id, (await createPlainRole(`w23e2e${uniq()}`)).id);
  const title = calTitle('e2e-personal');
  const owner = await contextFor(browser, users.cal_plain);
  const friendCtx = await contextFor(browser, { key: 'friend', id: friend.id, email: friend.email, password: friend.password });
  try {
    const page = await owner.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openCalendar(page, '2099-06-08');
    await page.getByRole('button', { name: '新增個人行程' }).click();
    const form = page.getByTestId('event-form');
    await form.getByLabel('名稱').fill(title);
    // 分享對象：輸入至少兩個字才會搜尋
    const picker = form.getByTestId('people-picker');
    await picker.getByRole('textbox').fill(Q18.slice(0, 1));
    await expect(picker.getByRole('listbox')).toHaveCount(0);
    await picker.getByRole('textbox').fill(`${Q18}friend`);
    await picker.getByRole('listbox').getByRole('button', { name: new RegExp(`${Q18}friend`) }).click();
    await expect(picker.locator('.chip')).toContainText(`${Q18}friend`);
    await submitForm(page);
    await expect(page.getByTestId('calendar-notice')).toContainText('行事已建立');
    await expect(cell(page, '2099-06-08')).toContainText(title);
    const eventId = (await adminDb().from('organization_personal_calendar_events').select('id').eq('title', title).single()).data.id as string;

    // 對方看得到，但沒有編輯與刪除，只有「轉分享」
    const other = await friendCtx.newPage();
    await applyProjectViewport(other, testInfo);
    await openCalendar(other, '2099-06-08');
    const seen = dayPanel(other).locator('li[data-source="personal"]').filter({ hasText: title });
    await expect(seen).toBeVisible();
    await expect(seen.getByRole('button', { name: '編輯', exact: true })).toHaveCount(0);
    await expect(seen.getByRole('button', { name: '刪除' })).toHaveCount(0);
    await expect(seen.getByRole('button', { name: '轉分享' })).toBeVisible();

    // 建立者開分享視窗，撤回（要確認）
    const mine = dayPanel(page).locator('li[data-source="personal"]').filter({ hasText: title });
    await mine.getByRole('button', { name: '管理分享' }).click();
    const dialog = page.getByTestId('share-dialog');
    await expect(dialog).toContainText(`${Q18}friend`);
    await expect(dialog).toContainText('可查看');
    await dialog.getByRole('button', { name: /撤回分享給/ }).click();
    const sure = page.getByRole('dialog').filter({ hasText: '撤回分享' });
    await expect(sure).toContainText('由此轉分享出去的對象都將無法查看');
    await sure.getByRole('button', { name: '確定撤回' }).click();
    await expect(page.getByTestId('share-dialog')).toContainText('已失效');
    await page.getByTestId('share-dialog').getByRole('button', { name: '關閉' }).click();
    await openCalendar(other, '2099-06-08');
    await expect(cell(other, '2099-06-08')).not.toContainText(title);

    // 建立者自己改標題、再刪除
    await mine.getByRole('button', { name: '編輯', exact: true }).click();
    await form.getByLabel('名稱').fill(`${title} 改`);
    await submitForm(page);
    await expect(page.getByTestId('calendar-notice')).toContainText('行事已更新');
    expect((await personalEventRow(eventId))?.title).toBe(`${title} 改`);
    await dayPanel(page).locator('li[data-source="personal"]').getByRole('button', { name: '刪除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '確定刪除' }).click();
    await expect(page.getByTestId('calendar-notice')).toContainText('個人行程已刪除');
    expect(await personalEventRow(eventId)).toBeNull();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
    await friendCtx.close();
  }
});

test('Q18：分享對象搜尋只列出在職同事；停用與離職的人不會出現，畫面提示原因', async ({ browser }, testInfo) => {
  const mk = async (tag: string, o: { ban?: boolean; code?: string } = {}) => {
    const u = await createAuthUser(`w23-e2e-${tag}-${uniq()}`, { ban: o.ban, employeeCode: o.code });
    extra.push(u.id);
    await adminDb().from('profiles').update({ full_name: `${Q18}${tag}` }).eq('id', u.id);
    return u;
  };
  const code = `ZTTW23${uniq().toUpperCase()}`;
  await mk('active');
  await mk('banned', { ban: true });
  await mk('resigned', { code });
  await seedResignedEmployee(code, `${Q18}resigned`);
  const ctx = await contextFor(browser, users.cal_plain);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-06-09');
    await page.getByRole('button', { name: '新增個人行程' }).click();
    const picker = page.getByTestId('event-form').getByTestId('people-picker');
    await picker.getByRole('textbox').fill(Q18);
    const list = picker.getByRole('listbox');
    await expect(list.getByRole('button', { name: new RegExp(`${Q18}active`) })).toBeVisible();
    await expect(list.getByRole('button', { name: new RegExp(`${Q18}banned`) })).toHaveCount(0);
    await expect(list.getByRole('button', { name: new RegExp(`${Q18}resigned`) })).toHaveCount(0);
    // 只剩停用的人符合時：沒有結果並說明原因
    await picker.getByRole('textbox').fill(`${Q18}banned`);
    await expect(picker).toContainText('沒有符合的人員（已停用或離職的人不會出現）');
  } finally {
    await ctx.close();
  }
});

test('Q21 政府假日：第一次匯入直接發布；再次匯入先看差異，發布前二次確認，返回核對不會改資料', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, users.cal_holiday);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    const control = await apiForUser(users.cal_holiday);
    await mockControl(control, { csvVariant: 'base' });
    await openCalendar(page, '2099-01-01');
    await expect(page.getByText('尚無 2099 年政府假日資料')).toBeVisible();
    await page.getByTestId('holiday-import-open').click();
    const dialog = page.getByTestId('holiday-import');
    await dialog.getByRole('button', { name: '從人事總處載入' }).click();
    await expect(dialog).toContainText('辨識到 5 筆日期');
    await expect(dialog).toContainText('2099 年目前沒有發布版本，這是第一次匯入');
    await expect(dialog.getByTestId('holiday-diff')).toHaveCount(0);
    await dialog.getByRole('button', { name: '確認發布' }).click(); // 第一次：沒有二次確認
    await expect(page.getByTestId('calendar-notice')).toContainText('2099 年政府假日資料已發布（5 筆）');
    await expect(page.getByTestId('holiday-source')).toContainText('假日來源：');
    await expect(cell(page, '2099-01-01')).toContainText('開國紀念日');
    await expect(page.getByTestId('holiday-import-open')).toHaveText('更新假日資料');
    const first = (await publishedImports()).filter((i) => i.status === 'published');
    expect(first).toHaveLength(1);

    // 再次匯入（官方日曆有更新）
    await mockControl(control, { csvVariant: 'changed' });
    await page.getByTestId('holiday-import-open').click();
    await dialog.getByRole('button', { name: '從人事總處載入' }).click();
    await expect(dialog.getByTestId('holiday-diff')).toBeVisible();
    await expect(dialog.getByTestId('holiday-diff-summary')).toHaveText('新增 1 筆、移除 1 筆、改名 2 筆、改類型 1 筆');
    await expect(dialog.getByTestId('holiday-diff')).toContainText('2099/10/10 國慶日');
    await expect(dialog.getByTestId('holiday-diff')).toContainText('2099/02/19 春節');
    await expect(dialog.getByTestId('holiday-diff')).toContainText('開國紀念日 → 元旦');
    const snapshotBefore = (await publishedImports()).map((i) => `${i.id}:${i.status}`);
    await dialog.getByRole('button', { name: '確認發布' }).click();
    const confirm = page.getByTestId('holiday-confirm');
    await expect(confirm).toContainText('發布後舊版本會被取代');
    await expect(confirm).toContainText('新增 1 筆、移除 1 筆、改名 2 筆、改類型 1 筆');
    // 返回核對：資料庫沒有變
    await page.getByRole('dialog').filter({ hasText: '確認取代現有版本' }).getByRole('button', { name: '返回核對' }).click();
    expect((await publishedImports()).map((i) => `${i.id}:${i.status}`)).toEqual(snapshotBefore);
    expect((await publishedImports()).filter((i) => i.status === 'published')[0].id).toBe(first[0].id);
    await dialog.getByRole('button', { name: '確認發布' }).click();
    await page.getByRole('dialog').filter({ hasText: '確認取代現有版本' }).getByRole('button', { name: '確認取代' }).click();
    await expect(page.getByTestId('calendar-notice')).toContainText('2099 年政府假日資料已發布（5 筆）');
    await expect(cell(page, '2099-01-01')).toContainText('元旦');
    await page.getByRole('button', { name: '全年清單' }).click();
    await expect(page.getByTestId('year-list')).toContainText('國慶日');
    // 二月原本 3 筆（補行上班、2/18、2/19），2/19 被移除後剩 2 筆
    await expect(page.getByTestId('year-list').locator('section.year-month').nth(1).getByTestId('month-count')).toHaveText('2');
    const imports = await publishedImports();
    expect(imports.map((i) => i.status).sort()).toEqual(['published', 'superseded']);
    expect(imports.find((i) => i.status === 'published')!.id).not.toBe(first[0].id);
    await control.dispose();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('全年清單的每月件數與畫面月曆、資料庫一致', async ({ browser }, testInfo) => {
  const ctx = await contextFor(browser, users.cal_plain);
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openCalendar(page, '2099-01-01');
    await page.getByRole('button', { name: '全年清單' }).click();
    const counts = await page.getByTestId('month-count').allTextContents();
    expect(counts).toHaveLength(12);
    const api = await apiForUser(users.cal_plain);
    const data = await (await api.get('/api/workspace/calendar?year=2099')).json();
    await api.dispose();
    const expected = Array.from({ length: 12 }, (_, m) =>
      [...data.companyEvents, ...data.personalEvents].filter((e: any) => Number(e.start_date.slice(5, 7)) === m + 1).length +
      data.holidays.filter((h: any) => Number(h.holiday_date.slice(5, 7)) === m + 1).length);
    expect(counts.map(Number)).toEqual(expected);
    expect(expected[0]).toBeGreaterThanOrEqual(1); // 一月有假日（元旦）
  } finally {
    await ctx.close();
  }
});
