import { expect, test } from '@playwright/test';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 Q28 冒煙層：轉移單頁（側欄入口、標題、主要 API 200、無 pageerror、390 寬無水平溢出）。
// 總務有「發起轉移單」；店長（兩店）沒有發起按鈕、側欄有轉移單；設備／設施查看者、無權限者沒有入口，直接打 API 時查看者可讀、無權限者 403。
// 只讀測試：不建立任何資料。

test('總務：側欄「轉移單」開新版頁籤；轉移單 API 200；有發起按鈕；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/transfers') && calls.push(String(r.status())));
    await gaNavTo(page, '轉移單');
    await expect(visibleHeading(page, '設備轉移單')).toBeVisible();
    await expect(page.getByRole('button', { name: '發起轉移單' }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('tab', { name: '進行中' }).locator('visible=true').first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('兩店店長都有轉移單入口與「待我處理」分頁、沒有發起按鈕；頁面無水平溢出', async ({ browser }, testInfo) => {
  for (const role of ['store_manager', 'ga_store_manager_b']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).toContain('轉移單');
      await gaNavTo(page, '轉移單');
      await expect(visibleHeading(page, '設備轉移單')).toBeVisible();
      await expect(page.getByRole('tab', { name: /待我處理/ }).locator('visible=true').first()).toBeVisible();
      await expect(page.getByRole('button', { name: '發起轉移單' })).toHaveCount(0);
      expect(await noPageOverflow(page), role).toBe(true);
      expect(errors, role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('設備查看者、無權限者沒有轉移單入口；查看者 API 可讀、無權限者 403', async ({ browser }, testInfo) => {
  const viewer = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await openGaCenter(viewer.page);
    expect(await sideLabels(viewer.page)).not.toContain('轉移單');
    const caps = await viewer.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaTransfers).toBe(false);
    expect(await viewer.page.evaluate(async () => (await fetch('/api/workspace/general-affairs/transfers')).status)).toBe(200);
  } finally {
    await viewer.ctx.close();
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps.gaTransfers).toBe(false);
    expect(await denied.page.evaluate(async () => (await fetch('/api/workspace/general-affairs/transfers')).status)).toBe(403);
  } finally {
    await denied.ctx.close();
  }
});
