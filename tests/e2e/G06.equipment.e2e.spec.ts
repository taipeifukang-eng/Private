import { expect, type Page, test } from '@playwright/test';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, seedCategory, seedEquipment, seedFacility, seedPart, seedRepairRequest, setupM7Users,
  type M7User,
} from '../support/m7m8-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, pageForUser } from '../support/g01-ui';
import { makePng } from '../support/png';

// M7/M8 第 2 批 G06／G07 e2e：設備清冊、新增設備、Q5 店長基本欄位、Q8 恢復、Q10 刪除被擋／更正門市、貼標待辦（店長手機）與貼標複核（總務）、料件手機卡片。
// 桌機 1440 與手機 390 各跑一次；店長一律是真正的 store_manager 角色（VW001），總務是 ga_works。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let eqCat: { id: string; code: string; name: string };
let facCat: { id: string };
let partCat: { id: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM7Users(['real_store_manager']);
  users = s.users;
  teardownUsers = s.teardown;
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
  partCat = await seedCategory('part', 'PC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
/** 設備列：桌機是表格列，手機是卡片。 */
const assetRow = (page: Page, text: string) => page.locator('tr:visible, li.asset-card:visible', { hasText: text });
async function openAsset(page: Page, name: string) {
  await searchBox(page).fill(name);
  const r = assetRow(page, name);
  await expect(r).toBeVisible();
  await r.getByRole('button', { name: /查看/ }).click();
  await expect(dialog(page).getByRole('heading', { name })).toBeVisible();
}
async function pickCategory(page: Page, scope: ReturnType<Page['locator']>, label: string, code: string) {
  const box = scope.getByRole('combobox', { name: new RegExp(label) });
  await box.fill(code);
  await scope.getByRole('option').filter({ hasText: code }).first().getByRole('button').first().click();
}
const managerState = async () => {
  const api = await apiForUser(users.real_store_manager);
  const state = await api.storageState();
  await api.dispose();
  return state;
};
const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });

test('G07 新增設備畫面：驗證提示、一次 3 台各自獨立、離開前有未儲存內容會確認', async ({ browser }, testInfo) => {
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '新增設備', '設備管理');
    await expect(heading(page, '新增設備')).toBeVisible();
    const form = page.locator('form.ga-create:visible');
    // 缺欄位會在畫面上提示，不送出
    await form.getByRole('button', { name: '新增設備' }).click();
    await expect(form.getByText('請選擇門市')).toBeVisible();
    await expect(form.getByText('請選擇設備分類')).toBeVisible();
    await expect(form.getByText('請輸入設備名稱')).toBeVisible();
    await form.getByLabel('新增數量').fill('101');
    await form.getByRole('button', { name: '新增設備' }).click();
    await expect(form.getByText('新增數量必須是 1 至 100 的整數')).toBeVisible();
    // 填寫
    await form.getByRole('combobox', { name: /所屬門市/ }).fill('ZT04');
    await form.getByRole('option').filter({ hasText: 'ZT04' }).first().getByRole('button').click();
    await pickCategory(page, form, '設備分類', eqCat.code);
    const name = m7Name('E2E-新增');
    await form.getByLabel('設備名稱').fill(name);
    await form.getByLabel('品牌', { exact: true }).fill('E2E品牌');
    await form.getByLabel('放置位置').fill('收銀台旁');
    await form.getByLabel('購買金額（每台）').fill('4500');
    await form.getByLabel('購買來源／供應商').fill('某供應商');
    await form.getByLabel('新增數量').fill('3');
    // 一次多台不能指定同一個資產編號
    await form.getByLabel('資產編號').fill('SAME-CODE');
    await form.getByRole('button', { name: '新增設備' }).click();
    await expect(form.getByText('一次新增多台時不能指定同一個資產編號')).toBeVisible();
    await form.getByLabel('資產編號').fill('');
    // 離開前確認：有未儲存內容時關閉頁籤會跳出確認
    await page.getByRole('button', { name: '關閉 新增設備' }).click();
    await expect(page.getByText('以下工作尚未儲存')).toBeVisible();
    await page.getByRole('button', { name: '繼續編輯' }).click();
    await expect(form.getByLabel('設備名稱')).toHaveValue(name);
    await form.getByRole('button', { name: '新增設備' }).click();
    await expect(notice(page, '已新增 3 台設備')).toBeVisible();
    const created = await rowsWhere('ga_equipment', 'name', name);
    expect(created).toHaveLength(3);
    expect(new Set(created.map((r) => r.qr_token)).size).toBe(3);
    expect(created[0]).toMatchObject({ brand: 'E2E品牌', location_detail: '收銀台旁', purchase_amount: 4500 });
    expect(created[0].specs.purchase_source_supplier).toBe('某供應商');
    // 儲存後頁籤不再顯示未儲存標記
    await expect(page.getByLabel('尚未儲存')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G06 設備清冊畫面：搜尋（含逗號括號）、詳情、編輯只送有改的欄位（供應商與保固申請方式保留）、改資產編號提醒標籤重印、離開未儲存的編輯要確認', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT04', eqCat.id, 'E2E-編輯', {
    asset_code: `E2E-AC-${Date.now()}`, location_detail: '倉庫', has_warranty: true, warranty_end_date: '2031-05-05', purchase_amount: 1200, notes: '舊備註',
    specs: { entry_mode: 'NEW_PURCHASE', purchase_source_supplier: '原廠直營', warranty_claim_method: 'ONLINE_REGISTRATION', warranty_claim_notes: null },
  });
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await expect(heading(page, '設備清冊')).toBeVisible();
    await searchBox(page).fill('a,b)(');
    await expect(page.getByText('找不到符合的設備').locator('visible=true').first()).toBeVisible();
    await openAsset(page, eq.name);
    await expect(dialog(page)).toContainText('原廠直營');
    await expect(dialog(page)).toContainText('申請保固方式');
    // 編輯：改位置與備註，沒碰供應商與保固申請方式
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page).getByRole('heading', { name: '編輯設備' })).toBeVisible();
    await expect(dialog(page)).toContainText('不能在這裡修改');
    await expect(dialog(page).getByLabel('購買來源／供應商')).toHaveValue('原廠直營');
    await dialog(page).getByLabel('放置位置').fill('收銀台旁');
    // 有未儲存的修改時取消會確認
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await expect(dialog(page)).toContainText('有尚未儲存的修改');
    await dialog(page).getByRole('button', { name: '繼續編輯' }).click();
    await dialog(page).getByLabel('資產編號').fill(`${eq.asset_code}-NEW`);
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, `已儲存設備「${eq.name}」`)).toBeVisible();
    await expect(notice(page, '已印出的 QR 標籤編號要重新列印')).toBeVisible();
    const db = await row('ga_equipment', eq.id);
    expect(db).toMatchObject({ location_detail: '收銀台旁', asset_code: `${eq.asset_code}-NEW`, notes: '舊備註', warranty_end_date: '2031-05-05', purchase_amount: 1200 });
    expect(db.specs).toMatchObject({ purchase_source_supplier: '原廠直營', warranty_claim_method: 'ONLINE_REGISTRATION' });
    // 另一個人同時改過：版本衝突，不蓋掉
    const other = await (await import('../support/auth')).apiAs('ga_works');
    const cur = await row('ga_equipment', eq.id);
    expect((await other.patch(`/api/workspace/general-affairs/equipment/${eq.id}`, { data: { area: '別人改的', expected_updated_at: cur.updated_at } })).status()).toBe(200);
    await other.dispose();
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await dialog(page).getByLabel('區域').fill('我改的');
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(dialog(page)).toContainText('已被其他人修改');
    expect((await row('ga_equipment', eq.id)).area).toBe('別人改的');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 409/.test(e))).toEqual([]); // 版本衝突的 409 是預期中的
  } finally {
    await c.close();
  }
});

test('Q10／Q8 畫面：有未結案單時刪除被擋並顯示張數、可改為報廢；報廢後總務恢復使用並沿用原 QR；更正所屬門市（原因必填、寫異動紀錄）；結案後可刪除', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT04', eqCat.id, 'E2E-刪除');
  const req = await seedRepairRequest('ZT04', { equipmentId: eq.id }, 'E2E-open', 'IN_PROGRESS', users.real_store_manager.id);
  const token = eq.qr_token;
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await openAsset(page, eq.name);
    // 刪除被擋
    await dialog(page).getByRole('button', { name: '刪除', exact: true }).click();
    await expect(dialog(page)).toContainText('還有 1 張未結案單，不能刪除（可改為「報廢」）');
    await expect(dialog(page).getByRole('button', { name: '確認刪除' })).toHaveCount(0);
    expect((await row('ga_equipment', eq.id)).deleted_at).toBeNull();
    // 改為報廢
    await dialog(page).getByRole('button', { name: '改為報廢' }).click();
    await expect(notice(page, '已將設備')).toBeVisible();
    expect((await row('ga_equipment', eq.id)).qr_token_revoked_at).toBeTruthy();
    // 掃描入口作廢；總務在詳情看到說明並可恢復
    await openAsset(page, eq.name);
    await expect(dialog(page)).toContainText('QR 標籤目前作廢');
    await dialog(page).getByRole('button', { name: '恢復使用並重新啟用 QR' }).click();
    await dialog(page).getByRole('button', { name: '確認恢復' }).click();
    await expect(dialog(page).getByText('請輸入恢復原因')).toBeVisible();
    await dialog(page).getByLabel('恢復原因').fill('E2E 誤報廢');
    await dialog(page).getByRole('button', { name: '確認恢復' }).click();
    await expect(notice(page, '原 QR 標籤可以繼續使用')).toBeVisible();
    expect(await row('ga_equipment', eq.id)).toMatchObject({ status: 'ACTIVE', qr_token: token, qr_token_revoked_at: null });
    // 更正所屬門市
    await openAsset(page, eq.name);
    await dialog(page).getByRole('button', { name: '更正所屬門市' }).click();
    await expect(dialog(page).last()).toContainText('只用在「建檔時選錯門市」');
    await dialog(page).last().getByRole('combobox', { name: /更正為/ }).fill('VW002');
    await dialog(page).last().getByRole('option').filter({ hasText: 'VW002' }).first().getByRole('button').click();
    await expect(dialog(page).last()).toContainText('還有 1 張未結案單');
    await dialog(page).last().getByRole('button', { name: '確認更正' }).click();
    await expect(dialog(page).last().getByText('請輸入更正原因')).toBeVisible();
    await dialog(page).last().getByLabel('更正原因').fill('E2E 建檔選錯');
    await dialog(page).last().getByRole('button', { name: '確認更正' }).click();
    await expect(notice(page, '已更正設備')).toBeVisible();
    const moved = await row('ga_equipment', eq.id);
    expect(moved.store_id).not.toBe(eq.store_id);
    const ev = await rowsWhere('ga_asset_events', 'asset_id', eq.id);
    expect(ev.find((e) => e.event_type === 'STORE_CORRECTION')).toMatchObject({ reason: 'E2E 建檔選錯', open_request_count: 1 });
    // 結案後可刪除
    await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', req.id);
    await openAsset(page, eq.name);
    await dialog(page).getByRole('button', { name: '刪除', exact: true }).click();
    await dialog(page).last().getByLabel('刪除原因').fill('E2E 清理');
    await dialog(page).last().getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, '已刪除設備')).toBeVisible();
    expect((await row('ga_equipment', eq.id)).deleted_at).toBeTruthy();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 40[49]/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('Q5 店長看設備清冊：只有自己門市設備的基本資料（沒有金額、供應商、備註、序號），沒有新增、編輯、刪除；他店設備看不到；手機是一筆一張卡片', async ({ browser }, testInfo) => {
  const mine = await seedEquipment('VW001', eqCat.id, 'E2E-店長', { serial_number: 'SN-E2E-秘', purchase_amount: 77777, notes: '內部備註-秘', specs: { purchase_source_supplier: '秘密供應商' }, area: '賣場', location_detail: '大門口' });
  const theirs = await seedEquipment('ZT01', eqCat.id, 'E2E-他店');
  const { ctx: c, page, errors } = await pageForUser(browser, await managerState(), testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await expect(heading(page, '設備清冊')).toBeVisible();
    await expect(page.getByText('店長身分只顯示自己門市設備的基本資料')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設備' }).locator('visible=true')).toHaveCount(0);
    await searchBox(page).fill(mine.name);
    const r = assetRow(page, mine.name);
    await expect(r).toBeVisible();
    await expect(r).toContainText('大門口');
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('li.asset-card:visible').first()).toBeVisible();
      await expect(page.locator('.asset-table:visible')).toHaveCount(0);
      const box = await r.getByRole('button', { name: /查看/ }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.locator('.asset-table:visible')).toHaveCount(1);
    }
    await r.getByRole('button', { name: /查看/ }).click();
    await expect(dialog(page)).toContainText('大門口');
    for (const hidden of ['77777', '內部備註', '秘密供應商', 'SN-E2E', '編輯', '刪除', '更正所屬門市']) await expect(dialog(page)).not.toContainText(hidden);
    await expect(dialog(page).getByRole('button', { name: '編輯' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    // 他店設備：搜尋不到
    await searchBox(page).fill(theirs.name);
    await expect(page.getByText('找不到符合的設備').locator('visible=true').first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('貼標流程：店長手機逐台上傳設備照與貼標照（設備與設施）→ 總務複核退回（必填原因）→ 店長看到原因兩張都重傳 → 總務通過 → 完成；店長沒有複核頁', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('VW001', eqCat.id, 'E2E-貼標設備');
  const fac = await seedFacility('VW001', facCat.id, 'E2E-貼標設施');
  const state = await managerState();
  const mgr = await pageForUser(browser, state, testInfo);
  const ga = await pageFor(browser, 'ga_works', testInfo);
  try {
    // 店長：貼標待辦
    await openGaCenter(mgr.page);
    await gaNavTo(mgr.page, '貼標待辦');
    await expect(heading(mgr.page, '貼標待辦')).toBeVisible();
    const card = (p: Page, name: string) => p.locator('[data-testid="onb-card"]:visible', { hasText: name });
    await expect(card(mgr.page, eq.name)).toBeVisible();
    await expect(card(mgr.page, fac.name)).toContainText('設施');
    await expect(card(mgr.page, eq.name)).toContainText('第 1 步');
    // 店長沒有複核頁
    await expect(mgr.page.locator('[data-testid="ga-shell"]:visible aside .ga-link', { hasText: '貼標複核' })).toHaveCount(0);
    const upload = async (name: string, expectText: string) => {
      const c1 = card(mgr.page, name);
      await c1.getByTestId('upload-input').setInputFiles({ name: 'm7m8t-e2e.png', mimeType: 'image/png', buffer: png() });
      await expect(c1.getByRole('button', { name: '上傳照片' })).toBeEnabled();
      await c1.getByRole('button', { name: '上傳照片' }).click();
      await expect(notice(mgr.page, expectText)).toBeVisible();
    };
    await upload(eq.name, '接著請上傳貼標位置照片');
    await expect(card(mgr.page, eq.name)).toContainText('第 2 步');
    expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('NEEDS_LABEL_PHOTO');
    await upload(eq.name, '等總務複核');
    expect((await row('ga_equipment', eq.id)).onboarding_status).toBe('PENDING_GA_REVIEW');
    await expect(card(mgr.page, eq.name)).toHaveCount(0); // 已離開「待我處理」
    await upload(fac.name, '接著請上傳貼標位置照片');
    await upload(fac.name, '等總務複核');
    expect((await row('ga_facilities', fac.id)).onboarding_status).toBe('PENDING_GA_REVIEW');
    expect(await noPageOverflow(mgr.page)).toBe(true);

    // 總務：貼標複核
    await openGaCenter(ga.page);
    await gaNavTo(ga.page, '貼標複核');
    await expect(heading(ga.page, '貼標複核')).toBeVisible();
    const rcard = (name: string) => ga.page.locator('[data-testid="review-card"]:visible', { hasText: name });
    await expect(rcard(eq.name)).toBeVisible();
    await expect(rcard(eq.name).locator('img')).toHaveCount(2);
    await expect(rcard(fac.name)).toBeVisible();
    await rcard(eq.name).getByRole('button', { name: '退回重拍' }).click();
    await dialog(ga.page).getByRole('button', { name: '確認退回' }).click();
    await expect(dialog(ga.page).getByText('退回重拍時必須填寫原因')).toBeVisible();
    await dialog(ga.page).getByLabel('退回原因').fill('貼標位置看不清楚');
    await dialog(ga.page).getByRole('button', { name: '確認退回' }).click();
    await expect(notice(ga.page, '店長需要重新上傳')).toBeVisible();
    expect(await row('ga_equipment', eq.id)).toMatchObject({ onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', onboarding_requires_primary_photo: true, onboarding_requires_label_photo: true });
    await rcard(fac.name).getByRole('button', { name: '通過' }).click();
    await dialog(ga.page).getByRole('button', { name: '確認通過' }).click();
    await expect(notice(ga.page, '已通過')).toBeVisible();
    expect((await row('ga_facilities', fac.id)).onboarding_status).toBe('COMPLETED');

    // 店長：看到退回原因，兩張都要重傳
    await mgr.page.getByRole('tab', { name: '等總務複核' }).click();
    await mgr.page.getByRole('tab', { name: '待我處理' }).click();
    await expect(card(mgr.page, eq.name)).toContainText('總務退回：貼標位置看不清楚');
    await expect(card(mgr.page, eq.name)).toContainText('兩張都要');
    await upload(eq.name, '接著請上傳貼標位置照片');
    await upload(eq.name, '等總務複核');
    // 總務通過
    await ga.page.getByRole('button', { name: '下一頁' }).locator('visible=true').first().isVisible();
    await gaNavTo(ga.page, '貼標複核');
    await ga.page.getByLabel('搜尋').locator('visible=true').first().fill(eq.name);
    await expect(rcard(eq.name)).toBeVisible();
    await rcard(eq.name).getByRole('button', { name: '通過' }).click();
    await dialog(ga.page).getByLabel('複核說明').fill('照片清楚');
    await dialog(ga.page).getByRole('button', { name: '確認通過' }).click();
    await expect(notice(ga.page, `已通過「${eq.name}」`)).toBeVisible();
    expect(await row('ga_equipment', eq.id)).toMatchObject({ onboarding_status: 'COMPLETED', onboarding_review_note: '照片清楚' });
    // 主圖只留一張，附件共 4 張（兩輪各兩張）
    const atts = await rowsWhere('ga_resource_attachments', 'resource_id', eq.id);
    expect(atts.filter((a) => a.purpose === 'PRIMARY_IMAGE' && a.is_primary && !a.deleted_at)).toHaveLength(1);
    expect(atts).toHaveLength(4);
    expect(await noPageOverflow(ga.page)).toBe(true);
    expect(mgr.errors.filter((e) => !/status of 409/.test(e))).toEqual([]);
    expect(ga.errors.filter((e) => !/status of 409/.test(e))).toEqual([]);
  } finally {
    await mgr.ctx.close();
    await ga.ctx.close();
  }
});

test('解讀 (d) 料件列表：手機（390）一筆一張卡片、操作按鈕在卡片底部且高度不小於 44px、不水平捲動；桌機維持表格', async ({ browser }, testInfo) => {
  const part = await seedPart(partCat.id, 'E2E-卡片料件', { brand: '卡片品牌', model: '卡片型號', specification: '卡片規格' });
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(heading(page, '料件列表')).toBeVisible();
    await searchBox(page).fill(part.name);
    if (testInfo.project.name === 'mobile-390') {
      const card = page.locator('li.part-card:visible', { hasText: part.name });
      await expect(card).toBeVisible();
      await expect(card).toContainText('卡片品牌 / 卡片型號 / 卡片規格');
      await expect(page.locator('.part-table:visible')).toHaveCount(0);
      for (const name of ['編輯', '停用', '刪除']) {
        const box = await card.getByRole('button', { name, exact: true }).boundingBox();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
      }
      expect(await page.locator('li.part-card:visible').count()).toBe(1); // 搜尋後一筆一張
    } else {
      await expect(page.locator('tr:visible', { hasText: part.name })).toBeVisible();
      await expect(page.locator('li.part-card:visible')).toHaveCount(0);
    }
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});
