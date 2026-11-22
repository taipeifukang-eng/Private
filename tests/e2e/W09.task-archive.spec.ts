import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { completeAssignment, createTemplate, deleteRunTemplates, openFromMenu, runIdOrThrow, sectionOf, DEPT, setAssignment, userId } from '../support/m3-fixtures';

// W09 e2e（桌機 1440 與手機 390 各跑一次）：封存任務詳情唯讀（M3 A.5）。
//  管理員從「已封存任務」打開一筆封存紀錄：看得到項目與備註、跨部門支援標示；畫面上沒有任何可勾選的項目、沒有儲存按鈕；
//  只能「複製為新任務」。資料庫的勾選紀錄在整個過程中不變。
// 資料：範本標題「[自動測試]M3 <runId> …（含 project 名稱）」，由本測試清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('封存詳情唯讀：沒有勾選框與儲存按鈕，只有複製入口；跨部門支援有標示', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-archive-${tag}`, [sectionOf({ department: DEPT, users: [userId('ops_assistant')], support: [userId('ga_staff')] })]);
  await admin.dispose();
  await completeAssignment(t.assignmentId, t.id, userId('admin'));
  await setAssignment(t.assignmentId, { archived: true, archived_by: userId('admin'), archived_at: new Date().toISOString() });

  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await openFromMenu(page, '已封存任務');
    await page.getByLabel('任務名稱').fill(t.form.title);
    const row = page.locator(`tr[data-record-id="${t.assignmentId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '查看封存紀錄' }).click();
    await expect(page.getByRole('heading', { name: t.form.title })).toBeVisible();
    await expect(page.getByText('最後進度 2 / 2')).toBeVisible();
    await expect(page.getByText('（跨部門支援）').first()).toBeVisible();
    await expect(page.locator('main input[type="checkbox"], .page input[type="checkbox"]'), '唯讀：沒有勾選框').toHaveCount(0);
    await expect(page.getByRole('button', { name: /儲存|送出|完成/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /複製為新任務|再複製一份/ })).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
