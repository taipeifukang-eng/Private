import { expect, test } from '@playwright/test';
import { gaNavToIn, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 G10 冒煙層：設備與設施的 QR 標籤列印頁（側欄入口、標題、主要 API 200、無 pageerror、無水平溢出、測試環境浮水印說明）、
// 掃描頁深連結（找不到的 token 顯示友善說明）、店長與無權限者沒有標籤列印入口且 API 403。只讀測試：不建立任何資料。

test('總務：側欄「設備管理 › QR 標籤列印」「設施管理 › QR 標籤列印」開新版頁籤；標籤 API 200；顯示測試環境說明與網址網域；無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const apiCalls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/qr/') && apiCalls.push(`${r.status()} ${new URL(r.url()).search}`));
    await gaNavToIn(page, '設備管理', 'QR 標籤列印');
    await expect(visibleHeading(page, '設備 QR 標籤列印')).toBeVisible();
    await expect(page.getByTestId('label-watermark-note').locator('visible=true')).toContainText('測試環境');
    await expect(page.getByTestId('label-base').locator('visible=true')).toContainText('http://localhost:3002');
    await gaNavToIn(page, '設施管理', 'QR 標籤列印');
    await expect(visibleHeading(page, '設施 QR 標籤列印')).toBeVisible();
    await expect.poll(() => apiCalls.length).toBeGreaterThanOrEqual(2);
    expect(apiCalls.every((c) => c.startsWith('200 '))).toBe(true);
    expect(apiCalls.some((c) => c.includes('type=equipment'))).toBe(true);
    expect(apiCalls.some((c) => c.includes('type=facility'))).toBe(true);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('設備查看者只有設備標籤列印、設施查看者只有設施標籤列印；店長與無權限者沒有入口且 API 403', async ({ browser }, testInfo) => {
  const eq = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await openGaCenter(eq.page);
    await gaNavToIn(eq.page, '設備管理', 'QR 標籤列印');
    await expect(visibleHeading(eq.page, '設備 QR 標籤列印')).toBeVisible();
    const caps = await eq.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect([caps.gaEquipmentLabels, caps.gaFacilityLabels]).toEqual([true, false]);
    expect(await eq.page.evaluate(async () => (await fetch('/api/workspace/general-affairs/qr/labels?type=facility')).status)).toBe(403);
    expect(eq.errors.filter((e) => !/status of 403/.test(e))).toEqual([]); // 刻意打出的 403 會在主控台留一行
  } finally {
    await eq.ctx.close();
  }
  const fac = await pageFor(browser, 'ga_facility_view', testInfo);
  try {
    await openGaCenter(fac.page);
    await gaNavToIn(fac.page, '設施管理', 'QR 標籤列印');
    await expect(visibleHeading(fac.page, '設施 QR 標籤列印')).toBeVisible();
    expect(await fac.page.evaluate(async () => (await fetch('/api/workspace/general-affairs/qr/labels?type=equipment')).status)).toBe(403);
  } finally {
    await fac.ctx.close();
  }
  for (const role of ['store_manager', 'denied']) {
    const s = await pageFor(browser, role, testInfo);
    try {
      await s.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      const caps = await s.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
      expect([caps.gaEquipmentLabels, caps.gaFacilityLabels], role).toEqual([false, false]);
      for (const t of ['equipment', 'facility']) {
        expect(await s.page.evaluate(async (type) => (await fetch(`/api/workspace/general-affairs/qr/labels?type=${type}`)).status, t), `${role} ${t}`).toBe(403);
      }
      if (role === 'store_manager') {
        await openGaCenter(s.page);
        expect((await sideLabels(s.page)).map((t) => t.trim())).not.toContain('QR 標籤列印');
      }
    } finally {
      await s.ctx.close();
    }
  }
});

test('掃描頁深連結：登入者開啟找不到的 QR 顯示友善說明；格式錯誤顯示無法辨識；沒有水平溢出、沒有錯誤', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'store_manager', testInfo);
  try {
    await page.goto(`/workspace/index.html#/open/ga-asset-scan/${'f'.repeat(32)}`, { waitUntil: 'networkidle' });
    const fail = page.getByTestId('scan-failure').locator('visible=true');
    await expect(fail).toBeVisible();
    await expect(fail).toContainText('QR Code 無法辨識');
    await expect(fail).toContainText('找不到這個 QR Code');
    await expect(fail).toHaveAttribute('data-code', 'NOT_FOUND');
    expect(await noPageOverflow(page)).toBe(true);
    const bad = await ctx.newPage(); // 深連結只在頁面載入時讀取，另開一頁
    await bad.goto(`/workspace/index.html#/open/ga-asset-scan/short`, { waitUntil: 'networkidle' });
    await expect(bad.getByTestId('scan-failure').locator('visible=true')).toContainText('QR Code 格式錯誤');
    expect(errors.filter((e) => !/status of 40[04]/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
