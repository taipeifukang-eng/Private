import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedVendor, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';

// M7/M8 第 4 批 多角色補充劇本（桌機 project 跑一次；總務桌機 1440、店長手機 390）。
// 主線劇本（印表機 5 台、設備添購、料件補貨、資產移轉帶單、無權限）已在 G25 / G16 / G17 / G27 的 journey 檔；本檔補其中沒走到的邊界，每步 DB 回讀：
//  1. 核准門檻邊界：含稅剛好 5000 免核准（沒有送核准、直接下訂、API 送核准被擋）；5001 要核准：不能直接下訂、非核准人不能核准、駁回須原因並退回草稿、
//     再送後開單人與最後送簽人都不能核准、另一帳號核准後才能下訂，下訂後品項鎖定（改單被擋）。
//  2. 料件補貨的 D5 逾期：處理單送門市確認後，等待 6 天不標逾期、超過 7 天標「逾期未確認」；店長看不到標示、只標示不自動結案；店長確認後標示消失；
//     庫存出庫超量由 G17 劇本驗；此處只驗逾期期間庫存不動。
//  3. 無權限：店長（手機）開不了採購單、不能核准；沒有核准權限的總務不能核准超額單（介面沒有按鈕、API 被擋）。
const POX = '/api/workspace/general-affairs/purchase-orders';
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
type Who = { ctx: BrowserContext; page: Page; errors: string[] };
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let sid: Record<string, string> = {};
let vendor: any;
let part: any;
let loc: any;
const db = () => adminDb();

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['purchaser', 'purchaser_approver', 'approver2', 'rq_staff', 'rq_store_part']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const st = await stores();
  sid = { VW001: st.VW001.id };
  const cat = await seedCategory('part', 'MRJ');
  part = await seedPart(cat.id, 'MRJ-耗材', { base_unit: '個', allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  loc = await seedLocation(null, 'MRJ-倉');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
  vendor = await seedVendor('MRJ');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function open(browser: Browser, key: string, kind: 'desktop' | 'mobile'): Promise<Who> {
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: states[key] || (await storageStateFor(key as any)), serviceWorkers: 'block',
    ...(kind === 'mobile' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
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
const detail = (page: Page) => dialog(page).getByTestId('po-detail');
async function openPo(page: Page, no: string) {
  await nav(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await page.getByTestId('po-search').locator('visible=true').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(detail(page)).toBeVisible();
}
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbEvents = async (id: string) => ((await db().from('ga_purchase_order_events').select('*').eq('po_id', id).order('created_at').order('id')).data || []) as any[];

type Api = Awaited<ReturnType<typeof apiForUser>>;
const apis: Record<string, Api> = {};
const as = async (key: string) => (apis[key] ||= await apiForUser(users[key] as any));
async function mkPo(key: string, unitPrice: number, tag: string, qty = 1) {
  const r = await (await as(key)).post(POX, { data: { header: { vendor_id: vendor.id, receiving_location_id: loc.id, notes: `[自動測試]M7M8 ${tag}` }, items: [{ part_id: part.id, quantity: qty, unit_price: unitPrice }], idempotency_key: `mr-${tag}-${Date.now()}` } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()).data as any;
}
async function act(key: string, po: any, action: string, note?: string) {
  const r = await (await as(key)).post(`${POX}/${po.id}/actions`, { data: { action, expected_updated_at: po.updated_at, ...(note ? { note } : {}) } });
  return { status: r.status(), body: await r.json().catch(() => ({})) as any };
}
const fresh = async (key: string, id: string) => (await (await (await as(key)).get(`${POX}/${id}`)).json()).data as any;

test('核准門檻邊界：含稅剛好 5000 免核准直接下訂；5001 駁回退回草稿、核准人限制、核准後才能下訂、下訂後鎖定', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機，只在桌機 project 跑一次');
  test.setTimeout(600_000);
  // ---------- 剛好 5000（未稅 4762 + 稅 238）
  const exact = await mkPo('purchaser', 4762, 'MR-5000');
  expect([exact.subtotal, exact.tax_amount, exact.total_amount].map(Number)).toEqual([4762, 238, 5000]);
  expect(exact.approval_required).toBe(false);
  const noNeed = await act('purchaser', exact, 'submit', '不需要');
  expect(noNeed.status).toBe(409);
  expect(JSON.stringify(noNeed.body)).toContain('NO_APPROVAL_NEEDED');
  const ga = await open(browser, 'purchaser', 'desktop');
  try {
    await openGaCenter(ga.page);
    await openPo(ga.page, exact.po_no);
    await expect(detail(ga.page).getByTestId('pd-status')).toHaveText('草稿');
    await expect(dialog(ga.page).getByTestId('act-submit')).toHaveCount(0); // 免核准：沒有「送核准」
    await dialog(ga.page).getByTestId('act-place_order').click();
    await dialog(ga.page).getByTestId('action-submit').click();
    await expect(dialog(ga.page).getByTestId('pd-notice')).toContainText(/已/);
    await expect(detail(ga.page).getByTestId('pd-status')).toHaveText('已下訂');
    expect(await dbPo(exact.id)).toMatchObject({ status: 'ORDERED', approval_required: false, vendor_id: vendor.id });
    const types = (await dbEvents(exact.id)).map((e) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['create', 'place_order']));
    expect(types).not.toContain('submit');
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }

  // ---------- 5001（未稅 4763 + 稅 238）
  const over = await mkPo('purchaser', 4763, 'MR-5001');
  expect(Number(over.total_amount)).toBe(5001);
  expect(over.approval_required).toBe(true);
  const direct = await act('purchaser', over, 'place_order');
  expect(direct.status).toBeGreaterThanOrEqual(400); // 超過門檻不能直接下訂
  expect((await dbPo(over.id)).status).toBe('DRAFT');
  const sub1 = await act('purchaser', over, 'submit', '請核准');
  expect(sub1.status, JSON.stringify(sub1.body)).toBe(200);
  let po = await fresh('purchaser', over.id);
  expect(po.status).toBe('PENDING_APPROVAL');
  // 送簽人（purchaser）沒有核准權限；非核准人核准被擋
  const nonApprover = await act('purchaser', po, 'approve');
  expect(nonApprover.status).toBe(403);
  // 駁回須原因
  expect((await act('approver2', po, 'reject')).status).toBe(400);
  const rej = await act('approver2', po, 'reject', '價格偏高，請再詢價');
  expect(rej.status, JSON.stringify(rej.body)).toBe(200);
  po = await fresh('purchaser', over.id);
  expect(po).toMatchObject({ status: 'DRAFT', last_reject_reason: '價格偏高，請再詢價' });
  expect((await dbEvents(over.id)).find((e) => e.event_type === 'reject')?.note).toBe('價格偏高，請再詢價');
  // 退回草稿後由持核准權限的帳號（purchaser_approver）再送簽 → 它自己是最後送簽人，不能核准；另一個核准人可以
  const sub2 = await act('purchaser_approver', po, 'submit', '再送');
  expect(sub2.status, JSON.stringify(sub2.body)).toBe(200);
  po = await fresh('purchaser_approver', over.id);
  const self = await act('purchaser_approver', po, 'approve');
  expect(self.status).toBe(403); // 開單人／最後送簽人，管理員也不繞過
  expect((await dbPo(over.id)).status).toBe('PENDING_APPROVAL');
  const ok = await act('approver2', po, 'approve');
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  po = await fresh('purchaser', over.id);
  expect(po.status).toBe('APPROVED');
  const ordered = await act('purchaser', po, 'place_order');
  expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
  po = await fresh('purchaser', over.id);
  expect(po.status).toBe('ORDERED');
  // 下訂後鎖定：改單被擋
  const edit = await (await as('purchaser')).put(`${POX}/${over.id}`, { data: { header: { notes: '改' }, items: [{ part_id: part.id, quantity: 9, unit_price: 1 }], expected_updated_at: po.updated_at } });
  expect(edit.status()).toBeGreaterThanOrEqual(400);
  expect(Number((await dbPo(over.id)).total_amount)).toBe(5001);
  const types = (await dbEvents(over.id)).map((e) => e.event_type);
  expect(types).toEqual(expect.arrayContaining(['create', 'submit', 'reject', 'approve', 'place_order']));
});

test('料件補貨 D5：送門市確認後 6 天不逾期、超過 7 天標逾期（店長看不到）、只標示不自動結案', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const r = await seedRequest(sid.VW001, users.rq_store_part.id, 'MRJ-overdue', { request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART', part_id: part.id, desired_unit: part.base_unit, desired_quantity: 2, main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'STOCK_ISSUE', title: m7Name('補貨逾期') });
  const setSince = (days: number) => db().from('ga_service_requests').update({ waiting_confirm_since: new Date(Date.now() - days * 86400_000).toISOString() }).eq('id', r.id);
  const balance = async () => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
  const before = await balance();

  await setSince(6);
  const ga = await open(browser, 'ga_works', 'desktop');
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await ga.page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(r.request_no);
    const row = ga.page.locator('[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible', { hasText: r.request_no });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('row-overdue')).toHaveCount(0); // 6 天：未逾期
    await setSince(8);
    await ga.page.reload();
    await openGaCenter(ga.page);
    await nav(ga.page, '總務需求工作台');
    await ga.page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(r.request_no);
    const row2 = ga.page.locator('[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible', { hasText: r.request_no });
    await expect(row2).toHaveCount(1);
    await expect(row2.getByTestId('row-overdue')).toBeVisible(); // 8 天：逾期
    expect((await dbReqStatus(r.id))).toBe('WAITING_STORE_CONFIRMATION'); // 只標示不自動結案
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 庫存沒有被動到
  expect(await balance()).toBe(before);

  const store = await open(browser, 'rq_store_part', 'mobile');
  try {
    await openGaCenter(store.page);
    await nav(store.page, '我的追蹤');
    await store.page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(r.request_no);
    const card = store.page.locator('[data-testid="mr-card"]:visible', { hasText: r.request_no });
    await expect(card).toHaveCount(1);
    await card.getByTestId('open-detail').click();
    await expect(dialog(store.page).getByTestId('request-detail')).toBeVisible();
    await expect(dialog(store.page).getByTestId('detail-overdue')).toHaveCount(0);
    await store.page.getByTestId('act-confirm_complete').click();
    await store.page.getByTestId('action-submit').click();
    await expect(store.page.getByTestId('detail-notice')).toBeVisible();
    const done = (await db().from('ga_service_requests').select('*').eq('id', r.id).single()).data as any;
    expect(done.main_status).toBe('COMPLETED');
    expect(done.waiting_confirm_since).toBeNull();
    expect(real(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});
async function dbReqStatus(id: string) {
  return ((await db().from('ga_service_requests').select('main_status').eq('id', id).single()).data as any).main_status as string;
}

test('無權限做不到：店長（手機）開不了採購單也不能核准；沒有核准權限的總務不能核准超額單', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const over = await mkPo('purchaser', 6000, 'MR-NP');
  expect(over.approval_required).toBe(true);
  const sub = await act('purchaser', over, 'submit', '送核准');
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const po = await fresh('purchaser', over.id);

  const mgr = await as('rq_store_part');
  expect((await mgr.get(POX)).status()).toBe(403);
  expect((await mgr.post(POX, { data: { header: { vendor_id: vendor.id, receiving_location_id: loc.id }, items: [{ part_id: part.id, quantity: 1, unit_price: 1 }], idempotency_key: `mr-np-${Date.now()}` } })).status()).toBe(403);
  expect((await act('rq_store_part', po, 'approve')).status).toBe(403);
  // 另一位有採購三權限但沒有核准權限的總務（rq_staff）
  expect((await act('rq_staff', po, 'approve')).status).toBe(403);
  expect((await act('purchaser', po, 'approve')).status).toBe(403);
  expect((await dbPo(over.id)).status).toBe('PENDING_APPROVAL');

  const store = await open(browser, 'rq_store_part', 'mobile');
  try {
    await openGaCenter(store.page);
    const labels = await shell(store.page).locator('aside').getByRole('button').allInnerTexts().catch(() => [] as string[]);
    await openGaSide(store.page);
    const side = await shell(store.page).locator('aside').innerText();
    expect(side).not.toContain('待簽核採購單');
    expect(labels.join(' ')).not.toContain('待簽核採購單');
    await store.page.goto('/general-affairs/purchase-orders?view=approvals');
    await expect(store.page.getByTestId('act-approve')).toHaveCount(0);
    await expect(store.page.getByTestId('po-card')).toHaveCount(0);
    expect(real(store.errors).filter((e) => !/403|Forbidden/.test(e))).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  const staff = await open(browser, 'rq_staff', 'desktop');
  try {
    await openGaCenter(staff.page);
    await openPo(staff.page, over.po_no);
    await expect(detail(staff.page).getByTestId('pd-status')).toHaveText('待核准');
    for (const a of ['approve', 'reject']) await expect(dialog(staff.page).getByTestId(`act-${a}`)).toHaveCount(0);
  } finally {
    await staff.ctx.close();
  }
});
