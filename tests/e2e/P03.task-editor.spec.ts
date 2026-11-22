import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { adminDb, deleteRunTemplates, m3Title, openFromMenu, runIdOrThrow, userId } from '../support/m3-fixtures';

// P03 e2e（桌機 1440 與手機 390 各跑一次）：從畫面建立任務。
//  - A.6：選部門後只列出該部門的人；要加入其他部門的人，必須勾「加入跨部門支援人員」再逐一勾選；儲存後資料標示 support_users，
//    管理明細顯示「（跨部門支援）」。
//  - TaskStepFields 回歸：主項與子項的名稱、說明、必填、預計開始／結束都能輸入並存進資料庫。
// 資料：範本標題「[自動測試]M3 <runId> …（含 project 名稱）」，由本測試清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

async function fullName(key: string): Promise<string> {
  const r = await adminDb().from('profiles').select('full_name').eq('id', userId(key)).single();
  if (r.error || !r.data.full_name) throw new Error(`讀不到 ${key} 的姓名`);
  return r.data.full_name as string;
}

test('建立任務：選部門、勾執行人員、勾跨部門支援人員、填主項與子項欄位、儲存，資料庫與管理明細都對', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const tag = testInfo.project.name;
  const title = m3Title(`e2e-create-${tag}`);
  const opsName = await fullName('ops_assistant');
  const gaName = await fullName('ga_staff');
  const ctx = await loginAs(browser, 'admin');
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    await openFromMenu(page, '任務管理');
    await page.getByRole('button', { name: '建立新任務' }).click();
    await expect(page.getByRole('heading', { name: '建立新任務', exact: true })).toBeVisible();

    await page.getByLabel('專案標題').fill(title);
    await page.getByLabel('專案說明').fill('e2e 建立');
    await page.getByLabel('區段 1 部門').selectOption('營業部');

    // 部門限制：一般人員清單只有營業部的人，總務的人不在裡面
    const members = page.locator('.member-list:not(.support-list)').first();
    await expect(members.locator('label', { hasText: opsName })).toHaveCount(1);
    await expect(members.locator('label', { hasText: gaName }), '其他部門的人不能直接勾').toHaveCount(0);
    await members.locator('label', { hasText: opsName }).locator('input').check();

    // 跨部門支援人員：明確勾選
    await page.getByLabel('區段 1 加入跨部門支援人員').check();
    await page.getByLabel(`跨部門支援 ${gaName}`, { exact: true }).check();
    await expect(page.getByText('已選 2 人，其中跨部門支援 1 人')).toBeVisible();

    // TaskStepFields：主項與子項
    await page.getByLabel('區段 1 主項 1 名稱').fill('主項一');
    await page.getByLabel('區段 1 主項 1 說明').fill('主項說明');
    await page.getByLabel('區段 1 主項 1 必填').check();
    await page.getByLabel('區段 1 主項 1 預計開始').fill('2099-03-02');
    await page.getByLabel('區段 1 主項 1 預計結束').fill('2099-03-13');
    await page.getByRole('button', { name: '新增子項' }).first().click();
    await page.getByLabel('區段 1 主項 1 子項 1 名稱').fill('子項一');
    await page.getByLabel('區段 1 主項 1 子項 1 說明').fill('子項說明');

    await page.getByRole('button', { name: '儲存範本與指派' }).click();
    await expect(page.getByText('範本與指派已儲存')).toBeVisible();

    const t = await adminDb().from('templates').select('*').eq('title', title).single();
    expect(t.error).toBeNull();
    const section = t.data.sections[0];
    expect(section.department).toBe('營業部');
    expect(section.assigned_users.sort()).toEqual([userId('ops_assistant'), userId('ga_staff')].sort());
    expect(section.support_users).toEqual([userId('ga_staff')]);
    expect(section.steps[0]).toMatchObject({ label: '主項一', description: '主項說明', required: true, planned_start_date: '2099-03-02', planned_end_date: '2099-03-13' });
    expect(section.steps[0].subSteps[0]).toMatchObject({ label: '子項一', description: '子項說明' });

    // 管理明細：顯示跨部門支援
    await page.getByRole('button', { name: '查看管理明細' }).click();
    await expect(page.getByText(`${gaName}（跨部門支援）`)).toBeVisible();
    await expect(page.getByText(opsName + '（跨部門支援）')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('換部門會清掉原本選的人與支援人員（避免殘留錯誤部門的人）', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const opsName = await fullName('ops_assistant');
  const gaName = await fullName('ga_staff');
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openFromMenu(page, '任務管理');
    await page.getByRole('button', { name: '建立新任務' }).click();
    await page.getByLabel('區段 1 部門').selectOption('營業部');
    await page.locator('.member-list:not(.support-list)').first().locator('label', { hasText: opsName }).locator('input').check();
    await page.getByLabel('區段 1 加入跨部門支援人員').check();
    await page.getByLabel(`跨部門支援 ${gaName}`, { exact: true }).check();
    await expect(page.getByText('已選 2 人，其中跨部門支援 1 人')).toBeVisible();
    await page.getByLabel('區段 1 部門').selectOption('總務');
    await expect(page.getByText('已選 0 人，其中跨部門支援 0 人')).toBeVisible();
    await expect(page.locator('.support-list')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
