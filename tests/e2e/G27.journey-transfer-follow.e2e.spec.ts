import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter } from '../support/g01-ui';

// M7/M8 第 4 批 G27 角色接力劇本 B6「資產移轉，單子跟著走」（總務桌機 1440、兩店店長手機 390；桌機 project 跑一次）：
//   A 店（ZT01）有一台設備，掛著：一張待門市確認的維修單（含工單）、一張添購單、一張已結案維修單、一張舊式工單（沒連到需求單）。
//   總務（桌機）發起轉移，畫面明確告知「進行中的單會一起轉到新門市」與張數 → A 店店長（手機）確認交出（此時單子還在 A 店）→ B 店店長（手機）確認收到，
//   → 維修單與工單轉到 B 店（B 店店長在「我的追蹤」看得到、時間軸有公開事件、可接手確認完成）；添購單與已結案單留在 A 店；舊式工單只出現在轉移單的清單；A 店看不到進行中的維修單；沒有發任何通知（沒有通知紀錄）。
//   第二段：另一台設備走「更正所屬門市」，同樣帶走進行中的維修單。第三段：沒有權限者做不到。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let sid: Record<string, string> = {};
let eqCat: { id: string };
let seq = 0;
const db = () => adminDb();

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['tf_ga', 'rq_store_a', 'rq_store_b', 'tf_view']);
  users = made.users;
  teardown = made.teardown;
  for (const k of ['tf_ga', 'rq_store_a', 'rq_store_b', 'tf_view']) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
  eqCat = await seedCategory('equipment', 'G27J');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function open(browser: Browser, key: string, kind: 'desktop' | 'phone'): Promise<Who> {
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: states[key], serviceWorkers: 'block',
    ...(kind === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const transferRow = (page: Page, text: string) => page.locator('tr[data-testid="transfer-row"]:visible, li[data-testid="transfer-card"]:visible', { hasText: text });
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).locator('visible=true').first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
const myCard = (page: Page, no: string) => page.locator('[data-testid="mr-card"]:visible', { hasText: no });
async function pickStore(scope: ReturnType<Page['locator']>, label: string, code: string) {
  await scope.getByRole('combobox', { name: new RegExp(label) }).fill(code);
  await scope.getByRole('option').filter({ hasText: code }).first().getByRole('button').click();
}
async function mkRequest(storeCode: 'VW001' | 'ZT01', equipmentId: string, status: string, type = 'REPAIR', withWo = false) {
  const n = (seq += 1);
  const creator = storeCode === 'ZT01' ? users.rq_store_b.id : users.rq_store_a.id;
  const req = (await db().from('ga_service_requests').insert({
    store_id: sid[storeCode], created_by: creator, request_type: type, title: m7Name(`G27J-R${n}`), description: 'G27 劇本', resource_type: 'EQUIPMENT', equipment_id: equipmentId, main_status: status,
  }).select('*').single()).data as any;
  let wo: any = null;
  if (withWo) {
    wo = (await db().from('maintenance_requests').insert({
      store_id: sid[storeCode], title: m7Name(`G27J-W${n}`), description: 'G27 工單', reported_by: creator, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING',
      resource_type: 'equipment', progress_stage: 'INITIAL_REVIEW', ga_service_request_id: req.id,
    }).select('*').single()).data as any;
    await db().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', req.id);
  }
  return { req, wo };
}
const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).single()).data as any;

test('劇本：總務發起轉移（告知單子一起轉）→ A 店交出 → B 店收到 → 維修單與工單轉到 B 店、添購與已結案留 A 店、舊式工單進清單；時間軸公開事件、無通知', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27J-冷凍櫃');
  const R = await mkRequest('ZT01', eq.id, 'WAITING_STORE_CONFIRMATION', 'REPAIR', true);
  const P = await mkRequest('ZT01', eq.id, 'IN_PROGRESS', 'PURCHASE_SUPPLEMENT');
  const D = await mkRequest('ZT01', eq.id, 'COMPLETED', 'REPAIR');
  const legacy = (await db().from('maintenance_requests').insert({
    store_id: sid.ZT01, title: m7Name(`G27J 舊式工單 ${eq.name}`), description: '舊式工單', reported_by: users.rq_store_b.id, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING', resource_type: 'equipment',
  }).select('*').single()).data as any;
  const eventTypes = async (id: string) => (((await db().from('ga_service_request_events').select('event_type').eq('request_id', id)).data || []) as any[]).map((e) => e.event_type).sort();
  const typesBefore = await eventTypes(R.req.id);

  const ga = await open(browser, 'tf_ga', 'desktop');
  const a = await open(browser, 'rq_store_b', 'phone'); // A 店 ZT01
  const b = await open(browser, 'rq_store_a', 'phone'); // B 店 VW001
  let transferId = '';
  try {
    // ---------------------------------------------------------------- 步驟 0：A 店店長（手機）在我的追蹤看到三張單
    await openGaCenter(a.page);
    await gaNavTo(a.page, '我的追蹤');
    for (const x of [R, P, D]) await expect(myCard(a.page, x.req.request_no)).toHaveCount(1);

    // ---------------------------------------------------------------- 步驟 1：總務（桌機）發起，畫面告知單子一起轉
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '轉移單');
    await ga.page.getByRole('button', { name: '發起轉移單' }).click();
    await dialog(ga.page).getByRole('searchbox', { name: '搜尋要轉移的資產' }).fill(eq.name);
    await dialog(ga.page).getByRole('button', { name: `選擇 ${eq.name}` }).click();
    await pickStore(dialog(ga.page), '轉入門市', 'VW001');
    const warn = dialog(ga.page).getByTestId('move-follow-notice');
    await expect(warn).toContainText('進行中的單會一起轉到新門市');
    await expect(warn).toContainText('會一起轉走 1 張進行中的維修單（含它們的工單）');
    await expect(warn).toContainText('另有 1 張添購等其他類型的單留在原門市');
    await expect(warn).toContainText('舊式工單');
    await expect(warn).toContainText(R.req.request_no);
    await dialog(ga.page).getByLabel('轉移原因').fill('B 店新開，調撥冷凍櫃');
    await dialog(ga.page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(notice(ga.page, /已發起轉移單 AT\d{8}-\d{4}/)).toBeVisible();
    const t = ((await db().from('ga_asset_transfers').select('*').eq('asset_id', eq.id)).data as any[])[0];
    transferId = t.id;
    // 發起不搬
    expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);

    // ---------------------------------------------------------------- 步驟 2：A 店店長（手機）確認交出（單子還在 A 店）
    await openGaCenter(a.page);
    await gaNavTo(a.page, '轉移單');
    const cardA = transferRow(a.page, eq.name);
    await expect(cardA).toBeVisible();
    await cardA.getByRole('button', { name: '確認交出' }).click();
    await expect(dialog(a.page).getByTestId('transfer-move-note')).toContainText('進行中的單會一起轉到新門市');
    await dialog(a.page).getByRole('button', { name: '確認交出' }).last().click();
    await expect(notice(a.page, '已確認交出')).toBeVisible();
    expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
    await gaNavTo(a.page, '我的追蹤');
    await expect(myCard(a.page, R.req.request_no)).toHaveCount(1); // 還沒收到，單子仍在 A 店

    // ---------------------------------------------------------------- 步驟 3：B 店店長（手機）確認收到 → 單子轉過來
    await openGaCenter(b.page);
    await gaNavTo(b.page, '轉移單');
    const cardB = transferRow(b.page, eq.name);
    await expect(cardB).toBeVisible();
    await cardB.getByRole('button', { name: '確認收到' }).click();
    await expect(dialog(b.page).getByTestId('transfer-move-note')).toContainText('這些單會出現在你的門市');
    await dialog(b.page).getByRole('button', { name: '確認收到' }).last().click();
    await expect(notice(b.page, /1 張進行中的維修單已一起轉到新門市.*1 張舊式工單需人工處理/)).toBeVisible();
    expect(await noPageOverflow(b.page)).toBe(true);

    // ---------------------------------------------------------------- 步驟 4：結果檢查（資料庫）
    expect((await reqRow(R.req.id)).store_id).toBe(sid.VW001);
    expect((await woRow(R.wo.id)).store_id).toBe(sid.VW001);
    // 第 5 批：工單時間軸多一筆公開的 STORE_MOVED（工單中心與需求單詳情共用）
    expect(((await db().from('maintenance_ticket_events').select('event_type,visibility').eq('ticket_id', R.wo.id).eq('event_type', 'STORE_MOVED')).data || []) as any[]).toEqual([{ event_type: 'STORE_MOVED', visibility: 'PUBLIC' }]);
    expect((await reqRow(R.req.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
    expect((await reqRow(P.req.id)).store_id).toBe(sid.ZT01);
    expect((await reqRow(D.req.id)).store_id).toBe(sid.ZT01);
    expect((await woRow(legacy.id)).store_id).toBe(sid.ZT01);
    // 沒有通知：DEV 沒有任何通知資料表，搬單也不呼叫通知；需求單只多一筆公開時間軸事件，沒有其他事件
    expect((await eventTypes(R.req.id)).filter((t) => !typesBefore.includes(t) || t === 'ASSET_STORE_MOVED')).toEqual(['ASSET_STORE_MOVED']);
    expect((await eventTypes(R.req.id)).length).toBe(typesBefore.length + 1);
    const ev = ((await db().from('ga_service_request_events').select('*').eq('request_id', R.req.id).eq('event_type', 'ASSET_STORE_MOVED')).data || []) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ visibility: 'PUBLIC' });
    expect(ev[0].title).toMatch(/^因設備轉移，由 .+ 轉到 .+$/);

    // ---------------------------------------------------------------- 步驟 5：B 店我的追蹤看得到維修單（含時間軸事件），可接手確認完成；A 店只剩添購與已結案
    await gaNavTo(b.page, '我的追蹤');
    await expect(myCard(b.page, R.req.request_no)).toHaveCount(1);
    await expect(myCard(b.page, P.req.request_no)).toHaveCount(0);
    await myCard(b.page, R.req.request_no).getByTestId('open-detail').click();
    const det = dialog(b.page).getByTestId('request-detail');
    await expect(det.getByTestId('timeline-item').filter({ hasText: '因設備轉移' })).toHaveCount(1);
    await det.getByTestId('act-confirm_complete').click();
    await det.getByTestId('action-submit').click();
    await expect(det.getByTestId('detail-notice')).toBeVisible();
    expect((await reqRow(R.req.id)).main_status).toBe('COMPLETED');
    await dialog(b.page).getByTestId('detail-close').click();

    await gaNavTo(a.page, '我的追蹤');
    await a.page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(a.page);
    await gaNavTo(a.page, '我的追蹤');
    await expect(myCard(a.page, R.req.request_no)).toHaveCount(0);
    await expect(myCard(a.page, P.req.request_no)).toHaveCount(1);
    await expect(myCard(a.page, D.req.request_no)).toHaveCount(1);

    // ---------------------------------------------------------------- 步驟 6：轉移單詳情（總務）看得到搬走的單與舊式工單清單
    await ga.page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '轉移單');
    await tab(ga.page, '已完成').click();
    await transferRow(ga.page, eq.name).getByRole('button', { name: /查看/ }).click();
    const moved = dialog(ga.page).getByTestId('moved-requests');
    await expect(moved.getByTestId('moved-request')).toHaveCount(1);
    await expect(moved.getByTestId('moved-request')).toContainText(R.req.request_no);
    await expect(moved.getByTestId('moved-unlinked')).toHaveCount(1);
    await expect(moved.getByTestId('moved-unlinked')).toContainText('舊式工單');
    await expect(moved).toContainText('請總務人工處理');
    await dialog(ga.page).getByRole('button', { name: '關閉' }).click();
    expect(real(ga.errors)).toEqual([]);
    expect(real(a.errors)).toEqual([]);
    expect(real(b.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
    await a.ctx.close();
    await b.ctx.close();
  }
  expect(transferId).not.toBe('');
});

test('劇本：更正所屬門市也帶走進行中的維修單（桌機）；視窗明確告知；添購單不搬', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27J-更正');
  const R = await mkRequest('ZT01', eq.id, 'WAITING_STORE_SUPPLEMENT', 'REPAIR', true);
  const P = await mkRequest('ZT01', eq.id, 'IN_PROGRESS', 'PURCHASE_SUPPLEMENT');
  const ga = await open(browser, 'tf_ga', 'desktop');
  try {
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '設備清冊', '設備管理');
    await searchBox(ga.page).fill(eq.name);
    await ga.page.locator('tr:visible', { hasText: eq.name }).getByRole('button', { name: /查看/ }).click();
    await dialog(ga.page).getByRole('button', { name: '更正所屬門市' }).click();
    const warn = dialog(ga.page).getByTestId('move-follow-notice');
    await expect(warn).toContainText('進行中的單會一起轉到新門市');
    await expect(warn).toContainText('會一起轉走 1 張進行中的維修單');
    await pickStore(dialog(ga.page), '更正為', 'VW001');
    await dialog(ga.page).getByLabel('更正原因').fill('建檔時選錯門市');
    await dialog(ga.page).getByRole('button', { name: '確認更正' }).click();
    await expect(notice(ga.page, /已更正設備.*1 張進行中的維修單已一起轉到新門市/)).toBeVisible();
    expect((await reqRow(R.req.id)).store_id).toBe(sid.VW001);
    expect((await woRow(R.wo.id)).store_id).toBe(sid.VW001);
    // 第 5 批：工單時間軸多一筆公開的 STORE_MOVED（工單中心與需求單詳情共用）
    expect(((await db().from('maintenance_ticket_events').select('event_type,visibility').eq('ticket_id', R.wo.id).eq('event_type', 'STORE_MOVED')).data || []) as any[]).toEqual([{ event_type: 'STORE_MOVED', visibility: 'PUBLIC' }]);
    expect((await reqRow(R.req.id)).main_status).toBe('WAITING_STORE_SUPPLEMENT');
    expect((await reqRow(P.req.id)).store_id).toBe(sid.ZT01);
    const ev = ((await db().from('ga_service_request_events').select('title,visibility').eq('request_id', R.req.id).eq('event_type', 'ASSET_STORE_MOVED')).data || []) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0].title).toMatch(/^因設備所屬門市更正，由 .+ 轉到 .+$/);
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
});

test('沒有權限者做不到：設備查看者不能發起轉移、不能更正門市；總務不能代替店長收；他店店長不能收', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  const eq = await seedEquipment('ZT01', eqCat.id, 'G27J-權限');
  const R = await mkRequest('ZT01', eq.id, 'IN_PROGRESS', 'REPAIR');
  const view = await open(browser, 'tf_view', 'desktop');
  try {
    await openGaCenter(view.page);
    const status = (path: string, method: string, data: unknown) => view.page.evaluate(async ([p, m, d]) => (await fetch(`/api/workspace/general-affairs/${p}`, { method: m as string, headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })).status, [path, method, data] as const);
    expect(await status('transfers', 'POST', { assetType: 'EQUIPMENT', assetId: eq.id, toStoreId: sid.VW001, reason: 'x' })).toBe(403);
    expect(await status(`equipment/${eq.id}/correct-store`, 'POST', { to_store_id: sid.VW001, reason: 'x' })).toBe(403);
    expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
  } finally {
    await view.ctx.close();
  }
  // 總務發起後，總務與轉出店店長都不能代替 B 店收
  const ga = await open(browser, 'tf_ga', 'desktop');
  try {
    await openGaCenter(ga.page);
    const made = await ga.page.evaluate(async ([id, to]) => { const r = await fetch('/api/workspace/general-affairs/transfers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetType: 'EQUIPMENT', assetId: id, toStoreId: to, reason: 'G27 權限' }) }); return (await r.json()).data?.id as string; }, [eq.id, sid.VW001]);
    expect(made).toBeTruthy();
    const a = await open(browser, 'rq_store_b', 'phone');
    try {
      await openGaCenter(a.page);
      const s1 = await a.page.evaluate(async (id) => (await fetch(`/api/workspace/general-affairs/transfers/${id}/handover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, made);
      expect(s1).toBe(200);
      const s2 = await a.page.evaluate(async (id) => (await fetch(`/api/workspace/general-affairs/transfers/${id}/receive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, made);
      expect(s2).toBe(403); // 轉出店店長不能收
    } finally {
      await a.ctx.close();
    }
    const s3 = await ga.page.evaluate(async (id) => (await fetch(`/api/workspace/general-affairs/transfers/${id}/receive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, made);
    expect(s3).toBe(403); // 總務不能代收
    expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
    // 取消轉移單後，單子照舊留在 A 店
    const s4 = await ga.page.evaluate(async (id) => (await fetch(`/api/workspace/general-affairs/transfers/${id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: '不轉了' }) })).status, made);
    expect(s4).toBe(200);
    expect((await reqRow(R.req.id)).store_id).toBe(sid.ZT01);
  } finally {
    await ga.ctx.close();
  }
});
