import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { W03_YEAR } from '../support/w03-fixtures';
import { noPageOverflow, openNativePerformance, panel } from '../support/w03-ui';
import { rxFile, rxSheetBuffer } from '../support/rx-helpers';

// W03 追加冒煙層：處方箋 Google Sheet 匯入。桌機 1440 與手機 390（project viewport）。
// 有編輯權限者：上傳 Google Sheet xlsx 會開出匯入預覽（不寫入，取消即可）；只有查看權限者：看不到匯入表單，對照表唯讀。
// 沒有 pageerror／console error、沒有頁面層級水平溢出。只讀，不寫資料。

const MONTH = `${W03_YEAR}-10`;

for (const role of ['admin', 'performance_view']) {
  test(`處方箋匯入冒煙 ${role}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const canEdit = role === 'admin';
    const ctx = await loginAs(browser, role);
    const errors: string[] = [];
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await openNativePerformance(page);
      await panel(page).getByRole('navigation', { name: '業績子功能' }).getByRole('button', { name: '處方箋' }).click();
      const rx = panel(page).getByRole('region', { name: '處方箋' });
      await expect(rx.getByRole('button', { name: '查詢處方箋' })).toBeVisible({ timeout: 30_000 });
      await rx.getByLabel('檢視').selectOption('month');
      await rx.getByLabel('月份').fill(MONTH);
      await rx.getByRole('button', { name: '查詢處方箋' }).click();

      const aliases = rx.getByRole('region', { name: '門市簡稱對照表' });
      await expect(aliases).toBeVisible({ timeout: 30_000 });
      await aliases.getByRole('button', { name: /門市簡稱對照表/ }).click();
      await expect(aliases.getByRole('table')).toBeVisible();
      await expect(aliases.getByRole('button', { name: '新增簡稱' })).toHaveCount(canEdit ? 1 : 0);

      if (canEdit) {
        await expect(rx.getByRole('button', { name: '預覽匯入' })).toBeDisabled();
        await rx.locator('input[type=file]').setInputFiles(rxFile(rxSheetBuffer()));
        await rx.getByRole('button', { name: '預覽匯入' }).click();
        const dialog = page.getByRole('dialog', { name: '匯入預覽' });
        await expect(dialog).toBeVisible({ timeout: 30_000 });
        await expect(dialog.locator('[data-preview-row]')).toHaveCount(4);
        await expect(dialog.locator('tr.rx-mismatch')).toHaveCount(1); // 加總不符的那家標黃
        await expect(dialog.getByRole('button', { name: /還有 \d+ 間未選門市/ })).toBeDisabled();
        expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
        await dialog.getByRole('button', { name: '取消' }).click();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(rx.getByRole('button', { name: '預覽匯入' })).toHaveCount(0);
      }
      await page.waitForLoadState('networkidle');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
