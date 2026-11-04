import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { seedExportMonth, W02_MONTHS } from '../support/w02-fixtures';
import { noPageOverflow, openNativeExport, pickMonth, readStats, readStoreRows, visibleExportButtons } from '../support/w02-ui';

// W02 冒煙層：資料匯出頁。各角色看到的按鈕必須與 /monthly-export/access 一致（規格 A.1：全部只看 monthly.export.download），
// 只有單品獎金／支援時數權限者看不到其他按鈕；有權限者統計資訊與門市徽章正確；390 寬度無頁面層級水平溢出、無 pageerror。
// 資料：ZT03（草稿）、ZT04（已送審）、ZT05（已確認），保留月份 2099-01，sweeper 清除。

const MONTH = W02_MONTHS.smoke;
const ROLES = ['admin', 'ops_manager', 'ops_assistant', 'supervisor', 'store_manager'];

test.beforeAll(async () => {
  const admin = await apiAs('admin');
  try {
    await seedExportMonth(admin, MONTH);
  } finally {
    await admin.dispose();
  }
});

function expectedButtons(access: { general: boolean }) {
  const out: string[] = [];
  if (access.general) out.push('download', 'actual-staff-points', 'roster-preview', 'roster', 'transport', 'single-item-bonus', 'talent-cultivation-bonus', 'meal-allowance', 'spring-festival-bonus', 'support-hours');
  return out;
}

for (const role of ROLES) {
  test(`資料匯出冒煙 ${role}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await apiAs(role);
    let access: any;
    let apiStores: any[] = [];
    try {
      access = await (await api.get('/api/workspace/monthly-export/access')).json();
      const res = await api.get('/api/workspace/monthly-export/stores', { params: { year_month: MONTH } });
      if (res.status() === 200) apiStores = (await res.json()).stores;
    } finally {
      await api.dispose();
    }
    const ctx = await loginAs(browser, role);
    const errors: string[] = [];
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      if (!access.general) {
        // 規格 A.1：沒有 monthly.export.download 的帳號，選單看不到入口。
        await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
        await page.waitForSelector('.menu-toggle');
        await page.click('.menu-toggle');
        await expect(page.locator('.workspace-menu button.catalog-item[title="資料匯出"]')).toHaveCount(0);
        expect(await noPageOverflow(page)).toBe(true);
        return;
      }
      await openNativeExport(page);
      await pickMonth(page, MONTH);
      expect(await visibleExportButtons(page)).toEqual(expectedButtons(access));
      if (access.general) {
        // 畫面與 API 一致（DEV 的資料列可見範圍因角色而異，這裡以 API 為準）。
        const stats = await readStats(page);
        const exportableIds = apiStores.filter((x) => x.store_status !== 'pending');
        expect(Number(stats.total)).toBe(apiStores.length);
        expect(Number(stats.exportable)).toBe(exportableIds.length);
        expect(Number(stats.selected)).toBe(exportableIds.length); // 預設選取所有可匯出門市
        expect(Number(stats.employees)).toBe(exportableIds.reduce((n, x) => n + x.total_employees, 0));
        const rows = await readStoreRows(page);
        expect(rows.map((r) => r.code)).toEqual(apiStores.map((x) => x.store_code));
        const by = Object.fromEntries(rows.map((r) => [r.code, r]));
        if (by.ZT03) {
          expect(by.ZT03).toMatchObject({ status: 'pending', checked: false, disabled: true });
          expect(by.ZT03.text).toContain('尚未提交，無法匯出');
        }
        if (by.ZT04) expect(by.ZT04).toMatchObject({ status: 'submitted', checked: true, disabled: false });
        if (by.ZT05) expect(by.ZT05).toMatchObject({ status: 'confirmed', checked: true, disabled: false });
        if (role === 'admin') {
          expect(Number(stats.total)).toBeGreaterThanOrEqual(3);
          expect(by.ZT04, 'admin 必須看得到已送審的測試門市').toBeTruthy();
        }
      }
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('denied：選單沒有「資料匯出」入口', async ({ browser }) => {
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="資料匯出"]')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});
