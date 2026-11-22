import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import {
  W05_MONTHS,
  applyProjectViewport,
  collectErrors,
  ensureStats,
  monthlyRows,
  noPageOverflow,
  openNativePage,
  purgeCodes,
  registerCode,
  registerRoster,
  resetMonths,
  storeIds,
  w05Code,
  workPanel,
} from '../support/w05-fixtures';

// W05 後續問卷端到端（桌機 1440、手機 390）：每月人員狀態 → 手動新增員工。
//   H.2 員編必填且符合 E.1（空白、FKI 都擋，畫面與 API 皆擋）。
//   H.8 類型不再讓人選，依員編顯示「類型：兼職（依員編）」／「類型：正職（依員編）」並依此寫入。
// 桌機用 ZT01、手機用 ZT02，保留月份 2099-11；測後清除。

async function openMonthly(page: Page) {
  await openNativePage(page, '每月人員狀態');
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}

test('每月人員狀態手動新增：員編必填、FKI 被擋、類型依員編顯示並寫入', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const storeCode = mobile ? 'ZT02' : 'ZT01';
  const month = W05_MONTHS.draft;
  const codes = { pt: w05Code('FKPT', mobile ? 33 : 31), fk: w05Code('FK', mobile ? 4 : 3) };
  const admin: APIRequestContext = await apiAs('admin');
  const ctx = await loginAs(browser, 'admin');
  let store = '';
  try {
    await purgeCodes(Object.values(codes));
    store = (await storeIds(admin, month))[storeCode];
    await resetMonths([store]);
    await ensureStats(admin, store, month);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openMonthly(page);
    await page.getByLabel('門市', { exact: true }).selectOption({ value: store });
    await page.getByLabel('月份').fill(month);
    await page.getByRole('button', { name: '查詢人員' }).click();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
    await page.getByRole('button', { name: '手動新增員工' }).click();
    const dialog = page.getByRole('dialog');
    // 員編必填；沒有僱用類型下拉，類型文字依員編變化
    const code = dialog.getByLabel('員工代號');
    await expect(code).toHaveAttribute('required', '');
    await expect(dialog.getByText('必填。格式：FK+4碼、FKF+5碼、FKPT+3碼數字')).toBeVisible();
    await expect(dialog.getByTestId('manual-employment-type')).toContainText('請先填寫正確員編');
    await expect(dialog.locator('select', { has: page.locator('option[value="part_time"]') })).toHaveCount(0);
    await code.fill(codes.pt.toLowerCase());
    await expect(dialog.getByTestId('manual-employment-type')).toHaveText('類型：兼職（依員編）');
    await code.fill(codes.fk);
    await expect(dialog.getByTestId('manual-employment-type')).toHaveText('類型：正職（依員編）');
    await code.fill('FKI001');
    await expect(dialog.getByTestId('manual-employment-type')).toContainText('請先填寫正確員編');
    await dialog.getByLabel('姓名', { exact: true }).fill('W05 手動新增');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);

    // 空白員編：瀏覽器必填檢查擋下，不會送出；FKI：送出後顯示錯誤，沒有寫入
    await code.fill('');
    await dialog.getByRole('button', { name: '儲存' }).click();
    await expect(dialog).toBeVisible();
    expect((await monthlyRows('FKI001', [month])).length).toBe(0);
    await code.fill('FKI001');
    await dialog.getByRole('button', { name: '儲存' }).click();
    await expect(dialog).toContainText('實習生');
    expect((await monthlyRows('FKI001', [month])).length).toBe(0);

    // 合規 FKPT：兼職寫入
    await code.fill(codes.pt);
    await dialog.getByLabel('職位').selectOption('兼職助理');
    await dialog.getByRole('button', { name: '儲存' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 60_000 });
    const row = (await monthlyRows(codes.pt, [month]))[0];
    expect(row).toMatchObject({ employee_code: codes.pt, employment_type: 'part_time', is_manually_added: true });
    await expect(workPanel(page).locator(`tr[data-staff="${codes.pt}"]`)).toBeVisible({ timeout: 60_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await registerRoster(store, month).catch(() => undefined);
    for (const code of Object.values(codes)) await registerCode(code).catch(() => undefined);
    await purgeCodes(Object.values(codes)).catch(() => undefined);
    if (store) await resetMonths([store]).catch(() => undefined);
    await admin.dispose();
    await ctx.close();
  }
});
