import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { openGaCenter, noPageOverflow } from '../support/g01-ui';
import { dialog, pick } from '../support/g12-ui';
import { makePng } from '../support/png';
import {
  actionFormInView, attachments, balanceOf, db, dialogFits, gaNav, isPhone, ledgerOf, openAs, openCenter, openMyRequest, openWo, openWorkbenchRequest, realErrors, reqByNo, reqRow, submitForm, vis, woEvents, woRow, woUpdates,
} from '../support/g18-journey';

// M7/M8 第 5 批 G18.journey-repair 角色接力劇本「店長報修 → 總務受理轉工單 → 工務處理領料 → 門市確認結案」（桌機 project 跑一次；店長手機 390、總務與工務桌機 1440）。
//  第一輪：店長（手機）新增維修需求 → 總務（桌機）在需求工作台受理並分流「維修派工」→ 自動建工單 → 工務（桌機）在工單中心更新進度、上傳進度照片、在工單內領用料件
//   （超過庫存被擋、缺庫存交易權限與缺料件查看權限被擋；庫存扣減、流水記工單編號）→ 送門市確認（之後不能再存進度或領料）→ 店長在我的追蹤確認完成 → 工單與需求單同為結案，沒有重新開啟。
//  第二輪：另一張單走到待門市確認 → 店長回報仍有問題（須原因）→ 工單回到「門市反映仍有問題」→ 工務重新處理並再送確認 → 店長確認 → 結案。
// 每一步都回讀資料庫驗證工單、需求單、庫存與時間軸一致；結束只清自己建立的資料（含庫存流水）。
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let part: any;
let loc: any;
let sid: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_store_a', 'wo_store_b', 'wo_manager', 'wo_works', 'wo_works_notxn', 'wo_works_nopart', 'wo_viewall']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
  const cat = await seedCategory('part', 'JR');
  part = await seedPart(cat.id, 'JR-水龍頭');
  loc = await seedLocation(null, 'JR-W');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件、庫存流水）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

/** 工單中心的「不能領用」說明：缺哪個權限講清楚（UI 與 API 一致）。 */
async function expectIssueBlocked(browser: any, who: 'wo_works_notxn' | 'wo_works_nopart', title: string, missing: string, woId: string) {
  const u = await openAs(browser, states[who], 'desktop');
  try {
    await openCenter(u.page);
    await openWo(u.page, title);
    await expect(vis(u.page, 'act-issue-part')).toHaveCount(0);
    await expect(vis(u.page, 'reason-issue-part')).toContainText(missing);
    const c = await apiForUser(users[who] as any);
    const w = await woRow(woId);
    const r = await c.post(`${N}/work-orders/${woId}/issue-part`, { data: { location_id: loc.id, part_id: part.id, quantity: 1, idempotency_key: `jr-block-${who}`, expected_updated_at: w.updated_at } });
    expect(r.status(), who).toBe(403);
    expect(JSON.stringify(await r.json())).toContain(missing);
    await c.dispose();
    expect(realErrors(u.errors)).toEqual([]);
  } finally {
    await u.ctx.close();
  }
}

test('第一輪：店長（手機）報修 → 總務受理轉工單 → 工務進度與照片、工內領料（超量與缺權限被擋）→ 送門市確認 → 店長確認 → 結案（沒有重新開啟）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用店長手機＋總務與工務桌機，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  const title = m7Name('JR-A 洗手台漏水');
  let no = '';
  let reqId = '';
  let woId = '';

  // ---------------------------------------------------------------- 1. 店長（手機 390）新增維修需求
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store.page);
    await gaNav(store.page, '新增需求');
    await store.page.getByTestId('type-repair').check();
    if (!(await store.page.getByTestId('f-store').inputValue())) await store.page.getByTestId('f-store').selectOption({ index: 1 });
    await store.page.getByTestId('f-kind').selectOption('UNKNOWN');
    await store.page.getByTestId('f-title').fill(title);
    await store.page.getByTestId('f-description').fill('洗手台下方一直滴水，地板濕了');
    expect(await noPageOverflow(store.page)).toBe(true);
    await store.page.getByTestId('create-submit').click();
    await expect(store.page.getByTestId('create-done')).toBeVisible();
    no = (await store.page.getByTestId('created-no').textContent())!.trim();
    const r = await reqByNo(no);
    reqId = r.id;
    expect(r).toMatchObject({ request_type: 'REPAIR', main_status: 'PENDING_INTAKE', store_id: sid.VW001, created_by: users.wo_store_a.id });
    expect(r.maintenance_request_id).toBeNull();
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }

  // ---------------------------------------------------------------- 2. 總務（桌機）受理並分流維修派工，自動建工單
  const ga = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openGaCenter(ga.page);
    await gaNav(ga.page, '總務需求工作台');
    await openWorkbenchRequest(ga.page, no);
    await dialog(ga.page).getByTestId('act-accept').click();
    await ga.page.getByTestId('f-route').selectOption('REPAIR_DISPATCH');
    await ga.page.getByTestId('f-role').selectOption('WORKS');
    await ga.page.getByTestId('action-submit').click();
    await expect(ga.page.getByTestId('detail-notice')).toBeVisible();
    const r = await reqRow(reqId);
    expect(r).toMatchObject({ main_status: 'ACCEPTED', intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' });
    woId = r.maintenance_request_id;
    expect(woId).toBeTruthy();
    expect(await woRow(woId)).toMatchObject({ status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW', ga_service_request_id: reqId, store_id: sid.VW001, reported_by: users.wo_store_a.id, title });
    expect((await woEvents(woId)).map((e) => e.event_type)).toEqual(['ACCEPT']);
    // 需求單詳情的工單摘要（階段、前往工單）
    await expect(dialog(ga.page).getByTestId('wo-summary')).toBeVisible();
    await expect(dialog(ga.page).getByTestId('wos-goto')).toBeVisible();
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }

  // ---------------------------------------------------------------- 3. 工務（桌機）：進度、照片、領料
  const works = await openAs(browser, states.wo_works, 'desktop');
  try {
    await openCenter(works.page);
    await openWo(works.page, 'JR-A');
    await expect(vis(works.page, 'wo-request-no')).toHaveText(no);
    await expect(vis(works.page, 'wo-stage')).toHaveText('初步評估');
    // 更新進度（快捷鈕）
    await vis(works.page, 'act-progress').click();
    await dialog(works.page).getByTestId('quick-vendor-contacted').click();
    await expect(dialog(works.page).getByTestId('f-stage')).toHaveValue('WAITING_VENDOR_REPLY');
    await submitForm(works.page, '進度已更新');
    expect(await woRow(woId)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_VENDOR_REPLY' });
    expect((await reqRow(reqId)).main_status).toBe('IN_PROGRESS'); // 需求單同步進入處理中
    // 再更新一次進度（階段改成「廠商施工中」）
    await vis(works.page, 'act-progress').click();
    await dialog(works.page).getByTestId('f-stage').selectOption('VENDOR_WORKING');
    await dialog(works.page).getByTestId('f-notes').fill('廠商已到場更換水龍頭');
    await submitForm(works.page, '進度已更新');
    expect(await woRow(woId)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
    // 上傳進度照片（新照片走共用附件、簽名網址載得出來）
    await works.page.locator('[data-testid="wo-detail"]:visible').getByTestId('upload-input').setInputFiles({ name: `${M7_FILE_PREFIX}jr-progress.png`, mimeType: 'image/png', buffer: makePng({ width: 120, height: 80, inkPixels: 30 }) });
    await vis(works.page, 'wo-upload').click();
    await expect(vis(works.page, 'wo-notice')).toContainText('照片已上傳');
    const img = vis(works.page, 'wo-photo').first().locator('img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    expect((await attachments(woId)).filter((a) => !a.deleted_at)).toHaveLength(1);

    // 領用料件：超過庫存被擋、沒扣庫存
    await vis(works.page, 'act-issue-part').click();
    await dialogFits(works.page);
    await pick(dialog(works.page), '領用位置', '領用位置選項', loc.name, loc.name);
    await pick(dialog(works.page), /^料件/, '料件選項', part.name, part.name);
    await dialog(works.page).getByTestId('f-qty').fill('100');
    await dialog(works.page).getByTestId('wo-submit').click();
    await expect(dialog(works.page).getByTestId('wo-form-error')).toBeVisible();
    expect(await balanceOf(loc.id, part.id)).toBe(10);
    expect(await ledgerOf(woId)).toHaveLength(0);
    // 領 3 個：庫存扣減、流水記工單編號、用料清單、時間軸事件
    await dialog(works.page).getByTestId('f-qty').fill('3');
    await dialog(works.page).getByTestId('f-part-reason').fill('更換水龍頭');
    await dialog(works.page).getByTestId('wo-submit').click();
    await expect(vis(works.page, 'wo-notice')).toContainText('已領用料件');
    expect(await balanceOf(loc.id, part.id)).toBe(7);
    const tx = await ledgerOf(woId);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ reference_type: 'MAINTENANCE_REQUEST', reference_id: woId, part_id: part.id, location_id: loc.id });
    expect(Number(tx[0].quantity_base)).toBe(-3);
    await expect(vis(works.page, 'wo-part-row')).toHaveCount(1);
    expect((await woEvents(woId)).map((e) => e.event_type)).toContain('PART_ISSUED');
    expect(await noPageOverflow(works.page)).toBe(true);

    // 送門市確認：工單與需求單一起進入待門市確認；之後不能再存進度、領料
    await vis(works.page, 'act-completion').click();
    await dialog(works.page).getByTestId('f-notes').fill('水龍頭已更換，請確認不再漏水');
    await submitForm(works.page, '已送門市確認');
    expect(await woRow(woId)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' });
    await expect(vis(works.page, 'act-progress')).toHaveCount(0);
    await expect(vis(works.page, 'act-issue-part')).toHaveCount(0);
    await expect(vis(works.page, 'wo-next-step')).toContainText('已送門市確認');
    // 沒扣兩次、沒多寫流水
    expect(await balanceOf(loc.id, part.id)).toBe(7);
    expect(await ledgerOf(woId)).toHaveLength(1);
    expect(realErrors(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }

  // ---------------------------------------------------------------- 3b. 缺權限被擋（缺庫存交易管理、缺料件查看；店長與只有查看者）
  await expectIssueBlocked(browser, 'wo_works_notxn', 'JR-A', '庫存交易管理', woId);
  await expectIssueBlocked(browser, 'wo_works_nopart', 'JR-A', '料件查看', woId);
  const sc = await apiForUser(users.wo_store_a as any);
  const vc = await apiForUser(users.wo_viewall as any);
  const issueBody = { location_id: loc.id, part_id: part.id, quantity: 1, idempotency_key: 'jr-blocked', expected_updated_at: (await woRow(woId)).updated_at };
  expect((await sc.post(`${N}/work-orders/${woId}/issue-part`, { data: issueBody })).status()).toBe(403);
  expect((await vc.post(`${N}/work-orders/${woId}/issue-part`, { data: issueBody })).status()).toBe(403);
  await sc.dispose();
  await vc.dispose();
  expect(await balanceOf(loc.id, part.id)).toBe(7);

  // ---------------------------------------------------------------- 4. 店長（手機）在我的追蹤確認完成
  const store2 = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store2.page);
    await gaNav(store2.page, '我的追蹤');
    await expect(store2.page.getByTestId('waiting-hint')).toBeVisible();
    await store2.page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
    await openMyRequest(store2.page, no);
    await expect(dialog(store2.page).getByTestId('wo-summary')).toBeVisible(); // 工單摘要：階段與最新公開進度
    await dialogFits(store2.page);
    await store2.page.getByTestId('act-confirm_complete').click();
    await actionFormInView(store2.page); // 手機 390：表單自動捲進畫面、焦點在第一個輸入框
    await store2.page.getByTestId('action-submit').click();
    await expect(store2.page.getByTestId('detail-notice')).toBeVisible();
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'COMPLETED' });
    const w = await woRow(woId);
    expect(w).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    expect(w.completed_by).toBe(users.wo_store_a.id);
    expect(realErrors(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }

  // ---------------------------------------------------------------- 5. 總務確認結案狀態：結案方式標示、沒有重新開啟、用料與照片保留
  const ga2 = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openCenter(ga2.page);
    await openWo(ga2.page, 'JR-A');
    await expect(vis(ga2.page, 'wo-completion-method')).toContainText('門市確認完成');
    await expect(vis(ga2.page, 'wo-next-step')).toContainText('要重新開啟請到需求單'); // 有需求單的單：重新開啟走需求單（第 4 批），工單頁沒有按鈕
    await expect(ga2.page.getByRole('button', { name: /重新開啟/ }).locator('visible=true')).toHaveCount(0);
    for (const t of ['act-progress', 'act-completion', 'act-force-close', 'act-supplement', 'act-issue-part', 'act-store-confirm']) await expect(vis(ga2.page, t), t).toHaveCount(0);
    await expect(vis(ga2.page, 'wo-part-row')).toHaveCount(1);
    await expect(vis(ga2.page, 'wo-photo')).toHaveCount(1);
    const types = (await woEvents(woId)).map((e) => e.event_type);
    for (const t of ['ACCEPT', 'SAVE_PROGRESS', 'PART_ISSUED', 'REQUEST_COMPLETION', 'STORE_CONFIRM_COMPLETE']) expect(types, t).toContain(t);
    expect((await woUpdates(woId)).length).toBeGreaterThanOrEqual(3);
    expect(realErrors(ga2.errors)).toEqual([]);
  } finally {
    await ga2.ctx.close();
  }
});

test('第二輪：待門市確認 → 店長回報仍有問題（須原因）→ 工單回到「門市反映仍有問題」→ 工務重新處理再送確認 → 店長確認 → 結案；庫存只扣一次', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用店長手機＋總務與工務桌機，只在桌機 project 跑一次');
  test.setTimeout(600_000);
  const title = m7Name('JR-B 冷氣不冷');
  // 以 API 把前段做完（建立需求單 → 受理 → 工務存進度 → 領料 → 送確認），後段仍走畫面
  const s = await stores();
  const r0 = (await db().from('ga_service_requests').insert({ store_id: s.VW001.id, created_by: users.wo_store_a.id, request_type: 'REPAIR', title, description: '冷氣吹出來是熱風', main_status: 'PENDING_INTAKE' }).select('*').single()).data as any;
  const mc = await apiForUser(users.wo_manager as any);
  const wc = await apiForUser(users.wo_works as any);
  const acc = await mc.patch(`${N}/requests/${r0.id}`, { data: { action: 'accept', expected_updated_at: r0.updated_at, intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' } });
  expect(acc.status(), await acc.text()).toBe(200);
  const reqId = r0.id;
  const woId = (await reqRow(reqId)).maintenance_request_id as string;
  const no = r0.request_no as string;
  const step = async (path: string, data: Record<string, unknown>) => {
    const r = await wc.post(`${N}/work-orders/${woId}/${path}`, { data: { ...data, expected_updated_at: (await woRow(woId)).updated_at } });
    expect(r.status(), `${path} ${await r.text()}`).toBeLessThan(300);
  };
  await step('progress', { notes: '已請廠商檢修', progress_stage: 'VENDOR_WORKING' });
  await step('issue-part', { location_id: loc.id, part_id: part.id, quantity: 2, idempotency_key: 'jr-b-issue' });
  expect(await balanceOf(loc.id, part.id)).toBe(5);
  await step('request-completion', { notes: '已補冷媒' });
  expect(await woRow(woId)).toMatchObject({ progress_stage: 'WAITING_STORE_CONFIRMATION' });
  await mc.dispose();
  await wc.dispose();

  // 店長（手機）回報仍有問題：沒填原因被擋
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store.page);
    await gaNav(store.page, '我的追蹤');
    await store.page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
    await openMyRequest(store.page, no);
    await store.page.getByTestId('act-report_problem').click();
    await store.page.getByTestId('action-submit').click();
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' }); // 沒填原因：沒送出
    await dialog(store.page).locator('textarea').first().fill('冷氣還是不夠冷，吹出來是溫的');
    await store.page.getByTestId('action-submit').click();
    await expect(store.page.getByTestId('detail-notice')).toBeVisible();
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'IN_PROGRESS' });
    expect(await woRow(woId)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED' });
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }

  // 工務（桌機）看到「門市反映仍有問題」→ 重新處理並再送確認
  const works = await openAs(browser, states.wo_works, 'desktop');
  try {
    await openCenter(works.page);
    await openWo(works.page, 'JR-B');
    await expect(vis(works.page, 'wo-stage')).toHaveText('門市反映仍有問題');
    await expect(vis(works.page, 'wo-timeline-item').filter({ hasText: '冷氣還是不夠冷' }).first()).toBeVisible();
    await vis(works.page, 'act-progress').click();
    await dialog(works.page).getByTestId('f-stage').selectOption('VENDOR_WORKING');
    await dialog(works.page).getByTestId('f-notes').fill('已再次請廠商更換壓縮機');
    await submitForm(works.page, '進度已更新');
    expect(await woRow(woId)).toMatchObject({ status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
    await vis(works.page, 'act-completion').click();
    await dialog(works.page).getByTestId('f-notes').fill('壓縮機已更換，請再確認');
    await submitForm(works.page, '已送門市確認');
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' });
    expect(realErrors(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }

  // 店長（手機）確認 → 結案
  const store2 = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store2.page);
    await gaNav(store2.page, '我的追蹤');
    await store2.page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
    await openMyRequest(store2.page, no);
    await store2.page.getByTestId('act-confirm_complete').click();
    await actionFormInView(store2.page); // 手機 390：表單自動捲進畫面、焦點在第一個輸入框
    await store2.page.getByTestId('action-submit').click();
    await expect(store2.page.getByTestId('detail-notice')).toBeVisible();
    expect(await reqRow(reqId)).toMatchObject({ main_status: 'COMPLETED' });
    expect(await woRow(woId)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
    expect(realErrors(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }
  // 庫存只扣一次（前一輪 3 個、這一輪 2 個）；時間軸記到「仍有問題」與兩次送確認
  expect(await balanceOf(loc.id, part.id)).toBe(5);
  expect(await ledgerOf(woId)).toHaveLength(1);
  const types = (await woEvents(woId)).map((e) => e.event_type);
  expect(types.filter((t) => t === 'REQUEST_COMPLETION')).toHaveLength(2);
  expect(types).toContain('REPORT_UNRESOLVED');
  expect(types).toContain('STORE_CONFIRM_COMPLETE');
});
