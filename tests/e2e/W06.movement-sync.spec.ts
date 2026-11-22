import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, openNativePage } from '../support/w05-fixtures';
import {
  MOVEMENT_HINT,
  W06_MONTHS,
  adminDb,
  insertHistory,
  purgeReceipts,
  purgeW06,
  recompute,
  registerW06,
  rosterRows,
  seedMaster,
  seedRoster,
  storeName,
  submitMovements,
  w06Code,
  w06StoreIds,
} from '../support/w06-fixtures';

// W06 端到端層：用異動 API 登錄後，在月結頁看到「需重新確認」「近期因異動自動調整」「依異動重算」與調店提示。
// 桌機用 ZT01、手機用 ZT02，員編與保留月份 2099-07～2099-09 錯開；資料測後清除。

const { m1, m2, m3 } = W06_MONTHS;

async function query(page: Page, storeLabel: string, month: string) {
  await page.getByLabel('門市', { exact: true }).selectOption({ label: storeLabel });
  await page.getByLabel('月份').fill(month);
  await page.getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}

test('月結頁：需重新確認清單、近期因異動自動調整、依異動重算、調店提示', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const storeCode = mobile ? 'ZT02' : 'ZT01';
  const codes = { promo: w06Code('FK', mobile ? 5 : 1), xfer: w06Code('FKPT', mobile ? 5 : 1), other: w06Code('FKF', mobile ? 55 : 54) };
  const all = Object.values(codes);
  const started = new Date().toISOString();
  const admin: APIRequestContext = await apiAs('admin');
  const ctx = await loginAs(browser, 'admin');
  let store = '';
  try {
    const ids = await w06StoreIds(admin, m1);
    store = ids[storeCode];
    const other = mobile ? ids.ZT01 : ids.ZT02;
    await purgeW06(all, [store, other]);
    await seedMaster(codes.promo, 'E2E 升職', store);
    await seedRoster(store, m1, [{ code: codes.promo, name: 'E2E 升職', position: '副店長' }]); // 店長手動改成副店長（草稿）
    await seedRoster(store, m2, [{ code: codes.promo, name: 'E2E 升職', status: 'submitted' }]); // 已送審
    const label = `${storeCode} ${await storeName(store)}`;
    const r = await submitMovements(admin, [{ employee_code: codes.promo, employee_name: 'E2E 升職', store_id: store, movement_type: 'promotion', position: '組長', effective_date: `${m1}-05` }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);

    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '每月人員狀態');
    await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });

    // 草稿月份：被異動覆蓋的欄位顯示在「近期因異動自動調整」，列上有標記；有「依異動重算」按鈕。
    await query(page, label, m1);
    const adjust = page.getByTestId('monthly-adjustments');
    await expect(adjust).toContainText(codes.promo);
    await expect(adjust).toContainText('職位');
    await expect(adjust).toContainText('副店長 → 組長');
    await expect(page.locator(`tr[data-staff="${codes.promo}"] [data-tag="adjusted"]`)).toHaveText('異動調整');
    await expect(page.locator(`tr[data-staff="${codes.promo}"]`)).toContainText('組長');
    await expect(page.getByTestId('monthly-recompute')).toBeVisible();
    // 已送審月份沒有更動，並出現在需重新確認清單
    const recheck = page.getByTestId('monthly-recheck');
    await expect(recheck).toContainText(m2);
    await expect(recheck).toContainText(codes.promo);
    await expect(recheck).toContainText('專員 → 組長');
    await expect(recheck).toContainText('已送審或已確認');
    expect(await noPageOverflow(page), '月結頁水平溢出').toBe(true);
    // 交付截圖（選用）：設定 W06_SCREENSHOT_DIR 時，桌機以 1920×1080、手機以 390 寬各存一張。
    if (process.env.W06_SCREENSHOT_DIR) {
      const dir = process.env.W06_SCREENSHOT_DIR;
      fs.mkdirSync(dir, { recursive: true });
      if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForLoadState('networkidle');
      if (mobile) await page.getByTestId('monthly-recheck').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(dir, mobile ? 'w06-monthly-390.png' : 'w06-monthly-1920x1080.png') });
      if (!mobile) await applyProjectViewport(page, testInfo);
    }

    await query(page, label, m2);
    await expect(page.locator(`tr[data-staff="${codes.promo}"]`)).toContainText('專員');
    await expect(page.getByTestId('monthly-recompute')).toHaveCount(0); // 已送審：不能直接重算

    // 退回草稿後一鍵依異動重算：職位更新、需重新確認清單消失
    await adminDb().from('monthly_staff_status').update({ status: 'draft' }).eq('employee_code', codes.promo).eq('year_month', m2);
    await query(page, label, m2);
    await page.getByTestId('monthly-recompute').click();
    await page.getByRole('dialog').getByRole('button', { name: '確認執行' }).click();
    await expect(page.locator(`tr[data-staff="${codes.promo}"]`)).toContainText('組長', { timeout: 30_000 });
    await expect(page.getByTestId('monthly-recheck')).toHaveCount(0);
    expect((await rosterRows(codes.promo, [m2]))[0].position).toBe('組長');

    // A.5 調店：兩店列都顯示「請填寫本店實際時數」
    await seedMaster(codes.xfer, 'E2E 兼職調店', store, { type: 'part_time', position: '兼職助理' });
    await seedRoster(store, m3, [{ code: codes.xfer, name: 'E2E 兼職調店', type: 'part_time', position: '兼職助理' }]);
    await seedRoster(other, m3, [{ code: codes.other, name: 'E2E 其他人' }]);
    await insertHistory({ code: codes.xfer, name: 'E2E 兼職調店', store: other, type: 'store_transfer', date: `${m3}-15`, old: await storeName(store), new: await storeName(other) });
    await recompute(codes.xfer, m3, { type: 'store_transfer' });
    await query(page, label, m3);
    await expect(page.locator(`tr[data-staff="${codes.xfer}"] [data-testid="movement-hint"]`)).toHaveText(MOVEMENT_HINT);
    await expect(page.locator(`tr[data-staff="${codes.xfer}"]`)).toContainText('調出');
    const otherLabel = `${mobile ? 'ZT01' : 'ZT02'} ${await storeName(other)}`;
    await query(page, otherLabel, m3);
    await expect(page.locator(`tr[data-staff="${codes.xfer}"] [data-testid="movement-hint"]`)).toHaveText(MOVEMENT_HINT);
    await expect(page.locator(`tr[data-staff="${codes.xfer}"]`)).toContainText('調入');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
    await registerW06(all).catch(() => undefined);
    await purgeW06(all, store ? [store] : []).catch(() => undefined);
    await purgeReceipts(started, store ? [store] : []).catch(() => undefined);
    await admin.dispose();
  }
});
