import { expect, type Page, test } from '@playwright/test';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Name, row, rowsWhere, seedCategory, seedFacility, seedFacilityTemplate, seedRepairRequest, setupM7Users, type M7User,
} from '../support/m7m8-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, pageFor, pageForUser } from '../support/g01-ui';

// M7/M8 第 2 批 G08 e2e：新增設施（驗證提示、架型必選、新購要購買日期、保固起訖、貼標預設待上傳設施照片、離開未儲存確認）、設施清冊（搜尋含逗號括號、
// 詳情、編輯只送有改的欄位且保固與品牌保留、不能改所屬門市、版本衝突）、Q10／Q8（有未結案單不能刪除並顯示張數、可改退役、恢復並沿用 QR、更正所屬門市、結案後可刪除）、
// 店長只看自己門市設施的基本資料（手機一筆一張卡片、無水平捲動）。桌機 1440 與手機 390 各跑一次。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let facCat: { id: string; code: string; name: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM7Users(['real_store_manager']);
  users = s.users;
  teardownUsers = s.teardown;
  facCat = await seedCategory('facility', 'FC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
const assetRow = (page: Page, text: string) => page.locator('tr:visible, li.asset-card:visible', { hasText: text });
async function openFacility(page: Page, name: string) {
  await searchBox(page).fill(name);
  const r = assetRow(page, name);
  await expect(r).toBeVisible();
  await r.getByRole('button', { name: /查看/ }).click();
  await expect(dialog(page).getByRole('heading', { name })).toBeVisible();
}
const managerState = async () => {
  const api = await apiForUser(users.real_store_manager);
  const state = await api.storageState();
  await api.dispose();
  return state;
};

test('G08 新增設施畫面：驗證提示、新購要購買日期、架型必選且帶入分類、保固起訖、貼標預設待上傳設施照片、離開前有未儲存內容會確認', async ({ browser }, testInfo) => {
  const tpl = await seedFacilityTemplate('E2E-架型', { category_id: facCat.id, brand: '架型品牌', model: '架型型號', width_cm: 120, height_cm: 180, depth_cm: 40 });
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設施管理', '新增設施');
    await expect(heading(page, '新增設施')).toBeVisible();
    const form = page.locator('form.ga-create:visible');
    await form.getByRole('button', { name: '新增設施' }).click();
    for (const t of ['請先選擇這次是既有設施補登或新購設施', '請先選擇公司設施架型', '請選擇所在據點', '請輸入設施名稱', '請選擇設施分類', '請選擇或輸入據點區域', '請輸入詳細位置']) {
      await expect(form.getByText(t).first()).toBeVisible();
    }
    // 建檔方式、門市、架型
    await form.getByRole('radio', { name: '新購設施' }).check();
    await form.getByRole('combobox', { name: /所在據點/ }).fill('ZT04');
    await form.getByRole('option').filter({ hasText: 'ZT04' }).first().getByRole('button').click();
    await form.getByRole('searchbox', { name: '搜尋公司設施架型' }).fill(tpl.name);
    await form.locator('.tpl-list button', { hasText: tpl.name }).click();
    await expect(form.locator('.chosen')).toContainText(tpl.name);
    await expect(form.getByLabel('型號', { exact: true })).toHaveValue('架型型號'); // 帶入架型的型號
    await expect(form.getByLabel('說明')).toHaveValue(/寬 120 × 高 180 × 深 40 cm/);
    const name = m7Name('E2E-新增設施');
    await form.getByLabel('設施名稱').fill(name);
    await form.getByLabel(/^區域/).fill('收銀區');
    await form.getByLabel('詳細位置').fill('入口右側牆面');
    await form.getByLabel('數量').fill('2');
    await form.getByLabel('每單位購買金額').fill('1500');
    // 新購一定要購買日期
    await form.getByRole('button', { name: '新增設施' }).click();
    await expect(form.getByText('新購設施請填寫購買日期')).toBeVisible();
    await form.getByLabel('購買日期').fill('2026-03-01');
    // 有保固：到期日不能早於開始日
    await form.getByLabel('有保固').check();
    await form.getByLabel(/^保固開始日期/).fill('2026-03-01');
    await form.getByLabel(/^保固到期日期/).fill('2026-02-01');
    await form.getByRole('button', { name: '新增設施' }).click();
    await expect(form.getByText('保固開始日期不可晚於保固到期日期')).toBeVisible();
    await form.getByLabel(/^保固到期日期/).fill('2027-03-01');
    await expect(form.getByText('保固年限：約 13 個月')).toBeVisible();
    // 離開前確認
    await page.getByRole('button', { name: '關閉 新增設施' }).click();
    await expect(page.getByText('以下工作尚未儲存')).toBeVisible();
    await page.getByRole('button', { name: '繼續編輯' }).click();
    await form.getByRole('button', { name: '新增設施' }).click();
    await expect(notice(page, `已新增設施「${name}」`)).toBeVisible();
    const db = (await rowsWhere('ga_facilities', 'name', name))[0];
    expect(db).toMatchObject({ quantity: 2, unit: '座', purchase_unit_amount: 1500, purchase_amount: 3000, area: '收銀區', location_detail: '入口右側牆面', onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', facility_template_id: tpl.id, category_id: facCat.id });
    expect(db.specs).toMatchObject({ entry_mode: 'NEW_PURCHASE', facility_brand: '架型品牌', facility_model: '架型型號', facility_has_warranty: true, facility_warranty_start_date: '2026-03-01', facility_warranty_end_date: '2027-03-01' });
    expect(db.qr_token).toMatch(/^[a-z0-9]{24,64}$/);
    await expect(page.getByLabel('尚未儲存')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 400/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G08 設施清冊畫面：搜尋（含逗號括號）、詳情、編輯只送有改的欄位（品牌與保固申請方式保留）、不能改所屬門市、離開未儲存的編輯要確認、版本衝突不蓋掉', async ({ browser }, testInfo) => {
  const f = await seedFacility('ZT04', facCat.id, 'E2E-編輯設施', {
    facility_code: `E2EF-${Date.now()}`, area: '倉庫', location_detail: '後門', quantity: 1, unit: '座', notes: '舊備註', purchase_unit_amount: 800, purchase_amount: 800,
    specs: { entry_mode: 'NEW_PURCHASE', facility_brand: '原品牌', facility_model: '原型號', facility_has_warranty: true, facility_warranty_end_date: '2031-05-05', facility_warranty_claim_method: 'ONLINE_REGISTRATION' },
  });
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設施管理', '設施清冊');
    await expect(heading(page, '設施清冊')).toBeVisible();
    await searchBox(page).fill('a,b)(');
    await expect(page.getByText('找不到符合的設施').locator('visible=true').first()).toBeVisible();
    await openFacility(page, f.name);
    await expect(dialog(page)).toContainText('原品牌 / 原型號');
    await expect(dialog(page)).toContainText('待上傳設施照片'); // 貼標進度（設施用「設施照片」的說法）
    await expect(dialog(page)).toContainText('申請保固方式');
    await expect(dialog(page)).toContainText('上網登錄保固');
    // 編輯：改位置，沒碰品牌與保固申請方式
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page).getByRole('heading', { name: '編輯設施' })).toBeVisible();
    await expect(dialog(page)).toContainText('不能在這裡修改');
    await expect(dialog(page).getByLabel('品牌')).toHaveValue('原品牌');
    await dialog(page).getByLabel('詳細位置').fill('前門');
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await expect(dialog(page)).toContainText('有尚未儲存的修改');
    await dialog(page).getByRole('button', { name: '繼續編輯' }).click();
    await dialog(page).getByLabel('保固到期日期').fill('2032-06-06');
    await dialog(page).getByLabel('設施編號').fill(`${f.facility_code}-NEW`);
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, `已儲存設施「${f.name}」`)).toBeVisible();
    await expect(notice(page, '已印出的 QR 標籤編號要重新列印')).toBeVisible();
    const db = await row('ga_facilities', f.id);
    expect(db).toMatchObject({ location_detail: '前門', facility_code: `${f.facility_code}-NEW`, notes: '舊備註', store_id: f.store_id, purchase_amount: 800 });
    expect(db.specs).toMatchObject({ entry_mode: 'NEW_PURCHASE', facility_brand: '原品牌', facility_model: '原型號', facility_warranty_end_date: '2032-06-06', facility_warranty_claim_method: 'ONLINE_REGISTRATION' });
    // 另一個人同時改過：版本衝突，不蓋掉
    const other = await (await import('../support/auth')).apiAs('ga_works');
    const cur = await row('ga_facilities', f.id);
    expect((await other.patch(`/api/workspace/general-affairs/facilities/${f.id}`, { data: { area: '別人改的', expected_updated_at: cur.updated_at } })).status()).toBe(200);
    await other.dispose();
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await dialog(page).getByLabel('區域', { exact: true }).fill('我改的');
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(dialog(page)).toContainText('已被其他人修改');
    expect((await row('ga_facilities', f.id)).area).toBe('別人改的');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 409/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('Q10／Q8 設施畫面：有未結案單時刪除被擋並顯示張數、可改為退役；退役後總務恢復使用並沿用原 QR；更正所屬門市（原因必填、寫異動紀錄）；結案後可刪除', async ({ browser }, testInfo) => {
  const f = await seedFacility('ZT04', facCat.id, 'E2E-刪除設施');
  const req = await seedRepairRequest('ZT04', { facilityId: f.id }, 'E2E-fopen', 'IN_PROGRESS', users.real_store_manager.id);
  const token = f.qr_token;
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設施管理', '設施清冊');
    await openFacility(page, f.name);
    await dialog(page).getByRole('button', { name: '刪除', exact: true }).click();
    await expect(dialog(page)).toContainText('還有 1 張未結案單，不能刪除（可改為「退役」）');
    await expect(dialog(page).getByRole('button', { name: '確認刪除' })).toHaveCount(0);
    expect((await row('ga_facilities', f.id)).deleted_at).toBeNull();
    await dialog(page).getByRole('button', { name: '改為退役' }).click();
    await expect(notice(page, '已將設施')).toBeVisible();
    expect((await row('ga_facilities', f.id)).qr_token_revoked_at).toBeTruthy();
    await openFacility(page, f.name);
    await expect(dialog(page)).toContainText('QR 標籤目前作廢');
    await dialog(page).getByRole('button', { name: '恢復使用並重新啟用 QR' }).click();
    await dialog(page).getByRole('button', { name: '確認恢復' }).click();
    await expect(dialog(page).getByText('請輸入恢復原因')).toBeVisible();
    await dialog(page).getByLabel('恢復原因').fill('E2E 誤退役');
    await dialog(page).getByRole('button', { name: '確認恢復' }).click();
    await expect(notice(page, '原 QR 標籤可以繼續使用')).toBeVisible();
    expect(await row('ga_facilities', f.id)).toMatchObject({ status: 'ACTIVE', qr_token: token, qr_token_revoked_at: null });
    // 更正所屬門市
    await openFacility(page, f.name);
    await dialog(page).getByRole('button', { name: '更正所屬門市' }).click();
    await expect(dialog(page).last()).toContainText('只用在「建檔時選錯門市」');
    await dialog(page).last().getByRole('combobox', { name: /更正為/ }).fill('VW002');
    await dialog(page).last().getByRole('option').filter({ hasText: 'VW002' }).first().getByRole('button').click();
    await expect(dialog(page).last()).toContainText('還有 1 張未結案單');
    await dialog(page).last().getByRole('button', { name: '確認更正' }).click();
    await expect(dialog(page).last().getByText('請輸入更正原因')).toBeVisible();
    await dialog(page).last().getByLabel('更正原因').fill('E2E 建檔選錯');
    await dialog(page).last().getByRole('button', { name: '確認更正' }).click();
    await expect(notice(page, '已更正設施')).toBeVisible();
    expect((await row('ga_facilities', f.id)).store_id).not.toBe(f.store_id);
    const ev = await rowsWhere('ga_asset_events', 'asset_id', f.id);
    expect(ev.find((e) => e.event_type === 'STORE_CORRECTION')).toMatchObject({ reason: 'E2E 建檔選錯', open_request_count: 1 });
    // 結案後可刪除
    await adminDb().from('ga_service_requests').update({ main_status: 'COMPLETED' }).eq('id', req.id);
    await openFacility(page, f.name);
    await dialog(page).getByRole('button', { name: '刪除', exact: true }).click();
    await dialog(page).last().getByLabel('刪除原因').fill('E2E 清理');
    await dialog(page).last().getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, '已刪除設施')).toBeVisible();
    expect((await row('ga_facilities', f.id)).deleted_at).toBeTruthy();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/status of 40[49]/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('Q5 店長看設施清冊：只有自己門市設施的基本資料（沒有金額、備註、品牌型號），沒有新增、編輯、刪除；他店設施看不到；手機是一筆一張卡片', async ({ browser }, testInfo) => {
  const mine = await seedFacility('VW001', facCat.id, 'E2E-店長設施', {
    notes: '內部備註-秘', purchase_amount: 66666, area: '賣場', location_detail: '大門口', quantity: 1, unit: '座',
    specs: { facility_brand: '秘密品牌', facility_has_warranty: true, facility_warranty_end_date: '2031-01-01', facility_warranty_claim_method: 'OTHER', facility_warranty_claim_notes: '秘密做法' },
  });
  const theirs = await seedFacility('ZT01', facCat.id, 'E2E-他店設施');
  const { ctx: c, page, errors } = await pageForUser(browser, await managerState(), testInfo);
  try {
    await openGaCenter(page);
    const side = page.locator('[data-testid="ga-shell"]:visible aside');
    if (!(await side.getByRole('button', { name: '設施清冊', exact: true }).count())) await gaNavToIn(page, '設施管理', '設施清冊');
    else await side.getByRole('button', { name: '設施清冊', exact: true }).click();
    await expect(heading(page, '設施清冊')).toBeVisible();
    await expect(page.getByText('店長身分只顯示自己門市設施的基本資料')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增設施' }).locator('visible=true')).toHaveCount(0);
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
    for (const hidden of ['66666', '內部備註', '秘密品牌', '秘密做法']) await expect(dialog(page)).not.toContainText(hidden);
    for (const btn of ['編輯', '刪除', '更正所屬門市']) await expect(dialog(page).getByRole('button', { name: btn, exact: true })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    await searchBox(page).fill(theirs.name);
    await expect(page.getByText('找不到符合的設施').locator('visible=true').first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});
