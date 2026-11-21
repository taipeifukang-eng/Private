import { expect, test, type Browser, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs, loginAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Relationships, memberName, runIdOrThrow, salesFileName, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第一批 P07 關係會員：多角色接力劇本（桌機 1440、手機 390 各跑一次）。
 * 流程：edit 申請 -> view 只能看（沒有任何操作鈕）-> approve 核可與駁回（沒有編輯、刪除）-> edit 填會員編號（鎖定）與匯入銷售明細
 *       （首次、同檔重傳全略過、部分重疊）-> delete 刪除會員（銷售歷史保留）；無權限帳號沒有入口。
 * 畫面對等：姓名／電話拆兩欄、四個分頁計數、待填寫分頁的 FKRS 最後一號、銷售統計三個數字，皆與 API 資料以舊版演算法算出的結果相同。
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADER = ['門市代號', '銷售日期', '會員編號', '品號', '品名', '數量', '金額'];
const sheetBuffer = (rows: (string | number)[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), '銷售');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
test.beforeAll(async () => {
  ({ users, teardown } = await setupM6Users(['rel_approve']));
});
test.afterAll(async () => {
  await cleanupM6Relationships();
  const left = await teardown();
  expect(left).toEqual([]);
});

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  if (who !== 'rel_approve') return loginAs(browser, who);
  const api = await apiForUser(users.rel_approve);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
async function openPage(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="關係會員"]').click();
  await expect(page.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
  await page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
}
/** 訊息列會保留上一個動作的文字，所以以「對話框關閉＋重新載入完成」作為同步點。 */
const settled = (page: Page) => page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
const rowOf = (page: Page, text: string) => page.locator('.relationship-page tbody tr', { hasText: text });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** 舊版（RelationshipMembersClient.tsx）的計數與 FKRS 最後一號演算法，獨立於新版純函式。 */
function legacyCounts(members: any[]) {
  return {
    all: members.length,
    approved_missing_number: members.filter((m) => m.is_approved && !String(m.member_number || '').trim()).length,
    pending: members.filter((m) => !m.is_approved && !m.rejected_at).length,
    rejected: members.filter((m) => Boolean(m.rejected_at)).length,
  };
}
function legacyLatestFkrs(members: any[]) {
  let serial = -1;
  let latest = '';
  for (const m of members) {
    const code = String(m.member_number || '').trim();
    const match = code.match(/^FKRS(\d+)$/i);
    if (!match) continue;
    if (Number(match[1]) > serial) {
      serial = Number(match[1]);
      latest = code.toUpperCase();
    }
  }
  return latest || '尚無 FKRS 編號';
}

test('關係會員多角色接力：申請、檢視、核可駁回、填編號、匯入去重、刪除', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const tag = testInfo.project.name === 'mobile-390' ? 'M' : 'D';
  const stamp = `${runIdOrThrow().replace('-', '')}${tag}`;
  const nameP = memberName(`${tag}-pending`);
  const nameR = memberName(`${tag}-reject`);
  const nameA = memberName(`${tag}-approved`);
  const phone = `09${String(Date.now()).slice(-8)}`;
  const number = `M6UI${stamp}`;
  const db = adminDb();
  const edit: APIRequestContext = await apiAs('relationship_edit');
  const admin: APIRequestContext = await apiAs('admin');
  const pageErrors: string[] = [];
  const listJson = async () => (await (await admin.get('/api/workspace/relationships')).json()).members as any[];

  try {
    // ---- edit：用畫面填寫三筆申請（姓名、電話兩欄分開）
    const editCtx = await ctxFor(browser, 'relationship_edit');
    const ep = await editCtx.newPage();
    ep.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(ep);
    for (const [name, ph] of [[nameP, phone], [nameR, '0900000011'], [nameA, '0900000012']]) {
      await ep.getByRole('button', { name: '新增關係會員申請' }).click();
      const dlg = ep.getByRole('dialog', { name: '填寫關係會員申請' });
      await dlg.getByLabel('關係會員姓名').fill(name);
      await dlg.getByLabel('電話').fill(ph);
      await dlg.getByLabel('關係', { exact: true }).fill('自動測試');
      await dlg.getByRole('button', { name: '送出申請' }).click();
      await expect(dlg).toBeHidden();
      await expect(ep.getByRole('status')).toContainText('關係會員申請已建立');
      await settled(ep);
    }
    // A6：表頭順序與舊版相同，姓名／電話為兩個獨立欄位
    const heads = await ep.locator('.relationship-page section:visible thead th').allTextContents();
    expect(heads.map((h) => h.trim())).toEqual(['姓名', '電話', '關係', '填表人／日期', '會員編號', '審核狀態', '操作']);
    await ep.getByLabel('搜尋會員').fill(nameP);
    const cells = await rowOf(ep, nameP).locator('td').allTextContents();
    expect(cells[0].trim()).toBe(nameP);
    expect(cells[1].trim()).toBe(phone);
    // 搜尋涵蓋電話
    await ep.getByLabel('搜尋會員').fill(phone);
    await expect(rowOf(ep, nameP)).toHaveCount(1);
    await expect(rowOf(ep, nameR)).toHaveCount(0);
    await ep.getByLabel('搜尋會員').fill(nameP);
    // edit 沒有核可、駁回、刪除
    for (const b of ['核可', '駁回', '刪除']) await expect(rowOf(ep, nameP).getByRole('button', { name: b, exact: true })).toHaveCount(0);
    await expect(rowOf(ep, nameP).getByRole('button', { name: '編輯', exact: true })).toBeVisible();
    if (testInfo.project.name === 'mobile-390') expect(await noOverflow(ep)).toBe(true);
    await editCtx.close();

    // ---- view：只能看
    const viewCtx = await ctxFor(browser, 'relationship_view');
    const vp = await viewCtx.newPage();
    vp.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(vp);
    await vp.getByLabel('搜尋會員').fill(`ZT${runIdOrThrow()}-${tag}-`);
    await expect(rowOf(vp, nameP)).toHaveCount(1);
    for (const b of ['核可', '駁回', '編輯', '刪除']) await expect(vp.locator('.relationship-page').getByRole('button', { name: b, exact: true })).toHaveCount(0);
    await expect(vp.locator('.relationship-page thead th', { hasText: '操作' })).toHaveCount(0);
    await vp.getByRole('button', { name: '銷售明細報表', exact: true }).click();
    await expect(vp.getByRole('button', { name: '匯入銷售明細 Excel' })).toHaveCount(0);
    await expect(vp.getByRole('button', { name: '下載範本' })).toHaveCount(0);
    await viewCtx.close();

    // ---- approve：核可、駁回；沒有編輯、刪除
    const apprCtx = await ctxFor(browser, 'rel_approve');
    const ap = await apprCtx.newPage();
    ap.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(ap);
    await ap.getByLabel('搜尋會員').fill(`ZT${runIdOrThrow()}-${tag}-`);
    await expect(rowOf(ap, nameP)).toHaveCount(1);
    await expect(ap.getByRole('button', { name: '新增關係會員申請' })).toHaveCount(0);
    await expect(ap.getByRole('button', { name: '銷售明細報表', exact: true })).toHaveCount(0);
    for (const b of ['編輯', '刪除']) await expect(ap.locator('.relationship-page').getByRole('button', { name: b, exact: true })).toHaveCount(0);
    // 駁回要填原因
    await rowOf(ap, nameR).getByRole('button', { name: '駁回', exact: true }).click();
    const rej = ap.getByRole('dialog', { name: '駁回關係會員' });
    await rej.getByRole('button', { name: '確認駁回' }).click();
    // 原因欄是必填（瀏覽器擋下，不送出）：對話框仍開著、列仍是待核可
    await expect(rej).toBeVisible();
    expect(await rej.getByLabel('駁回原因').evaluate((el) => (el as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
    await rej.getByLabel('駁回原因').fill('自動測試退回');
    await rej.getByRole('button', { name: '確認駁回' }).click();
    await expect(rej).toBeHidden();
    await expect(ap.getByRole('status')).toContainText('關係會員已駁回');
    await settled(ap);
    await expect(rowOf(ap, nameR)).toContainText('已駁回');
    for (const name of [nameP, nameA]) {
      await rowOf(ap, name).getByRole('button', { name: '核可', exact: true }).click();
      await ap.getByRole('dialog', { name: '核可關係會員' }).getByRole('button', { name: '確認核可' }).click();
      await expect(ap.getByRole('dialog', { name: '核可關係會員' })).toBeHidden();
      await expect(ap.getByRole('status')).toContainText('關係會員已核可');
      await settled(ap);
      await expect(rowOf(ap, name)).toContainText('已核可');
    }
    await apprCtx.close();

    // ---- 畫面對等：四個分頁計數、待填寫分頁 FKRS 最後一號（與舊版演算法逐項相同）
    const adminCtx = await ctxFor(browser, 'admin');
    const adm = await adminCtx.newPage();
    adm.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(adm);
    const members = await listJson();
    const counts = legacyCounts(members);
    const tabs: [string, keyof typeof counts][] = [['全部', 'all'], ['待填寫(已核可)', 'approved_missing_number'], ['待核可', 'pending'], ['已駁回', 'rejected']];
    for (const [label, key] of tabs) {
      const btn = adm.locator('.relationship-page .toolbar .actions button', { hasText: label }).first();
      await expect(btn.locator('strong')).toHaveText(String(counts[key]));
    }
    await adm.locator('.relationship-page .toolbar .actions button', { hasText: '待填寫(已核可)' }).first().click();
    await expect(adm.locator('.relationship-page').getByText('目前 FKRS 會員編號最後一號')).toBeVisible();
    await expect(adm.locator('.relationship-page p', { hasText: '目前 FKRS 會員編號最後一號' }).locator('strong')).toHaveText(legacyLatestFkrs(members));
    await expect(adm.locator('.relationship-page .toolbar span', { hasText: '符合' })).toHaveText(`符合 ${counts.approved_missing_number} 筆`);
    const pages = Math.max(1, Math.ceil(counts.approved_missing_number / 50));
    await expect(adm.locator('.relationship-page section:visible .pager span')).toContainText(`第 1 / ${pages} 頁`);
    await adminCtx.close();

    // ---- edit：填會員編號（填完鎖定）、匯入銷售明細（首次、同檔重傳、部分重疊）
    const edit2 = await ctxFor(browser, 'relationship_edit');
    const e2 = await edit2.newPage();
    e2.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(e2);
    await e2.getByLabel('搜尋會員').fill(nameP);
    await rowOf(e2, nameP).getByRole('button', { name: '編輯', exact: true }).click();
    const dlg = e2.getByRole('dialog', { name: '編輯關係會員' });
    await dlg.getByLabel('會員編號', { exact: true }).fill(number);
    await dlg.getByRole('button', { name: '儲存修改' }).click();
    await expect(dlg).toBeHidden();
    await expect(e2.getByRole('status')).toContainText('關係會員資料已更新');
    await settled(e2);
    await expect(rowOf(e2, nameP)).toContainText(number);
    await rowOf(e2, nameP).getByRole('button', { name: '編輯', exact: true }).click();
    await expect(e2.getByRole('dialog', { name: '編輯關係會員' }).getByLabel('會員編號', { exact: true })).toBeDisabled();
    await e2.getByRole('dialog', { name: '編輯關係會員' }).getByRole('button', { name: '取消' }).click();

    await e2.getByRole('button', { name: '銷售明細報表', exact: true }).click();
    await expect(e2.getByRole('button', { name: '下載範本' })).toBeVisible();
    const importFile = async (name: string, rows: (string | number)[][]) => {
      await e2.getByRole('button', { name: '匯入銷售明細 Excel' }).click();
      const up = e2.getByRole('dialog', { name: '匯入銷售明細', exact: true });
      await expect(up).toContainText('自動略過');
      await up.getByLabel('銷售明細 Excel').setInputFiles({ name, mimeType: XLSX_MIME, buffer: sheetBuffer(rows) });
      await up.getByRole('button', { name: '確認匯入' }).click();
      await expect(up).toBeHidden();
    };
    const r1: (string | number)[] = ['VW001', '2038/03/01 14:30', number, 'P1', '測試商品甲', 1, 100];
    const r2: (string | number)[] = ['VW001', '2038/03/01 14:31', number, 'P2', '測試商品乙', 2, 250.5];
    const r3: (string | number)[] = ['VW001', '2038/03/01 14:32', number, 'P3', '測試商品丙', 3, 30];
    await importFile(salesFileName(`${tag}-1`), [r1, r2]);
    await expect(e2.getByRole('status')).toContainText('匯入 2 筆，略過重複 0 筆');
    await importFile(salesFileName(`${tag}-2`), [r1, r2]);
    await expect(e2.getByRole('status')).toContainText('此檔案內容皆已匯入過');
    await importFile(salesFileName(`${tag}-3`), [r1, r3]);
    await expect(e2.getByRole('status')).toContainText('匯入 1 筆，略過重複 1 筆');
    // 銷售統計三個數字與 API 相同（以會員編號查詢）
    await e2.getByLabel('會員編號', { exact: true }).fill(number);
    await e2.getByRole('button', { name: '查詢銷售明細' }).click();
    const sales = (await (await admin.get('/api/workspace/relationships/sales', { params: { member_number: number } })).json()).sales as any[];
    expect(sales).toHaveLength(3);
    const qty = sales.reduce((n, s) => n + Number(s.quantity), 0);
    const amt = sales.reduce((n, s) => n + Number(s.amount), 0);
    await expect(e2.locator('.sales-total')).toContainText(`${sales.length} 筆`);
    await expect(e2.locator('.sales-total')).toContainText(`數量合計 ${qty.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`);
    await expect(e2.locator('.sales-total')).toContainText(`金額合計 ${amt.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`);
    // A6：「匯入來源／時間」欄保留
    await expect(e2.locator('.relationship-page thead th', { hasText: '匯入來源／時間' })).toBeVisible();
    const b3 = await db.from('relationship_sales_imports').select('id', { count: 'exact', head: true }).like('file_name', `m6p07-${runIdOrThrow()}-${tag}-%`);
    expect(b3.count, '三次匯入只有兩次建立批次（全部重複那次不建空批次）').toBe(2);
    if (testInfo.project.name === 'mobile-390') expect(await noOverflow(e2)).toBe(true);
    await edit2.close();

    // ---- delete：刪除會員，銷售歷史保留
    const delCtx = await ctxFor(browser, 'relationship_delete');
    const dp = await delCtx.newPage();
    dp.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
    await openPage(dp);
    await dp.getByLabel('搜尋會員').fill(nameP);
    for (const b of ['核可', '駁回', '編輯']) await expect(rowOf(dp, nameP).getByRole('button', { name: b, exact: true })).toHaveCount(0);
    await rowOf(dp, nameP).getByRole('button', { name: '刪除', exact: true }).click();
    await dp.getByRole('dialog', { name: '刪除關係會員' }).getByRole('button', { name: '確認刪除' }).click();
    await expect(dp.getByRole('dialog', { name: '刪除關係會員' })).toBeHidden();
    await expect(dp.getByRole('status')).toContainText('銷售歷史仍保留');
    await settled(dp);
    await expect(rowOf(dp, nameP)).toHaveCount(0);
    await delCtx.close();
    expect(((await (await admin.get('/api/workspace/relationships/sales', { params: { member_number: number } })).json()).sales as unknown[]).length).toBe(3);

    // ---- 無權限帳號：沒有導覽入口，直接用網址開啟也看不到頁面
    const denied = await ctxFor(browser, 'denied');
    const np = await denied.newPage();
    await np.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await np.click('.menu-toggle');
    await expect(np.locator('.workspace-menu button.catalog-item[title="關係會員"]')).toHaveCount(0);
    await np.goto('/workspace/index.html#/open/relationships', { waitUntil: 'networkidle' });
    await expect(np.getByRole('heading', { name: '關係會員', exact: true })).toHaveCount(0);
    expect((await (await denied.request.get('/api/workspace/relationships')).status())).toBe(403);
    await denied.close();

    expect(pageErrors).toEqual([]);
  } finally {
    await edit.dispose();
    await admin.dispose();
  }
});
