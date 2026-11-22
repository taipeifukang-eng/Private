import crypto from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, shell, sideLabels } from '../support/g01-ui';
import { dialog, pick } from '../support/g12-ui';

// M7/M8 第 4 批 G17 角色接力劇本 Q26「料件補貨」（店長手機 390、總務桌機 1440；桌機 project 跑一次）。採購與到貨段屬 G25 頁面，由 G25.journey-printers 補齊；調撥分支沿用第 3 批劇本。
//  1. 店長（手機）回報缺料件：新增需求選「料件」並用搜尋挑料件、填數量。
//  2. 總務（桌機）受理並分流庫存出庫 → 庫存出庫：超量被擋（不得超過剩餘需求量）、換成別的料件沒填替代原因被擋 → 正確出庫 → 庫存與處理單同步（已處理 = 需求量，待交付）。
//  3. 料件處理中心：「待交付」卡片與列；按「送門市確認」→ 處理單與需求單一起進入待門市確認（Q18）。
//  4. 店長（手機）在我的追蹤「待我確認」確認完成 → 需求單與處理單一起完成。
//  5. 分支：總務代門市確認（須填說明，事件標「總務代門市操作」，店長看得到標示）。
//  6. 分支：異常登記 → 逐筆作廢舊單據（填原因，已承諾量釋放、庫存不自動沖回）→ 重新選擇處理方式（改採購）。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
let storeState: any;
let sid: Record<string, string> = {};
let part: any;
let part2: any;
let loc: any;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['rq_store_part', 'rq_store_b', 'rq_store_viewonly', 'ful_view', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  const c = await apiForUser(users.rq_store_part as any);
  storeState = await c.storageState();
  await c.dispose();
  const st = await stores();
  sid = { VW001: st.VW001.id };
  const cat = await seedCategory('part', 'G17J');
  part = await seedPart(cat.id, 'G17J-熱感紙', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  part2 = await seedPart(cat.id, 'G17J-替代紙', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  loc = await seedLocation(null, 'G17J-倉');
  for (const p of [part, part2]) { await seedLocationPart(loc.id, p.id); await seedBalance(loc.id, p.id, 10); }
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含出庫流水）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function open(browser: Browser, who: 'store' | 'ga'): Promise<Who> {
  const state = who === 'store' ? storeState : await storageStateFor('ga_works');
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block',
    ...(who === 'store' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
const dbReq = async (id: string) => (await adminDb().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const dbFul = async (reqId: string) => (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', reqId).single()).data as any;
const dbBal = async (l: string, p: string) => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', l).eq('part_id', p).maybeSingle()).data as any)?.quantity_base ?? 0);
const detail = (page: Page) => dialog(page).getByTestId('request-detail');
async function openRq(page: Page, no: string, where: 'rq' | 'mr') {
  await searchBox(page).fill(no);
  const row = page.locator(where === 'rq' ? '[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible' : '[data-testid="mr-card"]:visible', { hasText: no });
  await expect(row).toHaveCount(1);
  await row.getByTestId('open-detail').click();
  await expect(detail(page)).toBeVisible();
}
async function openFul(page: Page, no: string) {
  await searchBox(page).fill(no);
  const card = page.locator('[data-testid="fl-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('fulfillment-detail')).toBeVisible();
}

test('主線：店長（手機）回報缺料件 → 總務受理、庫存出庫（超量與替代料被擋）→ 待交付 → 送門市確認 → 店長確認完成', async ({ browser }) => {
  test.setTimeout(420_000);
  const title = m7Name('缺熱感紙');
  let no = '';
  let reqId = '';
  const store = await open(browser, 'store');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '新增需求');
    await store.page.getByTestId('type-purchase').check();
    await store.page.getByTestId('f-resource').selectOption('PART');
    await store.page.getByTestId('f-part-search').fill(part.name);
    await expect(store.page.getByTestId('f-part').locator(`option:has-text("${part.name}")`)).toHaveCount(1);
    const partValue = await store.page.getByTestId('f-part').locator(`option:has-text("${part.name}")`).getAttribute('value');
    await store.page.getByTestId('f-part').selectOption(partValue!);
    await store.page.getByTestId('f-qty').fill('3');
    await store.page.getByTestId('f-title').fill(title);
    await store.page.getByTestId('f-description').fill('櫃台熱感紙快用完了，請補三個');
    expect(await noPageOverflow(store.page)).toBe(true);
    await store.page.getByTestId('create-submit').click();
    await expect(store.page.getByTestId('create-done')).toBeVisible();
    no = (await store.page.getByTestId('created-no').textContent())!.trim();
    const row = (await adminDb().from('ga_service_requests').select('*').eq('request_no', no).single()).data as any;
    reqId = row.id;
    expect(row).toMatchObject({ part_id: part.id, resource_type: 'PART', main_status: 'PENDING_INTAKE' });
    expect(Number(row.desired_quantity)).toBe(3);
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  const ga = await open(browser, 'ga');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await openRq(ga.page, no, 'rq');
    await detail(ga.page).getByTestId('act-accept').click();
    await ga.page.getByTestId('f-route').selectOption('STOCK_ISSUE');
    await ga.page.getByTestId('f-role').selectOption('GENERAL_AFFAIRS');
    await ga.page.getByTestId('action-submit').click();
    await expect(ga.page.getByTestId('detail-notice')).toBeVisible();
    expect(await dbReq(reqId)).toMatchObject({ main_status: 'ACCEPTED', intake_route: 'STOCK_ISSUE' });
    // 庫存出庫：先選位置再選料件（換位置會清掉料件）
    await detail(ga.page).getByTestId('act-stock-issue').click();
    const d = dialog(ga.page);
    await expect(d.getByTestId('stock-issue-form')).toBeVisible();
    await pick(d, /出庫位置/, '出庫位置選項', 'G17J', 'G17J');
    await pick(d, /^料件/, '料件選項', '熱感紙', '熱感紙');
    await d.getByTestId('si-qty').fill('5');
    await d.getByTestId('si-submit').click();
    await expect(d.getByTestId('si-error')).toContainText('剩餘需求量');
    expect(await dbBal(loc.id, part.id)).toBe(10);
    // 換成別的料件：沒填替代原因被擋
    await d.getByRole('button', { name: '更換' }).last().click();
    await pick(d, /^料件/, '料件選項', '替代紙', '替代紙');
    await d.getByTestId('si-qty').fill('1');
    await expect(d.getByTestId('si-substitute')).toBeVisible();
    await d.getByTestId('si-submit').click();
    await expect(d.getByTestId('si-error')).toContainText('替代原因');
    expect(await dbBal(loc.id, part2.id)).toBe(10);
    // 改回原料件、正確數量
    await d.getByRole('button', { name: '更換' }).last().click();
    await pick(d, /^料件/, '料件選項', '熱感紙', '熱感紙');
    await d.getByTestId('si-qty').fill('3');
    await d.getByTestId('si-submit').click();
    await expect(detail(ga.page).getByTestId('detail-notice')).toContainText('庫存出庫完成');
    expect(await dbBal(loc.id, part.id)).toBe(7);
    const ful = await dbFul(reqId);
    expect(ful).toMatchObject({ status: 'STOCK_ISSUE' });
    expect(Number(ful.fulfilled_quantity)).toBe(3);
    expect(ful.ready_to_deliver_at).toBeTruthy();
    expect((await dbReq(reqId)).main_status).toBe('IN_PROGRESS');
    await dialog(ga.page).getByTestId('detail-close').click();
    // 料件處理中心：待交付 → 送門市確認
    await nav(ga.page, '料件處理中心');
    await expect(ga.page.getByTestId('stat-ready').locator('visible=true')).not.toHaveText('0');
    await ga.page.getByTestId('card-ready').locator('visible=true').click();
    await openFul(ga.page, no);
    await expect(dialog(ga.page).getByTestId('fd-ready')).toBeVisible();
    await expect(dialog(ga.page).getByTestId('fd-status')).toHaveText('待交付');
    await dialog(ga.page).getByTestId('deliver').click();
    await expect(ga.page.getByTestId('fl-notice')).toContainText('已送門市確認');
    expect(await dbFul(reqId)).toMatchObject({ status: 'WAITING_STORE_CONFIRMATION' });
    expect(await dbReq(reqId)).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' });
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  const store2 = await open(browser, 'store');
  try {
    await openGaCenter(store2.page);
    await nav(store2.page, '我的追蹤');
    await expect(store2.page.getByTestId('waiting-hint')).toBeVisible();
    await store2.page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
    await openRq(store2.page, no, 'mr');
    await store2.page.getByTestId('act-confirm_complete').click();
    await expect(store2.page.getByTestId('proxy-hint')).toHaveCount(0); // 店長自己按不是代按
    await store2.page.getByTestId('action-submit').click();
    await expect(store2.page.getByTestId('detail-notice')).toBeVisible();
    expect(await dbReq(reqId)).toMatchObject({ main_status: 'COMPLETED' });
    expect(await dbFul(reqId)).toMatchObject({ status: 'COMPLETED' });
    expect(real(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }
});

test('分支：總務代門市確認須填說明並標「總務代門市操作」，店長看得到標示', async ({ browser }) => {
  test.setTimeout(300_000);
  const r = await seedRequest(sid.VW001, users.rq_store_part.id, 'G17J-proxy', { part_id: part.id, desired_unit: part.base_unit, desired_quantity: 2, main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'STOCK_ISSUE' });
  const ga = await open(browser, 'ga');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await openRq(ga.page, r.request_no, 'rq');
    await detail(ga.page).getByTestId('act-confirm_complete').click();
    await expect(ga.page.getByTestId('proxy-hint')).toBeVisible();
    await ga.page.getByTestId('action-submit').click();
    await expect(ga.page.getByTestId('action-error')).toContainText('說明');
    expect((await dbReq(r.id)).main_status).toBe('WAITING_STORE_CONFIRMATION');
    await ga.page.getByTestId('f-note').fill('店長電話確認已收到');
    await ga.page.getByTestId('action-submit').click();
    await expect(ga.page.getByTestId('detail-notice')).toBeVisible();
    await expect(detail(ga.page).getByTestId('proxy-flag').first()).toBeVisible();
    const ev = ((await adminDb().from('ga_service_request_events').select('*').eq('request_id', r.id).eq('event_type', 'STORE_COMPLETION_CONFIRMED')).data || []) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ proxy_for_store: true, visibility: 'PUBLIC' });
    expect((await dbReq(r.id)).main_status).toBe('COMPLETED');
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  const store = await open(browser, 'store');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '我的追蹤');
    await openRq(store.page, r.request_no, 'mr');
    await expect(detail(store.page).getByTestId('proxy-flag').first()).toBeVisible();
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});

test('分支：異常登記 → 逐筆作廢舊單據（填原因，釋放量、庫存不沖回）→ 重新選擇處理方式（改採購）', async ({ browser }) => {
  test.setTimeout(300_000);
  const r = await seedRequest(sid.VW001, users.rq_store_part.id, 'G17J-exception', { part_id: part.id, desired_unit: part.base_unit, desired_quantity: 4, main_status: 'IN_PROGRESS', intake_route: 'STOCK_ISSUE' });
  const gaId = ((await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-works@example.test').single()).data as any).id;
  const ins = await adminDb().from('ga_part_fulfillments').insert({ request_id: r.id, status: 'STOCK_ISSUE', requested_quantity: 4, fulfilled_quantity: 2, unit: part.base_unit, current_step: '已建立出庫單', created_by: gaId }).select('*').single();
  expect(ins.error).toBeNull();
  const fid = (ins.data as any).id as string;
  await adminDb().from('ga_part_fulfillment_documents').insert({ fulfillment_id: fid, document_type: 'STOCK_ISSUE', document_id: crypto.randomUUID(), document_no: 'TST-G17J', quantity: 2, status: 'POSTED', created_by: gaId });
  const balBefore = await dbBal(loc.id, part.id);
  const ga = await open(browser, 'ga');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '料件處理中心');
    await openFul(ga.page, r.request_no);
    const d = dialog(ga.page);
    await expect(d.getByTestId('doc-void')).toHaveCount(0); // 還沒登記異常不能作廢
    await d.getByTestId('open-exception').click();
    await d.getByTestId('ex-type').selectOption('少收');
    await d.getByTestId('ex-submit').click();
    await expect(d.getByTestId('ex-error')).toContainText('實際狀況'); // 說明必填
    await d.getByTestId('ex-note').fill('門市說只收到一個');
    await d.getByTestId('ex-submit').click();
    await expect(ga.page.getByTestId('fl-notice')).toContainText('異常已登記');
    await expect(d.getByTestId('fd-status')).toHaveText('異常');
    expect(await dbFul(r.id)).toMatchObject({ status: 'EXCEPTION' });
    await expect(d.getByTestId('exception-hint')).toBeVisible();
    // 逐筆作廢：要原因
    await d.getByTestId('doc-void').click();
    await d.getByTestId('void-submit').click();
    await expect(d.getByTestId('void-error')).toContainText('原因');
    await d.getByTestId('void-reason').fill('出庫單重新處理');
    await d.getByTestId('void-submit').click();
    await expect(ga.page.getByTestId('fl-notice')).toContainText('已作廢');
    const f = await dbFul(r.id);
    expect(Number(f.fulfilled_quantity)).toBe(0);
    expect(await dbBal(loc.id, part.id)).toBe(balBefore); // 庫存不自動沖回
    // 重新選擇處理方式
    await d.getByTestId('decide-purchase').click();
    await expect(ga.page.getByTestId('fl-notice')).toContainText('處理方式已儲存');
    expect(await dbFul(r.id)).toMatchObject({ status: 'PURCHASING' });
    expect((await dbReq(r.id)).intake_route).toBe('PURCHASE_REVIEW');
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
});

test('沒權限做不到：缺權限帳號、唯讀者、他店店長，介面與 API 都被擋；店長只看自己門市', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const RX = '/api/workspace/general-affairs/requests';
  const FX = '/api/workspace/general-affairs/part-fulfillments';
  const r = await seedRequest(sid.VW001, users.rq_store_part.id, 'G17J-perm', { part_id: part.id, desired_unit: part.base_unit, desired_quantity: 2, main_status: 'IN_PROGRESS', intake_route: 'PURCHASE_REVIEW' });
  const gaId = ((await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-works@example.test').single()).data as any).id;
  const ins = await adminDb().from('ga_part_fulfillments').insert({ request_id: r.id, status: 'PURCHASING', requested_quantity: 2, fulfilled_quantity: 0, unit: part.base_unit, current_step: '採購評估', created_by: gaId }).select('*').single();
  expect(ins.error).toBeNull();
  const fid = (ins.data as any).id as string;
  const mk = async (k: string) => apiForUser(users[k] as any);
  const own = await mk('rq_store_part');
  const other = await mk('rq_store_b');
  const viewonly = await mk('rq_store_viewonly');
  const fv = await mk('ful_view');
  const nb = await mk('nobody');
  try {
    expect((await own.get(`${RX}/${r.id}`)).status()).toBe(200);
    expect((await other.get(`${RX}/${r.id}`)).status()).toBe(404);
    expect((await other.post(`${RX}/${r.id}/store-actions`, { data: { action: 'confirm_complete', note: 'x' } })).status()).toBe(403);
    expect((await viewonly.post(`${RX}/${r.id}/store-actions`, { data: { action: 'confirm_complete', note: 'x' } })).status()).toBe(403);
    expect((await viewonly.post(`${RX}/${r.id}/comments`, { data: { body: '沒有留言權限' } })).status()).toBe(403);
    expect((await nb.get(RX)).status()).toBe(403);
    expect((await nb.get(FX)).status()).toBe(403);
    expect((await own.get(FX)).status()).toBe(403); // 店長不能進料件處理中心
    // 只有查看權限：可讀、不能做決定
    expect((await fv.get(`${FX}/${fid}`)).status()).toBe(200);
    const d = await fv.post(`${FX}/${fid}/decision`, { data: { decision: 'STOCK_ISSUE', expected_updated_at: (ins.data as any).updated_at } });
    expect(d.status()).toBe(403);
    expect(((await adminDb().from('ga_part_fulfillments').select('status').eq('id', fid).single()).data as any).status).toBe('PURCHASING');
    // 介面：他店店長（手機）看不到總務入口，也看不到他店的單
    const m = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: await other.storageState(), serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await m.newPage();
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      expect(labels).not.toContain('料件處理中心');
      expect(labels).not.toContain('總務需求工作台');
      await nav(page, '我的追蹤');
      await searchBox(page).fill(r.request_no);
      await expect(page.locator('[data-testid="mr-card"]:visible', { hasText: r.request_no })).toHaveCount(0);
      expect(await noPageOverflow(page)).toBe(true);
    } finally {
      await m.close();
    }
  } finally {
    for (const c of [own, other, viewonly, fv, nb]) await c.dispose();
  }
});
