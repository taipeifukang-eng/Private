import { expect, type Page, test } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8, row, seedCategory, seedEquipment, seedFacility } from '../support/m7m8-fixtures';
import { gaNavTo, gaNavToIn, openGaCenter, pageFor } from '../support/g01-ui';

// M7/M8 第 3 批 C13 e2e（G06C 設備、G08C 設施；桌機 1440 與手機 390 各跑一次）：
// 分類被停用後，設備與設施不換分類仍可修改其他欄位並儲存；編輯畫面提示「這個分類已停用」；分類本身維持停用。
// 換到停用分類被擋由 G06C／G08C 整合層驗證（選擇器只列啟用中的分類，畫面上選不到停用分類）。
const dialog = (page: Page) => page.locator('dialog[open]').last();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

test('G06C 設備：分類停用後，編輯設備改放置位置可儲存（提示分類已停用、PATCH 不送分類、分類維持停用）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const cat = await seedCategory('equipment', 'C13E');
  const eq = await seedEquipment('ZT04', cat.id, 'C13-設備', { location_detail: '倉庫' });
  expect((await adminDb().from('ga_equipment_categories').update({ is_active: false }).eq('id', cat.id)).error).toBeNull();
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await searchBox(page).fill(eq.name);
    await page.locator('tr:visible, li.asset-card:visible', { hasText: eq.name }).getByRole('button', { name: /查看/ }).click();
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page).locator('.cat-selected')).toContainText(cat.name);
    await expect(dialog(page).getByTestId('category-inactive-hint')).toContainText('這個分類已停用');
    await dialog(page).getByLabel('放置位置').fill('收銀台旁');
    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes(`/equipment/${eq.id}`));
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    expect(Object.keys((await patch).postDataJSON())).not.toContain('category_id');
    await expect(page.locator('.notice:visible', { hasText: `已儲存設備「${eq.name}」` }).first()).toBeVisible();
    expect(await row('ga_equipment', eq.id)).toMatchObject({ category_id: cat.id, location_detail: '收銀台旁' });
    expect((await row('ga_equipment_categories', cat.id)).is_active).toBe(false);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('G08C 設施：分類停用後，編輯設施改詳細位置可儲存（提示分類已停用、PATCH 不送分類、分類維持停用）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const cat = await seedCategory('facility', 'C13F');
  const f = await seedFacility('ZT04', cat.id, 'C13-設施', { location_detail: '入口' });
  expect((await adminDb().from('ga_facility_categories').update({ is_active: false }).eq('id', cat.id)).error).toBeNull();
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設施管理', '設施清冊');
    await searchBox(page).fill(f.name);
    await page.locator('tr:visible, li.asset-card:visible', { hasText: f.name }).getByRole('button', { name: /查看/ }).click();
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page).locator('.cat-selected')).toContainText(cat.name);
    await expect(dialog(page).getByTestId('category-inactive-hint')).toContainText('這個分類已停用');
    await dialog(page).getByLabel('詳細位置').fill('櫃台後方');
    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes(`/facilities/${f.id}`));
    await dialog(page).getByRole('button', { name: '儲存' }).click();
    expect(Object.keys((await patch).postDataJSON())).not.toContain('category_id');
    await expect(page.locator('.notice:visible', { hasText: `已儲存設施「${f.name}」` }).first()).toBeVisible();
    expect(await row('ga_facilities', f.id)).toMatchObject({ category_id: cat.id, location_detail: '櫃台後方' });
    expect((await row('ga_facility_categories', cat.id)).is_active).toBe(false);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
