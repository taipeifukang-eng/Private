import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { runIdOrThrow, testStoreIds } from '../support/w01a-fixtures';
import { RxFixture, RX_LEAK_COUNT, RX_LEAK_TEXT, rxLeaks } from '../support/rx-link-fixtures';
import { openNativePerformance, panel } from '../support/w03-ui';

// 每月人員狀態接業績管理處方箋（新版）e2e：桌機 1440 與手機 390 各跑一次，月份分開（2099-09／2099-10），資料只用 ZT 測試門市。
//  統計卡第三列三格唯讀、讀取中／讀取失敗、舊匯入標籤、編輯統計已無兩欄與提示；
//  多角色劇本：A 店長看自己門市；B 督導（只有 view_own）看不到非指派門市；C 管理員看全部；C2 管理員選總公司 0000 三格暫無資料（DEV 沒有 0000 時明確標記略過）；
//  D 在業績管理處方箋分頁修改後切回月度分頁，數字自動更新（已送審月份也是）；E 舊匯入規則走一圈；F 切回分頁重讀失敗與「重試」；G 連續快速切換分頁時過期回應不蓋掉最新值。

const fx = new RxFixture();
const NODATA = '暫無資料';
const monthOf = (mobile: boolean) => (mobile ? '2099-10' : '2099-09');
const ZT01 = 'ZT01 ZT 測試門市 01';

const mp = (page: Page) => panel(page);
const cell = (page: Page, key: 'regular' | 'chronic' | 'totalPoint') => mp(page).getByTestId(`rx-${key}`).locator('dd');
async function cells(page: Page) {
  return [await cell(page, 'regular').innerText(), await cell(page, 'chronic').innerText(), await cell(page, 'totalPoint').innerText()].map((t) => t.replace(/\s+/g, ' ').trim());
}

async function openMonthly(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
  await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}
async function query(page: Page, storeLabel: string | RegExp, month: string) {
  const select = mp(page).getByLabel('門市', { exact: true });
  const label = typeof storeLabel === 'string' ? storeLabel : (await select.locator('option').allTextContents()).find((l) => storeLabel.test(l));
  await select.selectOption({ label: label! });
  await mp(page).getByLabel('月份').fill(month);
  await mp(page).getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}
const monthlyTab = (page: Page) => page.getByRole('tab', { name: /人員狀態|每月人員/ }).first();

/** 在業績管理的處方箋分頁改 ZT01 的一般箋與慢箋（走畫面，不是 API）。 */
async function editPrescriptionInUi(page: Page, month: string, store: string, v: { regular: string; regularPoint: string; chronic: string; chronicPoint: string }) {
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="業績管理"]').click();
  await expect(page.getByRole('heading', { name: '業績管理', exact: true })).toBeVisible();
  await panel(page).getByRole('navigation', { name: '業績子功能' }).getByRole('button', { name: '處方箋' }).click();
  const rx = panel(page).getByRole('region', { name: '處方箋' });
  await expect(rx.getByRole('button', { name: '查詢處方箋' })).toBeVisible({ timeout: 30_000 });
  await rx.getByLabel('檢視').selectOption('month');
  await rx.getByLabel('月份').fill(month);
  await rx.getByRole('button', { name: '查詢處方箋' }).click();
  await rx.getByLabel('搜尋門市').fill(store);
  const row = rx.locator('tbody tr').filter({ hasText: store });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await row.getByLabel(`${store} 一般箋張數`).fill(v.regular);
  await row.getByLabel(`${store} 一般箋點值`).fill(v.regularPoint);
  await row.getByLabel(`${store} 慢箋張數`).fill(v.chronic);
  await row.getByLabel(`${store} 慢箋點值`).fill(v.chronicPoint);
  await rx.getByRole('button', { name: /儲存處方箋/ }).click();
  await expect(rx.getByRole('status').filter({ hasText: '已儲存 1 間門市' })).toBeVisible({ timeout: 30_000 });
}

test.afterAll(async () => {
  await fx.restore();
});

test('統計卡三格：唯讀、千分位、舊匯入標籤、讀取中與讀取失敗；編輯統計沒有兩欄並有提示', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = monthOf(mobile);
  const admin: APIRequestContext = await apiAs('admin');
  const errors: string[] = [];
  try {
    const ids = await testStoreIds(admin, month);
    await fx.report(admin, ids.ZT01, month, { regular: 1200, regularPoint: 1500000.25, chronic: 0, chronicPoint: 642411.5 });
    await fx.legacy(ids.ZT02, month, 5, 0); // ZT02：沒有處方箋、舊匯入一般箋 5、慢箋 0
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      page.on('console', (m) => m.type() === 'error' && !/status of (403|404|503)/.test(m.text()) && errors.push(m.text().slice(0, 200)));
      await openMonthly(page);
      await query(page, ZT01, month);

      expect(await cells(page)).toEqual(['1,200', '0', '2,142,412']);
      const rxBox = mp(page).getByTestId('monthly-rx');
      await expect(rxBox.locator('input, select, textarea')).toHaveCount(0); // 三格唯讀
      await expect(rxBox.getByTestId('rx-legacy')).toHaveCount(0);
      await expect(mp(page).getByTestId('rx-hint')).toContainText('資料來自業績管理處方箋，如需修改請至業績管理處方箋頁');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // 編輯統計：沒有一般箋、慢箋輸入框，有提示
      await page.getByRole('button', { name: '編輯統計' }).click();
      const dialog = page.getByRole('dialog', { name: '門市每月統計資料' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('stats-rx-hint')).toHaveText('一般箋、慢箋張數改由業績管理處方箋提供');
      await expect(dialog.getByLabel('一般箋張數')).toHaveCount(0);
      await expect(dialog.getByLabel('慢箋張數')).toHaveCount(0);
      await expect(dialog.getByLabel('單純處方加購')).toHaveCount(1);
      await expect(dialog.locator('input[type=number]')).toHaveCount(7);
      await dialog.getByRole('button', { name: '關閉' }).click();
      await expect(dialog).toHaveCount(0);

      // ZT02：舊匯入非 0 標「舊匯入」，0 顯示暫無資料；點值暫無資料
      await query(page, 'ZT02 ZT 測試門市 02', month);
      expect(await cells(page)).toEqual(['5 舊匯入', NODATA, NODATA]);
      await expect(cell(page, 'regular').getByTestId('rx-legacy')).toHaveText('舊匯入');
      await expect(cell(page, 'chronic').getByTestId('rx-legacy')).toHaveCount(0);

      // 名冊回應的攔截：pass 直接放行；hold 等放行後才送；fail 把 meta.rx 改成 failed
      let mode: 'pass' | 'hold' | 'fail' = 'pass';
      let release: () => void = () => undefined;
      let gate: Promise<void> = Promise.resolve();
      await page.route(/\/api\/workspace\/monthly\?/, async (route) => {
        if (mode === 'hold') await gate;
        if (mode === 'fail') {
          const res = await route.fetch();
          const json = await res.json();
          if (json.meta) json.meta.rx = { failed: true };
          await route.fulfill({ response: res, json });
          return;
        }
        await route.continue();
      });
      // 切換門市：讀取中時不能閃現上一家的數字（把名冊回應延遲，觀察中間狀態）
      mode = 'hold';
      gate = new Promise<void>((r) => (release = r));
      await mp(page).getByLabel('門市', { exact: true }).selectOption({ label: ZT01 });
      await mp(page).getByRole('button', { name: '查詢人員' }).click();
      await expect(cell(page, 'regular')).toContainText('讀取中');
      expect(await cells(page)).not.toContain('5 舊匯入');
      mode = 'pass';
      release();
      await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
      expect(await cells(page)).toEqual(['1,200', '0', '2,142,412']);

      // 讀取失敗：名冊回應的 meta.rx 為 failed -> 三格都「讀取失敗」，不退回舊值，其餘統計照常
      mode = 'fail';
      await query(page, 'ZT02 ZT 測試門市 02', month);
      expect(await cells(page)).toEqual(['讀取失敗', '讀取失敗', '讀取失敗']);
      await expect(mp(page).getByRole('heading', { name: '門市每月統計資料' })).toBeVisible();
      mode = 'pass';
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.dispose();
  }
});

test('角色劇本 A／B／C：店長看自己門市、督導看不到非指派門市、管理員看全部', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = monthOf(mobile);
  const admin = await apiAs('admin');
  try {
    const ids = await testStoreIds(admin, month);
    await fx.report(admin, ids.ZT01, month, { regular: 321, regularPoint: 1000, chronic: 45, chronicPoint: 500 });
    test.skip(!ids.ZT04, 'DEV 缺少 ZT04（跨店對象）');
    await fx.report(admin, ids.ZT04, month, { regular: RX_LEAK_COUNT, regularPoint: 1, chronic: 1, chronicPoint: 1 });

    // A 店長（被指派 ZT01）：三格正確且唯讀
    const mgr = await loginAs(browser, 'store_manager');
    try {
      const page = await mgr.newPage();
      await openMonthly(page);
      await query(page, ZT01, month);
      expect(await cells(page)).toEqual(['321', '45', '1,500']);
      await expect(mp(page).getByTestId('monthly-rx').locator('input')).toHaveCount(0);
    } finally {
      await mgr.close();
    }

    // B 督導（只有 view_own，被指派 ZT01～ZT03）：看得到 ZT01；門市清單沒有 ZT04；直接打 API 403，畫面與回應都沒有 7770123（獨特張數，不比對整頁的 '777' 子字串）
    const sup = await loginAs(browser, 'supervisor');
    try {
      const page = await sup.newPage();
      await openMonthly(page);
      const options = await mp(page).getByLabel('門市', { exact: true }).locator('option').allTextContents();
      expect(options.some((o) => o.startsWith('ZT04')), '督導不該看到 ZT04').toBe(false);
      await query(page, ZT01, month);
      expect(await cells(page)).toEqual(['321', '45', '1,500']);
      const blocked = await sup.request.get('/api/workspace/monthly/tools', { params: { month, store: ids.ZT04, op: 'meta' } });
      expect(blocked.status()).toBe(403);
      expect(rxLeaks(await blocked.text())).toBe(false);
      const blockedRoster = await sup.request.get('/api/workspace/monthly', { params: { month, store: ids.ZT04 } });
      expect(blockedRoster.status()).toBe(403);
      expect(rxLeaks(await page.content())).toBe(false);
    } finally {
      await sup.close();
    }

    // C 管理員：ZT01 與 ZT04 都看得到
    const adm = await loginAs(browser, 'admin');
    try {
      const page = await adm.newPage();
      await openMonthly(page);
      await query(page, /^ZT04 /, month);
      expect(await cells(page)).toEqual([RX_LEAK_TEXT, '1', '2']);
    } finally {
      await adm.close();
    }
  } finally {
    await admin.dispose();
  }
});

test('角色劇本 D：在業績管理處方箋分頁修改後切回月度分頁，數字自動更新（已送審月份也是），月度統計表沒被複製寫入', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = monthOf(mobile);
  const admin = await apiAs('admin');
  const errors: string[] = [];
  try {
    const ids = await testStoreIds(admin, month);
    await fx.legacy(ids.ZT01, month, 0, 0, 'submitted'); // 已送審月份
    await fx.report(admin, ids.ZT01, month, { regular: 10, regularPoint: 1000, chronic: 2, chronicPoint: 200 });
    const before = await fx.legacyOf(ids.ZT01, month);
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await openMonthly(page);
      await query(page, ZT01, month);
      expect(await cells(page)).toEqual(['10', '2', '1,200']);

      await editPrescriptionInUi(page, month, 'ZT01', { regular: '88', regularPoint: '5000', chronic: '9', chronicPoint: '2500' });

      // 切回月度分頁（不重新整理、不按查詢）：自動重新讀取
      await monthlyTab(page).click();
      await expect(mp(page).getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
      await expect(cell(page, 'regular')).toHaveText('88', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['88', '9', '7,500']);
      expect(await fx.legacyOf(ids.ZT01, month)).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.dispose();
  }
});

test('角色劇本 E：舊匯入規則走一圈（舊值標舊匯入、補處方箋改用處方箋、清空退回、0 視為有值）', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mobile = testInfo.project.name === 'mobile-390';
  const month = monthOf(mobile);
  const admin = await apiAs('admin');
  try {
    const ids = await testStoreIds(admin, month);
    await fx.legacy(ids.ZT03, month, 5, 0);
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      await openMonthly(page);
      await query(page, 'ZT03 ZT 測試門市 03', month);
      expect(await cells(page)).toEqual(['5 舊匯入', NODATA, NODATA]);

      // 先切去業績管理分頁，在後端補處方箋，再切回來
      const away = async () => {
        await page.click('.menu-toggle');
        await page.locator('.workspace-menu button.catalog-item[title="業績管理"]').click();
        await expect(page.getByRole('heading', { name: '業績管理', exact: true })).toBeVisible();
      };
      const back = async () => {
        await monthlyTab(page).click();
        await expect(mp(page).getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
      };
      await away();
      await fx.report(admin, ids.ZT03, month, { regular: 40, regularPoint: 400, chronic: 6, chronicPoint: 60 });
      await back();
      await expect(cell(page, 'regular')).toHaveText('40', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['40', '6', '460']);

      // 處方箋清空 -> 退回舊匯入（一般箋 5 舊匯入；慢箋舊值 0 暫無資料）
      await away();
      await fx.report(admin, ids.ZT03, month, { regular: null, chronic: null });
      await back();
      await expect(cell(page, 'regular')).toContainText('舊匯入', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['5 舊匯入', NODATA, NODATA]);

      // 處方箋填 0：0 是有值，不退回舊值 5
      await away();
      await fx.report(admin, ids.ZT03, month, { regular: 0, chronic: 0 });
      await back();
      await expect(cell(page, 'regular')).toHaveText('0', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['0', '0', NODATA]);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.dispose();
  }
});

test('角色劇本 C2：管理員選總公司 0000，三格暫無資料（DEV 沒有 0000 門市時明確略過，不靜默通過）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  runIdOrThrow();
  const month = monthOf(testInfo.project.name === 'mobile-390');
  const adm = await loginAs(browser, 'admin');
  try {
    const page = await adm.newPage();
    await openMonthly(page);
    const hq = (await mp(page).getByLabel('門市', { exact: true }).locator('option').allTextContents()).find((l) => /^0000\b/.test(l));
    test.skip(!hq, 'DEV 的 stores 表沒有 store_code=0000 的門市；0000 改由 tests/unit/W01a/monthly-rx-hq-route.test.ts（路由層）與 monthly-rx-meta.test.ts 涵蓋');
    await query(page, hq!, month);
    expect(await cells(page)).toEqual([NODATA, NODATA, NODATA]);
  } finally {
    await adm.close();
  }
});

async function awayToPerformance(page: Page) {
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="業績管理"]').click();
  await expect(page.getByRole('heading', { name: '業績管理', exact: true })).toBeVisible();
}
async function backToMonthly(page: Page) {
  await monthlyTab(page).click();
  await expect(mp(page).getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
}

test('角色劇本 F：切回分頁重讀失敗顯示讀取失敗（不退回舊值），按「重試」後恢復', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const month = monthOf(testInfo.project.name === 'mobile-390');
  const admin = await apiAs('admin');
  try {
    const ids = await testStoreIds(admin, month);
    await fx.legacy(ids.ZT02, month, 5, 0); // 舊匯入值：失敗時不可退回顯示 5
    await fx.report(admin, ids.ZT02, month, { regular: 30, regularPoint: 300, chronic: 4, chronicPoint: 40 });
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      await openMonthly(page);
      await query(page, 'ZT02 ZT 測試門市 02', month);
      expect(await cells(page)).toEqual(['30', '4', '340']);

      // 切離後把「切回時的重讀」（tools?op=meta，不帶 op 參數即預設 meta）攔成 503
      let fail = true;
      let hits = 0;
      await page.route(/\/api\/workspace\/monthly\/tools\?/, async (route) => {
        hits += 1;
        if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '門市統計讀取失敗' }) });
        else await route.continue();
      });
      await awayToPerformance(page);
      await backToMonthly(page);
      await expect(cell(page, 'regular')).toHaveText('讀取失敗', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['讀取失敗', '讀取失敗', '讀取失敗']);
      expect(await cells(page)).not.toContain('5 舊匯入');
      expect(hits).toBeGreaterThan(0);
      const retry = mp(page).getByTestId('rx-hint').getByRole('button', { name: '重試' });
      await expect(retry).toBeVisible();

      // 放行後按重試：恢復為處方箋的值，重試按鈕消失
      fail = false;
      await retry.click();
      await expect(cell(page, 'regular')).toHaveText('30', { timeout: 30_000 });
      expect(await cells(page)).toEqual(['30', '4', '340']);
      await expect(retry).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.dispose();
  }
});

test('角色劇本 G：連續快速切換分頁，過期的回應被擋掉，最後畫面是最後一次請求的值', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const month = monthOf(testInfo.project.name === 'mobile-390');
  const admin = await apiAs('admin');
  try {
    const ids = await testStoreIds(admin, month);
    await fx.report(admin, ids.ZT03, month, { regular: 11, regularPoint: 100, chronic: 1, chronicPoint: 10 });
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      await openMonthly(page);
      await query(page, 'ZT03 ZT 測試門市 03', month);
      expect(await cells(page)).toEqual(['11', '1', '110']);

      // 第 1 次切回：先取得伺服器回應（值 V1），但壓住不放；第 2 次切回正常放行（值 V2）。
      let n = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      let staleDelivered: Promise<void> = Promise.resolve();
      let fetchedV1 = false;
      await page.route(/\/api\/workspace\/monthly\/tools\?/, async (route) => {
        n += 1;
        if (n === 1) {
          const res = await route.fetch(); // 伺服器此時回的是 V1
          fetchedV1 = true;
          staleDelivered = gate.then(() => route.fulfill({ response: res }));
          await staleDelivered;
          return;
        }
        await route.continue();
      });
      await awayToPerformance(page);
      await backToMonthly(page); // 第 1 次請求（被壓住，帶 V1）
      await expect.poll(() => fetchedV1, { timeout: 15_000 }).toBe(true);
      // 第 1 次的回應已在改成 V2 之前取得（V1 = 11）；現在改成 V2，再切走切回，第 2 次請求取得 V2（22）
      await fx.report(admin, ids.ZT03, month, { regular: 22, regularPoint: 200, chronic: 2, chronicPoint: 20 });
      await awayToPerformance(page);
      await backToMonthly(page);
      await expect(cell(page, 'regular')).toHaveText('22', { timeout: 30_000 });
      // 放行過期回應（V1），畫面不可被蓋回 11
      release();
      await staleDelivered;
      await page.waitForTimeout(1500);
      expect(await cells(page)).toEqual(['22', '2', '220']);
      await expect(mp(page).getByTestId('monthly-rx')).not.toContainText('讀取失敗');
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.dispose();
  }
});
