import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedCategory, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-void-stat.journey-void-stat（角色接力劇本，桌機與手機各跑一次）：進貨登錯 → 作廢 → 重登 → 請款 → 付款 → 統計 → 付款退回 → 再作廢進貨。
// 總務（clerk）把登錯的進貨作廢（庫存沖回、採購單回到已下訂、留原因）→ 重登進貨並建立請款單送出 → 總務再想作廢這筆進貨被擋（指出請款單號）→
// 會計（accountant，只有請款權限）在首頁看到「待付款請款單」、點進去標已付款，首頁待付款歸零；會計沒有作廢進貨的權限（沒有按鈕、API 403）→
// 採購分析顯示已請款與已付款、驗入未請款為 0 → 會計作廢已付款請款單（必填原因）→ 該採購單回到「待請款」、首頁出現 → 總務現在可以作廢進貨 → 數字全部歸零 →
// 請款檢視者（viewer）唯讀看到兩張已作廢進貨與原因，沒有作廢按鈕。每步用 service role 回讀資料庫（庫存餘額、進貨、請款單、事件）。
// 測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記、VW／ZT 門市、只用 DEV；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer'];
const P = '/api/workspace/general-affairs';
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
let vendor: any;
let po: any;
let loc: any;
let part: any;
let rcWrong: any;
let rcRight: any;
let prNo = '';
let prId = '';
const db = () => adminDb();
const key = () => crypto.randomUUID();
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const cards = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const balance = async () => Number((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).maybeSingle()).data?.quantity_base ?? 0);
const dbPo = async () => (await db().from('ga_purchase_orders').select('*').eq('id', po.id).single()).data as any;
const dbRc = async (id: string) => (await db().from('ga_purchase_receipts').select('*').eq('id', id).single()).data as any;
const dbPr = async () => (await db().from('ga_payment_requests').select('*').eq('pr_no', prNo).maybeSingle()).data as any;
const apiJson = async (who: string, p: string) => (await apis[who].get(`${P}/${p}`)).json();
async function openPoDetail(page: Page) {
  await openGaCenter(page);
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: '採購單', exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(po.po_no);
  await expect(cards(page, 'po-card')).toHaveCount(1);
  await vis(page, 'open-detail').click();
  await expect(vis(page, 'po-detail')).toBeVisible();
}
async function homeCount(page: Page, k: string) {
  const el = page.locator(`[data-testid="home-count-${k}"]:visible`);
  return (await el.count()) ? Number(await el.first().innerText()) : null;
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGa45Vendor('VJNY');
  const cat = await seedCategory('part', 'VJNY');
  part = await seedPart(cat.id, 'VJNY-P');
  loc = await seedLocation(null, 'VJNY-W');
  await seedLocationPart(loc.id, part.id);
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('VJNY1'), vendor_id: vendor.id, receiving_location_id: loc.id }, p_items: [{ part_id: part.id, quantity: 20, unit_price: 100 }], p_create_key: key() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  // 登錯的進貨：訂 20 件、誤登 12 件
  rcWrong = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: 12 }], p_key: key() });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1. 總務把登錯的進貨作廢：原因必填；庫存沖回、採購單回到已下訂、已驗入歸零、事件有原因', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  expect(await balance()).toBe(12);
  expect((await dbPo()).status).toBe('PARTIALLY_RECEIVED');
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openPoDetail(page);
    await expect(vis(page, 'pd-status')).toHaveText('部分到貨');
    await vis(page, 'void-receipt-' + rcWrong.receipt_no).click();
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'void-receipt-error')).toContainText('必須填寫原因');
    expect((await dbRc(rcWrong.id)).voided_at).toBeNull(); // 沒填原因，沒有動作
    await vis(page, 'f-void-reason').fill('數量登錯，實際只收 8 件');
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'pd-notice')).toContainText('進貨已作廢');
    await expect(vis(page, 'pd-status')).toHaveText('已下訂');
    await expect(vis(page, 'receipt-void-reason')).toContainText('數量登錯，實際只收 8 件');
    await expect(vis(page, 'pd-received')).toHaveText('0');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect(await balance()).toBe(0);
  expect(await dbPo()).toMatchObject({ status: 'ORDERED' });
  expect(await dbRc(rcWrong.id)).toMatchObject({ voided_by: users.clerk.id, void_reason: '數量登錯，實際只收 8 件' });
  const ev = ((await db().from('ga_purchase_order_events').select('*').eq('po_id', po.id).eq('event_type', 'receipt_void')).data || []) as any[];
  expect(ev).toHaveLength(1);
  expect(ev[0]).toMatchObject({ actor_id: users.clerk.id, note: '數量登錯，實際只收 8 件', from_status: 'PARTIALLY_RECEIVED', to_status: 'ORDERED' });
});

test('2. 總務重登進貨 8 件並建立請款單送出；再想作廢這筆進貨被擋並指出請款單號（失敗分支）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  rcRight = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: 8 }], p_key: key() });
  expect(await balance()).toBe(8);
  const c = await apis.clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rcRight.id }], notes: '作廢劇本貨款', idempotency_key: key() } });
  expect(c.status(), await c.text()).toBe(201);
  const created = (await c.json()).data;
  prNo = created.pr_no;
  prId = created.id;
  expect(created.amount_total).toBe(840); // 8 × 100 × 1.05
  const s = await apis.clerk.post(`${P}/payment-requests/${prId}/actions`, { data: { action: 'submit', expected_updated_at: created.updated_at, idempotency_key: key() } });
  expect(s.status(), await s.text()).toBe(200);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openPoDetail(page);
    await expect(cards(page, 'pd-receipt')).toHaveCount(2);
    await vis(page, 'void-receipt-' + rcRight.receipt_no).click();
    await vis(page, 'f-void-reason').fill('想再改一次');
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'void-receipt-error')).toContainText(prNo);
    await expect(vis(page, 'void-receipt-error')).toContainText('請先作廢或退回該請款單');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await dbRc(rcRight.id)).voided_at).toBeNull();
  expect(await balance()).toBe(8);
  expect((await dbPo()).status).toBe('PARTIALLY_RECEIVED');
});

test('3. 會計在首頁看到「待付款請款單」，點進去標已付款，待付款歸零；會計沒有作廢進貨的權限（沒有按鈕、API 403）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await expect.poll(() => homeCount(page, 'pay_submitted'), { timeout: 20_000 }).toBe(1); // 首頁待辦是非同步載入
    await expect(page.locator('[data-testid="home-item-pay_submitted"]:visible')).toContainText(prNo);
    await page.locator('[data-testid="home-item-pay_submitted"]:visible button.todo-head').click();
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await expect(vis(page, 'pr-tab-pay')).toHaveAttribute('aria-selected', 'true');
    await vis(page, 'pr-search').fill(prNo);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await cards(page, 'pr-card').first().getByTestId('open-pr').click();
    await vis(page, 'pe-paid').click();
    await vis(page, 'act-method').selectOption('TRANSFER');
    await vis(page, 'act-ref').fill('99001');
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('已付款');
    // 首頁待付款歸零
    await openGaCenter(page);
    await expect.poll(async () => (await homeCount(page, 'pay_submitted')) ?? 0, { timeout: 20_000 }).toBe(0);
    // 沒有作廢進貨的權限
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '採購單', exact: true }).locator('visible=true').first().click();
    await vis(page, 'po-search').fill(po.po_no);
    await vis(page, 'open-detail').click();
    await expect(vis(page, 'po-detail')).toBeVisible();
    await expect(page.locator('[data-testid^="void-receipt-"]:visible')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect(await dbPr()).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_ref: '99001', paid_by: users.accountant.id });
  const r = await apis.accountant.post(`${P}/purchase-orders/${po.id}/receipts/${rcRight.id}/void`, { data: { reason: '會計想作廢', idempotency_key: key(), expected_updated_at: (await dbRc(rcRight.id)).updated_at } });
  expect(r.status()).toBe(403);
  expect((await dbRc(rcRight.id)).voided_at).toBeNull();
});

test('4. 採購分析（會計）：已請款 840、已付款 840、驗入未請款 0；總務首頁沒有待請款', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).slice(0, 7);
  const ana = (await apiJson('accountant', `purchase-analysis?yearMonth=${month}&pageSize=100`)).data;
  const mine = (ana.orders as any[]).find((x) => x.id === po.id);
  expect(mine).toMatchObject({ claimed_amount: 840, paid_amount: 840, unclaimed_received_amount: 0 });
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '採購分析', exact: true }).locator('visible=true').first().click();
    await expect(visibleHeading(page, '採購分析')).toBeVisible();
    await expect(vis(page, 'pa-pay-cards')).toBeVisible();
    await expect(vis(page, 'pa-paid')).toContainText(Number(ana.confirmed.paid_amount).toLocaleString('en-US'));
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  const b = (await apiJson('clerk', 'home/badges')).data;
  const unclaimedIds = (await db().rpc('ga_pay_unclaimed_po_ids', { p_tol: 5 })).data as any[];
  expect(unclaimedIds.map((x) => x.po_id)).not.toContain(po.id);
  expect(b.items.pay_unclaimed).toBe(unclaimedIds.length);
});

test('5. 會計作廢已付款請款單（必填原因）→ 額度釋放，採購單回到「待請款」；總務首頁出現；現在可以作廢進貨', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const acc = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(acc.page);
    await openGaSide(acc.page);
    await shell(acc.page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
    await vis(acc.page, 'pr-search').fill(prNo);
    await cards(acc.page, 'pr-card').first().getByTestId('open-pr').click();
    await vis(acc.page, 'pe-void-btn').click();
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'act-error')).toContainText('原因');
    expect((await dbPr()).status).toBe('PAID');
    await vis(acc.page, 'act-reason').fill('銀行退票，款項退回');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('已作廢');
    expect(noConsole(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  expect(await dbPr()).toMatchObject({ status: 'VOID', void_reason: '銀行退票，款項退回' });
  // 採購單回到待請款
  const unclaimedIds = ((await db().rpc('ga_pay_unclaimed_po_ids', { p_tol: 5 })).data as any[]).map((x) => x.po_id);
  expect(unclaimedIds).toContain(po.id);
  const clerk = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(clerk.page);
    await expect(clerk.page.locator('[data-testid="home-item-pay_unclaimed"]:visible')).toContainText(po.po_no);
    await expect(clerk.page.locator('[data-testid="home-count-pay_unclaimed"]:visible')).toHaveText(String(unclaimedIds.length));
    // 現在可以作廢進貨：庫存沖回、採購單回到已下訂
    await openPoDetail(clerk.page);
    await vis(clerk.page, 'void-receipt-' + rcRight.receipt_no).click();
    await vis(clerk.page, 'f-void-reason').fill('款項退回，整批重收');
    await vis(clerk.page, 'void-receipt-submit').click();
    await expect(vis(clerk.page, 'pd-notice')).toContainText('進貨已作廢');
    await expect(vis(clerk.page, 'pd-status')).toHaveText('已下訂');
    await expect(clerk.page.locator('[data-testid="receipt-voided"]:visible')).toHaveCount(2);
    expect(await noPageOverflow(clerk.page)).toBe(true);
    expect(noConsole(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
  expect(await balance()).toBe(0);
  expect(await dbPo()).toMatchObject({ status: 'ORDERED' });
  expect(Number((await db().from('ga_purchase_order_items').select('received_qty').eq('po_id', po.id).single()).data!.received_qty)).toBe(0);
  const idsAfter = ((await db().rpc('ga_pay_unclaimed_po_ids', { p_tol: 5 })).data as any[]).map((x) => x.po_id);
  expect(idsAfter).not.toContain(po.id); // 沒有驗入，不再待請款
  // 統計歸零（採購分析：這張單已驗入 0、已請款 0）
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).slice(0, 7);
  const ana = (await apiJson('accountant', `purchase-analysis?yearMonth=${month}&pageSize=100`)).data;
  expect((ana.orders as any[]).find((x) => x.id === po.id)).toMatchObject({ received_amount: 0, claimed_amount: 0, paid_amount: 0, unclaimed_received_amount: 0 });
});

test('6. 請款檢視者唯讀：看得到兩張已作廢進貨與原因，沒有作廢按鈕；API 作廢 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openPoDetail(page);
    await expect(page.locator('[data-testid="receipt-voided"]:visible')).toHaveCount(2);
    await expect(page.locator('[data-testid="receipt-void-reason"]:visible').first()).toContainText('作廢原因');
    await expect(page.locator('[data-testid^="void-receipt-"]:visible')).toHaveCount(0);
    await expect(vis(page, 'pd-events')).toContainText('作廢進貨');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  const r = await apis.viewer.post(`${P}/purchase-orders/${po.id}/receipts/${rcRight.id}/void`, { data: { reason: '想作廢', idempotency_key: key(), expected_updated_at: new Date().toISOString() } });
  expect(r.status()).toBe(403);
});
