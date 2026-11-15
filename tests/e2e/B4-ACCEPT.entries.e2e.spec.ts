import { expect, test } from '@playwright/test';
import { noPageOverflow, openGaCenter, openGaSide, pageFor, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline } from '../support/m7m8-fixtures';

// 第 4 批驗收（e2e 層，只讀）：管理員從側欄逐一打開第 4 批的入口（新增需求、我的追蹤、總務需求工作台、料件處理中心、採購單），
// 每頁都有標題、沒有「無權限」、沒有水平溢出、沒有 console 錯誤；核准人從側欄進「待簽核採購單」看到待簽核清單區。
// 完整角色接力（含權限檢查段）在四支劇本：G25.journey-printers、G16.journey-equipment-purchase、G17.journey-part-replenish、G27.journey-transfer-follow。
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await assertGaBaseline(); });

const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();

test('管理員逐一打開第 4 批入口：有標題、無權限提示、無溢出、無錯誤', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageFor(browser, 'admin', testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    const targets = ['新增需求', '我的追蹤', '總務需求工作台', '料件處理中心', '採購單'].filter((l) => labels.includes(l));
    expect(targets.length, `側欄入口：${labels.join('、')}`).toBeGreaterThanOrEqual(4);
    for (const label of targets) {
      await openGaSide(page);
      await side(page, label).click();
      await expect(page.getByRole('heading').locator('visible=true').first()).toBeVisible();
      await expect(shell(page).getByText('沒有權限', { exact: false })).toHaveCount(0);
      expect(await noPageOverflow(page), label).toBe(true);
    }
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('核准人：側欄進「待簽核採購單」，看到待簽核清單區、沒有新增採購單按鈕', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_po_approver', testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await side(page, '待簽核採購單').click();
    await expect(visibleHeading(page, '待簽核採購單')).toBeVisible();
    await expect(page.getByTestId('new-po')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
