import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage, workPanel } from '../support/w05-fixtures';
import { W06_MONTHS, historyOf, insertHistory, masterOf, purgeReceipts, purgeW06, registerW06, seedMaster, w06Code, w06StoreIds } from '../support/w06-fixtures';

// W06 C 組端到端（桌機 1440、手機 390）：人員異動管理 → 查看歷史紀錄。
// 有權限者看到「修改」「刪除」；非最新一筆的刪除停用並說明；刪除前有確認視窗；修改後列表更新；
// 沒有權限的角色（員工管理檢視）看不到歷史頁。資料用測試員編 FKF7xxxx 與保留月份 2099-07，測後清除。

const { m1 } = W06_MONTHS;

async function openHistory(page: Page) {
  await openNativePage(page, '人員異動管理');
  await page.getByRole('button', { name: '查看歷史紀錄' }).click();
  const p = workPanel(page);
  await p.getByLabel('生效月份').fill(m1);
  await p.getByRole('button', { name: '查詢紀錄' }).click();
  await expect(p.getByText(/共 \d+ 筆/)).toBeVisible({ timeout: 30_000 });
  return p;
}

test('歷史異動頁：修改、刪除（只限最新一筆）與確認視窗', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const code = w06Code('FKF', mobile ? 65 : 60);
  const storeCode = mobile ? 'ZT02' : 'ZT01';
  const started = new Date().toISOString();
  const admin: APIRequestContext = await apiAs('admin');
  const ctx = await loginAs(browser, 'admin');
  let store = '';
  try {
    store = (await w06StoreIds(admin, m1))[storeCode];
    await purgeW06([code], [store]);
    await seedMaster(code, 'E2E 歷史', store);
    const first = await insertHistory({ code, name: 'E2E 歷史', store, type: 'pass_probation', date: `${m1}-03`, old: '專員', new: '專員', notes: '第一筆' });
    const last = await insertHistory({ code, name: 'E2E 歷史', store, type: 'leave_without_pay', date: `${m1}-20`, notes: '第二筆' });
    expect(first && last).toBeTruthy();

    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    const p = await openHistory(page);
    const rowOf = (note: string) => p.locator('tbody tr', { hasText: code }).filter({ hasText: note });

    // 非最新一筆：刪除停用並說明；最新一筆可刪
    await expect(rowOf('第一筆').getByTestId('movement-delete')).toBeDisabled();
    await expect(rowOf('第一筆').getByTestId('movement-delete-hint')).toContainText('請先刪除較新的一筆');
    await expect(rowOf('第二筆').getByTestId('movement-delete')).toBeEnabled();
    await expect(rowOf('第二筆').getByTestId('movement-delete-hint')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    // 手機：操作欄固定在右側，不必橫向捲動就看得到修改／刪除；篩選區單欄堆疊、控制項左側對齊
    const view = page.viewportSize()!;
    const editBox = await rowOf('第二筆').getByTestId('movement-edit').boundingBox();
    expect(editBox!.x + editBox!.width, '修改按鈕在第一屏內').toBeLessThanOrEqual(view.width + 1);
    if (mobile) {
      await expect(p.locator('.swipe-hint')).toBeVisible();
      const lefts = await p.locator('.filters').locator('label, button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(new Set(lefts).size, '篩選區單欄對齊：' + lefts.join(',')).toBe(1);
    }

    // 修改：姓名與備註，儲存後列表更新、主檔同步
    await rowOf('第一筆').getByTestId('movement-edit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('類型與門市不可修改');
    await dialog.getByLabel('姓名').fill('E2E 歷史改名');
    await dialog.getByLabel('備註').fill('第一筆已修改');
    await dialog.getByTestId('movement-edit-save').click();
    await expect(page.getByTestId('movement-notice')).toContainText('已更新');
    await expect(rowOf('第一筆已修改')).toContainText('E2E 歷史改名');
    expect((await masterOf(code))[0].employee_name).toBe('E2E 歷史改名');

    // 刪除前確認：先「保留」，資料不變；再確認刪除
    await rowOf('第二筆').getByTestId('movement-delete').click();
    await expect(page.getByRole('dialog')).toContainText('刪除後會恢復員工主檔');
    if (process.env.W06_SCREENSHOT_DIR) {
      const dir = process.env.W06_SCREENSHOT_DIR;
      fs.mkdirSync(dir, { recursive: true });
      if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(dir, mobile ? 'w06-c-delete-confirm-390.png' : 'w06-c-delete-confirm-1920x1080.png') });
      if (!mobile) await applyProjectViewport(page, testInfo);
    }
    await page.getByRole('dialog').getByRole('button', { name: '保留' }).click();
    expect(await historyOf(code)).toHaveLength(2);
    await rowOf('第二筆').getByTestId('movement-delete').click();
    await page.getByTestId('movement-delete-confirm').click();
    await expect(page.getByTestId('movement-notice')).toContainText('已刪除');
    await expect(rowOf('第二筆')).toHaveCount(0);
    expect(await historyOf(code)).toHaveLength(1);
    // 刪除後，原本較舊的一筆變成最新，可以刪除
    await expect(rowOf('第一筆已修改').getByTestId('movement-delete')).toBeEnabled();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
    await registerW06([code]).catch(() => undefined);
    await purgeW06([code], store ? [store] : []).catch(() => undefined);
    await purgeReceipts(started, store ? [store] : []).catch(() => undefined);
    await admin.dispose();
  }
});

test('沒有異動權限的角色看不到歷史紀錄頁，也沒有修改、刪除入口', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'employee_edit');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    const session = await page.evaluate(async () => (await fetch('/api/workspace/session', { credentials: 'same-origin' })).json());
    expect(session.capabilities.movementHistory).toBe(false);
    const res = await page.evaluate(async () => (await fetch('/api/workspace/employee-movements?month=2099-07', { credentials: 'same-origin' })).status);
    expect(res).toBe(403);
    expect(errors.filter((e) => !/403/.test(e)), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
