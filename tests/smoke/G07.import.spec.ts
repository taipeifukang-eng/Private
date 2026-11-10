import { expect, test } from '@playwright/test';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 Q29 冒煙層：Excel 匯入頁（側欄入口、標題、範本與代碼對照 API 200、無 pageerror、390 寬無水平溢出）。
// 總務、設備管理、設施管理有入口；店長、設備查看者沒有入口，直接打 API 回 403。只讀測試：不建立任何資料。
test('總務：側欄「Excel 匯入」開新版頁籤；代碼對照 API 200；有下載範本與選檔按鈕；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, 'Excel 匯入');
    await expect(visibleHeading(page, '設備與設施 Excel 匯入')).toBeVisible();
    await expect(page.getByTestId('download-template').locator('visible=true')).toBeVisible();
    await expect(page.getByRole('button', { name: '選擇 Excel 檔' }).locator('visible=true')).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/workspace/general-affairs/asset-import/reference')).status)).toBe(200);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('設備管理與設施管理者有入口；設備查看者與店長沒有入口，API 403', async ({ browser }, testInfo) => {
  for (const [role, expected] of [['ga_equipment_edit', true], ['ga_facility_edit', true], ['ga_equipment_view', false], ['store_manager', false]] as const) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      expect(labels.includes('Excel 匯入'), role).toBe(expected);
      expect(errors, role).toEqual([]); // 先檢查頁面錯誤，再打會回 403 的 API（那次 403 本身會進 console）
      expect(await page.evaluate(async () => (await fetch('/api/workspace/general-affairs/asset-import/reference')).status), role).toBe(expected ? 200 : 403);
    } finally {
      await ctx.close();
    }
  }
});
