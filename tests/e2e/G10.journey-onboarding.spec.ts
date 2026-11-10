import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8, seedCategory, seedEquipment } from '../support/m7m8-fixtures';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import { gaNavTo, noPageOverflow, openGaCenter, sideLabels } from '../support/g01-ui';
import { buildImportXlsx, driveTo, importEquipmentLine, importFacilityLine, importFileName } from '../support/m7m8-import';
import { makePng } from '../support/png';

// Q26 角色接力劇本「上線貼標」（M7/M8 第 2 批）：
//   總務（桌機 1440，ga_works）用 Excel 匯入設備與設施（ZT01 與 VW001 兩店）→ 依門市印標籤（測試浮水印、單次 300 張上限）
//   → 店長（A 店 store_manager、B 店 ga_store_manager_b，手機 390）逐台上傳設備／設施照片與貼標位置照片（各看自己門市）
//   → 總務複核（桌機），其中一台退回一次（填原因）→ A 店店長收到退回、兩項照片都要重傳 → 再複核通過 → 兩店完成率 100%，進度頁一致。
//   另有「無權限者做不到」：店長與設備查看者不能匯入、不能複核；他店店長、設備查看者、無權限者不能替別店上傳；API 與介面兩種方式都驗。
// 這個劇本自己決定每個角色的視窗（總務桌機、店長手機），所以只在 desktop-1440 project 跑一次。
const BASE = '/api/workspace/general-affairs';
const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'OE');
  facCat = await seedCategory('facility', 'OF');
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
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const dialog = (page: Page) => page.locator('dialog[open]').last();
const taskCard = (page: Page, name: string) => page.locator('li[data-testid="onb-card"]:visible', { hasText: name });
const reviewCard = (page: Page, name: string) => page.locator('li[data-testid="review-card"]:visible', { hasText: name });
const progressCard = (page: Page, code: string) => page.locator(`[data-testid="progress-card"][data-store-code="${code}"]:visible`);

const SPECIAL = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', String.fromCharCode(92)]);
const esc = (s: string) => s.split('').map((ch) => (SPECIAL.has(ch) ? String.fromCharCode(92) + ch : ch)).join('');
async function uploadOn(page: Page, name: string, expectNotice: RegExp) {
  const card = taskCard(page, name);
  await expect(card).toBeVisible();
  expect((await card.getByRole('button', { name: '上傳照片' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await card.getByTestId('upload-input').setInputFiles({ name: 'm7m8t-onb.png', mimeType: 'image/png', buffer: png() });
  await card.getByRole('button', { name: '上傳照片' }).click();
  await expect(notice(page, expectNotice)).toBeVisible();
}
/** 店長手機：一台走完「設備／設施照片 -> 貼標位置照片」兩步，卡片從待辦消失。 */
async function finishCard(page: Page, name: string, noun: '設備' | '設施') {
  await expect(taskCard(page, name)).toContainText(`第 1 步：拍${noun}照片`);
  await uploadOn(page, name, new RegExp(`已上傳「${esc(name)}」的${noun}照片，接著請上傳貼標位置照片`));
  await expect(taskCard(page, name)).toContainText('第 2 步：拍貼標位置照片');
  await uploadOn(page, name, new RegExp(`已上傳「${esc(name)}」的貼標位置照片，等總務複核`));
  await expect(taskCard(page, name)).toHaveCount(0);
}
const status = async (table: 'ga_equipment' | 'ga_facilities', name: string) => ((await adminDb().from(table).select('*').eq('name', name).single()).data || {}) as any;

test('劇本：上線貼標（總務 Excel 匯入 → 依門市印標籤 → 店長手機逐台上傳 → 總務複核含退回一次 → 兩店完成率 100%）＋無權限者做不到', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const ga = await open(browser, 'ga_works', 'desktop');
  const a = await open(browser, 'store_manager', 'phone');
  const b = await open(browser, 'ga_store_manager_b', 'phone');
  // 匯入內容：A 店（ZT01）設備 2、設施 2；B 店（VW001）設備 1、設施 1
  const lines = {
    eqA1: importEquipmentLine('JO-冰箱A', 'ZT01', eqCat.code, { 區域: '調劑區', 購置金額: '5,000' }),
    eqA2: importEquipmentLine('JO-收銀機A', 'ZT01', eqCat.code),
    facA1: importFacilityLine('JO-招牌A', 'ZT01', facCat.code, { 數量: 1, 單位: '座' }),
    facA2: importFacilityLine('JO-貨架A', 'ZT01', facCat.code),
    eqB1: importEquipmentLine('JO-冰箱B', 'VW001', eqCat.code),
    facB1: importFacilityLine('JO-招牌B', 'VW001', facCat.code),
  };
  const N = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.名稱 as string])) as Record<keyof typeof lines, string>;
  try {
    // ---------------------------------------------------------------- 步驟 1：總務（桌機）Excel 匯入
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, 'Excel 匯入');
    await expect(heading(ga.page, '設備與設施 Excel 匯入')).toBeVisible();
    await ga.page.getByTestId('import-file').locator('visible=true').first().setInputFiles({ name: importFileName('journey'), mimeType: XLSX_TYPE, buffer: buildImportXlsx(Object.values(lines)) });
    const preview = ga.page.getByTestId('import-preview').locator('visible=true');
    await expect(preview).toContainText('全部 6 列都通過檢查，可以匯入');
    await ga.page.getByTestId('commit-import').locator('visible=true').click();
    await expect(ga.page.getByTestId('done-summary').locator('visible=true')).toContainText('共匯入 6 筆：設備 3 台、設施 3 項，涵蓋 2 間門市');
    for (const [k, table] of [['eqA1', 'ga_equipment'], ['eqA2', 'ga_equipment'], ['eqB1', 'ga_equipment'], ['facA1', 'ga_facilities'], ['facA2', 'ga_facilities'], ['facB1', 'ga_facilities']] as const) {
      expect((await status(table, N[k])).onboarding_status, k).toBe('NEEDS_EQUIPMENT_PHOTO'); // 自動產生貼標待辦
    }

    // ---------------------------------------------------------------- 步驟 2：總務依門市印標籤（進度頁 -> 印標籤）
    await ga.page.getByRole('button', { name: '前往上線貼標進度' }).locator('visible=true').click();
    const zt = progressCard(ga.page, 'ZT01');
    await expect(zt.getByTestId('progress-rate')).toHaveText('0%');
    await expect(zt).toContainText('共完成 0 / 4');
    await expect(zt.getByTestId('stage-NEEDS_EQUIPMENT_PHOTO')).toHaveText('4');
    await zt.getByRole('button', { name: '印設備標籤' }).click();
    await expect(heading(ga.page, '設備 QR 標籤列印')).toBeVisible();
    await expect(ga.page.getByTestId('label-preset-store').locator('visible=true')).toContainText('ZT01');
    await expect(ga.page.getByTestId('label-watermark-note').locator('visible=true')).toContainText('測試'); // 測試環境浮水印
    const labels = ga.page.getByTestId('label-card').locator('visible=true');
    await expect(labels.filter({ hasText: N.eqA1 })).toHaveCount(1);
    await expect(labels.filter({ hasText: N.eqA2 })).toHaveCount(1);
    await expect(labels.filter({ hasText: N.eqB1 })).toHaveCount(0); // 只印該門市
    const limit = await ga.page.evaluate(async () => (await (await fetch('/api/workspace/general-affairs/qr/labels?type=equipment')).json()));
    expect(limit.limit).toBe(300); // 單次上限 300 張
    expect(limit.watermark).toBe(true);
    // 設施標籤同樣可依門市印
    await gaNavTo(ga.page, '上線貼標進度');
    await progressCard(ga.page, 'ZT01').getByRole('button', { name: '印設施標籤' }).click();
    await expect(heading(ga.page, '設施 QR 標籤列印')).toBeVisible();
    await expect(ga.page.getByTestId('label-card').locator('visible=true').filter({ hasText: N.facA1 })).toHaveCount(1);

    // ---------------------------------------------------------------- 步驟 3：兩位店長（手機）逐台上傳照片與貼標位置照片
    await openGaCenter(a.page);
    await gaNavTo(a.page, '貼標待辦');
    await expect(heading(a.page, '貼標待辦')).toBeVisible();
    for (const k of ['eqA1', 'eqA2', 'facA1', 'facA2'] as const) await expect(taskCard(a.page, N[k])).toBeVisible();
    await expect(taskCard(a.page, N.eqB1)).toHaveCount(0); // 看不到別店的待辦
    await expect(taskCard(a.page, N.facB1)).toHaveCount(0);
    expect(await noPageOverflow(a.page)).toBe(true);
    await finishCard(a.page, N.eqA1, '設備');
    await finishCard(a.page, N.eqA2, '設備');
    await finishCard(a.page, N.facA1, '設施');
    await finishCard(a.page, N.facA2, '設施');
    expect(await noPageOverflow(a.page)).toBe(true);
    for (const [k, table] of [['eqA1', 'ga_equipment'], ['facA1', 'ga_facilities']] as const) expect((await status(table, N[k])).onboarding_status).toBe('PENDING_GA_REVIEW');
    // 「等總務複核」分頁看得到
    await a.page.getByRole('tab', { name: '等總務複核' }).locator('visible=true').click();
    await expect(taskCard(a.page, N.eqA1)).toContainText('兩張照片都已上傳，等總務複核');

    await openGaCenter(b.page);
    await gaNavTo(b.page, '貼標待辦');
    await expect(taskCard(b.page, N.eqB1)).toBeVisible();
    await expect(taskCard(b.page, N.facB1)).toBeVisible();
    await expect(taskCard(b.page, N.eqA1)).toHaveCount(0);
    await finishCard(b.page, N.eqB1, '設備');
    await finishCard(b.page, N.facB1, '設施');
    expect(await noPageOverflow(b.page)).toBe(true);

    // ---------------------------------------------------------------- 步驟 4：總務（桌機）複核；A 店冰箱退回一次
    await gaNavTo(ga.page, '貼標複核');
    await expect(heading(ga.page, '貼標複核')).toBeVisible();
    for (const k of Object.keys(N) as (keyof typeof N)[]) await expect(reviewCard(ga.page, N[k])).toBeVisible();
    await expect(reviewCard(ga.page, N.eqA1).locator('img')).toHaveCount(2); // 設備照與貼標位置照並排
    const REASON = 'JO 貼標位置照片太模糊，請重拍';
    await reviewCard(ga.page, N.eqA1).getByRole('button', { name: '退回重拍' }).click();
    await dialog(ga.page).getByRole('button', { name: '確認退回' }).click();
    await expect(dialog(ga.page)).toContainText('退回重拍時必須填寫原因'); // 原因必填
    await dialog(ga.page).getByLabel('退回原因').fill(REASON);
    await dialog(ga.page).getByRole('button', { name: '確認退回' }).click();
    await expect(notice(ga.page, `已退回「${N.eqA1}」，店長需要重新上傳設備照片與貼標位置照片`)).toBeVisible();
    await expect(reviewCard(ga.page, N.eqA1)).toHaveCount(0);
    const rejected = await status('ga_equipment', N.eqA1);
    expect(rejected).toMatchObject({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true, onboarding_review_note: REASON });
    // 其餘五台通過
    for (const k of ['eqA2', 'facA1', 'facA2', 'eqB1', 'facB1'] as const) {
      await reviewCard(ga.page, N[k]).getByRole('button', { name: '通過' }).click();
      await dialog(ga.page).getByRole('button', { name: '確認通過' }).click();
      await expect(notice(ga.page, `已通過「${N[k]}」的貼標複核`)).toBeVisible();
      await expect(reviewCard(ga.page, N[k])).toHaveCount(0);
    }
    // 進度：A 店 3 / 4（75%，卡在被退回的冰箱），B 店 2 / 2（100%）
    await gaNavTo(ga.page, '上線貼標進度');
    await expect(progressCard(ga.page, 'ZT01').getByTestId('progress-rate')).toHaveText('75%');
    await expect(progressCard(ga.page, 'VW001')).toHaveCount(0); // 100% 預設收起
    await progressCard(ga.page, 'ZT01').getByRole('button', { name: '看卡在哪一台' }).click();
    await expect(progressCard(ga.page, 'ZT01').getByTestId('stuck-row')).toHaveCount(1);
    await expect(progressCard(ga.page, 'ZT01').getByTestId('stuck-row')).toContainText(N.eqA1);
    await expect(progressCard(ga.page, 'ZT01').getByTestId('stuck-row')).toContainText(`總務退回：${REASON}`);

    // ---------------------------------------------------------------- 步驟 5：A 店店長（手機）收到退回，兩項照片都要重傳
    await a.page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(a.page);
    await gaNavTo(a.page, '貼標待辦');
    const back = taskCard(a.page, N.eqA1);
    await expect(back).toBeVisible();
    await expect(back.locator('.notice.error')).toContainText(`總務退回：${REASON}`);
    await expect(back.locator('.notice.error')).toContainText('兩張都要');
    await expect(back).toContainText('第 1 步：拍設備照片');
    expect(await noPageOverflow(a.page)).toBe(true);
    await finishCard(a.page, N.eqA1, '設備'); // 第 1 步與第 2 步都要重傳
    const reuploaded = await status('ga_equipment', N.eqA1);
    expect(reuploaded).toMatchObject({ onboarding_status: 'PENDING_GA_REVIEW', onboarding_requires_primary_photo: false, onboarding_requires_label_photo: false });
    const primaries = ((await adminDb().from('ga_resource_attachments').select('id,is_primary').eq('resource_id', rejected.id).eq('purpose', 'PRIMARY_IMAGE').is('deleted_at', null)).data || []) as any[];
    expect(primaries.filter((p) => p.is_primary)).toHaveLength(1); // 重傳後仍只有一張主圖

    // ---------------------------------------------------------------- 步驟 6：總務再次複核通過 -> 兩店完成率 100%
    await gaNavTo(ga.page, '貼標複核');
    await expect(reviewCard(ga.page, N.eqA1)).toBeVisible();
    await reviewCard(ga.page, N.eqA1).getByRole('button', { name: '通過' }).click();
    await dialog(ga.page).getByRole('button', { name: '確認通過' }).click();
    await expect(notice(ga.page, `已通過「${N.eqA1}」的貼標複核`)).toBeVisible();
    await expect(ga.page.locator('li[data-testid="review-card"]:visible')).toHaveCount(0);
    await gaNavTo(ga.page, '上線貼標進度');
    await ga.page.getByLabel('也顯示已 100% 完成的門市').locator('visible=true').check();
    await expect(progressCard(ga.page, 'ZT01').getByTestId('progress-rate')).toHaveText('100%');
    await expect(progressCard(ga.page, 'ZT01')).toContainText('共完成 4 / 4');
    await expect(progressCard(ga.page, 'VW001').getByTestId('progress-rate')).toHaveText('100%');
    await expect(progressCard(ga.page, 'VW001')).toContainText('共完成 2 / 2');
    await expect(ga.page.getByTestId('overall-rate').locator('visible=true')).toHaveText('100%');
    for (const [k, table] of [['eqA1', 'ga_equipment'], ['eqA2', 'ga_equipment'], ['eqB1', 'ga_equipment'], ['facA1', 'ga_facilities'], ['facA2', 'ga_facilities'], ['facB1', 'ga_facilities']] as const) {
      expect((await status(table, N[k])).onboarding_status, k).toBe('COMPLETED');
    }
    // 兩位店長的進度頁與總務一致
    await gaNavTo(a.page, '上線貼標進度');
    await a.page.getByLabel('也顯示已 100% 完成的門市').locator('visible=true').check();
    await expect(progressCard(a.page, 'ZT01').getByTestId('progress-rate')).toHaveText('100%');
    await expect(a.page.locator('[data-testid="progress-card"]:visible')).toHaveCount(1);
    await gaNavTo(b.page, '上線貼標進度');
    await b.page.getByLabel('也顯示已 100% 完成的門市').locator('visible=true').check();
    await expect(progressCard(b.page, 'VW001').getByTestId('progress-rate')).toHaveText('100%');
    for (const w of [ga, a, b]) expect(w.errors).toEqual([]);
  } finally {
    for (const w of [ga, a, b]) await w.ctx.close();
  }

  // ------------------------------------------------------------------ 無權限者做不到（API 與介面）
  const probe = await seedEquipment('ZT01', eqCat.id, 'JO-權限驗證甲');
  const probe2 = await seedEquipment('ZT01', eqCat.id, 'JO-權限驗證乙');
  const gaApi = await apiAs('ga_works');
  const mgrA = await apiAs('store_manager');
  const roles = ['store_manager', 'ga_store_manager_b', 'ga_equipment_view', 'ga_facility_edit', 'denied'];
  const apis: Record<string, APIRequestContext> = {};
  try {
    for (const k of roles) apis[k] = await apiAs(k);
    await driveTo('EQUIPMENT', probe.id, 'PENDING_GA_REVIEW', mgrA, gaApi); // 待複核
    const small = buildImportXlsx([importEquipmentLine('JO-不該成功', 'ZT01', eqCat.code)]);
    const file = (name: string) => ({ name, mimeType: XLSX_TYPE, buffer: small });
    for (const k of roles.filter((r) => r !== 'ga_facility_edit')) {
      // 匯入：店長、設備查看者、無權限者不能預檢也不能提交
      expect((await apis[k].post(`${BASE}/asset-import/check`, { multipart: { file: file(importFileName('np')) } })).status(), `${k} 匯入預檢`).toBe(403);
      expect((await apis[k].post(`${BASE}/asset-import/commit`, { multipart: { file: file(importFileName('np')), idempotencyKey: `np-${k}-${Date.now()}-aaaa` } })).status(), `${k} 匯入提交`).toBe(403);
    }
    // 設施管理者不能匯入設備（資料庫判斷）
    expect((await apis.ga_facility_edit.post(`${BASE}/asset-import/check`, { multipart: { file: file(importFileName('np')) } })).status()).toBe(403);
    // 複核：店長（兩店）、設備查看者、無權限者都不能通過或退回；狀態不變
    for (const k of ['store_manager', 'ga_store_manager_b', 'ga_equipment_view', 'denied']) {
      for (const action of ['approve', 'reject'] as const) {
        const r = await apis[k].post(`${BASE}/onboarding/review`, { data: { assetType: 'EQUIPMENT', assetId: probe.id, action, note: '不該成功' } });
        expect([403, 404], `${k} ${action}`).toContain(r.status());
      }
    }
    expect((await status('ga_equipment', probe.name)).onboarding_status).toBe('PENDING_GA_REVIEW');
    // 上傳照片：他店店長、設備查看者、無權限者不能替這一台（ZT01、待上傳）上傳
    for (const k of ['ga_store_manager_b', 'ga_equipment_view', 'denied']) {
      const r = await apis[k].post(`${BASE}/onboarding/photo`, { multipart: { assetType: 'EQUIPMENT', assetId: probe2.id, purpose: 'PRIMARY_IMAGE', file: { name: 'm7m8t-np.png', mimeType: 'image/png', buffer: png() } } });
      expect([403, 404], `${k} 上傳`).toContain(r.status());
    }
    expect((await status('ga_equipment', probe2.name)).onboarding_status).toBe('NEEDS_EQUIPMENT_PHOTO');
    expect(((await adminDb().from('ga_resource_attachments').select('id').eq('resource_id', probe2.id).is('deleted_at', null)).data || []).length).toBe(0);
    // 進度與待辦：無權限者 403；設備查看者可看進度（唯讀）
    expect((await apis.denied.get(`${BASE}/onboarding/progress`)).status()).toBe(403);
    expect((await apis.denied.get(`${BASE}/onboarding/tasks`)).status()).toBe(403);
    expect((await apis.ga_equipment_view.get(`${BASE}/onboarding/progress`)).status()).toBe(200);
  } finally {
    for (const c of [...Object.values(apis), gaApi, mgrA]) await c.dispose();
  }
  // 介面：店長（手機）沒有「貼標複核」「Excel 匯入」，複核頁沒有按鈕；設備查看者沒有複核與匯入入口
  const m = await open(browser, 'store_manager', 'phone');
  const v = await open(browser, 'ga_equipment_view', 'desktop');
  try {
    await openGaCenter(m.page);
    const labelsM = await sideLabels(m.page);
    expect(labelsM).toEqual(expect.arrayContaining(['貼標待辦', '上線貼標進度']));
    expect(labelsM).not.toContain('貼標複核');
    expect(labelsM).not.toContain('Excel 匯入');
    const capsM = await m.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect([capsM.gaOnboardingReview, capsM.gaAssetImport]).toEqual([false, false]);
    await openGaCenter(v.page);
    const labelsV = await sideLabels(v.page);
    expect(labelsV).toContain('上線貼標進度');
    expect(labelsV).not.toContain('貼標複核');
    expect(labelsV).not.toContain('Excel 匯入');
    for (const w of [m, v]) expect(w.errors).toEqual([]);
  } finally {
    for (const w of [m, v]) await w.ctx.close();
  }
});
