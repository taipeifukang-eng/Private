import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, m7Name, seedMaintenanceCategory, seedWorkOrder } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, visibleHeading } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { makePng } from '../support/png';
import { attachments, db, dialogFits, openAs, openWo, realErrors, submitForm, vis, woEvents, woRow } from '../support/g18-journey';

// M7/M8 第 5 批 G19.journey-legacy 角色接力劇本「總務組頁（舊式回報）」（桌機 project 跑一次；回報人手機 390、總務組處理人桌機 1440）：
//  1. 回報人（店長，手機）在「總務組」頁新增回報（標題、說明、最多 5 張照片）→ 回報人可刪自己未受理的單（附件只標記刪除）。
//  2. 處理人（桌機）受理、存進度、指定分類 → 送門市確認（舊版會報英文錯誤，新版成功）→ 處理人不能代按確認、仍有問題。
//  3. 回報人按「確認完成」→ 結案，沒有重新開啟（W8）；另一張按「仍有問題」（須原因）→ 回到「門市反映仍有問題」→ 處理人重新處理再送確認 → 回報人確認。
//  4. 刪除規則：已受理的單回報人刪不掉（說明改用強制結案）；總務組處理人可刪未受理的單。
//  5. W9：管理員沒有任何角色 → 開頁看到白話說明、列表不給資料；管理員只有「查看全部」角色 → 可看不可改，說明缺哪個權限。
// 每一步回讀資料庫驗工單、事件、附件；結束只清自己建立的資料。
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let seq = 0;
const ids: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_cross_store_a', 'wo_cross_manager', 'wo_cross_viewall', 'admin']);
  users = made.users;
  teardown = made.teardown;
  // 只有「查看全部」角色的管理員（profiles.role=admin）；沒有任何角色的管理員是 admin 帳號
  await db().from('profiles').update({ role: 'admin' }).eq('id', users.wo_cross_viewall.id);
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

const png = (n: number) => ({ name: `${M7_FILE_PREFIX}lg-${n}.png`, mimeType: 'image/png', buffer: makePng({ width: 100 + n, height: 80, inkPixels: 20 + n }) });
async function openCross(page: any) {
  await openFromMenu(page, '總務組');
  await expect(visibleHeading(page, '總務組維修')).toBeVisible();
}
async function createReport(page: any, title: string, photos: number[]) {
  await vis(page, 'wob-create').click();
  await expect(dialog(page).getByTestId('wo-create-form')).toBeVisible();
  await dialogFits(page);
  await expect(dialog(page).getByTestId('c-store')).toHaveValue(/.+/); // 只有一間門市時自動帶入
  await dialog(page).getByTestId('c-title').fill(title);
  await dialog(page).getByTestId('c-description').fill('飲水機漏水 LG');
  if (photos.length) await dialog(page).getByTestId('upload-input').setInputFiles(photos.map(png));
  await dialog(page).getByTestId('c-submit').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0); // 視窗關閉才代表送出完成（提示可能是上一次留下的）
  await expect(vis(page, 'wob-notice')).toContainText('已建立工單');
}

test('1 回報人（手機）新增回報（含 2 張照片）→ 刪自己未受理的單（附件只標記刪除）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用回報人手機＋處理人桌機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const store = await openAs(browser, states.wo_cross_store_a, 'phone');
  try {
    await openCross(store.page);
    const t1 = m7Name(`LG-A-${(seq += 1)}`);
    await createReport(store.page, t1, [1, 2]);
    const a = ((await db().from('maintenance_requests').select('*').eq('title', t1)).data || []) as any[];
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ status: 'UNACCEPTED', reported_by: users.wo_cross_store_a.id, ga_service_request_id: null });
    ids.a = a[0].id;
    expect((await attachments(ids.a)).filter((x) => !x.deleted_at)).toHaveLength(2);
    expect((await woEvents(ids.a)).map((e) => e.event_type)).toEqual(['CREATED']);
    // 第二張：回報後立刻刪掉
    const t2 = m7Name(`LG-DEL-${(seq += 1)}`);
    await createReport(store.page, t2, [3]);
    const d = ((await db().from('maintenance_requests').select('id').eq('title', t2)).data || []) as any[];
    expect(d).toHaveLength(1);
    await openWo(store.page, 'LG-DEL');
    await vis(store.page, 'act-delete').click();
    await dialogFits(store.page);
    await dialog(store.page).getByTestId('wo-submit').click();
    await expect(vis(store.page, 'wob-notice')).toContainText('工單已刪除');
    expect(await woRow(d[0].id)).toBeNull();
    const rows = await attachments(d[0].id);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).toBeTruthy(); // 只標記刪除
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});

test('2 處理人（桌機）受理並存進度、指定分類 → 送門市確認（成功，不再報錯）→ 不能代按確認或仍有問題', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const cat = await seedMaintenanceCategory('LG-CAT');
  const ga = await openAs(browser, states.wo_cross_manager, 'desktop');
  try {
    await openCross(ga.page);
    await openWo(ga.page, 'LG-A-');
    await expect(vis(ga.page, 'wo-title')).toContainText('LG-A-');
    await expect(vis(ga.page, 'wo-photo')).toHaveCount(2); // 回報人的 2 張照片
    // 沒有需求單：不顯示需求單、沒有補資料轉需求單的說明
    await expect(vis(ga.page, 'wo-request-no')).toHaveCount(0);
    // 存進度：未受理 → 自動受理並進入處理中
    await vis(ga.page, 'act-progress').click();
    await dialog(ga.page).getByTestId('f-stage').selectOption('SEARCHING_VENDOR');
    await dialog(ga.page).getByTestId('f-notes').fill('已受理，開始找廠商 LG');
    await submitForm(ga.page, '進度已更新');
    const w1 = await woRow(ids.a);
    expect(w1.status).toBe('PROCESSING');
    expect(w1.progress_stage).toBe('SEARCHING_VENDOR');
    expect(w1.accepted_by).toBe(users.wo_cross_manager.id);
    expect(w1.accepted_at).toBeTruthy();
    // 指定分類
    await vis(ga.page, 'act-category').click();
    await dialog(ga.page).getByTestId('f-category').selectOption(cat.id);
    await submitForm(ga.page, '分類已更新');
    expect((await woRow(ids.a)).category_id).toBe(cat.id);
    // 送門市確認（沒有說明也可以，預設文字）：舊版沒連需求單會報英文錯誤
    await vis(ga.page, 'act-completion').click();
    await submitForm(ga.page, '已送門市確認');
    expect(await woRow(ids.a)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    expect((await woRow(ids.a)).completion_requested_at).toBeTruthy();
    await expect(vis(ga.page, 'wo-next-step')).toContainText('已送門市確認');
    // 處理人不能代按確認或仍有問題（畫面沒有按鈕，API 擋下，資料不變）
    await expect(vis(ga.page, 'act-store-confirm')).toHaveCount(0);
    await expect(vis(ga.page, 'act-unresolved')).toHaveCount(0);
    const c = await apiForUser(users.wo_cross_manager as any);
    for (const p of ['store-confirm', 'report-unresolved']) {
      const r = await c.post(`${N}/work-orders/${ids.a}/${p}`, { data: { note: 'x', reason: 'x', expected_updated_at: (await woRow(ids.a)).updated_at } });
      expect(r.status(), p).toBeGreaterThanOrEqual(403);
    }
    await c.dispose();
    expect(await woRow(ids.a)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
});

test('3 回報人按「確認完成」→ 結案、沒有重新開啟（W8）；另一張按「仍有問題」（須原因）→ 重新處理 → 再送確認 → 確認；已受理的單刪不掉', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(480_000);
  const wait = { status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION', accepted_at: new Date().toISOString(), completion_requested_at: new Date().toISOString() };
  ids.b = (await seedWorkOrder('VW001', `LG-B-${(seq += 1)}`, users.wo_cross_store_a.id, wait)).id;
  const store = await openAs(browser, states.wo_cross_store_a, 'phone');
  try {
    await openCross(store.page);
    // A 單：確認完成
    await openWo(store.page, 'LG-A-');
    await expect(vis(store.page, 'wo-next-step')).toContainText('確認問題是否解決');
    await vis(store.page, 'act-store-confirm').click();
    await dialogFits(store.page);
    await submitForm(store.page, '已確認完成');
    expect(await woRow(ids.a)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED', completed_by: users.wo_cross_store_a.id });
    await expect(vis(store.page, 'wo-completion-method')).toContainText('門市確認完成');
    await expect(vis(store.page, 'wo-next-step')).toContainText('不能重新開啟'); // 沒有需求單的舊式單：不提供重新開啟
    await expect(store.page.getByRole('button', { name: /重新開啟/ }).locator('visible=true')).toHaveCount(0);
    for (const t of ['act-store-confirm', 'act-unresolved', 'act-progress', 'act-delete', 'act-completion']) await expect(vis(store.page, t), t).toHaveCount(0);
    // 已結案：API 也擋（不能再確認、不能刪）
    const c = await apiForUser(users.wo_cross_store_a as any);
    expect((await c.post(`${N}/work-orders/${ids.a}/store-confirm`, { data: { expected_updated_at: (await woRow(ids.a)).updated_at } })).status()).toBe(409);
    const del = await c.delete(`${N}/work-orders/${ids.a}`, { data: { expected_updated_at: (await woRow(ids.a)).updated_at } });
    expect(del.status()).toBe(409);
    await c.dispose();
    // B 單：仍有問題（須原因）
    await openWo(store.page, 'LG-B-');
    await vis(store.page, 'act-unresolved').click();
    await dialog(store.page).getByTestId('wo-submit').click();
    await expect(dialog(store.page).getByTestId('wo-form-error')).toContainText('還有什麼問題');
    expect(await woRow(ids.b)).toMatchObject({ progress_stage: 'WAITING_STORE_CONFIRMATION' });
    await dialog(store.page).getByTestId('f-notes').fill('水龍頭還是會滴水 LG');
    await submitForm(store.page, '已回報仍有問題');
    expect(await woRow(ids.b)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED', unresolved_reason: '水龍頭還是會滴水 LG' });
    // 已受理：刪不掉（畫面講原因）
    await expect(vis(store.page, 'act-delete')).toHaveCount(0);
    await expect(vis(store.page, 'reason-delete')).toContainText('已受理');
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  // 處理人重新處理 → 再送確認
  const ga = await openAs(browser, states.wo_cross_manager, 'desktop');
  try {
    await openCross(ga.page);
    await openWo(ga.page, 'LG-B-');
    await expect(vis(ga.page, 'wo-stage')).toHaveText('門市反映仍有問題');
    await vis(ga.page, 'act-progress').click();
    await dialog(ga.page).getByTestId('f-stage').selectOption('VENDOR_WORKING');
    await dialog(ga.page).getByTestId('f-notes').fill('已換水龍頭墊片 LG');
    await submitForm(ga.page, '進度已更新');
    await vis(ga.page, 'act-completion').click();
    await dialog(ga.page).getByTestId('f-notes').fill('墊片已更換，請再確認');
    await submitForm(ga.page, '已送門市確認');
    expect(await woRow(ids.b)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    // 處理人可刪未受理的單（別人回報的）：先建一張未受理單
    const un = await seedWorkOrder('VW001', `LG-GA-DEL-${(seq += 1)}`, users.wo_cross_store_a.id);
    await ga.page.reload({ waitUntil: 'networkidle' });
    await openCross(ga.page);
    await openWo(ga.page, 'LG-GA-DEL');
    await vis(ga.page, 'act-delete').click();
    await dialog(ga.page).getByTestId('wo-submit').click();
    await expect(vis(ga.page, 'wob-notice')).toContainText('工單已刪除');
    expect(await woRow(un.id)).toBeNull();
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 回報人再確認 → 結案
  const store2 = await openAs(browser, states.wo_cross_store_a, 'phone');
  try {
    await openCross(store2.page);
    await openWo(store2.page, 'LG-B-');
    await vis(store2.page, 'act-store-confirm').click();
    await submitForm(store2.page, '已確認完成');
    expect(await woRow(ids.b)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
    const types = (await woEvents(ids.b)).map((e) => e.event_type);
    expect(types.filter((t) => t === 'REQUEST_COMPLETION')).toHaveLength(1);
    expect(types).toEqual(expect.arrayContaining(['REPORT_UNRESOLVED', 'STORE_CONFIRM_COMPLETE']));
    expect(realErrors(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }
});

test('4 W9 管理員唯讀：沒有任何角色的管理員看到白話說明、拿不到資料；只有「查看全部」角色的管理員可看不可改（說明缺哪個權限）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const w = await seedWorkOrder('VW001', `LG-W9-${(seq += 1)}`, users.wo_cross_store_a.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString() });
  // 沒有任何角色的管理員
  const none = await openAs(browser, states.admin, 'desktop');
  try {
    await openCross(none.page);
    await expect(vis(none.page, 'wob-error')).toContainText('沒有查看工單的權限');
    await expect(vis(none.page, 'wob-card')).toHaveCount(0);
    await expect(vis(none.page, 'wob-create')).toHaveCount(0);
    const c = await apiForUser(users.admin as any);
    expect((await c.get(`${N}/work-orders/${w.id}`)).status()).toBe(403);
    expect((await c.post(`${N}/work-orders/${w.id}/progress`, { data: { notes: 'x', expected_updated_at: w.updated_at } })).status()).toBe(403);
    await c.dispose();
    expect(await noPageOverflow(none.page)).toBe(true);
  } finally {
    await none.ctx.close();
  }
  // 只有查看全部角色的管理員
  const view = await openAs(browser, states.wo_cross_viewall, 'desktop');
  try {
    await openCross(view.page);
    await expect(vis(view.page, 'wob-readonly')).toContainText('只有查看工單的權限');
    await openWo(view.page, 'LG-W9');
    for (const id of ['act-progress', 'act-completion', 'act-delete', 'act-force-close', 'act-supplement', 'act-issue-part', 'act-category']) await expect(vis(view.page, id), id).toHaveCount(0);
    expect((await woRow(w.id)).progress_stage).toBe('INITIAL_REVIEW');
    expect(await noPageOverflow(view.page)).toBe(true);
    expect(realErrors(view.errors)).toEqual([]);
  } finally {
    await view.ctx.close();
  }
});
