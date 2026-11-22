import { expect, type Page, test } from '@playwright/test';
import { assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';
import { expectTidyCheckbox, gaNavTo, noPageOverflow, openGaCenter, pageFor } from '../support/g01-ui';

// M7/M8 第 3 批 G11 版面鎖定（桌機 1440 與手機 390 各跑一次）：
//  - 統計卡桌機一列四張、手機兩欄；清單頁沒有水平溢出；手機的卡片操作按鈕高度 >= 44px。
//  - 位置對話框、加入料件對話框：不超出視窗寬度、主要按鈕一開啟就在視窗內（手機尤其重要）；勾選框是一般大小、標籤單行。
let loc: { id: string; name: string };
const dialog = (page: Page) => page.locator('dialog[open]').last();

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const cat = await seedCategory('part', 'G11L');
  loc = await seedLocation('ZT04', 'LY-位置', { description: '版面描述' });
  for (const s of ['甲', '乙', '丙']) await seedLocationPart(loc.id, (await seedPart(cat.id, `LY-料件${s}`)).id, { safety_stock_qty: 1, reorder_point_qty: 2, maximum_stock_qty: 3 });
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

async function inViewport(page: Page, names: (string | RegExp)[]) {
  const vp = page.viewportSize()!;
  for (const n of names) {
    const b = dialog(page).getByRole('button', { name: n }).last();
    await expect(b).toBeInViewport({ ratio: 1 });
    const box = await b.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  }
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

test('清單版面：統計卡排列、無水平溢出、手機卡片按鈕夠大；位置對話框與加入料件對話框不超出視窗、主要按鈕在視窗內、勾選框大小正常', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  const phone = (page.viewportSize()?.width || 1440) < 700;
  try {
    await openGaCenter(page);
    await gaNavTo(page, '庫存位置', '庫存管理');
    await expect(page.getByRole('heading', { name: '庫存位置與料件設定', exact: true }).locator('visible=true').first()).toBeVisible();
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(loc.name);
    // 統計卡：桌機一列四張，手機兩欄
    const cards = page.getByRole('list', { name: '庫存位置統計' }).locator('visible=true').getByRole('listitem');
    await expect(cards).toHaveCount(4);
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(phone ? 2 : 1);
    expect(await noPageOverflow(page)).toBe(true);
    const row = page.locator('[data-testid="location-row"]:visible, [data-testid="location-card"]:visible', { hasText: loc.name });
    await expect(row).toHaveCount(1);
    if (phone) {
      for (const b of await row.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // 位置對話框
    await row.getByRole('button', { name: /^編輯/ }).click();
    await expect(dialog(page).getByLabel('位置名稱')).toHaveValue(loc.name);
    await dialogFits(page);
    await expectTidyCheckbox(page, '預設位置');
    await expectTidyCheckbox(page, '允許負庫存');
    await expect(dialog(page).getByTestId('location-parts')).toBeVisible();
    await expect(dialog(page).locator('[data-testid="setting-row"]:visible, li.setting-card:visible')).toHaveCount(3);
    await dialog(page).getByRole('button', { name: '儲存位置' }).scrollIntoViewIfNeeded();
    await inViewport(page, ['儲存位置', '取消']);
    // 加入料件對話框
    await dialog(page).getByRole('button', { name: '加入料件', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: '加入料件設定' })).toBeVisible();
    await dialogFits(page);
    await inViewport(page, [/^加入 \d+ 筆$/, '取消']);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    // 修改設定與移除對話框
    await dialog(page).locator('[data-testid="setting-row"]:visible, li.setting-card:visible').first().getByRole('button', { name: /^修改/ }).click();
    await dialogFits(page);
    await inViewport(page, ['儲存', '取消']);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await dialog(page).locator('[data-testid="setting-row"]:visible, li.setting-card:visible').first().getByRole('button', { name: /^移除/ }).click();
    await dialogFits(page);
    await inViewport(page, ['確認移除', '取消']);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
    void m7Name;
  } finally {
    await ctx.close();
  }
});
