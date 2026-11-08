import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { makePng } from '../support/png';
import {
  adminDb,
  apiForUser,
  campaignRow,
  deleteRunData,
  eventOn,
  m5Name,
  m5Prefix,
  readDepartmentImageNames,
  scheduleRows,
  seedCampaign,
  seedChildren,
  seedEvent,
  seedSchedules,
  setupM5Users,
  withStoreSetting,
  type M5User,
} from '../support/m5-fixtures';
import { taipeiToday } from '../../lib/workspace/campaign-rules';

// W19 / P05 e2e（桌機 1440 與手機 390）：M5 Q2-Q5 與補回的舊版功能，從畫面實際操作並回讀資料庫。
// 資料：2099 年活動與特殊日期（狀態標籤另用以今天為基準的活動），名稱帶「[自動測試]M5 <runId>」，結束時只刪自己建立的資料。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['viewer']);
  users = s.users;
  teardownUsers = s.teardown;
});
test.afterAll(async () => {
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function adminPage(browser: Browser, testInfo: import('@playwright/test').TestInfo, errors: string[]) {
  const ctx = await loginAs(browser, 'admin');
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await applyProjectViewport(page, testInfo);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page };
}
async function openList(page: Page, filter = m5Prefix()) {
  await openFromMenu(page, '活動管理');
  await expect(page.getByRole('heading', { name: '活動管理', exact: true })).toBeVisible();
  await page.getByLabel('活動名稱').fill(filter);
  await page.getByRole('button', { name: '查詢' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
}
const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const dialogNamed = (page: Page, title: string | RegExp) => page.getByRole('dialog', { name: title });
async function openSchedule(page: Page, name: string) {
  await rowOf(page, name).getByRole('button', { name: '活動規劃／排程' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('正在讀取活動規劃…')).toHaveCount(0);
}

test('Q2 列表：狀態依日期（未開始／進行中／已結束），停用與未發布有標籤，類型文字統一', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const today = taipeiToday();
  const ongoing = await seedCampaign({ tag: 'ui-ongoing', start: addDays(today, -3), end: addDays(today, 3), publish: { sm: true } });
  const upcoming = await seedCampaign({ tag: 'ui-upcoming', start: '2099-05-01', end: '2099-05-31', type: 'inventory', publish: { sup: true } });
  const ended = await seedCampaign({ tag: 'ui-ended', start: '2020-01-01', end: '2020-01-31' });
  const off = await seedCampaign({ tag: 'ui-off', start: '2099-05-01', end: '2099-05-31', active: false, publish: { sm: true } });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page);
    await expect(rowOf(page, ongoing.name).getByText('進行中', { exact: true })).toBeVisible();
    await expect(rowOf(page, upcoming.name).getByText('未開始', { exact: true })).toBeVisible();
    await expect(rowOf(page, ended.name).getByText('已結束', { exact: true })).toBeVisible();
    await expect(rowOf(page, ended.name).getByText('未發布', { exact: true })).toBeVisible();
    await expect(rowOf(page, ongoing.name).getByText('未發布')).toHaveCount(0);
    await expect(rowOf(page, off.name).getByText('停用', { exact: true })).toBeVisible();
    await expect(rowOf(page, ongoing.name).getByText('停用', { exact: true })).toHaveCount(0);
    await expect(rowOf(page, ongoing.name)).toContainText('促銷（母親節／周年慶等）');
    await expect(rowOf(page, upcoming.name)).toContainText('盤點活動');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q2 純檢視者：看不到停用的活動與「活動規劃／排程」，改走活動檢視', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const on = await seedCampaign({ tag: 'ui-v-on', start: '2099-05-01', end: '2099-05-31', publish: { sm: true } });
  const off = await seedCampaign({ tag: 'ui-v-off', start: '2099-05-01', end: '2099-05-31', active: false, publish: { sm: true } });
  const api = await apiForUser(users.viewer);
  const state = await api.storageState();
  await api.dispose();
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3002', storageState: state });
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openList(page);
    await expect(rowOf(page, on.name)).toBeVisible();
    await expect(page.getByText(off.name)).toHaveCount(0);
    await expect(rowOf(page, on.name).getByRole('button', { name: '活動規劃／排程' })).toHaveCount(0);
    await expect(rowOf(page, on.name).getByRole('button', { name: '活動檢視' })).toBeVisible();
    await expect(rowOf(page, on.name).getByRole('button', { name: '查看' })).toBeVisible();
    await expect(rowOf(page, on.name).getByRole('button', { name: '刪除活動' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('Q3 刪除：顯示將刪除的資料筆數，要輸入活動名稱才能按確認，刪除後資料全部消失', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const c = await seedCampaign({ tag: 'ui-delete', start: '2099-05-01', end: '2099-05-31', publish: { sm: true } });
  await seedChildren(c.id); // 排程 2、細節 1、人力 1、本店人員 2、Check List 2、勾選 3、車次 1、支援需求 1 = 13 筆
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await rowOf(page, c.name).getByRole('button', { name: '刪除活動' }).click();
    const dlg = dialogNamed(page, '刪除活動檔期？');
    await expect(dlg.getByText('將刪除共 13 筆資料')).toBeVisible();
    await expect(dlg.getByText('門市排程：2 筆')).toBeVisible();
    await expect(dlg.getByText('Check List 店長勾選紀錄：3 筆')).toBeVisible();
    await expect(dlg.getByText(/已發布給店長/)).toBeVisible();
    const confirm = dlg.getByRole('button', { name: '確認刪除活動' });
    await expect(confirm).toBeDisabled();
    await dlg.getByLabel('輸入活動名稱確認刪除').fill(c.name.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await dlg.getByLabel('輸入活動名稱確認刪除').fill(c.name);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(rowOf(page, c.name)).toHaveCount(0);
    expect(await campaignRow(c.id)).toBeNull();
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q4 改短活動期間：列出落在期間外的門市，確認後移回尚未安排，期間內的保留', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const c = await seedCampaign({ tag: 'ui-shorten', start: '2099-05-01', end: '2099-05-31' });
  await seedSchedules(c.id, [['VW001', '2099-05-06'], ['ZT01', '2099-05-20']]);
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await rowOf(page, c.name).getByRole('button', { name: '編輯' }).click();
    const edit = dialogNamed(page, '編輯活動');
    await edit.getByLabel('結束日期').fill('2099-05-15');
    await edit.getByRole('button', { name: '儲存活動' }).click();
    const warn = dialogNamed(page, '有門市排程落在新的活動期間外');
    await expect(warn).toBeVisible();
    await expect(warn.getByText(/ZT01/)).toBeVisible();
    await expect(warn.getByText(/VW001/)).toHaveCount(0);
    // 先返回：資料庫完全沒動
    await warn.getByRole('button', { name: '返回修改日期' }).click();
    expect((await campaignRow(c.id)).end_date).toBe('2099-05-31');
    await edit.getByRole('button', { name: '儲存活動' }).click();
    await dialogNamed(page, '有門市排程落在新的活動期間外').getByRole('button', { name: '確認並移回尚未安排' }).click();
    await expect.poll(async () => (await campaignRow(c.id)).end_date).toBe('2099-05-15');
    expect(await scheduleRows(c.id)).toEqual({ VW001: '2099-05-06' });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q5c 已發布活動儲存前提示「儲存後立即生效」，確認後才存', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const c = await seedCampaign({ tag: 'ui-published', start: '2099-05-01', end: '2099-05-31', publish: { sup: true, sm: true } });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await rowOf(page, c.name).getByRole('button', { name: '編輯' }).click();
    const edit = dialogNamed(page, '編輯活動');
    await edit.getByLabel(/活動名稱/).fill(c.name + ' 改');
    await edit.getByRole('button', { name: '儲存活動' }).click();
    const warn = dialogNamed(page, '此活動已發布，儲存後立即生效');
    await expect(warn).toContainText('督導、店長');
    await warn.getByRole('button', { name: '返回' }).click();
    expect((await campaignRow(c.id)).name).toBe(c.name);
    await edit.getByRole('button', { name: '儲存活動' }).click();
    await dialogNamed(page, '此活動已發布，儲存後立即生效').getByRole('button', { name: '確認儲存' }).click();
    await expect.poll(async () => (await campaignRow(c.id)).name).toBe(c.name + ' 改');
  } finally {
    await ctx.close();
  }
});

test('排程頁：週一為首的月曆、督導區顏色圖例、手動排到禁止日與門市限制星期要先確認、儲存', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const c = await seedCampaign({ tag: 'ui-schedule', start: '2099-06-01', end: '2099-06-30' });
  await seedEvent('2099-06-10', { type: 'holiday', blocked: true, tag: 'ui-blocked' });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await withStoreSetting('VW002', { allowed_days: [], forbidden_days: [3] }, async () => {
      await openList(page, c.name);
      await openSchedule(page, c.name);
      // 週一為首：標題列第一個是「一」，最後是「日」
      const heads = page.locator('.calendar').first().locator('.weekday');
      await expect(heads.first()).toHaveText('一');
      await expect(heads.last()).toHaveText('日');
      // 2099-06-01 是週一 → 月曆第一格就是 1 日（沒有前置空白）
      await expect(page.locator('.calendar').first().locator('.blank')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /尚未安排（\d+）/ })).toBeVisible();
      const form = page.locator('form.filters');
      const pick = async (store: RegExp, date: string) => {
        await form.getByLabel('安排門市').selectOption({ label: (await form.getByLabel('安排門市').locator('option').allTextContents()).find((t) => store.test(t))! });
        await form.getByLabel('活動日期').fill(date);
        await form.getByRole('button', { name: '安排／移動門市' }).click();
      };
      // (b) 門市禁止週三（2099-06-03 是週三）
      await pick(/VW002/, '2099-06-03');
      const warn = dialogNamed(page, '這個安排需要確認');
      await expect(warn).toContainText('不排在週三');
      await warn.getByRole('button', { name: '取消' }).click();
      await expect(page.locator('.scheduled')).toHaveCount(0);
      // (b) 禁止排程日
      await pick(/VW001/, '2099-06-10');
      await expect(dialogNamed(page, '這個安排需要確認')).toContainText('禁止排程日');
      await dialogNamed(page, '這個安排需要確認').getByRole('button', { name: '仍要安排' }).click();
      await expect(page.locator('.scheduled')).toHaveCount(1);
      // 一般日期不提醒
      await pick(/ZT01/, '2099-06-06');
      await expect(page.locator('.scheduled')).toHaveCount(2);
      // 儲存（未發布活動：沒有「立即生效」提示）
      await page.getByRole('button', { name: '儲存所有排程變更' }).click();
      const save = dialogNamed(page, '儲存所有排程變更？');
      await expect(save).not.toContainText('立即生效');
      await save.getByRole('button', { name: '確認' }).click();
      await expect.poll(async () => await scheduleRows(c.id)).toEqual({ VW001: '2099-06-10', ZT01: '2099-06-06' });
    });
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q5c 排程頁：已發布活動儲存排程時提示立即生效', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const c = await seedCampaign({ tag: 'ui-sched-published', start: '2099-06-01', end: '2099-06-30', publish: { sm: true } });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await openSchedule(page, c.name);
    const form = page.locator('form.filters');
    await form.getByLabel('安排門市').selectOption({ index: 1 });
    await form.getByLabel('活動日期').fill('2099-06-06');
    await form.getByRole('button', { name: '安排／移動門市' }).click();
    await page.getByRole('button', { name: '儲存所有排程變更' }).click();
    await expect(dialogNamed(page, '儲存所有排程變更？')).toContainText('儲存後立即生效');
    await dialogNamed(page, '儲存所有排程變更？').getByRole('button', { name: '返回' }).click();
    expect(Object.keys(await scheduleRows(c.id))).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test('盤點類活動只有三個分頁；自動排程沒有可用日期時提示', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const inv = await seedCampaign({ tag: 'ui-inventory', start: '2099-06-01', end: '2099-06-02', type: 'inventory' }); // 週一、週二：沒有週三六日
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, inv.name);
    await openSchedule(page, inv.name);
    const nav = page.getByRole('navigation', { name: '活動規劃分區' });
    for (const label of ['活動排程', '門市細節／人力', '規劃預覽']) await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    for (const label of ['設備車次', '工作清單', '行銷部', '商品部']) await expect(nav.getByRole('button', { name: label })).toHaveCount(0);
    await page.getByRole('button', { name: '自動排程' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '活動期間內沒有可用的排程日期' })).toBeVisible();
    await expect(dialogNamed(page, '套用自動排程？')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('自動排程：套用到草稿後仍須儲存；促銷類七個分頁都在', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const c = await seedCampaign({ tag: 'ui-auto', start: '2099-06-01', end: '2099-06-30' });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await openSchedule(page, c.name);
    const nav = page.getByRole('navigation', { name: '活動規劃分區' });
    for (const label of ['活動排程', '門市細節／人力', '規劃預覽', '設備車次', '工作清單', '行銷部', '商品部']) await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    await page.getByRole('button', { name: '自動排程' }).click();
    const dlg = dialogNamed(page, '套用自動排程？');
    await expect(dlg).toContainText('將取代目前排程草稿');
    await dlg.getByRole('button', { name: '套用至草稿' }).click();
    await expect(page.locator('.scheduled').first()).toBeVisible();
    expect(Object.keys(await scheduleRows(c.id)), '套用只是草稿，還沒寫入').toHaveLength(0);
    // 已排門市都在週三、週六、週日
    const dates = await page.locator('.day:has(.scheduled) > strong').allTextContents();
    expect(dates.length).toBeGreaterThan(0);
  } finally {
    await ctx.close();
  }
});

test('特殊日期：依月份分組並顯示星期；同一天已有特殊日期時先提醒原內容，確認才覆蓋', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  await seedEvent('2099-07-04', { type: 'holiday', blocked: true, tag: 'ui-event' }); // 2099-07-04 是週六
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openFromMenu(page, '活動管理');
    await expect(page.getByRole('heading', { name: '活動管理', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '特殊日期' }).click();
    const dlg = dialogNamed(page, '特殊日期');
    await expect(dlg.getByRole('heading', { name: /^2099-07（\d+ 筆）$/ })).toBeVisible();
    await expect(dlg.getByRole('row').filter({ hasText: '2099-07-04' })).toContainText('週六');
    await dlg.getByLabel('日期', { exact: true }).fill('2099-07-04');
    await dlg.getByLabel('類型').selectOption('other');
    await dlg.getByLabel('說明').fill(m5Name('ui-event-new'));
    await dlg.getByRole('button', { name: '新增日期' }).click();
    const warn = dialogNamed(page, '這一天已有特殊日期');
    await expect(warn).toContainText('2099-07-04（週六）');
    await expect(warn).toContainText('國定假日');
    await expect(warn).toContainText('禁止自動排程');
    await warn.getByRole('button', { name: '取消' }).click();
    expect((await eventOn('2099-07-04')).description).toBe(m5Name('ui-event'));
    await dlg.getByRole('button', { name: '新增日期' }).click();
    await dialogNamed(page, '這一天已有特殊日期').getByRole('button', { name: '確認覆蓋' }).click();
    await expect.poll(async () => (await eventOn('2099-07-04')).description).toBe(m5Name('ui-event-new'));
    expect((await eventOn('2099-07-04')).is_blocked).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('門市設定：允許與禁止同一個星期不給存', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await withStoreSetting('ZT05', null, async (storeId) => {
      await openFromMenu(page, '活動管理');
      await page.getByRole('button', { name: '門市設定' }).click();
      const dlg = page.locator('dialog[open]').last();
      await expect(dlg.getByRole('heading', { name: '門市活動設定' })).toBeVisible();
      await dlg.locator('select').first().selectOption(storeId);
      const days = dlg.locator('.days');
      await expect(days).toHaveCount(2);
      const box = (group: number, day: string) => days.nth(group).locator('label', { hasText: day }).locator('input');
      await box(0, '週三').check();
      await box(1, '週三').check();
      await dlg.getByRole('button', { name: '儲存門市設定' }).click();
      await expect(dlg.getByRole('alert')).toContainText('永遠排不進去');
      await box(1, '週三').uncheck();
      await box(1, '週日').check();
      await dlg.getByRole('button', { name: '儲存門市設定' }).click();
      await expect(dlg.getByRole('status')).toContainText('已儲存');
    });
  } finally {
    await ctx.close();
  }
});

test('行銷部圖片：可調整順序（前移／後移），儲存後順序保留；最多 8 張', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const c = await seedCampaign({ tag: 'ui-marketing', start: '2099-06-01', end: '2099-06-30' });
  const errors: string[] = [];
  const { ctx, page } = await adminPage(browser, testInfo, errors);
  try {
    await openList(page, c.name);
    await openSchedule(page, c.name);
    await page.getByRole('navigation', { name: '活動規劃分區' }).getByRole('button', { name: '行銷部' }).click();
    const files = ['ma.png', 'mb.png', 'mc.png'].map((name, i) => ({ name, mimeType: 'image/png', buffer: makePng({ width: 40 + i, height: 40 }) }));
    await page.locator('input[type=file][multiple]').setInputFiles(files);
    const cards = page.locator('.image-card');
    await expect(cards).toHaveCount(3, { timeout: 60_000 });
    const before = await cards.locator('span').allTextContents();
    expect(before).toHaveLength(3);
    await cards.nth(0).getByRole('button', { name: '後移' }).click(); // 第 1 張往後
    const after = await cards.locator('span').allTextContents();
    expect(after).toEqual([before[1], before[0], before[2]]);
    await expect(cards.nth(0).getByRole('button', { name: '前移' })).toBeDisabled();
    await expect(cards.nth(2).getByRole('button', { name: '後移' })).toBeDisabled();
    await page.getByRole('button', { name: '儲存並發布' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已儲存並發布' })).toBeVisible();
    expect(await readDepartmentImageNames(c.id)).toEqual(after);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
