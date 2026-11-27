import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { openGaCenter, openGaSide, pageForUser, shell } from '../support/g01-ui';
import { assertGaBaseline, callFn, cleanupM7M8, m7Name, stores } from '../support/m7m8-fixtures';
import { seedGa45Vendor } from '../support/m7m8-ga45-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// GAPR 請款單紙本格式列印 e2e（只在桌機 project 跑；列印版面與 1920×1080 截圖只有桌機有意義）：
//   1. 水電請款（老闆範例）：5 個門市、其中一個門市 4 張帳單（6653+387+8797+507）合併一列；付款方式轉帳、預計付款日有填。
//      驗證抬頭、副標、民國日期、合併列「（共 4 個電號）」、帳單備註接在使用單位後、至少 5 列（空白列也印項次）、營業稅 0、合計 59,496、轉帳打勾、到期日、簽核欄文字與附註、系統單號、標楷體與無「$」。
//      再到請款單頁的「列印欄位」表格改第 4 列使用單位並儲存，重印驗證覆寫生效（並驗證 41 字被拒）。
//      再以列印媒體 + A4 PDF 驗證內容只佔一頁的上半頁。
//   2. 採購請款：印出稅額與採購單號（內部訂單欄），檢附單據預設「發票」；使用單位預設空白，在列印欄位表格填「總部倉庫」後重印。
// 設定環境變數 PRP_SHOTS=<資料夾> 才會輸出截圖與 PDF（平常不輸出）。資料只用 VW／ZT 門市、2038 年；結束時清掉自己建立的資料。
test.describe.configure({ mode: 'serial' });
test.setTimeout(360_000);
const P = '/api/workspace/general-affairs';
const KEYS: GaupKey[] = ['clerk', 'accountant', 'ga45_clerk'];
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
const key = () => crypto.randomUUID();
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const vis = (page: any, id: string) => page.getByTestId(id).locator('visible=true');
const rowsOf = (page: any) => page.locator('[data-testid="pk-row"]:visible');
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
const SHOTS = process.env.PRP_SHOTS || '';
// A4 直式、上下左右各留 10mm：上半頁可用高度 = 148.5mm - 10mm。
const MM = 96 / 25.4;
const HALF_PAGE_MM = 148.5 - 10;

async function openPrint(page: any, prNo: string, editBtn: 'pu-print' | 'pe-print') {
  await openGaCenter(page);
  await openGaSide(page);
  await side(page, '請款單').click();
  await vis(page, 'pr-search').fill(prNo);
  await vis(page, 'open-pr').click();
  await vis(page, editBtn).click();
  await expect(vis(page, 'pp-paper')).toBeVisible();
  await expect(vis(page, 'pk-no')).toContainText(prNo);
}
async function shotsFor(page: any, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.screenshot({ path: path.join(SHOTS, `${name}-首屏.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${name}-整頁.png`), fullPage: true });
}
/** 列印媒體：量紙張高度（mm）、檢查橫向溢出，並輸出 A4 PDF（頁數必須是 1）。 */
async function printCheck(page: any, name: string) {
  await page.emulateMedia({ media: 'print' });
  // 列印頁寬 = A4 210mm - 左右各 10mm = 190mm；用同寬的視窗量高度才和實際列印一致。
  const keep = page.viewportSize();
  await page.setViewportSize({ width: Math.round(190 * MM), height: 1123 });
  const m = await page.evaluate(() => {
    const sheet = (Array.from(document.querySelectorAll('[data-testid="pp-paper"]')) as HTMLElement[]).find((e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0);
    if (!sheet) return null;
    const r = sheet.getBoundingClientRect();
    const wide = Array.from(sheet.querySelectorAll('*')).filter((n) => (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1 && getComputedStyle(n as Element).display !== 'inline').map((n) => (n as HTMLElement).className || n.tagName);
    const wrapped = (Array.from(sheet.querySelectorAll('[data-testid="pk-row"] td:nth-child(2)')) as HTMLElement[]).filter((td) => {
      const rg = document.createRange(); rg.selectNodeContents(td);
      return new Set(Array.from(rg.getClientRects()).map((q) => Math.round(q.top))).size > 1;
    }).map((td) => td.textContent);
    return { heightPx: r.height, widthPx: r.width, wide, top: r.top, wrapped };
  });
  await page.setViewportSize(keep!);
  expect(m, '列印媒體下找得到紙張區塊').not.toBeNull();
  // 硬性要求：一張 A4 放得下（PDF 只有 1 頁），且內容在上半頁（底端 ≤ 50%）。
  expect(m!.heightPx / MM, `紙張高度 ${(m!.heightPx / MM).toFixed(1)}mm 要在一張 A4 可印範圍（277mm）內`).toBeLessThanOrEqual(277);
  expect(m!.wrapped, '使用單位欄不換行').toEqual([]);
  expect(m!.wide, '列印時紙張內沒有橫向被截斷的區塊').toEqual([]);
  expect((m!.top + m!.heightPx) / MM, `紙張底端 ${((m!.top + m!.heightPx) / MM).toFixed(1)}mm（含上方偏移 ${(m!.top / MM).toFixed(1)}mm）要在 A4 上半頁（${HALF_PAGE_MM}mm）內`).toBeLessThanOrEqual(HALF_PAGE_MM);
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages, 'PDF 只有 1 頁').toBe(1);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.pdf`), pdf);
  }
  await page.emulateMedia({ media: 'screen' });
  return { heightMm: m!.heightPx / MM, halfPage: m!.heightPx / MM <= HALF_PAGE_MM };
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('紙本格式列印 1 水電請款（老闆範例）：合併列、營業稅 0、合計、轉帳打勾、到期日、簽核欄、A4 上半頁', async ({ browser }, testInfo) => {
  test.skip(!String(testInfo.project.name).startsWith('desktop'), '列印版面只在桌機 project 驗證');
  const st = await stores();
  const payee = await seedPayee('PRP');
  const ident = (n: number) => `QA-PRP-${String(Date.now()).slice(-6)}-${n}`;
  const mk = (code: string, amount: number, over: Record<string, unknown> = {}) =>
    mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01', due_date: '2038-03-30', expense_type: 'ELECTRICITY', store_id: st[code].id, service_identifier: ident(Math.floor(Math.random() * 1e6)), amount, ...over });
  const bills = [
    await mk('VW001', 11454),
    await mk('VW002', 16577),
    await mk('ZT01', 6653), await mk('ZT01', 387), await mk('ZT01', 8797), await mk('ZT01', 507),
    await mk('ZT02', 74, { notes: '新地址614號' }),
    await mk('ZT03', 15047),
  ];
  for (const b of bills) await addBillAttachment(users.clerk.client, b.id, users.clerk.id);
  const create = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', expected_pay_date: '2038-03-31', idempotency_key: key() } });
  expect(create.status(), await create.text()).toBe(201);
  const pr = (await create.json()).data;
  expect(Number(pr.amount_total)).toBe(59496);
  const sub = await apis.clerk.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: key() } });
  expect(sub.status(), await sub.text()).toBe(200);
  const sd = (await sub.json()).data;
  const paid = await apis.accountant.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'mark_paid', pay_method: 'TRANSFER', paid_ref: 'QA-PRP', expected_updated_at: sd.updated_at, idempotency_key: key() } });
  expect(paid.status(), await paid.text()).toBe(200);

  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openPrint(page, pr.pr_no, 'pu-print');
    await expect(vis(page, 'pk-subtitle')).toHaveText('請款單');
    await expect(vis(page, 'pk-title')).not.toHaveText('');
    await expect(vis(page, 'pk-attach')).toHaveText('繳費單');
    await expect(vis(page, 'pk-date')).toHaveText(/^\d{3}\/\d{2}\/\d{2}$/);
    // 5 個門市 → 5 筆資料列＋補空白到 7 列
    await expect(rowsOf(page)).toHaveCount(5);
    const rows = await rowsOf(page).evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    const amounts = rows.slice(0, 5).map((r) => r[3].replace(/[$\s]/g, ''));
    expect(amounts.slice().sort()).toEqual(['11,454', '16,344', '16,577', '15,047', '74'].sort());
    expect(rows.slice(0, 5).map((r) => r[0])).toEqual(['1', '2', '3', '4', '5']);
    const merged = rows.find((r) => r[3].includes('16,344'))!;
    expect(merged[2], '合併列申請事由').toContain('127年3月電費（共 4 個電號）');
    for (const r of rows.slice(0, 5)) expect(r[2]).toContain('127年3月電費');
    expect(rows.find((r) => r[3].includes('74'))![1], '帳單備註接在使用單位後').toContain('（新地址614號）');
    for (const r of rows) expect(r[3], '金額欄沒有 $ 符號').not.toContain('$');
    expect(await vis(page, 'pp-paper').evaluate((e) => getComputedStyle(e).fontFamily), '標楷體').toContain('DFKai-SB');
    for (const r of rows) expect(r[4], '水電內部訂單空白').toBe('');
    await expect(vis(page, 'pk-tax-label')).toContainText('營業稅');
    await expect(vis(page, 'pk-tax')).toHaveText('0');
    await expect(vis(page, 'pk-total')).toContainText('59,496');
    await expect(vis(page, 'pk-box-transfer')).toHaveText('■');
    for (const id of ['pk-box-check', 'pk-box-cash', 'pk-box-other']) await expect(vis(page, id)).toHaveText('□');
    await expect(vis(page, 'pk-due')).toHaveText('127年3月31日');
    await expect(vis(page, 'pk-payee')).toHaveText(payee.name);
    await expect(vis(page, 'pk-pay')).toContainText('授款人簽收：');
    const sign = await vis(page, 'pk-sign').innerText();
    for (const x of ['董　事　長：__________', '副董事長：__________', '總經理/長級高階主管：__________', '事業群主管：__________', '部　門　主管：__________', '直屬主管：__________', '財會部：__________']) expect(sign).toContain(x);
    expect(sign).toContain('(註)');
    await expect(page.locator('.pk-note:visible')).toHaveText('註：依核決權限簽核完成再交由財會部入帳。');
    await expect(vis(page, 'pk-no')).toHaveText(`系統單號 ${pr.pr_no}`);
    // 螢幕版面：紙張不超出視窗
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // 下載 PDF：檔名含「請款單」、%PDF 開頭、大於 10KB；列印媒體下按鈕不可見。
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'pk-download-pdf').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
    expect(dl.suggestedFilename()).toContain('請款單');
    expect(dl.suggestedFilename()).toContain(pr.pr_no);
    const buf = fs.readFileSync((await dl.path())!);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buf.length, 'PDF 大於 10KB').toBeGreaterThan(10 * 1024);
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('pk-download-pdf')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await shotsFor(page, '01-水電請款單');
    const { heightMm } = await printCheck(page, '01-水電請款單-A4');
    testInfo.annotations.push({ type: '紙張高度', description: `${heightMm.toFixed(1)}mm（上半頁上限 ${HALF_PAGE_MM}mm，${heightMm <= HALF_PAGE_MM ? '符合' : '超出上半頁'}）` });
    // 使用單位逐列可改：回請款單頁，在列印欄位表格改第 4 列（建恭）並儲存，重印。
    const before = (await rowsOf(page).nth(3).locator('td').nth(1).innerText()).trim();
    expect(before).toContain('新地址614號');
    await vis(page, 'pp-back').click();
    await expect(vis(page, 'pu-pf-unit-4')).toHaveAttribute('placeholder', /新地址614號/);
    await vis(page, 'pu-pf-unit-4').fill('建恭 QA 改');
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await vis(page, 'pu-pf-box').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, '03-列印欄位使用單位表格-首屏.png') });
      await vis(page, 'pu-pf-box').screenshot({ path: path.join(SHOTS, '03-列印欄位使用單位表格.png') });
    }
    await vis(page, 'pu-pf-save').click();
    await expect(vis(page, 'pu-pf-done')).toBeVisible();
    await vis(page, 'pu-print').click();
    await expect(vis(page, 'pp-paper')).toBeVisible();
    await expect(rowsOf(page).nth(3).locator('td').nth(1)).toHaveText('建恭 QA 改');
    await expect(rowsOf(page).nth(0).locator('td').nth(1), '其他列仍是預設門市簡稱').not.toHaveText('');
    // 超過 40 字被後端拒絕，資料不變
    const long = await apis.clerk.patch(`${P}/payment-requests/${pr.id}/print-fields`, { data: { units: { x: 'x'.repeat(41) } } });
    expect(long.status()).toBe(400);
    await printCheck(page, '01-水電請款單-改使用單位-A4');
    // 「列印明細版」仍可用
    await vis(page, 'pp-layout-detail').click();
    await expect(vis(page, 'pp-sheet')).toBeVisible();
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('紙本格式列印 2 採購請款：稅額與採購單號（內部訂單）、檢附單據預設發票', async ({ browser }, testInfo) => {
  test.skip(!String(testInfo.project.name).startsWith('desktop'), '列印版面只在桌機 project 驗證');
  const vendor = await seedGa45Vendor(`PRP${Date.now() % 100000}`);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const r: any = await callFn(users.ga45_clerk.client, name, args);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.data as any;
  };
  const d = await rpc('ga_ws_po_create', { p_header: { notes: m7Name('PRP'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-PRP 採購品', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: key() });
  const po = await rpc('ga_ws_po_action', { p_id: d.id, p_action: 'place_order', p_expected_updated_at: d.updated_at, p_note: null });
  const rc = await rpc('ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items.find((i: any) => i.line_no === 1).id, delivered_qty: 10 }], p_key: key() });
  const cp = await apis.ga45_clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id, claim_untaxed: 1000, claim_tax: 50 }], idempotency_key: key() } });
  expect(cp.status(), await cp.text()).toBe(201);
  const pr = (await cp.json()).data;
  expect(Number(pr.tax_amount)).toBe(50);
  const { ctx, page, errors } = await pageForUser(browser, states.ga45_clerk, testInfo);
  try {
    await openPrint(page, pr.pr_no, 'pe-print');
    await expect(vis(page, 'pk-attach')).toHaveText('發票');
    await expect(vis(page, 'pk-tax')).toHaveText('50');
    await expect(vis(page, 'pk-total')).toContainText('1,050');
    const poNo = String(po.po_no);
    expect(poNo).toBeTruthy();
    const rows = await rowsOf(page).evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0][2], '申請事由含採購單號').toContain(poNo);
    expect(rows[0][4], '內部訂單印採購單號').toContain(poNo);
    await expect(vis(page, 'pk-payee')).toHaveText(vendor.name);
    await expect(vis(page, 'pk-due')).toHaveText('____年____月____日');
    expect(rows[0][1], '採購使用單位預設空白').toBe('');
    // 使用單位逐列可改：預設空白，在列印欄位表格填「總部倉庫」後重印。
    await vis(page, 'pp-back').click();
    await vis(page, 'pe-pf-unit-1').fill('總部倉庫');
    await vis(page, 'pe-pf-save').click();
    await expect(vis(page, 'pe-pf-done')).toBeVisible();
    await vis(page, 'pe-print').click();
    await expect(vis(page, 'pp-paper')).toBeVisible();
    await expect(rowsOf(page).nth(0).locator('td').nth(1)).toHaveText('總部倉庫');
    await expect(rowsOf(page).nth(0).locator('td').nth(4)).toHaveText(poNo);
    await shotsFor(page, '02-採購請款單');
    await printCheck(page, '02-採購請款單-A4');
    // 多個請款單列印頁籤並存：在第二張的頁籤下載，PDF 轉圖的來源必須是第二張（不是先開的第一張）。
    const d2 = await rpc('ga_ws_po_create', { p_header: { notes: m7Name('PRP2'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-PRP 採購品二', unit: '個', quantity: 5, unit_price: 100 }], p_create_key: key() });
    const po2 = await rpc('ga_ws_po_action', { p_id: d2.id, p_action: 'place_order', p_expected_updated_at: d2.updated_at, p_note: null });
    const rc2 = await rpc('ga_ws_po_receive', { p_po_id: po2.id, p_header: {}, p_lines: [{ po_item_id: po2.items.find((i: any) => i.line_no === 1).id, delivered_qty: 5 }], p_key: key() });
    const cp2 = await apis.ga45_clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rc2.id, claim_untaxed: 500, claim_tax: 25 }], idempotency_key: key() } });
    expect(cp2.status(), await cp2.text()).toBe(201);
    const pr2 = (await cp2.json()).data;
    // 不重新進服務中心首頁（會清掉已開的頁籤）：直接用側欄回請款單清單，再開第二張的列印頁。
    await side(page, '請款單').click();
    await vis(page, 'pr-search').fill(pr2.pr_no);
    await expect(vis(page, 'pr-no')).toHaveText(pr2.pr_no);
    await vis(page, 'open-pr').click();
    await vis(page, 'pe-print').click();
    await expect(vis(page, 'pk-no')).toContainText(pr2.pr_no);
    expect(await page.locator('[data-testid="pp-paper"]').count(), '兩個請款單列印頁籤並存').toBe(2);
    await page.evaluate(() => {
      (window as any).__pdfText = '';
      new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if ((n as HTMLElement).dataset?.pdfHost !== undefined) (window as any).__pdfText = (n as HTMLElement).innerText || (n as HTMLElement).textContent || ''; }); }).observe(document.body, { childList: true });
    });
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'pk-download-pdf').click()]);
    expect(dl2.suggestedFilename()).toContain(pr2.pr_no);
    const pdfText = await page.evaluate(() => (window as any).__pdfText as string);
    expect(pdfText, 'PDF 來源內容是第二張請款單').toContain(pr2.pr_no);
    expect(pdfText, 'PDF 來源內容不是第一張請款單').not.toContain(pr.pr_no);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
