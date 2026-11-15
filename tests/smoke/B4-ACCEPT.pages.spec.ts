import { expect, test } from '@playwright/test';
import { noPageOverflow, openGaCenter, pageFor, sideLabels } from '../support/g01-ui';
import { assertGaBaseline } from '../support/m7m8-fixtures';

// 第 4 批驗收（冒煙層）：總務服務中心側欄列出第 4 批入口，桌機 1440 與手機 390（project viewport）都無水平溢出、無 console 錯誤。
// 用 role-matrix 的採購人員與核准人帳號，不建立任何資料。
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await assertGaBaseline(); });

const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

for (const [key, label, absent] of [['ga_po_purchaser', '採購單', '待簽核採購單'], ['ga_po_approver', '待簽核採購單', ''], ['admin', '採購單', '']] as const) {
  test(`${key}：側欄有「${label}」${absent ? `、沒有「${absent}」` : ''}；無水平溢出、無錯誤`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const { ctx, page, errors } = await pageFor(browser, key, testInfo);
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      expect(labels).toContain(label);
      if (absent) expect(labels).not.toContain(absent);
      expect(await noPageOverflow(page)).toBe(true);
      expect(real(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
