import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { openFromMenu } from '../support/m3-fixtures';

// W20 冒煙層：活動檢視（獨立入口）可從選單開啟；舊網址自動轉到新版；無權限帳號選單沒有入口、直接輸入網址顯示無權限。
// 沒有 pageerror、console 錯誤與水平溢出。

test('活動檢視（管理員）：選單開啟列表，年度按鈕與狀態可用', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '活動檢視');
    await expect(page.getByRole('heading', { name: '活動檢視', exact: true })).toBeVisible();
    await expect(page.getByTestId('year-all')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新整理' })).toBeVisible();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    // 預設年度是今年：被按下的年度按鈕只有一顆，且是今年或「全部」不會被按下
    await expect(page.locator('.years [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByTestId('year-all')).toHaveAttribute('aria-pressed', 'false');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('舊網址 /activity-management 自動轉到新版活動檢視（已登入）', async ({ browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/activity-management', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/workspace\/(index\.html)?#\/(open\/activity-view|work\/)/);
    await expect(page.getByRole('heading', { name: '活動檢視', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /活動檢視/ })).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('未登入開舊網址：轉到新版後先登入（不會看到活動資料）', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3002' });
  try {
    const page = await ctx.newPage();
    await page.goto('/activity-management', { waitUntil: 'networkidle' });
    await expect(page.locator('.login-layout')).toBeVisible();
    await expect(page.getByTestId('activity-view-list')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('活動檢視（denied 無權限帳號）：選單沒有入口，舊網址進來顯示無權限', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu .catalog-item[title="活動檢視"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/activity-management', { waitUntil: 'networkidle' });
    await expect(page.getByRole('alert').filter({ hasText: '沒有權限查看活動檢視' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('activity-view-list')).not.toBeVisible();
  } finally {
    await ctx.close();
  }
});
