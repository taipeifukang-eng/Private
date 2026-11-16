import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertGaBaseline, cleanupM7M8, m7Name, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { seedVendor, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, openGaCenter } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { db, dialogFits, gaNav, openAs, openCenter, openMyRequest, openWo, openWorkbenchRequest, realErrors, reqEvents, reqRow, submitForm, vis, woEvents, woRow } from '../support/g18-journey';

// M7/M8 第 5 批 G28.supplement-roundtrip 補資料往返（W1「兩邊同步」；桌機 project 跑一次；總務桌機 1440、店長手機 390）。因為改了第 4 批 request_supplement／submit_supplement，也當作第 4 批補資料的回歸。
//  A. 工單端發起：總務在工單中心按「補資料」→ 工單與需求單同進「待門市補資料」→ 店長（手機）在我的追蹤回覆 → 工單回「初步評估」、需求單進入「待總務複核」→ 總務可以繼續存進度。
//  B. 需求單端發起（第 4 批原路徑）：總務在需求工作台請門市補資料 → 連結的工單同進「等待門市補充資料」→ 店長回覆 → 兩邊回到初步評估／待複核。
//  C. 守衛：已出庫或已有採購單的需求單不可補資料（提示改用留言）；待補資料中不能存進度、送確認；已結案或已退回的單不能補資料。
//  D. 舊式單（沒有需求單）：只改工單；由回報人用「回覆補資料」回覆；總務不能代回覆。
// 每一步回讀資料庫驗工單、需求單與時間軸事件；結束只清自己建立的資料。
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let sid: Record<string, string> = {};
let seq = 0;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_store_a', 'wo_store_b', 'wo_manager', 'wo_works']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

const open = { status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', assignee_name: 'M7M8 工務乙' };
async function linked(suffix: string, reqStatus = 'IN_PROGRESS', reqOver: Record<string, unknown> = {}) {
  const r = (await db().from('ga_service_requests').insert({ store_id: sid.VW001, created_by: users.wo_store_a.id, request_type: 'REPAIR', title: m7Name(`SUP-REQ-${suffix}-${(seq += 1)}`), description: 'm7m8 補資料往返',
    main_status: reqStatus, intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS', ...reqOver }).select('*').single()).data as any;
  const w = await seedWorkOrder('VW001', `SUP-${suffix}`, users.wo_store_a.id, { ...open, accepted_at: new Date().toISOString(), ga_service_request_id: r.id });
  await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
  return { r: await reqRow(r.id), w: await woRow(w.id) };
}
const evTypes = async (id: string) => (await woEvents(id)).map((e) => e.event_type);

test('A 工單端發起：總務按補資料 → 兩邊進待門市補資料 → 店長（手機）在我的追蹤回覆 → 工單回初步評估、需求單待總務複核 → 總務可繼續存進度', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const { r, w } = await linked('A');
  const ga = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openCenter(ga.page);
    await openWo(ga.page, 'SUP-A');
    await vis(ga.page, 'act-supplement').click();
    await dialogFits(ga.page);
    await dialog(ga.page).getByTestId('wo-submit').click();
    await expect(dialog(ga.page).getByTestId('wo-form-error')).toContainText('請說明'); // 沒填說明被擋
    expect(await woRow(w.id)).toMatchObject({ progress_stage: 'VENDOR_WORKING' });
    await dialog(ga.page).getByTestId('f-supp-type').selectOption('PHOTO_UNCLEAR');
    await dialog(ga.page).getByTestId('f-notes').fill('照片太暗，請重拍漏水位置 A');
    await submitForm(ga.page, '工單與需求單都進入「待門市補資料」');
    expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
    expect(await reqRow(r.id)).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT', supplement_type: 'PHOTO_UNCLEAR', supplement_note: '照片太暗，請重拍漏水位置 A' });
    expect(await evTypes(w.id)).toContain('SUPPLEMENT_REQUESTED');
    expect((await reqEvents(r.id)).map((e) => e.event_type)).toContain('SUPPLEMENT_REQUESTED');
    // 待補資料中：工單端不能存進度、送確認、再補資料（講清楚去哪裡處理）
    await expect(vis(ga.page, 'act-progress')).toHaveCount(0);
    await expect(vis(ga.page, 'act-completion')).toHaveCount(0);
    await expect(vis(ga.page, 'act-supplement')).toHaveCount(0);
    await expect(vis(ga.page, 'reason-progress')).toContainText('我的追蹤');
    const c = await apiForUser(users.wo_manager as any);
    for (const p of ['progress', 'request-completion']) {
      const res = await c.post(`${N}/work-orders/${w.id}/${p}`, { data: { notes: 'x', expected_updated_at: (await woRow(w.id)).updated_at } });
      expect(res.status(), p).toBe(409);
    }
    const again = await c.post(`${N}/work-orders/${w.id}/request-supplement`, { data: { supplement_type: 'OTHER', supplement_note: 'x', expected_updated_at: (await woRow(w.id)).updated_at } });
    expect(again.status()).toBe(409);
    await c.dispose();
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 店長（手機）回覆
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store.page);
    await gaNav(store.page, '我的追蹤');
    await expect(store.page.getByTestId('waiting-hint')).toBeVisible();
    await store.page.getByLabel('狀態').selectOption('WAITING_STORE_SUPPLEMENT');
    await openMyRequest(store.page, r.request_no);
    await store.page.getByTestId('act-submit_supplement').click();
    await store.page.getByTestId('action-submit').click();
    expect(await reqRow(r.id)).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT' }); // 沒填說明：沒送出
    await dialog(store.page).locator('textarea').first().fill('已重拍，漏水位置在水龍頭下方 A');
    await store.page.getByTestId('action-submit').click();
    await expect(store.page.getByTestId('detail-notice')).toBeVisible();
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  expect(await reqRow(r.id)).toMatchObject({ main_status: 'WAITING_GA_REVIEW' });
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect(await evTypes(w.id)).toContain('SUPPLEMENT_REPLIED');
  // 總務：工單時間軸看得到往返，且又可以存進度
  const ga2 = await openAs(browser, states.wo_works, 'desktop');
  try {
    await openCenter(ga2.page);
    await openWo(ga2.page, 'SUP-A');
    await expect(vis(ga2.page, 'wo-stage')).toHaveText('初步評估');
    await expect(vis(ga2.page, 'wo-timeline-item').filter({ hasText: '已重拍' }).first()).toBeVisible();
    await vis(ga2.page, 'act-progress').click();
    await dialog(ga2.page).getByTestId('f-notes').fill('收到補充資料，繼續處理 A');
    await submitForm(ga2.page, '進度已更新');
    expect((await reqRow(r.id)).main_status, '待總務複核期間，一般進度不翻轉需求單').toBe('WAITING_GA_REVIEW');
    expect(realErrors(ga2.errors)).toEqual([]);
  } finally {
    await ga2.ctx.close();
  }
});

test('B 需求單端發起（第 4 批原路徑）：總務在需求工作台請門市補資料 → 連結的工單同進等待門市補充資料 → 店長回覆 → 兩邊回到初步評估與待複核', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const { r, w } = await linked('B');
  const ga = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openGaCenter(ga.page);
    await gaNav(ga.page, '總務需求工作台');
    await openWorkbenchRequest(ga.page, r.request_no);
    await dialog(ga.page).getByTestId('act-request_supplement').click();
    await ga.page.getByTestId('f-supplement-type').selectOption('DESCRIPTION_INSUFFICIENT');
    await dialog(ga.page).locator('textarea').first().fill('請說明漏水位置與水量 B');
    await ga.page.getByTestId('action-submit').click();
    await expect(ga.page.getByTestId('detail-notice')).toBeVisible();
    expect(await reqRow(r.id)).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT', supplement_type: 'DESCRIPTION_INSUFFICIENT' });
    expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
    expect(await evTypes(w.id)).toContain('SUPPLEMENT_REQUESTED');
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openGaCenter(store.page);
    await gaNav(store.page, '我的追蹤');
    await store.page.getByLabel('狀態').selectOption('WAITING_STORE_SUPPLEMENT');
    await openMyRequest(store.page, r.request_no);
    await store.page.getByTestId('act-submit_supplement').click();
    await dialog(store.page).locator('textarea').first().fill('漏水在左邊水龍頭，約每秒一滴 B');
    await store.page.getByTestId('action-submit').click();
    await expect(store.page.getByTestId('detail-notice')).toBeVisible();
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  expect(await reqRow(r.id)).toMatchObject({ main_status: 'WAITING_GA_REVIEW' });
  expect(await woRow(w.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect(await evTypes(w.id)).toContain('SUPPLEMENT_REPLIED');
});

test('C 守衛：已出庫或已有採購單的需求單不可補資料（提示改用留言）；已結案、已退回的單不能補資料；他店店長不能回覆', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const c = await apiForUser(users.wo_manager as any);
  const ask = (id: string, v: string) => c.post(`${N}/work-orders/${id}/request-supplement`, { data: { supplement_type: 'OTHER', supplement_note: '請補充 C', expected_updated_at: v } });
  // 已出庫：處理單與出庫單據
  const issued = await linked('C-ISSUED');
  const ful = await db().from('ga_part_fulfillments').insert({ request_id: issued.r.id, status: 'STOCK_ISSUE', requested_quantity: 1, unit: '個', created_by: users.wo_works.id, updated_by: users.wo_works.id }).select('*').single();
  expect(ful.error?.message ?? null).toBeNull();
  const doc = await db().from('ga_part_fulfillment_documents').insert({ fulfillment_id: ful.data!.id, document_type: 'STOCK_ISSUE', document_id: crypto.randomUUID(), document_no: 'ZT-M7M8-G28', quantity: 1, status: 'POSTED', created_by: users.wo_works.id });
  expect(doc.error?.message ?? null).toBeNull();
  const r1 = await ask(issued.w.id, issued.w.updated_at);
  expect(r1.status()).toBe(409);
  expect(JSON.stringify(await r1.json())).toContain('留言');
  expect(await woRow(issued.w.id)).toMatchObject({ progress_stage: 'VENDOR_WORKING' });
  expect((await reqRow(issued.r.id)).main_status).toBe('IN_PROGRESS');
  // 已有採購單（含草稿）
  const po = await linked('C-PO');
  const vendor = await seedVendor('G28');
  const made = await db().from('ga_purchase_orders').insert({ po_no: `PO-M7M8-G28-${Date.now()}`, status: 'DRAFT', vendor_id: vendor.id, source_request_id: po.r.id, notes: m7Name('G28-PO') }).select('id').single();
  expect(made.error?.message ?? null).toBeNull();
  const r2 = await ask(po.w.id, po.w.updated_at);
  expect(r2.status()).toBe(409);
  expect(JSON.stringify(await r2.json())).toMatch(/採購單.*留言/);
  expect((await reqRow(po.r.id)).main_status).toBe('IN_PROGRESS');
  // 工務畫面：不能補資料，說明改用留言
  const works = await openAs(browser, states.wo_works, 'desktop');
  try {
    await openCenter(works.page);
    await openWo(works.page, 'SUP-C-PO');
    await expect(vis(works.page, 'act-supplement')).toHaveCount(0);
    await expect(vis(works.page, 'reason-supplement')).toContainText('留言');
    expect(realErrors(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }
  // 需求單狀態不對：已結案、已退回、已取消、已在待補資料／待門市確認
  for (const st of ['COMPLETED', 'REJECTED', 'CANCELED', 'WAITING_STORE_SUPPLEMENT', 'WAITING_STORE_CONFIRMATION']) {
    const x = await linked(`C-ST-${st}`, st);
    const rr = await ask(x.w.id, x.w.updated_at);
    expect(rr.status(), st).toBe(409);
    expect((await reqRow(x.r.id)).main_status, st).toBe(st);
  }
  // 版本衝突：別人先改過
  const stale = await linked('C-STALE');
  const old = stale.w.updated_at;
  await db().from('maintenance_requests').update({ description: 'm7m8 被別人改過', updated_at: new Date(Date.now() + 5000).toISOString() }).eq('id', stale.w.id);
  expect((await ask(stale.w.id, old)).status()).toBe(409);
  await c.dispose();
  // 他店店長（ZT01）不能替 VW001 的單回覆補資料
  const sup = await linked('C-OTHER-STORE');
  expect((await (await apiForUser(users.wo_manager as any)).post(`${N}/work-orders/${sup.w.id}/request-supplement`, { data: { supplement_type: 'OTHER', supplement_note: 'x', expected_updated_at: sup.w.updated_at } })).status()).toBe(200);
  const sb = await apiForUser(users.wo_store_b as any);
  const reply = await sb.post(`${N}/requests/${sup.r.id}/store-actions`, { data: { action: 'submit_supplement', note: '我不是這間店', expected_updated_at: (await reqRow(sup.r.id)).updated_at } });
  expect(reply.status()).toBeGreaterThanOrEqual(403);
  expect((await reqRow(sup.r.id)).main_status).toBe('WAITING_STORE_SUPPLEMENT');
  await sb.dispose();
});

test('D 舊式單（沒有需求單）：總務補資料只改工單；回報人用「回覆補資料」回覆回到初步評估；總務不能代回覆', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const leg = await seedWorkOrder('VW001', `SUP-D-${(seq += 1)}`, users.wo_store_a.id, { ...open, accepted_at: new Date().toISOString() });
  const c = await apiForUser(users.wo_manager as any);
  const res = await c.post(`${N}/work-orders/${leg.id}/request-supplement`, { data: { supplement_type: 'DESCRIPTION_INSUFFICIENT', supplement_note: '請描述位置 D', expected_updated_at: leg.updated_at } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await woRow(leg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
  // 總務不能代回覆
  const proxy = await c.post(`${N}/work-orders/${leg.id}/reply-supplement`, { data: { note: '總務代回覆', expected_updated_at: (await woRow(leg.id)).updated_at } });
  expect(proxy.status()).toBeGreaterThanOrEqual(403);
  expect(await woRow(leg.id)).toMatchObject({ progress_stage: 'WAITING_STORE_INFO' });
  await c.dispose();
  // 回報人（店長，手機）在工單中心回覆
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openCenter(store.page);
    await openWo(store.page, 'SUP-D');
    await expect(vis(store.page, 'act-reply-supplement')).toBeVisible();
    await vis(store.page, 'act-reply-supplement').click();
    await dialogFits(store.page);
    await dialog(store.page).getByTestId('wo-submit').click();
    await expect(dialog(store.page).getByTestId('wo-form-error')).toBeVisible(); // 沒填回覆說明
    await dialog(store.page).getByTestId('f-notes').fill('漏水位置在廚房水槽下方 D');
    await submitForm(store.page, '已回覆');
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  expect(await woRow(leg.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW' });
  expect(await evTypes(leg.id)).toEqual(expect.arrayContaining(['SUPPLEMENT_REQUESTED', 'SUPPLEMENT_REPLIED']));
});
