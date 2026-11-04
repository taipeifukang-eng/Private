import { expect, test } from '@playwright/test';
import { apiForUser, canEnterOracle, SCENARIOS, setupCv01, type CvFixtures } from '../support/cv01-fixtures';
import { getJson } from '../support/cv01-cases';

// CV01 冒煙層：session capabilities 與導覽的「活動檢視」入口、權限閘門（campaigns API 的 403）。
// 角色取舊版 matrix 的代表：單店店長、督導、盤點組（只有 view_own）、view_all、部門身分無 view_all、無權限。

const KEYS = ['A_single_mgr', 'C_supervisor', 'H_inventory_view_own', 'I_view_all', 'G_dept_mgr_view_own', 'F_dept_mgr_access_only', 'K_no_perm'];
let fx: CvFixtures;
test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(180_000);
  if (testInfo.project.name !== 'desktop-1440') return;
  fx = await setupCv01(KEYS);
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440' || !fx) return;
  expect(await fx.teardown(), '清除 fixture').toEqual([]);
});

for (const key of KEYS) {
  test(`活動檢視入口冒煙 ${key}`, async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', '資料層只跑桌機專案');
    const ctx = await apiForUser(fx.users[key]);
    try {
      const session = await getJson(ctx, '/api/workspace/session');
      expect(session.status).toBe(200);
      const want = canEnterOracle(SCENARIOS[key]);
      expect(session.json.capabilities.campaignView).toBe(want);
      const items = (session.json.navigation as { items: { href: string; label: string }[] }[]).flatMap((g) => g.items);
      expect(items.some((i) => i.href === '/activity-management' && i.label === '活動檢視')).toBe(want);
      // 只有 view_own／view_all 才能讀活動資料；management.access 或無權限 -> 403
      const list = await getJson(ctx, '/api/workspace/campaigns?q=CVP-');
      const hasRead = SCENARIOS[key].perms.some((p) => ['activity.campaign.view_own', 'activity.campaign.view_all', 'activity.campaign.view'].includes(p));
      expect(list.status).toBe(hasRead ? 200 : 403);
      // 管理頁入口（活動管理）不因 view_own 出現
      const manage = items.some((i) => i.href === '/admin/activity-management');
      expect(manage).toBe(SCENARIOS[key].perms.includes('activity.campaign.view_all'));
    } finally {
      await ctx.dispose();
    }
  });
}
