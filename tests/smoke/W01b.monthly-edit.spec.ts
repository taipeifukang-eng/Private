import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, loginAs } from '../support/auth';
import { addManual, editUpdates, ensureSummarySafe, openNativeEditor, postSave, readMonth, registerFixtureRows, staffCode, testStoreIds, W01B_MONTHS } from '../support/w01b-fixtures';

// W01b 冒煙層：每月人員單人編輯。從名冊開啟編輯分頁，角色矩陣各角色看到的是「可編輯表單」或「唯讀檢視」，
// 區塊預覽都在；已確認的人員顯示專屬畫面且沒有儲存按鈕；390 寬度無頁面層級水平溢出、無 pageerror。
// 只讀取（資料由 admin API 預先建立，保留月份 2099-04、ZT 測試門市，sweeper 清除）。

type Account = { key: string; permissions: string[] | 'ALL' };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
const has = (key: string, code: string) => {
  const a = accounts.find((x) => x.key === key)!;
  return a.permissions === 'ALL' || a.permissions.includes(code);
};

const MONTH = W01B_MONTHS.smoke;
const SUBJECTS = ['admin', 'store_manager', 'ops_manager', 'monthly_view', 'monthly_edit'];
const codes = { draft: '', confirmed: '' };

test.beforeAll(async () => {
  const admin = await apiAs('admin');
  try {
    const stores = await testStoreIds(admin, MONTH);
    const existing = await readMonth(admin, stores.ZT02, MONTH);
    codes.draft = staffCode('D');
    codes.confirmed = staffCode('C');
    const created = await readMonth(admin, stores.ZT01, MONTH);
    if (!created.body.records.some((r: any) => r.employee_code === codes.draft)) {
      const draft = await addManual(admin, stores.ZT01, MONTH, { name: 'SMK 草稿', code: codes.draft, position: '新人', newbie_level: '一階新人' });
      const rec = (await readMonth(admin, stores.ZT01, MONTH)).body.records.find((r: any) => r.id === draft.id);
      await postSave(admin, stores.ZT01, MONTH, draft.id, rec.updated_at, editUpdates({ position: '新人', newbie_level: '一階新人', start_date: '2099-03-01', extra_tasks: ['長照外務'], extra_task_external_hours: 4 }));
      await ensureSummarySafe(admin, stores.ZT01, MONTH);
    }
    if (!existing.body.records.some((r: any) => r.employee_code === codes.confirmed)) {
      await addManual(admin, stores.ZT02, MONTH, { name: 'SMK 已確認', code: codes.confirmed });
      await ensureSummarySafe(admin, stores.ZT02, MONTH);
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: stores.ZT02, month: MONTH, skipChecks: true } })).status()).toBe(200);
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'confirm', store: stores.ZT02, month: MONTH } })).status()).toBe(200);
    }
    await registerFixtureRows(stores.ZT01, MONTH);
    await registerFixtureRows(stores.ZT02, MONTH);
  } finally {
    await admin.dispose();
  }
});

for (const key of SUBJECTS) {
  test(`單人編輯冒煙 ${key}：${has(key, 'monthly.status.edit') ? '可編輯表單' : '唯讀檢視'}`, async ({ browser }) => {
    test.setTimeout(120_000);
    // 先以 API 確認這個角色看得到 ZT01 的名冊（DEV 角色矩陣有些帳號沒有指派任何門市，看不到測試門市）。
    const probe = await apiAs(key);
    let visible = false;
    try {
      const stores = await probe.get('/api/workspace/monthly', { params: { month: MONTH } });
      const body = stores.status() === 200 ? await stores.json() : { allStores: [] };
      const zt01 = (body.allStores as { id: string; store_code: string }[]).find((s) => s.store_code === 'ZT01');
      if (zt01) {
        const res = await probe.get('/api/workspace/monthly', { params: { month: MONTH, store: zt01.id } });
        visible = res.status() === 200 && (await res.json()).records.some((r: any) => r.employee_code === codes.draft);
      }
    } finally {
      await probe.dispose();
    }
    test.info().annotations.push({ type: 'visible-zt01', description: String(visible) });
    if (!visible) {
      // 看不到門市的角色：只確認畫面沒有錯誤、沒有可編輯入口（W01a 已涵蓋名冊可見性）
      const ctx = await loginAs(browser, key);
      try {
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
        await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
        await expect(page.locator('form.module-editor')).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
      return;
    }
    const ctx = await loginAs(browser, key);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openNativeEditor(page, 'ZT01 ZT 測試門市 01', MONTH, codes.draft);
      await expect(page.getByRole('heading', { name: 'SMK 草稿' })).toBeVisible();
      // 區塊預覽一律顯示（外務 → 區塊 4）
      const preview = page.locator('[data-block-preview]');
      await expect(preview).toContainText('區塊 4');
      await expect(preview).toContainText('特殊時數');
      // 新人階段與提醒（到職 2099-03、月份 2099-04：滿 1 個月且已是一階 → 不提醒）
      await expect(page.locator('[data-newbie-level]')).toBeVisible();
      await expect(page.locator('[data-newbie-reminder]')).toHaveCount(0);
      // 外務自動換算：正職整月 → 160
      await expect(page.locator('[data-planned-hours]')).toHaveValue('160');
      const save = page.getByRole('button', { name: '儲存出勤資料' });
      if (has(key, 'monthly.status.edit')) {
        await expect(page.locator('[data-readonly-notice]')).toHaveCount(0);
        await expect(save).toBeVisible();
        await expect(save).toBeDisabled(); // 尚未修改
      } else {
        await expect(page.locator('[data-readonly-notice]')).toBeVisible();
        await expect(save).toHaveCount(0);
        await expect(page.locator('[name=position]')).toBeDisabled();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '頁面層級水平溢出').toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('已確認的人員：專屬畫面（此資料已確認），沒有表單與儲存按鈕，可返回', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    await openNativeEditor(page, 'ZT02 ZT 測試門市 02', MONTH, codes.confirmed);
    const screen = page.locator('[data-confirmed-screen]');
    await expect(screen).toContainText('此資料已確認');
    await expect(screen).toContainText('已確認的人員狀態無法再修改');
    await expect(page.locator('form.module-editor')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '儲存出勤資料' })).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await screen.getByRole('button', { name: '返回' }).click();
    await expect(page.locator('[data-confirmed-screen]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
