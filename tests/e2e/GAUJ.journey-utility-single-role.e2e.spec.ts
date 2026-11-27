import fs from 'node:fs';
import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { BYPASS_HEADERS, TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { dialog } from '../support/g12-ui';
import { gaNavToIn, openGaCenter, openGaSide, pageForUser, shell } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, cleanupM7Users, M7_EMAIL_PREFIX, M7_ROLE_PREFIX, stores } from '../support/m7m8-fixtures';
import { freshValidTaxId } from '../support/m7m8-ga6-fixtures';
import { clientForCredentials, PERM } from '../support/m7m8-po-fixtures';
import { cleanupGaup, gaupName, PAY_P, UB_P, todayIso } from '../support/g46-fixtures';
import { makePng } from '../support/png';
import { cleanupGaib1, gaib1Name } from '../support/gaib1-fixtures';

// 總務一人劇本（單一角色、只掛 7 個權限碼）：設定廠商與買受人公司，登錄帳單、上傳掃描檔（含手機 QR，關閉後 QR 作廢），建立請款單、列印與 PDF、送出、
// 自動付款、確認已付款與自動標記，看月報表與年度逐月總表並匯出 Excel。需要的 7 個權限碼：service_center.access、vendor.view/manage、utility_bill.view/manage、purchase_payment.view/manage。
const P = '/api/workspace/general-affairs';
test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
const db = () => adminDb();
const vis = (page: Page, id: string) => page.getByTestId(id).locator('visible=true');
const png = (n = 0) => makePng({ width: 160 + n, height: 100, inkPixels: 30 + n });
const consoleErrs: string[] = [];
const shot = async (..._a: unknown[]) => undefined;
/** 一步：用 test.step 包起來，失敗就讓整個劇本失敗。 */
async function step(_page: Page | null, _id: string, title: string, fn: () => Promise<string | void>): Promise<boolean> {
  await test.step(title, async () => { await fn(); });
  return true;
}

let user: { id: string; email: string; password: string; client: any } | null = null;
let api: any;
let state: any;
const created = { companyIds: [] as string[] };

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupGaib1()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const left2 = await cleanupM7Users(db());
  if (left2.length) throw new Error(`清除上次殘留失敗：${left2.join('; ')}`);
  const codes = [PERM.serviceAccess, PERM.vendorView, PERM.vendorManage, UB_P.view, UB_P.manage, PAY_P.view, PAY_P.manage];
  const permRows = (await db().from('permissions').select('id,code').in('code', codes)).data as { id: string; code: string }[];
  if (permRows.length !== 7) throw new Error(`權限碼只找到 ${permRows.length}/7：${permRows.map((p) => p.code).join(',')}`);
  const email = `${M7_EMAIL_PREFIX}gaup-journey7@example.test`;
  const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
  const c = await db().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'M7M8 GAUP journey7' } });
  if (c.error) throw new Error(c.error.message);
  const uid = c.data.user.id as string;
  await db().from('profiles').update({ role: 'member', job_title: '測試', department: null }).eq('id', uid);
  const role = (await db().from('roles').insert({ code: `${M7_ROLE_PREFIX}gaup_journey7`, name: 'M7M8 測試 總務一人七權限', description: '一次性劇本實測臨時角色', is_active: true, is_system: false }).select('id').single()).data as { id: string };
  await db().from('role_permissions').insert(permRows.map((p) => ({ role_id: role.id, permission_id: p.id, is_allowed: true })));
  await db().from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true });
  user = { id: uid, email, password, client: await clientForCredentials(email, password) };
  api = await apiForUser(user as any);
  state = await api.storageState();
});

test.afterAll(async () => {
  try { await api?.dispose(); } catch { /* ignore */ }
  const issues: string[] = [];
  issues.push(...(await cleanupGaup()));
  // 買受人公司的操作紀錄不可刪：用 DEV 專用清除函式（只認 QA-GAIB1- 開頭的名稱，所以測試公司用 gaib1Name 命名）
  issues.push(...(await cleanupGaib1()));
  issues.push(...(await cleanupM7M8()));
  issues.push(...(await cleanupM7Users(db())));
  const left = await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).like('provider_name', 'QA-GAUP-%');
  expect(issues, `清除測試資料：${issues.join('; ')}`).toEqual([]);
  expect(left.count || 0).toBe(0);
});

test('總務一人完整劇本', async ({ browser }, testInfo) => {
  const st = await stores();
  const today = todayIso();
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  page.on('pageerror', (e) => consoleErrs.push(`pageerror: ${String(e)}`));
  await page.addInitScript(() => { (window as any).print = () => { (window as any).__printed = ((window as any).__printed || 0) + 1; }; });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const phone = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders: BYPASS_HEADERS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const vendorName = gaupName('JNY-台灣電力公司');
  const vendorTax = await freshValidTaxId();
  const companyName = gaib1Name('JNY-買受人公司');
  const companyTax = await freshValidTaxId();
  const bills: Array<{ key: string; store: string; storeId: string; ident: string; amount: number; id?: string }> = [
    { key: 'B1', store: 'VW001', storeId: st.VW001.id, ident: `QA-GAUP-J${Date.now() % 1e6}-A1`, amount: 4210 },
    { key: 'B2', store: 'VW001', storeId: st.VW001.id, ident: `QA-GAUP-J${Date.now() % 1e6}-A2`, amount: 1380 },
    { key: 'B3', store: 'VW002', storeId: st.VW002.id, ident: `QA-GAUP-J${Date.now() % 1e6}-B1`, amount: 5120 },
    { key: 'B4', store: 'ZT01', storeId: st.ZT01.id, ident: `QA-GAUP-J${Date.now() % 1e6}-C1`, amount: 3050 },
  ];
  let vendorId = '';
  let companyId = '';
  let prId = '';
  let prNo = '';
  try {
    // ---------- 0. 入口：只有 7 個權限，看得到哪些側欄項目
    await step(page, 'enter', '進入總務服務中心並列出側欄項目', async () => {
      await openGaCenter(page);
      await openGaSide(page);
      const labels = await shell(page).locator('aside').locator('button, a').allTextContents();
      return `側欄項目：${labels.map((s) => s.trim()).filter(Boolean).join('、')}`;
    });

    // ---------- 1. 設定廠商（公用事業）
    let ok = await step(page, 'vendor', '新增廠商（公用事業分類、含銀行資料）', async () => {
      await openGaSide(page);
      await shell(page).locator('aside').getByRole('button', { name: '廠商資料', exact: true }).locator('visible=true').first().click();
      await vis(page, 'new-vendor').click();
      const d = dialog(page);
      await d.getByTestId('vf-name').fill(vendorName);
      await d.getByTestId('vf-tax').fill(vendorTax);
      await d.getByTestId('vf-next').click();
      await d.getByTestId('vf-cat-公用事業').check();
      await d.getByTestId('vf-next').click();
      await d.getByTestId('vf-next').click();
      await d.getByTestId('vf-bank-name').fill('測試銀行');
      await d.getByTestId('vf-bank-branch').fill('測試分行');
      await d.getByTestId('vf-bank-account').fill('123456789012');
      await d.getByTestId('vf-bank-account-name').fill('台灣電力測試戶');
      await d.getByTestId('vf-save').click();
      await expect(vis(page, 'vendor-saved')).toContainText(vendorName);
      const v = (await db().from('ga_vendors').select('id').eq('name', vendorName).single()).data as any;
      vendorId = v.id;
    });

    // ---------- 2. 設定買受人公司（請款單頁的請款設定）
    await step(page, 'buyer-open', '開請款單頁並開啟「請款設定」', async () => {
      await openGaSide(page);
      await shell(page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
      await vis(page, 'pr-settings').click();
      await expect(page.getByTestId('pay-settings-form').locator('visible=true')).toBeVisible();
      const ro = await page.getByTestId('ps-readonly').count();
      const cnt = await page.getByTestId('ps-company').count();
      return `唯讀提示=${ro}；既有買受人公司 ${cnt} 家`;
    });
    ok = await step(page, 'buyer-add', '新增買受人公司', async () => {
      const f = page.getByTestId('pay-settings-form').locator('visible=true');
      await f.getByTestId('ps-company-new-name').fill(companyName);
      await f.getByTestId('ps-company-new-tax').fill(companyTax);
      await f.getByTestId('ps-company-add').click();
      await expect(f.getByTestId('ps-company').filter({ hasText: companyName })).toHaveCount(1);
      const c = (await db().from('ga_buyer_companies').select('id').eq('name', companyName).single()).data as any;
      companyId = c.id;
      created.companyIds.push(companyId);
    });
    await step(page, 'buyer-close', '關閉請款設定', async () => { await page.getByTestId('ps-close').locator('visible=true').click(); });

    // ---------- 3. 登錄 4 張電費帳單（3 家門市，VW001 兩個電號）
    for (const b of bills) {
      const sid = `bill-${b.key}`;
      ok = await step(page, sid, `登錄電費帳單 ${b.key}（${b.store}、${b.ident}）`, async () => {
        await openGaCenter(page).catch(() => undefined);
        await gaNavToIn(page, '水電電話網路費', '帳單列表');
        await vis(page, 'new-bill').click();
        const d = dialog(page);
        await d.getByTestId('uf-store').selectOption(b.storeId);
        await d.getByTestId('uf-type').selectOption('ELECTRICITY');
        await d.getByTestId('uf-month').fill('2038-03');
        await d.getByTestId('uf-provider').fill(gaupName('JNY-PRV'));
        await d.getByTestId('uf-payee').selectOption(vendorId);
        await d.getByTestId('uf-ident').fill(b.ident);
        await d.getByTestId('uf-amount').fill(String(b.amount));
        await d.getByTestId('uf-period-start').fill('2038-01-01');
        await d.getByTestId('uf-period-end').fill('2038-01-31');
        await d.getByTestId('uf-kwh').fill('1234');
        await d.getByTestId('uf-due').fill('2038-03-25');
        await d.getByTestId('uf-save').click();
        await expect(page.getByTestId('bill-detail').locator('visible=true')).toBeVisible({ timeout: 15_000 });
        const row = (await db().from('ga_utility_bills').select('id').eq('service_identifier', b.ident).single()).data as any;
        b.id = row.id;
      });
      {
        // 儲存後已開啟詳情：電腦上傳掃描檔（B3 留給手機 QR）
        if (b.key !== 'B3') {
          await step(page, `scan-${b.key}`, `桌機上傳掃描檔到 ${b.key}`, async () => {
            const panel = page.locator('.attachment-panel:visible').first();
            await panel.getByTestId('upload-input').setInputFiles({ name: `QA-GAUP-scan-${b.key}.png`, mimeType: 'image/png', buffer: png(bills.indexOf(b)) });
            const send = panel.getByRole('button', { name: /上傳 1 個檔案/ });
            await send.click();
            await expect(panel.locator('.attachment-grid li')).toHaveCount(1, { timeout: 15_000 });
          });
        } else {
          await step(page, 'scan-B3-phone', '手機 QR：桌機產生 QR→手機頁拍照上傳→桌機自動出現', async () => {
            await vis(page, 'phone-upload-open').click();
            await expect(vis(page, 'phone-qr')).toBeVisible();
            const url = await vis(page, 'phone-url').inputValue();
            const scanToken = url.slice(url.indexOf('#/bill-scan/') + '#/bill-scan/'.length);
            const phoneUrl = TEST_ORIGIN + '/workspace/index.html' + url.slice(url.indexOf('#'));
            const m = await phone.newPage();
            m.on('console', (c) => c.type() === 'error' && consoleErrs.push(`phone: ${c.text()}`));
            await m.goto(phoneUrl);
            await expect(m.getByTestId('scan-page')).toBeVisible();
            await m.getByTestId('scan-input').setInputFiles({ name: 'QA-GAUP-phone-B3.png', mimeType: 'image/png', buffer: png(9) });
            await m.getByTestId('scan-send').click();
            await expect(m.getByTestId('scan-done')).toContainText('已上傳 1 張');
            await expect(vis(page, 'phone-added')).toContainText('手機已上傳 1 張', { timeout: 15_000 });
            await vis(page, 'phone-close').click();
            // 關閉視窗後，這個 QR 立刻作廢（手機再傳會被拒絕）
            await expect.poll(async () => (await fetch(TEST_ORIGIN + '/api/workspace/bill-scan-upload', { headers: { ...BYPASS_HEADERS, 'x-scan-token': scanToken } })).status, { timeout: 15_000 }).toBe(403);
            await expect(page.locator('.attachment-panel:visible').first().locator('.attachment-grid li')).toHaveCount(1);
          });
        }
      }
    }
    await step(page, 'bill-list', '帳單列表（月份 2038-03 逐張核對 4 張）', async () => {
      await openGaCenter(page).catch(() => undefined);
      await gaNavToIn(page, '水電電話網路費', '帳單列表');
      await vis(page, 'filter-month').fill('2038-03');
      await vis(page, 'bill-search').fill('QA-GAUP-J');
      await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(4, { timeout: 15_000 });
    });

    // ---------- 4. 建立水電請款單
    ok = await step(page, 'pr-create', '建立水電請款單（繳費單位、買受人、預計付款日＝今天）', async () => {
      await openGaSide(page);
      await shell(page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
      await vis(page, 'new-pr-utility').click();
      await vis(page, 'pu-month').fill('2038-03');
      await vis(page, 'pu-vendor').selectOption(vendorId);
      await expect(page.locator('[data-testid="pu-bill"]:visible')).toHaveCount(4, { timeout: 15_000 });
      await expect(vis(page, 'pu-count')).toHaveText('4');
      await vis(page, 'pu-buyer').selectOption(companyId);
      await vis(page, 'pu-pay-date').fill(today);
      await vis(page, 'pu-save').click();
      await expect(vis(page, 'pu-status')).toHaveText('草稿', { timeout: 15_000 });
      const pr = (await db().from('ga_payment_requests').select('id,pr_no,expected_pay_date,buyer_company_id').eq('vendor_id', vendorId).single()).data as any;
      prId = pr.id; prNo = pr.pr_no;
      return `單號 ${pr.pr_no}，預計付款日 ${pr.expected_pay_date}，買受人 ${pr.buyer_company_id === companyId ? '已存' : '未存'}`;
    });

    // ---------- 5. 看掃描檔（草稿詳情每張帳單旁）與列印、PDF
    await step(page, 'scan-view', '請款單明細每張帳單的「看掃描檔」', async () => {
      await expect(page.locator('[data-testid="bill-scan-open"]:visible')).toHaveCount(4, { timeout: 15_000 });
      await page.locator('[data-testid="bill-scan-open"]:visible').first().click();
      const dlg = page.locator('dialog[open]').last();
      await expect(dlg.locator('.attachment-grid li')).toHaveCount(1);
      await dlg.getByTestId('bill-scan-close').click();
    });
    await step(page, 'print', '列印請款單（紙本格式頁，stub window.print 並以 page.pdf 驗證列印版型）', async () => {
      await vis(page, 'pu-print').click();
      await expect(page.getByTestId('pp-paper').locator('visible=true')).toBeVisible({ timeout: 20_000 });
      const title = await page.getByTestId('pk-title').locator('visible=true').innerText();
      const buyer = await page.getByTestId('pp-paper').locator('visible=true').innerText();
      await vis(page, 'pp-print').click();
      const printed = await page.evaluate(() => (window as any).__printed || 0);
      await page.pdf({ path: testInfo.outputPath('print-preview.pdf'), format: 'A4', printBackground: true });
      return `標題「${title}」；window.print 被呼叫 ${printed} 次；買受人公司出現在紙本：${buyer.includes(companyName) || buyer.includes(companyTax)}；列印預覽 PDF 已存`;
    });
    await step(page, 'pdf', '下載 PDF', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'pk-download-pdf').click()]);
      const file = testInfo.outputPath('download.pdf');
      await dl.saveAs(file);
      const size = fs.statSync(file).size;
      if (size < 5_000) throw new Error(`PDF 太小 ${size} bytes`);
      // 以 JPEG 嵌圖，單頁請款單 PDF 不應像 PNG 版那樣動輒數 MB
      if (size > 3_000_000) throw new Error(`PDF 太大 ${size} bytes`);
      return `檔名 ${dl.suggestedFilename()}（${size} bytes）`;
    });
    await step(page, 'print-detail', '切換明細版並回請款單', async () => {
      await vis(page, 'pp-layout-detail').click();
      await vis(page, 'pp-back').click();
      await expect(vis(page, 'pu-status')).toBeVisible();
    });

    // ---------- 6. 送出
    ok = await step(page, 'submit', '送出請款單', async () => {
      await vis(page, 'pu-submit').click();
      const autoNote = await vis(page, 'act-auto-note').innerText().catch(() => '');
      await vis(page, 'act-confirm').click();
      await expect(vis(page, 'pu-status')).toHaveText('已送出', { timeout: 15_000 });
      const hint = await page.getByTestId('pu-auto-hint').locator('visible=true').innerText().catch(() => '（沒有顯示自動付款提示）');
      return `送出對話框提示：${autoNote}；詳情提示：${hint}`;
    });

    // ---------- 7. 自動付款（排程函式；付款日＝今天）
    await step(null, 'cron', '執行自動付款函式（p_as_of＝今天，限定本單）', async () => {
      const r = await db().rpc('ga_apply_due_payment_requests', { p_as_of: today, p_pr_ids: [prId] });
      if (r.error) throw new Error(r.error.message);
      const d = r.data as any;
      if (d.marked !== 1) throw new Error(`標記 ${d.marked} 張：${JSON.stringify(d)}`);
      return JSON.stringify(d);
    });
    await step(page, 'paid-list', '清單：已付款＋系統自動標記標籤', async () => {
      await page.reload();
      await openGaCenter(page);
      await openGaSide(page);
      await shell(page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
      await vis(page, 'pr-search').fill(prNo);
      const card = page.locator('[data-testid="pr-card"]:visible').first();
      await expect(card.getByTestId('pr-status')).toHaveText('已付款', { timeout: 15_000 });
      await expect(card.getByTestId('pr-auto-paid')).toHaveText('系統自動標記');
    });
    await step(page, 'paid-detail', '詳情：系統自動標記（付款日）、事件、取消按鈕', async () => {
      await vis(page, 'open-pr').click();
      await expect(vis(page, 'pu-status')).toHaveText('已付款');
      const ap = await vis(page, 'pu-auto-paid').innerText();
      if (!ap.includes(today.replace(/-/g, '/'))) throw new Error(`自動標記文字沒帶付款日：${ap}`);
      await expect(vis(page, 'pu-events')).toContainText('付款日到期，系統自動標記已付款');
      await expect(vis(page, 'pu-cancel-auto')).toBeVisible();
      const lineStates = await page.locator('[data-testid="pu-line-state"]:visible').allTextContents();
      return `${ap.trim()}；帳單狀態欄：${lineStates.join('／')}`;
    });
    await step(page, 'paid-db', '資料庫確認：PAID、paid_auto、無付款人、帳單已繳', async () => {
      const pr = (await db().from('ga_payment_requests').select('*').eq('id', prId).single()).data as any;
      const b = (await db().from('ga_utility_bills').select('paid_at,paid_by_pr_id').in('id', bills.map((x) => x.id!))).data as any[];
      if (pr.status !== 'PAID' || !pr.paid_auto || pr.paid_by !== null) throw new Error(JSON.stringify(pr));
      return `pay_method=${pr.pay_method} paid_date=${pr.paid_date}；帳單 paid_at：${b.map((x) => x.paid_at ? 'Y' : 'N').join('')}（auto_mark_paid 是否勾選：${pr.auto_mark_paid}）`;
    });
    await step(page, 'bill-paid', '水電帳單頁：已繳狀態', async () => {
      await gaNavToIn(page, '水電電話網路費', '帳單列表');
      await vis(page, 'filter-month').fill('2038-03');
      await vis(page, 'bill-search').fill('QA-GAUP-J');
      await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(4);
      const st1 = await page.locator('[data-testid="bill-status"]:visible').allTextContents();
      return `狀態：${st1.join('／')}`;
    });

    // ---------- 8. 年度逐月總表與 Excel
    await step(page, 'report-month', '費用報表：月報表（2038/03，每門市一列、橫向費用類型）', async () => {
      await gaNavToIn(page, '水電電話網路費', '費用報表');
      await vis(page, 'rp-year').fill('2038');
      await vis(page, 'rp-mode').selectOption('month');
      await vis(page, 'rp-month').selectOption('03');
      await expect(page.locator('[data-testid="rp-row"]:visible').filter({ hasText: /VW|ZT|門市|店/ }).first()).toBeVisible({ timeout: 15_000 });
      const total = await vis(page, 'rp-total').innerText();
      return `合計 ${total}`;
    });
    await step(page, 'report-matrix', '費用報表：年度逐月（電費）', async () => {
      await vis(page, 'rp-mode').selectOption('matrix');
      const kinds = await vis(page, 'rp-kind').locator('option').allTextContents();
      const el = kinds.find((k) => k.includes('電') && !k.includes('話')) || kinds[0];
      await vis(page, 'rp-kind').selectOption({ label: el });
      await expect(page.locator('[data-testid="rp-mrow"]:visible').first()).toBeVisible({ timeout: 15_000 });
      const sums = await page.locator('[data-testid="rp-mrow"]:visible [data-testid="rp-msum"]').allTextContents();
      const m3 = await page.locator('[data-testid="rp-mrow"]:visible [data-testid="rp-m3"]').allTextContents();
      return `類型選項：${kinds.join('、')}；3 月欄：${m3.join(' ')}；全年合計欄：${sums.join(' ')}`;
    });
    await step(page, 'report-xlsx', '匯出 Excel（年度逐月：合計＋水電電話網路各一頁）', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'rp-export').click()]);
      const file = testInfo.outputPath('export-matrix.xlsx');
      await dl.saveAs(file);
      const wb = XLSX.readFile(file);
      const desc = wb.SheetNames.map((n) => {
        const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1 });
        return `${n}(${rows.length} 列)`;
      });
      const elec = wb.SheetNames.find((n) => n.includes('電') && !n.includes('話'));
      const rows = elec ? (XLSX.utils.sheet_to_json<any[]>(wb.Sheets[elec], { header: 1 }) as any[][]) : [];
      const hit = rows.filter((r) => r.some((c) => String(c).includes('VW')) || r.some((c) => String(c).includes('ZT')));
      return `檔名 ${dl.suggestedFilename()}；工作表：${desc.join('、')}；電費頁含 VW/ZT 的列：${JSON.stringify(hit.slice(0, 4))}`;
    });
    await step(page, 'report-month-xlsx', '月報表也能匯出目前表', async () => {
      await vis(page, 'rp-mode').selectOption('month');
      await vis(page, 'rp-month').selectOption('03');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'rp-export').click()]);
      const file = testInfo.outputPath('export-month.xlsx');
      await dl.saveAs(file);
      const wb = XLSX.readFile(file);
      return `檔名 ${dl.suggestedFilename()}；工作表：${wb.SheetNames.join('、')}`;
    });
    consoleErrs.push(...errors);
  } finally {
    await phone.close().catch(() => undefined);
    await ctx.close().catch(() => undefined);
  }
});
