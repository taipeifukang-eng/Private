import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, BASE_URL, ROLE_STATE_FILE, account, grantAdminLikeRole, insertMaster, marker, readMaster, registerInspection, taipeiDate, type Who } from '../support';

// 巡店定位例外 e2e（桌機 1920x1080，對 DEV 與本機 legacy dev server）。
// 以 Playwright 模擬定位：誤差 25000 公尺（只接網路線的桌機）、權限被拒、成功（誤差 20）。
//  - 有權限者（角色授權）與系統管理員：失敗面板出現「使用定位例外送出」，按下後表單解鎖，送出帶 gps_exempt = true。
//  - 沒有權限者：面板與教學視窗都沒有按鈕，表單維持鎖住。
//  - 清單與內容頁顯示「定位例外」標籤；清單可只看定位例外。
// 設定 GPSEX_SHOTS_DIR 時，在 networkidle 後存 1920x1080 截圖（a）~（d）。

const SHOTS = process.env.GPSEX_SHOTS_DIR || '';
const FAR = { latitude: 25.033, longitude: 121.5654, accuracy: 25000 };
const GOOD = { latitude: 25.033, longitude: 121.5654, accuracy: 20 };

const consoleErrors: string[] = [];
const hydrationNoise: string[] = [];

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts?.ready);
  // 隱藏 Next dev 的錯誤浮層（既有 hydration 雜訊，不屬於頁面本身），只影響截圖。
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage });
}

async function newContext(browser: Browser, geo: { latitude: number; longitude: number; accuracy: number } | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}),
  });
  return ctx;
}

async function login(page: Page, who: Who) {
  const a = account(ACCOUNTS[who]);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(a.email);
  await page.locator('input[type="password"]').fill(a.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90_000 });
}

function watch(page: Page, tag: string) {
  page.on('pageerror', (e) => {
    if (/hydrat|Text content does not match/i.test(String(e))) { hydrationNoise.push(String(e).slice(0, 80)); return; }
    consoleErrors.push(`[${tag}] pageerror: ${String(e).slice(0, 200)}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 定位被拒、API 4xx 資源載入失敗屬預期；其餘記錄下來回報。
    if (/geolocation|Failed to load resource|定位|巡店記錄建立失敗|主記錄建立失敗|儲存失敗|JSON/i.test(t)) return;
    // 既有問題（與本功能無關）：PrintInspectionReport 在 render 時直接輸出目前時間，SSR 與 client 差一秒就 hydration mismatch。
    if (/hydrat|Text content did not match|PrintInspectionReport/i.test(t)) { hydrationNoise.push(t.slice(0, 80)); return; }
    consoleErrors.push(`[${tag}] console: ${t.slice(0, 200)}`);
  });
}

const panel = (page: Page) => page.getByTestId('gps-panel');
const dialog = (page: Page) => page.getByTestId('gps-guide-dialog');
const lockMain = (page: Page) => page.getByTestId('inspection-form-lock-main');
const lockBasic = (page: Page) => page.getByTestId('inspection-form-lock-basic');
// 教學視窗有右上角 X（aria-label=關閉）與底部「關閉」兩個按鈕，點底部那個。
const closeGuide = (page: Page) => dialog(page).getByText('關閉', { exact: true }).click();

async function openNew(browser: Browser, who: Who, geo: typeof FAR | null) {
  const ctx = await newContext(browser, geo);
  const page = await ctx.newPage();
  watch(page, who);
  await login(page, who);
  await page.goto('/inspection/new');
  return { ctx, page };
}

async function fillAndSaveDraft(page: Page, tag: string, storeCode = 'ZT01') {
  const notes = marker(tag);
  await expect(lockBasic(page)).toHaveJSProperty('disabled', false);
  const select = page.locator('select').first();
  await expect.poll(async () => (await select.locator('option').allTextContents()).some((t) => t.startsWith(storeCode)), { timeout: 30_000 }).toBe(true);
  await select.selectOption({ label: (await select.locator('option').allTextContents()).find((t) => t.startsWith(storeCode))! });
  await page.locator('input[type="number"][step="0.1"]').first().fill('26.5');
  await page.getByPlaceholder('請輸入其他建議或備註事項...').fill(notes);
  const messages: string[] = [];
  page.on('dialog', async (d) => {
    messages.push(d.message());
    await d.accept();
  });
  await page.getByRole('button', { name: '儲存草稿' }).click();
  await page.waitForURL(/\/inspection\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
  const id = page.url().match(/inspection\/([0-9a-f-]{36})\/edit/)![1];
  registerInspection(id);
  return { id, notes, messages };
}

test.afterAll(() => {
  // 重大 console 錯誤彙整：寫入 stdout，供回報使用。
  console.log(`[gps-exempt] console errors (${consoleErrors.length}): ${JSON.stringify(consoleErrors)}；既有 hydration 雜訊 ${hydrationNoise.length} 筆（PrintInspectionReport 時間文字，與本功能無關）`);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('有權限者：誤差 25000 → 失敗面板出現「使用定位例外送出」，教學提示數公里，按下後解鎖並以 gps_exempt = true 儲存（誤差照存）', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'allowed', FAR);
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
    await expect(page.getByTestId('gps-error')).toContainText('定位誤差過大（±25000 公尺）');
    // 教學視窗自動開啟：誤差 >= 5000 的專屬提示，並有「使用定位例外送出」
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toContainText('誤差達數公里，這台電腦可能沒有 WiFi（只接網路線無法精準定位），請改用手機；或請有「巡店定位例外」權限的主管使用定位例外');
    await expect(page.getByTestId('gps-guide-exempt')).toBeVisible();
    await closeGuide(page);
    await expect(dialog(page)).toHaveCount(0);

    // 面板上有按鈕；表單仍鎖住
    await expect(page.getByTestId('gps-exempt-button')).toBeVisible();
    await expect(lockMain(page)).toHaveJSProperty('disabled', true);
    await expect(lockBasic(page)).toHaveJSProperty('disabled', true);
    await shot(page, 'a-gps-failure-with-exempt-button.png');

    await page.getByTestId('gps-exempt-button').click();
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'exempt');
    await expect(page.getByTestId('gps-exempt-status')).toContainText('已使用巡店定位例外');
    await expect(page.getByTestId('gps-exempt-fix')).toContainText('±25000m');
    await expect(lockMain(page)).toHaveJSProperty('disabled', false);
    await expect(lockBasic(page)).toHaveJSProperty('disabled', false);
    await expect(page.getByTestId('gps-exempt-button')).toHaveCount(0);

    const saved = await fillAndSaveDraft(page, 'ui-far', 'ZT03');
    const row = await readMaster(saved.id);
    expect(row).toMatchObject({ gps_exempt: true, inspection_type: 'supervisor' });
    expect(Number(row!.gps_accuracy)).toBe(25000);
    expect(Number(row!.gps_latitude)).toBeCloseTo(FAR.latitude, 4);
    expect(row!.gps_timestamp).toBeTruthy();
    expect(row!.inspection_date).toBe(taipeiDate());
  } finally {
    await ctx.close();
  }
});

test('沒有權限者：同樣的失敗，面板與教學視窗都沒有例外按鈕，表單維持鎖住', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'denied', FAR);
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
    await expect(page.getByTestId('gps-error')).toContainText('定位誤差過大（±25000 公尺）');
    await expect(dialog(page)).toBeVisible();
    // 提示仍說明可請有權限的主管使用例外
    await expect(page.getByTestId('gps-guide-note')).toContainText('誤差達數公里');
    await expect(page.getByTestId('gps-guide-exempt')).toHaveCount(0);
    await closeGuide(page);
    await expect(page.getByTestId('gps-exempt-button')).toHaveCount(0);
    await expect(page.getByText('使用定位例外送出')).toHaveCount(0);
    await expect(lockMain(page)).toHaveJSProperty('disabled', true);
    await expect(lockBasic(page)).toHaveJSProperty('disabled', true);
    await shot(page, 'b-gps-failure-without-permission.png');
  } finally {
    await ctx.close();
  }
});

test('誤差 1500（1000~4999）：教學維持原提示，不出現數公里字樣；有權限者仍有例外按鈕', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'allowed', { ...FAR, accuracy: 1500 });
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
    await expect(page.getByTestId('gps-guide-note')).toContainText('定位誤差過大');
    await expect(page.getByTestId('gps-guide-note')).not.toContainText('誤差達數公里');
    await closeGuide(page);
    await expect(page.getByTestId('gps-exempt-button')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('有權限者：定位成功（誤差 20）時不出現例外按鈕，一般儲存不帶 gps_exempt', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'allowed', GOOD);
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
    await expect(page.getByTestId('gps-exempt-button')).toHaveCount(0);
    await expect(page.getByTestId('gps-exempt-status')).toHaveCount(0);
    const saved = await fillAndSaveDraft(page, 'ui-good', 'ZT02');
    const row = await readMaster(saved.id);
    expect(row).toMatchObject({ gps_exempt: false });
    expect(Number(row!.gps_accuracy)).toBe(20);
  } finally {
    await ctx.close();
  }
});

test('系統管理員（不需角色授權）：定位權限被拒 → 例外 → 儲存，gps 欄位為空、gps_exempt = true', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'admin', null); // 不授予定位權限
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 40_000 });
    await expect(dialog(page)).toBeVisible();
    await closeGuide(page);
    await page.getByTestId('gps-exempt-button').click();
    await expect(page.getByTestId('gps-exempt-fix')).toContainText('未取得定位，將不記錄座標');
    const saved = await fillAndSaveDraft(page, 'ui-nogps', 'ZT03');
    const row = await readMaster(saved.id);
    expect(row).toMatchObject({ gps_exempt: true, gps_latitude: null, gps_longitude: null, gps_accuracy: null, gps_timestamp: null });
    expect(row!.inspection_date).toBe(taipeiDate());
  } finally {
    await ctx.close();
  }
});

test('例外後改回重新定位：定位成功即回到一般流程（不再是例外）', async ({ browser }) => {
  const { ctx, page } = await openNew(browser, 'allowed', FAR);
  try {
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
    await closeGuide(page);
    await page.getByTestId('gps-exempt-button').click();
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'exempt');
    await ctx.setGeolocation(GOOD);
    await page.getByTestId('gps-retry').click();
    await expect(panel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
    await expect(page.getByTestId('gps-exempt-status')).toHaveCount(0);
    await expect(page.getByTestId('gps-accuracy')).toContainText('±20m');
  } finally {
    await ctx.close();
  }
});

test('清單與內容頁：定位例外標籤、只看定位例外篩選；一般巡店沒有標籤', async ({ browser }) => {
  // 準備一筆例外（service role，誤差 25000）與一筆一般巡店，都落在今天（台北）所在月份。
  const month = taipeiDate().slice(0, 7);
  const ex = await insertMaster({ tag: 'list-ex', storeCode: 'VW001', patch: { gps_exempt: true, gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 25000, gps_timestamp: new Date().toISOString(), status: 'completed', total_score: 180, grade: '8' } });
  const normal = await insertMaster({ tag: 'list-normal', storeCode: 'VW002', patch: { gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 20, gps_timestamp: new Date().toISOString(), status: 'completed', total_score: 150, grade: '6' } });
  expect(ex.error, JSON.stringify(ex.error)).toBeNull();
  expect(normal.error, JSON.stringify(normal.error)).toBeNull();

  const ctx = await newContext(browser, null);
  const page = await ctx.newPage();
  watch(page, 'list');
  try {
    await login(page, 'admin');
    await page.goto(`/inspection?tab=supervisor&month=${month}`);
    const rowFor = (id: string) => page.locator(`tr:has(a[href="/inspection/${id}"])`);
    await expect(rowFor(ex.data!.id)).toBeVisible();
    await expect(rowFor(ex.data!.id).getByTestId('gps-exempt-badge')).toHaveText('定位例外');
    await expect(rowFor(normal.data!.id)).toBeVisible();
    await expect(rowFor(normal.data!.id).getByTestId('gps-exempt-badge')).toHaveCount(0);

    // 篩選：只看定位例外
    const filter = page.getByTestId('gps-exempt-filter');
    await expect(filter).toContainText('只看定位例外');
    await filter.click();
    await expect(page).toHaveURL(/gps_exempt=1/);
    await expect(page).toHaveURL(new RegExp(`month=${month}`));
    await expect(rowFor(ex.data!.id)).toBeVisible();
    await expect(rowFor(normal.data!.id)).toHaveCount(0);
    const badges = await page.getByTestId('gps-exempt-badge').count();
    const rows = await page.locator('tbody tr').count();
    expect(rows, '篩選後每一列都是定位例外').toBe(badges);
    // 列表區塊在首屏下方：捲到篩選處再截圖（另存整頁）
    await page.getByRole('heading', { name: '巡店記錄', exact: true }).scrollIntoViewIfNeeded();
    await shot(page, 'c-inspection-list-badge-and-filter.png');
    await shot(page, 'c-inspection-list-badge-and-filter-fullpage.png', true);

    // 取消篩選
    await page.getByTestId('gps-exempt-filter').click();
    await expect(page).not.toHaveURL(/gps_exempt=1/);
    await expect(rowFor(normal.data!.id)).toBeVisible();

    // 內容頁
    await page.goto(`/inspection/${ex.data!.id}`);
    await expect(page.getByTestId('gps-exempt-badge')).toHaveText('定位例外');
    await expect(page.getByText('±25000m')).toBeVisible();
    await shot(page, 'd-inspection-detail-badge.png');
    await page.goto(`/inspection/${normal.data!.id}`);
    await expect(page.getByText('巡店單號')).toBeVisible();
    await expect(page.getByTestId('gps-exempt-badge')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('角色權限頁：巡店定位例外以「巡店定位」功能下的「巡店定位例外」顯示', async ({ browser }) => {
  const { roleId } = JSON.parse(fs.readFileSync(ROLE_STATE_FILE, 'utf8'));
  const ctx = await newContext(browser, null);
  const page = await ctx.newPage();
  watch(page, 'roles');
  try {
    await login(page, 'admin');
    await page.goto(`/admin/roles/${roleId}`);
    await expect(page.getByText('巡店定位例外').first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await ctx.close();
  }
});

test('管理員樣式角色代碼（profiles.role 不是 admin、沒有明確授權）：前端與資料庫一致，不出現例外按鈕', async ({ browser }) => {
  const cleanup = await grantAdminLikeRole('denied');
  try {
    const { ctx, page } = await openNew(browser, 'denied', FAR);
    try {
      await expect(panel(page)).toHaveAttribute('data-gps-status', 'error', { timeout: 30_000 });
      await expect(dialog(page)).toBeVisible();
      await expect(page.getByTestId('gps-guide-exempt')).toHaveCount(0);
      await closeGuide(page);
      await expect(page.getByTestId('gps-exempt-button')).toHaveCount(0);
      await expect(lockMain(page)).toHaveJSProperty('disabled', true);
      // API 與資料庫判斷同一來源
      const res = await page.request.get('/api/inspection/gps-exempt-eligibility');
      expect(await res.json()).toEqual({ allowed: false });
    } finally {
      await ctx.close();
    }
  } finally {
    await cleanup();
  }
});

test('清單：切換督導／經理分頁時保留「只看定位例外」與月份', async ({ browser }) => {
  const ctx = await newContext(browser, null);
  const page = await ctx.newPage();
  watch(page, 'tabs');
  try {
    await login(page, 'admin');
    await page.goto('/inspection?tab=supervisor&month=2026-11&gps_exempt=1');
    const manager = page.getByRole('link', { name: '經理巡店', exact: true });
    await expect(manager).toHaveAttribute('href', '/inspection?tab=manager&month=2026-11&gps_exempt=1');
    await expect(page.getByRole('link', { name: '督導巡店', exact: true })).toHaveAttribute('href', '/inspection?tab=supervisor&month=2026-11&gps_exempt=1');
  } finally {
    await ctx.close();
  }
});
