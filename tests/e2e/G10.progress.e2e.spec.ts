import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertGaBaseline, cleanupM7M8, seedCategory, seedEquipment, seedFacility } from '../support/m7m8-fixtures';
import { driveTo } from '../support/m7m8-import';
import { expectTidyCheckbox, gaNavTo, noPageOverflow, openGaCenter, pageFor, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 Q29 上線貼標進度頁 e2e（桌機 1440 與手機 390 各跑一次）：
//   每店設備與設施總數、各階段數量、完成率；點進某店看卡在哪一台；已 100% 的門市預設收起；依門市批次印標籤（帶門市篩選進標籤頁）；
//   店長只看到自己門市；一台一台推進後數字跟著變（用 API 準備資料，頁面重新整理後驗證）。
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };
let ga: APIRequestContext;
let manager: APIRequestContext;
let managerB: APIRequestContext;
const names: Record<string, string> = {};

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'PE');
  facCat = await seedCategory('facility', 'PF');
  ga = await apiAs('ga_works');
  manager = await apiAs('store_manager');
  managerB = await apiAs('ga_store_manager_b');
  // ZT01：設備一完成、設備二待複核、設施待拍貼標照、設施二待拍照片 -> 4 筆、完成 1、25%
  const z1 = await seedEquipment('ZT01', eqCat.id, 'PG-設備一');
  const z2 = await seedEquipment('ZT01', eqCat.id, 'PG-設備二');
  const z3 = await seedFacility('ZT01', facCat.id, 'PG-設施一');
  const z4 = await seedFacility('ZT01', facCat.id, 'PG-設施二');
  // VW001：一台設備走到完成 -> 1 筆、100%
  const v1 = await seedEquipment('VW001', eqCat.id, 'PG-乙店設備');
  Object.assign(names, { z1: z1.name, z2: z2.name, z3: z3.name, z4: z4.name, v1: v1.name });
  await driveTo('EQUIPMENT', z1.id, 'COMPLETED', manager, ga);
  await driveTo('EQUIPMENT', z2.id, 'PENDING_GA_REVIEW', manager, ga);
  await driveTo('FACILITY', z3.id, 'NEEDS_LABEL_PHOTO', manager, ga);
  await driveTo('EQUIPMENT', v1.id, 'COMPLETED', managerB, ga);
});
test.afterAll(async () => {
  for (const c of [ga, manager, managerB]) await c?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const card = (page: Page, code: string) => page.locator(`[data-testid="progress-card"][data-store-code="${code}"]:visible`);

test('總務：各店設備與設施數量、階段、完成率；點進看卡在哪一台；100% 的門市預設收起；按「印設備標籤」帶門市篩選', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '上線貼標進度');
    await expect(visibleHeading(page, '上線貼標進度')).toBeVisible();
    const zt = card(page, 'ZT01');
    await expect(zt).toBeVisible();
    await expect(zt.getByTestId('progress-rate')).toHaveText('25%');
    await expect(zt).toContainText('設備 1 / 2');
    await expect(zt).toContainText('設施 0 / 2');
    await expect(zt).toContainText('共完成 1 / 4');
    await expect(zt.getByTestId('stage-NEEDS_EQUIPMENT_PHOTO')).toHaveText('1');
    await expect(zt.getByTestId('stage-NEEDS_LABEL_PHOTO')).toHaveText('1');
    await expect(zt.getByTestId('stage-PENDING_GA_REVIEW')).toHaveText('1');
    await expect(zt.getByTestId('stage-COMPLETED')).toHaveText('1');
    // 已 100% 的乙店預設不顯示，勾選後出現
    await expect(card(page, 'VW001')).toHaveCount(0);
    await expectTidyCheckbox(page, '也顯示已 100% 完成的門市');
    await page.getByLabel('也顯示已 100% 完成的門市').locator('visible=true').check();
    await expect(card(page, 'VW001').getByTestId('progress-rate')).toHaveText('100%');
    expect(await noPageOverflow(page)).toBe(true);

    // 卡在哪一台：依階段列出
    await zt.getByRole('button', { name: '看卡在哪一台' }).click();
    const detail = zt.getByTestId('progress-detail');
    await expect(detail.getByTestId('stuck-row')).toHaveCount(3);
    await expect(detail.getByTestId('stuck-row').filter({ hasText: names.z2 })).toHaveAttribute('data-status', 'PENDING_GA_REVIEW');
    await expect(detail.getByTestId('stuck-row').filter({ hasText: names.z3 })).toHaveAttribute('data-status', 'NEEDS_LABEL_PHOTO');
    await expect(detail.getByTestId('stuck-row').filter({ hasText: names.z4 })).toHaveAttribute('data-status', 'NEEDS_EQUIPMENT_PHOTO');
    await expect(detail).not.toContainText(names.z1); // 已完成的不列
    expect((await zt.getByRole('button', { name: '收合' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noPageOverflow(page)).toBe(true);
    await zt.getByRole('button', { name: '收合' }).click();
    await expect(zt.getByTestId('progress-detail')).toHaveCount(0);

    // 依門市印標籤：開標籤頁，已依 ZT01 篩選（預設不含已報廢；此店的資產都還在）
    await zt.getByRole('button', { name: '印設備標籤' }).click();
    await expect(visibleHeading(page, '設備 QR 標籤列印')).toBeVisible();
    await expect(page.getByTestId('label-preset-store').locator('visible=true')).toContainText('ZT01');
    const labels = page.getByTestId('label-card').locator('visible=true');
    await expect(labels.filter({ hasText: 'ZT01' }).first()).toBeVisible();
    await expect(labels.filter({ hasText: 'VW001' })).toHaveCount(0);
    await expect(labels.filter({ hasText: names.z1 })).toHaveCount(1);
    await expect(labels.filter({ hasText: names.z2 })).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店長（手機優先）只看到自己門市的進度；他店資料不會出現；進度數字與 API 相同', async ({ browser }, testInfo) => {
  const a = await pageFor(browser, 'store_manager', testInfo);
  try {
    await openGaCenter(a.page);
    await gaNavTo(a.page, '上線貼標進度');
    await expect(visibleHeading(a.page, '上線貼標進度')).toBeVisible();
    await expect(card(a.page, 'ZT01').getByTestId('progress-rate')).toHaveText('25%');
    await expect(a.page.locator('[data-testid="progress-card"]:visible')).toHaveCount(1);
    // 店長沒有標籤列印權限：沒有印標籤按鈕
    await expect(card(a.page, 'ZT01').getByRole('button', { name: /印設備標籤|印設施標籤/ })).toHaveCount(0);
    expect(await noPageOverflow(a.page)).toBe(true);
    await card(a.page, 'ZT01').getByRole('button', { name: '看卡在哪一台' }).click();
    await expect(card(a.page, 'ZT01').getByTestId('stuck-row')).toHaveCount(3);
    expect(a.errors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
  const b = await pageFor(browser, 'ga_store_manager_b', testInfo);
  try {
    await openGaCenter(b.page);
    await gaNavTo(b.page, '上線貼標進度');
    await expect(visibleHeading(b.page, '上線貼標進度')).toBeVisible();
    await expect(b.page.getByText('所有門市都已 100% 完成').locator('visible=true')).toBeVisible(); // 乙店只有一台且已完成
    await expect(card(b.page, 'ZT01')).toHaveCount(0);
    await b.page.getByLabel('也顯示已 100% 完成的門市').locator('visible=true').check();
    await expect(b.page.locator('[data-testid="progress-card"]:visible')).toHaveCount(1);
    await expect(card(b.page, 'VW001').getByTestId('progress-rate')).toHaveText('100%');
    expect(b.errors).toEqual([]);
  } finally {
    await b.ctx.close();
  }
});

test('推進一台後數字跟著變：店長補上貼標照、總務通過，ZT01 完成率 25% -> 50%', async ({ browser }, testInfo) => {
  const rows = await ga.get('/api/workspace/general-affairs/onboarding/tasks?pageSize=100&statuses=PENDING_GA_REVIEW&q=PG-');
  const z2 = ((await rows.json()).data as any[]).find((r) => r.name === names.z2);
  expect(z2).toBeTruthy();
  const ok = await ga.post('/api/workspace/general-affairs/onboarding/review', { data: { assetType: 'EQUIPMENT', assetId: z2.id, action: 'approve' } });
  expect(ok.status()).toBe(200);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '上線貼標進度');
    await expect(card(page, 'ZT01').getByTestId('progress-rate')).toHaveText('50%');
    await expect(card(page, 'ZT01').getByTestId('stage-PENDING_GA_REVIEW')).toHaveText('0');
    await expect(card(page, 'ZT01').getByTestId('stage-COMPLETED')).toHaveText('2');
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
