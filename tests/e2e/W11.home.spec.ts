import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { addSectionAssignment, createTemplate, deleteRunTemplates, dropAutoAssignments, DEPT, logSteps, runIdOrThrow, sectionOf, templateSections, userId } from '../support/m3-fixtures';
import { pendingTransferRows, seedBonus, seedTransfers, storeIds, withEmployeeCode } from '../support/w11-fixtures';

// W11 / W12 e2e（桌機 1440 與手機 390）：
//  - 獎金卡：前 3 個月在外面，較早月份收在「較早月份」；未確認的月份標「尚未確認，金額可能調整」，已確認的不標；展開看欄位與合計。
//  - 我的任務：未完成優先；點任務開啟工作頁籤。
//  - 調店確認卡：管理員看到全部待確認數，點了開啟調店頁。
// 資料：測試員編 ZT<runId>（暫時設在 ops_assistant，測後還原）、2038 年度獎金列、ZT 門市調店申請、[自動測試]M3 範本，測後清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('獎金卡與我的任務：標註未確認、較早月份收合、未完成任務排前面、點任務開啟頁籤', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const st = await storeIds();
  const restore = await withEmployeeCode('ops_assistant');
  const months = ['2038-04', '2038-03', '2038-02', '2038-01'];
  const cleanup = await seedBonus(
    months.map((yearMonth, i) => ({ yearMonth, store: st.ZT05, amounts: { group_bonus: 1000 + i, other_bonus: i === 0 ? 5 : 0 }, note: '加班' })),
    [{ yearMonth: '2038-03', store: st.ZT05 }],
  );
  const admin = await apiAs('admin');
  const ops = userId('ops_assistant');
  const make = async (name: string, complete: boolean) => {
    const t = await createTemplate(admin, `${name}-${tag}`, [sectionOf({ department: DEPT, users: [ops] })]);
    await dropAutoAssignments(t);
    const [sec] = await templateSections(t.id);
    const a = await addSectionAssignment(t.id, sec.id, [ops]);
    if (complete) await logSteps(a, sec.steps.map((s) => s.id), ops);
    await new Promise((r) => setTimeout(r, 30));
    return { id: a, title: t.form.title };
  };
  const done = await make('home-e2e-done', true);
  const open = await make('home-e2e-open', false);
  await admin.dispose();

  const ctx = await loginAs(browser, 'ops_assistant');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });

    const bonus = page.locator('[data-home-card="bonus"]');
    await expect(bonus).toBeVisible();
    // 前三個月直接列出，第四個月在「較早月份」裡
    await expect(bonus.locator(':scope > details.bonus-month')).toHaveCount(3);
    await expect(bonus.locator('details.bonus-older')).toContainText('較早月份');
    const m3 = bonus.locator('details.bonus-month[data-month="2038-03"]');
    const m4 = bonus.locator('details.bonus-month[data-month="2038-04"]');
    await expect(m3.locator('[data-home="bonus-unconfirmed"]'), '已確認的月份不標註').toHaveCount(0);
    await expect(m4.locator('[data-home="bonus-unconfirmed"]')).toHaveText('尚未確認，金額可能調整');
    await expect(m4).toContainText('合計 1,005');
    await m4.locator('summary').click();
    await expect(m4).toContainText('月團體獎金');
    await expect(m4).toContainText('其他獎金');
    await expect(m4).toContainText('加班');
    await bonus.locator('details.bonus-older > summary').click();
    await expect(bonus.locator('details.bonus-month[data-month="2038-01"]')).toBeVisible();

    // 我的任務：未完成排前面
    const tasks = page.locator('[data-home-card="tasks"] .task-list li');
    const titles = await tasks.locator('strong').allTextContents();
    expect(titles.indexOf(open.title), '未完成任務在列').toBeGreaterThanOrEqual(0);
    if (titles.includes(done.title)) expect(titles.indexOf(open.title)).toBeLessThan(titles.indexOf(done.title));
    await tasks.filter({ hasText: open.title }).getByRole('button').click();
    await expect(page.locator('.tab', { hasText: open.title }).first()).toBeVisible({ timeout: 15_000 }).catch(async () => {
      await expect(page.locator('[role="tabpanel"]:visible')).toContainText(open.title);
    });
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
    await cleanup();
    await restore();
  }
});

test('管理員的調店確認卡：顯示全部待確認數，點了開啟調店頁', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const st = await storeIds();
  const cleanup = await seedTransfers([{ from: st.ZT01, to: st.ZT04 }]);
  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const total = (await pendingTransferRows()).length;
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const banner = page.locator('[data-home-card="transfer-confirm"]');
    await expect(banner).toBeVisible();
    await expect(banner.locator('[data-home="transfer-count"]')).toHaveText(`${total} 待確認`);
    // 調店確認卡在每月版更之前（舊版順序）
    const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    expect(await y('[data-home-card="transfer-confirm"]')).toBeLessThan(await y('[data-home-card="monthly-release"]'));
    await banner.click();
    await expect(page.locator('[role="tabpanel"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-home-card="transfer-confirm"]')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
    await cleanup();
  }
});
