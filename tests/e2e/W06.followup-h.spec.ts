import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/w05-fixtures';
import {
  W06_MONTHS,
  adminDb,
  historyOf,
  insertHistory,
  masterOf,
  purgeReceipts,
  purgeW06,
  recheckOf,
  recompute,
  registerW06,
  rosterRows,
  seedMaster,
  seedRoster,
  submitMovements,
  w06Code,
  w06StoreIds,
} from '../support/w06-fixtures';

// W06 後續問卷端到端（桌機 1440、手機 390）：
//   H.4 員工管理列表與編輯視窗顯示員工主檔階段（升職異動自動更新）。
//   H.6 批次輸入異動：升職職位預設不列總部職位，勾「顯示總部職位」後可選並成功儲存。
//   H.9 歷史紀錄頁修改異動姓名：名冊全部月份（含已確認）同步，不列需重新確認。
//   H.3 歷史紀錄頁刪除唯一一筆入職：員工停用、未鎖定名冊列移出、已送審月份記需重新確認。
// 資料用測試員編 FKF7xxxx 與保留月份 2099-07～2099-09，桌機 ZT01、手機 ZT02，測後清除。

const { m1, m2, m3 } = W06_MONTHS;

async function openHistory(page: Page, month: string) {
  await openNativePage(page, '人員異動管理');
  await page.getByRole('button', { name: '查看歷史紀錄' }).click();
  const p = workPanel(page);
  await p.getByLabel('生效月份').fill(month);
  await p.getByRole('button', { name: '查詢紀錄' }).click();
  await expect(p.getByText(/共 \d+ 筆/)).toBeVisible({ timeout: 30_000 });
  return p;
}

test.describe('W06 後續問卷 H 組畫面', () => {
  let admin: APIRequestContext;
  let store = '';
  const started = new Date().toISOString();
  const used: string[] = [];
  const setup = async (storeCode: string) => {
    admin = await apiAs('admin');
    store = (await w06StoreIds(admin, m1))[storeCode];
  };
  const claim = async (code: string) => {
    used.push(code);
    await purgeW06([code], [store]);
  };
  test.afterEach(async () => {
    await registerW06(used).catch(() => undefined);
    await purgeW06(used, store ? [store] : []).catch(() => undefined);
    await purgeReceipts(started, store ? [store] : []).catch(() => undefined);
    used.length = 0;
    await admin?.dispose();
  });

  test('H.4 員工管理列表與編輯視窗顯示階段（依升職異動）', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === 'mobile-390';
    await setup(mobile ? 'ZT02' : 'ZT01');
    const code = w06Code('FKF', mobile ? 83 : 80);
    await claim(code);
    const ctx = await loginAs(browser, 'admin');
    try {
      await seedMaster(code, 'E2E 階段', store, { position: '新人' });
      const r = await submitMovements(admin, [{ employee_code: code, employee_name: 'E2E 階段', store_id: store, movement_type: 'promotion', position: '新人', newbie_level: '二階新人', effective_date: '2025-06-01' }]);
      expect(r.ok, JSON.stringify(r.body)).toBe(true);
      expect((await masterOf(code))[0].newbie_level).toBe('二階新人');
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const errors = collectErrors(page);
      await openNativePage(page, '員工管理');
      const p = workPanel(page);
      await p.getByPlaceholder('員編、姓名或職位').fill(code);
      const row = p.locator('tbody tr', { hasText: code });
      await expect(row).toHaveCount(1, { timeout: 60_000 });
      await expect(row.getByTestId('employee-stage')).toHaveText('二階新人');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      await row.getByRole('button', { name: '編輯' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('employee-edit-stage')).toHaveValue('二階新人', { timeout: 60_000 });
      await expect(dialog.getByTestId('employee-edit-stage')).toHaveAttribute('readonly', '');
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('H.6 批次輸入異動：升職選總部職位需先勾「顯示總部職位」，仍可儲存', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === 'mobile-390';
    await setup(mobile ? 'ZT02' : 'ZT01');
    const code = w06Code('FKF', mobile ? 84 : 81);
    await claim(code);
    const ctx = await loginAs(browser, 'admin');
    try {
      await seedMaster(code, 'E2E 總部職位', store, { position: '專員' });
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const errors = collectErrors(page);
      await openNativePage(page, '人員異動管理');
      const p = workPanel(page);
      await p.getByLabel('員編', { exact: true }).fill(code);
      await p.getByLabel('姓名', { exact: true }).fill('E2E 總部職位');
      await p.getByLabel('異動類型').selectOption('promotion');
      await p.getByLabel('任職門市／組織').selectOption({ value: store });
      await p.getByLabel('生效日期').fill('2099-08-05');
      const select = p.getByRole('combobox', { name: '升任後職位' });
      expect(await select.locator('option').allTextContents()).not.toContain('副理');
      await p.getByRole('checkbox', { name: '顯示總部職位' }).check();
      await select.selectOption('副理');
      await p.getByRole('button', { name: /^驗證 \d+ 筆異動/ }).click();
      await p.getByRole('button', { name: /^核對並儲存 \d+ 筆/ }).click({ timeout: 60_000 });
      await page.getByRole('dialog').getByRole('button', { name: /^確認儲存/ }).click();
      await expect(p.getByText(/提交編號/)).toBeVisible({ timeout: 60_000 });
      expect((await historyOf(code)).map((h) => [h.movement_type, h.new_value])).toEqual([['promotion', '副理']]);
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('H.9 歷史紀錄頁修改姓名：全部月份（含已確認）同步，不列需重新確認', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === 'mobile-390';
    await setup(mobile ? 'ZT02' : 'ZT01');
    const code = w06Code('FKF', mobile ? 85 : 82);
    await claim(code);
    const ctx = await loginAs(browser, 'admin');
    try {
      await seedMaster(code, 'E2E 舊名', store);
      await seedRoster(store, m1, [{ code, name: 'E2E 舊名', status: 'draft' }]);
      await seedRoster(store, m2, [{ code, name: 'E2E 舊名', status: 'confirmed' }]);
      await insertHistory({ code, name: 'E2E 舊名', store, type: 'pass_probation', date: `${m2}-10`, old: '專員', new: '專員', notes: '改名測試' });
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const errors = collectErrors(page);
      const p = await openHistory(page, m2);
      const row = p.locator('tbody tr', { hasText: code }).filter({ hasText: '改名測試' });
      await row.getByTestId('movement-edit').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('姓名').fill('E2E 新名');
      await dialog.getByTestId('movement-edit-save').click();
      await expect(page.getByTestId('movement-notice')).toContainText('已更新', { timeout: 60_000 });
      const rows = await rosterRows(code);
      expect(rows.map((r) => [r.year_month, r.status, r.employee_name])).toEqual([[m1, 'draft', 'E2E 新名'], [m2, 'confirmed', 'E2E 新名']]);
      expect((await recheckOf(code)).filter((x) => x.field === 'employee_name')).toEqual([]);
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('H.3 歷史紀錄頁刪除唯一一筆入職：員工停用、未鎖定名冊列移出、已送審月份記需重新確認', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === 'mobile-390';
    await setup(mobile ? 'ZT02' : 'ZT01');
    const code = w06Code('FKF', mobile ? 87 : 86);
    await claim(code);
    const ctx = await loginAs(browser, 'admin');
    try {
      await seedMaster(code, 'E2E 唯一入職', store, { position: '新人', startDate: `${m1}-10` });
      await insertHistory({ code, name: 'E2E 唯一入職', store, type: 'onboarding', date: `${m1}-10`, old: null, new: 'active', notes: '唯一入職', pharmacist: false });
      await adminDb().from('store_employees').update({ last_movement_date: `${m1}-10`, last_movement_type: 'onboarding' }).eq('employee_code', code);
      await seedRoster(store, m1, [{ code, name: 'E2E 唯一入職', position: '新人' }]);
      await seedRoster(store, m2, [{ code, name: 'E2E 唯一入職', position: '新人' }]);
      await seedRoster(store, m3, [{ code, name: 'E2E 唯一入職', position: '新人', status: 'submitted' }]);
      await recompute(code, m1);
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const errors = collectErrors(page);
      const p = await openHistory(page, m1);
      const row = p.locator('tbody tr', { hasText: code }).filter({ hasText: '唯一入職' });
      await expect(row.getByTestId('movement-delete')).toBeEnabled();
      await row.getByTestId('movement-delete').click();
      await page.getByTestId('movement-delete-confirm').click();
      await expect(page.getByTestId('movement-notice')).toContainText('已刪除', { timeout: 60_000 });
      const master = (await masterOf(code))[0];
      expect([master.is_active, master.employment_status]).toEqual([false, 'resigned']);
      expect((await rosterRows(code)).map((r) => r.year_month)).toEqual([m3]); // 未鎖定月份移出，已送審月份不動
      expect((await recheckOf(code)).some((x) => x.year_month === m3 && x.field === 'roster_row')).toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
