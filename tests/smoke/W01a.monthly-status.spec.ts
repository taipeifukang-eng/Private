import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from '../support/auth';

// W01a 冒煙層：每月人員狀態總覽。角色矩陣各角色的可見性、統計卡片與門市頁籤的角色差異、390 寬度無頁面層級水平溢出、無 pageerror。
// 只讀取，不按任何儲存／送出。桌機（1440）與手機（390）兩個 project 各跑一次。

type Account = { key: string; kind: 'role' | 'module'; permissions: string[] | 'ALL'; expected: { capabilities: Record<string, boolean> } };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
const has = (a: Account, code: string) => a.permissions === 'ALL' || a.permissions.includes(code);
// 全部 role 類帳號 + 月結 module 帳號
const subjects = accounts.filter((a) => a.kind === 'role' || a.key.startsWith('monthly_'));

async function openMonthly(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.waitForSelector('.workspace-menu');
}

for (const account of subjects) {
  const visible = account.expected.capabilities.monthly;
  test(`每月人員狀態冒煙 ${account.key}（${visible ? '可見' : '不可見'}）`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await loginAs(browser, account.key);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      const statuses: number[] = [];
      page.on('response', (r) => {
        if (/\/api\/workspace\/monthly(\?|$)/.test(r.url())) statuses.push(r.status());
      });
      await openMonthly(page);
      const entry = page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]');
      if (!visible) {
        await expect(entry).toHaveCount(0);
      } else {
        await entry.click();
        await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
        await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
        await expect(page.locator('.notice.error')).toHaveCount(0);
        expect(statuses.length).toBeGreaterThan(0);
        expect(statuses.every((s) => s === 200), `API 狀態 ${statuses.join(',')}`).toBe(true);

        // 統計卡片只給 view_stats 的角色（舊版 canViewStats）
        const cards = page.locator('.monthly-stats .stat-card');
        if (has(account, 'monthly.status.view_stats')) {
          await expect(cards).toHaveCount(4);
          await expect(page.locator('[data-stat="total"]')).toHaveText(/^\d+$/);
        } else {
          await expect(cards).toHaveCount(0);
        }
        // 業績欄位只給 view_performance 的角色
        const perfHeader = page.locator('th', { hasText: '計算區塊' });
        if (await page.locator('.monthly-table table').count()) await expect(perfHeader).toHaveCount(has(account, 'monthly.status.view_performance') ? 1 : 0);
        // 多門市時出現門市頁籤，且頁籤不會撐出頁面寬度
        const tabs = page.locator('.store-tabs [role=tab]');
        if (await tabs.count()) {
          const box = await page.locator('.store-tabs').boundingBox();
          const viewport = page.viewportSize()!;
          expect(box!.width).toBeLessThanOrEqual(viewport.width);
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '頁面層級水平溢出').toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('手機 390：統計卡片兩欄、名冊表格在容器內左右捲動並凍結姓名欄', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', '只在手機 project 驗證');
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await openMonthly(page);
    await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
    await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    const cols = await page.evaluate(() => {
      const el = document.querySelector('.monthly-stats');
      return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : 0;
    });
    expect(cols).toBe(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const sticky = await page.evaluate(() => {
      const th = document.querySelector('.monthly-table th.sticky-name');
      return th ? getComputedStyle(th).position : 'none';
    });
    if (await page.locator('.monthly-table table').count()) expect(sticky).toBe('sticky');
  } finally {
    await ctx.close();
  }
});
