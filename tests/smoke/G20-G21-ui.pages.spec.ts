import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G20／G21 冒煙層：廠商資料、服務分類、服務區域三頁可開、標題與統計卡、主要 API 200、無 pageerror／console 錯誤、
// 桌機 1440 與手機 390 無水平溢出（project viewport）、側欄入口與權限一致（沒有權限沒有入口、直接打 API 403）、首頁廠商入口導向第一個可進的廠商頁、
// 帳務欄位只在廠商檢視／管理權限者的畫面出現。帳號：DEV 真實角色 vue_workspace_ga6_*（總務全套、廠商管理、只有分類區域、只有合作紀錄）與真正店長角色。
const V = '/api/workspace/general-affairs/vendors';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}
const KEYS: Ga6Key[] = ['ga_all', 'vendor_mgr', 'cat_only', 'coop_only', 'store_mgr', 'nobody'];
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  await seedGa6Vendor('SMK', { tax_id: '04595257', contact_name: '冒煙聯絡人', contact_phone: '02-2222-3333' });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

test('總務全套：側欄有廠商資料、服務分類、服務區域；三頁可開、標題與統計卡、API 200、無錯誤、無水平溢出；廠商頁有帳務欄位與新增按鈕', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toEqual(expect.arrayContaining(['廠商資料', '服務分類', '服務區域']));
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes('/api/workspace/general-affairs/') && /vendors|service-/.test(r.url()) && calls.push(String(r.status())));
    await nav(page, '廠商資料');
    await expect(visibleHeading(page, '廠商資料')).toBeVisible();
    await expect(page.getByRole('list', { name: '廠商統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(5);
    await expect(page.getByTestId('vendor-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('new-vendor').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('open-print').locator('visible=true')).toBeVisible();
    await page.getByTestId('vendor-search').locator('visible=true').fill('QA-GA6-');
    const card = page.locator('[data-testid="vendor-card"]:visible', { hasText: 'SMK' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('04595257');
    expect(await noPageOverflow(page)).toBe(true);
    await card.getByTestId('open-detail').click();
    await expect(page.getByTestId('vd-tax')).toHaveText('04595257');
    await expect(page.getByTestId('vd-terms')).toBeVisible();
    await page.getByTestId('vd-close').click();

    await nav(page, '服務分類');
    await expect(visibleHeading(page, '服務分類')).toBeVisible();
    await expect(page.getByTestId('new-item').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('stat-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);

    await nav(page, '服務區域');
    await expect(visibleHeading(page, '服務區域')).toBeVisible();
    // 縣市行政區固定資料已放入：全部筆數大於 300（22 縣市、約 368 行政區、加四大區）。
    await expect.poll(async () => Number(await page.getByTestId('stat-total').locator('visible=true').innerText()), { timeout: 20_000 }).toBeGreaterThan(300);
    await expect(page.getByTestId('tree-row').locator('visible=true').first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('首頁廠商入口導向可進入的第一個廠商頁：廠商管理者進廠商資料；只有分類區域檢視者進服務分類', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const [key, heading] of [['vendor_mgr', '廠商資料'], ['cat_only', '服務分類']] as const) {
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page);
      const entry = page.getByTestId('ga-vendor-entry').locator('visible=true');
      await expect(entry).toBeVisible();
      await entry.click();
      await expect(visibleHeading(page, heading)).toBeVisible();
      expect(await noPageOverflow(page)).toBe(true);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('廠商管理者：看得到廠商資料與帳務欄位與新增按鈕，看不到服務分類與服務區域（沒有那兩個權限）；API 對應 200', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.vendor_mgr, testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toContain('廠商資料');
    expect(labels).not.toContain('服務分類');
    expect(labels).not.toContain('服務區域');
    await nav(page, '廠商資料');
    await expect(page.getByTestId('new-vendor').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await apis.vendor_mgr.get(V)).status()).toBe(200);
  // 廠商權限者可唯讀分類下拉（廠商表單用）
  expect((await apis.vendor_mgr.get('/api/workspace/general-affairs/service-categories')).status()).toBe(200);
});

test('只有分類區域檢視權限：側欄有服務分類與服務區域、沒有廠商資料；分類頁沒有新增按鈕（唯讀）；廠商 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.cat_only, testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toEqual(expect.arrayContaining(['服務分類', '服務區域']));
    expect(labels).not.toContain('廠商資料');
    await nav(page, '服務分類');
    await expect(visibleHeading(page, '服務分類')).toBeVisible();
    await expect(page.getByTestId('stat-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('new-item')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await apis.cat_only.get(V)).status()).toBe(403);
});

test('沒有權限沒有入口：只有合作紀錄權限者、店長、只有服務中心入口者側欄沒有三個頁面、首頁沒有廠商入口、廠商 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const key of ['coop_only', 'store_mgr', 'nobody']) {
    const { ctx, page, errors } = await pageForUser(browser, states[key], testInfo);
    try {
      await openGaCenter(page);
      const labels = await sideLabels(page);
      for (const l of ['廠商資料', '服務分類', '服務區域']) expect(labels, `${key} 不應看到 ${l}`).not.toContain(l);
      await expect(page.getByTestId('ga-vendor-entry')).toHaveCount(0);
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
    expect((await apis[key].get(V)).status(), key).toBe(403);
    expect((await apis[key].get('/api/workspace/general-affairs/service-categories')).status(), key).toBe(403);
  }
});
