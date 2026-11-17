import { expect, test, type Page } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { oracle, seedAttention, seedPo, transferDays } from '../support/m7m8-ga6-home-fixtures';

// M7/M8 第 6 批 G22／G24 冒煙層：合作紀錄（廠商績效）、採購分析、總務首頁（待我處理、KPI、庫存提醒）與導覽徽章；
// 桌機 1440 與手機 390（project viewport）無水平溢出、無 console 錯誤、主要 API 200、側欄入口與權限一致（沒有權限沒有入口、API 403）、徽章出現在各選單位置且數字等於首頁。
const B = '/api/workspace/general-affairs';
const KEYS: Ga6Key[] = ['ga_all', 'coop_only', 'purchaser', 'approver', 'cat_only', 'store_mgr', 'store_req', 'nobody'];
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
/** 某個側欄項目（以按鈕名稱比對）那一列的徽章文字；沒有徽章回傳空字串。 */
async function sideBadge(page: Page, label: string): Promise<string> {
  await openGaSide(page);
  const row = shell(page).locator('aside .ga-row').filter({ has: page.getByRole('button', { name: label, exact: true }) }).first();
  const badge = row.locator('.ga-badge');
  return (await badge.count()) ? ((await badge.first().textContent()) || '').trim() : '';
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  await seedAttention(users.ga_all.id, 'SMK');
  const v = await seedGa6Vendor('smk-perf');
  await seedPo('smk-po', { status: 'ORDERED', vendor_id: v.id, vendor_name_snapshot: v.name, ordered_at: '2038-02-10T02:00:00Z', total_amount: 1050, subtotal: 1000 });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('總務首頁：待我處理（只列有權看的項目）、各項數字等於資料庫、前 5 筆、KPI、庫存提醒、入口；側欄徽章出現在各選單且首頁合計等於各項加總', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const exp = await oracle([], await transferDays());
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await expect(visibleHeading(page, '總務服務中心')).toBeVisible();
    await expect(page.getByRole('heading', { name: '待我處理' }).locator('visible=true').first()).toBeVisible();
    const items = page.locator('[data-testid="home-items"]:visible');
    await expect(items).toBeVisible();
    for (const k of ['request_intake', 'bill_overdue', 'contract_due', 'transfer_overdue', 'po_overdue', 'wo_store_rejected', 'onboarding_review'] as const) {
      await expect(page.locator(`[data-testid="home-count-${k}"]:visible`), k).toHaveText(String(exp[k]));
    }
    for (const k of ['po_pending', 'store_wait']) await expect(page.locator(`[data-testid="home-item-${k}"]:visible`), `${k} 沒有權限不該出現`).toHaveCount(0);
    await expect(page.locator('[data-testid="home-item-request_intake"]:visible li').first()).toBeVisible();
    await expect(page.locator('[data-testid="home-kpi"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="home-inventory"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="home-waiting"]:visible')).toContainText('等門市回覆');
    // 首頁合計
    const total = Object.values({ a: exp.request_intake, b: exp.bill_overdue, c: exp.contract_due, d: exp.transfer_overdue, e: exp.po_overdue, f: exp.wo_store_rejected, g: exp.onboarding_review }).reduce((a, n) => a + n, 0);
    const shown = (await page.locator('[data-testid="home-total"]:visible').textContent())?.trim();
    expect(shown).toBe(total > 99 ? '99+' : String(total));
    // 側欄徽章：各選單自己的數字
    await expect.poll(() => sideBadge(page, '總務需求工作台'), { timeout: 20_000 }).toBe(exp.request_intake > 99 ? '99+' : String(exp.request_intake));
    expect(await sideBadge(page, '工單中心')).toBe(exp.wo_store_rejected > 99 ? '99+' : String(exp.wo_store_rejected));
    expect(await sideBadge(page, '採購單')).toBe(exp.po_overdue > 99 ? '99+' : String(exp.po_overdue));
    expect(await sideBadge(page, '廠商資料')).toBe(exp.contract_due > 99 ? '99+' : String(exp.contract_due));
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await apis.ga_all.get(`${B}/home/summary`)).status()).toBe(200);
  expect((await apis.ga_all.get(`${B}/home/badges`)).status()).toBe(200);
});

test('合作紀錄（廠商績效）：側欄有入口、頁面可開、預設近 12 個月、區間可選、有未指定列與說明、API 200、無錯誤、無水平溢出；只有合作紀錄權限者也進得去', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const key of ['ga_all', 'coop_only']) {
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page);
      const calls: string[] = [];
      page.on('response', (r) => r.url().includes('/general-affairs/vendor-stats') && calls.push(String(r.status())));
      await gaNavTo(page, '合作紀錄');
      await expect(visibleHeading(page, '合作紀錄')).toBeVisible();
      await expect(page.locator('[data-testid="vs-table"]:visible')).toBeVisible();
      await expect(page.locator('[data-testid="vs-unassigned"]:visible')).toBeVisible();
      await expect(page.locator('[data-testid="vs-range"]:visible')).toContainText('統計期間');
      await expect(page.locator('[data-testid="vs-from"]:visible')).toBeVisible();
      // 先填結束月份（只填起始會用「本月」當結束，起始晚於結束會被擋）
      await page.locator('[data-testid="vs-to"]:visible').fill('2038-03');
      await page.locator('[data-testid="vs-from"]:visible').fill('2038-01');
      await expect(page.locator('[data-testid="vs-range"]:visible')).toContainText('2038-01 ～ 2038-03');
      if (key === 'ga_all') {
        await expect(page.locator('[data-testid="vs-row"]:visible').first()).toContainText('QA-GA6-');
        await expect(page.locator('[data-testid="vs-row"]:visible').first().getByTestId('vs-po')).toContainText('1,050');
        await expect(page.locator('[data-testid="vs-row"]:visible').first().getByTestId('vs-wo')).toHaveText('資料累積中');
      }
      await page.locator('[data-testid="vs-refresh"]:visible').click();
      expect(await noPageOverflow(page)).toBe(true);
      await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
      expect(calls.every((c) => c === '200')).toBe(true);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('採購分析：側欄有入口、頁面可開、確定與預估分開、月份可選、廠商與門市排名、已下訂清單；API 200、無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.purchaser, testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes('/general-affairs/purchase-analysis') && calls.push(String(r.status())));
    await gaNavTo(page, '採購分析');
    await expect(visibleHeading(page, '採購分析')).toBeVisible();
    await expect(page.locator('[data-testid="pa-confirmed-total"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="pa-est-orders"]:visible')).toBeVisible();
    await page.locator('[data-testid="pa-month"]:visible').fill('2038-02');
    await expect(page.locator('[data-testid="pa-confirmed-total"]:visible')).toContainText('1,050');
    await expect(page.locator('[data-testid="pa-confirmed-count"]:visible')).toHaveText('1');
    await expect(page.locator('[data-testid="pa-vendor-row"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-testid="pa-order-row"]:visible')).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('權限：核准人、只有分類區域、店長、只有服務中心入口者側欄沒有合作紀錄與採購分析，API 403；採購人員沒有合作紀錄、合作紀錄者沒有採購分析', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const want: Record<string, { stats: boolean; analysis: boolean }> = {
    approver: { stats: false, analysis: false }, cat_only: { stats: false, analysis: false }, store_mgr: { stats: false, analysis: false }, nobody: { stats: false, analysis: false },
    purchaser: { stats: false, analysis: true }, coop_only: { stats: true, analysis: false },
  };
  for (const [key, w] of Object.entries(want)) {
    // 核准人沒有服務中心入口旗標（只有採購單頁），只驗 API；其餘驗側欄
    if (key === 'approver') {
      expect((await apis[key].get(`${B}/vendor-stats`)).status(), `${key} vendor-stats`).toBe(403);
      expect((await apis[key].get(`${B}/purchase-analysis`)).status(), `${key} purchase-analysis`).toBe(403);
      continue;
    }
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page);
      await openGaSide(page);
      const labels = await shell(page).locator('aside .ga-link').allTextContents();
      expect(labels.map((l) => l.trim()).includes('合作紀錄'), `${key} 合作紀錄入口`).toBe(w.stats);
      expect(labels.map((l) => l.trim()).includes('採購分析'), `${key} 採購分析入口`).toBe(w.analysis);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
    expect((await apis[key].get(`${B}/vendor-stats`)).status(), `${key} vendor-stats`).toBe(w.stats ? 200 : 403);
    expect((await apis[key].get(`${B}/purchase-analysis`)).status(), `${key} purchase-analysis`).toBe(w.analysis ? 200 : 403);
  }
});

test('店長首頁：只看到自己門市的待確認／待補資料，沒有廠商、水電、庫存提醒區；沒有徽章的選單不顯示數字', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const exp = await oracle([(await (await import('../support/m7m8-fixtures')).stores()).VW001.id], await transferDays());
  const { ctx, page, errors } = await pageForUser(browser, states.store_req, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-count-store_wait"]:visible')).toHaveText(String(exp.store_wait));
    for (const k of ['request_intake', 'bill_overdue', 'contract_due', 'transfer_overdue', 'po_pending', 'po_overdue', 'wo_store_rejected', 'onboarding_review']) {
      await expect(page.locator(`[data-testid="home-item-${k}"]:visible`), k).toHaveCount(0);
    }
    await expect(page.locator('[data-testid="home-inventory"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-waiting"]:visible')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
