import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';

// W11 / W12 冒煙層：登入後首頁（工作台入口）。
// 問候只有「歡迎回來，姓名」（C.5）；版面順序照舊版；API 200；沒有 pageerror、console 錯誤與水平溢出。

async function openHome(browser: any, role: string, testInfo: any) {
  const ctx = await loginAs(browser, role);
  const errors: string[] = [];
  const page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const home = page.waitForResponse((r) => r.url().includes('/api/workspace/home') && r.request().method() === 'GET');
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  const res = await home;
  expect(res.status()).toBe(200);
  return { ctx, page, errors };
}

test('管理員首頁：問候、卡片順序、快捷入口在提醒卡片下方；沒有依角色的一句話', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await openHome(browser, 'admin', testInfo);
  try {
    await expect(page.getByRole('heading', { name: '歡迎回來，測試系統管理員' })).toBeVisible();
    await expect(page.getByText(/您是系統管理員|您是專案經理|查看並執行指派給您的任務/)).toHaveCount(0);
    await expect(page.locator('[data-home-card="monthly-release"]')).toBeVisible();
    await expect(page.locator('[data-home-card="tasks"]')).toBeVisible();
    await expect(page.locator('[data-home-card="birthdays"]')).toBeVisible();
    const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    const quick = await y('[data-home="quick"]');
    expect(await y('[data-home-card="monthly-release"]')).toBeLessThan(await y('[data-home-card="bonus"]'));
    expect(await y('[data-home-card="tasks"]')).toBeLessThan(quick);
    expect(await y('[data-home-card="birthdays"]')).toBeLessThan(quick);
    await expect(page.locator('[data-home="quick"]').getByText('查詢巡店紀錄')).toBeVisible();
    await expect(page.getByText('新舊功能共用測試環境')).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店員首頁：只有版更、獎金、我的任務；沒有壽星、年費、執照與調店卡', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await openHome(browser, 'employee', testInfo);
  try {
    await expect(page.getByRole('heading', { name: /^歡迎回來，/ })).toBeVisible();
    await expect(page.locator('[data-home-card="tasks"]')).toBeVisible();
    await expect(page.locator('[data-home-card="birthdays"], [data-home-card="annual-fee"], [data-home-card="license"], [data-home-card="transfer-confirm"]')).toHaveCount(0);
    await expect(page.locator('[data-home-card="bonus"]')).toBeVisible();
    await expect(page.locator('[data-home="bonus-empty"]')).toHaveText('目前查無你的每月獎金資料');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有任何權限的帳號（denied）：首頁照常開啟，沒有獎金卡；API 200', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const api = await apiAs('denied');
  try {
    expect((await api.get('/api/workspace/home')).status()).toBe(200);
  } finally {
    await api.dispose();
  }
  const { ctx, page, errors } = await openHome(browser, 'denied', testInfo);
  try {
    await expect(page.getByRole('heading', { name: /^歡迎回來，/ })).toBeVisible();
    await expect(page.locator('[data-home-card="bonus"]')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
