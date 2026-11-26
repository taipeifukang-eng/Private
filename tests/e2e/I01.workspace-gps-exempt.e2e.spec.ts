import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { apiAs, loginAs, BYPASS_HEADERS, TEST_ORIGIN } from '../support/auth';
import { apiForGpe, setupGpe, type GpeUser } from '../support/gpe-ws-fixtures';
import {
  applyProjectViewport,
  buildBody,
  deleteRunInspections,
  findMasterByNotes,
  gpsPanel,
  grantGeolocation,
  isMobile,
  marker,
  noPageOverflow,
  openInspectionList,
  openNativeNew,
  registerInspection,
  runIdOrThrow,
  storeCodeFor,
  storeIdByCode,
  workPage,
} from '../support/i01-fixtures';
import { selectStore, sign } from '../support/w14-ui';

// 新版巡店「定位例外」e2e（桌機 1440、手機 390）：三種角色。
//  a. 有 inspection.gps_exempt 的督導角色：誤差 ±25000 時看得到「使用定位例外送出」，新增後 gps_exempt=true、列表有「定位例外」標籤。
//  b. 沒有該權限的角色：沒有按鈕（面板與教學視窗），直接 POST gps_exempt=true 回 403，且沒有留下任何巡店。
//  c. 系統管理員：看得到按鈕。
// 測試帳號與角色以 gpe-test-／gpe_test_ 為前綴（見 tests/support/gpe-ws-fixtures.ts），結束後清除；
// 巡店資料只在 ZT 測試門市，備註帶 ZT<runId> 標記，結束時刪除。

const FAR = { latitude: 25.033, longitude: 121.5654, accuracy: 25000 };
const SHOT_DIR = process.env.GPS_SHOT_DIR || path.resolve(__dirname, '..', 'reports', 'gps-shots');
const ed = (page: Page) => workPage(page);
const guide = (page: Page) => page.getByTestId('gps-guide-dialog');

test.describe.configure({ mode: 'serial' });

let users: Record<'yes' | 'no', GpeUser>;
let teardown: () => Promise<string[]>;

test.beforeAll(async () => {
  runIdOrThrow();
  ({ users, teardown } = await setupGpe());
});
test.afterAll(async () => {
  const problems: string[] = [];
  try {
    await deleteRunInspections();
  } catch (e) {
    problems.push(String(e));
  }
  if (teardown) problems.push(...(await teardown()));
  expect(problems, '清除測試資料').toEqual([]);
});

async function browserFor(browser: Browser, user: GpeUser): Promise<BrowserContext> {
  const api = await apiForGpe(user);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state, extraHTTPHeaders: BYPASS_HEADERS });
}

async function prepare(ctx: BrowserContext, testInfo: TestInfo) {
  await grantGeolocation(ctx, TEST_ORIGIN, FAR);
  const page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/geolocation|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  return { page, errors };
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const mobile = isMobile(testInfo);
  if (!mobile) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle');
  await ed(page).getByTestId('gps-panel').scrollIntoViewIfNeeded();
  const file = path.join(SHOT_DIR, `${name}-${mobile ? 'mobile390' : 'desktop1920x1080'}.png`);
  await page.screenshot({ path: file });
  testInfo.attachments.push({ name, path: file, contentType: 'image/png' });
  if (!mobile) await applyProjectViewport(page, testInfo);
}

async function expectFarRejected(page: Page) {
  await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
  await expect(gpsPanel(page).getByTestId('gps-error')).toContainText('25000');
}

test('a. 有定位例外權限的督導：誤差 25000 出現按鈕，例外送出後 gps_exempt=true，列表有標籤', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await browserFor(browser, users.yes);
  const { page, errors } = await prepare(ctx, testInfo);
  try {
    // 伺服器旗標
    const flag = await page.request.get('/api/workspace/inspection-form', { params: { type: 'supervisor' } });
    expect(flag.status()).toBe(200);
    expect((await flag.json()).gpsExemptAllowed).toBe(true);

    await openNativeNew(page);
    await expectFarRejected(page);
    await expect(ed(page).getByLabel('巡店門市')).toBeDisabled();
    // 面板與（自動跳出的）教學視窗都有按鈕
    await expect(page.getByTestId('gps-exempt-button')).toBeVisible();
    if (await guide(page).isVisible()) await expect(page.getByTestId('gps-guide-exempt')).toBeVisible();
    await expect(page.getByTestId('gps-hint')).toContainText('巡店定位例外');

    // 沒有教學視窗擋著時按面板上的按鈕；有的話按教學視窗底部的按鈕（兩個入口都驗）
    if (await guide(page).isVisible()) await page.getByTestId('gps-guide-exempt').click();
    else await page.getByTestId('gps-exempt-button').click();
    await expect(guide(page)).toHaveCount(0);
    await expect(page.getByTestId('gps-exempt-status')).toContainText('已使用巡店定位例外');
    await expect(page.getByTestId('gps-retry')).toHaveText('改回重新定位');
    await expect(ed(page).getByLabel('巡店門市')).toBeEnabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeEnabled();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await shot(page, testInfo, 'exempt-eligible-role');

    const code = storeCodeFor(testInfo);
    const notes = marker('a-' + (isMobile(testInfo) ? 'm' : 'd'));
    await selectStore(page, code);
    await ed(page).getByLabel(/室內溫度/).fill('26.5');
    await ed(page).getByLabel('巡店備註').fill(notes);
    await sign(page, 0);
    await sign(page, 1);
    await expect(ed(page).getByRole('button', { name: '提交巡店' })).toBeEnabled();
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect.poll(async () => (await findMasterByNotes(notes)).length, { timeout: 30_000 }).toBe(1);
    const row = (await findMasterByNotes(notes))[0];
    await registerInspection(row.id);
    expect(row.gps_exempt).toBe(true);
    expect(row.status).toBe('completed');
    expect(Number(row.gps_accuracy)).toBe(25000);

    // 列表：標籤與「只看定位例外」篩選
    await openInspectionList(page);
    const tr = ed(page).locator('tbody tr', { hasText: row.id.replace(/-/g, '') });
    await expect(tr).toBeVisible({ timeout: 30_000 });
    await expect(tr.getByTestId('gps-exempt-badge')).toHaveText('定位例外');
    await ed(page).getByTestId('gps-exempt-filter').click();
    await expect(ed(page).locator('tbody tr', { hasText: row.id.replace(/-/g, '') })).toBeVisible();
    expect(await noPageOverflow(page), '列表頁水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('b. 沒有定位例外權限的角色：沒有按鈕，直接 POST gps_exempt=true 回 403 且不留資料', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await browserFor(browser, users.no);
  const { page, errors } = await prepare(ctx, testInfo);
  const api: APIRequestContext = await apiForGpe(users.no);
  try {
    const flag = await api.get('/api/workspace/inspection-form', { params: { type: 'supervisor' } });
    expect(flag.status()).toBe(200);
    expect((await flag.json()).gpsExemptAllowed).toBe(false);

    await openNativeNew(page);
    await expectFarRejected(page);
    await expect(page.getByTestId('gps-retry')).toBeVisible();
    await expect(page.getByTestId('gps-exempt-button')).toHaveCount(0);
    await expect(page.getByTestId('gps-guide-exempt')).toHaveCount(0);
    await expect(page.getByTestId('gps-hint')).not.toContainText('巡店定位例外');
    await expect(ed(page).getByLabel('巡店門市')).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeDisabled();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);

    // 直接打 API：帶 gps_exempt=true 一律 403（不能靠偽造前端旗標繞過）。
    const admin = await apiAs('admin');
    const storeId = await storeIdByCode(admin, storeCodeFor(testInfo, 1));
    await admin.dispose();
    const notes = marker('b-' + (isMobile(testInfo) ? 'm' : 'd'));
    const body = await buildBody(api, storeId, 'b-' + (isMobile(testInfo) ? 'm' : 'd'), { gps: { ...FAR, capturedAt: new Date().toISOString() }, gps_exempt: true });
    const res = await api.post('/api/workspace/inspection-form', { data: body });
    expect(res.status()).toBe(403);
    expect(JSON.stringify(await res.json().catch(() => ({})))).toContain('巡店定位例外');
    // 沒有座標、gps_exempt=true 也一樣被擋
    const res2 = await api.post('/api/workspace/inspection-form', { data: { ...body, writeId: crypto.randomUUID(), gps: null, gps_exempt: true } });
    expect(res2.status()).toBe(403);
    // 一般送出（誤差 25000、沒帶 gps_exempt）仍被擋成 400
    const res3 = await api.post('/api/workspace/inspection-form', { data: { ...body, writeId: crypto.randomUUID(), gps_exempt: undefined } });
    expect(res3.status()).toBe(400);
    expect(await findMasterByNotes(notes), '被拒絕的請求不可留下巡店').toHaveLength(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await api.dispose();
    await ctx.close();
  }
});

test('c. 系統管理員：誤差 25000 時按鈕可用，按下後表單解鎖', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  const { page, errors } = await prepare(ctx, testInfo);
  try {
    const flag = await page.request.get('/api/workspace/inspection-form', { params: { type: 'supervisor' } });
    expect((await flag.json()).gpsExemptAllowed).toBe(true);
    await openNativeNew(page);
    await expectFarRejected(page);
    await expect(page.getByTestId('gps-exempt-button')).toBeVisible();
    if (await guide(page).isVisible()) {
      await expect(page.getByTestId('gps-guide-exempt')).toBeVisible();
      await page.getByTestId('gps-guide-exempt').click();
      await expect(guide(page)).toHaveCount(0);
    } else {
      await page.getByTestId('gps-exempt-button').click();
    }
    await expect(page.getByTestId('gps-exempt-status')).toContainText('已使用巡店定位例外');
    await expect(ed(page).getByLabel('巡店門市')).toBeEnabled();
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await shot(page, testInfo, 'exempt-admin');
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
