import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, seedWorkOrder } from '../support/m7m8-fixtures';
import { freshValidTaxId, ga6Code, ga6Name, seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { addDays, taipeiToday } from '../../lib/workspace/general-affairs/vendor-rules';

// M7/M8 第 6 批 G20.layout／G21.layout.e2e（廠商、服務分類、服務區域的畫面流程與版面，桌機 1440 與手機 390 各跑一次）：
//  - 服務分類與服務區域：新增、編輯（代碼鎖定、上層不含自己）、新增下層、停用後仍顯示名稱。
//  - 廠商：四步驟新增（統編必填、需簽合約預設否、勾分類與行政區會連祖先一起勾、沒有附件步驟）、統編重複擋下並指出既有廠商、名稱相近只提醒、編輯留修改者、版本衝突提示、
//    合約即將到期卡片與篩選、停用時提醒還有進行中工單（只提醒不擋）、再啟用。
//  - 廠商填寫表：預覽只含啟用分類與縣市；列印樣式（模擬列印媒體）只留表單、兩頁 A4。
//  - 工單進度表單的廠商下拉：只列合作中、選了才更新、留白不清掉原廠商、停用廠商 API 回 422、已綁停用廠商顯示（已停用）仍可存進度。
// 每個彈出視窗都檢查沒有超出視窗寬度；每步用 service role 回讀資料庫。測試資料帶 QA-GA6- 標記、只用 VW 測試門市，結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
let apiGa: any;
const db = () => adminDb();
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const names = { cat: ga6Name('E2E-分類'), cat2: ga6Name('E2E-分類改'), catOff: ga6Name('E2E-停用分類'), city: ga6Name('E2E-縣市'), district: ga6Name('E2E-行政區'), cityOff: ga6Name('E2E-停用縣市'), vendor: ga6Name('E2E-廠商'), vendorSim: '', wo: ga6Name('E2E-工單') };
const ids: Record<string, string> = {};
let taxA = '';

async function dialogFits(page: Page) {
  const vp = page.viewportSize()!;
  const m = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, over: el.scrollWidth - el.clientWidth };
  });
  expect(m.left).toBeGreaterThanOrEqual(-1);
  expect(m.right).toBeLessThanOrEqual(vp.width + 1);
  expect(m.over).toBeLessThanOrEqual(1);
}
async function inViewport(page: Page, testid: string) {
  const vp = page.viewportSize()!;
  const b = dialog(page).getByTestId(testid).last();
  await b.scrollIntoViewIfNeeded();
  await expect(b).toBeInViewport({ ratio: 1 });
  const box = await b.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
}
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, label)).toBeVisible();
}
async function start(page: Page) {
  await openGaCenter(page);
}
const vrow = async (id: string) => (await db().from('ga_vendors').select('*').eq('id', id).single()).data as any;
const byName = async (table: string, name: string) => (await db().from(table).select('*').eq('name', name).maybeSingle()).data as any;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(['ga_all']);
  users = made.users;
  teardown = made.teardown;
  apiGa = await apiForUser(users.ga_all as any);
  state = await apiGa.storageState();
  taxA = await freshValidTaxId();
  // 填寫表用：一個停用分類、一個停用縣市（列印時不能出現）。
  await db().from('ga_service_categories').insert({ name: names.catOff, code: ga6Code('OFFC'), status: 'inactive', sort_order: 900 });
  await db().from('ga_service_regions').insert({ name: names.cityOff, code: ga6Code('OFFR'), region_type: 'city', status: 'inactive', sort_order: 900 });
});
test.afterAll(async () => {
  await apiGa?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('服務分類與服務區域：新增、編輯（代碼鎖定、上層不含自己）、新增下層、停用後仍顯示名稱；視窗不超出視窗寬度', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await start(page);
    await nav(page, '服務分類');
    // 新增
    await vis(page, 'new-item').click();
    await expect(dialog(page).getByTestId('tree-form')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('tf-save').click();
    await expect(dialog(page).getByTestId('tf-error')).toContainText('名稱'); // 名稱必填
    await dialog(page).getByTestId('tf-name').fill(names.cat);
    await dialog(page).getByTestId('tf-save').click();
    await expect(dialog(page).getByTestId('tf-error')).toContainText('代碼'); // 代碼必填
    await dialog(page).getByTestId('tf-code').fill(ga6Code('C1').toLowerCase());
    await inViewport(page, 'tf-save');
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toContainText(names.cat);
    const c = await byName('ga_service_categories', names.cat);
    expect(c.code).toBe(ga6Code('C1')); // 轉成大寫
    expect(c.status).toBe('active');
    ids.cat = c.id;
    // 重複代碼：白話訊息
    await vis(page, 'new-item').click();
    await dialog(page).getByTestId('tf-name').fill(names.cat2 + '重複');
    await dialog(page).getByTestId('tf-code').fill(ga6Code('C1'));
    await dialog(page).getByTestId('tf-save').click();
    await expect(dialog(page).getByTestId('tf-error')).toContainText('已經被');
    await dialog(page).getByTestId('tf-cancel').click();
    // 編輯：代碼不能改；上層清單不含自己；改名並停用
    await vis(page, 'tree-search').fill(names.cat);
    await vis(page, 'edit-' + names.cat).click();
    await expect(dialog(page).getByTestId('tf-code')).toBeDisabled();
    await expect(dialog(page).getByTestId('tf-code')).toHaveValue(ga6Code('C1'));
    expect(await dialog(page).getByTestId('tf-parent').locator('option', { hasText: names.cat }).count()).toBe(0);
    await dialog(page).getByTestId('tf-name').fill(names.cat2);
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toContainText(names.cat2);
    expect((await db().from('ga_service_categories').select('name,code,status').eq('id', ids.cat).single()).data).toMatchObject({ name: names.cat2, code: ga6Code('C1') });
    // 停用後仍顯示名稱（標示已停用）
    await vis(page, 'tree-search').fill(names.cat2);
    await vis(page, 'edit-' + names.cat2).click();
    await dialog(page).getByTestId('tf-status').selectOption('inactive');
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toBeVisible();
    await expect(page.locator('[data-testid="tree-row"]:visible', { hasText: names.cat2 }).getByTestId('tree-off')).toContainText('已停用');
    await vis(page, 'tree-search').fill(names.cat2);
    // 再啟用，後面廠商表單要勾這個分類
    await vis(page, 'edit-' + names.cat2).click();
    await dialog(page).getByTestId('tf-status').selectOption('active');
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    // 沒有刪除按鈕
    await expect(page.getByRole('button', { name: /刪除/ })).toHaveCount(0);

    // 服務區域：新增縣市、對縣市新增下層行政區
    await nav(page, '服務區域');
    await vis(page, 'new-item').click();
    await dialog(page).getByTestId('tf-name').fill(names.city);
    await dialog(page).getByTestId('tf-code').fill(ga6Code('R1'));
    await expect(dialog(page).getByTestId('tf-region-type')).toHaveValue('city');
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toContainText(names.city);
    const city = await byName('ga_service_regions', names.city);
    expect(city).toMatchObject({ region_type: 'city', parent_id: null, status: 'active' });
    ids.city = city.id;
    await vis(page, 'tree-search').fill(names.city);
    await vis(page, 'add-child-' + names.city).click();
    await expect(dialog(page).getByTestId('tf-parent')).toHaveValue(city.id);
    await expect(dialog(page).getByTestId('tf-region-type')).toHaveValue('district');
    await dialog(page).getByTestId('tf-name').fill(names.district);
    await dialog(page).getByTestId('tf-code').fill(ga6Code('R2'));
    await dialog(page).getByTestId('tf-save').click();
    await expect(vis(page, 'tree-saved')).toContainText(names.district);
    const dist = await byName('ga_service_regions', names.district);
    expect(dist).toMatchObject({ region_type: 'district', parent_id: city.id });
    ids.district = dist.id;
    // 循環：縣市的上層清單不含自己與子孫
    await vis(page, 'tree-search').fill(names.city);
    await vis(page, 'edit-' + names.city).click();
    const opts = await dialog(page).getByTestId('tf-parent').locator('option').allTextContents();
    expect(opts.some((t) => t.includes(names.city))).toBe(false);
    expect(opts.some((t) => t.includes(names.district))).toBe(false);
    await dialogFits(page);
    await dialog(page).getByTestId('tf-cancel').click();
    // 列表檢視（伺服端搜尋與分頁）
    await vis(page, 'view-list').click();
    await vis(page, 'tree-search').fill(names.district);
    await expect(vis(page, 'tree-total')).toHaveText('共 1 筆');
    await expect(vis(page, 'list-row')).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('廠商：四步驟新增（統編必填、需簽合約預設否、勾行政區連祖先一起勾、沒有附件步驟）、重複統編擋下並指出既有廠商、名稱相近只提醒、合約即將到期卡片與篩選', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await start(page);
    await nav(page, '廠商資料');
    await vis(page, 'new-vendor').click();
    await expect(dialog(page).getByTestId('vendor-form')).toBeVisible();
    await dialogFits(page);
    // 步驟列沒有附件
    const steps = await dialog(page).locator('.vf-steps button').allTextContents();
    expect(steps.map((s) => s.replace(/^\d+\.\s*/, ''))).toEqual(['基本資料', '服務範圍', '聯絡人', '合作與帳務']);
    await expect(dialog(page).locator('input[type="file"]')).toHaveCount(0);
    // 名稱必填、統編必填（公司）
    await dialog(page).getByTestId('vf-next').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('廠商名稱');
    await dialog(page).getByTestId('vf-name').fill(names.vendor);
    await dialog(page).getByTestId('vf-next').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('統一編號');
    await dialog(page).getByTestId('vf-tax').fill('123');
    await dialog(page).getByTestId('vf-next').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('8 碼');
    await dialog(page).getByTestId('vf-tax').fill(taxA);
    await dialog(page).getByTestId('vf-phone').fill('02-1234-5678');
    await dialog(page).getByTestId('vf-next').click();
    // 服務範圍：勾分類；展開縣市勾行政區 → 縣市一起勾
    await expect(dialog(page).getByTestId('vf-categories')).toBeVisible();
    await dialog(page).getByTestId('vf-cat-' + names.cat2).check();
    await expect(dialog(page).getByTestId('vf-cat-' + names.catOff)).toBeDisabled(); // 停用分類會列出，但不可新勾選
    await dialog(page).getByRole('button', { name: '展開' + names.city }).click();
    await dialog(page).getByTestId('vf-reg-' + names.district).check();
    await expect(dialog(page).getByTestId('vf-reg-' + names.city)).toBeChecked();
    await dialogFits(page);
    await dialog(page).getByTestId('vf-tags').fill('冷氣、水電');
    await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-contact').fill('王小明');
    await dialog(page).getByTestId('vf-contact-phone').fill('0912-345-678');
    await dialog(page).getByTestId('vf-email').fill('壞格式');
    await dialog(page).getByTestId('vf-next').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('Email');
    await dialog(page).getByTestId('vf-email').fill('wang@example.test');
    await dialog(page).getByTestId('vf-next').click();
    // 合作與帳務：需簽合約預設未勾；填到期日（10 天後）並勾需簽合約 → 會列入合約即將到期
    await expect(dialog(page).getByTestId('vf-contract-required')).not.toBeChecked();
    await dialog(page).getByTestId('vf-contract-required').check();
    await dialog(page).getByTestId('vf-contract-end').fill(addDays(taipeiToday(), 10));
    await dialog(page).getByTestId('vf-billing-title').fill('E2E 抬頭');
    await dialog(page).getByTestId('vf-terms').fill('月結30天');
    await inViewport(page, 'vf-save');
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(names.vendor);
    const v = await byName('ga_vendors', names.vendor);
    ids.vendor = v.id;
    expect(v).toMatchObject({ tax_id: taxA, status: 'active', contact_name: '王小明', email: 'wang@example.test', contract_required: true, billing_title: 'E2E 抬頭', payment_terms: '月結30天', updated_by: users.ga_all.id });
    expect(v.service_category_ids).toEqual([ids.cat]);
    expect([...v.service_region_ids].sort()).toEqual([ids.city, ids.district].sort());
    expect(v.tags).toEqual(['冷氣', '水電']);
    expect(v.attachment_names ?? []).toEqual([]);

    // 重複統編：擋下並指出既有廠商
    await vis(page, 'new-vendor').click();
    await dialog(page).getByTestId('vf-name').fill(ga6Name('E2E-重複統編'));
    await dialog(page).getByTestId('vf-tax').fill(taxA);
    for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('已經登錄在');
    await expect(dialog(page).getByTestId('vf-error')).toContainText(names.vendor);
    await expect(dialog(page).getByTestId('vf-existing')).toContainText(names.vendor);
    expect((await db().from('ga_vendors').select('id').eq('name', ga6Name('E2E-重複統編'))).data).toEqual([]);
    await dialog(page).getByTestId('vf-cancel').click();

    // 名稱相近：只提醒，仍可儲存
    names.vendorSim = names.vendor + '分公司';
    await vis(page, 'new-vendor').click();
    await dialog(page).getByTestId('vf-name').fill(names.vendorSim);
    await dialog(page).getByTestId('vf-tax').fill(await freshValidTaxId());
    for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(names.vendorSim);
    await expect(vis(page, 'vendor-warning').first()).toContainText('名稱相近');
    ids.vendorSim = (await byName('ga_vendors', names.vendorSim)).id;
    expect(ids.vendorSim).toBeTruthy();

    // 合約即將到期：統計卡與篩選，卡片標示到期日
    await vis(page, 'vendor-search').fill(names.vendor);
    const card = page.locator('[data-testid="vendor-card"]:visible', { hasText: names.vendor }).first();
    await expect(card.getByTestId('vendor-due')).toBeVisible();
    await vis(page, 'vendor-search').fill('');
    await vis(page, 'card-contract_due').click();
    await expect(vis(page, 'due-filter')).toBeVisible();
    await expect(page.locator('[data-testid="vendor-card"]:visible', { hasText: names.vendor })).toHaveCount(1);
    const dueCount = Number(await vis(page, 'stat-contract_due').innerText());
    expect(dueCount).toBeGreaterThanOrEqual(1);
    await expect(vis(page, 'vendor-total')).toHaveText(`共 ${dueCount} 家`);
    await vis(page, 'card-contract_due').click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('廠商：編輯（留修改者、不誤清欄位）、版本衝突提示、停用時提醒還有進行中工單（只提醒不擋）與再啟用；既有檔名唯讀顯示', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    // 前置：既有檔名（舊版留下的文字）與一張綁這家廠商的進行中工單
    await db().from('ga_vendors').update({ attachment_names: ['舊合約.pdf'] }).eq('id', ids.vendor);
    await seedWorkOrder('VW001', 'E2E-綁廠商', users.ga_all.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString(), vendor_id: ids.vendor });
    await start(page);
    await nav(page, '廠商資料');
    await vis(page, 'vendor-search').fill(names.vendor);
    const card = page.locator('[data-testid="vendor-card"]:visible', { hasText: names.vendor }).first();
    await card.getByTestId('open-detail').click();
    await expect(dialog(page).getByTestId('vd-legacy-files')).toContainText('舊合約.pdf');
    await dialogFits(page);
    // 編輯
    await dialog(page).getByTestId('vd-edit').click();
    await expect(dialog(page).getByTestId('vendor-form')).toBeVisible();
    await expect(dialog(page).getByTestId('vf-legacy-files')).toContainText('舊合約.pdf');
    await expect(dialog(page).getByTestId('vf-name')).toHaveValue(names.vendor);
    await dialog(page).getByTestId('vf-step-2').click();
    await dialog(page).getByTestId('vf-contact').fill('新聯絡人');
    await dialog(page).getByTestId('vf-step-3').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(names.vendor);
    let v = await vrow(ids.vendor);
    expect(v).toMatchObject({ contact_name: '新聯絡人', tax_id: taxA, billing_title: 'E2E 抬頭', contract_required: true, updated_by: users.ga_all.id });
    expect(v.service_category_ids).toEqual([ids.cat]);
    expect(v.attachment_names).toEqual(['舊合約.pdf']); // 編輯不動既有檔名
    // 版本衝突：開編輯後別人先改，再按儲存
    await card.getByTestId('open-detail').click();
    await dialog(page).getByTestId('vd-edit').click();
    await db().from('ga_vendors').update({ description: '別人改的', updated_at: new Date().toISOString() }).eq('id', ids.vendor);
    await dialog(page).getByTestId('vf-step-2').click();
    await dialog(page).getByTestId('vf-contact').fill('不該存進去');
    await dialog(page).getByTestId('vf-step-3').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('剛被其他人修改');
    expect((await vrow(ids.vendor)).contact_name).toBe('新聯絡人');
    await dialog(page).getByTestId('vf-cancel').click();
    // 停用：確認 → 提醒還有 1 張進行中工單，但照樣停用
    await card.getByTestId('open-detail').click();
    await dialog(page).getByTestId('vd-to-inactive').click();
    await expect(dialog(page).getByTestId('vd-confirm')).toContainText('不能再選這個廠商');
    await dialog(page).getByTestId('vd-confirm-yes').click();
    await expect(dialog(page).getByTestId('vd-notice')).toContainText('已停用');
    await expect(dialog(page).getByTestId('vd-warning')).toContainText('1 張進行中工單');
    await expect(dialog(page).getByTestId('vd-status')).toHaveText('停用');
    expect((await vrow(ids.vendor)).status).toBe('inactive');
    // 再啟用
    await dialog(page).getByTestId('vd-to-active').click();
    await dialog(page).getByTestId('vd-confirm-yes').click();
    await expect(dialog(page).getByTestId('vd-status')).toHaveText('合作中');
    expect((await vrow(ids.vendor)).status).toBe('active');
    await dialog(page).getByTestId('vd-close').click();
    // 狀態篩選
    await vis(page, 'vendor-search').fill('');
    await vis(page, 'filter-status').selectOption('inactive');
    await expect(page.locator('[data-testid="vendor-card"]:visible', { hasText: names.vendor })).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('廠商填寫表：預覽只含啟用分類與縣市；列印樣式只留表單（兩頁 A4），螢幕上不顯示列印用的那份', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await start(page);
    await nav(page, '廠商資料');
    await expect(page.getByTestId('vendor-print-output')).toHaveCount(0);
    await vis(page, 'open-print').click();
    await expect(dialog(page).getByTestId('vendor-print-sheet')).toBeVisible();
    await dialogFits(page);
    const cats = await dialog(page).getByTestId('vp-cat').allTextContents();
    expect(cats.some((t) => t.includes(names.cat2))).toBe(true);
    expect(cats.some((t) => t.includes(names.catOff))).toBe(false);
    const cities = await dialog(page).getByTestId('vp-city').allTextContents();
    expect(cities.some((t) => t.includes(names.city))).toBe(true);
    expect(cities.some((t) => t.includes(names.cityOff))).toBe(false);
    expect(cities.some((t) => t.includes(names.district))).toBe(false); // 只印縣市，不印行政區
    // 螢幕上列印用那份是隱藏的；模擬列印媒體後只剩它
    const out = page.getByTestId('vendor-print-output');
    await expect(out).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(out).toBeVisible();
    expect(await out.locator('.vp-page').count()).toBe(2);
    const hiddenOthers = await page.evaluate(() => {
      const shellEl = document.querySelector('[data-testid="ga-shell"]');
      return shellEl ? getComputedStyle(shellEl.closest('body > *') as Element).display : 'none';
    });
    expect(hiddenOthers).toBe('none');
    const box = await out.boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    await page.emulateMedia({ media: 'screen' });
    await expect(out).toBeHidden();
    await dialog(page).getByTestId('print-close').click();
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('工單進度的廠商下拉：只列合作中、選了才更新、留白不清掉原廠商、停用廠商 API 回 422、已綁停用廠商顯示（已停用）仍可存進度', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const on = await seedGa6Vendor('WO-ON', { contact_name: '工單聯絡人', contact_phone: '02-8888-0000' });
  const off = await seedGa6Vendor('WO-OFF', { status: 'inactive' });
  const wo = await seedWorkOrder('VW001', 'E2E-工單廠商', users.ga_all.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: new Date().toISOString() });
  const row = async () => (await db().from('maintenance_requests').select('vendor_id,updated_at,progress_stage').eq('id', wo.id).single()).data as any;
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '工單中心');
    const open = async () => {
      if (isPhone(page) && (await vis(page, 'wo-back').count())) await vis(page, 'wo-back').first().click();
      await vis(page, 'wob-search').fill(wo.title);
      await expect(vis(page, 'wob-card')).toHaveCount(1);
      await vis(page, 'wob-open').first().click();
      await expect(vis(page, 'wo-detail')).toBeVisible();
    };
    await open();
    await expect(vis(page, 'wo-vendor')).toHaveText('—');
    await vis(page, 'act-progress').click();
    await expect(dialog(page).getByTestId('vendor-select')).toBeVisible();
    await expect(dialog(page).getByTestId('vs-current')).toContainText('尚未指定');
    await dialogFits(page);
    // 只列合作中：有 WO-ON（含聯絡人與電話）、沒有 WO-OFF
    const select = dialog(page).getByTestId('f-vendor');
    await expect(select.locator('option', { hasText: on.name })).toHaveCount(1);
    await expect(select.locator('option', { hasText: on.name })).toContainText('工單聯絡人');
    await expect(select.locator('option', { hasText: off.name })).toHaveCount(0);
    await select.selectOption(on.id);
    await dialog(page).getByTestId('f-notes').fill('指定廠商處理');
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(vis(page, 'wo-vendor')).toContainText(on.name);
    expect((await row()).vendor_id).toBe(on.id);
    // 再存一次進度、廠商留白：不清掉原廠商
    await vis(page, 'act-progress').click();
    await expect(dialog(page).getByTestId('vs-current')).toContainText(on.name);
    await expect(dialog(page).getByTestId('f-vendor')).toHaveValue('');
    await dialog(page).getByTestId('f-notes').fill('只更新說明');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(vis(page, 'wo-vendor')).toContainText(on.name);
    expect((await row()).vendor_id).toBe(on.id);
    // API：新選停用廠商被擋（422 VENDOR_INACTIVE），工單不變
    const before = await row();
    const bad = await apiGa.post(`/api/workspace/general-affairs/work-orders/${wo.id}/progress`, { data: { notes: '想改成停用廠商', vendor_id: off.id, expected_updated_at: before.updated_at } });
    expect(bad.status(), await bad.text()).toBe(422);
    expect((await bad.json()).code).toBe('VENDOR_INACTIVE');
    expect(await row()).toEqual(before);
    // 不存在的廠商：404
    const miss = await apiGa.post(`/api/workspace/general-affairs/work-orders/${wo.id}/progress`, { data: { notes: '找不到', vendor_id: '00000000-0000-4000-8000-000000000001', expected_updated_at: before.updated_at } });
    expect([404, 422], await miss.text()).toContain(miss.status());
    expect(await row()).toEqual(before);
    // 審查 A5：廠商值不是合法識別碼，要回 400，不能被當成「沒給」而回 200 卻沒更新
    const garbage = await apiGa.post(`/api/workspace/general-affairs/work-orders/${wo.id}/progress`, { data: { notes: '壞格式', vendor_id: 'not-a-uuid', expected_updated_at: before.updated_at } });
    expect(garbage.status(), await garbage.text()).toBe(400);
    expect(await row()).toEqual(before);
    // 已綁廠商後來被停用：詳情顯示（已停用），仍可存進度（沒選廠商不檢查），沒有清掉
    await db().from('ga_vendors').update({ status: 'inactive' }).eq('id', on.id);
    await page.reload();
    await openGaCenter(page);
    await nav(page, '工單中心');
    await open();
    await expect(vis(page, 'wo-vendor')).toContainText('（已停用）');
    await vis(page, 'act-progress').click();
    await expect(dialog(page).getByTestId('vs-current')).toContainText('（已停用）');
    await dialog(page).getByTestId('f-notes').fill('廠商停用後照常存進度');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(vis(page, 'act-progress')).toBeVisible();
    expect((await row()).vendor_id).toBe(on.id);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
