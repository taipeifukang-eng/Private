import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { apiAs, loginAs } from '../support/auth';
import { canonicalWorkbook, seedExportMonth, W02_MONTHS } from '../support/w02-fixtures';
import { noPageOverflow, openNativeExport, pickMonth, readStats, readStoreRows, visibleExportButtons } from '../support/w02-ui';
import { exportFileName, type ExportKey } from '../../lib/workspace/monthly-export';

// W02 e2e：桌機 1440 與手機 390 各跑完整主流程。
//  1. 有 monthly.export.download 的帳號（admin）：選月份 → 預設只勾可匯出門市 → 預覽名冊 → 九個下載逐一成功、檔名照舊版、內容非空 → 取消勾選後檔名門市數同步 → 全選／取消全選。
//  2. 只有單品獎金權限的帳號（ops_assistant）：頁面只顯示單品獎金按鈕，且可下載。
//  3. 伺服器拒絕（W02-q3 的 400）時畫面顯示清楚的錯誤訊息。
// 資料：ZT03（草稿）、ZT04（已送審）、ZT05（已確認），保留月份 2099-03（桌機）／2099-04（手機），sweeper 清除。

async function download(page: Page, key: string, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator(`[data-export="${key}"]`).click()]);
  expect(dl.suggestedFilename()).toBe(name);
  const file = await dl.path();
  const buf = fs.readFileSync(file);
  expect(buf.length).toBeGreaterThan(1000);
  return canonicalWorkbook(buf);
}

test('資料匯出：九種下載、名冊預覽、全選', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? W02_MONTHS.e2eMobile : W02_MONTHS.e2eDesktop;
  const admin = await apiAs('admin');
  try {
    await seedExportMonth(admin, month);
  } finally {
    await admin.dispose();
  }
  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openNativeExport(page);
    await pickMonth(page, month);

    // 預設只勾可匯出門市；草稿門市不可勾。
    let rows = await readStoreRows(page);
    const by = () => Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by().ZT03).toMatchObject({ status: 'pending', checked: false, disabled: true });
    expect(by().ZT04.checked && by().ZT05.checked).toBe(true);
    const stats = await readStats(page);
    expect(Number(stats.selected)).toBe(Number(stats.exportable));

    // 預覽名冊：ZT04、ZT05 共 6 人（含調出、調入各一）。
    await page.locator('[data-export="roster-preview"]').click();
    await expect(page.locator('.export-roster-table tbody tr').first()).toBeVisible();
    // 其他工作項（W01a／W01b）可能在同月份留有 ZT01／ZT02 的資料，所以只檢查 ZT04、ZT05 的 6 人都在。
    const rosterText = await page.locator('.export-roster-table tbody').innerText();
    expect((rosterText.match(/ZT04|ZT05/g) || []).length).toBe(6);
    expect(rosterText).toContain('W02 調出專員');
    expect(rosterText).toContain('W02 調入專員');
    expect(await page.locator('.export-roster-table .sticky-name').first().evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

    // 九種下載
    const n = Number(stats.selected);
    const files: [string, ExportKey][] = [
      ['download', 'download'],
      ['actual-staff-points', 'actual-staff-points'],
      ['roster', 'roster'],
      ['transport', 'transport'],
      ['single-item-bonus', 'single-item-bonus'],
      ['talent-cultivation-bonus', 'talent-cultivation-bonus'],
      ['meal-allowance', 'meal-allowance'],
      ['spring-festival-bonus', 'spring-festival-bonus'],
      ['support-hours', 'support-hours'],
    ];
    for (const [button, key] of files) {
      const wb = await download(page, button, exportFileName(key, month, n));
      expect(wb.sheets.length, key).toBeGreaterThan(0);
      expect(wb.sheets[0].rowCount, key).toBeGreaterThanOrEqual(2);
    }

    // 取消勾選 ZT05 → 檔名的門市數同步變 n-1，已選擇統計同步
    await page.locator('li[data-store="ZT05"] input').uncheck();
    expect(Number((await readStats(page)).selected)).toBe(n - 1);
    await download(page, 'download', exportFileName('download', month, n - 1));

    // 全選只勾可匯出門市（W02 白名單 w02-select-all-exportable-only）；取消全選後下載按鈕停用。
    await page.locator('[data-export-toggle-all]').click();
    rows = await readStoreRows(page);
    expect(rows.filter((r) => r.checked).map((r) => r.status).every((s) => s !== 'pending')).toBe(true);
    expect(by().ZT03.checked).toBe(false);
    await page.locator('[data-export-toggle-all]').click();
    expect(Number((await readStats(page)).selected)).toBe(0);
    await expect(page.locator('[data-export="download"]')).toBeDisabled();
    await expect(page.locator('[data-export="support-hours"]')).toBeEnabled(); // 支援時數一律全部門市

    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
    // 1080P 畫面留存（供回報截圖）
    if (!mobile) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.locator('[data-export-toggle-all]').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath('monthly-export-1080p.png') });
    }
  } finally {
    await ctx.close();
  }
});

test('資料匯出：只有單品獎金權限的帳號只看到單品獎金按鈕', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? W02_MONTHS.e2eMobile : W02_MONTHS.e2eDesktop;
  const admin = await apiAs('admin');
  try {
    await seedExportMonth(admin, month);
  } finally {
    await admin.dispose();
  }
  const ctx = await loginAs(browser, 'ops_assistant');
  try {
    const page = await ctx.newPage();
    await openNativeExport(page);
    await pickMonth(page, month);
    expect(await visibleExportButtons(page)).toEqual(['single-item-bonus']);
    await expect(page.locator('[data-export-roster]')).toHaveCount(0); // 名冊區塊屬一般匯出
    // DEV 角色帳號的資料列可見範圍由 RLS 決定（與舊版相同）；看得到可匯出門市才實際下載，否則按鈕必須停用。
    const n = Number((await readStats(page)).selected);
    test.info().annotations.push({ type: 'visible-exportable-stores', description: String(n) });
    if (n > 0) {
      const wb = await download(page, 'single-item-bonus', exportFileName('single-item-bonus', month, n));
      expect(wb.sheetNames).toEqual(['單品獎金']);
    } else {
      await expect(page.locator('[data-export="single-item-bonus"]')).toBeDisabled();
    }
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('資料匯出：伺服器回 400 時畫面顯示清楚的錯誤訊息', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? W02_MONTHS.e2eMobile : W02_MONTHS.e2eDesktop;
  const admin = await apiAs('admin');
  try {
    await seedExportMonth(admin, month);
  } finally {
    await admin.dispose();
  }
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await openNativeExport(page);
    await pickMonth(page, month);
    await page.route('**/api/workspace/monthly-export/transport', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '以下門市尚未提交，無法匯出：ZT03 ZT 測試門市 03', unsubmitted: [] }) }),
    );
    await page.locator('[data-export="transport"]').click();
    await expect(page.locator('[data-export-error]')).toContainText('以下門市尚未提交，無法匯出');
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});
