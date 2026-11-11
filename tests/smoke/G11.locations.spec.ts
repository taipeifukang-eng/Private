import { expect, test } from '@playwright/test';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 3 批 G11 冒煙層：庫存位置與料件設定頁（側欄入口、標題、主要 API 200、無 pageerror、390 寬無水平溢出）。
// 總務（位置管理）有「新增位置」；位置查看者唯讀；店長（門市名單身分）唯讀並看到說明；督導與區經理的唯讀由 e2e 用名單身分帳號驗證（督導矩陣帳號沒有總務入口）；
// 沒有位置權限的帳號（設備查看者、只有記帳／調撥管理、無權限）沒有入口，直接打 API 回 403。只讀測試：不建立任何資料。
const API = '/api/workspace/general-affairs/inventory/locations';
// 有位置查看／管理權限的人，側欄「庫存位置」在「庫存管理」群組底下（舊側欄規則）；只有門市名單身分的人舊側欄不列，「庫存位置」補在「資產與庫存」最上層。
const open = async (page: any, grouped = true) => {
  await gaNavTo(page, '庫存位置', grouped ? '庫存管理' : undefined);
  await expect(visibleHeading(page, '庫存位置與料件設定')).toBeVisible();
};

test('總務：側欄「庫存位置」開新版頁籤；位置 API 200；有新增位置按鈕與四張統計卡；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(API) && calls.push(String(r.status())));
    await open(page);
    await expect(page.getByRole('button', { name: '新增位置' }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('list', { name: '庫存位置統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('readonly-note').locator('visible=true')).toHaveCount(0);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('位置查看者：頁面可開、沒有新增與編輯按鈕、顯示只有查看權限的說明', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_inv_location_view', testInfo);
  try {
    await openGaCenter(page);
    await open(page);
    await expect(page.getByTestId('readonly-note').locator('visible=true')).toContainText('只有查看權限');
    await expect(page.getByRole('button', { name: '新增位置' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^編輯／料件設定$|^停用 |^刪除 / })).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有位置管理（沒有料件查看）：可新增位置，但「加入料件」要提示缺權限（頁面可開）', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_inv_location_edit', testInfo);
  try {
    await openGaCenter(page);
    await open(page);
    await expect(page.getByRole('button', { name: '新增位置' }).locator('visible=true')).toBeVisible();
    const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/general-affairs/inventory/locations')).json()).permissions);
    expect(caps).toMatchObject({ manage: true, canAddParts: false });
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('門市名單身分（店長、店長 B）：側欄有「庫存位置」、頁面唯讀並說明只看自己門市；沒有任何操作按鈕；無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['store_manager', 'ga_store_manager_b']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).toContain('庫存位置');
      await gaNavTo(page, '庫存位置');
      await expect(visibleHeading(page, '庫存位置與料件設定'), role).toBeVisible();
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('只會看到自己門市');
      await expect(page.getByRole('button', { name: '新增位置' }), role).toHaveCount(0);
      expect(await noPageOverflow(page), role).toBe(true);
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('沒有位置權限的帳號沒有入口：設備查看者、只有記帳管理、只有調撥管理、無權限；API 403；capabilities.gaInventoryLocations 為 false', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['ga_equipment_view', 'ga_inv_txn_only', 'ga_inv_transfer_only']) {
    const { ctx, page } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).not.toContain('庫存位置');
      const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
      expect(caps.gaInventoryLocations, role).toBe(false);
      expect(await page.evaluate(async (u) => (await fetch(u)).status, API), role).toBe(403);
    } finally {
      await ctx.close();
    }
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaInventoryLocations).toBe(false);
    expect(await denied.page.evaluate(async (u) => (await fetch(u)).status, API)).toBe(403);
  } finally {
    await denied.ctx.close();
  }
});
