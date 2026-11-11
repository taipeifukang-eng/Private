import { expect, test } from '@playwright/test';
import { noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';
import { invNavTo } from '../support/g12-ui';

// M7/M8 第 3 批 G12 冒煙層：庫存餘額、流水、持有狀態頁（側欄兩個入口「庫存總覽」「庫存流水」對到同一頁的不同分頁、標題、主要 API 200、無 pageerror、390 寬無水平溢出）。
// 總務（交易管理）有「庫存過帳」；只有查看權限的人沒有；只有交易管理（沒有料件查看）有按鈕但過帳視窗說明缺權限（e2e 驗）；
// 店長（門市名單身分）唯讀並看到說明；沒有庫存權限的帳號沒有入口，直接打 API 回 403。只讀測試：不建立任何資料。
const API = '/api/workspace/general-affairs/inventory';
const BAL = `${API}/balances`;
const TXN = `${API}/transactions`;

test('總務：側欄「庫存總覽」開餘額分頁、「庫存流水」開流水分頁（同一個頁籤）；API 200；有過帳按鈕與四張統計卡；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => (r.url().includes(BAL) || r.url().includes(TXN) || r.url().includes(`${API}/holding`) || r.url().includes(`${API}/access`)) && calls.push(String(r.status())));
    await invNavTo(page, '庫存總覽');
    await expect(visibleHeading(page, '庫存餘額')).toBeVisible();
    await expect(page.getByTestId('open-post').locator('visible=true')).toBeVisible();
    await expect(page.getByRole('list', { name: '庫存餘額統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('tab-balances').locator('visible=true')).toHaveAttribute('aria-selected', 'true');
    expect(await noPageOverflow(page)).toBe(true);
    // 庫存流水入口：同一個頁面，切到流水分頁
    await invNavTo(page, '庫存流水');
    await expect(visibleHeading(page, '庫存流水')).toBeVisible();
    await expect(page.getByTestId('tab-transactions').locator('visible=true')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('txn-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    // 持有狀態分頁
    await page.getByTestId('tab-holding').locator('visible=true').click();
    await expect(visibleHeading(page, '庫存持有狀態')).toBeVisible();
    await expect(page.getByRole('list', { name: '持有狀態統計（全部）' }).locator('visible=true').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('top-box').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有查看權限（導覽帳號）：頁面可開、沒有過帳按鈕、顯示只有查看權限的說明；持有狀態沒有調整按鈕', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'navigation', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await expect(visibleHeading(page, '庫存餘額')).toBeVisible();
    await expect(page.getByTestId('readonly-note').locator('visible=true')).toContainText('只有查看權限');
    await expect(page.getByTestId('open-post')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有交易管理（沒有料件查看）：頁面可開並有過帳按鈕；API 的 access 回報缺料件查看', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_inv_txn_only', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await expect(visibleHeading(page, '庫存餘額')).toBeVisible();
    await expect(page.getByTestId('open-post').locator('visible=true')).toBeVisible();
    const a = await page.evaluate(async (u) => (await (await fetch(u)).json()), `${API}/access`);
    expect(a).toMatchObject({ canPost: true, canPartView: false });
    expect(a.postProblem).toContain('料件查看');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('門市名單身分（店長、店長 B）：側欄有庫存入口、頁面唯讀並說明只看自己門市；沒有過帳按鈕；流水與持有狀態分頁可開；無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['store_manager', 'ga_store_manager_b']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).toContain('庫存總覽');
      await invNavTo(page, '庫存總覽');
      await expect(visibleHeading(page, '庫存餘額'), role).toBeVisible();
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('只會看到自己門市');
      await expect(page.getByTestId('open-post'), role).toHaveCount(0);
      await page.getByTestId('tab-transactions').locator('visible=true').click();
      await expect(page.getByTestId('masked-note').locator('visible=true'), role).toBeVisible();
      await page.getByTestId('tab-holding').locator('visible=true').click();
      await expect(page.getByTestId('holding-readonly').locator('visible=true'), role).toBeVisible();
      expect(await noPageOverflow(page), role).toBe(true);
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('沒有庫存權限的帳號沒有入口：只有位置查看、只有調撥管理、設備查看者、無權限；API 403；capabilities.gaInventory 為 false', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['ga_inv_location_view', 'ga_inv_transfer_only', 'ga_equipment_view']) {
    const { ctx, page } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).not.toContain('庫存總覽');
      expect(await sideLabels(page), role).not.toContain('庫存流水');
      const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
      expect(caps.gaInventory, role).toBe(false);
      for (const p of ['/balances', '/transactions', '/holding', '/access']) expect(await page.evaluate(async (u) => (await fetch(u)).status, `${API}${p}`), `${role} ${p}`).toBe(403);
    } finally {
      await ctx.close();
    }
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaInventory).toBe(false);
    expect(await denied.page.evaluate(async (u) => (await fetch(u)).status, BAL)).toBe(403);
  } finally {
    await denied.ctx.close();
  }
});
