import { expect, test } from '@playwright/test';
import { noPageOverflow, openGaCenter, openGaSide, pageFor, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline } from '../support/m7m8-fixtures';

// 第 4 批驗收（冒煙層）：總務服務中心側欄列出第 4 批入口，桌機 1440 與手機 390（project viewport）都無水平溢出、無 console 錯誤。
// 用 role-matrix 的採購人員與核准人帳號，不建立任何資料。
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await assertGaBaseline(); });

// 只排除瀏覽器對失敗請求的通用訊息（沒有網址）；失敗的 API 改由 response 監聽逐一抓，任何 /api/ 回 4xx 或 5xx 都算失敗。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

for (const [key, label, absent] of [['ga_po_purchaser', '採購單', '待簽核採購單'], ['ga_po_approver', '待簽核採購單', ''], ['admin', '採購單', '']] as const) {
  test(`${key}：側欄有「${label}」${absent ? `、沒有「${absent}」` : ''}；無水平溢出、無錯誤`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const { ctx, page, errors } = await pageFor(browser, key, testInfo);
    const bad: string[] = [];
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      expect(labels).toContain(label);
      if (absent) expect(labels).not.toContain(absent);
      expect(await noPageOverflow(page)).toBe(true);
      // 真的點進入口：頁面標題出現、頁面用到的 API 沒有失敗（入口不能是點了被擋的壞入口）。
      await openGaSide(page);
      await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).click();
      await expect(visibleHeading(page, label)).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await noPageOverflow(page)).toBe(true);
      expect(bad).toEqual([]);
      expect(real(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
