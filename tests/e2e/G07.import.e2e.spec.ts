import { expect, type Page, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory } from '../support/m7m8-fixtures';
import { buildImportXlsx, importEquipmentLine, importFacilityLine, importFileName, IMPORT_HEADERS } from '../support/m7m8-import';
import { expectTidyCheckbox, gaNavTo, noPageOverflow, openGaCenter, pageFor, sideLabels, visibleHeading } from '../support/g01-ui';

// M7/M8 第 2 批 Q29 Excel 匯入 e2e（桌機 1440 與手機 390 各跑一次，使用 project 的視窗大小）：
//   下載範本 -> 上傳有錯的檔案（逐列標出原因、整批不能提交、資料庫沒有任何新增）-> 改好重傳 -> 確認匯入 -> 完成摘要 -> 資料庫讀回（自動進入貼標待辦）-> 前往上線貼標進度。
//   沒有權限者（設備查看者、店長、無權限者）側欄沒有入口。完整角色接力在 G10.journey-onboarding.spec.ts。
let eqCat: { id: string; code: string };
let facCat: { id: string; code: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'NE');
  facCat = await seedCategory('facility', 'NF');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileInput = (page: Page) => page.getByTestId('import-file').locator('visible=true').first();
const upload = (page: Page, tag: string, buffer: Buffer) => fileInput(page).setInputFiles({ name: importFileName(tag), mimeType: XLSX_TYPE, buffer });
const rowsOf = (page: Page) => page.getByTestId('import-row').locator('visible=true');
const countRows = async (names: string[]) => (((await adminDb().from('ga_equipment').select('id').in('name', names)).data || []).length) + (((await adminDb().from('ga_facilities').select('id').in('name', names)).data || []).length);

test('總務：下載範本 -> 上傳有錯的檔案（標出列與原因、不能提交、資料庫沒有新增）-> 改好重傳 -> 確認匯入 -> 完成摘要 -> 讀回資料庫', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, 'Excel 匯入');
    await expect(visibleHeading(page, '設備與設施 Excel 匯入')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);

    // 下載範本：檔案是 xlsx，第一個工作表是中文表頭
    const download = page.waitForEvent('download');
    await page.getByTestId('download-template').locator('visible=true').click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('設備設施匯入範本.xlsx');
    const wb = XLSX.readFile(await d.path());
    expect(wb.SheetNames[0]).toBe('匯入資料');
    expect((XLSX.utils.sheet_to_json(wb.Sheets['匯入資料'], { header: 1 }) as string[][])[0]).toEqual(IMPORT_HEADERS);

    // 有錯的檔案：第 3 列門市不存在、第 4 列日期格式錯
    const good = importEquipmentLine('E2E-好', 'ZT01', eqCat.code);
    const badStore = importEquipmentLine('E2E-錯店', 'NOPE99', eqCat.code);
    const badDate = importFacilityLine('E2E-錯日', 'ZT01', facCat.code, { 安裝日期: '2026-02-31' });
    await upload(page, 'bad', buildImportXlsx([good, badStore, badDate]));
    const preview = page.getByTestId('import-preview').locator('visible=true');
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId('error-count')).toHaveText('2');
    await expect(preview).toContainText('有 2 列沒有通過檢查，整批都不會匯入');
    await expect(rowsOf(page)).toHaveCount(3);
    await expect(rowsOf(page).nth(0)).toHaveAttribute('data-ok', '1');
    await expect(rowsOf(page).nth(1)).toContainText('找不到門市代碼「NOPE99」');
    await expect(rowsOf(page).nth(1)).toContainText('3'); // Excel 列號
    await expect(rowsOf(page).nth(2)).toContainText('「安裝日期」「2026-02-31」不是有效日期');
    await expect(page.getByTestId('commit-import').locator('visible=true')).toBeDisabled();
    await expectTidyCheckbox(page, '只看有問題的列');
    await page.getByLabel('只看有問題的列').locator('visible=true').check();
    await expect(rowsOf(page)).toHaveCount(2);
    expect(await noPageOverflow(page)).toBe(true);
    expect(await countRows([good.名稱 as string])).toBe(0); // 預檢不寫入

    // 改好重傳：全部通過
    const e1 = importEquipmentLine('E2E-設備一', 'ZT01', eqCat.code, { 狀態: '使用中', 重要程度: '高' });
    const e2 = importEquipmentLine('E2E-設備二', 'VW001', eqCat.code);
    const f1 = importFacilityLine('E2E-設施一', 'ZT01', facCat.code, { 數量: 2, 單位: '座' });
    const f2 = importFacilityLine('E2E-設施二', 'VW001', facCat.code);
    await upload(page, 'good', buildImportXlsx([e1, e2, f1, f2]));
    await expect(preview.getByTestId('error-count')).toHaveText('0');
    await expect(preview).toContainText('全部 4 列都通過檢查，可以匯入');
    await expect(rowsOf(page)).toHaveCount(4);
    const commit = page.getByTestId('commit-import').locator('visible=true');
    await expect(commit).toBeEnabled();
    await expect(commit).toContainText('確認匯入 4 筆');
    expect((await commit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await countRows([e1.名稱 as string, e2.名稱 as string])).toBe(0);
    await commit.click();

    // 完成摘要
    const done = page.getByTestId('import-done').locator('visible=true');
    await expect(done).toBeVisible();
    await expect(done.getByTestId('done-summary')).toContainText('共匯入 4 筆：設備 2 台、設施 2 項，涵蓋 2 間門市');
    expect(await noPageOverflow(page)).toBe(true);
    const eq = ((await adminDb().from('ga_equipment').select('name,store_id,onboarding_status,criticality').in('name', [e1.名稱 as string, e2.名稱 as string])).data || []) as any[];
    const fac = ((await adminDb().from('ga_facilities').select('name,quantity,unit,onboarding_status').in('name', [f1.名稱 as string, f2.名稱 as string])).data || []) as any[];
    expect(eq).toHaveLength(2);
    expect(fac).toHaveLength(2);
    expect([...eq, ...fac].every((x) => x.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO')).toBe(true);
    expect(eq.find((x) => x.name === e1.名稱).criticality).toBe('HIGH');
    expect(fac.find((x) => x.name === f1.名稱)).toMatchObject({ quantity: 2, unit: '座' });
    expect(await countRows([good.名稱 as string, badStore.名稱 as string])).toBe(0); // 之前有錯的檔案沒有留下任何資料

    // 完成後的下一步：前往上線貼標進度，看到剛匯入的資產
    await done.getByRole('button', { name: '前往上線貼標進度' }).click();
    await expect(visibleHeading(page, '上線貼標進度')).toBeVisible();
    const card = page.locator('[data-testid="progress-card"][data-store-code="ZT01"]:visible');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('stage-NEEDS_EQUIPMENT_PHOTO')).toHaveText(/^[2-9]\d*$/);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('檔案不對時給白話說明：不是 Excel、缺欄位；選錯檔不會留下舊的預檢結果', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, 'Excel 匯入');
    await expect(visibleHeading(page, '設備與設施 Excel 匯入')).toBeVisible();
    await fileInput(page).setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') });
    await expect(page.locator('.notice.error:visible')).toContainText('只收 Excel（.xlsx）檔');
    await upload(page, 'nohead', buildImportXlsx([{ 類型: '設備', 名稱: m7Name('NH') }], ['類型', '名稱']));
    await expect(page.locator('.notice.error:visible')).toContainText('缺少：門市代碼、分類代碼');
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    await expect(page.getByTestId('commit-import')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/400/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有權限者：設備查看者、店長、無權限者側欄沒有「Excel 匯入」', async ({ browser }, testInfo) => {
  for (const role of ['ga_equipment_view', 'store_manager']) {
    const { ctx, page } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page), role).not.toContain('Excel 匯入');
      const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
      expect(caps.gaAssetImport, role).toBe(false);
      expect(await page.evaluate(async () => (await fetch('/api/workspace/general-affairs/asset-import/reference')).status), role).toBe(403);
    } finally {
      await ctx.close();
    }
  }
  const { ctx, page } = await pageFor(browser, 'denied', testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    expect(await page.evaluate(async () => (await fetch('/api/workspace/general-affairs/asset-import/reference')).status)).toBe(403);
  } finally {
    await ctx.close();
  }
});

test('B10 可能重複：預檢標黃色提醒與摘要計數；確認匯入時多一句提醒，取消不寫入、仍要匯入才寫入；沒有重複就不跳提醒', async ({ browser }, testInfo) => {
  const existing = await adminDb().from('ga_equipment').insert({ store_id: (await adminDb().from('stores').select('id').eq('store_code', 'ZT01').single()).data!.id, category_id: eqCat.id, name: m7Name('E2E-既有'), brand: 'B', model: 'M' }).select('*').single();
  expect(existing.error).toBeNull();
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, 'Excel 匯入');
    const dupExisting = importEquipmentLine('E2E-既有', 'ZT01', eqCat.code, { 名稱: ` ${m7Name('E2E-既有').toUpperCase()} `, 資產編號: '' });
    const dupA = importEquipmentLine('E2E-同檔', 'ZT01', eqCat.code, { 資產編號: '' });
    const dupB = importEquipmentLine('E2E-同檔', 'ZT01', eqCat.code, { 資產編號: '' });
    const fine = importEquipmentLine('E2E-不重複', 'ZT01', eqCat.code);
    await upload(page, 'dup', buildImportXlsx([dupExisting, dupA, dupB, fine]));
    const preview = page.getByTestId('import-preview').locator('visible=true');
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId('error-count')).toHaveText('0');
    await expect(preview.getByTestId('dup-count')).toHaveText('3');
    await expect(preview.getByTestId('dup-notice')).toContainText('可能重複 3 列');
    await expect(rowsOf(page)).toHaveCount(4);
    await expect(rowsOf(page).nth(0)).toHaveAttribute('data-dup', '1');
    await expect(rowsOf(page).nth(0).getByTestId('dup-text')).toContainText('可能重複：與既有');
    await expect(rowsOf(page).nth(0).getByTestId('dup-text')).toContainText('尚無編號');
    await expect(rowsOf(page).nth(1).getByTestId('dup-text')).toHaveText('可能重複：與第 4 列同名');
    await expect(rowsOf(page).nth(2).getByTestId('dup-text')).toHaveText('可能重複：與第 3 列同名');
    await expect(rowsOf(page).nth(3)).toHaveAttribute('data-dup', '0');
    expect(await noPageOverflow(page)).toBe(true);
    // 確認匯入：跳出提醒，取消不寫入
    const commit = page.getByTestId('commit-import').locator('visible=true');
    await expect(commit).toBeEnabled();
    await commit.click();
    await expect(page.getByTestId('dup-confirm-text')).toHaveText('其中 3 列可能與既有資料重複，確定仍要匯入？');
    await page.getByTestId('dup-confirm-cancel').click();
    await expect(page.getByTestId('dup-confirm-text')).toHaveCount(0);
    expect(await countRows([m7Name('E2E-同檔'), m7Name('E2E-不重複')])).toBe(0);
    // 仍要匯入：不擋，全部寫入
    await commit.click();
    await page.getByTestId('dup-confirm-ok').click();
    const done = page.getByTestId('import-done').locator('visible=true');
    await expect(done.getByTestId('done-summary')).toContainText('共匯入 4 筆');
    expect(await countRows([m7Name('E2E-同檔'), m7Name('E2E-不重複')])).toBe(3);
    // 沒有重複：直接匯入，不跳提醒
    await page.reload({ waitUntil: 'networkidle' });
    await openGaCenter(page);
    await gaNavTo(page, 'Excel 匯入');
    await upload(page, 'nodup', buildImportXlsx([importEquipmentLine('E2E-全新', 'ZT01', eqCat.code, { 資產編號: '' })]));
    await expect(page.getByTestId('import-preview').locator('visible=true').getByTestId('dup-count')).toHaveText('0');
    await expect(page.getByTestId('dup-notice')).toHaveCount(0);
    await page.getByTestId('commit-import').locator('visible=true').click();
    await expect(page.getByTestId('dup-confirm-text')).toHaveCount(0);
    await expect(page.getByTestId('import-done').locator('visible=true')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
