import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { loginAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Products, productCode, productPrefix, runIdOrThrow, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第二批 W27/W28：商品主檔多角色劇本（桌機 1440、手機 390 各跑一次）。
 * 角色：pm_manage（只有商品主檔管理權限）走完整流程；store_manager、pm_plain（無權限）沒有入口。
 * 流程：下載範本 -> 匯入錯誤檔（格式、空檔、欄位錯誤）-> 匯入預覽（新增／更新／重新啟用／略過）不寫入 -> 確認寫入
 *       -> 搜尋與「顯示已停用」-> 新增單筆 -> 編輯（編號不可改）-> 停用 -> 重新啟用。
 * 測試商品 ZT2038-<runId>-…，只刪自己的。
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sheetBuffer = (aoa: (string | number)[][], sheetName = '商品') => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const db = adminDb();
const byCode = async (code: string) => (await db.from('products_master').select('*').eq('product_code', code).maybeSingle()).data;

let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Products();
  ({ users, teardown } = await setupM6Users(['pm_manage', 'pm_plain']));
});
test.afterAll(async () => {
  await cleanupM6Products();
  const left = await teardown();
  expect(left).toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  if (!who.startsWith('pm_')) return loginAs(browser, who);
  const api = await apiForUser(users[who]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator('.workspace-menu button.catalog-item[title="商品主檔"]');
async function openProducts(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: '商品主檔', exact: true })).toBeVisible();
  await page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
}
const settled = (page: Page) => page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
const rowOf = (page: Page, text: string) => page.locator('.products-master-page .products-table tbody tr', { hasText: text });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const fileInput = (page: Page) => page.locator('.products-master-page .import-box input[type=file]');
const pick = (page: Page, name: string, buffer: Buffer | string, mimeType = XLSX_MIME) =>
  fileInput(page).setInputFiles({ name, mimeType, buffer: typeof buffer === 'string' ? Buffer.from(buffer) : buffer });
const notice = (page: Page) => page.locator('.products-master-page .notice');

test('無權限角色沒有商品主檔入口；管理者完成匯入預覽、寫入、搜尋、新增、編輯、停用、重新啟用', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const c = (t: string) => productCode(`${tag}-${t}`);
  const search = `${productPrefix()}-${tag}-`;

  // ---- 無權限者：選單沒有「商品主檔」
  for (const who of ['store_manager', 'pm_plain']) {
    const ctx = await ctxFor(browser, who);
    const page = await ctx.newPage();
    try {
      await openMenu(page);
      await expect(page.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
      await expect(menuItem(page), `${who} 不應看到商品主檔`).toHaveCount(0);
      expect(await page.locator('.workspace-menu').innerText()).not.toContain('併購');
      const r = await ctx.request.get('/api/workspace/products-master');
      expect(r.status(), `${who} 直接打清單 API`).toBe(403);
      expect((await ctx.request.get('/api/workspace/products-master/search', { params: { q: 'x' } })).status(), `${who} 搜尋仍可用`).toBe(200);
    } finally {
      await ctx.close();
    }
  }

  // ---- 管理者
  expect((await db.from('products_master').insert([
    { product_code: c('OLD'), product_name: '舊名稱', unit: '瓶', is_active: true },
    { product_code: c('SAME'), product_name: '相同商品', unit: '盒', is_active: true },
    { product_code: c('OFF'), product_name: '停用中商品', unit: '條', is_active: false },
  ])).error).toBeNull();
  const ctx = await ctxFor(browser, 'pm_manage');
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
  try {
    await openProducts(page);
    const root = page.locator('.products-master-page');
    expect(await root.innerText()).not.toContain('併購');

    // 範本下載（檔名、工作表）
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載範本' }).click()]);
    expect(dl.suggestedFilename()).toBe('商品主檔範本.xlsx');
    const tpl = XLSX.read(fs.readFileSync((await dl.path())!), { type: 'buffer' });
    expect(tpl.SheetNames).toEqual(['商品主檔']);
    expect(XLSX.utils.sheet_to_json(tpl.Sheets['商品主檔'])).toHaveLength(2);

    // 錯誤檔：格式、空檔、欄位名稱不對
    await pick(page, 'x.txt', 'abc', 'text/plain');
    await expect(notice(page).first()).toContainText('僅支援 .xlsx 或 .xls');
    await pick(page, 'empty.xlsx', sheetBuffer([['商品編號', '商品名稱', '單位']]));
    await expect(notice(page).first()).toContainText('Excel 無資料');
    await pick(page, 'wrong.xlsx', sheetBuffer([['代碼', '說明'], ['A', 'B']]));
    await expect(notice(page).first()).toContainText('找不到有效資料，請確認欄位名稱');
    await expect(page.locator('.preview')).toHaveCount(0);

    // 預覽：欄位別名（編號／品名／unit）、第一個工作表、略過原因、停用商品會復活
    const file = sheetBuffer([
      ['編號', '品名', 'unit'],
      [c('OLD'), '新名稱', '瓶'], // 更新
      [c('SAME'), '相同商品', '盒'], // 內容相同略過
      [c('OFF'), '停用中商品', '條'], // 重新啟用
      [c('NEW'), '全新商品', '個'], // 新增
      ['', '缺編號', ''],
      [c('NONAME'), '', ''],
      [c('DUP'), '第一列', ''],
      [c('DUP'), '第二列', '包'],
    ]);
    await pick(page, 'products.xlsx', file);
    const preview = page.locator('.preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-count=inserted]')).toHaveText('2');
    await expect(preview.locator('[data-count=updated]')).toHaveText('2');
    await expect(preview.locator('[data-count=reactivated]')).toHaveText('1');
    await expect(preview.locator('[data-count=skipped]')).toHaveText('4');
    await expect(preview).toContainText(`下列停用中的商品會被重新啟用：${c('OFF')}`);
    for (const reason of ['缺少商品編號', '缺少商品名稱', '檔案內編號重複', '內容與現有商品完全相同']) await expect(preview).toContainText(reason);
    // 預覽階段完全沒有寫入
    expect(await byCode(c('NEW'))).toBeNull();
    expect(await byCode(c('OFF'))).toMatchObject({ is_active: false });
    expect(await byCode(c('OLD'))).toMatchObject({ product_name: '舊名稱' });
    // 取消後預覽消失，再重新選檔
    await preview.getByRole('button', { name: '取消' }).click();
    await expect(preview).toHaveCount(0);
    await pick(page, 'products.xlsx', file);
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: '確認匯入' }).click();
    await expect(notice(page).filter({ hasText: '匯入完成' })).toContainText('新增 2 筆、更新 2 筆（其中重新啟用 1 筆）、略過 4 筆');
    await expect(preview).toHaveCount(0);
    expect(await byCode(c('OLD'))).toMatchObject({ product_name: '新名稱' });
    expect(await byCode(c('OFF'))).toMatchObject({ is_active: true });
    expect(await byCode(c('NEW'))).toMatchObject({ product_name: '全新商品', unit: '個' });
    expect(await byCode(c('DUP'))).toMatchObject({ product_name: '第二列', unit: '包' });
    expect(await byCode(c('NONAME'))).toBeNull();
    if (mobile) expect(await noOverflow(page), '手機匯入預覽後不橫向溢出').toBe(true);

    // 搜尋與顯示已停用
    await page.getByLabel('搜尋商品').fill(search);
    await settled(page);
    await expect(rowOf(page, c('NEW'))).toHaveCount(1);
    await expect(root.locator('.toolbar span')).toContainText('共 5 筆'); // OLD SAME OFF(已啟用) NEW DUP
    // 先停用一個，確認預設不顯示、勾選後出現
    await rowOf(page, c('SAME')).getByRole('button', { name: '停用' }).click();
    await expect(page.getByRole('dialog')).toContainText(`確定停用商品「${c('SAME')}`);
    await page.getByRole('button', { name: '確認停用' }).click();
    await expect(notice(page).filter({ hasText: `已停用商品「${c('SAME')}」` })).toBeVisible();
    await expect(rowOf(page, c('SAME'))).toHaveCount(0);
    expect(await byCode(c('SAME'))).toMatchObject({ is_active: false });
    await page.getByLabel('顯示已停用').check();
    await settled(page);
    await expect(rowOf(page, c('SAME'))).toContainText('已停用');
    // 重新啟用
    await rowOf(page, c('SAME')).getByRole('button', { name: '重新啟用' }).click();
    await page.getByRole('button', { name: '確認重新啟用' }).click();
    await expect(notice(page).filter({ hasText: `已重新啟用商品「${c('SAME')}」` })).toBeVisible();
    await expect(rowOf(page, c('SAME'))).toContainText('啟用中');
    expect(await byCode(c('SAME'))).toMatchObject({ is_active: true });
    await page.getByLabel('顯示已停用').uncheck();
    await settled(page);

    // 新增單筆：必填、重複編號
    await page.getByRole('button', { name: '新增商品', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('商品編號').fill(c('ADD'));
    await dialog.getByLabel('商品名稱').fill('畫面新增商品');
    await dialog.getByLabel('單位').fill('罐');
    await dialog.getByRole('button', { name: '新增', exact: true }).click();
    await expect(notice(page).filter({ hasText: `已新增商品「${c('ADD')}」` })).toBeVisible();
    expect(await byCode(c('ADD'))).toMatchObject({ product_name: '畫面新增商品', unit: '罐', is_active: true });
    await page.getByRole('button', { name: '新增商品', exact: true }).click();
    await dialog.getByLabel('商品編號').fill(c('ADD'));
    await dialog.getByLabel('商品名稱').fill('重複');
    await dialog.getByRole('button', { name: '新增', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('此商品編號已存在');
    await dialog.getByRole('button', { name: '取消' }).click();
    // 放棄未儲存內容的確認
    const discard = page.getByRole('dialog', { name: '放棄未儲存內容？' });
    if (await discard.count()) await discard.getByRole('button', { name: '放棄' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 編輯：編號不可改，名稱單位可改
    await rowOf(page, c('ADD')).getByRole('button', { name: '編輯' }).click();
    const edit = page.getByRole('dialog', { name: '編輯商品' });
    await expect(edit.getByLabel('商品編號')).toBeDisabled();
    await edit.getByLabel('商品名稱').fill('畫面改過的名稱');
    await edit.getByLabel('單位').fill('箱');
    await edit.getByRole('button', { name: '儲存修改' }).click();
    await expect(notice(page).filter({ hasText: `已更新商品「${c('ADD')}」` })).toBeVisible();
    await expect(rowOf(page, c('ADD'))).toContainText('畫面改過的名稱');
    expect(await byCode(c('ADD'))).toMatchObject({ product_name: '畫面改過的名稱', unit: '箱' });

    // 操作紀錄：停用、重新啟用、新增、編輯、匯入皆有（actor = 管理者）
    const logs = ((await db.from('products_master_operation_logs').select('action,product_code,actor_id').eq('actor_id', users.pm_manage.id)).data || []) as any[];
    expect(logs.map((l) => l.action).sort()).toEqual(['create', 'deactivate', 'import', 'reactivate', 'update']);

    if (mobile) {
      expect(await noOverflow(page), '手機清單不橫向溢出').toBe(true);
      const box = await page.locator('.products-master-page .module-table').first().boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);
    }
    expect(problems, `console／頁面錯誤：${problems.join(' | ')}`).toEqual([]);
  } finally {
    await ctx.close();
  }
});
