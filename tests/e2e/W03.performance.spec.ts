import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { calcMonthlyBonus, MONTHLY_THRESHOLDS } from '../../lib/performance/bonus-calc';
import {
  W03_YEAR,
  XLSX_MIME,
  bonusEmployeeCode,
  perfImportRow,
  perfStoreIds,
  registerPerfRows,
  restoreDefaultThresholds,
  xlsxBuffer,
} from '../support/w03-fixtures';
import { noPageOverflow, openNativePerformance, panel, queryYear, readMonthRow } from '../support/w03-ui';

// W03 e2e：桌機 1440 與手機 390 各跑一次（2038 年，桌機用 ZT01 + ZT02、手機用 VW001 + ZT02，不同月份避免互相覆蓋，sweeper 清除）。
//  1. 團體獎金：W03-q1 不選門市匯入多間門市 → 開編輯分頁改毛利並存檔 → 年度頁獎金與 bonus-calc 一致 → W03-q4 閾值儲存後年度頁自動重新載入並顯示「自訂閾值」。
//  2. 處方箋：單月編輯、格式驗證、儲存後狀態徽章為「已完成」、總慢箋張數。
//  3. 匯入每月獎金：無有效資料的檔案顯示錯誤；有效檔案匯入後出現在表格。

const group = (page: Page) => panel(page).getByRole('region', { name: '團體獎金' });
const prescription = (page: Page) => panel(page).getByRole('region', { name: '處方箋' });
const bonus = (page: Page) => panel(page).getByRole('region', { name: '匯入每月獎金' });
const file = (rows: Record<string, unknown>[], name = 'w03-e2e.xlsx') => ({ name, mimeType: XLSX_MIME, buffer: xlsxBuffer(rows) });

function plan(mobile: boolean) {
  return mobile
    ? { primary: 'VW001', label: /^VW001 /, month: 11, rxMonth: '2038-04', bonusMonth: '2038-06', tag: 'E2' }
    : { primary: 'ZT01', label: /^ZT01 /, month: 10, rxMonth: '2038-03', bonusMonth: '2038-05', tag: 'E1' };
}

test('團體獎金：匯入（不選門市）、編輯、獎金與閾值自動重新載入', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const p = plan(mobile);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  let storeId = '';
  let zt02 = '';
  try {
    const ids = await perfStoreIds(admin);
    storeId = ids[p.primary as 'ZT01' | 'VW001'];
    zt02 = ids.ZT02;
    await restoreDefaultThresholds(admin, storeId);
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await openNativePerformance(page);
      await queryYear(page, p.label, W03_YEAR);
      const g = group(page);
      await expect(g.getByText('此門市使用自訂閾值')).toHaveCount(0);

      // W03-q1：不指定門市，依 Excel 門市代號一次匯入兩間門市
      await g.getByLabel('匯入門市').selectOption('excel');
      await g.locator('.performance-import input[type=file]').setInputFiles(
        file([perfImportRow(p.primary, p.month, { 月實際毛利額: 800000 }), perfImportRow('ZT02', p.month, { 月實際毛利額: 810000 })]),
      );
      await g.getByRole('button', { name: '匯入 Excel' }).click();
      const confirm = page.getByRole('dialog', { name: '確認匯入業績' });
      await expect(confirm).toContainText('未指定門市');
      await confirm.getByRole('button', { name: '確認匯入' }).click();
      await expect(g.getByRole('status').filter({ hasText: '匯入完成：成功 2 筆' })).toBeVisible({ timeout: 30_000 });
      const imported = await readRowsAsServiceRole('store_performance', { in: { store_id: [storeId, ids.ZT02] }, eq: { year: W03_YEAR, month: p.month }, select: 'store_id,monthly_gross_profit_actual' });
      expect(imported).toHaveLength(2);
      expect((await readMonthRow(page, p.month))[3]).toBe('800,000'); // 毛利實際

      // 編輯：開新分頁、改實際毛利、存檔（W03-q2：保留表單編輯）
      await g.locator('.performance-detail-table tbody tr').nth(p.month - 1).getByRole('button', { name: '編輯' }).click();
      const editor = panel(page).locator('form.module-editor');
      await expect(editor).toBeVisible({ timeout: 20_000 });
      await editor.getByLabel('實際毛利', { exact: true }).fill('900000');
      await editor.getByRole('button', { name: '儲存業績' }).click();
      await expect(panel(page).getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      const saved = (await readRowsAsServiceRole('store_performance', { eq: { store_id: storeId, year: W03_YEAR, month: p.month } }))[0];
      expect(Number(saved.monthly_gross_profit_actual)).toBe(900000);

      // 回到年度頁重新查詢：月獎金與 bonus-calc 完全一致
      await page.getByRole('tab', { name: /業績管理/ }).click();
      await g.getByRole('button', { name: '查詢業績' }).click();
      await expect(panel(page).getByText('載入業績…')).toHaveCount(0, { timeout: 30_000 });
      const expected = calcMonthlyBonus(
        { businessDays: 26, grossProfitTarget: 780000, grossProfitActual: 900000, revenueTarget: 3000000, revenueActual: 3100000, customerCountTarget: 4000, customerCountActual: 4100, rxTarget: 500, rxActual: 520 },
        MONTHLY_THRESHOLDS,
      );
      expect(expected.finalBonus).toBeGreaterThan(0);
      const bonusCell = g.locator('.performance-detail-table tbody tr').nth(p.month - 1).locator('summary');
      await expect(bonusCell).toHaveText(expected.finalBonus.toLocaleString('zh-TW'));
      expect((await readMonthRow(page, p.month))[3]).toBe('900,000');

      // W03-q4：閾值在另一個分頁儲存後，已開啟的年度頁自動重新載入（不按任何查詢鈕）
      await g.getByRole('button', { name: '設定閾值' }).click();
      const thForm = panel(page).locator('form').filter({ has: page.getByRole('button', { name: '儲存閾值' }) });
      await expect(thForm).toBeVisible({ timeout: 20_000 });
      await thForm.getByLabel('月第 1 檻（元／人）').fill('4000');
      await thForm.getByRole('button', { name: '儲存閾值' }).click();
      await expect(panel(page).getByRole('status').filter({ hasText: '獎金閾值已儲存' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('tab', { name: /業績管理/ }).click();
      await expect(g.getByText('獎金閾值已更新，年度頁已自動重新載入。')).toBeVisible({ timeout: 30_000 });
      await expect(g.locator('.performance-thresholds dd').first()).toHaveText('4,000 元／人');
      await expect(g.getByText('此門市使用自訂閾值')).toBeVisible();
      const custom = calcMonthlyBonus(
        { businessDays: 26, grossProfitTarget: 780000, grossProfitActual: 900000, revenueTarget: 3000000, revenueActual: 3100000, customerCountTarget: 4000, customerCountActual: 4100, rxTarget: 500, rxActual: 520 },
        MONTHLY_THRESHOLDS.map((t, i) => (i === 0 ? { ...t, baseAmount: 4000 } : t)),
      );
      await expect(bonusCell).toHaveText(custom.finalBonus.toLocaleString('zh-TW'));

      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    if (storeId) {
      await registerPerfRows([storeId, zt02].filter(Boolean));
      await restoreDefaultThresholds(admin, storeId);
      await registerPerfRows([storeId]);
    }
    await admin.dispose();
  }
});

test('處方箋：單月編輯、格式驗證、儲存後狀態與總慢箋張數', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const p = plan(mobile);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  try {
    const ids = await perfStoreIds(admin);
    const storeId = ids[p.primary as 'ZT01' | 'VW001'];
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await openNativePerformance(page);
      await panel(page).getByRole('navigation', { name: '業績子功能' }).getByRole('button', { name: '處方箋' }).click();
      const rx = prescription(page);
      await expect(rx.getByRole('button', { name: '查詢處方箋' })).toBeVisible({ timeout: 30_000 });
      await rx.getByLabel('檢視').selectOption('month');
      await rx.getByLabel('月份').fill(p.rxMonth);
      await rx.getByRole('button', { name: '查詢處方箋' }).click();
      await rx.getByLabel('搜尋門市').fill(p.primary);
      const row = rx.locator('tbody tr').filter({ hasText: p.primary });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row).toContainText('未填');

      // 格式錯誤：一般箋張數 1.5 → 送不出去（畫面或伺服器擋下），資料不變
      await row.getByLabel(`${p.primary} 一般箋張數`).fill('10');
      await row.getByLabel(`${p.primary} 一般箋點值`).fill('1.2345');
      await expect(row).toContainText('部分填寫');
      await row.getByLabel(`${p.primary} 慢箋張數`).fill('5');
      await row.getByLabel(`${p.primary} 慢箋點值`).fill('2.5');
      await expect(row).toContainText('已完成');
      await expect(row.locator('td').nth(4)).toHaveText('7.5'); // 10 / 4 = 2.5，加 5

      // 未儲存時，查詢條件被鎖住（不會悄悄丟掉草稿）
      await expect(rx.getByLabel('檢視')).toBeDisabled();

      await rx.getByRole('button', { name: /儲存處方箋/ }).click();
      await expect(rx.getByRole('status').filter({ hasText: '已儲存 1 間門市' })).toBeVisible({ timeout: 30_000 });
      const saved = (await readRowsAsServiceRole('monthly_prescription_reports', { eq: { store_id: storeId, year_month: p.rxMonth } }))[0];
      expect(saved).toMatchObject({ regular_prescription_count: 10, chronic_prescription_count: 5 });
      expect(Number(saved.regular_prescription_point_value)).toBe(1.2345);
      expect(Number(saved.total_chronic_prescription_count)).toBe(7.5);
      await expect(rx.getByLabel('檢視')).toBeEnabled();

      // 重新查詢仍是已完成
      await rx.getByRole('button', { name: '查詢處方箋' }).click();
      await rx.getByLabel('搜尋門市').fill(p.primary);
      await expect(rx.locator('tbody tr').filter({ hasText: p.primary })).toContainText('已完成');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await admin.dispose();
  }
});

test('匯入每月獎金：沒有有效資料顯示錯誤；有效檔案匯入後出現在表格', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const p = plan(mobile);
  const code = bonusEmployeeCode(p.tag);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  let storeId = '';
  try {
    const ids = await perfStoreIds(admin);
    storeId = ids[p.primary as 'ZT01' | 'VW001'];
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await openNativePerformance(page);
      await panel(page).getByRole('navigation', { name: '業績子功能' }).getByRole('button', { name: '匯入每月獎金' }).click();
      const b = bonus(page);
      await b.getByLabel('年月').fill(p.bonusMonth);
      await b.getByLabel('門市', { exact: true }).selectOption(''); // 預設是第一間門市；改為全部門市
      await b.getByRole('button', { name: '查詢獎金' }).click();
      await expect(b.getByText('載入獎金…')).toHaveCount(0, { timeout: 30_000 });

      // 沒有有效資料（缺員編）：顯示錯誤，不寫入
      await b.locator('input[type=file]').setInputFiles(file([{ 門市代號: p.primary, 年月: p.bonusMonth, 團體獎金: 100 }], 'bad.xlsx'));
      await b.getByRole('button', { name: '匯入獎金' }).click();
      const dlg = page.getByRole('dialog', { name: '確認匯入每月獎金' });
      await dlg.getByRole('button', { name: '確認匯入' }).click();
      await expect(dlg.getByText(/沒有可匯入的資料/)).toBeVisible({ timeout: 30_000 });
      await dlg.getByRole('button', { name: '取消' }).click();
      expect(await readRowsAsServiceRole('monthly_bonus_records', { eq: { store_id: storeId, year_month: p.bonusMonth } })).toHaveLength(0);

      // 有效檔案
      await b.locator('input[type=file]').setInputFiles(file([{ 員編: code, 姓名: 'W03 E2E', 門市代號: p.primary, 年月: p.bonusMonth, 團體獎金: 5000, 單品獎金: 200 }]));
      await b.getByRole('button', { name: '匯入獎金' }).click();
      await page.getByRole('dialog', { name: '確認匯入每月獎金' }).getByRole('button', { name: '確認匯入' }).click();
      await expect(b.getByRole('status').filter({ hasText: /匯入 1 筆/ })).toBeVisible({ timeout: 60_000 });
      await b.getByLabel('員工代號／姓名').fill(code);
      await b.getByRole('button', { name: '查詢獎金' }).click();
      const row = b.locator('tbody tr').filter({ hasText: code });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('5,000');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await registerPerfRows([storeId]);
    await admin.dispose();
  }
});
