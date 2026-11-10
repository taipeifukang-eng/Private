import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, row, rowsWhere, seedCategory, seedEquipment, seedRepairRequest, stores } from '../support/m7m8-fixtures';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import { gaNavTo, noPageOverflow, openGaCenter } from '../support/g01-ui';
import { makePng } from '../support/png';
import { createRequire } from 'node:module';
import path from 'node:path';

// Q26 角色接力劇本「設備轉移」（M7/M8 第 2 批）：
//   總務（桌機 1440，ga_works）發起 → A 店店長（ZT01 帳號 store_manager，手機 390）確認交出（附照片）
//   → B 店店長（VW001 帳號 ga_store_manager_b，手機 390）確認收到（附照片）→ 設備改屬 B 店。
//   每一步都檢查對方畫面有沒有收到、狀態對不對；最後檢查：B 店看得到（清冊、報修入口）、A 店看不到（清冊與掃描頁）、
//   QR token 沿用（舊 token 掃描頁顯示 B 店）、轉移單時間軸與異動紀錄完整（發起、交出、收到、操作人、照片）、進行中的報修單仍屬原門市。
//   另有「無權限者做不到」：總務不能代替店長、店長不能發起或取消、他店店長與無關人員、設備查看者、無權限者，API 與介面兩種方式都驗。
// 這個劇本自己決定每個角色的視窗（總務桌機、店長手機），所以只在 desktop-1440 project 跑一次。
const nodeRequire = createRequire(path.join(__dirname, 'G10.journey-transfer.spec.ts'));
const accountId = (k: string) => (nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { userId: string } }).getAccount(k).userId;
let eqCat: { id: string };
const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });
const BASE = '/api/workspace/general-affairs';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'JE');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

type Who = { ctx: BrowserContext; page: Page; errors: string[] };
async function open(browser: Browser, role: string, kind: 'desktop' | 'phone'): Promise<Who> {
  const state = await storageStateFor(role);
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block',
    ...(kind === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const transferRow = (page: Page, text: string) => page.locator('tr[data-testid="transfer-row"]:visible, li[data-testid="transfer-card"]:visible', { hasText: text });
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).locator('visible=true').first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();

async function pickStore(scope: ReturnType<Page['locator']>, label: string, code: string) {
  await scope.getByRole('combobox', { name: new RegExp(label) }).fill(code);
  await scope.getByRole('option').filter({ hasText: code }).first().getByRole('button').click();
}

test('劇本：設備轉移（總務發起 → A 店店長手機交出 → B 店店長手機收到 → B 店有、A 店沒有、QR 沿用、紀錄完整）＋無權限者做不到', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const s = await stores();
  const eq = await seedEquipment('ZT01', eqCat.id, 'J-冰箱', { asset_code: m7Code('J1') });
  const keep = await seedEquipment('ZT01', eqCat.id, 'J-留在A店');
  const repair = await seedRepairRequest('ZT01', { equipmentId: eq.id }, 'J-未結報修', 'IN_PROGRESS', accountId('store_manager'));
  const ga = await open(browser, 'ga_works', 'desktop');
  const a = await open(browser, 'store_manager', 'phone');
  const b = await open(browser, 'ga_store_manager_b', 'phone');
  let transferId = '';
  try {
    // ---------------------------------------------------------------- 步驟 1：總務（桌機）發起
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '轉移單');
    await expect(heading(ga.page, '設備轉移單')).toBeVisible();
    await ga.page.getByRole('button', { name: '發起轉移單' }).click();
    await dialog(ga.page).getByRole('searchbox', { name: '搜尋要轉移的資產' }).fill(eq.name);
    await dialog(ga.page).getByRole('button', { name: `選擇 ${eq.name}` }).click();
    await pickStore(dialog(ga.page), '轉入門市', 'VW001');
    await expect(dialog(ga.page)).toContainText('目前有 1 張未結案單');
    await dialog(ga.page).getByLabel('轉移原因').fill('B 店新開，調撥冰箱');
    await dialog(ga.page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(notice(ga.page, /已發起轉移單 AT\d{8}-\d{4}/)).toBeVisible();
    const t = (await rowsWhere('ga_asset_transfers', 'asset_id', eq.id))[0];
    transferId = t.id;
    expect(t).toMatchObject({ status: 'PENDING_HANDOVER', from_store_id: s.ZT01.id, to_store_id: s.VW001.id, open_request_count: 1 });
    expect((await row('ga_equipment', eq.id)).store_id).toBe(s.ZT01.id); // 發起不換店
    await expect(transferRow(ga.page, eq.name)).toContainText('等轉出門市確認交出');
    // 總務沒有代替店長的按鈕
    await expect(transferRow(ga.page, eq.name).getByRole('button', { name: /確認交出|確認收到/ })).toHaveCount(0);

    // ---------------------------------------------------------------- 步驟 2：A 店店長（手機）看到並確認交出
    await openGaCenter(a.page);
    await gaNavTo(a.page, '轉移單');
    await expect(tab(a.page, /待我處理/)).toHaveAttribute('aria-selected', 'true');
    const cardA = transferRow(a.page, eq.name);
    await expect(cardA).toBeVisible();
    await expect(cardA).toContainText('ZT01');
    await expect(cardA).toContainText('VW001');
    await expect(cardA).toContainText('還有 1 張未結案單，換店後仍屬原門市');
    await expect(cardA.getByRole('button', { name: '確認收到' })).toHaveCount(0);
    expect(await noPageOverflow(a.page)).toBe(true);
    expect((await cardA.getByRole('button', { name: '確認交出' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await cardA.getByRole('button', { name: '確認交出' }).click();
    await dialog(a.page).getByLabel('備註').fill('冰箱已清空、已裝箱');
    await dialog(a.page).getByTestId('upload-input').setInputFiles({ name: 'm7m8t-handover.png', mimeType: 'image/png', buffer: png() });
    await expect(dialog(a.page).getByRole('list', { name: '待上傳的檔案' })).toContainText('m7m8t-handover.png');
    await dialog(a.page).getByRole('button', { name: '確認交出' }).last().click();
    await expect(notice(a.page, '已確認交出')).toBeVisible();
    await expect(transferRow(a.page, eq.name)).toHaveCount(0);
    expect((await row('ga_equipment', eq.id)).store_id).toBe(s.ZT01.id); // 交出也還沒換店

    // ---------------------------------------------------------------- 步驟 3：總務（桌機）看到狀態更新、有交出照片
    await ga.page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '轉移單');
    await expect(transferRow(ga.page, eq.name)).toContainText('等轉入門市確認收到');
    await transferRow(ga.page, eq.name).getByRole('button', { name: /查看/ }).click();
    await expect(dialog(ga.page).getByTestId('transfer-event')).toHaveCount(2);
    await expect(dialog(ga.page).getByRole('heading', { name: '交出時的照片' })).toBeVisible();
    await expect(dialog(ga.page).locator('.shots img')).toHaveCount(1);
    await dialog(ga.page).getByRole('button', { name: '關閉' }).click();

    // ---------------------------------------------------------------- 步驟 4：B 店店長（手機）看到並確認收到
    await openGaCenter(b.page);
    await gaNavTo(b.page, '轉移單');
    await expect(tab(b.page, /待我處理/)).toHaveAttribute('aria-selected', 'true');
    const cardB = transferRow(b.page, eq.name);
    await expect(cardB).toBeVisible();
    await expect(cardB.getByRole('button', { name: '確認交出' })).toHaveCount(0);
    expect(await noPageOverflow(b.page)).toBe(true);
    await cardB.getByRole('button', { name: '確認收到' }).click();
    await dialog(b.page).getByLabel('備註').fill('已收到並插電');
    await dialog(b.page).getByTestId('upload-input').setInputFiles({ name: 'm7m8t-receive.png', mimeType: 'image/png', buffer: png() });
    await dialog(b.page).getByRole('button', { name: '確認收到' }).last().click();
    await expect(notice(b.page, /已確認收到.*原 QR 標籤繼續可用/)).toBeVisible();
    expect((await row('ga_equipment', eq.id)).store_id).toBe(s.VW001.id);

    // ---------------------------------------------------------------- 步驟 5：結果檢查
    // 5.1 B 店看得到設備（手機卡片、基本資料、沒有編輯），A 店看不到
    await gaNavTo(b.page, '設備清冊', '設備管理');
    await searchBox(b.page).fill(eq.name);
    const eqCardB = b.page.locator('li.asset-card:visible', { hasText: eq.name });
    await expect(eqCardB).toBeVisible();
    await eqCardB.getByRole('button', { name: /查看/ }).click();
    await expect(dialog(b.page)).toContainText('VW001');
    await expect(dialog(b.page).getByRole('button', { name: '編輯' })).toHaveCount(0);
    await expect(dialog(b.page).getByRole('button', { name: '發起轉移' })).toHaveCount(0);
    await dialog(b.page).getByRole('button', { name: '關閉' }).click();
    await gaNavTo(a.page, '設備清冊', '設備管理');
    await searchBox(a.page).fill(eq.name);
    await expect(a.page.getByText('找不到符合的設備').locator('visible=true').first()).toBeVisible();
    await searchBox(a.page).fill(keep.name);
    await expect(a.page.locator('li.asset-card:visible', { hasText: keep.name })).toBeVisible(); // 留在 A 店的不受影響

    // 5.2 QR 沿用：舊 token 掃描頁，B 店看到設備與報修入口，A 店只看到白話說明
    expect((await row('ga_equipment', eq.id)).qr_token).toBe(eq.qr_token);
    await b.page.goto(`/workspace/index.html#/open/ga-asset-scan/${eq.qr_token}`, { waitUntil: 'networkidle' });
    const scanB = b.page.getByTestId('asset-scan').locator('visible=true');
    await expect(scanB.getByTestId('scan-store')).toContainText('VW001');
    await expect(scanB).toContainText(eq.name);
    await expect(scanB.getByTestId('scan-report')).toBeVisible();
    await expect(scanB.getByTestId('scan-report')).toBeEnabled();
    expect(await noPageOverflow(b.page)).toBe(true);
    await a.page.goto(`/workspace/index.html#/open/ga-asset-scan/${eq.qr_token}`, { waitUntil: 'networkidle' });
    const failA = a.page.getByTestId('scan-failure').locator('visible=true');
    await expect(failA).toBeVisible();
    await expect(failA).toHaveAttribute('data-code', 'NO_ACCESS');
    await expect(failA).not.toContainText(eq.name);

    // 5.3 轉移單詳情（總務桌機）：三筆時間軸、兩段照片、操作人；已完成分頁
    await ga.page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '轉移單');
    await tab(ga.page, '已完成').click();
    await transferRow(ga.page, eq.name).getByRole('button', { name: /查看/ }).click();
    const events = dialog(ga.page).getByTestId('transfer-event');
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText('總務發起轉移');
    await expect(events.nth(1)).toContainText('轉出門市確認交出');
    await expect(events.nth(2)).toContainText('轉入門市確認收到');
    await expect(dialog(ga.page).getByRole('heading', { name: '交出時的照片' })).toBeVisible();
    await expect(dialog(ga.page).getByRole('heading', { name: '收到時的照片' })).toBeVisible();
    await expect(dialog(ga.page).locator('.shots img')).toHaveCount(2);
    await dialog(ga.page).getByRole('button', { name: '關閉' }).click();
    // 異動紀錄（資料庫）：順序、門市、操作人、當時未結案單數
    const ev = ((await adminDb().from('ga_asset_events').select('*').eq('asset_id', eq.id).order('created_at')).data || []) as any[];
    expect(ev.map((e) => e.event_type)).toEqual(['TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER']);
    expect(ev.every((e) => e.actor_id && e.actor_name && e.transfer_id === transferId)).toBe(true);
    expect(ev[2]).toMatchObject({ from_store_id: s.ZT01.id, to_store_id: s.VW001.id, open_request_count: 1, reason: 'B 店新開，調撥冰箱' });
    const done = await row('ga_asset_transfers', transferId);
    expect(done).toMatchObject({ status: 'COMPLETED', handover_note: '冰箱已清空、已裝箱', receive_note: '已收到並插電' });
    expect(((await adminDb().from('ga_asset_transfer_photos').select('step').eq('transfer_id', transferId)).data || []).map((p: any) => p.step).sort()).toEqual(['HANDOVER', 'RECEIVE']);
    // 進行中的報修單仍屬原門市（解讀 h）
    expect((await row('ga_service_requests', repair.id)).store_id).toBe(s.ZT01.id);
    // 設備詳情（總務）異動紀錄也看得到
    await gaNavTo(ga.page, '設備清冊', '設備管理');
    await searchBox(ga.page).fill(eq.name);
    await ga.page.locator('tr:visible', { hasText: eq.name }).getByRole('button', { name: /查看/ }).click();
    await dialog(ga.page).getByRole('button', { name: '查看異動紀錄' }).click();
    await expect(dialog(ga.page).locator('.event-list li')).toHaveCount(3);
    await expect(dialog(ga.page).locator('.event-list')).toContainText('轉移完成');
    await dialog(ga.page).getByRole('button', { name: '關閉' }).click();

    for (const w of [ga, a, b]) expect(w.errors).toEqual([]);
  } finally {
    for (const w of [ga, a, b]) await w.ctx.close();
  }

  // ------------------------------------------------------------------ 無權限者做不到（API 與介面）
  // 新的一張單：用來驗證各種「不能做」。
  const gaApi = await apiAs('ga_works');
  const second = await seedEquipment('ZT01', eqCat.id, 'J-無權限驗證');
  const made = await gaApi.post(`${BASE}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: second.id, toStoreId: s.VW001.id, reason: '權限驗證' } });
  expect(made.status()).toBe(201);
  const id2 = (await made.json()).data.id as string;
  const roles = ['store_manager', 'ga_store_manager_b', 'ga_equipment_view', 'ga_facility_edit', 'denied'];
  const apis: Record<string, Awaited<ReturnType<typeof apiAs>>> = {};
  try {
    for (const k of roles) apis[k] = await apiAs(k);
    // 發起、取消：店長（兩店）、設備查看、設施管理（對設備）、無權限 -> 403
    for (const k of roles) {
      const c = await apis[k].post(`${BASE}/transfers`, { data: { assetType: 'EQUIPMENT', assetId: keep.id, toStoreId: s.VW001.id, reason: '不該成功' } });
      expect(c.status(), `${k} 發起`).toBe(403);
      const x = await apis[k].post(`${BASE}/transfers/${id2}/cancel`, { data: { reason: '不該成功' } });
      expect(x.status(), `${k} 取消`).toBe(403);
    }
    // 總務代替店長確認交出、確認收到 -> 403
    for (const which of ['handover', 'receive'] as const) {
      const r = await gaApi.post(`${BASE}/transfers/${id2}/${which}`, { data: { note: '總務代按' } });
      expect(r.status(), `總務 ${which}`).toBe(403);
    }
    // 他店店長（B）不能交出（不是轉出門市）；無權限者連單子都看不到
    expect((await apis.ga_store_manager_b.post(`${BASE}/transfers/${id2}/handover`, { data: {} })).status()).toBe(403);
    expect((await apis.denied.get(`${BASE}/transfers/${id2}`)).status()).toBe(403);
    expect((await apis.ga_facility_edit.get(`${BASE}/transfers/${id2}`)).status()).toBe(404); // 設施管理者看不到設備的單
    expect((await row('ga_equipment', second.id)).store_id).toBe(s.ZT01.id);
    expect((await row('ga_asset_transfers', id2)).status).toBe('PENDING_HANDOVER');
  } finally {
    for (const c of Object.values(apis)) await c.dispose();
    await gaApi.dispose();
  }
  // 介面：店長沒有發起／取消按鈕；設備查看者沒有轉移單入口；總務在這張待交出的單上沒有交出／收到按鈕
  const m = await open(browser, 'store_manager', 'phone');
  const v = await open(browser, 'ga_equipment_view', 'desktop');
  const g = await open(browser, 'ga_works', 'desktop');
  try {
    await openGaCenter(m.page);
    await gaNavTo(m.page, '轉移單');
    await expect(heading(m.page, '設備轉移單')).toBeVisible();
    await expect(m.page.getByRole('button', { name: '發起轉移單' })).toHaveCount(0);
    await tab(m.page, '進行中').click();
    const cardM = transferRow(m.page, second.name);
    await expect(cardM).toBeVisible();
    await expect(cardM.getByRole('button', { name: /^取消/ })).toHaveCount(0);
    await openGaCenter(v.page);
    await expect(v.page.locator('[data-testid="ga-shell"]:visible aside .ga-link', { hasText: '轉移單' })).toHaveCount(0);
    await openGaCenter(g.page);
    await gaNavTo(g.page, '轉移單');
    const rowG = transferRow(g.page, second.name);
    await expect(rowG).toBeVisible();
    await expect(rowG.getByRole('button', { name: /確認交出|確認收到/ })).toHaveCount(0);
    await expect(rowG.getByRole('button', { name: /取消/ })).toBeVisible(); // 總務可以取消
    for (const w of [m, v, g]) expect(w.errors).toEqual([]);
  } finally {
    for (const w of [m, v, g]) await w.ctx.close();
    await adminDb().from('ga_asset_transfers').update({ status: 'CANCELLED' }).eq('id', id2);
  }
});
