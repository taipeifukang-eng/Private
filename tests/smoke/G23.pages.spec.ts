import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, pageForUser, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G23 冒煙層：水電電話網路費（帳單列表）與費用報表兩頁可開、標題與摘要卡、主要 API 200、無 pageerror／console 錯誤、
// 桌機 1440 與手機 390 無水平溢出（project viewport）、側欄入口與權限一致（沒有權限沒有入口、直接打 API 403）、水電檢視者是唯讀（沒有新增按鈕與詳情動作）、店長看不到。
// 帳號：DEV 真實角色 vue_workspace_ga6_*（水電管理、水電檢視、只有分類區域）與真正店長角色。
const U = '/api/workspace/general-affairs/utility-bills';
const GROUP = '水電電話網路費';
const KEYS: Ga6Key[] = ['util_mgr', 'util_view', 'cat_only', 'store_mgr', 'nobody'];
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const past = (n: number) => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const st = await stores();
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  for (const [i, over] of [{ due_date: past(5), amount: 4321 }, { expense_type: 'ELECTRICITY', electricity_kwh: 100, due_date: '2038-12-31', amount: 8000 }, { store_id: st.VW002.id, expense_type: 'PHONE' }].entries()) {
    const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-06', provider_name: ga6Name('SMK'), service_identifier: `QA-GA6-SMK-${i}`, amount: 1000, ...over }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('水電管理：側欄有帳單列表與費用報表；兩頁可開、標題與摘要卡、新增按鈕、API 200、無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.util_mgr, testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toEqual(expect.arrayContaining(['帳單列表', '費用報表']));
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes('/general-affairs/utility-bills') && calls.push(String(r.status())));
    await gaNavToIn(page, GROUP, '帳單列表');
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await expect(page.getByRole('list', { name: '帳單摘要' }).locator('visible=true').getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('stat-pending').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('stat-filtered').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('new-bill').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('open-report').locator('visible=true')).toBeVisible();
    // 這份測試帳單是 2038-06 與過去的到期日；全部月份看逾期那一筆
    await page.getByTestId('filter-month').locator('visible=true').fill('2038-06');
    await page.getByTestId('bill-search').locator('visible=true').fill('QA-GA6-SMK');
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(3);
    await expect(page.getByTestId('bill-total').locator('visible=true')).toHaveText('共 3 筆');
    await expect(page.locator('[data-testid="bill-status"]:visible', { hasText: '已逾期' })).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    await expect(page.getByTestId('bd-edit')).toBeVisible();
    await expect(page.getByTestId('bd-pay')).toBeVisible();
    await expect(page.getByTestId('bd-delete')).toBeVisible();
    await page.getByTestId('bd-close').click();

    await gaNavToIn(page, GROUP, '費用報表');
    await expect(visibleHeading(page, '費用報表')).toBeVisible();
    await expect(page.getByTestId('rp-table').locator('visible=true')).toBeVisible();
    await expect.poll(async () => page.locator('[data-testid="rp-row"]:visible').count(), { timeout: 20_000 }).toBeGreaterThan(5);
    await expect(page.getByTestId('rp-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('水電檢視：看得到帳單與報表，但沒有新增按鈕，詳情沒有編輯、標記已繳、刪除；寫入 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.util_view, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toEqual(expect.arrayContaining(['帳單列表', '費用報表']));
    await gaNavToIn(page, GROUP, '帳單列表');
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await page.getByTestId('filter-month').locator('visible=true').fill('2038-06');
    await page.getByTestId('bill-search').locator('visible=true').fill('QA-GA6-SMK');
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(3);
    await expect(page.getByTestId('new-bill')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    for (const t of ['bd-edit', 'bd-pay', 'bd-unpay', 'bd-delete']) await expect(page.getByTestId(t)).toHaveCount(0);
    await page.getByTestId('bd-close').click();
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await apis.util_view.get(U)).status()).toBe(200);
  expect((await apis.util_view.post(U, { data: { expense_type: 'WATER' } })).status()).toBe(403);
});

test('沒有權限沒有入口：店長、只有分類區域、只有服務中心入口者側欄沒有「水電電話網路費」，水電網費 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const key of ['store_mgr', 'cat_only', 'nobody']) {
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      for (const l of [GROUP, '帳單列表', '費用報表']) expect(labels, `${key} 不應看到 ${l}`).not.toContain(l);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
    expect((await apis[key].get(U)).status(), key).toBe(403);
    expect((await apis[key].get(`${U}/report?mode=year&year=2038`)).status(), key).toBe(403);
  }
});
