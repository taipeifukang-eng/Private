import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs, TEST_ORIGIN } from '../support/auth';
import { formatTaipeiDate } from '../../lib/inspection/gps-policy';
import { sign } from '../support/w14-ui';
import {
  GPS_BASE,
  applyProjectViewport,
  createInspectionViaApi,
  deleteRunInspections,
  findMasterByNotes,
  geoCalls,
  geoFail,
  geoRespond,
  gpsPanel,
  grantGeolocation,
  installGeoStub,
  marker,
  noPageOverflow,
  openNativeEdit,
  openNativeNew,
  readMaster,
  registerInspection,
  runIdOrThrow,
  storeCodeFor,
  storeIdByCode,
  workPage,
} from '../support/i01-fixtures';

// I01 e2e：新增巡店強制定位（桌機 1440、手機 390）。
// 成功解鎖（Playwright 真實 geolocation 權限）、拒絕權限、逾時、誤差 1500、誤差 700、
// 草稿還原仍鎖、編輯不覆蓋 gps_*；以及高精度逾時改用一般定位、送出前時間窗過期重新定位。
// 測試資料只用測試門市（ZT01 / ZT02），備註帶 ZT<runId> 標記，結束時清除。

const ed = (page: Page) => workPage(page);
const storeSelect = (page: Page) => ed(page).getByLabel('巡店門市');
const guide = (page: Page) => page.getByTestId('gps-guide-dialog');

test.afterAll(async () => {
  await deleteRunInspections();
});

async function openAs(browser: any, testInfo: any, opts: { stub?: boolean; geo?: typeof GPS_BASE } = {}) {
  const ctx = await loginAs(browser, 'admin');
  const page: Page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/geolocation|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  if (opts.stub) await installGeoStub(page);
  if (opts.geo) await grantGeolocation(ctx, TEST_ORIGIN, opts.geo);
  return { ctx, page, errors };
}

test('成功解鎖：定位成功後表單解鎖，日期依定位時間（台北），儲存草稿寫入 gps_*', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  runIdOrThrow();
  const { ctx, page, errors } = await openAs(browser, testInfo, { geo: GPS_BASE });
  try {
    await openNativeNew(page);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
    await expect(gpsPanel(page)).toContainText('✓ 已定位');
    await expect(gpsPanel(page).getByTestId('gps-accuracy')).toHaveText('精度: ±20m');
    await expect(guide(page)).toHaveCount(0);
    await expect(storeSelect(page)).toBeEnabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeEnabled();
    await expect(ed(page).getByLabel('巡店日期')).toHaveValue(formatTaipeiDate(new Date()));
    await expect(ed(page).getByRole('button', { name: '清除定位' })).toHaveCount(0);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);

    const notes = marker('ok-' + (testInfo.project.name === 'mobile-390' ? 'm' : 'd'));
    await storeSelect(page).selectOption({ label: await optionFor(page, storeCodeFor(testInfo)) });
    await ed(page).getByLabel(/室內溫度/).fill('26.5');
    await ed(page).getByLabel('巡店備註').fill(notes);
    await ed(page).getByRole('button', { name: '儲存草稿' }).click();
    await expect(ed(page).getByText('草稿已儲存')).toBeVisible({ timeout: 30_000 });
    const rows = await findMasterByNotes(notes);
    expect(rows).toHaveLength(1);
    await registerInspection(rows[0].id);
    expect(Number(rows[0].gps_latitude)).toBeCloseTo(GPS_BASE.latitude, 4);
    expect(Number(rows[0].gps_longitude)).toBeCloseTo(GPS_BASE.longitude, 4);
    expect(Number(rows[0].gps_accuracy)).toBe(20);
    expect(Math.abs(Date.parse(rows[0].gps_timestamp) - Date.now())).toBeLessThan(5 * 60_000);
    expect(rows[0].inspection_date).toBe(formatTaipeiDate(rows[0].gps_timestamp));
    // 儲存後進入編輯模式：定位唯讀、沒有重新定位按鈕。
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'readonly');
    await expect(ed(page).getByRole('button', { name: '重新定位' })).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

async function optionFor(page: Page, code: string): Promise<string> {
  const read = () => storeSelect(page).locator('option').allTextContents();
  await expect.poll(async () => (await read()).some((l) => l.includes(code)), { timeout: 30_000 }).toBe(true);
  return (await read()).find((l) => l.includes(code))!;
}

test('定位成功前整張表單鎖住：顯示定位中，不能選門市、填寫、儲存或送出', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  runIdOrThrow();
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'loading');
    await expect(gpsPanel(page).getByTestId('gps-loading')).toHaveText('定位中…');
    await expect(storeSelect(page)).toBeDisabled();
    await expect(ed(page).getByLabel(/室內溫度/)).toBeDisabled();
    await expect(ed(page).getByLabel('巡店備註')).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '提交巡店' })).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '加入上月在職名冊' })).toBeDisabled();
    expect(await geoCalls(page)).toEqual([{ high: true }]);
    await geoRespond(page, GPS_BASE);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await expect(storeSelect(page)).toBeEnabled();
    // M4 F3：定位成功後表單解鎖，但兩個簽名沒完成前「提交巡店」仍是灰的；完成簽名後才可按。
    await expect(ed(page).getByRole('button', { name: '提交巡店' })).toBeDisabled();
    await expect(ed(page).getByTestId('submit-signature-hint')).toContainText('簽名');
    await sign(page, 0);
    await sign(page, 1);
    await expect(ed(page).getByRole('button', { name: '提交巡店' })).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('拒絕權限：維持鎖住，顯示原因，自動跳出教學（權限加註），我開好了重新定位即可解鎖', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  runIdOrThrow();
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoFail(page, 1, true); // 高精度被拒絕 → 改用一般定位
    await geoFail(page, 1, false);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'error');
    await expect(gpsPanel(page).getByTestId('gps-error')).toContainText('定位權限被拒絕');
    expect(await geoCalls(page)).toEqual([{ high: true }, { high: false }]);
    await expect(storeSelect(page)).toBeDisabled();
    await expect(guide(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toContainText('權限被拒絕');
    await expect(page.getByTestId('gps-guide-retry')).toHaveText('我開好了，重新定位');
    // 教學視窗：四個分頁、手機 390 不可水平溢出。
    await expect(guide(page).getByRole('tab')).toHaveCount(4);
    for (const label of ['iPhone / iPad', 'Android 手機 / 平板', '從 LINE 開啟', 'Windows 桌機']) {
      await guide(page).getByRole('tab', { name: label }).click();
      await expect(guide(page).getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
      const overflow = await guide(page).evaluate((el) => {
        const d = el.closest('dialog') as HTMLElement;
        return d.scrollWidth - d.clientWidth;
      });
      expect(overflow, `教學視窗 ${label} 水平溢出`).toBeLessThanOrEqual(1);
    }
    // 最長的 LINE 分頁：主按鈕固定在視窗底部，不用捲動就看得到。
    await guide(page).getByRole('tab', { name: '從 LINE 開啟' }).click();
    const vh = page.viewportSize()!.height;
    const box = await page.getByTestId('gps-guide-retry').boundingBox();
    expect(box && box.y + box.height <= vh + 1, '我開好了，重新定位 應在可視範圍內').toBe(true);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await page.getByTestId('gps-guide-retry').click();
    await expect(guide(page)).toHaveCount(0);
    await geoRespond(page, GPS_BASE, true);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await expect(storeSelect(page)).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('平常有「定位開不了？看教學」連結；教學預設分頁依裝置', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { geo: GPS_BASE });
  try {
    await openNativeNew(page);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
    await gpsPanel(page).getByTestId('gps-guide-link').click();
    await expect(guide(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toHaveCount(0);
    // Playwright chromium 的 UA 是 Windows 桌機。
    await expect(guide(page).getByRole('tab', { name: 'Windows 桌機' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('dialog').getByRole('button', { name: '關閉', exact: true }).click();
    await expect(guide(page)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('逾時：高精度與一般定位都逾時才算失敗（加註無法取得位置或逾時）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoFail(page, 3, true);
    await geoFail(page, 3, false);
    await expect(gpsPanel(page).getByTestId('gps-error')).toContainText('定位逾時');
    await expect(guide(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toContainText('無法取得位置或逾時');
    await expect(storeSelect(page)).toBeDisabled();
  } finally {
    await ctx.close();
  }
});

test('高精度約 8 秒沒回應就改用一般定位，一般定位成功即解鎖', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await expect.poll(async () => (await geoCalls(page)).length, { timeout: 3_000 }).toBe(1);
    // 高精度不回應：約 8 秒後出現第二次（一般精度）呼叫。
    await expect.poll(async () => (await geoCalls(page)).length, { timeout: 15_000 }).toBe(2);
    expect(await geoCalls(page)).toEqual([{ high: true }, { high: false }]);
    await geoRespond(page, GPS_BASE, false);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await expect(storeSelect(page)).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('誤差 1500 公尺：視為失敗，維持鎖住，教學加註誤差過大', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoRespond(page, { ...GPS_BASE, accuracy: 1500 });
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'error');
    await expect(gpsPanel(page).getByTestId('gps-error')).toHaveText('✗ 定位誤差過大（±1500 公尺）');
    await expect(gpsPanel(page).getByTestId('gps-retry')).toHaveText('重新定位');
    await expect(storeSelect(page)).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeDisabled();
    await expect(guide(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toContainText('定位誤差過大');
    await page.getByRole('dialog').getByRole('button', { name: '關閉', exact: true }).click();
    // 用頁面上的「重新定位」按鈕再試一次，這次誤差 20 公尺 → 解鎖。
    await gpsPanel(page).getByTestId('gps-retry').click();
    await geoRespond(page, GPS_BASE, true);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await expect(storeSelect(page)).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('誤差 700 公尺：橘色提示「建議使用手機」，不擋，不跳教學', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoRespond(page, { ...GPS_BASE, accuracy: 700 });
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    const accuracy = gpsPanel(page).getByTestId('gps-accuracy');
    await expect(accuracy).toHaveText('精度: ±700m (建議使用手機)');
    await expect(accuracy).toHaveClass(/gps-warn/);
    await expect(guide(page)).toHaveCount(0);
    await expect(storeSelect(page)).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('誤差剛好 1000 公尺仍可通過（橘色提示）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoRespond(page, { ...GPS_BASE, accuracy: 1000 });
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await expect(gpsPanel(page).getByTestId('gps-accuracy')).toContainText('建議使用手機');
  } finally {
    await ctx.close();
  }
});

test('草稿還原仍鎖：重新進入新增頁不沿用舊定位；已存草稿以編輯模式開啟不重新定位', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const admin = await apiAs('admin');
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  let id = '';
  try {
    const storeId = await storeIdByCode(admin, storeCodeFor(testInfo, 1));
    const created = await createInspectionViaApi(admin, storeId, 'restore-' + (testInfo.project.name === 'mobile-390' ? 'm' : 'd'));
    expect(created.res.status(), JSON.stringify(created.json)).toBe(200);
    id = created.json.record.id;
    await registerInspection(id);

    // (1) 第一次進入新增頁並定位成功，填入內容，但不儲存。
    await openNativeNew(page);
    await geoRespond(page, GPS_BASE);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await ed(page).getByLabel(/室內溫度/).fill('27');
    // (2) 重新載入工作台（開啟頁面會重新載入，等同暫存內容還原的時機）→ 再開新增頁：必須重新定位，沒回應前仍鎖住。
    await openNativeNew(page);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'loading');
    await expect(storeSelect(page)).toBeDisabled();
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeDisabled();
    expect((await geoCalls(page)).length).toBeGreaterThanOrEqual(1);

    // (3) 已存草稿（status=draft）：以編輯模式開啟，不重新定位、定位唯讀。
    await openNativeEdit(page, id); // 重新載入頁面，geolocation 呼叫紀錄歸零
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'readonly');
    await expect(gpsPanel(page).getByTestId('gps-readonly')).toContainText('25.03300');
    await expect(storeSelect(page)).toBeEnabled();
    await expect(ed(page).getByLabel('巡店日期')).toBeDisabled();
    expect(await geoCalls(page)).toEqual([]);
  } finally {
    await admin.dispose();
    await ctx.close();
  }
});

test('編輯不覆蓋 gps_*：儲存編輯後定位與巡店日期維持第一次的值，且不重新定位', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const admin = await apiAs('admin');
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    const storeId = await storeIdByCode(admin, storeCodeFor(testInfo, 2));
    const tag = 'edit-' + (testInfo.project.name === 'mobile-390' ? 'm' : 'd');
    const created = await createInspectionViaApi(admin, storeId, tag, {
      gps: { latitude: 24.1477, longitude: 120.6736, accuracy: 35, capturedAt: new Date(Date.now() - 20 * 60_000).toISOString() },
    });
    expect(created.res.status(), JSON.stringify(created.json)).toBe(200);
    const id: string = created.json.record.id;
    await registerInspection(id);
    const first = await readMaster(id);

    await openNativeEdit(page, id);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'readonly');
    const callsBefore = (await geoCalls(page)).length;
    const notes = marker(tag) + '-edited';
    await ed(page).getByLabel('巡店備註').fill(notes);
    await ed(page).getByRole('button', { name: '儲存草稿' }).click();
    await expect(ed(page).getByText('草稿已儲存')).toBeVisible({ timeout: 30_000 });
    const after = await readMaster(id);
    expect(after!.supervisor_notes).toBe(notes);
    expect(after!.gps_latitude).toBe(first!.gps_latitude);
    expect(after!.gps_longitude).toBe(first!.gps_longitude);
    expect(after!.gps_accuracy).toBe(first!.gps_accuracy);
    expect(Date.parse(after!.gps_timestamp)).toBe(Date.parse(first!.gps_timestamp));
    expect(after!.inspection_date).toBe(first!.inspection_date);
    expect((await geoCalls(page)).length).toBe(callsBefore);
  } finally {
    await admin.dispose();
    await ctx.close();
  }
});

test('送出前定位時間窗已過期：不送出，自動重新定位', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoRespond(page, GPS_BASE);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await storeSelect(page).selectOption({ label: await optionFor(page, storeCodeFor(testInfo)) });
    await ed(page).getByLabel(/室內溫度/).fill('26');
    // M4 Q12：正式送出需要雙簽名，先完成簽名才會走到定位檢查。
    await sign(page, 0);
    await sign(page, 1);
    // 把頁面時鐘撥快 3 小時，模擬定位停留太久。
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 3 * 3600 * 1000;
    });
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /inspection-form/.test(r.url())) posted = true;
    });
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(ed(page).getByText('定位已過期')).toBeVisible();
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'loading');
    await expect(storeSelect(page)).toBeDisabled();
    expect(posted).toBe(false);
    await geoRespond(page, GPS_BASE, true);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    // 重新定位成功後，過期橫幅必須消失。
    await expect(ed(page).getByText('定位已過期')).toHaveCount(0);
    await expect(storeSelect(page)).toBeEnabled();
  } finally {
    await ctx.close();
  }
});

test('伺服器擋下定位：表單重新鎖住、顯示原因並自動彈出教學', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openAs(browser, testInfo, { stub: true });
  try {
    await openNativeNew(page);
    await geoRespond(page, GPS_BASE);
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success');
    await storeSelect(page).selectOption({ label: await optionFor(page, storeCodeFor(testInfo)) });
    await ed(page).getByLabel(/室內溫度/).fill('26');
    await sign(page, 0);
    await sign(page, 1);
    await page.route('**/api/workspace/inspection-form', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: '【巡店定位】定位誤差過大（±1500 公尺），請重新定位後再送出' }),
      });
    });
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'error');
    await expect(page.getByTestId('gps-error')).toContainText('定位誤差過大');
    await expect(guide(page)).toBeVisible();
    await expect(page.getByTestId('gps-guide-note')).toContainText('誤差過大');
    await page.getByRole('dialog').getByRole('button', { name: '關閉' }).click();
    await expect(storeSelect(page)).toBeDisabled();
  } finally {
    await ctx.close();
  }
});
