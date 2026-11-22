import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';
import { seedVendor } from '../support/m7m8-po-fixtures';
import { adminDb } from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageFor, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';

// M7/M8 第 4 批 G25 版面鎖定（桌機 1440 與手機 390 各跑一次，比照 G10.layout／G13.layout）：
//  - 採購單頁：11 張統計卡（桌機最多三列、手機兩欄六列）、無水平溢出；手機卡片按鈕高度 >= 44px。
//  - 詳情視窗（含動作面板）、登錄到貨視窗、配發視窗、核准設定視窗：不超出視窗寬度、主要按鈕可捲到並在視窗內。
//  - 新增採購單表單與待簽核頁：無水平溢出；供應商選擇器清單不撐開版面。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
let no = '';
let poId = '';
let partName = '';

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const cat = await seedCategory('part', 'G25L');
  const eqCat = await adminDb().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201（雷射印表機）');
  const tpl = await seedEquipmentTemplate(eqCat.data.id, 'G25L-T1', { default_warranty_months: 12 });
  const part = await seedPart(cat.id, 'G25L-很長很長的料件名稱用來檢查版面是否會被撐開不要超出視窗', { base_unit: '台', equipment_template_id: tpl.id });
  partName = part.name;
  const loc = await seedLocation(null, 'G25L-總部倉');
  await seedLocationPart(loc.id, part.id);
  const vendor = await seedVendor('G25L');
  const api = await apiAs('ga_po_purchaser');
  const c = await api.post('/api/workspace/general-affairs/purchase-orders', {
    data: { header: { vendor_id: vendor.id, receiving_location_id: loc.id, notes: m7Name('G25L-備註') }, items: [{ part_id: part.id, quantity: 2, unit_price: 500 }], idempotency_key: crypto.randomUUID() },
  });
  const created = (await c.json()).data;
  const o = await api.post(`/api/workspace/general-affairs/purchase-orders/${created.id}/actions`, { data: { action: 'place_order', expected_updated_at: created.updated_at } });
  expect(o.status(), await o.text()).toBe(200);
  await api.dispose();
  no = created.po_no;
  poId = created.id;
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

async function inViewport(page: Page, testid: string) {
  const vp = page.viewportSize()!;
  const b = dialog(page).getByTestId(testid).last();
  await b.scrollIntoViewIfNeeded();
  await expect(b).toBeInViewport({ ratio: 1 });
  const box = await b.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
}
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

test('採購單頁版面：統計卡排列、無水平溢出、手機卡片按鈕夠大；詳情、登錄到貨、配發視窗不超出視窗、主要按鈕在視窗內；新增採購單表單無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  void poId;
  const { ctx, page, errors } = await pageFor(browser, 'ga_po_purchaser', testInfo);
  const phone = (page.viewportSize()?.width || 1440) < 700;
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '採購單', exact: true }).locator('visible=true').first().click();
    await expect(page.getByTestId('po-total').locator('visible=true')).toBeVisible();
    const cards = page.getByRole('list', { name: '採購單統計' }).locator('visible=true').getByRole('listitem');
    await expect(cards).toHaveCount(11);
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    if (phone) expect(new Set(tops).size).toBe(6);
    else expect(new Set(tops).size).toBeLessThanOrEqual(3);
    expect(await noPageOverflow(page)).toBe(true);
    await page.getByTestId('po-search').locator('visible=true').fill(no);
    const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
    await expect(card).toHaveCount(1);
    if (phone) expect((await card.getByTestId('open-detail').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noPageOverflow(page)).toBe(true);

    // 詳情視窗＋動作面板（取消）
    await card.getByTestId('open-detail').click();
    await expect(dialog(page).getByTestId('po-detail')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('act-cancel').click();
    await expect(dialog(page).getByTestId('action-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'action-submit');
    await dialog(page).getByTestId('action-cancel').click();
    expect(await noPageOverflow(page)).toBe(true);

    // 登錄到貨視窗
    await dialog(page).getByTestId('act-receipt').click();
    await expect(dialog(page).getByTestId('receipt-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'rc-submit');
    await inViewport(page, 'rc-cancel');
    expect(await noPageOverflow(page)).toBe(true);
    await dialog(page).getByTestId('rc-submit').click(); // 全收：不用原因
    await expect(dialog(page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');

    // 配發視窗
    await dialog(page).getByTestId('act-dispatch').click();
    await expect(dialog(page).getByTestId('dispatch-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'dp-submit');
    expect(await noPageOverflow(page)).toBe(true);
    await dialog(page).getByTestId('dp-cancel').click();
    await dialog(page).getByTestId('pd-close').click();

    // 新增採購單表單：供應商選擇器清單展開、長料件名稱都不撐開版面
    await page.getByTestId('new-po').locator('visible=true').click();
    await expect(page.getByTestId('po-form').locator('visible=true')).toBeVisible();
    await page.getByTestId('pe-vendor').locator('visible=true').click();
    await expect(page.getByTestId('pe-vendor-option').locator('visible=true').first().or(page.getByText('找不到合作中的供應商').locator('visible=true').first())).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    const part = page.getByTestId('pe-part-0').locator('visible=true');
    await part.click();
    await part.fill(partName);
    await page.getByTestId('pe-part-0-option').locator('visible=true').filter({ hasText: partName }).first().click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('待簽核頁與核准設定視窗版面：無水平溢出、設定視窗不超出視窗、儲存按鈕在視窗內', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_po_approver', testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '待簽核採購單', exact: true }).locator('visible=true').first().click();
    await expect(page.getByTestId('ap-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '採購單', exact: true }).locator('visible=true').first().click();
    await page.getByTestId('open-settings').locator('visible=true').click();
    await expect(dialog(page).getByTestId('settings-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'st-save');
    expect(await noPageOverflow(page)).toBe(true);
    await dialog(page).getByTestId('st-close').click();
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
