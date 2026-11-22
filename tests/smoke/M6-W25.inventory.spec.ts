import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from '../support/auth';

/**
 * M6 第一批 W25 盤點冒煙：角色劇本（盤點組、店長、督導、無權限）下的入口與頁面載入，桌機 1440 與手機 390。
 * 只讀取，不按任何匯入或刪除。
 */
type Account = { key: string; expected: { capabilities: Record<string, boolean> } };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
// [帳號, 有導覽入口, 有離線工具分頁, 看得到匯入按鈕]
const ROLES: [string, boolean, boolean, boolean][] = [
  ['admin', true, true, true],
  ['inventory_team', true, true, true],
  // 2026-11-22 盤點權限問卷：只有檢視權限（含店長）看不到匯入按鈕（隱藏）
  ['inventory_view', true, true, false],
  ['store_manager', true, true, false],
  ['supervisor', false, false, false],
  ['denied', false, false, false],
  ['employee', false, false, false],
];

for (const [key, entry, offline, importer] of ROLES) {
  test(`盤點冒煙 ${key}（${entry ? '有入口' : '無入口'}）`, async ({ browser }) => {
    test.setTimeout(120_000);
    expect(accounts.find((a) => a.key === key)!.expected.capabilities.inventory, '與角色矩陣一致').toBe(entry);
    const ctx = await loginAs(browser, key);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('.menu-toggle');
      await page.click('.menu-toggle');
      await page.waitForSelector('.workspace-menu');
      const item = page.locator('.workspace-menu button.catalog-item[title="盤點管理"]');
      if (!entry) {
        await expect(item).toHaveCount(0);
        // 直接打 API 被擋
        expect((await ctx.request.get('/api/workspace/inventory')).status()).toBe(403);
        return;
      }
      await item.click();
      await expect(page.getByRole('heading', { name: '盤點結果分析報表' })).toBeVisible();
      await expect(page.getByRole('button', { name: '離線盤點匯入匯出工具' })).toHaveCount(offline ? 1 : 0);
      await expect(page.getByRole('button', { name: '匯入盤點 Excel' })).toHaveCount(importer ? 1 : 0);
      if (offline) {
        await page.getByRole('button', { name: '離線盤點匯入匯出工具' }).click();
        await expect(page.getByRole('heading', { name: '離線盤點匯入匯出工具' })).toBeVisible();
        for (const label of ['1. 產出外盤複盤清單', '2. 產出內部+外盤公司資料整合之複盤表與未盤表', '3. 產出DPOS匯入檔案']) await expect(page.getByRole('button', { name: label })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '無水平溢出').toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
