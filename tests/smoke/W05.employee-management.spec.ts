import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openEmployeeCreate, openNativePage, workPanel } from '../support/w05-fixtures';

// W05 冒煙層：員工管理、新增員工、批次匯入員工能從選單開啟並載入，沒有 console 錯誤與頁面層級水平溢出
// （桌機 1440 與手機 390）。新增員工頁輸入 FKPT 開頭員編時顯示「類型：兼職（依員編）」。不建立任何資料。

test('員工管理頁：統計與名冊載入，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '員工管理');
    const p = workPanel(page);
    await expect(p.getByText('總員工數')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByRole('button', { name: '新增員工' }).first()).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('新增員工頁：格式提示、FKPT 顯示兼職類型、FKI 不顯示類型，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openEmployeeCreate(page);
    const p = workPanel(page);
    await expect(p.getByText('格式：FK+4碼、FKF+5碼、FKPT+3碼數字')).toBeVisible({ timeout: 60_000 });
    const code = p.getByLabel('員編', { exact: false }).first();
    await expect(p.getByTestId('employee-type')).toHaveCount(0);
    await code.fill('fkpt123');
    await expect(p.getByTestId('employee-type')).toHaveText('類型：兼職（依員編）');
    await code.fill('FK1234');
    await expect(p.getByTestId('employee-type')).toHaveText('類型：正職（依員編）');
    await code.fill('FKI001');
    await expect(p.getByTestId('employee-type')).toHaveCount(0);
    await expect(p.getByText(/實習生已確認|FKI 實習生員編/)).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('批次匯入員工頁：載入並說明職位限公司職位清單，沒有錯誤與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '批次匯入員工');
    const p = workPanel(page);
    await expect(p.getByText(/職位須在公司職位清單內/)).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText(/FKPT 開頭自動為兼職/)).toBeVisible();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('舊版員工管理頁仍可開啟（對等基準）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/admin/employee-management', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /新增員工/ }).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await ctx.close();
  }
});
