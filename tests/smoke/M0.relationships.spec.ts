import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs, TEST_ORIGIN } from '../support/auth';

// M0 樣本頁「關係會員」冒煙層：角色矩陣各角色的可見性與頁面載入、無 pageerror、390 寬度無水平溢出。
// 只讀取，不按任何儲存／送出。桌機（1440）與手機（390）兩個 project 各跑一次。

type Account = { key: string; kind: 'role' | 'module'; expected: { capabilities: Record<string, boolean> } };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
// 全部 role 類帳號 + 關係會員的 module 帳號；其他 module 帳號的 session 可見性已由 integration/role-matrix 涵蓋。
const subjects = accounts.filter((a) => a.kind === 'role' || a.key.startsWith('relationship_'));

for (const account of subjects) {
  const visible = account.expected.capabilities.relationships;
  test(`關係會員冒煙 ${account.key}（${visible ? '可見' : '不可見'}）`, async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await loginAs(browser, account.key);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      const apiStatuses: number[] = [];
      page.on('response', (r) => {
        if (r.url().includes('/api/workspace/relationships')) apiStatuses.push(r.status());
      });

      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('.menu-toggle');
      await page.click('.menu-toggle');
      await page.waitForSelector('.workspace-menu');
      const entry = page.locator('.workspace-menu button.catalog-item[title="關係會員"]');

      if (!visible) {
        await expect(entry).toHaveCount(0);
      } else {
        await entry.click();
        await expect(page.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
        await expect(page.locator('.relationship-page table').first()).toBeVisible();
        await expect(page.locator('.relationship-page .notice.error')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '重新整理' })).toBeEnabled();
        expect(apiStatuses.length).toBeGreaterThan(0);
        expect(apiStatuses.every((s) => s === 200), `API 狀態 ${apiStatuses.join(',')}`).toBe(true);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '水平溢出').toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('對應舊路由 /store/relationship-members：admin 為 200、未登入不會 5xx', async ({ browser, request }) => {
  const ctx = await loginAs(browser, 'admin');
  try {
    const res = await ctx.request.get(`${TEST_ORIGIN}/store/relationship-members`);
    expect(res.status()).toBe(200);
  } finally {
    await ctx.close();
  }
  const anon = await request.get(`${TEST_ORIGIN}/store/relationship-members`, { maxRedirects: 0 });
  expect(anon.status()).toBeLessThan(500);
});
