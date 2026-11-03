import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { P01_MONTHS, PHARMACIST_TITLE, PURCHASE_TITLE, collectErrors, money, noPageOverflow, openNativePage, panel, purgeSeededRoster, seedPurchases, type SeededPurchases } from '../support/p01-fixtures';

// P01 冒煙層：藥師管理與員工購物管理能從選單開啟、載入資料、沒有 console 錯誤與頁面層級水平溢出（desktop-1440 與 mobile-390）。
// 員購桌機用保留月份 2099-09、手機用 2099-10（ZT01／ZT02，sweeper 清除）。藥師總覽只載入目前月份（與正常使用相同），不寫入 2099 月份。

let admin: APIRequestContext;
let seeded: SeededPurchases;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  admin = await apiAs('admin');
  const mobile = testInfo.project.name === 'mobile-390';
  // 桌機與手機各用一個保留月份，避免同一次 run 內員編重複。
  seeded = await seedPurchases(admin, mobile ? P01_MONTHS.smokeMobile : P01_MONTHS.smoke, mobile ? ['3', '4'] : ['Y', 'Z']);
});
test.afterAll(async () => {
  await purgeSeededRoster(admin, seeded);
  await admin?.dispose();
});

test('藥師管理（可編輯）：督導區總覽載入、兩個分頁、無錯誤', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'pharmacist_edit');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(page);
    await openNativePage(page, PHARMACIST_TITLE);
    const p = panel(page);
    await expect(p.getByRole('button', { name: '督導區總覽' })).toBeVisible();
    await expect(p.getByRole('button', { name: '藥師主檔' })).toBeVisible();
    await expect(p.locator('.metrics')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText('當月藥師總數')).toBeVisible();
    await expect(p.locator('[data-view-only]')).toHaveCount(0);
    await expect(p.getByRole('button', { name: /^(月份關帳|解除月份關帳)$/ })).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('藥師管理（僅檢視）：顯示檢視模式提示，沒有關帳與主檔分頁', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'pharmacist');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(page);
    await openNativePage(page, PHARMACIST_TITLE);
    const p = panel(page);
    await expect(p.locator('[data-view-only]')).toHaveText('目前為檢視模式（僅可查看，無法編輯）。', { timeout: 60_000 });
    await expect(p.getByRole('button', { name: '藥師主檔' })).toHaveCount(0);
    await expect(p.getByRole('button', { name: /月份關帳/ })).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('員工購物（可匯入）：查詢 2099 保留月份，統計卡與員工彙總與匯入結果一致', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'employee_purchase_edit');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(page);
    await openNativePage(page, PURCHASE_TITLE);
    const p = panel(page);
    await expect(p.getByRole('button', { name: '匯入 POS Excel' })).toBeVisible();
    await expect(p.locator('[data-page-intro]')).toContainText('匯入 POS 每月員工購物銷售資料');
    await p.getByLabel('月份').fill(seeded.month);
    await p.getByRole('button', { name: '查詢員購' }).click();
    const totals = p.locator('.totals');
    await expect(totals).toContainText(money(seeded.expected.total), { timeout: 30_000 });
    await expect(totals).toContainText(`${seeded.expected.matched} / ${seeded.expected.unmatched}`);
    await expect(p.getByRole('heading', { name: '職稱金額彙總' })).toBeVisible();
    await expect(p.locator('.position-grid')).toContainText('專員');
    await expect(p.locator('.module-table tbody tr').first()).toBeVisible();
    await expect(p.getByText(`符合 ${3} 位`)).toBeVisible(); // ZT員購甲、ZT員購乙、未比對甲
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('員工購物（僅檢視）：沒有匯入按鈕，仍可查詢', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'employee_purchase_view');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(page);
    await openNativePage(page, PURCHASE_TITLE);
    const p = panel(page);
    await expect(p.getByRole('button', { name: '查詢員購' })).toBeVisible();
    await expect(p.getByRole('button', { name: '匯入 POS Excel' })).toHaveCount(0);
    await p.getByLabel('月份').fill(seeded.month);
    await p.getByRole('button', { name: '查詢員購' }).click();
    await expect(p.locator('.totals')).toContainText(money(seeded.expected.total), { timeout: 30_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有權限的帳號：選單看不到藥師管理與員工購物管理', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize((testInfo.project.use as any).viewport);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    for (const title of [PHARMACIST_TITLE, PURCHASE_TITLE]) {
      await expect(page.locator(`.workspace-menu button.catalog-item[title="${title}"]`)).toHaveCount(0);
    }
  } finally {
    await ctx.close();
  }
});
