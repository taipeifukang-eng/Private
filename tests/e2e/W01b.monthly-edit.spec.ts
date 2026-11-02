import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { addManual, editUpdates, ensureSummarySafe, openNativeEditor, postSave, readMonth, registerFixtureRows, runIdOrThrow, staffCode, testStoreIds, W01B_MONTHS } from '../support/w01b-fixtures';

// W01b e2e：桌機 1440 與手機 390 各跑完整主流程（保留月份 2099-09 桌機、2099-10 手機，ZT 測試門市，sweeper 清除）。
//  1. 新人編輯：新人升階提醒（不阻擋儲存、否 / 是）、不滿月提示且不自動改狀態、區塊預覽即時變化、外務時數自動換算、天數滿月自動整月。
//  2. 滿 6 個月提醒改走人員異動紀錄（不改職位）、行政階段必填、督導卡班關閉清空、兩個分頁同時編輯的衝突提示。

const STORE_LABEL = 'ZT01 ZT 測試門市 01';
const ed = (page: Page) => page.locator('section.work-page:visible');

async function dbRow(id: string) {
  return (await readRowsAsServiceRole('monthly_staff_status', { eq: { id } }))[0];
}

async function backToList(page: Page) {
  await page.getByRole('tab', { name: /人員狀態/ }).click();
  // 其他分頁的「已儲存」role=status 仍留在 DOM，不能用它判斷載入完成；改等名冊 API 回應。
  await Promise.all([
    page.waitForResponse((r) => /\/api\/workspace\/monthly\?/.test(r.url()) && r.request().method() === 'GET' && r.status() === 200, { timeout: 30_000 }),
    ed(page).getByRole('button', { name: '查詢人員' }).click(),
  ]);
}

async function openRow(page: Page, code: string) {
  await backToList(page);
  const row = ed(page).locator(`tr[data-staff="${code}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /編輯出勤/ }).click();
  await expect(ed(page).locator('form.module-editor')).toBeVisible({ timeout: 30_000 });
}

test('新人編輯與區塊預覽：提醒不阻擋儲存、不滿月不自動改狀態、外務自動換算', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? W01B_MONTHS.e2eMobile : W01B_MONTHS.e2eDesktop;
  const totalDays = mobile ? 31 : 30;
  const hired = mobile ? '2099-09-10' : '2099-08-10'; // 月份前 1 個月
  const admin: APIRequestContext = await apiAs('admin');
  const errors: string[] = [];
  try {
    const stores = await testStoreIds(admin, month);
    const code = staffCode('B');
    const created = await addManual(admin, stores.ZT01, month, { name: 'E2E 新人', code, position: '新人', newbie_level: '未過階新人', work_days: totalDays });
    await ensureSummarySafe(admin, stores.ZT01, month);
    await registerFixtureRows(stores.ZT01, month);
    const rec = (await readMonth(admin, stores.ZT01, month)).body.records.find((r: any) => r.id === created.id);
    expect((await postSave(admin, stores.ZT01, month, created.id, rec.updated_at, editUpdates({ position: '新人', newbie_level: '未過階新人', start_date: hired, work_days: totalDays }))).status()).toBe(200);

    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openNativeEditor(page, STORE_LABEL, month, code);
      const panel = ed(page);
      const preview = panel.locator('[data-block-preview]');
      const status = panel.locator('[name=monthly_status]');
      const days = panel.locator('[name=work_days]');

      // 升階提醒（畫面上先看到，不阻擋）、區塊預覽 1
      await expect(panel.locator('[data-newbie-reminder]')).toContainText('此新人應該過一階段，是否要改成一階新人？');
      await expect(preview).toContainText('區塊 1');
      await expect(preview).toContainText('正職整月');

      // 天數不滿月：提示請確認本月狀態、列出原因；狀態不會被自動改成新進
      await days.fill('20');
      const hint = panel.locator('[data-partial-hint]');
      await expect(hint).toContainText('請確認本月狀態');
      await expect(hint).toContainText('新進、調店、留職停薪、復職、離職');
      await expect(status).toHaveValue('full_month');
      await expect(preview).toContainText('區塊 1');

      // 區塊預覽即時變化：新進 → 區塊 3；勾外務 → 區塊 4，規劃時數 20/5×32 = 128
      await status.selectOption('new_hire');
      await expect(preview).toContainText('區塊 3');
      await panel.getByLabel('長照外務').check();
      await expect(preview).toContainText('區塊 4');
      await expect(panel.locator('[data-planned-hours]')).toHaveValue('128');
      await panel.locator('[name=extra_task_external_hours]').fill('6');

      // 天數剛好滿月 → 自動設為整月在職，提示消失，規劃時數 160；再改回 20 天、新進
      await days.fill(String(totalDays));
      await expect(status).toHaveValue('full_month');
      await expect(hint).toHaveCount(0);
      await expect(panel.locator('[data-planned-hours]')).toHaveValue('160');
      await days.fill('20');
      await status.selectOption('new_hire');
      await expect(panel.locator('[data-planned-hours]')).toHaveValue('128');

      // 儲存：跳出新人階段提醒，答「否」仍然儲存（不阻擋）
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      const dialog = page.getByRole('dialog', { name: '新人階段提醒' });
      await expect(dialog).toContainText('此新人應該過一階段');
      await expect(dialog).toContainText('不論選擇哪一項，都會繼續儲存');
      await dialog.getByRole('button', { name: '否，維持原樣並儲存' }).click();
      await expect(panel.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      let row = await dbRow(created.id);
      expect(row).toMatchObject({ newbie_level: '未過階新人', monthly_status: 'new_hire', work_days: 20, calculated_block: 4, extra_task_planned_hours: 128, extra_task_external_hours: 6, position: '新人' });

      // 再存一次，這次答「是」→ 套用一階新人
      await panel.locator('[name=notes]').fill('E2E 第二次儲存');
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      await page.getByRole('dialog', { name: '新人階段提醒' }).getByRole('button', { name: '是，改成一階新人並儲存' }).click();
      await expect(panel.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      row = await dbRow(created.id);
      expect(row).toMatchObject({ newbie_level: '一階新人', notes: 'E2E 第二次儲存' });
      await expect(panel.locator('[data-newbie-reminder]')).toHaveCount(0);

      // 回到列表：區塊標籤已更新
      await backToList(page);
      await expect(ed(page).locator(`tr[data-staff="${code}"]`)).toContainText('區塊 4');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '頁面層級水平溢出').toBeLessThanOrEqual(0);
    } finally {
      await ctx.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await admin.dispose();
  }
});

test('滿 6 個月改走人員異動紀錄、行政階段必填、督導卡班清空、同時編輯衝突', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? W01B_MONTHS.e2eMobile : W01B_MONTHS.e2eDesktop;
  const admin: APIRequestContext = await apiAs('admin');
  const errors: string[] = [];
  try {
    const stores = await testStoreIds(admin, month);
    const zt01 = stores.ZT01;
    const codes = { six: staffCode('6'), adm: staffCode('A'), rot: staffCode('R'), con: staffCode('C') };
    const six = await addManual(admin, zt01, month, { name: 'E2E 滿六月', code: codes.six, position: '新人', newbie_level: '二階新人' });
    const adm = await addManual(admin, zt01, month, { name: 'E2E 行政', code: codes.adm });
    const rot = await addManual(admin, zt01, month, { name: 'E2E 卡班', code: codes.rot });
    const con = await addManual(admin, zt01, month, { name: 'E2E 衝突', code: codes.con });
    await ensureSummarySafe(admin, zt01, month);
    await registerFixtureRows(zt01, month);
    const { body } = await readMonth(admin, zt01, month);
    const version = (id: string) => body.records.find((r: any) => r.id === id).updated_at as string;
    expect((await postSave(admin, zt01, month, six.id, version(six.id), editUpdates({ position: '新人', newbie_level: '二階新人', start_date: mobile ? '2099-04-05' : '2099-03-05' }))).status()).toBe(200);
    expect((await postSave(admin, zt01, month, rot.id, version(rot.id), editUpdates({ is_supervisor_rotation: true, supervisor_employee_code: 'S001', supervisor_name: 'E2E 督導', supervisor_position: '督導', supervisor_shift_hours: 10 }))).status()).toBe(200);

    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openNativeEditor(page, STORE_LABEL, month, codes.six);
      let panel = ed(page);

      // 滿 6 個月：提示以人員異動紀錄處理，不提供改職位
      const notice = panel.locator('[data-newbie-reminder]');
      await expect(notice).toContainText('升階請以人員異動紀錄處理');
      await expect(panel.locator('[name=position]')).toHaveValue('新人');
      await panel.locator('[name=notes]').fill('E2E 滿六個月備註');
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      const dialog = page.getByRole('dialog', { name: '新人階段提醒' });
      await expect(dialog).toContainText('升階請以人員異動紀錄處理');
      await expect(dialog.getByRole('button', { name: '是，改成' })).toHaveCount(0);
      await dialog.getByRole('button', { name: '知道了，繼續儲存' }).click();
      await expect(panel.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      expect(await dbRow(six.id)).toMatchObject({ position: '新人', notes: 'E2E 滿六個月備註' });
      // 連結：開啟人員異動紀錄分頁
      await notice.getByRole('button', { name: '前往人員異動紀錄' }).click();
      await expect(page.getByRole('tab', { name: /人員異動紀錄/ })).toBeVisible({ timeout: 20_000 });

      // 行政：沒選階段 → 即時錯誤、儲存被擋、DB 不變；選了就可儲存
      await openRow(page, codes.adm);
      panel = ed(page);
      await panel.locator('[name=position]').selectOption('行政');
      await expect(panel.locator('[data-admin-level-error]')).toContainText('請選擇「過階」或「未過階」');
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      await expect(panel.getByRole('alert').filter({ hasText: '請標註「過階」或「未過階」' })).toBeVisible();
      expect((await dbRow(adm.id)).position).toBe('專員');
      await panel.getByLabel('過階', { exact: true }).check();
      await expect(panel.locator('[data-admin-level-error]')).toHaveCount(0);
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      await expect(panel.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      expect(await dbRow(adm.id)).toMatchObject({ position: '行政', newbie_level: '過階行政' });

      // 督導卡班：關閉後存檔，DB 的支援欄位被清空
      await openRow(page, codes.rot);
      panel = ed(page);
      await expect(panel.locator('[data-supervisor]')).toBeVisible();
      await expect(panel.locator('[data-block-preview]')).toContainText('區塊 2');
      await panel.getByLabel('督導卡班').uncheck();
      await expect(panel.locator('[data-supervisor]')).toHaveCount(0);
      await expect(panel.locator('[data-block-preview]')).toContainText('區塊 1');
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      await expect(panel.getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      expect(await dbRow(rot.id)).toMatchObject({ is_supervisor_rotation: false, supervisor_employee_code: null, supervisor_name: null, supervisor_position: null, supervisor_shift_hours: null, calculated_block: 1 });

      // 兩個分頁同時編輯：第二個存檔出現衝突提示並保留草稿
      await openRow(page, codes.con);
      const second = await ctx.newPage();
      second.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openNativeEditor(second, STORE_LABEL, month, codes.con);
      await ed(second).locator('[name=notes]').fill('B 先存');
      await ed(second).getByRole('button', { name: '儲存出勤資料' }).click();
      await expect(ed(second).getByRole('status').filter({ hasText: '已儲存' })).toBeVisible({ timeout: 20_000 });
      await second.close();
      panel = ed(page);
      await panel.locator('[name=notes]').fill('A 後存');
      await panel.getByRole('button', { name: '儲存出勤資料' }).click();
      const conflict = page.getByRole('dialog', { name: '儲存未完成' });
      await expect(conflict).toContainText('另一頁或其他人已更新');
      await expect(conflict).toContainText('編輯內容仍保留');
      await conflict.getByRole('button', { name: '返回編輯' }).click();
      await expect(panel.locator('[name=notes]')).toHaveValue('A 後存');
      expect((await dbRow(con.id)).notes).toBe('B 先存');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '頁面層級水平溢出').toBeLessThanOrEqual(0);
    } finally {
      await ctx.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await admin.dispose();
  }
});
