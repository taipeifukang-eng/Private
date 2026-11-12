import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedVendor, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, shell, sideLabels } from '../support/g01-ui';
import { dialog, notice } from '../support/g12-ui';
import { makePng } from '../support/png';

// M7/M8 第 4 批 G16 角色接力劇本 Q26「設備添購」（店長手機 390、總務桌機 1440；桌機 project 跑一次）。本階段走到採購單草稿與逾期確認：
//  1. 店長（手機）新增「其他採購」需求（印表機兩台）→ 在我的追蹤看到「待受理」。
//  2. 總務（桌機）受理並分流「添購／採購評估」；D4：維修單不能選採購評估（受理畫面說明不可用）→ 請門市補資料 → 店長補充 → 總務再受理。
//  3. 總務採購評估選「進入採購」→ 同交易產生草稿採購單並連回需求單（D1）；DB 回讀採購單、處理單單據；需求單頁顯示連結的採購單與供應商（有採購評估權限）。
//  4. D4：已有採購單（含草稿）後，「請門市補資料」「取消」「駁回」的鈕收起並說明原因；總務「送門市確認」被導向處理單（需求單與處理單一起往下）。
//  5. D5：另一張待門市確認的需求單超過 7 天 → 總務看到「逾期未確認」標示並用卡片篩選；店長（手機）確認完成後標示消失。
//  6. 採購、到貨、貼標段（G25 頁面）：總務把草稿採購單改成「到貨直接建設備送該店」並下訂（含稅 ≤ 5000 免核准）；D2 同一張需求單再開第二張採購單（另一家供應商，> 5000 走核准人核准）→ 到貨（直接建立 2 台設備，連回需求單）
//     → 店長（手機）收到貼標待辦、拍照 → 另一位總務複核 → 處理單「待交付」→ 總務送門市確認 → 店長確認完成。
// 採購單的核准、下訂、到貨與配發的完整流程另見 G25.journey-printers。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
let storeState: any;
let vendor: any;
let vendor2: any;
let tpl: any;
const states: Record<string, any> = {};
const shared = { reqNo: '', reqId: '', poNo: '' };
let sid: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['rq_store_a', 'rq_store_b', 'rq_staff', 'purchaser_eq', 'purchaser_approver', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  const c = await apiForUser(users.rq_store_a as any);
  storeState = await c.storageState();
  await c.dispose();
  for (const k of ['rq_staff', 'purchaser_eq']) {
    const cc = await apiForUser(users[k] as any);
    states[k] = await cc.storageState();
    await cc.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id };
  vendor = await seedVendor('G16J');
  vendor2 = await seedVendor('G16J2');
  const eqCat = await adminDb().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機），無法測試到貨建立設備');
  tpl = await seedEquipmentTemplate(eqCat.data.id, 'G16J-T1', { default_warranty_months: 12, description: '劇本用雷射印表機' });
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function open(browser: Browser, who: 'store' | 'ga' | 'staff' | 'approver' | 'eq'): Promise<Who> {
  const state = who === 'store' ? storeState : who === 'staff' ? states.rq_staff : who === 'eq' ? states.purchaser_eq : who === 'approver' ? await storageStateFor('ga_po_approver') : await storageStateFor('ga_works');
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
    shared.reqNo = no; shared.reqId = req.id; shared.poNo = poNo;
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


// ----------------------------------------------------------------------------- 採購、到貨、貼標（G25 頁面）
const POX = '/api/workspace/general-affairs/purchase-orders';
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
async function pickIn(scope: any, testid: string, term: string) {
  const input = scope.getByTestId(testid).locator('visible=true').first();
  await input.click();
  await input.fill(term);
  const opt = scope.getByTestId(`${testid}-option`).filter({ hasText: term }).first();
  await expect(opt).toBeVisible();
  await opt.click();
  await expect(scope.getByTestId(`${testid}-picked`).locator('visible=true').first()).toBeVisible();
}
async function openPo(page: Page, no: string) {
  await nav(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await page.getByTestId('po-search').locator('visible=true').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('po-detail')).toBeVisible();
}
async function poAct(page: Page, action: string, note: string | undefined, expectNotice: RegExp) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  if (note !== undefined) await d.getByTestId('f-note').fill(note);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('pd-notice')).toContainText(expectNotice);
}

test('採購、到貨、貼標：草稿改成直接建設備並下訂；D2 第二張採購單（另一家供應商）走核准；到貨建立設備連回需求單 → 店長貼標 → 另一位總務複核 → 處理單待交付 → 送門市確認 → 店長確認完成', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  expect(shared.poNo, '前一個劇本應已產生草稿採購單').toMatch(/^PO-/);
  const db = adminDb();
  const dbPo = async (no: string) => (await db.from('ga_purchase_orders').select('*').eq('po_no', no).single()).data as any;
  // ---- 1. 總務（staff）把草稿改成「到貨直接建設備送 VW001」並下訂（含稅 ≤ 5000 免核准）
  const staff = await open(browser, 'staff');
  let po2No = '';
  try {
    await openGaCenter(staff.page);
    await openPo(staff.page, shared.poNo);
    await expect(dialog(staff.page).getByTestId('pd-request')).toContainText(shared.reqNo);
    await dialog(staff.page).getByTestId('act-edit').click();
    await expect(heading(staff.page, '編輯採購單')).toBeVisible();
    const form = staff.page.getByTestId('po-form').locator('visible=true');
    await form.getByTestId('pe-mode-0').selectOption('DIRECT_ASSET');
    await pickIn(form, 'pe-store-0', 'VW001');
    await pickIn(form, 'pe-template-0', tpl.name);
    await form.getByTestId('pe-price-0').fill('1500');
    await expect(form.getByTestId('pe-approval-hint')).toContainText('可直接下訂');
    await form.getByTestId('pe-save').click();
    await expect(staff.page.getByTestId('pe-saved').locator('visible=true')).toBeVisible();
    await staff.page.getByTestId('back-list').locator('visible=true').click();
    await openPo(staff.page, shared.poNo);
    await poAct(staff.page, 'place_order', undefined, /已下訂/);
    const po1 = await dbPo(shared.poNo);
    expect(po1).toMatchObject({ status: 'ORDERED', vendor_id: vendor.id });
    const it1 = ((await db.from('ga_purchase_order_items').select('*').eq('po_id', po1.id)).data as any[])[0];
    expect(it1).toMatchObject({ fulfil_mode: 'DIRECT_ASSET', target_store_id: sid.VW001, equipment_template_id: tpl.id });
    expect(Number(it1.quantity)).toBe(2);
    await dialog(staff.page).getByTestId('pd-close').click();
    // ---- 2. D2：同一張需求單的第二張採購單（另一家供應商，含稅 > 5000）
    const api = await apiForUser(users.rq_staff as any);
    const created = await api.post(POX, { data: { header: { vendor_id: vendor2.id, notes: m7Name('G16J-PO2') }, items: [{ item_name: m7Name('備用碳粉匣組'), quantity: 1, unit_price: 6000, unit: '組', request_id: shared.reqId, over_request_reason: '備用耗材', fulfil_mode: 'NO_STOCK' }], idempotency_key: `g16j-po2-${Date.now()}` } });
    expect(created.status(), await created.text()).toBe(201);
    po2No = (await created.json()).data.po_no;
    await api.dispose();
    await openPo(staff.page, po2No);
    await expect(dialog(staff.page).getByTestId('act-place_order')).toHaveCount(0); // > 5000：只能送核准
    await poAct(staff.page, 'submit', '備用耗材超過門檻，請核准', /已送核准/);
    await dialog(staff.page).getByTestId('pd-close').click();
    // 需求單頁顯示連結的兩張採購單
    await nav(staff.page, '總務需求工作台');
    await openRq(staff.page, shared.reqNo, 'rq');
    await expect(detail(staff.page).getByTestId('linked-order')).toHaveCount(2);
    await expect(detail(staff.page).getByTestId('linked-order').filter({ hasText: shared.poNo })).toContainText(vendor.name);
    await expect(detail(staff.page).getByTestId('linked-order').filter({ hasText: po2No })).toContainText(vendor2.name);
    await detail(staff.page).getByTestId('detail-close').click();
    expect(real(staff.errors)).toEqual([]);
  } finally {
    await staff.ctx.close();
  }
  // ---- 3. 核准人核准第二張
  const approver = await open(browser, 'approver');
  try {
    await openGaCenter(approver.page);
    await nav(approver.page, '待簽核採購單');
    await approver.page.locator('[data-testid="ap-card"]:visible', { hasText: po2No }).getByTestId('open-approve').click();
    await poAct(approver.page, 'approve', '同意', /已核准/);
    expect((await dbPo(po2No)).status).toBe('APPROVED');
    expect(real(approver.errors)).toEqual([]);
  } finally {
    await approver.ctx.close();
  }
  // ---- 4. 總務下訂第二張；兩張都到貨（第一張直接建立 2 台設備送 VW001；第二張只登錄）
  const staff2 = await open(browser, 'staff');
  try {
    await openGaCenter(staff2.page);
    await openPo(staff2.page, po2No);
    await poAct(staff2.page, 'place_order', undefined, /已下訂/);
    await dialog(staff2.page).getByTestId('act-receipt').click();
    await dialog(staff2.page).getByTestId('rc-submit').click();
    await expect(dialog(staff2.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
    await expect(dialog(staff2.page).getByTestId('pd-status')).toHaveText('全部到貨');
    await dialog(staff2.page).getByTestId('pd-close').click();
    await openPo(staff2.page, shared.poNo);
    await dialog(staff2.page).getByTestId('act-receipt').click();
    await dialog(staff2.page).getByTestId('rc-submit').click();
    await expect(dialog(staff2.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
    await expect(dialog(staff2.page).getByTestId('act-dispatch')).toHaveCount(0); // 直接建設備，沒有庫存可配發
    await dialog(staff2.page).getByTestId('pd-close').click();
    expect(real(staff2.errors)).toEqual([]);
  } finally {
    await staff2.ctx.close();
  }
  const po1 = await dbPo(shared.poNo);
  expect(po1.status).toBe('RECEIVED');
  const eqs = ((await db.from('ga_equipment').select('*').eq('source_purchase_order_id', po1.id).order('asset_code')).data || []) as any[];
  expect(eqs).toHaveLength(2);
  for (const e of eqs) expect(e).toMatchObject({ store_id: sid.VW001, template_id: tpl.id, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', source_request_id: shared.reqId, vendor_id: vendor.id, serial_number: null });
  // ---- 5. 店長（手機）收到貼標待辦，兩台各拍兩張照片
  const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });
  const store = await open(browser, 'store');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '貼標待辦');
    for (const e of eqs) {
      const card = store.page.locator('li[data-testid="onb-card"]:visible', { hasText: e.asset_code });
      await expect(card).toHaveCount(1);
      for (const step of [/已上傳.*設備照片，接著請上傳貼標位置照片/, /已上傳.*貼標位置照片，等總務複核/]) {
        await card.getByTestId('upload-input').setInputFiles({ name: 'm7m8t-g16.png', mimeType: 'image/png', buffer: png() });
        await card.getByRole('button', { name: '上傳照片' }).click();
        await expect(notice(store.page, step)).toBeVisible();
      }
      await expect(card).toHaveCount(0);
    }
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  // ---- 6. 另一位持設備管理權限的總務複核通過
  const eq = await open(browser, 'eq');
  try {
    await openGaCenter(eq.page);
    await nav(eq.page, '貼標複核');
    for (const e of eqs) {
      const rc = eq.page.locator('li[data-testid="review-card"]:visible', { hasText: e.asset_code });
      await expect(rc).toBeVisible();
      await rc.getByRole('button', { name: '通過' }).click();
      await dialog(eq.page).getByRole('button', { name: '確認通過' }).click();
      await expect(notice(eq.page, /已通過.*的貼標複核/)).toBeVisible();
      await expect(rc).toHaveCount(0); // 卡片消失才代表這一台已處理完，再處理下一台
    }
    expect(real(eq.errors)).toEqual([]);
  } finally {
    await eq.ctx.close();
  }
  for (const e of eqs) expect((await db.from('ga_equipment').select('onboarding_status').eq('id', e.id).single()).data).toMatchObject({ onboarding_status: 'COMPLETED' });
  // ---- 7. 處理單「待交付」→ 總務送門市確認 → 店長確認完成
  const ful = (await db.from('ga_part_fulfillments').select('*').eq('request_id', shared.reqId).single()).data as any;
  expect(Number(ful.fulfilled_quantity)).toBeGreaterThanOrEqual(2);
  expect(ful.ready_to_deliver_at).not.toBeNull();
  const staff3 = await open(browser, 'staff');
  try {
    await openGaCenter(staff3.page);
    await nav(staff3.page, '料件處理中心');
    await staff3.page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(shared.reqNo);
    const card = staff3.page.locator('[data-testid="fl-card"]:visible', { hasText: shared.reqNo });
    await expect(card).toHaveCount(1);
    await card.getByTestId('open-detail').click();
    await expect(dialog(staff3.page).getByTestId('fd-ready')).toBeVisible();
    await dialog(staff3.page).getByTestId('deliver').click();
    await expect.poll(async () => (await dbReq(shared.reqNo)).main_status).toBe('WAITING_STORE_CONFIRMATION');
    expect(real(staff3.errors)).toEqual([]);
  } finally {
    await staff3.ctx.close();
  }
  const store2 = await open(browser, 'store');
  try {
    await openGaCenter(store2.page);
    await nav(store2.page, '我的追蹤');
    await openRq(store2.page, shared.reqNo, 'mr');
    await store2.page.getByTestId('act-confirm_complete').click();
    await store2.page.getByTestId('action-submit').click();
    await expect(store2.page.getByTestId('detail-notice')).toBeVisible();
    expect(real(store2.errors)).toEqual([]);
  } finally {
    await store2.ctx.close();
  }
  const done = await dbReq(shared.reqNo);
  expect(done.main_status).toBe('COMPLETED');
  expect((await db.from('ga_part_fulfillments').select('status').eq('request_id', shared.reqId).single()).data).toMatchObject({ status: 'COMPLETED' });
});

test('沒權限做不到：缺權限帳號、非核准人、開單人自己核准、店長只看自己門市，介面與 API 都被擋', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const PX = '/api/workspace/general-affairs/purchase-orders';
  const RX = '/api/workspace/general-affairs/requests';
  const st = await stores();
  const catP = await seedCategory('part', 'G16JP');
  const partP = await seedPart(catP.id, 'G16JP-紙');
  const locP = await seedLocation(null, 'G16JP-倉');
  const mine = await seedRequest(st.VW001.id, users.rq_store_a.id, 'G16J-perm', { request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'OTHER_PURCHASE', part_id: null, main_status: 'PENDING_INTAKE' });
  const mk = async (k: string) => apiForUser(users[k] as any);
  const sa = await mk('rq_store_a');
  const sb = await mk('rq_store_b');
  const nb = await mk('nobody');
  const eq = await mk('purchaser_eq');
  const pa = await mk('purchaser_approver');
  try {
    // 店長只看自己門市：他店店長讀不到、不能動作；本店店長讀得到
    expect((await sa.get(`${RX}/${mine.id}`)).status()).toBe(200);
    expect((await sb.get(`${RX}/${mine.id}`)).status()).toBe(404);
    expect((await sb.post(`${RX}/${mine.id}/store-actions`, { data: { action: 'confirm_complete', note: 'x' } })).status()).toBe(403);
    // 缺權限帳號：看不到需求單與採購單
    expect((await nb.get(RX)).status()).toBe(403);
    expect((await nb.get(PX)).status()).toBe(403);
    expect((await sa.get(PX)).status()).toBe(403);
    // 超過門檻的採購單：非核准人不能核准；開單人自己即使持核准權限也不能核准
    const body = { header: { vendor_id: vendor.id, receiving_location_id: locP.id, notes: '[自動測試]M7M8 G16J-perm' }, items: [{ part_id: partP.id, quantity: 100, unit_price: 100 }], idempotency_key: `g16p-${Date.now()}` };
    const c1 = await eq.post(PX, { data: body });
    expect(c1.status(), await c1.text()).toBe(201);
    const po1 = (await c1.json()).data;
    const s1 = await eq.post(`${PX}/${po1.id}/actions`, { data: { action: 'submit', expected_updated_at: po1.updated_at } });
    expect(s1.status(), await s1.text()).toBe(200);
    const sub1 = (await s1.json()).data;
    const ap1 = await eq.post(`${PX}/${po1.id}/actions`, { data: { action: 'approve', expected_updated_at: sub1.updated_at } });
    expect(ap1.status()).toBe(403);
    const c2 = await pa.post(PX, { data: { ...body, idempotency_key: `g16p2-${Date.now()}` } });
    expect(c2.status(), await c2.text()).toBe(201);
    const po2 = (await c2.json()).data;
    const s2 = await pa.post(`${PX}/${po2.id}/actions`, { data: { action: 'submit', expected_updated_at: po2.updated_at } });
    const sub2 = (await s2.json()).data;
    const ap2 = await pa.post(`${PX}/${po2.id}/actions`, { data: { action: 'approve', expected_updated_at: sub2.updated_at } });
    expect(ap2.status()).toBe(403);
    expect((await ap2.json()).code).toBe('SELF_APPROVAL');
    const row = (await adminDb().from('ga_purchase_orders').select('status').eq('id', po2.id).single()).data as any;
    expect(row.status).toBe('PENDING_APPROVAL');
    // 介面：他店店長（手機）看不到採購單與需求單工作台入口、看不到他店的單
    const m = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: await sb.storageState(), serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await m.newPage();
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      expect(labels).not.toContain('採購單');
      expect(labels).not.toContain('待簽核採購單');
      expect(labels).not.toContain('總務需求工作台');
      await nav(page, '我的追蹤');
      await searchBox(page).fill(mine.request_no);
      await expect(page.locator('[data-testid="mr-card"]:visible', { hasText: mine.request_no })).toHaveCount(0);
      expect(await noPageOverflow(page)).toBe(true);
    } finally {
      await m.close();
    }
  } finally {
    for (const c of [sa, sb, nb, eq, pa]) await c.dispose();
  }
});
