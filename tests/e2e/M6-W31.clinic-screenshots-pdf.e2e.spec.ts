import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser, cleanupM6Clinic, clinicFileName, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { batchesOf, db, itemsOf, objectExists, screenshotPaths } from '../support/clinic-api';
import { clinicFixture, TINY_PNG } from '../support/clinic-selfpay-fixtures';
import { PDF_FORBIDDEN, pdfVisibleText } from '../../lib/clinic-selfpay/claim-pdf';

/**
 * M6 第三批 W31 診所截圖與 PDF：多角色接力劇本（桌機 1440、手機 390 各跑一次）。自造測試檔（真實樣本尚未提供）。
 * 角色：cs_none（沒有任何診所權限：沒有選單、API 403）、cs_title_mgr（區經理：匯入價格主檔、關帳、刪批次）、
 *   cs_calc_a（店長，綁 VW001：匯入診所檔與截圖（貼上 + 多選）、D3、D4、D2、回看截圖、匯出 PDF）、cs_calc_b（另一間店，看不到 VW001）。
 * 劇本：無權限者沒有入口 -> 區經理匯入價格 -> 店長 D3 確認、D2 擋下、成功、D4 確認 -> 開明細、截圖檢視器（鍵盤、縮放、縮圖、手機滑動）
 *   -> 匯出 PDF（檔名、頁數、渲染用的 HTML 不含成本毛利）-> 60 品項大檔匯出多頁 PDF -> 區經理關帳（舊批次金額不變）-> 別店看不到 -> 區經理刪批次，儲存物件消失。
 */
const db_ = db();
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const f = (tag: string) => clinicFileName(tag);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const xlsx = (fixture: string, tag: string) => ({ name: f(tag), mimeType: XLSX_MIME, buffer: clinicFixture(fixture) });
const png = (n: number) => ({ name: `w31-shot-${n}.png`, mimeType: 'image/png', buffer: Buffer.concat([TINY_PNG, Buffer.from(`-${n}`)]) });

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Clinic();
  ({ users, teardown } = await setupM6Users(['cs_none', 'cs_title_mgr', 'cs_calc_a', 'cs_calc_b']));
  sid = await testStoreIds();
});
test.afterAll(async () => {
  const r = await cleanupM6Clinic(db_, Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left).toEqual([]);
  expect(r.leftoverObjects, '桶內不應留下測試截圖').toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  const api = await apiForUser(users[who]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state, acceptDownloads: true });
}
const MENU = '診所自費藥毛利計算';
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator(`.workspace-menu button.catalog-item[title="${MENU}"]`);
const root = (page: Page) => page.locator('[data-testid=clinic-selfpay]');
const tid = (page: Page, id: string) => root(page).locator(`[data-testid=${id}]`);
async function openPage(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: MENU, exact: true })).toBeVisible();
  await expect(tid(page, 'store-select')).toBeVisible();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
const setMonth = async (page: Page, ym: string) => { await tid(page, 'month-input').fill(ym); };
async function pasteImage(page: Page, bytes: number[]) {
  await page.evaluate((arr) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(arr)], 'clip.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, bytes);
}
/** jsPDF 每頁一個 /Type /Page 物件。 */
const pdfPageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

/** 按匯出 PDF：回傳下載檔名、頁數、頁面 HTML（匯出時實際渲染過的）。 */
async function exportPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), tid(page, 'export-pdf').click()]);
  const file = await download.path();
  const buf = fs.readFileSync(file);
  const info = await page.evaluate(() => (window as any).__clinicPdfLast as { filename: string; pages: number; pageHtmls: string[] });
  return { filename: download.suggestedFilename(), bytes: buf, pages: pdfPageCount(buf), info };
}

test('無權限者沒有入口；區經理匯入價格；店長貼上與多選截圖、D3、D2、D4、回看截圖、匯出 PDF（無成本毛利）；關帳；別店看不到；區經理刪批次並清掉截圖', async ({ browser }, testInfo) => {
  test.setTimeout(600_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const problems: string[] = [];

  // ---- 無權限者
  {
    const ctx = await ctxFor(browser, 'cs_none');
    const page = await ctx.newPage();
    try {
      await openMenu(page);
      await expect(page.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
      await expect(menuItem(page), 'cs_none 不應看到診所自費藥毛利計算').toHaveCount(0);
      expect((await ctx.request.get('/api/workspace/clinic-selfpay/batches')).status()).toBe(403);
      expect((await ctx.request.get('/api/workspace/clinic-selfpay/stores')).status()).toBe(403);
    } finally {
      await ctx.close();
    }
  }

  // ---- 區經理：匯入價格（一般檔 + 60 品項大檔）
  const mgrCtx = await ctxFor(browser, 'cs_title_mgr');
  const mgr = await mgrCtx.newPage();
  watch(mgr, problems);
  await openPage(mgr);
  await tid(mgr, 'store-select').selectOption(sid.VW001);
  await setMonth(mgr, '2038-11');
  await tid(mgr, 'tab-mapping').click();
  await tid(mgr, 'price-file').setInputFiles(xlsx('price-multi-month.xlsx', 'w31-price'));
  await expect(tid(mgr, 'price-message')).toContainText('月價匯入成功：7 筆');
  await expect(tid(mgr, 'mapping-row')).toHaveCount(4);
  await expect(tid(mgr, 'price-file')).toBeEnabled(); // 上一次匯入完成（busy 結束）才選下一個檔
  await tid(mgr, 'price-file').setInputFiles(xlsx('price-many.xlsx', 'w31-price-many'));
  await expect(tid(mgr, 'price-message')).toContainText('月價匯入成功：60 筆');
  await expect(tid(mgr, 'mapping-row')).toHaveCount(64);

  // ---- 店長（綁 VW001）
  const smCtx = await ctxFor(browser, 'cs_calc_a');
  const sm = await smCtx.newPage();
  watch(sm, problems);
  let storeName = '';
  let billingBefore = 0;
  try {
    await openPage(sm);
    await setMonth(sm, '2038-11');
    storeName = (await tid(sm, 'store-select').locator('option:checked').innerText()).replace(/^VW001\s*/, '').trim();
    expect(storeName.length).toBeGreaterThan(0);

    // 多選 2 張 + 貼上 1 張 = 3 張；超過 10 張的部分會略過並提示
    await tid(sm, 'shot-input').setInputFiles([png(1), png(2)]);
    await pasteImage(sm, Array.from(TINY_PNG));
    await expect(tid(sm, 'shot-thumb')).toHaveCount(3);
    await tid(sm, 'shot-input').setInputFiles(Array.from({ length: 8 }, (_, i) => png(i + 10)));
    await expect(tid(sm, 'shot-thumb'), '最多 10 張').toHaveCount(10);
    await expect(tid(sm, 'batch-message')).toContainText('最多上傳 10 張');
    await tid(sm, 'shot-list').getByRole('button', { name: '清空截圖' }).click();
    await expect(tid(sm, 'shot-thumb')).toHaveCount(0);
    await tid(sm, 'shot-input').setInputFiles([png(1), png(2)]);
    await pasteImage(sm, Array.from(TINY_PNG));
    await expect(tid(sm, 'shot-thumb')).toHaveCount(3);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-october.xlsx', 'w31-oct'));
    if (mobile) expect(await noOverflow(sm), '手機計算頁不橫向溢出').toBe(true);

    // D3：取消 -> 再確定（以檔案期間 2038-10 歸檔）
    await tid(sm, 'import-btn').click();
    const dlg = sm.locator('[data-testid=confirm-dialog]');
    await expect(dlg).toHaveAttribute('data-code', 'PERIOD_MISMATCH');
    await expect(sm.locator('[data-testid=confirm-message]')).toHaveText('檔案是 10 月，與你選的 11 月不同，確定嗎？');
    await sm.locator('[data-testid=confirm-cancel]').click();
    expect((await batchesOf(sid.VW001, f('w31-oct'))).length).toBe(0);
    await tid(sm, 'import-btn').click();
    await sm.locator('[data-testid=confirm-ok]').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 3 筆');
    expect(screenshotPaths((await batchesOf(sid.VW001, f('w31-oct')))[0].screenshot_path)).toHaveLength(3);

    // D2：未匹配整批擋下
    await tid(sm, 'shot-input').setInputFiles([png(3)]);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-unmatched.xlsx', 'w31-unm'));
    await tid(sm, 'import-btn').click();
    await expect(tid(sm, 'unmatched-row')).toHaveCount(2);
    await expect(tid(sm, 'unmatched-list')).toContainText('ZTU000001');
    expect((await batchesOf(sid.VW001, f('w31-unm'))).length).toBe(0);

    // 成功匯入（截圖保留）
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-basic.xlsx', 'w31-basic'));
    await tid(sm, 'import-btn').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 8 筆，匹配 8 筆，未匹配 0 筆');
    const basic = (await batchesOf(sid.VW001, f('w31-basic')))[0];
    expect(screenshotPaths(basic.screenshot_path)).toHaveLength(1);

    // D4：重複 -> 確認 -> 仍新增（2 張截圖）
    await tid(sm, 'shot-input').setInputFiles([png(4), png(5)]);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-basic.xlsx', 'w31-basic2'));
    await tid(sm, 'import-btn').click();
    await expect(dlg).toHaveAttribute('data-code', 'DUPLICATE_BATCH');
    await sm.locator('[data-testid=confirm-ok]').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 8 筆');
    const basic2 = (await batchesOf(sid.VW001, f('w31-basic2')))[0];
    expect(screenshotPaths(basic2.screenshot_path)).toHaveLength(2);
    await expect(tid(sm, 'batch-row')).toHaveCount(3);
    billingBefore = Number((await itemsOf(basic2.id))[0].billing_amount);

    // ---- 回看截圖：檢視器（現在顯示的是 basic2，兩張）
    await expect(tid(sm, 'open-lightbox')).toContainText('回看截圖（2）');
    await tid(sm, 'open-lightbox').click();
    const lb = sm.locator('[data-testid=lightbox]');
    await expect(lb).toBeVisible();
    await expect(lb).toHaveAttribute('role', 'dialog');
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 1 張 / 共 2 張');
    await expect.poll(() => lb.locator('[data-testid=lb-image]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: '簽名網址的圖片要真的載入' }).toBe(true);
    await expect(lb.locator('[data-testid=lb-prev]')).toBeDisabled();
    await sm.keyboard.press('ArrowRight');
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 2 張 / 共 2 張');
    await expect(lb.locator('[data-testid=lb-next]')).toBeDisabled();
    await sm.keyboard.press('ArrowLeft');
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 1 張 / 共 2 張');
    await sm.keyboard.press('+');
    await expect(lb.locator('[data-testid=lb-zoom-reset]')).toHaveText('150%');
    await lb.locator('[data-testid=lb-zoom-in]').click();
    await expect(lb.locator('[data-testid=lb-zoom-reset]')).toHaveText('200%');
    await sm.keyboard.press('0');
    await expect(lb.locator('[data-testid=lb-zoom-reset]')).toHaveText('100%');
    await lb.locator('[data-testid=lb-thumb]').nth(1).click();
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 2 張 / 共 2 張');
    // 手機滑動：向右滑回上一張、向左滑到下一張
    await sm.evaluate(() => {
      const stage = document.querySelector('[data-testid=lightbox] .stage')!;
      const fire = (type: string, x: number) => stage.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: 300, bubbles: true }));
      fire('pointerdown', 100); fire('pointerup', 260);
    });
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 1 張 / 共 2 張');
    await sm.evaluate(() => {
      const stage = document.querySelector('[data-testid=lightbox] .stage')!;
      const fire = (type: string, x: number) => stage.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', clientX: x, clientY: 300, bubbles: true }));
      fire('pointerdown', 260); fire('pointerup', 100);
    });
    await expect(lb.locator('[data-testid=lb-counter]')).toHaveText('第 2 張 / 共 2 張');
    if (mobile) {
      const box = await lb.locator('[data-testid=lb-image]').boundingBox();
      expect(box!.width, '手機圖片不超出畫面').toBeLessThanOrEqual(390);
    }
    await sm.keyboard.press('Escape');
    await expect(lb).toHaveCount(0);

    // ---- 匯出 PDF（basic2，8 品項，單頁）
    const one = await exportPdf(sm);
    expect(one.filename).toBe(`${storeName}診所請款明細_ZT038001_2038-11.pdf`);
    expect(one.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(one.pages).toBe(1);
    expect(one.info.pages).toBe(1);
    expect(one.info.filename).toBe(one.filename);
    const text1 = pdfVisibleText(one.info.pageHtmls.join('\n'));
    expect(PDF_FORBIDDEN.test(text1), 'PDF 渲染用的 DOM 不可有成本、毛利字樣').toBe(false);
    for (const secret of ['180.25', '210.75', '700', '701', '400']) expect(text1, `不可出現成本毛利數字 ${secret}`).not.toMatch(new RegExp(`(?<![\\d,.])${secret.replace('.', '\\.')}(?![\\d,])`));
    for (const piece of ['診所請款明細', '測試診所甲（ZT038001）', '2038-11-01 ~ 2038-11-30', '藥費總額', '分店蓋章 / 簽名處', '診所蓋章 / 簽名處', '列印日期：', '第 1 頁 / 共 1 頁', 'ZTA000001', '測試藥品甲錠']) expect(text1, piece).toContain(piece);
    await expect(tid(sm, 'batch-message')).toContainText(`已匯出 ${one.filename}`);
    // 畫面上的明細仍看得到成本毛利（只有 PDF 不含）
    await expect(tid(sm, 'cell-cost').first()).toHaveText('60');
    await expect(tid(sm, 'cell-profit').first()).toHaveText('400');
    // 渲染用的暫存元素已清掉
    expect(await sm.locator('[data-clinic-pdf-page]').count()).toBe(0);

    // ---- 60 品項大檔：多頁 PDF
    await tid(sm, 'shot-input').setInputFiles([png(6)]);
    await tid(sm, 'claim-file').setInputFiles(xlsx('claim-many.xlsx', 'w31-many'));
    await tid(sm, 'import-btn').click();
    await expect(tid(sm, 'batch-message')).toContainText('匯入成功：共 60 筆');
    const many = await exportPdf(sm);
    expect(many.filename).toBe(`${storeName}診所請款明細_ZT038009_2038-11.pdf`);
    expect(many.pages, '60 列要分成多頁').toBeGreaterThanOrEqual(2);
    expect(many.pages).toBe(many.info.pages);
    const manyHtml = many.info.pageHtmls;
    expect(manyHtml).toHaveLength(many.pages);
    manyHtml.forEach((h, i) => expect(pdfVisibleText(h)).toContain(`第 ${i + 1} 頁 / 共 ${many.pages} 頁`));
    expect(pdfVisibleText(manyHtml[0])).not.toContain('簽名處');
    expect(pdfVisibleText(manyHtml[manyHtml.length - 1])).toContain('分店蓋章 / 簽名處');
    expect(pdfVisibleText(manyHtml[manyHtml.length - 1])).toContain('列印日期：');
    expect(pdfVisibleText(manyHtml[1])).toContain('診所請款明細（續）');
    // 60 筆都在，且只出現一次
    const allText = pdfVisibleText(manyHtml.join('\n'));
    for (let i = 1; i <= 60; i += 1) expect(allText).toContain('ZTM' + String(i).padStart(6, '0'));
    expect(PDF_FORBIDDEN.test(allText)).toBe(false);
    if (mobile) expect(await noOverflow(sm), '手機明細不橫向溢出').toBe(true);
  } finally {
    await smCtx.close();
  }

  // ---- 區經理關帳：舊批次的價格快照不變
  const basic2 = (await batchesOf(sid.VW001, f('w31-basic2')))[0];
  await mgr.bringToFront();
  await tid(mgr, 'close-btn').click();
  await mgr.getByRole('dialog', { name: '關帳主檔' }).locator('[data-testid=close-confirm]').click();
  await expect(tid(mgr, 'closed-badge')).toContainText('2038-11 已關帳');
  await tid(mgr, 'price-file').setInputFiles(xlsx('price-single-sheet.xlsx', 'w31-price-after-close'));
  await expect(tid(mgr, 'price-message')).toContainText('2038-11');
  expect(Number((await itemsOf(basic2.id))[0].billing_amount), '關帳與之後的匯入不改舊批次').toBe(billingBefore);

  // ---- 另一間店的店長：看不到
  {
    const ctx = await ctxFor(browser, 'cs_calc_b');
    const page = await ctx.newPage();
    watch(page, problems);
    try {
      await openPage(page);
      await expect(tid(page, 'batch-row')).toHaveCount(0);
      expect((await ctx.request.get(`/api/workspace/clinic-selfpay/batches/${basic2.id}`)).status()).toBe(403);
    } finally {
      await ctx.close();
    }
  }

  // ---- 區經理刪批次：儲存物件一併消失
  try {
    await mgr.reload({ waitUntil: 'networkidle' });
    await openPage(mgr);
    await tid(mgr, 'store-select').selectOption(sid.VW001);
    await expect(tid(mgr, 'batch-row')).toHaveCount(4);
    for (const tag of ['w31-basic2', 'w31-many']) {
      const target = (await batchesOf(sid.VW001, f(tag)))[0];
      const paths = screenshotPaths(target.screenshot_path);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) expect(await objectExists(p)).toBe(true);
      await mgr.locator(`[data-testid=batch-row][data-batch="${target.id}"] [data-testid=delete-batch]`).click();
      await mgr.getByRole('dialog', { name: '刪除匯入批次' }).locator('[data-testid=delete-confirm]').click();
      await expect(mgr.locator(`[data-testid=batch-row][data-batch="${target.id}"]`), '刪除後該列消失（上一次的成功訊息還在，不能只看訊息）').toHaveCount(0);
      await expect(tid(mgr, 'batch-message')).toContainText('匯入批次已刪除');
      for (const p of paths) expect(await objectExists(p), `${p} 應已刪除`).toBe(false);
      expect(await itemsOf(target.id)).toEqual([]);
    }
    await expect(tid(mgr, 'batch-row')).toHaveCount(2);
    const kept = (await batchesOf(sid.VW001, f('w31-basic')))[0];
    for (const p of screenshotPaths(kept.screenshot_path)) expect(await objectExists(p), '別批截圖不受影響').toBe(true);
  } finally {
    await mgrCtx.close();
  }
  expect(problems, `console／頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});
