import { expect, type Browser, type BrowserContext, type Locator, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedVendor, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, openGaSide, shell, sideLabels } from '../support/g01-ui';
import { dialog, notice } from '../support/g12-ui';
import { makePng } from '../support/png';

// M7/M8 第 4 批 G25 角色接力劇本「總務主動購置印表機 5 台」（桌機 project 跑一次；每個角色自己決定視窗：總務與核准人桌機 1440、店長手機 390）：
//  1. 總務採購（開單人，同時持核准權限，用來驗「開單人自己核准被擋」）建採購單：選供應商（已建好的）、印表機料件（有型號對應）5 台、顯示歷史價 → 含稅 15,750 超過門檻 → 儲存草稿 → 送核准。
//  2. 開單人自己看到不能核准的說明；非核准人 API 核准被擋。核准人（另一個帳號）在待簽核清單駁回（原因必填）→ 開單人看到駁回原因、改單價再送 → 核准人核准。
//  3. 總務下訂（供應商快照）→ 第一次到貨 3 台（短收須原因）→ 第二次到貨 2 台中 1 台破損（填原因）→ 超量被擋 → 配發 2 台到 ZT01、1 台到 VW001（庫存扣、建設備、序號空白）。
//  4. ZT01 店長（手機）看到貼標待辦、補序號、拍兩張照片 → 另一位持設備管理權限的總務複核通過。
//  5. 補收 1 台並配發餘額 → 全部到貨 → 結案。每步對照資料庫與事件時間軸；最後驗「沒權限做不到」。
const BASE = '/api/workspace/general-affairs';
const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let sid: Record<string, string> = {};
let vendor: any;
let part: any;
let tpl: any;
let loc: any;
const db = () => adminDb();

test.describe.configure({ mode: 'serial' });
// 動作逾時 20 秒：點不到元素就明確失敗，不要卡到整個劇本逾時。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['purchaser_approver', 'purchaser_eq', 'review_only', 'stock_only', 'rq_store_a', 'rq_store_b']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id, ZT01: st.ZT01.id };
  const cat = await seedCategory('part', 'JP');
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機），無法測試配發建立設備');
  tpl = await seedEquipmentTemplate(eqCat.data.id, 'JP-T1', { default_warranty_months: 12, description: '劇本用雷射印表機' });
  part = await seedPart(cat.id, 'JP-印表機', { base_unit: '台', equipment_template_id: tpl.id });
  loc = await seedLocation(null, 'JP-總部倉');
  await seedLocationPart(loc.id, part.id);
  vendor = await seedVendor('JP');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含採購單、進貨、配發、由採購建立的設備與資產編號流水）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function open(browser: Browser, who: string, kind: 'desktop' | 'phone'): Promise<Who> {
  const state = who === 'ga_po_approver' ? await storageStateFor(who) : states[who];
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block',
    ...(kind === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
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
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
async function pickIn(scope: Locator, testid: string, term: string) {
  const input = scope.getByTestId(testid).locator('visible=true').first();
  await input.click();
  await input.fill(term);
  const opt = scope.getByTestId(`${testid}-option`).filter({ hasText: term }).first();
  await expect(opt).toBeVisible();
  await opt.click();
  await expect(scope.getByTestId(`${testid}-picked`).locator('visible=true').first()).toBeVisible();
}
const dbPo = async (no: string) => (await db().from('ga_purchase_orders').select('*').eq('po_no', no).single()).data as any;
const dbEvents = async (id: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', id).order('created_at').order('id')).data || []) as any[];
const dbBal = async () => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbEquip = async (poId: string) => ((await db().from('ga_equipment').select('*').eq('source_purchase_order_id', poId).order('created_at').order('asset_code')).data || []) as any[];
const POX = '/api/workspace/general-affairs/purchase-orders';

/** 開啟某張採購單的詳情（桌機）：用單號搜尋後按「查看與處理」。 */
async function openPo(page: Page, no: string) {
  await nav(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await page.getByTestId('po-search').locator('visible=true').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('po-detail')).toBeVisible();
}
const detail = (page: Page) => dialog(page).getByTestId('po-detail');
async function act(page: Page, action: string, note?: string, expectNotice?: RegExp) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  if (note !== undefined) await d.getByTestId('f-note').fill(note);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('pd-notice')).toContainText(expectNotice || /已/);
}
async function receive(page: Page, p: { delivered: string; accepted?: string; reason?: string }) {
  await dialog(page).getByTestId('act-receipt').click();
  const form = dialog(page).getByTestId('receipt-form');
  await expect(form).toBeVisible();
  await form.getByTestId('rc-delivered-0').fill(p.delivered);
  if (p.accepted !== undefined) await form.getByTestId('rc-accepted-0').fill(p.accepted);
  if (p.reason) await form.getByTestId('rc-reason-0').fill(p.reason);
  return form;
}

test('主線：總務建單（歷史價、含稅超過門檻）→ 送核准 → 開單人不能自己核准 → 核准人駁回（原因必填）→ 改價再送 → 核准 → 下訂 → 分批到貨與破損、超量被擋 → 配發到兩店建設備 → 店長貼標補序號 → 複核 → 補收配發餘額 → 結案', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(900_000);
  let no = '';
  let poId = '';
  // 歷史價：先用 API 下兩張同料件的單（已下訂以上才算）
  const seedApi = await apiForUser(users.purchaser_approver as any);
  const seedHistory = async (price: number, tag: string) => {
    const c = await seedApi.post(POX, { data: { header: { vendor_id: vendor.id, receiving_location_id: loc.id, notes: `[自動測試]M7M8 ${tag}` }, items: [{ part_id: part.id, quantity: 1, unit_price: price }], idempotency_key: `jp-${tag}-${Date.now()}` } });
    const po = (await c.json()).data;
    const o = await seedApi.post(`${POX}/${po.id}/actions`, { data: { action: 'place_order', expected_updated_at: po.updated_at } });
    expect(o.status(), await o.text()).toBe(200);
  };
  await seedHistory(2800, 'JP-H1');
  await seedHistory(3100, 'JP-H2');
  await seedApi.dispose();

  // ------------------------------------------------------------ 1. 總務採購（桌機）建單並送核准
  const buyer = await open(browser, 'purchaser_approver', 'desktop');
  try {
    await openGaCenter(buyer.page);
    expect(await sideLabels(buyer.page)).toEqual(expect.arrayContaining(['採購單', '待簽核採購單']));
    await nav(buyer.page, '採購單');
    await buyer.page.getByTestId('new-po').locator('visible=true').click();
    await expect(heading(buyer.page, '新增採購單')).toBeVisible();
    const form = buyer.page.getByTestId('po-form').locator('visible=true');
    await pickIn(form, 'pe-vendor', vendor.name);
    await pickIn(form, 'pe-location', loc.name);
    await pickIn(form, 'pe-part-0', part.name);
    await expect(form.getByTestId('pe-part-template-0')).toContainText(tpl.name);
    // 歷史價顯示最近 5 筆已下訂以上：兩筆
    await expect(form.getByTestId('pe-history-row')).toHaveCount(2);
    await expect(form.getByTestId('pe-history-0')).toContainText(vendor.name);
    await form.getByTestId('pe-qty-0').fill('5');
    await form.getByTestId('pe-price-0').fill('3000');
    await expect(form.getByTestId('pe-total')).toHaveText('$15,750');
    await expect(form.getByTestId('pe-approval-hint')).toContainText('需要採購核准人核准');
    await form.getByTestId('pe-save').click();
    await expect(buyer.page.getByTestId('pe-saved').locator('visible=true')).toBeVisible();
    no = (await buyer.page.getByTestId('pe-po-no').locator('visible=true').textContent())!.trim();
    expect(no).toMatch(/^PO-\d{8}-\d{3,}$/);
    let po = await dbPo(no);
    poId = po.id;
    expect(po).toMatchObject({ status: 'DRAFT', vendor_id: vendor.id, receiving_location_id: loc.id, approval_required: true, created_by: users.purchaser_approver.id });
    expect(Number(po.total_amount)).toBe(15750);
    await buyer.page.getByTestId('back-list').locator('visible=true').click();
    await openPo(buyer.page, no);
    await expect(detail(buyer.page).getByTestId('pd-status')).toHaveText('草稿');
    // 超過門檻的草稿只留「送核准」，不顯示「下訂」
    await expect(dialog(buyer.page).getByTestId('act-place_order')).toHaveCount(0);
    await act(buyer.page, 'submit', '請核准採購印表機', /已送核准/);
    await expect(detail(buyer.page).getByTestId('pd-status')).toHaveText('待核准');
    po = await dbPo(no);
    expect(po).toMatchObject({ status: 'PENDING_APPROVAL', submitted_by: users.purchaser_approver.id });
    // 2a. 開單人自己（持核准權限）看到不能核准的說明，沒有核准與駁回按鈕
    await expect(dialog(buyer.page).getByTestId('approve-blocked')).toContainText('開單人');
    for (const a of ['approve', 'reject']) await expect(dialog(buyer.page).getByTestId(`act-${a}`)).toHaveCount(0);
    await expect(dialog(buyer.page).getByTestId('pd-billing-masked')).toBeVisible(); // 沒有廠商權限：看不到統編與付款條件
    await dialog(buyer.page).getByTestId('pd-close').click();
    expect(real(buyer.errors)).toEqual([]);
  } finally {
    await buyer.ctx.close();
  }
  // 2b. API：開單人自己、沒有核准權限的人核准都被擋；狀態不變
  {
    const own = await apiForUser(users.purchaser_approver as any);
    const nonApprover = await apiForUser(users.purchaser_eq as any);
    const cur = await dbPo(no);
    const r1 = await own.post(`${POX}/${poId}/actions`, { data: { action: 'approve', expected_updated_at: cur.updated_at } });
    expect(r1.status()).toBe(403);
    expect((await r1.json()).code).toBe('SELF_APPROVAL');
    const r2 = await nonApprover.post(`${POX}/${poId}/actions`, { data: { action: 'approve', expected_updated_at: cur.updated_at } });
    expect(r2.status()).toBe(403);
    expect((await dbPo(no)).status).toBe('PENDING_APPROVAL');
    await own.dispose();
    await nonApprover.dispose();
  }

  // ------------------------------------------------------------ 3. 核准人（桌機）看到待簽核、駁回（原因必填）
  const approver = await open(browser, 'ga_po_approver', 'desktop');
  try {
    await openGaCenter(approver.page);
    await nav(approver.page, '待簽核採購單');
    await expect(heading(approver.page, '待簽核採購單')).toBeVisible();
    const card = approver.page.locator('[data-testid="ap-card"]:visible', { hasText: no });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('ap-amount')).toHaveText('$15,750');
    await card.getByTestId('open-approve').click();
    const d = dialog(approver.page);
    await expect(d.getByTestId('po-detail')).toBeVisible();
    await expect(d.getByTestId('act-approve')).toBeVisible();
    await expect(d.getByTestId('act-place_order')).toHaveCount(0); // 核准人沒有採購寫入權限
    await d.getByTestId('act-reject').click();
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-error')).toContainText('必須填寫'); // 駁回原因必填
    await d.getByTestId('f-note').fill('單價偏高，請再向供應商議價');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('pd-notice')).toContainText('已駁回');
    expect(await dbPo(no)).toMatchObject({ status: 'DRAFT', last_reject_reason: '單價偏高，請再向供應商議價' });
    await d.getByTestId('pd-close').click();
    await expect(approver.page.locator('[data-testid="ap-card"]:visible', { hasText: no })).toHaveCount(0);
    expect(real(approver.errors)).toEqual([]);
  } finally {
    await approver.ctx.close();
  }

  // ------------------------------------------------------------ 4. 開單人看到駁回原因，改單價再送
  const buyer2 = await open(browser, 'purchaser_approver', 'desktop');
  try {
    await openGaCenter(buyer2.page);
    await openPo(buyer2.page, no);
    await expect(detail(buyer2.page).getByTestId('pd-reject-reason')).toContainText('單價偏高');
    await dialog(buyer2.page).getByTestId('act-edit').click();
    await expect(heading(buyer2.page, '編輯採購單')).toBeVisible();
    const form = buyer2.page.getByTestId('po-form').locator('visible=true');
    await expect(form.getByTestId('pe-price-0')).toHaveValue('3000');
    await form.getByTestId('pe-price-0').fill('2900');
    await expect(form.getByTestId('pe-total')).toHaveText('$15,225');
    await form.getByTestId('pe-save').click();
    await expect(buyer2.page.getByTestId('pe-saved').locator('visible=true')).toBeVisible();
    expect(Number((await dbPo(no)).total_amount)).toBe(15225);
    await buyer2.page.getByTestId('back-list').locator('visible=true').click();
    await openPo(buyer2.page, no);
    await act(buyer2.page, 'submit', '已重新議價', /已送核准/);
    expect(await dbPo(no)).toMatchObject({ status: 'PENDING_APPROVAL', submitted_by: users.purchaser_approver.id });
    await dialog(buyer2.page).getByTestId('pd-close').click();
  } finally {
    await buyer2.ctx.close();
  }

  // ------------------------------------------------------------ 5. 核准人核准
  const approver2 = await open(browser, 'ga_po_approver', 'desktop');
  try {
    await openGaCenter(approver2.page);
    await nav(approver2.page, '待簽核採購單');
    await approver2.page.locator('[data-testid="ap-card"]:visible', { hasText: no }).getByTestId('open-approve').click();
    await act(approver2.page, 'approve', '同意採購', /已核准/);
    const po = await dbPo(no);
    expect(po).toMatchObject({ status: 'APPROVED', approval_note: '同意採購' });
    expect(po.approved_by).not.toBe(users.purchaser_approver.id);
    expect(real(approver2.errors)).toEqual([]);
  } finally {
    await approver2.ctx.close();
  }

  // ------------------------------------------------------------ 6. 總務下訂、到貨（短收原因、破損）、超量被擋、配發
  const ga = await open(browser, 'purchaser_approver', 'desktop');
  try {
    await openGaCenter(ga.page);
    await openPo(ga.page, no);
    await act(ga.page, 'place_order', undefined, /已下訂/);
    let po = await dbPo(no);
    expect(po).toMatchObject({ status: 'ORDERED', vendor_name_snapshot: vendor.name, vendor_tax_id_snapshot: vendor.tax_id, vendor_payment_terms_snapshot: vendor.payment_terms, ordered_by: users.purchaser_approver.id });
    // 下訂後鎖定：沒有編輯草稿，只能改備註與預計到貨日
    await expect(dialog(ga.page).getByTestId('act-edit')).toHaveText('改備註與預計到貨日');
    const base = await dbBal();
    // 第一次到貨 3 台：到貨量小於剩餘量（短收）要原因
    let form = await receive(ga.page, { delivered: '3' });
    await expect(form.getByTestId('rc-problem-0')).toContainText('必須填寫原因');
    await form.getByTestId('rc-submit').click();
    await expect(form.getByTestId('rc-error')).toContainText('必須填寫原因');
    await form.getByTestId('rc-reason-0').fill('廠商分批出貨');
    await form.getByTestId('rc-submit').click();
    await expect(dialog(ga.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
    expect(await dbBal()).toBe(base + 3);
    po = await dbPo(no);
    expect(po.status).toBe('PARTIALLY_RECEIVED');
    await expect(dialog(ga.page).getByTestId('pd-status')).toHaveText('部分到貨');
    // 第二次：到貨 2 台中 1 台破損（填原因）→ 驗入 1，庫存 +1
    form = await receive(ga.page, { delivered: '2', accepted: '1', reason: '外箱破損，拒收 1 台' });
    await form.getByTestId('rc-submit').click();
    await expect(dialog(ga.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
    expect(await dbBal()).toBe(base + 4);
    await expect(dialog(ga.page).getByTestId('pd-receipt')).toHaveCount(2);
    // 超量被擋：剩餘可收 1，到貨 2
    form = await receive(ga.page, { delivered: '2' });
    await expect(form.getByTestId('rc-problem-0')).toContainText('超過剩餘可收量');
    await form.getByTestId('rc-submit').click();
    await expect(form.getByTestId('rc-error')).toContainText('剩餘可收量');
    expect(await dbBal()).toBe(base + 4);
    await form.getByTestId('rc-cancel').click();
    // 配發 2 台到 ZT01（序號空白）
    await dialog(ga.page).getByTestId('act-dispatch').click();
    let dp = dialog(ga.page).getByTestId('dispatch-form');
    await expect(dp).toBeVisible();
    await expect(dp.getByTestId('dp-template-mapped')).toBeVisible();
    await pickIn(dp, 'dp-store', 'ZT01');
    await dp.getByTestId('dp-qty').fill('5');
    await dp.getByTestId('dp-submit').click();
    await expect(dp.getByTestId('dp-error')).toContainText('超過目前可配發量'); // 驗入 4 台，不能配發 5 台
    await dp.getByTestId('dp-qty').fill('2');
    await dp.getByTestId('dp-submit').click();
    await expect(dialog(ga.page).getByTestId('pd-notice')).toContainText('已配發並建立 2 筆設備');
    expect(await dbBal()).toBe(base + 2);
    // 再配發 1 台到 VW001
    await dialog(ga.page).getByTestId('act-dispatch').click();
    dp = dialog(ga.page).getByTestId('dispatch-form');
    await pickIn(dp, 'dp-store', 'VW001');
    await dp.getByTestId('dp-qty').fill('1');
    await dp.getByTestId('dp-submit').click();
    await expect(dialog(ga.page).getByTestId('pd-notice')).toContainText('已配發並建立 1 筆設備');
    expect(await dbBal()).toBe(base + 1);
    const eqs = await dbEquip(poId);
    expect(eqs).toHaveLength(3);
    expect(eqs.filter((e) => e.store_id === sid.ZT01)).toHaveLength(2);
    expect(eqs.filter((e) => e.store_id === sid.VW001)).toHaveLength(1);
    for (const e of eqs) expect(e).toMatchObject({ serial_number: null, template_id: tpl.id, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', source_purchase_order_id: poId, vendor_id: vendor.id });
    await expect(dialog(ga.page).getByTestId('pd-dispatch')).toHaveCount(2);
    await dialog(ga.page).getByTestId('pd-close').click();
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }

  // ------------------------------------------------------------ 7. ZT01 店長（手機）：貼標待辦、補序號、拍兩張照片
  const eqs = await dbEquip(poId);
  const zt = eqs.filter((e) => e.store_id === sid.ZT01);
  const vw = eqs.filter((e) => e.store_id === sid.VW001);
  const mgr = await open(browser, 'rq_store_b', 'phone');
  try {
    await openGaCenter(mgr.page);
    await gaNavTo(mgr.page, '貼標待辦');
    const card = (code: string) => mgr.page.locator('li[data-testid="onb-card"]:visible', { hasText: code });
    for (const e of zt) await expect(card(e.asset_code)).toHaveCount(1);
    await expect(mgr.page.locator('li[data-testid="onb-card"]:visible', { hasText: vw[0].asset_code })).toHaveCount(0); // 別店的看不到
    const first = card(zt[0].asset_code);
    await expect(first.getByTestId('serial-current')).toContainText('尚未填寫');
    await first.getByTestId('serial-input').fill('');
    await first.getByTestId('serial-save').click();
    await expect(first.getByTestId('serial-error')).toContainText('請輸入序號');
    await first.getByTestId('serial-input').fill(`SN-JP-${zt[0].asset_code}`);
    await first.getByTestId('serial-save').click();
    await expect(notice(mgr.page, '已記錄')).toBeVisible();
    await expect(first.getByTestId('serial-current')).toContainText(`SN-JP-${zt[0].asset_code}`);
    expect(((await db().from('ga_equipment').select('serial_number').eq('id', zt[0].id).single()).data as any).serial_number).toBe(`SN-JP-${zt[0].asset_code}`);
    // 已有序號要改必須填原因
    await expect(first.getByTestId('serial-reason')).toBeVisible();
    await first.getByTestId('serial-input').fill('SN-CHANGED');
    await first.getByTestId('serial-save').click();
    await expect(first.getByTestId('serial-error')).toContainText('必須填寫原因');
    await first.getByTestId('serial-input').fill('');
    // 拍兩張照片（設備照 → 貼標位置照）
    for (const step of [/已上傳.*設備照片，接著請上傳貼標位置照片/, /已上傳.*貼標位置照片，等總務複核/]) {
      await first.getByTestId('upload-input').setInputFiles({ name: 'm7m8t-jp.png', mimeType: 'image/png', buffer: png() });
      await first.getByRole('button', { name: '上傳照片' }).click();
      await expect(notice(mgr.page, step)).toBeVisible();
    }
    await expect(first).toHaveCount(0); // 從待辦消失
    await expect(card(zt[1].asset_code)).toHaveCount(1);
    expect(await noPageOverflow(mgr.page)).toBe(true);
    expect(real(mgr.errors)).toEqual([]);
  } finally {
    await mgr.ctx.close();
  }
  expect((await db().from('ga_equipment').select('onboarding_status').eq('id', zt[0].id).single()).data).toMatchObject({ onboarding_status: 'PENDING_GA_REVIEW' });
  // VW001 店長（手機）只看到自己門市那一台，且序號空白
  const mgrA = await open(browser, 'rq_store_a', 'phone');
  try {
    await openGaCenter(mgrA.page);
    await gaNavTo(mgrA.page, '貼標待辦');
    await expect(mgrA.page.locator('li[data-testid="onb-card"]:visible', { hasText: vw[0].asset_code })).toHaveCount(1);
    await expect(mgrA.page.locator('li[data-testid="onb-card"]:visible', { hasText: zt[1].asset_code })).toHaveCount(0);
  } finally {
    await mgrA.ctx.close();
  }

  // ------------------------------------------------------------ 8. 另一位持設備管理權限的總務複核通過
  const rev = await open(browser, 'purchaser_eq', 'desktop');
  try {
    await openGaCenter(rev.page);
    await gaNavTo(rev.page, '貼標複核');
    const rc = rev.page.locator('li[data-testid="review-card"]:visible', { hasText: zt[0].asset_code });
    await expect(rc).toBeVisible();
    await rc.getByRole('button', { name: '通過' }).click();
    await dialog(rev.page).getByRole('button', { name: '確認通過' }).click();
    await expect(notice(rev.page, /已通過.*的貼標複核/)).toBeVisible();
    await expect(rc).toHaveCount(0);
    expect((await db().from('ga_equipment').select('onboarding_status').eq('id', zt[0].id).single()).data).toMatchObject({ onboarding_status: 'COMPLETED' });
    expect(real(rev.errors)).toEqual([]);
  } finally {
    await rev.ctx.close();
  }

  // ------------------------------------------------------------ 9. 補收 1 台、配發餘額、全部到貨、結案
  const ga2 = await open(browser, 'purchaser_approver', 'desktop');
  try {
    await openGaCenter(ga2.page);
    await openPo(ga2.page, no);
    const base = await dbBal();
    const form = await receive(ga2.page, { delivered: '1' });
    await form.getByTestId('rc-submit').click();
    await expect(dialog(ga2.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
    await expect(dialog(ga2.page).getByTestId('pd-status')).toHaveText('全部到貨');
    expect(await dbBal()).toBe(base + 1);
    await expect(dialog(ga2.page).getByTestId('act-receipt')).toHaveCount(0); // 沒有剩餘可收量
    await dialog(ga2.page).getByTestId('act-dispatch').click();
    const dp = dialog(ga2.page).getByTestId('dispatch-form');
    await pickIn(dp, 'dp-store', 'ZT01');
    await dp.getByTestId('dp-qty').fill('2');
    await dp.getByTestId('dp-serials').fill(`SN-JP-X1\nSN-JP-X2`);
    await dp.getByTestId('dp-submit').click();
    await expect(dialog(ga2.page).getByTestId('pd-notice')).toContainText('已配發並建立 2 筆設備');
    expect(await dbBal()).toBe(base - 1);
    const all = await dbEquip(poId);
    expect(all).toHaveLength(5);
    expect(all.filter((e) => e.serial_number && /^SN-JP-X/.test(e.serial_number))).toHaveLength(2);
    await expect(dialog(ga2.page).getByTestId('act-dispatch')).toHaveCount(0); // 沒有可配發量
    await act(ga2.page, 'close', undefined, /已結案/);
    await expect(dialog(ga2.page).getByTestId('pd-status')).toHaveText('已結案');
    // 結案後完全鎖定：沒有任何動作按鈕
    for (const a of ['cancel', 'close', 'short_close', 'place_order', 'edit']) await expect(dialog(ga2.page).getByTestId(`act-${a}`)).toHaveCount(0);
    // 事件時間軸：每一步操作人與時間都有，順序與資料庫一致
    const events = await dbEvents(poId);
    const types = events.map((e) => e.event_type);
    expect(types).toEqual(['create', 'submit', 'reject', 'update', 'submit', 'approve', 'place_order', 'receive', 'receive', 'dispatch', 'dispatch', 'receive', 'dispatch', 'close']);
    expect(events.every((e) => e.actor_id && e.created_at)).toBe(true);
    await expect(dialog(ga2.page).getByTestId('pd-event')).toHaveCount(events.length);
    expect(events.find((e) => e.event_type === 'reject').note).toBe('單價偏高，請再向供應商議價');
    expect(events.find((e) => e.event_type === 'approve').actor_id).not.toBe(users.purchaser_approver.id);
    expect(await noPageOverflow(ga2.page)).toBe(true);
    await dialog(ga2.page).getByTestId('pd-close').click();
    expect(real(ga2.errors)).toEqual([]);
  } finally {
    await ga2.ctx.close();
  }
  const final = await dbPo(no);
  expect(final).toMatchObject({ status: 'CLOSED', closed_by: users.purchaser_approver.id });
  const items = ((await db().from('ga_purchase_order_items').select('*').eq('po_id', poId)).data || []) as any[];
  expect(items.map((i) => [Number(i.received_qty), Number(i.dispatched_qty)])).toEqual([[5, 5]]);
});

test('沒權限做不到：缺權限的帳號與非核准人，介面與 API 都被擋（缺哪個權限講清楚）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用桌機，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  // 準備一張已下訂且已到貨 1 台的單
  const buyer = await apiForUser(users.purchaser_approver as any);
  const created = await buyer.post(POX, { data: { header: { vendor_id: vendor.id, receiving_location_id: loc.id, notes: '[自動測試]M7M8 JP-NP' }, items: [{ part_id: part.id, quantity: 2, unit_price: 100 }], idempotency_key: `jp-np-${Date.now()}` } });
  const po = (await created.json()).data;
  const ordered = await (await buyer.post(`${POX}/${po.id}/actions`, { data: { action: 'place_order', expected_updated_at: po.updated_at } })).json();
  const itemId = ordered.data.items[0].id;
  const rcp = await buyer.post(`${POX}/${po.id}/receipts`, { data: { header: {}, lines: [{ po_item_id: itemId, delivered_qty: 1, reason: '分批' }], idempotency_key: `jp-np-r-${Date.now()}` } });
  expect(rcp.status(), await rcp.text()).toBe(201);
  const mk = async (k: string) => apiForUser(users[k] as any);
  const stock = await mk('stock_only');
  const review = await mk('review_only');
  const mgr = await mk('rq_store_b');
  const body = { header: {}, lines: [{ po_item_id: itemId, delivered_qty: 1 }], idempotency_key: 'jp-np-x' };
  const r1 = await stock.post(`${POX}/${po.id}/receipts`, { data: body });
  expect(r1.status()).toBe(403);
  expect((await r1.json()).error).toContain('採購評估管理');
  const r2 = await review.post(`${POX}/${po.id}/receipts`, { data: body });
  expect(r2.status()).toBe(403);
  expect((await r2.json()).error).toContain('庫存交易管理');
  const r3 = await review.post(`${POX}/${po.id}/dispatches`, { data: { po_item_id: itemId, store_id: sid.ZT01, quantity: 1, idempotency_key: 'jp-np-d' } });
  expect(r3.status()).toBe(403);
  expect((await mgr.post(`${POX}/${po.id}/dispatches`, { data: { po_item_id: itemId, store_id: sid.ZT01, quantity: 1, idempotency_key: 'jp-np-d2' } })).status()).toBe(403);
  expect((await mgr.get(POX)).status()).toBe(403);
  // 介面：缺權限的店長沒有「採購單」入口
  const m = await open(browser, 'rq_store_b', 'phone');
  try {
    await openGaCenter(m.page);
    const labels = await sideLabels(m.page);
    expect(labels).not.toContain('採購單');
    expect(labels).not.toContain('待簽核採購單');
    expect(await noPageOverflow(m.page)).toBe(true);
  } finally {
    await m.ctx.close();
  }
  for (const c of [buyer, stock, review, mgr]) await c.dispose();
  // 庫存沒有被動到（只到貨 1 台）
  expect(await dbBal()).toBeGreaterThanOrEqual(1);
  const items = ((await db().from('ga_purchase_order_items').select('received_qty,dispatched_qty').eq('id', itemId)).data || []) as any[];
  expect(items.map((i) => [Number(i.received_qty), Number(i.dispatched_qty)])).toEqual([[1, 0]]);
});
