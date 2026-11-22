import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slName, testStoreIds, type M6User } from '../support/m6-fixtures';
import { taipeiDate } from '../../lib/supervisor-management-log/workspace-rules';

/**
 * M6 第三批 3b W32：督導管理日誌多角色劇本（桌機 1440、手機 390 各跑一次）。
 * 角色：sl_none（沒有督導日誌權限，沒有入口）、sl_sup_a（督導，管轄 VW001）、sl_sup_b（另一位督導，API 種子）、sl_team（只有看團隊，VW001）、sl_manager（管理者）。
 * 劇本：督導建立案件 -> 寫管理紀錄 -> 追蹤 -> 今日工作台建立規劃並開始處理（帶入紀錄表單）-> 完成 -> 結案；團隊檢視者看得到區域案件但沒有任何編輯按鈕；
 *   督導看不到別人的案件；管理者看全部、重新開啟並刪除別人的案件，刪除留下時間線事件。
 * 語音錄音與 AI 摘要（W33）不在這一頁，不在本劇本內。
 */
const db = adminDb();
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Supervisor();
  ({ users, teardown } = await setupM6Users(['sl_none', 'sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_manager']));
  sid = await testStoreIds();
});
test.afterAll(async () => {
  await cleanupM6Supervisor(db, Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left).toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  const api = await apiForUser(users[who]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator('.workspace-menu button.catalog-item[title="督導管理日誌"]');
async function openLog(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: '督導管理日誌', exact: true })).toBeVisible();
  await expect(page.locator('.sml-page [data-testid=tier]')).toBeVisible();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const root = (page: Page) => page.locator('.sml-page');
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
const message = (page: Page, text: string) => expect(root(page).locator('[data-testid=message]')).toContainText(text);
const caseCard = (page: Page, title: string) => root(page).locator(`[data-case="${title}"]`);
const toCases = async (page: Page) => { await root(page).locator('[data-testid=tab-cases]').click(); await expect(root(page).locator('[data-testid=cases]')).toBeVisible(); };
const toToday = async (page: Page) => { await root(page).locator('[data-testid=tab-today]').click(); await expect(root(page).locator('[data-testid=today]')).toBeVisible(); };
const caseRow = async (title: string) => (await db.from('supervisor_management_cases').select('*').eq('title', title).maybeSingle()).data as any;
const detailOf = (page: Page, title: string): Locator => page.getByRole('dialog', { name: title, exact: true });

test('無權限者沒有入口；督導建立到結案、團隊檢視唯讀、管理者看全部並刪除別人的案件', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const title = slName(`${tag}-JOURNEY`);
  const otherTitle = slName(`${tag}-OTHER-SUP`);
  const t = taipeiDate(new Date());
  const problems: string[] = [];

  // ---- 無權限者：選單沒有入口，直接打 API 也被擋
  {
    const ctx = await ctxFor(browser, 'sl_none');
    const page = await ctx.newPage();
    try {
      await openMenu(page);
      await expect(page.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
      await expect(menuItem(page), 'sl_none 不應看到督導管理日誌').toHaveCount(0);
      expect((await ctx.request.get('/api/workspace/supervisor-management/cases')).status()).toBe(403);
    } finally {
      await ctx.close();
    }
  }

  // ---- 另一位督導（API 種子）建立 VW002 的案件，後面驗證可見範圍
  {
    const apiB = await apiForUser(users.sl_sup_b);
    try {
      const r = await apiB.post('/api/workspace/supervisor-management/cases', { data: { title: otherTitle, target_type: 'STORE', store_id: sid.VW002, target_name_snapshot: 'VW002 測試門市' } });
      expect(r.status()).toBe(201);
    } finally {
      await apiB.dispose();
    }
  }

  // ---- 督導 A：建立案件、紀錄、追蹤、今日規劃、結案
  const supCtx = await ctxFor(browser, 'sl_sup_a');
  const sup = await supCtx.newPage();
  watch(sup, problems);
  try {
    await openLog(sup);
    await expect(root(sup).locator('[data-testid=tier]')).toContainText('自己建立或指派給自己');
    if (mobile) expect(await noOverflow(sup), '手機今日工作台不橫向溢出').toBe(true);
    await root(sup).locator('[data-testid=new-case]').click();
    const form = sup.getByRole('dialog', { name: '新增督導管理案件' });
    await form.getByLabel('案件標題').fill(title);
    await form.locator('select[name=store_id]').selectOption(sid.VW001);
    await expect(form.locator('input[name=target_name_snapshot]')).toHaveValue(/VW001/);
    await form.getByLabel('摘要').fill('陳列與效期檢視');
    await form.getByRole('button', { name: '建立案件' }).click();
    await expect(sup.getByRole('dialog')).toHaveCount(0);
    await message(sup, '督導管理案件已建立');
    await expect(caseCard(sup, title)).toBeVisible();
    const created = await caseRow(title);
    expect(created).toMatchObject({ owner_user_id: users.sl_sup_a.id, status: 'OPEN', store_id: sid.VW001 });
    // 別人（督導 B）的案件看不到
    await expect(caseCard(sup, otherTitle)).toHaveCount(0);
    if (mobile) expect(await noOverflow(sup), '手機案件清單不橫向溢出').toBe(true);

    // 開啟案件 -> 新增管理紀錄（三欄缺一不可儲存）
    await caseCard(sup, title).click();
    const detail = detailOf(sup, title);
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-detail-status]')).toHaveText('待處理');
    await detail.locator('[data-act=add-record]').click();
    const rec = sup.getByRole('dialog', { name: '新增管理紀錄' });
    await rec.getByLabel('發現或觀察').fill('效期品未下架');
    await rec.getByLabel('管理判斷').fill('流程未落實');
    await rec.getByRole('button', { name: '儲存紀錄' }).click();
    await expect(rec.getByRole('alert')).toContainText('都要填寫');
    await rec.getByLabel('管理動作').fill('現場說明並限期改善');
    await rec.getByRole('checkbox', { name: '限期改善' }).check();
    await rec.getByLabel('需要追蹤').check();
    await rec.locator('input[name=follow_up_date]').fill(t);
    await rec.getByLabel('預期結果').fill('下週全數下架');
    await rec.getByRole('button', { name: '儲存紀錄' }).click();
    await expect(sup.getByRole('dialog', { name: '新增管理紀錄' })).toHaveCount(0);
    await message(sup, '管理紀錄已新增');
    await expect(detail.locator('[data-record="現場說明並限期改善"]')).toBeVisible();
    await expect(detail.locator('[data-testid=timeline]')).toContainText('新增管理紀錄');
    expect(((await db.from('supervisor_management_records').select('*').eq('case_id', created.id)).data || []).length).toBe(1);

    // 編輯自己的紀錄
    await detail.locator('[data-record="現場說明並限期改善"] [data-act=edit-record]').click();
    const recEdit = sup.getByRole('dialog', { name: '編輯管理紀錄' });
    await recEdit.getByLabel('管理判斷').fill('流程未落實，已再次說明');
    await recEdit.getByRole('button', { name: '儲存紀錄' }).click();
    await message(sup, '管理紀錄已更新');
    await expect(detail).toContainText('流程未落實，已再次說明');

    // 追蹤
    await detail.locator('[data-act=add-followup]').click();
    const fu = sup.getByRole('dialog', { name: '新增追蹤結果' });
    await fu.getByLabel('結果說明').fill('已改善一半，下週再看');
    await fu.getByRole('button', { name: '儲存追蹤' }).click();
    await message(sup, '追蹤結果已新增');
    await expect(detail.locator('[data-followup="已改善一半，下週再看"]')).toBeVisible();
    expect(((await db.from('supervisor_management_followups').select('id').eq('case_id', created.id)).data || []).length).toBe(1);

    // 編輯案件：下次追蹤日設為今天，狀態改為改善中
    await detail.locator('[data-act=edit-case]').click();
    const edit = sup.getByRole('dialog', { name: '編輯案件' });
    await edit.locator('select[name=status]').selectOption('IMPROVING');
    await edit.locator('input[name=next_follow_up_at]').fill(t);
    await edit.getByRole('button', { name: '儲存' }).click();
    await message(sup, '案件已更新');
    await expect(detail.locator('[data-detail-status]')).toHaveText('改善中');
    await detail.getByRole('button', { name: '關閉' }).click();
    await expect(detail).toHaveCount(0);

    // 今日工作台：追蹤佇列「今天到期」有這個案件；建立規劃（關聯案件）、開始處理帶入紀錄表單、完成
    await toToday(sup);
    await expect(root(sup).locator('[data-bucket=today]')).toContainText(title);
    const planTitle = slName(`${tag}-PLAN`);
    await root(sup).locator('[data-testid=new-plan]').click();
    const plan = sup.getByRole('dialog', { name: '新增今日管理規劃' });
    await plan.getByLabel('今日管理事項').fill(planTitle);
    await plan.locator('select[name=store_id]').selectOption(sid.VW001);
    await plan.locator('select[name=linked_case_id]').selectOption(created.id);
    await plan.getByRole('button', { name: '儲存規劃' }).click();
    await message(sup, '今日管理規劃已建立');
    const planCard = root(sup).locator(`[data-plan="${planTitle}"]`);
    await expect(planCard.locator('[data-plan-status]')).toHaveText('尚未開始');
    if (mobile) expect(await noOverflow(sup), '手機今日工作台有資料時不橫向溢出').toBe(true);
    await planCard.getByRole('button', { name: '開始處理' }).click();
    const rec2 = sup.getByRole('dialog', { name: '新增管理紀錄' });
    await expect(rec2.getByLabel('發現或觀察')).toHaveValue(planTitle);
    await rec2.getByLabel('管理判斷').fill('依規劃現場檢視');
    await rec2.getByLabel('管理動作').fill('現場確認完成');
    await rec2.getByRole('button', { name: '儲存紀錄' }).click();
    await message(sup, '管理紀錄已新增');
    await detailOf(sup, title).getByRole('button', { name: '關閉' }).click();
    await expect(planCard.locator('[data-plan-status]')).toHaveText('處理中');
    await planCard.locator('[data-act=done]').click();
    await expect(planCard.locator('[data-plan-status]')).toHaveText('已完成');
    await expect(planCard.locator('[data-act=del-plan]'), '完成後本人不能再刪').toHaveCount(0);
    const planRow = (await db.from('supervisor_management_daily_plans').select('*').eq('title', planTitle).single()).data as any;
    expect(planRow).toMatchObject({ status: 'DONE', linked_case_id: created.id, owner_user_id: users.sl_sup_a.id });
    expect(planRow.started_at && planRow.completed_at).toBeTruthy();
    await expect(root(sup).locator('[data-stat=records]')).toHaveText('2');

    // 結案：狀態改為已結案後，本人不再有編輯、新增、刪除按鈕
    await toCases(sup);
    await caseCard(sup, title).click();
    await detail.locator('[data-act=edit-case]').click();
    await sup.getByRole('dialog', { name: '編輯案件' }).locator('select[name=status]').selectOption('CLOSED');
    await sup.getByRole('dialog', { name: '編輯案件' }).getByRole('button', { name: '儲存' }).click();
    await message(sup, '案件已更新');
    await expect(detail.locator('[data-detail-status]')).toHaveText('已結案');
    for (const act of ['edit-case', 'add-record', 'add-followup', 'del-case', 'edit-record', 'del-record', 'del-followup']) await expect(detail.locator(`[data-act=${act}]`), `結案後本人沒有 ${act}`).toHaveCount(0);
    const closed = await caseRow(title);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closed_at && closed.resolved_at).toBeTruthy();
    await detail.getByRole('button', { name: '關閉' }).click();
  } finally {
    await supCtx.close();
  }

  // ---- 團隊檢視者：看得到管轄門市（VW001）的案件與紀錄，沒有任何編輯入口，看不到 VW002 的案件
  const teamCtx = await ctxFor(browser, 'sl_team');
  const team = await teamCtx.newPage();
  watch(team, problems);
  try {
    await openLog(team);
    await expect(root(team).locator('[data-testid=tier]')).toContainText('負責門市');
    await expect(root(team).locator('[data-testid=new-case]')).toHaveCount(0);
    await toCases(team);
    await expect(caseCard(team, title)).toBeVisible();
    await expect(caseCard(team, otherTitle)).toHaveCount(0);
    await caseCard(team, title).click();
    const d = detailOf(team, title);
    await expect(d.locator('[data-detail-status]')).toHaveText('已結案');
    await expect(d.locator('[data-record]')).toHaveCount(2);
    for (const act of ['edit-case', 'add-record', 'add-followup', 'del-case', 'edit-record', 'del-record', 'del-followup']) await expect(d.locator(`[data-act=${act}]`), `團隊檢視者沒有 ${act}`).toHaveCount(0);
    await expect(d.locator('[data-testid=timeline]')).toContainText('建立案件');
    if (mobile) expect(await noOverflow(team), '手機團隊檢視不橫向溢出').toBe(true);
  } finally {
    await teamCtx.close();
  }

  // ---- 管理者：看到所有人的案件，重新開啟並刪除別人的案件，留下時間線事件
  const mgrCtx = await ctxFor(browser, 'sl_manager');
  const mgr = await mgrCtx.newPage();
  watch(mgr, problems);
  try {
    await openLog(mgr);
    await expect(root(mgr).locator('[data-testid=tier]')).toContainText('全部案件');
    await toCases(mgr);
    await root(mgr).locator('[data-testid=case-search]').fill(slName(tag));
    await expect(caseCard(mgr, title)).toBeVisible();
    await expect(caseCard(mgr, otherTitle)).toBeVisible();
    await caseCard(mgr, title).click();
    const d = detailOf(mgr, title);
    // 已結案：管理者仍能編輯（重新開啟）與刪除；也能改別人的紀錄
    await d.locator('[data-act=edit-case]').click();
    await mgr.getByRole('dialog', { name: '編輯案件' }).locator('select[name=status]').selectOption('OPEN');
    await mgr.getByRole('dialog', { name: '編輯案件' }).getByRole('button', { name: '儲存' }).click();
    await message(mgr, '案件已更新');
    await expect(d.locator('[data-detail-status]')).toHaveText('待處理');
    await expect(d.locator('[data-testid=timeline]')).toContainText('案件狀態變更');
    await d.locator('[data-record="現場說明並限期改善"] [data-act=edit-record]').click();
    await mgr.getByRole('dialog', { name: '編輯管理紀錄' }).getByLabel('管理判斷').fill('管理者補充判斷');
    await mgr.getByRole('dialog', { name: '編輯管理紀錄' }).getByRole('button', { name: '儲存紀錄' }).click();
    await message(mgr, '管理紀錄已更新');
    // 刪除一筆別人的紀錄（要輸入原因）
    await d.locator('[data-record="現場確認完成"] [data-act=del-record]').click();
    const delRec = mgr.getByRole('dialog', { name: '刪除管理紀錄' });
    await delRec.getByRole('button', { name: '確定刪除' }).click();
    await expect(delRec.getByRole('alert')).toContainText('刪除原因');
    await delRec.getByLabel('刪除原因').fill('重複登錄');
    await delRec.getByRole('button', { name: '確定刪除' }).click();
    await message(mgr, '已刪除管理紀錄');
    await expect(d.locator('[data-record="現場確認完成"]')).toHaveCount(0);
    await expect(d.locator('[data-testid=timeline]')).toContainText('刪除督導管理紀錄');
    // 刪除整個案件
    await d.locator('[data-act=del-case]').click();
    const delCase = mgr.getByRole('dialog', { name: '刪除案件' });
    await delCase.getByLabel('刪除原因').fill('測試案件清理');
    await delCase.getByRole('button', { name: '確定刪除' }).click();
    await message(mgr, '已刪除案件');
    await expect(detailOf(mgr, title)).toHaveCount(0);
    await expect(caseCard(mgr, title)).toHaveCount(0);
    await expect(caseCard(mgr, otherTitle)).toBeVisible();
    if (mobile) expect(await noOverflow(mgr), '手機管理者清單不橫向溢出').toBe(true);
  } finally {
    await mgrCtx.close();
  }

  // 軟刪除：資料還在、留原因與時間線事件，紀錄與追蹤一併標記
  const gone = await caseRow(title);
  expect(gone.deleted_at).not.toBeNull();
  expect([gone.deleted_by, gone.deletion_reason]).toEqual([users.sl_manager.id, '測試案件清理']);
  const evs = ((await db.from('supervisor_management_case_events').select('*').eq('case_id', gone.id)).data || []) as any[];
  expect(evs.map((e) => e.event_type).sort()).toEqual(expect.arrayContaining(['SOFT_DELETE', 'RECORD_SOFT_DELETE', 'STATUS_CHANGE']));
  expect(evs.find((e) => e.event_type === 'SOFT_DELETE')).toMatchObject({ body: '測試案件清理', actor_user_id: users.sl_manager.id });
  const recs = ((await db.from('supervisor_management_records').select('deleted_at,deletion_reason').eq('case_id', gone.id)).data || []) as any[];
  expect(recs.length).toBe(2);
  expect(recs.every((r) => r.deleted_at)).toBe(true);
  expect(problems, `頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});
