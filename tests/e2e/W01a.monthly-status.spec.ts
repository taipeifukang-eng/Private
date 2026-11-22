import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { addManual, ensureSummary, readMonth, registerFixtureRows, runIdOrThrow, saveRow, staffCode, testStoreIds } from '../support/w01a-fixtures';

// W01a e2e：桌機 1440 與手機 390 各跑完整主流程。
//  1. 店長送審：總覽與細節標籤 -> 刪除草稿人員 -> 送審前檢查（兼職缺時數＋新人階段，同一個視窗）-> 仍要送出 -> 已送審後不可刪除。
//  2. 確認後自動跳下一間：有確認權限的帳號確認第一間後，自動切到下一間未確認的門市。
// 資料只用 ZT 測試門市與保留月份 2099（桌機 2099-05、手機 2099-06），測後由 sweeper 清除。
// 註：DEV 角色矩陣裡沒有「同時有 edit+submit 且被指派門市」的店長帳號，送審流程以 admin 操作（API 對管理員略過指派檢查）；
// 確認流程用有 monthly.status.confirm 的 store_manager 帳號。

async function openMonthly(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
  await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}

async function query(page: Page, storeLabel: string, month: string) {
  await page.getByLabel('門市', { exact: true }).selectOption({ label: storeLabel });
  await page.getByLabel('月份').fill(month);
  await page.getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}

async function dbRows(store: string, month: string) {
  return readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: store, year_month: month }, select: 'id,employee_code,status' });
}

test('店長送審：標籤、刪除草稿、送審前檢查單一視窗、送審後鎖定刪除', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = mobile ? '2099-06' : '2099-05';
  const admin: APIRequestContext = await apiAs('admin');
  const errors: string[] = [];
  try {
    const stores = await testStoreIds(admin, month);
    const zt01 = stores.ZT01;
    const zt02 = stores.ZT02;
    const codes = { n: staffCode('N'), p: staffCode('P', true), b: staffCode('B'), d: staffCode('D'), t: staffCode('T') };
    await addManual(admin, zt01, month, { name: 'E2E 專員', code: codes.n });
    await addManual(admin, zt01, month, { name: 'E2E 兼職', code: codes.p, position: '兼職專員', employment_type: 'part_time', work_hours: 0, work_days: 0 });
    await addManual(admin, zt01, month, { name: 'E2E 新人', code: codes.b, position: '新人', newbie_level: '一階新人' });
    await addManual(admin, zt01, month, { name: 'E2E 待刪', code: codes.d });
    await addManual(admin, zt02, month, { name: 'E2E 二店', code: codes.t });
    await ensureSummary(admin, zt01, month);
    await ensureSummary(admin, zt02, month);
    await registerFixtureRows(zt01, month);
    await registerFixtureRows(zt02, month);
    const { body } = await readMonth(admin, zt01, month);
    const rec = (code: string) => body.records.find((r: any) => r.employee_code === code);
    await saveRow(admin, zt01, month, rec(codes.n), { has_manager_bonus: true, is_pharmacist: true, extra_tasks: ['長照外務'], extra_task_external_hours: 5 });
    // 新人：到職在月份前 2 個月、目前一階 -> 「應該過二階段」
    const hired = mobile ? '2099-04-01' : '2099-03-01';
    await saveRow(admin, zt01, month, rec(codes.b), { start_date: hired, newbie_level: '一階新人' });

    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openMonthly(page);
      await query(page, 'ZT01 ZT 測試門市 01', month);

      // 總覽：統計卡片 4 張、門市頁籤含兩間測試門市與狀態
      await expect(page.locator('.monthly-stats .stat-card')).toHaveCount(4);
      await expect(page.locator('.store-tabs [role=tab]', { hasText: 'ZT 測試門市 01' })).toContainText('填寫中');
      await expect(page.locator('.store-tabs [role=tab]', { hasText: 'ZT 測試門市 02' })).toContainText(/填寫中|待填寫/);

      // 細節標籤與新人階段
      const rowN = page.locator(`tr[data-staff="${codes.n}"]`);
      await expect(rowN).toContainText('手動新增');
      await expect(rowN).toContainText('藥師');
      await expect(rowN.locator('[data-tag="manager-bonus"]')).toHaveText('店長加成');
      await expect(rowN.locator('[data-tag="extra"]')).toContainText('長照外務(5h)');
      await expect(page.locator(`tr[data-staff="${codes.b}"]`)).toContainText('（一階）');

      // 異動歷程視窗（點姓名）
      await rowN.getByRole('button', { name: /異動歷程/ }).click();
      const history = page.getByRole('dialog', { name: '人員異動歷程' });
      await expect(history).toBeVisible();
      await expect(history).toContainText(/尚無異動記錄|\d{4}-\d{2}-\d{2}/);
      await history.getByRole('button', { name: '關閉' }).click();
      await expect(history).toHaveCount(0);

      // 刪除草稿人員
      const rowD = page.locator(`tr[data-staff="${codes.d}"]`);
      await rowD.getByRole('button', { name: '刪除' }).click();
      const del = page.getByRole('dialog', { name: '刪除人員' });
      await expect(del).toContainText('手動新增的員工');
      await del.getByRole('button', { name: '確認刪除' }).click();
      await expect(rowD).toHaveCount(0);
      expect((await dbRows(zt01, month)).some((r) => r.employee_code === codes.d)).toBe(false);

      // 送審前檢查：同一個視窗列出兼職缺時數與新人階段
      await page.getByRole('button', { name: '送出審核' }).click();
      const check = page.getByRole('dialog', { name: '送審前檢查' });
      await expect(check).toBeVisible();
      await expect(check.getByRole('region', { name: '兼職缺時數' })).toContainText('E2E 兼職');
      await expect(check.getByRole('region', { name: '新人階段確認' })).toContainText('E2E 新人');
      await expect(check.getByRole('region', { name: '新人階段確認' })).toContainText('應該過二階段');
      await expect(check.getByRole('button', { name: '去編輯' })).toHaveCount(2);
      await check.getByRole('button', { name: '確認無誤，仍要送出' }).click();
      const confirm = page.getByRole('dialog', { name: '送出審核' });
      await confirm.getByRole('button', { name: '確認執行' }).click();
      await expect(confirm).toHaveCount(0);
      await expect(page.getByRole('button', { name: '送出審核' })).toHaveCount(0);

      // DB：全部已送審；畫面：門市未確認，刪除按鈕照舊版每列都在（規格 B.2），非草稿按下後 API 回 409 說明需先退回
      const after = await dbRows(zt01, month);
      expect(after).toHaveLength(3);
      expect(after.every((r) => r.status === 'submitted')).toBe(true);
      await expect(page.getByRole('button', { name: '刪除', exact: true })).toHaveCount(3);
      await page.getByRole('button', { name: '刪除', exact: true }).first().click();
      const delete409 = page.waitForResponse((r) => /\/api\/workspace\/monthly$/.test(r.url()) && r.request().method() === 'POST' && r.status() === 409);
      await page.getByRole('dialog', { name: '刪除人員' }).getByRole('button', { name: '確認刪除' }).click();
      await delete409;
      await expect(page.getByRole('alert').filter({ hasText: '退回' })).toBeVisible({ timeout: 20_000 });
      expect(await dbRows(zt01, month)).toHaveLength(3);
      await expect(page.locator('.store-tabs [role=tab]', { hasText: 'ZT 測試門市 01' })).toContainText('已提交');
      // 已送審後直接呼叫 API 刪除仍是 409
      const direct = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month, id: String(after[0].id) } });
      expect(direct.status()).toBe(409);
    } finally {
      await ctx.close();
    }

    // ---- 確認後自動跳下一間 ----
    // ZT02 的人員也送審，讓兩間都在待確認。
    const submit02 = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt02, month, skipChecks: true } });
    expect(submit02.status()).toBe(200);
    const mgr = await loginAs(browser, 'store_manager');
    try {
      const page = await mgr.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openMonthly(page);
      await query(page, 'ZT01 ZT 測試門市 01', month);
      await expect(page.locator('.store-tabs [role=tab][aria-selected=true]')).toContainText('ZT 測試門市 01');
      await page.getByRole('button', { name: '確認本月狀態' }).click();
      await page.getByRole('dialog', { name: '確認本月狀態' }).getByRole('button', { name: '確認執行' }).click();
      // 自動跳到下一間未確認：ZT 測試門市 02
      await expect(page.locator('.store-tabs [role=tab][aria-selected=true]')).toContainText('ZT 測試門市 02', { timeout: 20_000 });
      await expect(page.locator(`tr[data-staff="${codes.t}"]`)).toBeVisible();
      await expect(page.locator('.store-tabs [role=tab]', { hasText: 'ZT 測試門市 01' })).toContainText('已確認');
      const confirmed = await dbRows(zt01, month);
      expect(confirmed.every((r) => r.status === 'confirmed')).toBe(true);
      expect((await dbRows(zt02, month)).every((r) => r.status === 'submitted')).toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '頁面層級水平溢出').toBeLessThanOrEqual(0);
    } finally {
      await mgr.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await admin.dispose();
  }
});
