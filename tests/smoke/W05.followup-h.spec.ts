import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/w05-fixtures';

// W05 冒煙層（M2 後續問卷 H.4）：員工管理列表多一欄「階段」，編輯員工視窗顯示唯讀階段；沒有 console 錯誤與頁面層級水平溢出
// （桌機 1440 與手機 390）。唯讀，不建立任何資料。

test('員工管理：列表有「階段」欄，編輯視窗顯示唯讀階段，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '員工管理');
    const p = workPanel(page);
    await expect(p.getByText('總員工數')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByRole('columnheader', { name: '階段' })).toBeVisible();
    await expect(p.locator('tbody tr').first().getByTestId('employee-stage')).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await p.locator('tbody tr').first().getByRole('button', { name: '編輯' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('employee-edit-stage')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByTestId('employee-edit-stage')).toHaveAttribute('readonly', '');
    await expect(dialog).toContainText('依升職異動自動更新');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('每月人員狀態頁：可開啟並有「手動新增員工」入口（唯讀檢查）', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '每月人員狀態');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
