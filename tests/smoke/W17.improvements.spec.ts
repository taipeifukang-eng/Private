import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { M4B_MONTH, deleteRunMasters, seedFollowupInspection } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { improvementRows, openImprovements, work } from '../support/m4b-ui';

// W17 冒煙層：待改善追蹤列表與改善回報頁可開啟（管理員、店長）；沒有 pageerror、console 錯誤與水平溢出（桌機 1440、手機 390）。
const DATE = `${M4B_MONTH.followup}-12`;

test.beforeAll(async () => {
  runIdOrThrow();
  await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: DATE, tag: 'w17-smoke', count: 2 });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

for (const role of ['admin', 'store_manager'] as const) {
  test(`待改善追蹤（${role}）：列表與回報頁可開啟，有權限者可連到完整巡店記錄`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const api = page.waitForResponse((r) => r.url().includes('/api/workspace/improvements') && r.request().method() === 'GET');
      await openImprovements(page);
      expect((await api).status()).toBe(200);
      await expect(work(page).locator('.notice.error')).toHaveCount(0);
      const rows = improvementRows(page, { date: DATE, store: 'ZT01' });
      await expect(rows.first()).toBeVisible();
      expect(await noPageOverflow(page), '列表水平溢出').toBe(true);
      await rows.first().getByRole('button', { name: '查看與回報' }).click();
      await expect(work(page).getByRole('heading', { name: '改善項目與回報' })).toBeVisible();
      // 完整巡店記錄連結只給有巡店查看權限者（店長沒有巡店模組權限，不顯示）
      await expect(work(page).getByTestId('open-inspection')).toHaveCount(role === 'admin' ? 1 : 0);
      await expect(work(page).getByLabel('改善說明')).toBeVisible();
      expect(await noPageOverflow(page), '回報頁水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
