import { expect, test } from '@playwright/test';
import { noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';
import { invNavTo } from '../support/g12-ui';

// M7/M8 第 3 批 G13 冒煙層：庫存調撥單頁（側欄「調撥與收貨」、標題、八張統計卡、主要 API 200、無 pageerror、390 寬無水平溢出）、導覽四個庫存 href 對應、
// 總務有「建立調撥單」與「逾期天數設定」；只有查看權限／缺權限的人沒有建單按鈕並說明缺哪個權限；店長（門市名單身分）唯讀；沒有相關權限的帳號沒有入口、API 403。只讀測試：不建立任何資料。
const API = '/api/workspace/general-affairs/inventory/transfers';

test('總務：側欄「調撥與收貨」開調撥單頁；API 200；八張統計卡、建立調撥單與逾期天數設定按鈕；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(API) && calls.push(String(r.status())));
    await invNavTo(page, '調撥與收貨');
    await expect(visibleHeading(page, '庫存調撥單')).toBeVisible();
    await expect(page.getByTestId('open-create').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('open-setting').locator('visible=true')).toBeVisible();
    await expect(page.getByRole('list', { name: '調撥單統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(8);
    await expect(page.getByTestId('tr-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('導覽四個庫存 href：總覽、流水（?view=transactions 以完整 href 對應）、位置、調撥，對到正確頁面 kind 與 payload', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const nav = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).gaNavigation);
    const flat = (nav as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
    const by = (href: string) => flat.filter((i) => i.href === href);
    expect(by('/general-affairs/inventory')[0]).toMatchObject({ kind: 'ga-inventory', payload: { view: 'balances' } });
    expect(by('/general-affairs/inventory?view=transactions')[0]).toMatchObject({ kind: 'ga-inventory', payload: { view: 'transactions' } });
    expect(by('/general-affairs/inventory/locations')[0]).toMatchObject({ kind: 'ga-inventory-locations' });
    expect(by('/general-affairs/inventory/transfers').length).toBeGreaterThanOrEqual(1);
    for (const i of by('/general-affairs/inventory/transfers')) expect(i.kind).toBe('ga-inventory-transfers');
    const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaInventoryTransfers).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('只有查看權限（導覽帳號）：頁面可開、沒有建單按鈕、說明缺少的權限', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'navigation', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await expect(visibleHeading(page, '庫存調撥單')).toBeVisible();
    await expect(page.getByTestId('readonly-note').locator('visible=true')).toContainText('調撥管理');
    await expect(page.getByTestId('open-create')).toHaveCount(0);
    await expect(page.getByTestId('open-setting')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有交易管理、只有調撥管理：頁面可開但不能建單，說明缺哪個權限（三個權限缺一不可）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const [role, missing] of [['ga_inv_txn_only', '調撥管理'], ['ga_inv_transfer_only', '庫存交易管理']] as const) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      await invNavTo(page, '調撥與收貨');
      await expect(visibleHeading(page, '庫存調撥單'), role).toBeVisible();
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText(missing);
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('料件查看');
      await expect(page.getByTestId('open-create'), role).toHaveCount(0);
      const p = await page.evaluate(async (u) => (await (await fetch(u)).json()).permissions, API);
      expect(p, role).toMatchObject({ canOperate: false, canCreate: false });
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('門市名單身分（店長、店長 B）：側欄有「調撥與收貨」、頁面唯讀並說明只看跟自己門市有關的單；沒有建單與逾期天數設定；無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['store_manager', 'ga_store_manager_b']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).toContain('調撥與收貨');
      await invNavTo(page, '調撥與收貨');
      await expect(visibleHeading(page, '庫存調撥單'), role).toBeVisible();
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('唯讀檢視');
      await expect(page.getByTestId('open-create'), role).toHaveCount(0);
      await expect(page.getByTestId('open-setting'), role).toHaveCount(0);
      expect(await noPageOverflow(page), role).toBe(true);
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('沒有調撥相關權限的帳號沒有入口：只有位置查看、設備查看者、無權限；API 403；capabilities.gaInventoryTransfers 為 false', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const role of ['ga_inv_location_view', 'ga_equipment_view']) {
    const { ctx, page } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).not.toContain('調撥與收貨');
      const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
      expect(caps.gaInventoryTransfers, role).toBe(false);
      for (const p of ['', '/settings', '/options?type=locations']) expect(await page.evaluate(async (u) => (await fetch(u)).status, `${API}${p}`), `${role} ${p}`).toBe(403);
    } finally {
      await ctx.close();
    }
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaInventoryTransfers).toBe(false);
    expect(await denied.page.evaluate(async (u) => (await fetch(u)).status, API)).toBe(403);
  } finally {
    await denied.ctx.close();
  }
});
