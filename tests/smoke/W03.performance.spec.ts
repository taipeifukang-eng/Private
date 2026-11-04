import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { W03_YEAR } from '../support/w03-fixtures';
import { noPageOverflow, openNativePerformance, panel } from '../support/w03-ui';

// W03 冒煙層：業績管理頁。各角色登入後：能不能進入、子分頁依權限顯示（匯入每月獎金需 performance.bonus.view）、
// 主要 API 200、沒有 pageerror／console error、390 寬度無頁面層級水平溢出。只讀，不寫資料。

const ROLES: Record<string, { open: boolean; bonusTab?: boolean }> = {
  admin: { open: true, bonusTab: true },
  performance_edit: { open: true, bonusTab: true },
  performance_view: { open: true, bonusTab: true },
  ops_manager: { open: true, bonusTab: true },
  ops_assistant: { open: true, bonusTab: false }, // 有 performance.view，但只有 bonus.import，沒有 bonus.view
};

for (const [role, exp] of Object.entries(ROLES)) {
  test(`業績管理冒煙 ${role}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await apiAs(role);
    let access: any;
    try {
      const res = await api.get('/api/workspace/performance', { params: { year: String(W03_YEAR) } });
      expect(res.status()).toBe(200);
      access = await res.json();
    } finally {
      await api.dispose();
    }
    expect(Boolean(access.canViewBonus)).toBe(Boolean(exp.bonusTab));

    const ctx = await loginAs(browser, role);
    const errors: string[] = [];
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const failed: string[] = [];
      page.on('response', (r) => {
        if (/\/api\/workspace\/performance/.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      await openNativePerformance(page);
      const nav = page.getByRole('navigation', { name: '業績子功能' });
      await expect(nav.getByRole('button', { name: '團體獎金' })).toBeVisible();
      await expect(nav.getByRole('button', { name: '處方箋' })).toBeVisible();
      await expect(nav.getByRole('button', { name: '匯入每月獎金' })).toHaveCount(exp.bonusTab ? 1 : 0);

      // 三個子分頁都能載入（沒有被指派門市的帳號：團體獎金顯示「沒有可查看的門市」）
      const group = panel(page).getByRole('region', { name: '團體獎金' });
      if ((access.stores as unknown[]).length) {
        // 規格 D.4：門市預設為「請選擇門市」（空值），先提示選門市；選了第一間門市並查詢後才有明細。
        await expect(group.getByText('請選擇門市。')).toBeVisible({ timeout: 30_000 });
        await group.getByLabel('門市', { exact: true }).selectOption({ index: 1 });
        await group.getByRole('button', { name: '查詢業績' }).click();
        await expect(group.getByRole('heading', { name: '逐月業績明細' })).toBeVisible({ timeout: 30_000 });
        await expect(group.locator('.performance-detail-table tbody tr')).toHaveCount(12);
        await expect(group.getByRole('heading', { name: /獎金閾值設定/ })).toBeVisible();
      } else {
        await expect(group.getByText('沒有可查看的門市。')).toBeVisible({ timeout: 30_000 });
      }
      await nav.getByRole('button', { name: '處方箋' }).click();
      await expect(panel(page).getByRole('region', { name: '處方箋' }).getByRole('button', { name: '查詢處方箋' })).toBeVisible({ timeout: 30_000 });
      if (exp.bonusTab) {
        await nav.getByRole('button', { name: '匯入每月獎金' }).click();
        await expect(panel(page).getByRole('region', { name: '匯入每月獎金' })).toBeVisible({ timeout: 30_000 });
      }
      await page.waitForLoadState('networkidle');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(failed, failed.join('\n')).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('denied：選單沒有「業績管理」入口', async ({ browser }) => {
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="業績管理"]')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});
