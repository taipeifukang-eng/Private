import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, seedCategory, seedEquipment } from '../support/m7m8-fixtures';
import { gaNavToIn, openGaCenter, pageFor, visibleHeading } from '../support/g01-ui';

// 第 2 批 G10 驗收截圖：只有設定 M7M8_SHOT_DIR（資料夾的絕對路徑）時才執行，平常整個略過。
// 桌機 1920×1080（使用者全域規定）、店長手機 390×844；截圖前等網路閒置與字型，並回報 console 錯誤。
const DIR = process.env.M7M8_SHOT_DIR || '';
test.skip(!DIR, '只有設定 M7M8_SHOT_DIR 才截圖');

let eqCat: { id: string };
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  fs.mkdirSync(DIR, { recursive: true });
  eqCat = await seedCategory('equipment', 'EC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => { await document.fonts.ready; });
}
const shot = async (page: Page, name: string) => { await settle(page); await page.screenshot({ path: path.join(DIR, name), fullPage: false }); };
const scanUrl = (token: string) => `/workspace/index.html#/open/ga-asset-scan/${token}`;

test('G10 驗收截圖：標籤列印頁與掃描頁（桌機 1920×1080、店長手機 390）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', '截圖只在桌機 project 跑一次');
  const a = await seedEquipment('ZT01', eqCat.id, '截圖冷氣', { brand: 'Daikin', model: 'FTXM', serial_number: 'SN-001', asset_code: m7Code('SA'), area: '前場營業區', location_detail: '收銀台旁', has_warranty: true, warranty_end_date: '2027-03-01' });
  await seedEquipment('ZT01', eqCat.id, '截圖冰箱', { asset_code: m7Code('SB') });
  await seedEquipment('ZT01', eqCat.id, '截圖無編號設備');
  const dead = await seedEquipment('ZT01', eqCat.id, '截圖報廢設備');
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', dead.id);
  const ga = await pageFor(browser, 'ga_works', testInfo);
  const errors: string[] = [];
  try {
    await ga.page.setViewportSize({ width: 1920, height: 1080 });
    await openGaCenter(ga.page);
    await gaNavToIn(ga.page, '設備管理', 'QR 標籤列印');
    await expect(visibleHeading(ga.page, '設備 QR 標籤列印')).toBeVisible();
    await ga.page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill('截圖');
    await expect(ga.page.getByTestId('label-card').locator('visible=true')).toHaveCount(3);
    await shot(ga.page, 'g10-labels-d1920.png');
    // 深連結只在頁面載入時讀取，每個畫面各開一頁
    const scanPage = await ga.ctx.newPage();
    await scanPage.setViewportSize({ width: 1920, height: 1080 });
    await scanPage.goto(scanUrl(a.qr_token), { waitUntil: 'networkidle' });
    await expect(scanPage.getByTestId('asset-scan').locator('visible=true')).toContainText('截圖冷氣');
    await shot(scanPage, 'g10-scan-ga-d1920.png');
    const fresh = await ga.ctx.newPage();
    await fresh.setViewportSize({ width: 1920, height: 1080 });
    await fresh.goto(scanUrl(dead.qr_token), { waitUntil: 'networkidle' });
    await expect(fresh.getByTestId('scan-failure').locator('visible=true')).toBeVisible();
    await shot(fresh, 'g10-scan-revoked-d1920.png');
    errors.push(...ga.errors);
  } finally {
    await ga.ctx.close();
  }
  for (const [role, name, token] of [['store_manager', 'g10-scan-store-manager-m390.png', a.qr_token], ['ga_store_manager_b', 'g10-scan-no-access-m390.png', a.qr_token]] as const) {
    const m = await pageFor(browser, role, testInfo);
    try {
      await m.page.setViewportSize({ width: 390, height: 844 });
      await m.page.goto(scanUrl(token), { waitUntil: 'networkidle' });
      await expect(m.page.getByTestId(role === 'store_manager' ? 'asset-scan' : 'scan-failure').locator('visible=true')).toBeVisible();
      await shot(m.page, name);
      errors.push(...m.errors.filter((e) => !/status of 403/.test(e)));
    } finally {
      await m.ctx.close();
    }
  }
  expect(errors, 'console 錯誤').toEqual([]);
});
