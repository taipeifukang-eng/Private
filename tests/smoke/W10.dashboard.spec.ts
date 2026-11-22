import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addSectionAssignment, createTemplate, dropAutoAssignments, deleteRunTemplates, logSteps, openFromMenu, runIdOrThrow, templateSections, twoSections, userId } from '../support/m3-fixtures';

// W10 冒煙層：導覽「儀表板」在工作台內開啟（不連回舊站）；統計與進度以勾選紀錄為準；沒有 pageerror、console 錯誤與水平溢出。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('管理員：儀表板在工作台內開啟，顯示歡迎、統計卡、我的任務表與重新整理；資料庫標已完成但沒有勾選的任務算待處理', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, `smoke-dashboard-${tag}`, twoSections());
  const [secA] = await templateSections(t.id);
  await dropAutoAssignments(t);
  const adminId = userId('admin');
  const a = await addSectionAssignment(t.id, secA.id, [adminId], { status: 'completed' });
  await logSteps(a, [secA.steps[0].id], adminId);
  await admin.dispose();

  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openFromMenu(page, '儀表板');
    await expect(page.getByRole('heading', { name: /歡迎回來，測試系統管理員/ })).toBeVisible();
    expect(new URL(page.url()).pathname, '不得離開工作台連回舊站').toContain('/workspace');
    await expect(page.locator('[data-stat="total"]')).toBeVisible();
    const row = page.locator('tbody tr', { hasText: t.form.title });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.badge')).toHaveText('進行中');
    await expect(row).toContainText('25%');
    await expect(row.getByRole('button', { name: '查看詳情' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新整理' })).toBeEnabled();
    await expect(page.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有 dashboard.view 的人（denied）：選單沒有儀表板，API 403', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const api = await apiAs('denied');
  try {
    expect((await api.get('/api/workspace/dashboard')).status()).toBe(403);
  } finally {
    await api.dispose();
  }
  const ctx = await loginAs(browser, 'denied');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await expect(page.locator('.workspace-menu button.catalog-item[title="儀表板"]')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
