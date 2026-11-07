import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { M4B_MONTH, deleteRunMasters, seedFollowupInspection } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { openInspectionDetail, openPrintPreview, work } from '../support/m4b-ui';

// W16 冒煙層：巡店詳情與列印預覽可開啟；沒有 pageerror、console 錯誤與水平溢出（桌機 1440、手機 390）。
const DATE = `${M4B_MONTH.detail}-12`;

test.beforeAll(async () => {
  runIdOrThrow();
  await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: DATE, tag: 'w16-smoke', count: 2 });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

test('詳情與列印預覽（管理員）：能開啟、報表有舊版區塊、沒有錯誤與溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openInspectionDetail(page, { month: M4B_MONTH.detail, store: 'ZT01', date: DATE });
    await expect(work(page).getByTestId('detail-score')).toContainText('最終得分');
    await expect(work(page).getByRole('button', { name: '列印報表預覽' })).toBeVisible();
    await expect(work(page).getByRole('button', { name: '刪除巡店' })).toBeVisible();
    expect(await noPageOverflow(page), '詳情頁水平溢出').toBe(true);
    await openPrintPreview(page);
    for (const text of ['評分總覽', '待改善項目彙整', '回饋與簽名確認', '督導建議流程：']) await expect(work(page).getByText(text).first()).toBeVisible();
    expect(await noPageOverflow(page), '列印預覽水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
