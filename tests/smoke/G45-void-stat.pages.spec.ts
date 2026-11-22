import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-void-stat 冒煙層（桌機 1440 與手機 390 由 project viewport 決定）：
//   採購單詳情「作廢進貨」（原因必填視窗、已請款被擋並指出請款單號、作廢後標「已作廢」與原因、時間軸）、沒有管理權限者沒有作廢按鈕、
//   採購分析與廠商績效的請款金額（只給有請款權限者）、首頁「待請款採購單」「待付款請款單」與側欄徽章（數字等於資料庫、點進去的列表筆數相同）、無 pageerror／console 錯誤、無水平溢出。
const KEYS: Ga45Key[] = ['clerk', 'viewer', 'purchaser', 'perf_pay', 'perf_nopay'];
const P = '/api/workspace/general-affairs';
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const key = () => crypto.randomUUID();
const vis = (page: Page, id: string) => page.getByTestId(id).locator('visible=true');
const cards = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
async function sideBadge(page: Page, label: string): Promise<string> {
  await openGaSide(page);
  const row = shell(page).locator('aside .ga-row').filter({ has: page.getByRole('button', { name: label, exact: true }) }).first();
  const badge = row.locator('.ga-badge');
  return (await badge.count()) ? ((await badge.first().textContent()) || '').trim() : '';
}
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let vendor: any;
let po: any;
let rcA: any;
let rcB: any;
let rcC: any;
let prA: any;
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const api = async (who: string, p: string) => (await apis[who].get(`${P}/${p}`)).json();

async function openPoDetail(page: Page, poNo: string) {
  await gaNavTo(page, '採購單');
  await expect(visibleHeading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(poNo);
  await expect(cards(page, 'po-card')).toHaveCount(1);
  await vis(page, 'open-detail').click();
  await expect(vis(page, 'po-detail')).toBeVisible();
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
  vendor = await seedGa45Vendor('VSMK');
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('VSMK1'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 作廢冒煙品項', unit: '個', quantity: 20, unit_price: 100, fulfil_mode: 'NO_STOCK' }], p_create_key: key() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const recv = (qty: number) => rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: qty }], p_key: key() });
  rcA = await recv(10);
  rcB = await recv(5);
  rcC = await recv(5); // 沒有請款：讓採購單維持「待請款」
  // rcA 已有請款單（草稿）→ 作廢進貨會被擋；另一張已送出的請款單讓「待付款」有數字
  const a = await apis.clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rcA.id }], notes: '冒煙', idempotency_key: key() } });
  expect(a.status(), await a.text()).toBe(201);
  prA = (await a.json()).data;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('作廢進貨（總務）：已請款被擋並指出請款單號；原因必填；作廢後標已作廢與原因、數量與時間軸更新；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await openPoDetail(page, po.po_no);
    await expect(cards(page, 'pd-receipt')).toHaveCount(3);
    await expect(vis(page, 'void-receipt-' + rcA.receipt_no)).toBeVisible();
    await expect(vis(page, 'void-receipt-' + rcB.receipt_no)).toBeVisible();
    // 已請款：被伺服端擋下，白話指出請款單號；視窗留著不關
    await vis(page, 'void-receipt-' + rcA.receipt_no).click();
    await expect(vis(page, 'void-receipt-form')).toBeVisible();
    await vis(page, 'f-void-reason').fill('想重登');
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'void-receipt-error')).toContainText(prA.pr_no);
    await expect(vis(page, 'void-receipt-error')).toContainText('請先作廢或退回該請款單');
    expect(await noPageOverflow(page)).toBe(true);
    await vis(page, 'void-receipt-cancel').click();
    await expect(cards(page, 'pd-receipt')).toHaveCount(3);
    await expect(page.locator('[data-testid="receipt-voided"]:visible')).toHaveCount(0);
    // 原因必填
    await vis(page, 'void-receipt-' + rcB.receipt_no).click();
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'void-receipt-error')).toContainText('必須填寫原因');
    await vis(page, 'f-void-reason').fill('進貨登錯品項');
    await vis(page, 'void-receipt-submit').click();
    await expect(vis(page, 'pd-notice')).toContainText('進貨已作廢');
    // 作廢後：標已作廢、顯示原因、沒有作廢按鈕、已驗入數量扣回、時間軸多一筆
    await expect(page.locator('[data-testid="receipt-voided"]:visible')).toHaveCount(1);
    await expect(vis(page, 'receipt-void-reason')).toContainText('進貨登錯品項');
    await expect(page.locator(`[data-testid="void-receipt-${rcB.receipt_no}"]:visible`)).toHaveCount(0);
    await expect(vis(page, 'pd-received')).toHaveText('15'); // A 10 ＋ C 5（B 已作廢）
    await expect(vis(page, 'pd-events')).toContainText('作廢進貨');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 資料庫回讀
  const row = await (await apis.clerk.get(`${P}/purchase-orders/${po.id}/receipts`)).json();
  expect((row.data.receipts as any[]).find((r) => r.id === rcB.id).voided_at).toBeTruthy();
  expect(Number(row.data.items[0].received_qty)).toBe(15);
});

test('沒有管理權限者沒有作廢按鈕：只有請款檢視者看不到；採購角色（沒有請款權限）看得到按鈕但沒有「發票與請款」分頁', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const who of ['viewer', 'purchaser'] as const) {
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await openGaCenter(page);
      await openPoDetail(page, po.po_no);
      await expect(cards(page, 'pd-receipt')).toHaveCount(3);
      if (who === 'viewer') {
        await expect(page.locator('[data-testid^="void-receipt-"]:visible')).toHaveCount(0);
        await expect(vis(page, 'pd-tab-pay')).toBeVisible();
      } else {
        await expect(vis(page, 'void-receipt-' + rcA.receipt_no)).toBeVisible(); // B 已作廢沒有按鈕，A、C 有
        await expect(page.locator('[data-testid^="void-receipt-RC"]:visible')).toHaveCount(2);
        await expect(page.locator('[data-testid="pd-tab-pay"]:visible')).toHaveCount(0);
      }
      await expect(page.locator('[data-testid="receipt-voided"]:visible')).toHaveCount(1); // 已作廢的進貨兩個角色都看得到標記
      expect(await noPageOverflow(page)).toBe(true);
      expect(noConsole(errors), who).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('採購分析與廠商績效：有請款權限者多「已請款、已付款、驗入未請款」與「已付款金額」；沒有請款權限者整區不顯示；數字等於 API', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).slice(0, 7);
  const ana = (await api('perf_pay', `purchase-analysis?yearMonth=${month}&pageSize=100`)).data;
  expect(ana.can_view_payment).toBe(true);
  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US');
  {
    const { ctx, page, errors } = await pageForUser(browser, states.perf_pay, testInfo);
    try {
      await openGaCenter(page);
      await gaNavTo(page, '採購分析');
      await expect(vis(page, 'pa-pay-cards')).toBeVisible();
      await expect(vis(page, 'pa-claimed')).toContainText(fmt(ana.confirmed.claimed_amount));
      await expect(vis(page, 'pa-paid')).toContainText(fmt(ana.confirmed.paid_amount));
      await expect(vis(page, 'pa-unclaimed')).toContainText(fmt(ana.confirmed.unclaimed_received_amount));
      await expect(page.locator('[data-testid="pa-order-claimed"]:visible').first()).toBeVisible(); // 手機版表格改成卡片，沒有欄位標題，改看儲存格
      expect(await noPageOverflow(page)).toBe(true);
      await gaNavTo(page, '合作紀錄');
      const perf = (await api('perf_pay', 'vendor-stats')).data;
      await expect(vis(page, 'vs-paid-total')).toContainText(fmt(perf.summary.po_paid_total));
      await expect(page.locator('[data-testid="vs-paid"]:visible').first()).toBeVisible();
      expect(await noPageOverflow(page)).toBe(true);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
  {
    const { ctx, page, errors } = await pageForUser(browser, states.perf_nopay, testInfo);
    try {
      await openGaCenter(page);
      await gaNavTo(page, '採購分析');
      await expect(visibleHeading(page, '採購分析')).toBeVisible();
      await expect(vis(page, 'pa-confirmed-total')).toBeVisible();
      await expect(page.locator('[data-testid="pa-pay-cards"]:visible')).toHaveCount(0);
      await expect(page.locator('[data-testid="pa-order-claimed"]:visible')).toHaveCount(0);
      await gaNavTo(page, '合作紀錄');
      await expect(vis(page, 'vs-table')).toBeVisible();
      await expect(page.locator('[data-testid="vs-paid-total"]:visible')).toHaveCount(0);
      await expect(page.locator('[data-testid="vs-paid"]:visible')).toHaveCount(0);
      expect(await noPageOverflow(page)).toBe(true);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('首頁待請款、待付款與側欄徽章：數字等於資料庫與 API；點進去的列表筆數相同；沒有請款權限者沒有這兩項', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  // 讓「待付款」有數字：把請款單送出
  const sub = await apis.clerk.post(`${P}/payment-requests/${prA.id}/actions`, { data: { action: 'submit', expected_updated_at: prA.updated_at, idempotency_key: key() } });
  expect(sub.status(), await sub.text()).toBe(200);
  const b = (await api('clerk', 'home/badges')).data;
  const unclaimed = b.items.pay_unclaimed as number;
  const submitted = b.items.pay_submitted as number;
  expect(submitted).toBeGreaterThanOrEqual(1);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-count-pay_submitted"]:visible')).toHaveText(String(submitted));
    await expect(page.locator('[data-testid="home-item-pay_submitted"]:visible')).toContainText('待付款請款單');
    expect(unclaimed).toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-testid="home-count-pay_unclaimed"]:visible')).toHaveText(String(unclaimed));
    await expect.poll(() => sideBadge(page, '請款單'), { timeout: 20_000 }).toBe(String(submitted));
    // 側欄徽章：請款單＝待付款；採購單＝待我處理聯集（含待請款），點徽章打開的列表筆數與徽章一致
    const menu = (await api('clerk', 'home/badges')).data.menu;
    expect(await sideBadge(page, '採購單')).toBe(String(menu.purchase_orders));
    await shell(page).locator('aside').locator('[data-testid="ga-badge-purchase-orders-new"]').locator('visible=true').first().click();
    await expect(vis(page, 'attention-chip')).toBeVisible();
    await expect(vis(page, 'po-total')).toHaveText(`共 ${menu.purchase_orders} 張`);
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').locator('[data-testid="ga-badge-payment-requests-new"]').locator('visible=true').first().click();
    await expect(vis(page, 'pr-total')).toHaveText(`共 ${submitted} 張`);
    await expect(vis(page, 'pr-tab-pay')).toHaveAttribute('aria-selected', 'true');
    await openGaCenter(page);
    // 點待付款 → 請款單清單的待付款頁籤，筆數相同
    await page.locator('[data-testid="home-item-pay_submitted"]:visible button.todo-head').click();
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await expect(vis(page, 'pr-total')).toHaveText(`共 ${submitted} 張`);
    await expect(vis(page, 'pr-tab-pay')).toHaveAttribute('aria-selected', 'true');
    expect(await noPageOverflow(page)).toBe(true);
    // 回首頁點待請款 → 採購單清單的待請款篩選，筆數相同
    await openGaCenter(page);
    await page.locator('[data-testid="home-item-pay_unclaimed"]:visible button.todo-head').click();
    await expect(vis(page, 'pay-unclaimed-chip')).toBeVisible();
    await expect(vis(page, 'po-total')).toHaveText(`共 ${unclaimed} 張`);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 沒有請款權限者：沒有這兩項、側欄請款單入口也不存在
  const { ctx: c2, page: p2, errors: e2 } = await pageForUser(browser, states.purchaser, testInfo);
  try {
    await openGaCenter(p2);
    await expect(p2.locator('[data-testid="home-item-pay_unclaimed"]:visible')).toHaveCount(0);
    await expect(p2.locator('[data-testid="home-item-pay_submitted"]:visible')).toHaveCount(0);
    await openGaSide(p2);
    await expect(shell(p2).locator('aside').getByRole('button', { name: '請款單', exact: true })).toHaveCount(0);
    expect(noConsole(e2)).toEqual([]);
  } finally {
    await c2.close();
  }
  expect((await apis.purchaser.get(`${P}/payment-requests`)).status()).toBe(403);
});
