import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedVendor, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';

// M7/M8 第 4 批 G16 角色接力劇本 Q26「設備添購」（店長手機 390、總務桌機 1440；桌機 project 跑一次）。本階段走到採購單草稿與逾期確認：
//  1. 店長（手機）新增「其他採購」需求（印表機兩台）→ 在我的追蹤看到「待受理」。
//  2. 總務（桌機）受理並分流「添購／採購評估」；D4：維修單不能選採購評估（受理畫面說明不可用）→ 請門市補資料 → 店長補充 → 總務再受理。
//  3. 總務採購評估選「進入採購」→ 同交易產生草稿採購單並連回需求單（D1）；DB 回讀採購單、處理單單據；需求單頁顯示連結的採購單與供應商（有採購評估權限）。
//  4. D4：已有採購單（含草稿）後，「請門市補資料」「取消」「駁回」的鈕收起並說明原因；總務「送門市確認」被導向處理單（需求單與處理單一起往下）。
//  5. D5：另一張待門市確認的需求單超過 7 天 → 總務看到「逾期未確認」標示並用卡片篩選；店長（手機）確認完成後標示消失。
// 採購單的核准、下訂、到貨、配發與貼標待辦屬 G25 頁面（尚未移植），由 G25.journey-printers 補齊。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
let storeState: any;
let vendor: any;
let sid: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['rq_store_a']);
  users = made.users;
  teardown = made.teardown;
  const c = await apiForUser(users.rq_store_a as any);
  storeState = await c.storageState();
  await c.dispose();
  const st = await stores();
  sid = { VW001: st.VW001.id };
  vendor = await seedVendor('G16J');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
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
const dbReq = async (no: string) => (await adminDb().from('ga_service_requests').select('*').eq('request_no', no).single()).data as any;
const detail = (page: Page) => dialog(page).getByTestId('request-detail');
async function openRq(page: Page, no: string, where: 'rq' | 'mr') {
  await searchBox(page).fill(no);
  const row = page.locator(where === 'rq' ? '[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible' : '[data-testid="mr-card"]:visible', { hasText: no });
  await expect(row).toHaveCount(1);
  await row.getByTestId('open-detail').click();
  await expect(detail(page)).toBeVisible();
}
async function act(page: Page, action: string, fill: Record<string, string> = {}) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  for (const [id, v] of Object.entries(fill)) {
    const el = d.getByTestId(id);
    if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption(v); else await el.fill(v);
  }
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('detail-notice')).toBeVisible();
}

test('主線：店長（手機）提出設備添購 → 總務受理、請補資料、再受理 → 採購評估產生草稿採購單並連回需求單 → 有採購單後補資料、取消、駁回被收起', async ({ browser }) => {
  test.setTimeout(420_000);
  const title = m7Name('設備添購印表機');
  let no = '';
  // 1. 店長（手機）
  const store = await open(browser, 'store');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '新增需求');
    await expect(store.page.getByTestId('report-form').locator('visible=true')).toBeVisible();
    await store.page.getByTestId('type-purchase').check();
    await store.page.getByTestId('f-resource').selectOption('OTHER_PURCHASE');
    await store.page.getByTestId('f-qty').fill('2');
    await store.page.getByTestId('f-unit').fill('台');
    await store.page.getByTestId('f-title').fill(title);
    await store.page.getByTestId('f-description').fill('櫃台列印量大，需要再添購兩台印表機');
    expect(await noPageOverflow(store.page)).toBe(true);
    await store.page.getByTestId('create-submit').click();
    await expect(store.page.getByTestId('create-done')).toBeVisible();
    no = (await store.page.getByTestId('created-no').textContent())!.trim();
    expect(no).toMatch(/^GA-/);
    const row = await dbReq(no);
    expect(row).toMatchObject({ main_status: 'PENDING_INTAKE', request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'OTHER_PURCHASE', store_id: sid.VW001 });
    await store.page.getByTestId('go-mine').click();
    await expect(store.page.locator('[data-testid="mr-card"]:visible', { hasText: no })).toHaveCount(1);
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  // 2. 總務（桌機）受理、請補資料
  const ga = await open(browser, 'ga');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await openRq(ga.page, no, 'rq');
    // D4：受理畫面中，非維修的添購單可選採購評估；庫存出庫對非料件不可選
    await dialog(ga.page).getByTestId('act-accept').click();
    await expect(dialog(ga.page).getByTestId('f-route').locator('option:disabled')).toContainText(['維修派工（不可用）', '庫存出庫（不可用）']);
    await dialog(ga.page).getByTestId('action-form').getByRole('button', { name: '取消' }).click();
    await act(ga.page, 'request_supplement', { 'f-supplement-type': 'QUANTITY_OR_SPEC_INSUFFICIENT', 'f-note': '請補充印表機的規格需求' });
    expect((await dbReq(no)).main_status).toBe('WAITING_STORE_SUPPLEMENT');
    await dialog(ga.page).getByTestId('detail-close').click();
  } finally {
    await ga.ctx.close();
  }
  // 店長補充資料
  const store2 = await open(browser, 'store');
  try {
    await openGaCenter(store2.page);
    await nav(store2.page, '我的追蹤');
    await expect(store2.page.getByTestId('waiting-hint')).toContainText('1 張');
    await openRq(store2.page, no, 'mr');
    await expect(detail(store2.page).getByTestId('detail-status')).toHaveText('待門市補資料');
    expect(await detail(store2.page).getByTestId('detail-internal-note').count()).toBe(0);
    await store2.page.getByTestId('act-submit_supplement').click();
    await store2.page.getByTestId('f-note').fill('A4 雷射、含傳真功能，預算每台 6000 元');
    await store2.page.getByTestId('action-submit').click();
    await expect(store2.page.getByTestId('detail-notice')).toBeVisible();
    expect((await dbReq(no)).main_status).toBe('WAITING_GA_REVIEW');
    expect(real(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }
  // 3. 總務再受理 → 採購評估 → 草稿採購單
  const ga2 = await open(browser, 'ga');
  try {
    await openGaCenter(ga2.page);
    await nav(ga2.page, '總務需求工作台');
    await openRq(ga2.page, no, 'rq');
    await act(ga2.page, 'accept', { 'f-route': 'PURCHASE_REVIEW', 'f-role': 'GENERAL_AFFAIRS' });
    expect(await dbReq(no)).toMatchObject({ main_status: 'ACCEPTED', intake_route: 'PURCHASE_REVIEW' });
    await dialog(ga2.page).getByTestId('act-purchase-review').click();
    const form = dialog(ga2.page);
    await expect(form.getByTestId('review-form')).toBeVisible();
    await form.getByTestId('rv-qty').fill('2');
    await form.getByTestId('rv-vendor').selectOption({ label: vendor.name });
    await form.getByTestId('rv-note').fill('評估後同意採購兩台印表機');
    await form.getByTestId('rv-submit').click();
    await expect(form.getByTestId('review-result')).toBeVisible();
    const poNo = (await form.getByTestId('review-po-no').textContent())!.trim();
    expect(poNo).toMatch(/^PO-\d{8}-\d{3,}$/);
    await form.getByTestId('review-done').click();
    // DB 回讀：草稿採購單連回需求單、處理單有 PURCHASE 單據
    const req = await dbReq(no);
    const po = (await adminDb().from('ga_purchase_orders').select('*').eq('po_no', poNo).single()).data as any;
    expect(po).toMatchObject({ status: 'DRAFT', source_request_id: req.id, vendor_id: vendor.id });
    const ful = (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', req.id).single()).data as any;
    expect(ful.status).toBe('PURCHASING');
    const docs = ((await adminDb().from('ga_part_fulfillment_documents').select('*').eq('fulfillment_id', ful.id)).data || []) as any[];
    expect(docs.map((d) => d.document_no)).toEqual([poNo]);
    // 需求單頁顯示連結的採購單與供應商（總務有採購評估權限）
    await expect(detail(ga2.page).getByTestId('linked-order')).toContainText(poNo);
    await expect(detail(ga2.page).getByTestId('linked-order')).toContainText(vendor.name);
    await expect(detail(ga2.page).getByTestId('open-fulfillment')).toBeVisible();
    // 4. D4：已有採購單（含草稿）→ 補資料、取消、駁回的鈕收起並說明原因
    for (const a of ['request_supplement', 'cancel', 'reject']) await expect(detail(ga2.page).getByTestId(`act-${a}`)).toHaveCount(0);
    await expect(detail(ga2.page).getByTestId('blocked-hint')).toContainText('請改用留言');
    // 送門市確認被導向處理單（需求單與處理單一起往下）
    await detail(ga2.page).getByTestId('act-request_store_confirmation').click();
    await ga2.page.getByTestId('action-submit').click();
    await expect(ga2.page.getByTestId('action-error')).toContainText('料件處理中心');
    expect((await dbReq(no)).main_status).toBe('IN_PROGRESS');
    expect(real(ga2.errors)).toEqual([]);
  } finally {
    await ga2.ctx.close();
  }
});

test('D5：待門市確認超過 7 天標「逾期未確認」並可一鍵篩選（總務桌機）；店長（手機）確認完成後標示消失', async ({ browser }) => {
  test.setTimeout(300_000);
  const r = await seedRequest(sid.VW001, users.rq_store_a.id, 'G16J-overdue', { request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'OTHER_PURCHASE', part_id: null, main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'ASSET_TASK' });
  await adminDb().from('ga_service_requests').update({ waiting_confirm_since: new Date(Date.now() - 10 * 86400_000).toISOString() }).eq('id', r.id);
  const ga = await open(browser, 'ga');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await expect(ga.page.getByTestId('stat-overdue').locator('visible=true')).not.toHaveText('0');
    await ga.page.getByTestId('card-overdue').locator('visible=true').click();
    await expect(ga.page.getByTestId('row-overdue').locator('visible=true').first()).toBeVisible();
    await searchBox(ga.page).fill(r.request_no);
    const row = ga.page.locator('[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible', { hasText: r.request_no });
    await expect(row).toHaveCount(1);
    await row.getByTestId('open-detail').click();
    await expect(detail(ga.page).getByTestId('detail-overdue')).toBeVisible();
    expect((await adminDb().from('ga_service_requests').select('main_status').eq('id', r.id).single()).data).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' }); // 不自動結案
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  const store = await open(browser, 'store');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '我的追蹤');
    await openRq(store.page, r.request_no, 'mr');
    await expect(detail(store.page).getByTestId('detail-overdue')).toHaveCount(0); // 門市看不到逾期標示
    await store.page.getByTestId('act-confirm_complete').click();
    await store.page.getByTestId('action-submit').click();
    await expect(store.page.getByTestId('detail-notice')).toBeVisible();
    const done = (await adminDb().from('ga_service_requests').select('*').eq('id', r.id).single()).data as any;
    expect(done.main_status).toBe('COMPLETED');
    expect(done.waiting_confirm_since).toBeNull();
    const ev = ((await adminDb().from('ga_service_request_events').select('*').eq('request_id', r.id).eq('event_type', 'STORE_COMPLETION_CONFIRMED')).data || []) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0].proxy_for_store).toBe(false);
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});
