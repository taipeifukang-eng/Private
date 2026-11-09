import { expect, test } from '@playwright/test';
import { gaNavTo, gaNavToIn, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 G08 冒煙層：設施清冊、新增設施、設施保固管理、設施維修紀錄的導覽進入、標題、主要 API 200、無 pageerror、無水平溢出；
// 店長只有設施清冊與維修紀錄；設施查看沒有新增；沒有權限的帳號看不到入口且 API 403。只讀測試：不建立任何資料。

test('總務：側欄「設施清冊」「新增設施」「保固管理」「維修紀錄」開新版頁籤；各頁標題、主要 API 200、無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const apiCalls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/') && apiCalls.push(`${r.status()} ${new URL(r.url()).pathname}`));
    await gaNavToIn(page, '設施管理', '設施清冊');
    await expect(visibleHeading(page, '設施清冊')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設施' }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('list', { name: '設施統計' }).locator('visible=true')).toBeVisible();
    await gaNavToIn(page, '設施管理', '新增設施');
    await expect(visibleHeading(page, '新增設施')).toBeVisible();
    await gaNavToIn(page, '設施管理', '保固管理');
    await expect(visibleHeading(page, '設施保固管理')).toBeVisible();
    await gaNavToIn(page, '設施管理', '維修紀錄');
    await expect(visibleHeading(page, '設施維修紀錄')).toBeVisible();
    await gaNavToIn(page, '設備管理', '保固管理');
    await expect(visibleHeading(page, '設備保固管理')).toBeVisible();
    await gaNavToIn(page, '設備管理', '維修紀錄');
    await expect(visibleHeading(page, '設備維修紀錄')).toBeVisible();
    for (const w of ['facilities', 'asset-maintenance/history']) await expect.poll(() => apiCalls.some((c) => c.startsWith('200 ') && c.includes(`/general-affairs/${w}`))).toBe(true);
    expect(apiCalls.filter((c) => !c.startsWith('200 '))).toEqual([]);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店長（名單身分）：有設施清冊與維修紀錄，沒有新增設施與保固管理；清冊沒有新增按鈕；手機是卡片清單', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'store_manager', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設施清冊'); // 店長沒有舊版的「設施管理」群組，新版直接列在側欄
    await expect(visibleHeading(page, '設施清冊')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設施' }).locator('visible=true')).toHaveCount(0);
    await expect(page.getByText('店長身分只顯示自己門市設施的基本資料')).toBeVisible();
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.asset-table:visible')).toHaveCount(0);
      await expect(page.getByRole('list', { name: '設施清單' }).locator('visible=true')).toBeVisible();
    } else {
      await expect(page.locator('.asset-table:visible')).toHaveCount(1);
    }
    const labels = (await sideLabels(page)).map((t) => t.trim());
    expect(labels).not.toContain('新增設施');
    expect(labels.some((t) => t.startsWith('保固管理'))).toBe(false);
    await gaNavTo(page, '設施維修紀錄');
    await expect(visibleHeading(page, '設施維修紀錄')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('設施查看（只讀）：有設施清冊、保固管理，沒有新增設施；沒有任何權限的帳號沒有入口且 API 403', async ({ browser }, testInfo) => {
  const view = await pageFor(browser, 'ga_facility_view', testInfo);
  try {
    await openGaCenter(view.page);
    const labels = (await sideLabels(view.page)).map((t) => t.trim());
    expect(labels).not.toContain('新增設施');
    await gaNavToIn(view.page, '設施管理', '設施清冊');
    await expect(visibleHeading(view.page, '設施清冊')).toBeVisible();
    await expect(view.page.getByRole('button', { name: '新增設施' }).locator('visible=true')).toHaveCount(0);
    await gaNavToIn(view.page, '設施管理', '保固管理');
    await expect(visibleHeading(view.page, '設施保固管理')).toBeVisible();
    expect(view.errors).toEqual([]);
  } finally {
    await view.ctx.close();
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect([caps.gaFacilities, caps.gaFacilityCreate, caps.gaEquipmentWarranties, caps.gaFacilityWarranties, caps.gaEquipmentHistory, caps.gaFacilityHistory]).toEqual([false, false, false, false, false, false]);
    for (const p of ['facilities', 'asset-maintenance/history?type=facility', 'asset-maintenance/summary?type=equipment']) {
      expect(await denied.page.evaluate(async (path) => (await fetch(`/api/workspace/general-affairs/${path}`)).status, p), p).toBe(403);
    }
  } finally {
    await denied.ctx.close();
  }
});
