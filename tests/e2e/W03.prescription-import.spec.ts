import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { perfStoreIds } from '../support/w03-fixtures';
import { noPageOverflow, openNativePerformance, panel } from '../support/w03-ui';
import { rxClearAliases, rxFile, rxSheetBuffer } from '../support/rx-helpers';

// W03 追加 e2e：處方箋 Google Sheet 匯入完整路徑（桌機 1440 與手機 390 各跑一次，2038 年不同月份避免互相覆蓋，sweeper 清除）。
//  上傳 → 預覽（標黃提醒、待選門市）→ 選門市 → 確認匯入 → 回讀月報與簡稱對照 →
//  對照表在畫面上修改與刪除 → 再上傳同一份檔，簡稱已自動對上（不用再選）。

// 月份避開其他 W03 測試與整合層（整合層用 2038-10）；檔案內的月份標題桌機寫「十一月」、手機寫「12月」，兩種寫法都要認得。
function plan(mobile: boolean) {
  return mobile ? { month: '2038-12', label: '12月' } : { month: '2038-11', label: '十一月' };
}

test('處方箋 Google Sheet 匯入：預覽、選門市、確認匯入、對照表修改與刪除', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const p = plan(mobile);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  try {
    const ids = await perfStoreIds(admin);
    await rxClearAliases(admin);
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      // 「找不到月份」那一步會刻意收到 400，瀏覽器會把它記成資源載入失敗，不算錯誤。
      page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && errors.push(m.text()));
      await openNativePerformance(page);
      await panel(page).getByRole('navigation', { name: '業績子功能' }).getByRole('button', { name: '處方箋' }).click();
      const rx = panel(page).getByRole('region', { name: '處方箋' });
      await expect(rx.getByRole('button', { name: '查詢處方箋' })).toBeVisible({ timeout: 30_000 });
      await rx.getByLabel('檢視').selectOption('month');
      await rx.getByLabel('月份').fill('2038-02');
      await rx.getByRole('button', { name: '查詢處方箋' }).click();
      await expect(rx.getByRole('button', { name: '預覽匯入' })).toBeVisible({ timeout: 30_000 });

      // 上傳 → 預覽：四家（兩家自動對上、一家多候選、一家找不到），其中一家加總不符標黃；預覽不寫資料
      const buffer = rxSheetBuffer(p.label);
      // 先選一個檔案裡沒有的月份（2038-02），確認「找不到月份」會清楚報錯並列出檔案內有的月份
      await rx.locator('input[type=file]').setInputFiles(rxFile(buffer));
      await rx.getByRole('button', { name: '預覽匯入' }).click();
      await expect(rx.getByRole('alert').filter({ hasText: '找不到' })).toContainText(`九月、${p.label}`);
      await expect(page.getByRole('dialog', { name: '匯入預覽' })).toHaveCount(0);

      // 改選檔案裡有的月份後預覽成功
      await rx.getByLabel('月份').fill(p.month);
      await rx.getByRole('button', { name: '查詢處方箋' }).click();
      await expect(rx.getByRole('button', { name: '預覽匯入' })).toBeVisible({ timeout: 30_000 });
      await rx.locator('input[type=file]').setInputFiles(rxFile(buffer));
      await rx.getByRole('button', { name: '預覽匯入' }).click();
      const dialog = page.getByRole('dialog', { name: '匯入預覽' });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(dialog.locator('[data-preview-row]')).toHaveCount(4);
      await expect(dialog.locator('tr[data-status="auto"]')).toHaveCount(2);
      await expect(dialog.locator('tr.rx-mismatch')).toHaveCount(1);
      await expect(dialog.locator('tr.rx-mismatch')).toContainText('加總列是 151');
      await expect(dialog.locator('tr.rx-pending')).toHaveCount(2);
      await expect(dialog.getByRole('button', { name: '還有 2 間未選門市' })).toBeDisabled();
      expect(await readRowsAsServiceRole('monthly_prescription_reports', { eq: { year_month: p.month }, in: { store_id: [ids.VW001, ids.ZT01, ids.ZT02, ids.ZT03] } })).toHaveLength(0);

      // 選門市：「測試」→ ZT02、「義一」→ ZT03
      await dialog.getByLabel('測試 對應的門市').selectOption(ids.ZT02);
      await dialog.getByLabel('義一 對應的門市').selectOption(ids.ZT03);
      const confirm = dialog.getByRole('button', { name: '確認匯入 4 間' });
      await expect(confirm).toBeEnabled();
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      await confirm.click();
      await expect(rx.getByRole('status').filter({ hasText: '已匯入 4 間門市' })).toBeVisible({ timeout: 30_000 });
      await expect(rx.getByRole('status').filter({ hasText: '已把 2 個簡稱存進對照表' })).toBeVisible();
      await expect(dialog).toHaveCount(0);

      const saved = Object.fromEntries((await readRowsAsServiceRole('monthly_prescription_reports', { eq: { year_month: p.month }, in: { store_id: [ids.VW001, ids.ZT01, ids.ZT02, ids.ZT03] } })).map((r) => [r.store_id as string, r]));
      expect(saved[ids.VW001]).toMatchObject({ regular_prescription_count: 1200, chronic_prescription_count: 550 });
      expect(Number(saved[ids.ZT01].regular_prescription_point_value)).toBe(300.5);
      expect(saved[ids.ZT02]).toMatchObject({ regular_prescription_count: 10 });
      expect(saved[ids.ZT03]).toMatchObject({ chronic_prescription_count: 6 });

      // 對照表：畫面上看得到剛存的兩個簡稱；修改「義一」改指 ZT04；刪除「測試」
      const aliases = rx.getByRole('region', { name: '門市簡稱對照表' });
      await aliases.getByRole('button', { name: /門市簡稱對照表/ }).click();
      await expect(aliases.locator('[data-alias-row]')).toHaveCount(2);
      await aliases.getByRole('button', { name: '修改簡稱 義一' }).click();
      await aliases.getByLabel('修改對應門市').selectOption(ids.ZT04);
      await aliases.getByRole('button', { name: '儲存簡稱' }).click();
      await expect(aliases.locator('[data-alias-row]').filter({ hasText: '義一' })).toContainText('ZT04');
      const rows = await readRowsAsServiceRole('prescription_store_aliases', { in: { store_id: [ids.ZT02, ids.ZT03, ids.ZT04] } });
      expect(Object.fromEntries(rows.map((r) => [r.alias as string, r.store_id]))).toEqual({ 測試: ids.ZT02, 義一: ids.ZT04 });
      page.once('dialog', (d) => void d.accept());
      await aliases.getByRole('button', { name: '刪除簡稱 測試' }).click();
      await expect(aliases.locator('[data-alias-row]')).toHaveCount(1);

      // 再上傳同一份檔：「義一」靠對照表自動對上；「測試」被刪掉，要再選
      await rx.locator('input[type=file]').setInputFiles(rxFile(buffer));
      await rx.getByRole('button', { name: '預覽匯入' }).click();
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(dialog.locator('tr[data-status="mapped"]')).toHaveCount(1);
      await expect(dialog.locator('tr[data-status="mapped"]')).toContainText('義一');
      await expect(dialog.locator('tr.rx-pending')).toHaveCount(1);
      await dialog.getByRole('button', { name: '取消' }).click();
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await rxClearAliases(admin);
    await admin.dispose();
  }
});
