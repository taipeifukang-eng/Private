import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addAssignment, auditRows, completeAssignment, countRows, createTemplate, deleteRunTemplates, logSteps, openFromMenu, runIdOrThrow, stepIds, templateExists, userId } from '../support/m3-fixtures';

// W07 e2e（桌機 1440 與手機 390 各跑一次）：
//  1. 刪除流程模板：底下有進行中任務時，輸入標題後按確認也會被擋並顯示原因；取消不刪；完成後輸入標題完全相符才能按確認，刪除後從列表消失、資料庫無殘留。
//  2. 模板詳情：刪除已完成任務（每筆任務旁的按鈕），未完成的任務旁沒有刪除按鈕；刪除後留下稽核紀錄。
//  3. 模板列表選單「刪除已完成任務」：全部完成時才出現。
// 資料：範本標題「[自動測試]M3 <runId> …（含 project 名稱）」，由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('刪除流程模板：標題確認、被進行中任務擋下、取消不刪、完成後刪除並清乾淨', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-del-template-${tag}`);
  await admin.dispose();
  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await openFromMenu(page, '任務管理');
    const row = page.locator(`tr[data-template-id="${t.id}"]`);
    await expect(row).toBeVisible();

    // 1) 被擋：輸入標題也不能刪，顯示原因，資料還在
    await row.getByRole('button', { name: '刪除流程模板' }).click();
    const dialog = page.locator('dialog[open]');
    const confirm = dialog.getByRole('button', { name: '確認刪除' });
    await expect(confirm, '標題未輸入前不能按').toBeDisabled();
    await dialog.getByLabel('輸入模板標題確認刪除').fill(t.form.title + ' ');
    await expect(confirm, '多一個空白也不行').toBeDisabled();
    await dialog.getByLabel('輸入模板標題確認刪除').fill(t.form.title);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText('還有待處理或進行中的任務');
    expect(await templateExists(t.id)).toBe(true);

    // 2) 取消：不刪
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await templateExists(t.id)).toBe(true);

    // 3) 任務完成後可刪
    await completeAssignment(t.assignmentId, t.id, userId('admin'));
    await page.getByRole('button', { name: '重新整理' }).click();
    await row.getByRole('button', { name: '刪除流程模板' }).click();
    await dialog.getByLabel('輸入模板標題確認刪除').fill(t.form.title);
    await dialog.getByRole('button', { name: '確認刪除' }).click();
    await expect(page.locator('.notice[role="status"]')).toContainText('已刪除流程模板');
    await expect(row).toHaveCount(0);
    expect(await templateExists(t.id)).toBe(false);
    expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(0);
    expect(await countRows('logs', 'assignment_id', [t.assignmentId])).toBe(0);
    expect(await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId])).toBe(0);
    expect(await auditRows({ template_id: t.id })).toHaveLength(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('模板詳情：只有已完成的任務旁有刪除按鈕；刪除後該筆消失、稽核紀錄寫入、其他任務不受影響', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-del-assignment-${tag}`);
  const other = await addAssignment(t.id, { status: 'in_progress' }, [userId('employee')]);
  // 狀態由勾選紀錄推導：只勾第一個步驟，才是「進行中」（只改 status 欄位不算）。
  await logSteps(other, (await stepIds(t.id)).slice(0, 1), userId('employee'));
  await completeAssignment(t.assignmentId, t.id, userId('admin'));
  await admin.dispose();
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openFromMenu(page, '任務管理');
    await page.locator(`tr[data-template-id="${t.id}"]`).getByRole('button', { name: '查看管理明細' }).click();
    const done = page.locator(`section[data-assignment-id="${t.assignmentId}"]`);
    const doing = page.locator(`section[data-assignment-id="${other}"]`);
    await expect(done).toBeVisible();
    await expect(doing).toBeVisible();
    await expect(done.locator('.status-badge')).toHaveText('已完成');
    await expect(doing.locator('.status-badge')).toHaveText('進行中');
    await expect(doing.getByRole('button', { name: '刪除', exact: true }), '未完成的任務沒有刪除按鈕').toHaveCount(0);

    await done.getByRole('button', { name: '刪除', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: '取消' }).click();
    expect(await countRows('assignments', 'id', [t.assignmentId]), '取消不刪').toBe(1);
    await done.getByRole('button', { name: '刪除', exact: true }).click();
    await dialog.getByRole('button', { name: '確認刪除' }).click();
    await expect(page.locator('.notice[role="status"]').first()).toContainText('已刪除');
    await expect(done).toHaveCount(0);
    await expect(doing).toBeVisible();
    expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(0);
    expect(await countRows('assignments', 'id', [other])).toBe(1);
    const audit = await auditRows({ assignment_id: t.assignmentId });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(userId('admin'));
  } finally {
    await ctx.close();
  }
});

test('模板列表選單「刪除已完成任務」：還有未完成任務時不顯示；全部完成後顯示，按下去全部刪除', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-del-completed-${tag}`);
  const second = await addAssignment(t.id, { status: 'pending' }, [userId('employee')]);
  await completeAssignment(t.assignmentId, t.id, userId('admin'));
  await admin.dispose();
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openFromMenu(page, '任務管理');
    const row = page.locator(`tr[data-template-id="${t.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: '刪除已完成任務' })).toHaveCount(0);
    await completeAssignment(second, t.id, userId('employee'));
    await page.getByRole('button', { name: '重新整理' }).click();
    await row.getByRole('button', { name: '刪除已完成任務' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: '確認刪除' }).click();
    await expect(page.locator('.notice[role="status"]')).toContainText('已刪除 2 筆已完成任務');
    expect(await countRows('assignments', 'id', [t.assignmentId, second])).toBe(0);
    expect(await templateExists(t.id), '範本保留').toBe(true);
    await expect(row.locator('.unassigned-badge')).toHaveText('尚未指派');
    expect(await auditRows({ template_id: t.id })).toHaveLength(2);
  } finally {
    await ctx.close();
  }
});
