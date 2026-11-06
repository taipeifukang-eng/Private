import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addSectionAssignment, createTemplate, dropAutoAssignments, deleteRunTemplates, logSteps, openFromMenu, runIdOrThrow, templateSections, twoSections, userId } from '../support/m3-fixtures';

// W08 冒煙層：我的任務可開啟，顯示「我的進度」、整體狀態、重複卡片只留有進度者、區段已變更標示；沒有 pageerror、console 錯誤與水平溢出。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('我的任務：顯示我的進度與整體進度；有進度的重複卡片留下、沒動過的收起；區段已變更的標示且不能開啟', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `smoke-mytasks-${tag}`, twoSections());
  const [secA] = await templateSections(t.id);
  await dropAutoAssignments(t);
  const ops = userId('ops_assistant');
  const withProgress = await addSectionAssignment(t.id, secA.id, [ops]);
  await logSteps(withProgress, [secA.steps[0].id], ops);
  await addSectionAssignment(t.id, secA.id, [ops]); // 沒動過的重複卡片，應被收起
  const t2 = await createTemplate(admin, `smoke-mytasks-gone-${tag}`, twoSections());
  await dropAutoAssignments(t2);
  await addSectionAssignment(t2.id, '00000000-0000-4000-8000-000000000000', [ops]);
  await admin.dispose();

  const ctx = await loginAs(browser, 'ops_assistant');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '我的任務');
    await expect(page.getByRole('heading', { name: '我的任務', exact: true })).toBeVisible();
    const card = page.locator('tbody tr', { hasText: t.form.title });
    await expect(card, '有進度的那筆留下、沒動過的收起').toHaveCount(1);
    await expect(card).toContainText('我的進度 1 / 2');
    await expect(card).toContainText('整體 1 / 4');
    await expect(card).toContainText('進行中');
    const goneRow = page.locator('tbody tr', { hasText: t2.form.title });
    await expect(goneRow.locator('[data-flag="section-changed"]')).toContainText('區段已變更');
    await expect(goneRow.getByRole('button', { name: '開啟任務' })).toBeDisabled();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
