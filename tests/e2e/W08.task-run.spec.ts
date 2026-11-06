import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addSectionAssignment, adminDb, createTemplate, dropAutoAssignments, deleteRunTemplates, logRows, openFromMenu, runIdOrThrow, templateSections, twoSections, userId } from '../support/m3-fixtures';

// W08 e2e（桌機 1440 與手機 390 各跑一次）：
//  1) 管理員從任務管理明細打開非自己參與的任務，代為勾選並儲存；步驟紀錄顯示「由 OOO 代為勾選」；資料庫紀錄標 proxy。
//  2) 一般參與者（營業助理）做完自己的區段後，整體仍是進行中；另一區段做完後才變已完成，列表同步。
// 資料：範本標題「[自動測試]M3 <runId> …（含 project 名稱）」，由本測試清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('管理員代為勾選：看得到全部區段、勾選後步驟紀錄標示代做者', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-proxy-${tag}`, twoSections());
  const [secA, secB] = await templateSections(t.id);
  await dropAutoAssignments(t);
  const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
  await admin.dispose();

  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await openFromMenu(page, '任務管理');
    await page.locator(`tr[data-template-id="${t.id}"]`).getByRole('button', { name: '查看管理明細' }).click();
    const section = page.locator(`section[data-assignment-id="${a}"]`);
    await section.getByRole('button', { name: /開啟任務/ }).click();
    await expect(page.locator('[data-flag="proxy"]')).toContainText('代為勾選');
    await expect(page.getByRole('heading', { name: '總務' })).toBeVisible();
    // 全部 4 個步驟都看得到；代為勾選總務區段的第一步
    await expect(page.locator('.task-checklist input[type="checkbox"]')).toHaveCount(4);
    const target = secB.steps[0];
    const box = page.locator('.task-checklist .task-check', { hasText: '步驟一' }).nth(1).locator('input');
    await box.check();
    await page.getByRole('button', { name: '儲存進度' }).click();
    await expect(page.getByText('任務進度已儲存')).toBeVisible();
    await expect(page.locator('.task-history li[data-proxy="true"]')).toContainText('由 測試系統管理員 代為勾選');
    const rows = await logRows(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userId('admin'), step_id: target.id, proxy: true });
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('區段做完不等於任務完成：營業助理做完自己的區段仍是進行中，總務做完後才是已完成', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `e2e-complete-${tag}`, twoSections());
  const [secA, secB] = await templateSections(t.id);
  await dropAutoAssignments(t);
  const shared = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
  const ins = await adminDb().from('assignment_collaborators').insert({ assignment_id: shared, user_id: userId('ga_staff'), section_id: secB.id });
  expect(ins.error).toBeNull();
  await admin.dispose();

  const errors: string[] = [];
  const doSection = async (role: string) => {
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      page.on('pageerror', (e) => errors.push(String(e)));
      await openFromMenu(page, '我的任務');
      const row = page.locator('tbody tr', { hasText: t.form.title });
      await row.getByRole('button', { name: '開啟任務' }).click();
      const boxes = page.locator('.task-checklist input[type="checkbox"]');
      await expect(boxes).toHaveCount(2);
      for (let i = 0; i < 2; i++) await boxes.nth(i).check();
      await page.getByRole('button', { name: '儲存進度' }).click();
      await expect(page.getByText('任務進度已儲存')).toBeVisible();
      expect(await noPageOverflow(page)).toBe(true);
    } finally {
      await ctx.close();
    }
  };
  const listStatus = async (role: string) => {
    const api = await apiAs(role);
    try {
      const rec = ((await (await api.get('/api/workspace/tasks')).json()).records as any[]).find((r) => r.id === shared);
      return rec ? `${rec.status} ${rec.overallDone}/${rec.overallTotal}` : 'missing';
    } finally {
      await api.dispose();
    }
  };
  await doSection('ops_assistant');
  expect(await listStatus('ops_assistant')).toBe('in_progress 2/4');
  await doSection('ga_staff');
  expect(await listStatus('ga_staff')).toBe('completed 4/4');
  expect(errors, errors.join('\n')).toEqual([]);
});
