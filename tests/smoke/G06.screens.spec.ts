import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs } from '../support/auth';
import { assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedFacility } from '../support/m7m8-fixtures';
import { gaNavTo, openGaCenter, pageFor, visibleHeading } from '../support/g01-ui';
import { makePng } from '../support/png';

// 第 2 批 G06 驗收截圖：只有設定 M7M8_SHOT_DIR（資料夾的絕對路徑）時才執行，平常整個略過。
// 桌機 1920×1080（使用者全域規定）、店長手機 390×844；截圖前等網路閒置與圖片載入，並回報 console 錯誤。
const DIR = process.env.M7M8_SHOT_DIR || '';
test.skip(!DIR, '只有設定 M7M8_SHOT_DIR 才截圖');

let eqCat: { id: string };
let facCat: { id: string };
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  fs.mkdirSync(DIR, { recursive: true });
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = () => r(null); })))); });
}
const shot = async (page: Page, name: string) => { await settle(page); await page.screenshot({ path: path.join(DIR, name), fullPage: false }); };

test('驗收截圖：設備清冊、新增設備、貼標待辦、貼標複核（桌機 1920×1080）與店長手機（390）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', '截圖只在桌機 project 跑一次（店長手機畫面由這個測試自己開 390 寬的視窗）');
  const a = await seedEquipment('ZT01', eqCat.id, '截圖冷氣', { brand: 'Daikin', model: 'FTXM', serial_number: 'SN-001', asset_code: 'IC01202611100001', area: '賣場', location_detail: '收銀台旁', has_warranty: true, warranty_end_date: '2027-03-01', purchase_amount: 28000 });
  await seedEquipment('ZT01', eqCat.id, '截圖冰箱', { brand: 'Panasonic', area: '倉庫', has_warranty: false, status: 'TEMPORARILY_STOPPED' });
  const c = await seedEquipment('ZT01', eqCat.id, '截圖貼標設備', { area: '賣場', location_detail: '門口' });
  await seedFacility('ZT01', facCat.id, '截圖貨架', { area: '賣場' });
  const sm = await apiAs('store_manager');
  const png = makePng({ width: 640, height: 480, inkPixels: 3000 });
  for (const purpose of ['PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE']) {
    const r = await sm.post('/api/workspace/general-affairs/onboarding/photo', { multipart: { assetType: 'EQUIPMENT', assetId: a.id, purpose, file: { name: 'p.png', mimeType: 'image/png', buffer: png } } });
    expect(r.status()).toBe(201);
  }
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const tag = 'd1920';
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await expect(visibleHeading(page, '設備清冊')).toBeVisible();
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(m7Name('截圖'));
    await expect(page.locator('tr:visible, li.asset-card:visible', { hasText: '截圖冷氣' })).toBeVisible();
    await shot(page, `${tag}-equipment-list.png`);
    await page.locator('tr:visible, li.asset-card:visible', { hasText: '截圖冷氣' }).getByRole('button', { name: /查看/ }).click();
    await expect(page.locator('dialog[open]').getByRole('heading', { name: m7Name('截圖冷氣') })).toBeVisible();
    await shot(page, `${tag}-equipment-detail.png`);
    await page.keyboard.press('Escape');
    await gaNavTo(page, '新增設備', '設備管理');
    await expect(visibleHeading(page, '新增設備')).toBeVisible();
    await shot(page, `${tag}-equipment-create.png`);
    await gaNavTo(page, '貼標複核');
    await expect(visibleHeading(page, '貼標複核')).toBeVisible();
    await expect(page.locator('[data-testid="review-card"]:visible', { hasText: '截圖冷氣' }).locator('img')).toHaveCount(2);
    await shot(page, `${tag}-onboarding-review.png`);
    // 店長手機
    const state = await (await apiAs('store_manager')).storageState();
    const mctx = await browser.newContext({ baseURL: 'http://localhost:3002', storageState: state, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const mp = await mctx.newPage();
    const merrors: string[] = [];
    mp.on('pageerror', (e) => merrors.push(String(e)));
    mp.on('console', (m) => m.type() === 'error' && merrors.push(m.text()));
    await openGaCenter(mp);
    await gaNavTo(mp, '貼標待辦');
    await expect(visibleHeading(mp, '貼標待辦')).toBeVisible();
    await expect(mp.locator('[data-testid="onb-card"]:visible', { hasText: '截圖貼標設備' })).toBeVisible();
    await shot(mp, 'm390-onboarding-tasks-store-manager.png');
    await gaNavTo(mp, '設備清冊', '設備管理');
    await mp.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(m7Name('截圖'));
    await expect(mp.locator('li.asset-card:visible', { hasText: '截圖冷氣' })).toBeVisible();
    await shot(mp, 'm390-equipment-cards-store-manager.png');
    await mctx.close();
    fs.writeFileSync(path.join(DIR, `${tag}-console-errors.txt`), [...errors, ...merrors].join('\n') || '（沒有 console 錯誤）');
  } finally {
    await ctx.close();
    await sm.dispose();
  }
});
