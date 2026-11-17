import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { seedAttention, seedPo } from '../support/m7m8-ga6-home-fixtures';

// M7/M8 第 6 批 G22／G24 版面檢查（桌機 1440 與手機 390 各跑一次，比照 G23.layout）：
//  - 總務首頁：待辦卡片、KPI、庫存提醒、入口卡片都不超出視窗；各卡片的數字與標題不被切掉；手機「總務選單」按鈕帶合計徽章仍可點。
//  - 合作紀錄：桌機是表格、手機轉成卡片（每格帶標籤）；摘要卡與長條不超出；沒有資料時顯示「資料累積中」。
//  - 採購分析：摘要卡、廠商與門市排名（前 5 名、可展開全部）、已下訂清單（桌機表格、手機卡片）與分頁不超出視窗。
//  - 側欄徽章：數字在 99 以內原樣、超過 99 顯示 99+，且不把選單文字擠到換行破版（高度不超過兩行）。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
let apiGa: any;
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, label)).toBeVisible();
}
/** 目前可見的區塊裡，所有元素的右緣都在視窗內（沒有被切到或撐出水平捲動）。 */
async function noOverflowIn(page: Page, selector: string) {
  const vp = page.viewportSize()!;
  const bad = await page.locator(selector).locator('visible=true').evaluateAll((els, width) => els.map((e) => ({ right: Math.round(e.getBoundingClientRect().right), w: Math.round(e.getBoundingClientRect().width), tag: e.tagName })).filter((r) => r.right > (width as number) + 1), vp.width);
  expect(bad, `${selector} 超出視窗（視窗寬 ${vp.width}）`).toEqual([]);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(['ga_all']);
  users = made.users;
  teardown = made.teardown;
  apiGa = await apiForUser(users.ga_all as any);
  state = await apiGa.storageState();
  await seedAttention(users.ga_all.id, 'LY');
  // 採購分析：2038-11 有 7 家廠商各一張已下訂的單（排名超過 5 名、清單要分頁需要超過 20 張：再補一家 25 張）
  for (let i = 0; i < 7; i += 1) {
    const v = await seedGa6Vendor(`LY-V${i}`);
    await seedPo(`LY-po-${i}`, { status: 'ORDERED', vendor_id: v.id, vendor_name_snapshot: v.name, ordered_at: `2038-11-0${i + 1}T02:00:00Z`, total_amount: 1000 * (i + 1), subtotal: 1000 * (i + 1) });
  }
  const big = await seedGa6Vendor('LY-BIG');
  const rows = Array.from({ length: 22 }, (_, i) => ({ po_no: `PO-M7M8-LY-${Date.now().toString(36)}-${i}`.toUpperCase(), status: 'ORDERED', vendor_id: big.id, vendor_name_snapshot: big.name, ordered_at: `2038-11-${String((i % 27) + 1).padStart(2, '0')}T03:00:00Z`, total_amount: 50, subtotal: 50, notes: m7Name('LY-bulk') }));
  const r = await db().from('ga_purchase_orders').insert(rows);
  expect(r.error, r.error?.message).toBeNull();
});
test.afterAll(async () => {
  await apiGa?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('總務首頁：待辦卡片、KPI、庫存提醒、入口都不超出視窗；手機總務選單按鈕帶合計徽章仍可開', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-items"]:visible')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await noOverflowIn(page, '[data-testid="home-items"] > li');
    await noOverflowIn(page, '[data-testid="home-kpi"] li');
    await noOverflowIn(page, '[data-testid="home-inventory"] li');
    // 每張待辦卡片的標題與數字都在卡片內（沒有被切掉）
    const clipped = await page.locator('[data-testid="home-items"] > li').locator('visible=true').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(clipped).toBe(0);
    if (isPhone(page)) {
      const bar = shell(page).getByRole('button', { name: '總務選單', exact: true });
      await expect(bar).toBeVisible();
      await expect(page.getByTestId('ga-badge-mobile').locator('visible=true')).toBeVisible();
      const box = await bar.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(30);
      await bar.click();
      await expect(shell(page).locator('aside').first()).toBeVisible();
    }
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('側欄徽章：選單文字不被擠壞（高度不超過兩行）、徽章不超出側欄；有子項的選單顯示子項合計', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await expect.poll(async () => shell(page).locator('aside .ga-badge').count(), { timeout: 20_000 }).toBeGreaterThan(2);
    const rows = await shell(page).locator('aside .ga-row').evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, text: (e as HTMLElement).innerText })));
    for (const r of rows) expect(r.h, `側欄列 ${r.text}`).toBeLessThanOrEqual(72);
    const aside = await shell(page).locator('aside').first().boundingBox();
    const badges = await shell(page).locator('aside .ga-badge').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    for (const right of badges) expect(right).toBeLessThanOrEqual(aside!.x + aside!.width + 1);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('合作紀錄：桌機是表格、手機轉成卡片（每格帶標籤）；摘要卡不超出；資料累積中的廠商列', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '合作紀錄');
    await page.locator('[data-testid="vs-to"]:visible').fill('2038-12');
    await page.locator('[data-testid="vs-from"]:visible').fill('2038-11');
    await expect(page.locator('[data-testid="vs-range"]:visible')).toContainText('2038-11 ～ 2038-12');
    await expect(page.locator('[data-testid="vs-row"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="vs-accumulating"]:visible')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await noOverflowIn(page, '.stat-cards li');
    const head = await page.locator('[data-testid="vs-table"] thead').locator('visible=true').count();
    if (isPhone(page)) {
      expect(head).toBe(0);
      const label = await page.locator('[data-testid="vs-row"]:visible').first().locator('td').nth(2).getAttribute('data-label');
      expect(label).toBeTruthy();
      await noOverflowIn(page, '[data-testid="vs-row"]');
    } else {
      expect(head).toBe(1);
    }
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('採購分析：摘要卡、排名（前 5 名與展開全部）、已下訂清單（桌機表格、手機卡片）與分頁不超出視窗', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '採購分析');
    await page.locator('[data-testid="pa-month"]:visible').fill('2038-11');
    await expect(page.locator('[data-testid="pa-confirmed-count"]:visible')).toHaveText('29');
    await expect(page.locator('[data-testid="pa-vendor-row"]:visible')).toHaveCount(5);
    await page.locator('[data-testid="pa-vendors-toggle"]:visible').click();
    await expect(page.locator('[data-testid="pa-vendor-row"]:visible')).toHaveCount(8);
    await page.locator('[data-testid="pa-vendors-toggle"]:visible').click();
    await expect(page.locator('[data-testid="pa-vendor-row"]:visible')).toHaveCount(5);
    await expect(page.locator('[data-testid="pa-order-row"]:visible')).toHaveCount(20);
    await page.locator('[data-testid="pa-next"]:visible').click();
    await expect(page.locator('[data-testid="pa-order-row"]:visible')).toHaveCount(9);
    expect(await noPageOverflow(page)).toBe(true);
    await noOverflowIn(page, '.stat-cards li');
    await noOverflowIn(page, '[data-testid="pa-vendor-row"]');
    if (isPhone(page)) expect(await page.locator('[data-testid="pa-orders"] thead').locator('visible=true').count()).toBe(0);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
