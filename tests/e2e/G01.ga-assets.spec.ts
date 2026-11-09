import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Code, m7Name, rowsWhere, seedBalance, seedCategory, seedEquipment, seedLocation, seedPart, setupM7Users,
  M7_FILE_PREFIX, type M7User,
} from '../support/m7m8-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, pageForUser, shell } from '../support/g01-ui';
import { makePng } from '../support/png';

// M7/M8 G01-G05 e2e：真的操作畫面（桌機 1440 與手機 390 各跑一次）。
// 涵蓋：分類（新增、子分類、停用被擋與說明、刪除、停用）、料件（新增、重複確認、編輯、單位鎖定、附件上傳／4MB／只標記刪除、有庫存擋刪除、刪除）、
//      店長只看得到基本欄位、設備型號（含適用料件、歸戶預覽與確認、用中不能刪）、設施架型、適用料件設定（他人同時修改提示）。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let ctx: { partCat: any; eqCat: any; facCat: any };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM7Users(['real_store_manager']);
  users = s.users;
  teardownUsers = s.teardown;
  ctx = { partCat: await seedCategory('part', 'PC'), eqCat: await seedCategory('equipment', 'EC'), facCat: await seedCategory('facility', 'FC') };
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const dialog = (page: Page) => page.locator('dialog[open]');
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
/** 在分類選擇器裡用代碼搜尋並選取。 */
async function pickCategory(page: Page, scope: ReturnType<Page['locator']>, label: string, code: string) {
  const box = scope.getByRole('combobox', { name: new RegExp(label) });
  await box.fill(code);
  await scope.getByRole('option').filter({ hasText: code }).first().getByRole('button').first().click();
}

test('G02 分類畫面：新增、搜尋、子分類、停用被擋並說明原因、刪除、停用', async ({ browser }, testInfo) => {
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備分類', '設備管理');
    await expect(heading(page, '設備分類')).toBeVisible();
    const parentName = m7Name('E2E-父');
    const parentCode = m7Code('E2EP');
    await page.getByRole('button', { name: '新增分類' }).locator('visible=true').click();
    await dialog(page).getByLabel('名稱', { exact: false }).first().fill(parentName);
    await dialog(page).getByLabel('代碼', { exact: false }).first().fill(parentCode.toLowerCase());
    await dialog(page).getByRole('checkbox', { name: /必填品牌/ }).check();
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, '已新增分類')).toBeVisible();
    // 搜尋（含逗號與括號不會壞掉）
    const search = page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
    await search.fill('a,b)(');
    await expect(page.getByText('找不到符合的分類').locator('visible=true').first()).toBeVisible();
    await search.fill(parentCode);
    const row = page.locator('tr:visible', { hasText: parentName });
    await expect(row).toBeVisible();
    await expect(row).toContainText('啟用中');
    // 在這個分類底下新增子分類
    await row.getByRole('button', { name: '新增子分類' }).click();
    await expect(dialog(page)).toContainText(parentName);
    await dialog(page).getByLabel('名稱', { exact: false }).first().fill(m7Name('E2E-子'));
    await dialog(page).getByLabel('代碼', { exact: false }).first().fill(m7Code('E2EC'));
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(notice(page, '已新增分類')).toBeVisible();
    expect((await rowsWhere('ga_equipment_categories', 'code', m7Code('E2EC')))[0].parent_id).toBe((await rowsWhere('ga_equipment_categories', 'code', parentCode))[0].id);
    // 父分類停用被擋（底下有 1 個啟用中的子分類）
    await search.fill(parentCode);
    const prow = page.locator('tr:visible', { hasText: parentName });
    await expect(prow).toContainText('1 個');
    await prow.getByRole('button', { name: '停用', exact: true }).click();
    await expect(dialog(page)).toContainText('底下還有 1 個啟用中的子分類');
    await expect(dialog(page).getByRole('button', { name: '確認停用' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    expect((await rowsWhere('ga_equipment_categories', 'code', parentCode))[0].is_active).toBe(true);
    // 刪除子分類（沒有項目）
    await prow.getByRole('button', { name: /1 個/ }).click();
    await expect(page.getByRole('button', { name: '最上層' }).locator('visible=true').first()).toBeEnabled();
    const crow = page.locator('tr:visible', { hasText: m7Name('E2E-子') });
    await crow.getByRole('button', { name: '刪除', exact: true }).click();
    await expect(dialog(page)).toContainText('可以刪除');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, '已刪除分類')).toBeVisible();
    expect((await rowsWhere('ga_equipment_categories', 'code', m7Code('E2EC')))[0].deleted_at).toBeTruthy();
    // 父分類現在可以停用
    await page.getByRole('button', { name: '最上層' }).locator('visible=true').first().click();
    await search.fill(parentCode);
    await page.locator('tr:visible', { hasText: parentName }).getByRole('button', { name: '停用', exact: true }).click();
    await expect(dialog(page)).toContainText('可以停用');
    await dialog(page).getByRole('button', { name: '確認停用' }).click();
    await expect(notice(page, '已停用分類')).toBeVisible();
    await expect(page.locator('tr:visible', { hasText: parentName })).toContainText('已停用');
    expect((await rowsWhere('ga_equipment_categories', 'code', parentCode))[0].is_active).toBe(false);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G03 料件畫面：新增、重複確認、編輯、單位鎖定、附件（照片上傳、超過 4MB 被擋、只標記刪除）、有庫存不能刪、刪除', async ({ browser }, testInfo) => {
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '新增料件', '料件管理');
    await expect(heading(page, '新增料件')).toBeVisible();
    const form = page.locator('form.ga-create:visible');
    await pickCategory(page, form, '料件分類', ctx.partCat.code);
    await expect(form).toContainText(ctx.partCat.name);
    const name1 = m7Name('E2E-甲料件');
    await form.getByLabel('料件名稱').fill(name1);
    await form.getByLabel('品牌', { exact: true }).fill('E2EB');
    await form.getByLabel('型號', { exact: true }).fill('E2EM');
    await form.getByLabel('規格', { exact: true }).fill('E2ES');
    await form.getByLabel('基本庫存單位').fill('個');
    await form.getByLabel('內部備註').fill('E2E 內部備註 99 元');
    // 缺欄位會在畫面上提示
    await form.getByLabel('料件名稱').fill('');
    await form.getByRole('button', { name: '新增料件' }).click();
    await expect(form.getByText('請輸入料件名稱')).toBeVisible();
    await form.getByLabel('料件名稱').fill(name1);
    await form.getByRole('button', { name: '新增料件' }).click();
    await expect(notice(page, `已新增料件「${name1}」`)).toBeVisible();
    // 同品牌＋型號＋規格再新增 -> 先顯示既有料件，確認後才建立
    await pickCategory(page, form, '料件分類', ctx.partCat.code);
    const name2 = m7Name('E2E-乙料件');
    await form.getByLabel('料件名稱').fill(name2);
    await form.getByLabel('品牌', { exact: true }).fill('E2EB');
    await form.getByLabel('型號', { exact: true }).fill('E2EM');
    await form.getByLabel('規格', { exact: true }).fill('E2ES');
    await form.getByLabel('基本庫存單位').fill('個');
    await form.getByRole('button', { name: '新增料件' }).click();
    const dup = page.getByRole('alertdialog', { name: '可能重複的料件' }).locator('visible=true');
    await expect(dup).toContainText(name1);
    expect(await rowsWhere('ga_parts', 'name', name2)).toEqual([]);
    await dup.getByRole('button', { name: '回去修改' }).click();
    await form.getByRole('button', { name: '新增料件' }).click();
    await dup.getByRole('button', { name: '仍要新增' }).click();
    await expect(notice(page, `已新增料件「${name2}」`)).toBeVisible();
    expect((await rowsWhere('ga_parts', 'name', name2))).toHaveLength(1);

    // 列表：搜尋與編輯
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(heading(page, '料件列表')).toBeVisible();
    const search = page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
    await search.fill(name1);
    const row = page.locator('tr:visible', { hasText: name1 });
    await expect(row).toBeVisible();
    await expect(row).toContainText('E2E 內部備註 99 元'); // 總務看得到內部備註
    await row.getByRole('button', { name: '編輯' }).click();
    const edit = dialog(page);
    await edit.getByLabel('料件名稱').fill(m7Name('E2E-甲料件-改'));
    // 還沒有庫存：單位可以改
    await expect(edit.getByLabel('基本庫存單位')).toBeEnabled();
    await edit.getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, '已儲存料件')).toBeVisible();
    const part = (await rowsWhere('ga_parts', 'name', m7Name('E2E-甲料件-改')))[0];
    expect(part).toBeTruthy();

    // 附件：照片上傳（縮小後）、PDF 超過 4MB 被擋、只標記刪除
    await search.fill(m7Name('E2E-甲料件-改'));
    await page.locator('tr:visible', { hasText: m7Name('E2E-甲料件-改') }).getByRole('button', { name: '編輯' }).click();
    const panel = dialog(page).getByRole('region', { name: '料件照片與文件' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('目前沒有附件');
    await panel.getByTestId('upload-input').setInputFiles({ name: `${M7_FILE_PREFIX}e2e.png`, mimeType: 'image/png', buffer: makePng({ width: 120, height: 80, inkPixels: 20 }) });
    await expect(panel.getByText(`${M7_FILE_PREFIX}e2e.png`).first()).toBeVisible();
    await panel.getByRole('button', { name: /上傳 1 個檔案/ }).click();
    await expect(panel.locator('.notice.success')).toContainText('已上傳 1 個檔案');
    await expect(panel.locator('.attachment-grid li')).toHaveCount(1);
    await panel.getByTestId('upload-input').setInputFiles({ name: `${M7_FILE_PREFIX}big.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 1) });
    await expect(panel.getByRole('alert')).toContainText('超過 4MB');
    await expect(panel.getByRole('button', { name: /上傳 \d+ 個檔案/ })).toHaveCount(0);
    expect((await rowsWhere('ga_resource_attachments', 'resource_id', part.id)).filter((r) => !r.deleted_at)).toHaveLength(1);
    await panel.getByRole('button', { name: /^刪除 / }).click();
    const del = dialog(page).last();
    await expect(del).toContainText('原始檔案仍保留');
    await del.getByRole('button', { name: '確認刪除' }).click();
    await expect(del.getByText('請輸入刪除原因')).toBeVisible();
    await del.getByLabel('刪除原因').fill('拍錯了');
    await del.getByRole('button', { name: '確認刪除' }).click();
    await expect(panel.locator('.notice.success')).toContainText('已標記刪除');
    const att = (await rowsWhere('ga_resource_attachments', 'resource_id', part.id))[0];
    expect(att.deleted_at).toBeTruthy();
    expect((await adminDb().storage.from('general-affairs-attachments').download(att.storage_path)).error).toBeNull();
    await dialog(page).getByRole('button', { name: '取消' }).first().click();

    // 有庫存：單位鎖定、刪除被擋並說明；庫存歸零後可刪
    const loc = await seedLocation(null, 'E2E-L');
    const bal = await seedBalance(loc.id, part.id, 4);
    await page.locator('tr:visible', { hasText: m7Name('E2E-甲料件-改') }).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page)).toContainText('基本單位、採購單位與換算率已鎖定');
    await expect(dialog(page).getByLabel('基本庫存單位')).toBeDisabled();
    await dialog(page).getByRole('button', { name: '取消' }).first().click();
    await page.locator('tr:visible', { hasText: m7Name('E2E-甲料件-改') }).getByRole('button', { name: '刪除' }).click();
    await expect(dialog(page)).toContainText('仍有庫存');
    await expect(dialog(page).getByRole('button', { name: '確認刪除' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    await adminDb().from('ga_inventory_balances').update({ quantity_base: 0 }).eq('id', bal.id);
    await page.locator('tr:visible', { hasText: m7Name('E2E-甲料件-改') }).getByRole('button', { name: '刪除' }).click();
    await dialog(page).getByLabel('刪除原因').fill('E2E 建錯了');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, '已刪除料件')).toBeVisible();
    expect((await rowsWhere('ga_parts', 'id', part.id))[0]).toMatchObject({ deletion_reason: 'E2E 建錯了' });
    expect(await noPageOverflow(page)).toBe(true);
    // 重複確認流程會有兩次預期中的 409（先擋下、確認後才建立），其餘不得有錯誤
    expect(errors.filter((e) => /status of 409/.test(e))).toHaveLength(2);
    expect(errors.filter((e) => !/status of 409/.test(e))).toEqual([]);
  } finally {
    await c.close();
  }
});

test('Q5 店長看料件：只有基本資料（沒有內部備註欄、沒有新增與編輯），側欄不列分類與型號', async ({ browser }, testInfo) => {
  const part = await seedPart(ctx.partCat.id, 'E2E-Q5', { notes: '採購價 99 元，廠商交涉中' });
  const api = await apiForUser(users.real_store_manager);
  const state = await api.storageState();
  await api.dispose();
  const { ctx: c, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '料件列表', '料件管理');
    await expect(heading(page, '料件列表')).toBeVisible();
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(part.name);
    await expect(page.locator('tr:visible', { hasText: part.name })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '內部備註' }).locator('visible=true')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '操作' }).locator('visible=true')).toHaveCount(0);
    await expect(page.getByText('採購價 99 元')).toHaveCount(0);
    await expect(page.getByText('店長身分只顯示料件基本資料')).toBeVisible();
    await expect(page.getByRole('button', { name: '新增料件' }).locator('visible=true')).toHaveCount(0);
    const labels = (await shell(page).locator('aside .ga-link').allTextContents()).map((t) => t.trim());
    for (const hidden of ['料件分類', '新增料件', '適用料件設定', '公司設備型號', '公司設施架型']) expect(labels.some((t) => t.startsWith(hidden)), hidden).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G04 設備型號畫面：新增（含適用料件）、既有設備歸戶（逐台原值→新值、確認後才改）、用中不能刪', async ({ browser }, testInfo) => {
  const eqCat = await seedCategory('equipment', 'E2E-T');
  const part = await seedPart(ctx.partCat.id, 'E2E-T-part');
  const e1 = await seedEquipment('VW001', eqCat.id, 'E2E-RH1', { brand: '舊品牌A' });
  const e2 = await seedEquipment('ZT01', eqCat.id, 'E2E-RH2');
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '公司設備型號', '設備管理');
    await expect(heading(page, '公司設備型號')).toBeVisible();
    await page.getByRole('button', { name: '新增設備型號' }).locator('visible=true').click();
    const form = dialog(page);
    const tplName = m7Name('E2E-型號');
    await form.getByLabel('設備型號名稱').fill(tplName);
    await pickCategory(page, form, '設備分類', eqCat.code);
    await form.getByLabel('品牌', { exact: true }).fill('E2ETB');
    await form.getByLabel('型號', { exact: true }).fill(m7Code('E2ETM'));
    await form.getByLabel('預設保固月數').fill('24');
    await form.getByLabel('加入料件').fill(part.name);
    await form.getByRole('listitem').filter({ hasText: part.name }).getByRole('button', { name: '加入' }).click();
    await expect(form.getByRole('list', { name: '已選料件' })).toContainText(part.name);
    await form.getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, `已儲存設備型號「${tplName}」`)).toBeVisible();
    const tpl = (await rowsWhere('ga_equipment_templates', 'name', tplName))[0];
    expect(tpl).toMatchObject({ default_warranty_months: 24 });
    expect((await rowsWhere('ga_part_target_compatibilities', 'target_id', tpl.id)).filter((r) => !r.deleted_at).map((r) => r.part_id)).toEqual([part.id]);

    // 歸戶
    const search = page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
    await search.fill(tplName);
    const trow = page.locator('tr:visible', { hasText: tplName });
    await trow.getByRole('button', { name: '整理既有設備歸戶' }).click();
    const rh = dialog(page);
    await rh.getByLabel('搜尋設備').fill('E2E-RH');
    await rh.getByRole('checkbox', { name: new RegExp('選取 .*E2E-RH1') }).check();
    await rh.getByRole('checkbox', { name: new RegExp('選取 .*E2E-RH2') }).check();
    await rh.getByRole('button', { name: /預覽改動（2 台）/ }).click();
    await expect(rh).toContainText('改了之後不能還原');
    await expect(rh).toContainText('舊品牌A'); // 原值
    await expect(rh).toContainText('E2ETB'); // 新值
    await expect(rh.getByRole('button', { name: '確認歸戶' })).toBeDisabled();
    expect((await rowsWhere('ga_equipment', 'id', e1.id))[0].template_id).toBeNull(); // 預覽不改資料
    await rh.getByRole('checkbox', { name: /不能還原/ }).check();
    await rh.getByRole('button', { name: '確認歸戶' }).click();
    await expect(notice(page, '已將 2 台既有設備歸戶')).toBeVisible();
    for (const e of [e1, e2]) expect((await rowsWhere('ga_equipment', 'id', e.id))[0]).toMatchObject({ template_id: tpl.id, name: tplName, brand: 'E2ETB' });
    // 用中不能刪
    await expect(page.locator('tr:visible', { hasText: tplName })).toContainText('2 筆設備');
    await page.locator('tr:visible', { hasText: tplName }).getByRole('button', { name: '刪除' }).click();
    await expect(dialog(page)).toContainText('已有 2 筆設備在使用，不能刪除');
    await expect(dialog(page).getByRole('button', { name: '確認刪除' })).toHaveCount(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    // 停用
    await page.locator('tr:visible', { hasText: tplName }).getByRole('button', { name: '停用', exact: true }).click();
    await expect(notice(page, '已停用設備型號')).toBeVisible();
    expect((await rowsWhere('ga_equipment_templates', 'id', tpl.id))[0].is_active).toBe(false);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G04 設施架型畫面：新增、停用、沒人用才能刪（須填原因）', async ({ browser }, testInfo) => {
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '公司設施架型', '設施管理');
    await expect(heading(page, '公司設施架型')).toBeVisible();
    await page.getByRole('button', { name: '新增設施架型' }).locator('visible=true').click();
    const form = dialog(page);
    const name = m7Name('E2E-架型');
    await form.getByLabel('設施架型名稱').fill(name);
    await form.getByLabel('架型代碼').fill(m7Code('E2EF'));
    await form.getByLabel('寬度 cm').fill('120');
    await form.getByLabel('高度 cm').fill('180');
    await form.getByRole('button', { name: '儲存' }).click();
    await expect(notice(page, `已儲存設施架型「${name}」`)).toBeVisible();
    const search = page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
    await search.fill(m7Code('E2EF'));
    const row = page.locator('tr:visible', { hasText: name });
    await expect(row).toContainText('120');
    await row.getByRole('button', { name: '刪除' }).click();
    await expect(dialog(page)).toContainText('沒有設施在使用，可以刪除');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(dialog(page).getByText('請輸入刪除原因')).toBeVisible();
    await dialog(page).getByLabel('刪除原因').fill('E2E 沒人用');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, '已刪除設施架型')).toBeVisible();
    expect((await rowsWhere('ga_facility_templates', 'name', name))[0]).toMatchObject({ deletion_reason: 'E2E 沒人用' });
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G05 適用料件設定畫面：選型號、加減料件、儲存；另一個人同時改過時提示重新載入而不蓋掉', async ({ browser }, testInfo) => {
  const eqCat = await seedCategory('equipment', 'E2E-C');
  const tpl = (await (await apiAs('ga_staff')).post('/api/workspace/general-affairs/templates/equipment', { data: { name: m7Name('E2E-對照型號'), category_id: eqCat.id, brand: 'CB', model: m7Code('CM') } }).then((r) => r.json())).data;
  const p1 = await seedPart(ctx.partCat.id, 'E2E-C1');
  const p2 = await seedPart(ctx.partCat.id, 'E2E-C2');
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '適用料件設定', '料件管理');
    await expect(heading(page, '適用料件設定')).toBeVisible();
    await page.getByRole('searchbox', { name: /搜尋設備型號/ }).locator('visible=true').fill(tpl.name);
    await page.getByRole('list', { name: '可選對象' }).locator('visible=true').getByRole('button', { name: tpl.name }).click();
    await expect(page.getByRole('heading', { name: /的適用料件/ }).locator('visible=true')).toContainText(tpl.name);
    const picker = page.getByRole('region', { name: '適用料件' }).locator('visible=true');
    await picker.getByLabel('加入料件').fill(p1.name);
    await picker.getByRole('listitem').filter({ hasText: p1.name }).getByRole('button', { name: '加入' }).click();
    await expect(picker.getByRole('button', { name: '儲存適用料件' })).toBeEnabled();
    // 這時另一個人把對照改成 p2
    const other = await apiAs('ga_works');
    const cur = (await (await other.get(`/api/workspace/general-affairs/compat?targetType=EQUIPMENT_TEMPLATE&targetId=${tpl.id}`)).json()).data;
    expect((await other.put('/api/workspace/general-affairs/compat', { data: { targetType: 'EQUIPMENT_TEMPLATE', targetId: tpl.id, partIds: [p2.id], expectedVersion: cur.version } })).status()).toBe(200);
    await other.dispose();
    await picker.getByRole('button', { name: '儲存適用料件' }).click();
    const alert = picker.getByRole('alert');
    await expect(alert).toContainText('已被其他人修改');
    expect((await rowsWhere('ga_part_target_compatibilities', 'target_id', tpl.id)).filter((r) => !r.deleted_at).map((r) => r.part_id)).toEqual([p2.id]); // 沒蓋掉別人的
    await alert.getByRole('button', { name: '重新載入' }).click();
    await expect(picker.getByRole('list', { name: '已選料件' })).toContainText(p2.name);
    await expect(picker.getByRole('list', { name: '已選料件' })).not.toContainText(p1.name);
    // 重新載入後再改一次可以成功
    await picker.getByLabel('加入料件').fill(p1.name);
    await picker.getByRole('listitem').filter({ hasText: p1.name }).getByRole('button', { name: '加入' }).click();
    await picker.getByRole('button', { name: '儲存適用料件' }).click();
    await expect(picker.locator('.notice.success')).toContainText('已儲存適用料件（2 項）');
    expect((await rowsWhere('ga_part_target_compatibilities', 'target_id', tpl.id)).filter((r) => !r.deleted_at).map((r) => r.part_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(await noPageOverflow(page)).toBe(true);
    // 他人同時修改的提示會有一次預期中的 409
    expect(errors.filter((e) => /status of 409/.test(e))).toHaveLength(1);
    expect(errors.filter((e) => !/status of 409/.test(e))).toEqual([]);
  } finally {
    await c.close();
    await pwRequest.newContext().then((x) => x.dispose());
  }
});
