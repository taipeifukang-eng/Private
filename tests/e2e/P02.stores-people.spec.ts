import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import {
  XLSX_MIME,
  adminDb,
  applyProjectViewport,
  collectErrors,
  employeeWorkbook,
  masterOf,
  noPageOverflow,
  openNativePage,
  p02Code,
  p02Stores,
  purgeP02,
  purgeReceipts,
  registerP02,
  runIdOrThrow,
  seedMaster,
  workPanel,
} from '../support/p02-fixtures';

// P02 端到端層（桌機 1440、手機 390）：
//   D.1 批次匯入員工：同一份檔案再傳一次，預覽列出「已存在且內容完全相同，將自動略過」，確認後不新增也不報錯。
//   D.2 調店登記確認：兩位督導各自的確認狀態，管理員代確認並顯示代確認標記。
//   F.3 店長指派頁：各門市已有店長時顯示「已有店長」提示。
// 資料用測試員編 FKF6xxxx／FKPT7xx、ZT01／ZT04 與保留月份 2099，測後清除。

const nodeRequire = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry } = nodeRequire('../support/registry.cjs') as { createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void } };

test('批次匯入員工頁：重複列自動略過並列在預覽與結果', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const a = p02Code('FKF', mobile ? 41 : 40), b = p02Code('FKPT', mobile ? 43 : 42);
  const started = new Date().toISOString();
  const st = await p02Stores();
  await purgeP02([a, b]);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '批次匯入員工');
    const p = workPanel(page);
    const file = { name: 'p02.xlsx', mimeType: XLSX_MIME, buffer: employeeWorkbook([['ZT01', a, 'E2E 匯入甲', '專員', '2026-10-01'], ['ZT01', b, 'E2E 匯入乙', '兼職助理', '2026-10-01']]) };
    await p.locator('input[type=file]').setInputFiles(file);
    await expect(p.getByText('可新增')).toHaveCount(2, { timeout: 60_000 });
    await p.getByRole('button', { name: '確認匯入 2 位員工' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '確認送出' }).click();
    await expect(p.getByText('已成功匯入 2 位員工。')).toBeVisible({ timeout: 60_000 });
    expect((await masterOf(a)).length + (await masterOf(b)).length).toBe(2);

    // 同一份檔案再傳一次
    await p.locator('input[type=file]').setInputFiles(file);
    await expect(p.getByText('2 列已存在且內容完全相同，將自動略過')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText('已存在，略過')).toHaveCount(2);
    await expect(p.locator('.notice.error')).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await p.getByRole('button', { name: /確認匯入 0 位員工/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '確認送出' }).click();
    await expect(p.getByText('已成功匯入 0 位員工。')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText(/自動略過 2 列/)).toBeVisible();
    expect(await masterOf(a)).toHaveLength(1);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await registerP02([a, b]).catch(() => undefined);
    await purgeP02([a, b]).catch(() => undefined);
    await purgeReceipts(started, [st.ZT01]).catch(() => undefined);
    await ctx.close();
  }
});

test('調店登記確認頁：顯示兩位督導各自的確認狀態，管理員代確認並標記', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const code = p02Code('FKF', mobile ? 46 : 45);
  const st = await p02Stores();
  const admin: APIRequestContext = await apiAs('admin');
  await purgeP02([code]);
  const ctx = await loginAs(browser, 'admin');
  try {
    await seedMaster(code, 'E2E 調店', st.ZT01);
    const created = await admin.post('/api/workspace/transfers/create', { data: { requestId: randomUUID(), data: { employee_code: code, employee_name: 'E2E 調店', from_store_id: st.ZT01, to_store_id: st.ZT04, notes: '' } } });
    expect(created.status(), await created.text()).toBe(200);
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '人員異動管理');
    await page.getByRole('button', { name: '調店登記確認' }).click();
    const p = workPanel(page);
    await p.getByLabel('搜尋申請').fill(code);
    const row = p.locator('tbody tr', { hasText: code });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row.locator('[data-side=from]')).toContainText('原店督導');
    await expect(row.locator('[data-side=from]')).toContainText('待確認');
    await expect(row.locator('[data-side=to]')).toContainText('新店督導');
    await expect(row.locator('[data-side=to]')).toContainText('待確認');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);

    // 管理員代兩側確認：需要生效日期與核對
    await row.getByRole('button', { name: '確認調店' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('原店督導')).toBeVisible();
    await expect(dialog.getByText('新店督導')).toBeVisible();
    await dialog.getByLabel('生效日期').fill('2099-08-20');
    await dialog.getByRole('button', { name: '核對調店影響' }).click();
    await dialog.getByRole('button', { name: '確認生效' }).click();
    await expect(p.getByText(/兩店督導都已確認，主檔與月資料已同步/)).toBeVisible({ timeout: 60_000 });

    // 已確認：兩側都顯示已確認並標示系統管理員代確認
    await p.getByLabel('申請狀態').selectOption('confirmed');
    await p.getByLabel('搜尋申請').fill(code);
    const done = p.locator('tbody tr', { hasText: code });
    await expect(done.locator('[data-side=from]')).toContainText('系統管理員代確認', { timeout: 60_000 });
    await expect(done.locator('[data-side=to]')).toContainText('系統管理員代確認');
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await registerP02([code]).catch(() => undefined);
    await purgeP02([code]).catch(() => undefined);
    await admin.dispose();
    await ctx.close();
  }
});

test('店長指派頁：門市已有其他店長時顯示「已有店長」提示', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const db = adminDb();
  const st = await p02Stores();
  const { data: manager } = await db.from('profiles').select('id').eq('email', 'vue-workspace-store-manager@example.test').single();
  const { data: existing } = await db.from('store_managers').select('id').eq('store_id', st.ZT04).eq('role_type', 'store_manager');
  let insertedId = '';
  if (!existing?.length) {
    const { data: row, error } = await db.from('store_managers').insert({ store_id: st.ZT04, user_id: manager.id, role_type: 'store_manager', is_primary: true }).select('id').single();
    if (error) throw new Error(`建立店長任命 fixture 失敗：${error.message}`);
    insertedId = row.id;
    createRegistry({ runId: runIdOrThrow() }).record({ table: 'store_managers', column: 'id', values: [String(row.id)], note: 'P02 店長任命 fixture' });
  }
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = collectErrors(page);
    await openNativePage(page, '店長指派');
    const p = workPanel(page);
    await p.getByLabel('搜尋店長').fill('測試督導');
    await p.locator('.person-option').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('搜尋門市').fill('ZT04');
    const choice = dialog.locator('.store-choice', { hasText: 'ZT04' });
    await expect(choice).toBeVisible({ timeout: 60_000 });
    await expect(choice.locator('.has-manager')).toContainText('已有店長：');
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    if (insertedId) await db.from('store_managers').delete().eq('id', insertedId);
    await ctx.close();
  }
});
