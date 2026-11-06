import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addSectionAssignment, createTemplate, dropAutoAssignments, deleteRunTemplates, logSteps, openFromMenu, runIdOrThrow, templateSections, twoSections, userId } from '../support/m3-fixtures';

// W10 e2e（桌機 1440 與手機 390 各跑一次）：儀表板手動重新整理與 60 秒背景更新；進度條與徽章以勾選紀錄為準。
// 資料：範本標題「[自動測試]M3 <runId> …（含 project 名稱）」，由本測試清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('儀表板：手動重新整理與 60 秒背景更新都會帶入別人剛做的勾選；進度條與徽章跟著變', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-dashboard-${tag}`, twoSections());
  const [secA] = await templateSections(t.id);
  await dropAutoAssignments(t);
  const adminId = userId('admin');
  const a = await addSectionAssignment(t.id, secA.id, [adminId]);
  await admin.dispose();

  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.install();
    await openFromMenu(page, '儀表板');
    const row = page.locator('tbody tr', { hasText: t.form.title });
    await expect(row.locator('.badge')).toHaveText('待處理');
    await expect(row).toContainText('0%');

    // 手動重新整理
    await logSteps(a, [secA.steps[0].id], adminId);
    await page.getByRole('button', { name: '重新整理' }).click();
    await expect(row.locator('.badge')).toHaveText('進行中');
    await expect(row).toContainText('25%');

    // 60 秒背景更新（不按任何按鈕）
    await logSteps(a, [secA.steps[1].id], adminId);
    await page.clock.fastForward(30_000);
    await page.waitForTimeout(500);
    await expect(row, '30 秒還不會更新').toContainText('25%');
    await page.clock.fastForward(31_000);
    await expect(row).toContainText('50%');
    await expect(row.locator('progress')).toHaveAttribute('value', '50');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
