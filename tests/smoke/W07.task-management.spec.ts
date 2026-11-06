import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { createTemplate, deleteRunTemplates, openFromMenu, runIdOrThrow, setAssignment, userId } from '../support/m3-fixtures';

// W07 冒煙層：任務管理列表可開啟；沒有 pageerror、console 錯誤與水平溢出。
// 資料：本測試建立的兩個範本（一個有進行中任務、一個只有封存任務 → 「尚未指派」），結束時清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('管理員：任務管理列表顯示全部模板，尚未指派的有標示與「指派」按鈕，刪除入口存在；沒有 pageerror 與水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const fresh = await createTemplate(admin, `smoke-fresh-${tag}`);
  const idle = await createTemplate(admin, `smoke-idle-${tag}`);
  await setAssignment(idle.assignmentId, { archived: true, status: 'completed', archived_by: userId('admin'), archived_at: new Date().toISOString() });
  await admin.dispose();

  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '任務管理');
    await expect(page.getByRole('heading', { name: '任務管理', exact: true })).toBeVisible();
    const freshRow = page.locator(`tr[data-template-id="${fresh.id}"]`);
    const idleRow = page.locator(`tr[data-template-id="${idle.id}"]`);
    await expect(freshRow).toBeVisible();
    await expect(idleRow, '沒有未封存任務的模板也要列出').toBeVisible();
    await expect(idleRow.locator('.unassigned-badge')).toHaveText('尚未指派');
    await expect(freshRow.locator('.unassigned-badge')).toHaveCount(0);
    await expect(idleRow.getByRole('button', { name: '指派', exact: true })).toBeVisible();
    await expect(idleRow.getByRole('button', { name: '刪除流程模板' })).toBeVisible();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('一般員工與無權限者的選單沒有「任務管理」與「已封存任務」；任務管理 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  for (const role of ['employee', 'denied']) {
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('.menu-toggle');
      await page.click('.menu-toggle');
      await expect(page.locator('.workspace-menu button.catalog-item[title="任務管理"]'), role).toHaveCount(0);
      await expect(page.locator('.workspace-menu button.catalog-item[title="已封存任務"]'), role).toHaveCount(0);
    } finally {
      await ctx.close();
    }
    const api = await apiAs(role);
    try {
      expect((await api.get('/api/workspace/task-management')).status(), role).toBe(403);
    } finally {
      await api.dispose();
    }
  }
});
