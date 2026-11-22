import { expect, type Page, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment } from '../support/m7m8-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, visibleHeading } from '../support/g01-ui';
import { makePng } from '../support/png';

// M7/M8 第 2 批版面鎖定（桌機 1440 與手機 390 各跑一次）：
//  - 設備清冊有照片的列，縮圖真的載入（naturalWidth > 0，用彩色圖）、有固定尺寸與邊框（白圖也看得出那裡有圖）。
//  - 貼標複核：照片預覽最高 240px，點照片開大圖；退回對話框、更正所屬門市、恢復 QR 的主按鈕一開啟就在視窗內。
let eqCat: { id: string };
const color = () => makePng({ width: 200, height: 150, colorful: true });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'LY');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const dialog = (page: Page) => page.locator('dialog[open]').last();
async function expectInViewport(page: Page, names: (string | RegExp)[]) {
  const vh = page.viewportSize()!.height;
  for (const n of names) {
    const b = dialog(page).getByRole('button', { name: n }).last();
    await expect(b).toBeInViewport({ ratio: 1 });
    const box = await b.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  }
}

/** 關掉所有對話框（更正門市的下拉選單展開時會蓋住按鈕，所以用 Esc）。 */
async function closeDialogs(page: Page) {
  for (let i = 0; i < 5 && (await page.locator('dialog[open]').count()) > 0; i++) await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test('設備清冊縮圖載入且有邊框；貼標複核照片預覽 <= 240px 可點開大圖；退回／更正／恢復對話框主按鈕在視窗內', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const a = await seedEquipment('ZT01', eqCat.id, 'LY-有照片');
  const gone = await seedEquipment('ZT01', eqCat.id, 'LY-報廢');
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', gone.id);
  const sm = await apiAs('store_manager');
  for (const purpose of ['PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE']) {
    const r = await sm.post('/api/workspace/general-affairs/onboarding/photo', { multipart: { assetType: 'EQUIPMENT', assetId: a.id, purpose, file: { name: 'p.png', mimeType: 'image/png', buffer: color() } } });
    expect(r.status()).toBe(201);
  }
  await sm.dispose();
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(a.name);
    const row = page.locator('tr:visible, li.asset-card:visible', { hasText: a.name });
    await expect(row).toBeVisible();
    const img = row.locator('img').locator('visible=true').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    const m = await img.evaluate((i: HTMLImageElement) => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, border: parseFloat(getComputedStyle(i).borderTopWidth) }));
    expect(m.w).toBeGreaterThanOrEqual(40);
    expect(m.h).toBeGreaterThanOrEqual(40);
    expect(m.border).toBeGreaterThanOrEqual(1);

    // 更正所屬門市、恢復 QR 對話框
    await row.getByRole('button', { name: /查看/ }).click();
    await dialog(page).getByRole('button', { name: '更正所屬門市' }).click();
    await expectInViewport(page, ['確認更正', '取消']);
    await closeDialogs(page);
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(gone.name);
    await page.locator('tr:visible, li.asset-card:visible', { hasText: gone.name }).getByRole('button', { name: /查看/ }).click();
    await dialog(page).getByRole('button', { name: '恢復使用並重新啟用 QR' }).click();
    await expectInViewport(page, ['確認恢復', '取消']);
    await closeDialogs(page);

    // 貼標複核
    await gaNavTo(page, '貼標複核');
    await expect(visibleHeading(page, '貼標複核')).toBeVisible();
    const card = page.locator('[data-testid="review-card"]:visible', { hasText: a.name });
    await expect(card.locator('img')).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const im = card.locator('img').nth(i);
      await expect.poll(() => im.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
      expect((await im.boundingBox())!.height).toBeLessThanOrEqual(240);
    }
    await card.getByRole('button', { name: /放大/ }).first().click();
    await expect(dialog(page).locator('img.zoomed')).toBeVisible();
    await expect.poll(() => dialog(page).locator('img.zoomed').evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    await card.getByRole('button', { name: '退回重拍' }).click();
    await expectInViewport(page, ['確認退回', '取消']);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
    void m7Name;
  } finally {
    await ctx.close();
  }
});
