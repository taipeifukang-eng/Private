import { expect, test } from '@playwright/test';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 G06 冒煙層：設備清冊、新增設備、貼標待辦、貼標複核的導覽進入、標題、主要 API 200、無 pageerror、無水平溢出；
// 店長只有設備清冊與貼標待辦；沒有權限的帳號看不到入口。只讀測試：不建立任何資料。

test('總務：側欄「設備清冊」「新增設備」開新版頁籤，「貼標待辦」「貼標複核」在資產與庫存最後；各頁標題、無錯誤、無溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const apiCalls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/') && apiCalls.push(`${r.status()} ${new URL(r.url()).pathname}`));
    await gaNavTo(page, '設備清冊', '設備管理');
    await expect(visibleHeading(page, '設備清冊')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設備' }).locator('visible=true')).toBeVisible();
    await expect(page.getByRole('list', { name: '設備統計' }).locator('visible=true')).toBeVisible();
    await gaNavTo(page, '新增設備', '設備管理');
    await expect(visibleHeading(page, '新增設備')).toBeVisible();
    await gaNavTo(page, '貼標待辦');
    await expect(visibleHeading(page, '貼標待辦')).toBeVisible();
    await gaNavTo(page, '貼標複核');
    await expect(visibleHeading(page, '貼標複核')).toBeVisible();
    // 回應可能比標題晚到，用輪詢等它們（每個頁面的主要 API 都要是 200）
    const wanted = ['equipment', 'onboarding/tasks', 'onboarding/review'];
    for (const w of wanted) await expect.poll(() => apiCalls.includes(`200 /api/workspace/general-affairs/${w}`)).toBe(true);
    expect(apiCalls.filter((c) => !c.startsWith('200 '))).toEqual([]);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店長（名單身分）：側欄有設備清冊與貼標待辦，沒有新增設備與貼標複核；清冊沒有新增按鈕；手機是卡片清單', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'store_manager', testInfo);
  try {
    await openGaCenter(page);
    const labels = (await sideLabels(page)).map((t) => t.trim());
    expect(labels.some((t) => t.startsWith('貼標待辦'))).toBe(true);
    expect(labels.some((t) => t.startsWith('貼標複核'))).toBe(false);
    await gaNavTo(page, '設備清冊', '設備管理');
    await expect(visibleHeading(page, '設備清冊')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設備' }).locator('visible=true')).toHaveCount(0);
    await expect(page.getByText('店長身分只顯示自己門市設備的基本資料')).toBeVisible();
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.asset-table:visible')).toHaveCount(0);
      await expect(page.getByRole('list', { name: '設備清單' }).locator('visible=true')).toBeVisible();
    } else {
      await expect(page.locator('.asset-table:visible')).toHaveCount(1);
    }
    await gaNavTo(page, '貼標待辦');
    await expect(visibleHeading(page, '貼標待辦')).toBeVisible();
    await expect(page.getByRole('tab', { name: '待我處理' })).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('設備查看（只讀）：有設備清冊，沒有新增設備與貼標複核，清單沒有新增按鈕；沒有任何權限的帳號選單沒有設備項目', async ({ browser }, testInfo) => {
  const view = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await openGaCenter(view.page);
    const labels = (await sideLabels(view.page)).map((t) => t.trim());
    expect(labels.some((t) => t.startsWith('貼標複核'))).toBe(false);
    await gaNavTo(view.page, '設備清冊', '設備管理');
    await expect(visibleHeading(view.page, '設備清冊')).toBeVisible();
    await expect(view.page.getByRole('button', { name: '新增設備' }).locator('visible=true')).toHaveCount(0);
    expect(view.errors).toEqual([]);
  } finally {
    await view.ctx.close();
  }
  const denied = await pageFor(browser, 'denied', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await denied.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect([caps.gaEquipment, caps.gaEquipmentCreate, caps.gaOnboardingTasks, caps.gaOnboardingReview]).toEqual([false, false, false, false]);
    const r = await denied.page.evaluate(async () => (await fetch('/api/workspace/general-affairs/equipment')).status);
    expect(r).toBe(403);
  } finally {
    await denied.ctx.close();
  }
});
