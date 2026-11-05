import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import {
  W05_MONTHS,
  addMonthlyManual,
  applyProjectViewport,
  collectErrors,
  createEmployee,
  ensureStats,
  masterRows,
  monthlyRows,
  noPageOverflow,
  openEmployeeCreate,
  openNativePage,
  purgeCodes,
  recheckRows,
  registerCode,
  registerRoster,
  resetMonths,
  storeIds,
  w05Code,
  workPanel,
} from '../support/w05-fixtures';

// W05 端到端層：在新版畫面新增員工（FKI 被擋、FKPT 顯示兼職並寫成兼職）、在員工管理改職位
// （已送審月份不動、顯示「需重新確認」）。桌機用 ZT01、手機用 ZT02，員編與保留月份 2099-11／2099-12 錯開。

test('新增員工與編輯職位（UI）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const offset = mobile ? 20 : 10;
  const storeCode = mobile ? 'ZT02' : 'ZT01';
  const codes = { fkpt: w05Code('FKPT', offset), fk: w05Code('FK', mobile ? 8 : 7), edit: w05Code('FKF', offset + 1) };
  const admin: APIRequestContext = await apiAs('admin');
  const ctx = await loginAs(browser, 'admin');
  try {
    await purgeCodes(Object.values(codes));
    const store = (await storeIds(admin, W05_MONTHS.draft))[storeCode];
    await resetMonths([store]);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);

    // --- 新增員工：FKI 被擋，沒有確認視窗也沒有寫入 ---
    await openEmployeeCreate(page);
    const p = workPanel(page);
    await p.getByLabel('員編').first().fill('FKI001');
    await expect(p.getByTestId('employee-id-error')).toContainText('實習生不納入系統'); // 即時提示（輸入時就看到）
    await expect(p.getByTestId('employee-type')).toHaveCount(0);
    await p.getByLabel('姓名').fill('W05 實習生');
    await p.getByRole('button', { name: '核對並新增' }).click();
    await expect(p.getByRole('alert')).toContainText('實習生');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await masterRows('FKI001')).length).toBe(0);

    // --- 新增員工：格式錯誤 ---
    await p.getByLabel('員編').first().fill('FK12');
    await expect(p.getByTestId('employee-id-error')).toContainText('員編格式錯誤'); // 格式不合規不顯示「類型：正職」
    await expect(p.getByTestId('employee-type')).toHaveCount(0);
    await p.getByRole('button', { name: '核對並新增' }).click();
    await expect(p.getByRole('alert')).toContainText('員編格式錯誤');

    // --- 新增員工：FKPT 顯示兼職（依員編），確認視窗也顯示，寫入為兼職 ---
    await p.getByLabel('員編').first().fill(codes.fkpt.toLowerCase());
    await expect(p.getByTestId('employee-type')).toHaveText('類型：兼職（依員編）');
    await p.getByRole('button', { name: '核對並新增' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('兼職（依員編）');
    await expect(dialog).toContainText(codes.fkpt);
    await dialog.getByRole('button', { name: '確認新增' }).click();
    await expect(p.getByRole('status').filter({ hasText: `已新增 ${codes.fkpt}` })).toBeVisible({ timeout: 30_000 });
    const rows = await masterRows(codes.fkpt);
    expect(rows).toHaveLength(1);
    expect(rows[0].employment_type).toBe('part_time');
    await registerCode(codes.fkpt);

    // --- 編輯職位：先備好主檔與兩個月份名冊（草稿 + 已送審） ---
    expect((await createEmployee(admin, { employee_code: codes.edit, employee_name: 'W05 UI 編輯前', current_position: '專員' })).status).toBe(200);
    expect((await addMonthlyManual(admin, store, W05_MONTHS.draft, { employee_name: 'W05 UI 編輯前', employee_code: codes.edit })).status).toBe(200);
    expect((await addMonthlyManual(admin, store, W05_MONTHS.locked, { employee_name: 'W05 UI 編輯前', employee_code: codes.edit })).status).toBe(200);
    await ensureStats(admin, store, W05_MONTHS.locked);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store, month: W05_MONTHS.locked, skipChecks: true } })).status()).toBe(200);
    await registerRoster(store, W05_MONTHS.draft);
    await registerRoster(store, W05_MONTHS.locked);
    await registerCode(codes.edit);

    await openNativePage(page, '員工管理');
    const list = workPanel(page);
    await list.getByPlaceholder('員編、姓名或職位').fill(codes.edit);
    const row = list.locator('tbody tr', { hasText: codes.edit });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await row.getByRole('button', { name: '編輯' }).click();
    const edit = page.getByRole('dialog').filter({ hasText: '編輯員工' });
    await expect(edit.getByTestId('employee-edit-sync-note')).toContainText('已送審或已確認的月份不會變動');
    await edit.getByLabel('姓名').fill('W05 UI 編輯後');
    await edit.getByLabel('當前職位').selectOption('主任');
    await edit.getByRole('button', { name: '儲存變更' }).click();
    const notice = page.getByRole('dialog').filter({ hasText: '需重新確認' });
    await expect(notice.getByTestId('employee-edit-recheck')).toContainText('1 個已送審或已確認的月份未更動');
    await notice.getByRole('button', { name: '知道了' }).click();
    await expect(list.getByRole('status').filter({ hasText: '員工資料已儲存' })).toBeVisible({ timeout: 30_000 });

    const monthly = Object.fromEntries((await monthlyRows(codes.edit)).map((r) => [r.year_month, r]));
    expect(monthly[W05_MONTHS.draft]).toMatchObject({ position: '主任', employee_name: 'W05 UI 編輯後' });
    expect(monthly[W05_MONTHS.locked]).toMatchObject({ position: '專員', employee_name: 'W05 UI 編輯後' });
    const recheck = await recheckRows(codes.edit);
    expect(recheck.map((r) => [r.year_month, r.old_value, r.new_value, r.status])).toEqual([[W05_MONTHS.locked, '專員', '主任', 'pending']]);
    await registerCode(codes.edit);

    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await purgeCodes(Object.values(codes)).catch(() => undefined);
    await resetMonths([...(await storeIds(admin, W05_MONTHS.draft).then((m) => [m[storeCode]]).catch(() => []))]).catch(() => undefined);
    await ctx.close();
    await admin.dispose();
  }
});
