import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { ensureSummary, readMonth, testStoreIds } from './w01a-fixtures';

export * from './w01a-fixtures';

/**
 * W01b 保留月份（2099，ZT 測試門市）：避免與 W01a（01、05–08）重疊。
 *  02 / 03：整合層（草稿 / 已確認）　04：冒煙　09：e2e 桌機　10：e2e 手機　11 / 12：parity（草稿 / 已送審與已確認）
 */
export const W01B_MONTHS = { integrationDraft: '2099-02', integrationConfirmed: '2099-03', smoke: '2099-04', e2eDesktop: '2099-09', e2eMobile: '2099-10', parityDraft: '2099-11', parityLocked: '2099-12' };

/** 完整 save updates（不依賴既有列，方便逐案指定）。 */
export function editUpdates(patch: Record<string, unknown> = {}) {
  return {
    position: '專員',
    employment_type: 'full_time',
    monthly_status: 'full_month',
    start_date: null,
    newbie_level: null,
    partial_month_reason: null,
    is_dual_position: false,
    has_manager_bonus: false,
    is_supervisor_rotation: false,
    is_pharmacist: false,
    is_acting_manager: false,
    supervisor_employee_code: '',
    supervisor_name: '',
    supervisor_position: '',
    partial_month_notes: '',
    supervisor_shift_hours: null,
    extra_task_external_hours: null,
    extra_tasks: [] as string[],
    work_days: 30,
    work_hours: 0,
    notes: '',
    ...patch,
  };
}

export async function postSave(api: APIRequestContext, store: string, month: string, id: string, version: string | null, updates: Record<string, unknown>) {
  return api.post('/api/workspace/monthly', { data: { action: 'save', store, month, id, version, updates } });
}

/** 清掉保留月份內的草稿（上次中止遺留）；遇到非草稿代表需先跑 sweeper。 */
export async function clearDraftMonth(admin: APIRequestContext, stores: string[], month: string) {
  for (const store of stores) {
    const { body } = await readMonth(admin, store, month);
    for (const r of body.records || []) {
      if (r.status !== 'draft') throw new Error(`保留月份 ${month} 有非草稿資料，請先執行 sweeper`);
      await admin.post('/api/workspace/monthly', { data: { action: 'delete', store, month, id: r.id } });
    }
  }
}

export { testStoreIds };

/** 從每月人員狀態名冊開啟某人的編輯分頁（新版）。 */
export async function openNativeEditor(page: Page, storeLabel: string, month: string, code: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
  await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
  await page.getByLabel('門市', { exact: true }).selectOption({ label: storeLabel });
  await page.getByLabel('月份').fill(month);
  await page.getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
  const row = page.locator(`tr[data-staff="${code}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /編輯出勤|查看明細/ }).click();
  await expect(page.locator('form.module-editor, [data-confirmed-screen]').first()).toBeVisible({ timeout: 30_000 });
}

/** 建立門市統計；已存在（409）視為已就緒，讓 fixture 在被中斷後重跑仍可用。 */
export async function ensureSummarySafe(admin: APIRequestContext, store: string, month: string) {
  try {
    await ensureSummary(admin, store, month);
  } catch (e) {
    if (!String((e as Error).message).includes('HTTP 409')) throw e;
  }
}
