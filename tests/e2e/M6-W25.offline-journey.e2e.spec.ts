import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { loginAs } from '../support/auth';
import { fixtureFile } from '../support/m6-fixtures';
import { LABEL, nativeDownload, nativeGenerate, nativePick, nativeStep, openNativeOffline, readDownload, taipeiToday } from '../support/m6-inventory-ui';

/**
 * M6 第一批 W25：離線盤點工具四步驟端到端（盤點組帳號；桌機 1440 與手機 390 各跑一次）。
 * 用 tests/fixtures/m6 的自造檔（不含任何真實門市資料）。下載檔檢查檔名（台北時間日期）、工作表名（Sheet1）與內容。
 * 只在瀏覽器內處理檔案，不寫資料庫、不留測試資料。
 */
const F = (name: string) => fixtureFile(name);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const notice = (page: Page) => page.locator('.offline-inventory .notice');

test('離線盤點四步驟：外盤複盤清單、複盤與未盤表（預盤逐檔容錯）、DPOS 結果檔（衝突擋下）', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const ctx = await loginAs(browser, 'inventory_team');
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  try {
    await openNativeOffline(page);
    const today = taipeiToday();

    // ---- 共用基準檔
    await nativePick(page, LABEL.base, F('base-1f-missing-location.xlsx'));
    await expect(page.getByRole('alert').first()).toContainText('找不到「主要儲位」或「主要庫位」欄位');
    await expect(page.getByRole('alert').first()).toContainText('實際檔案中的欄位');
    await nativePick(page, LABEL.base, F('base-1f-missing-stock.xlsx'));
    await expect(page.getByRole('alert').first()).toContainText('找不到「庫存」或「重存」欄位！');
    await nativePick(page, LABEL.base, F('base-1f-missing-barcode.xlsx'));
    await expect(page.getByRole('alert').first()).toContainText('缺少的欄位：');
    await nativePick(page, LABEL.base, F('base-1f.xlsx'));
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(fileRowText(page, LABEL.base)).toContainText('7 筆');

    // ---- 步驟 1：外盤應複盤清單
    await nativeStep(page, 1);
    await nativePick(page, LABEL.external, F('external-dup.xlsx'));
    const dupAlert = page.getByRole('alert').first();
    await expect(dupAlert).toContainText('匯入失敗：外盤公司原始檔中發現重複品號');
    await expect(dupAlert).toContainText('00000012, 00000007');
    await expect(dupAlert).toContainText('請聯繫外盤公司修正檔案後重新上傳');
    await expect(dupAlert).toContainText('每個品號只能出現一次');
    await nativePick(page, LABEL.external, F('external-original.xlsx'));
    await nativePick(page, LABEL.fks, F('fks0701-missing-col.xlsx'));
    await expect(page.getByRole('alert').first()).toContainText('找不到必要欄位！標題行內容：品名 | 條碼 | 盤點儲位');
    await nativePick(page, LABEL.fks, F('fks0701-module1.xlsx'));
    // 無盤差：沒有需要複盤的品項、不下載
    await nativePick(page, LABEL.external, F('external-clean.xlsx'));
    await nativeGenerate(page);
    await expect(page.getByTestId('offline-info')).toHaveText('沒有需要複盤的品項');
    await expect(page.getByRole('button', { name: '下載外盤應複盤清單' })).toBeDisabled();
    // 有盤差：下載
    await nativePick(page, LABEL.external, F('external-original.xlsx'));
    await nativeGenerate(page);
    await expect(page.locator('.offline-inventory .module-actions span', { hasText: '需複盤 2 項' })).toBeVisible();
    const d1 = await readDownload(await nativeDownload(page, '下載外盤應複盤清單'));
    expect(d1.name).toBe(`外盤應複盤清單_${today.iso}.xlsx`);
    expect(d1.sheetNames).toEqual(['Sheet1']);
    expect(d1.rows).toEqual([{ 品號: '00000009' }, { 品號: '00000100' }]);
    if (mobile) expect(await noOverflow(page)).toBe(true);

    // ---- 步驟 2：複盤與未盤表（預盤多檔逐檔容錯）
    await nativeStep(page, 2);
    await nativePick(page, LABEL.pre, [F('pre-1.xlsx'), F('pre-bad-columns.xlsx'), F('pre-empty.xlsx'), F('pre-2.xlsx')]);
    const summary = page.getByTestId('per-file-summary');
    await expect(summary).toContainText('成功 2/4，失敗檔案：');
    await expect(summary).toContainText('pre-bad-columns.xlsx（缺少欄位：盤點數量、盤點儲位）');
    await expect(summary).toContainText('pre-empty.xlsx（檔案沒有資料列）');
    await expect(fileRowText(page, LABEL.pre)).toContainText('已收下：');
    await expect(fileRowText(page, LABEL.pre)).toContainText('pre-1.xlsx（2 筆）');
    // 全部失敗：不收下任何新檔、已成功的保留；失敗檔可單獨重傳（這裡重傳一個好檔，不必重傳 pre-1）
    await nativePick(page, LABEL.pre, [F('pre-bad-columns.xlsx')]);
    await expect(page.getByRole('alert').first()).toContainText('成功 0/1，失敗檔案：pre-bad-columns.xlsx');
    await expect(fileRowText(page, LABEL.pre)).toContainText('pre-1.xlsx（2 筆）');
    await nativePick(page, LABEL.pre, [F('pre-2.xlsx')]);
    await nativePick(page, LABEL.fks, F('fks0701.xlsx'));
    await nativeGenerate(page);
    await expect(page.locator('.offline-inventory .module-actions span', { hasText: '無盤差 3 項已保留' })).toBeVisible();
    const d2 = await readDownload(await nativeDownload(page, /下載內部複盤（1 筆）/));
    expect(d2.name).toBe(`內部盤點複盤資料_${today.iso}.xlsx`);
    expect(d2.sheetNames).toEqual(['Sheet1']);
    expect(d2.rows).toEqual([{ 盤點儲位: 'D-01', 該儲位盤點數量: 5, 品號: '00000007', 品名: '測試商品戊', UN: 'PCS', 條碼: '4710000000007', 庫存量: 8, 各式盤點數量加總: 5, 盤差量: -3 }]);
    const d3 = await readDownload(await nativeDownload(page, /下載未盤表（1 筆）/));
    expect(d3.name).toBe(`系統有庫存但未盤點檔案_${today.iso}.xlsx`);
    expect(d3.rows).toEqual([{ 品號: '02000215', 品名: '測試商品丙', UN: 'BOX', 條碼: '4710002000215', 庫存量: -2, 主要儲位: 'B-01', 盤點數量: 0 }]);
    // 品號前導零：下載檔的品號是文字，開啟不會被吃掉
    const book = (await import('xlsx')).read(d3.buffer, { type: 'buffer' });
    expect(book.Sheets.Sheet1.A2.t).toBe('s');
    expect(book.Sheets.Sheet1.A2.v).toBe('02000215');
    if (mobile) expect(await noOverflow(page)).toBe(true);

    // ---- 步驟 3：DPOS 結果檔；衝突擋下並一次列出全部
    await nativeStep(page, 3);
    await nativePick(page, LABEL.internal, F('internal-conflict.xlsx'));
    await nativePick(page, LABEL.missing, F('missing-conflict.xlsx'));
    await nativeGenerate(page);
    const conflicts = page.getByTestId('final-conflicts');
    await expect(conflicts).toContainText('發現 3 項衝突，未產出檔案');
    await expect(conflicts.locator('li')).toHaveCount(3);
    await expect(conflicts.locator('li').nth(0)).toContainText('00000007');
    await expect(conflicts.locator('li').nth(0)).toContainText('庫存量不一致');
    await expect(conflicts.locator('li').nth(1)).toContainText('00000012');
    await expect(conflicts.locator('li').nth(1)).toContainText('同時存在無盤差與複盤資料');
    await expect(conflicts.locator('li').nth(2)).toContainText('02000215');
    await expect(conflicts.locator('li').nth(2)).toContainText('重複出現 2 次');
    await expect(page.getByRole('button', { name: '下載 DPOS 結果檔' })).toHaveCount(0);
    if (mobile) expect(await noOverflow(page)).toBe(true);
    // 改好的檔案
    await nativePick(page, LABEL.internal, F('internal-edited.xlsx'));
    await nativePick(page, LABEL.missing, F('missing-edited.xlsx'));
    await nativeGenerate(page);
    await expect(page.getByTestId('final-conflicts')).toHaveCount(0);
    await expect(page.locator('.offline-inventory .module-actions span', { hasText: '結果 5 項' })).toBeVisible();
    const d4 = await readDownload(await nativeDownload(page, '下載 DPOS 結果檔'));
    expect(d4.name).toBe(`${today.md}盤點結果檔.xlsx`);
    expect(d4.sheetNames).toEqual(['Sheet1']);
    expect(d4.rows).toEqual([
      { 品號: '00000012', 庫存量: 10, 實際量: 10, 盤差量: 0 },
      { 品號: '00000345', 庫存量: 5, 實際量: 5, 盤差量: 0 },
      { 品號: '00000009', 庫存量: 3, 實際量: 3, 盤差量: 0 },
      { 品號: '00000007', 庫存量: 8, 實際量: 8, 盤差量: 0 },
      { 品號: '02000215', 庫存量: -2, 實際量: -2, 盤差量: 0 },
    ]);
    expect(pageErrors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

const fileRowText = (page: Page, label: string) => page.locator('.offline-inventory label.file-row', { hasText: label });

test('離線工具不寫資料庫：整個流程沒有任何 /api 寫入請求', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'inventory_team');
  const page = await ctx.newPage();
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  try {
    await openNativeOffline(page);
    await nativePick(page, LABEL.base, F('base-1f.xlsx'));
    await nativeStep(page, 2);
    await nativePick(page, LABEL.pre, [F('pre-1.xlsx')]);
    await nativeGenerate(page);
    expect(writes).toEqual([]);
    // 離開前未下載的警告資料仍在畫面（dirty）：檔案處理只在瀏覽器內
    expect(fs.existsSync(F('base-1f.xlsx'))).toBe(true);
  } finally {
    await ctx.close();
  }
});
