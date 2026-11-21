import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs, loginAs } from '../support/auth';
import { cleanupM6Relationships, memberName, runIdOrThrow, salesFileName } from '../support/m6-fixtures';
import { assertNoUnlistedDiffs, compareApiRead, ParityRecorder, type Diff } from '../support/parity';

/**
 * M6 第一批 P07 關係會員對等（有資料的情況）：
 *  - 新舊 API（會員清單、銷售查詢）deep equal；
 *  - 舊頁與新頁的四個分頁計數、待填寫分頁 FKRS 最後一號、銷售統計三個數字（筆數、數量合計、金額合計）逐項相同；
 *  - 重複匯入：舊版不去重、新版略過已存在明細（已核可差異）。
 * 資料：成員 ZT<runId>-…（只刪自己的）、匯入檔名 m6p07-<runId>-…、銷售日期年度 2038、門市 VW001。
 */
const recorder = new ParityRecorder('relationships');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const book = (rows: (string | number)[][]) => {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([['門市代號', '銷售日期', '會員編號', '品號', '品名', '數量', '金額'], ...rows]), '銷售');
  return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

test.afterAll(async () => {
  await cleanupM6Relationships();
});

test('API 有資料時 deep equal：會員清單與銷售查詢（view／edit／admin）；匯入重複明細的新舊差異', async () => {
  test.setTimeout(240_000);
  const stamp = runIdOrThrow().replace('-', '');
  const number = `M6PAR${stamp}`;
  const edit = await apiAs('relationship_edit');
  try {
    const created = await edit.post('/api/workspace/relationships', { data: { member_name: memberName('parity'), phone: '0900000020', relationship: '自動測試' } });
    const id: string = (await created.json()).id;
    expect((await edit.patch(`/api/workspace/relationships/${id}`, { data: { member_name: memberName('parity'), phone: '0900000020', relationship: '自動測試', member_number: number } })).status()).toBe(200);
    const file = book([['VW001', '2038/03/01 14:30', number, 'P1', '測試商品甲', 1, 100], ['VW001', '2038/03/01 14:31', number, 'P2', '測試商品乙', 2, 250.5]]);
    const send = (url: string, name: string) => edit.post(url, { multipart: { file: { name, mimeType: XLSX_MIME, buffer: file } } });
    expect((await send('/api/workspace/relationships/sales/import', salesFileName('par'))).status()).toBe(200);

    for (const role of ['admin', 'relationship_view', 'relationship_edit']) {
      const api = await apiAs(role);
      try {
        for (const [entry, legacy, native, pick] of [
          ['members-list-with-data', '/api/relationship-members', '/api/workspace/relationships', 'members'],
          ['sales-list-with-data', '/api/relationship-sales', '/api/workspace/relationships/sales', 'sales'],
        ] as const) {
          const query = entry.startsWith('sales') ? { member_number: number } : undefined;
          const result = await compareApiRead({
            recorder,
            entry,
            title: `${entry}（會員編號 ${number}）新舊逐筆比對`,
            role,
            legacyApi: api,
            legacy: { path: legacy, query, pick },
            native: { path: native, query, pick },
            rules: {},
            compareKey: 'id',
          });
          assertNoUnlistedDiffs(result);
          expect(['pass', 'allowed'], `${entry} ${role}`).toContain(result.status);
          if (entry.startsWith('sales')) expect(result.compared.legacyRows).toBe(2);
        }
      } finally {
        await api.dispose();
      }
    }

    // 重複匯入：同檔再匯入一次。舊 route 不去重（新增 2 筆，共 4 筆）；新 workspace 匯入略過（新增 0 筆）。
    const legacyAgain = await send('/api/relationship-sales/import', salesFileName('par-legacy'));
    expect(await legacyAgain.json()).toEqual({ success: true, imported: 2 });
    const rowsAfterLegacy = ((await (await edit.get('/api/relationship-sales', { params: { member_number: number } })).json()).sales as unknown[]).length;
    expect(rowsAfterLegacy).toBe(4);
    const nativeAgain = await (await send('/api/workspace/relationships/sales/import', salesFileName('par-native'))).json();
    expect(nativeAgain).toEqual({ success: true, imported: 0, skipped: 2 });
    const diffs: Diff[] = [{ kind: 'changed', key: 'duplicate-import', legacy: `同檔再匯入：新增 ${2} 筆（共 ${rowsAfterLegacy} 筆）`, native: `新增 ${nativeAgain.imported} 筆、略過 ${nativeAgain.skipped} 筆`, detail: 'A7：內容完全相同的明細自動略過' }];
    const r = recorder.record({ entry: 'sales-duplicate-import', mechanism: 'write-readback', role: 'relationship_edit', title: '銷售明細重複匯入：舊版不去重，新版略過已存在明細', legacy: { endpoint: 'POST /api/relationship-sales/import', status: 200 }, native: { endpoint: 'POST /api/workspace/relationships/sales/import', status: 200 }, compared: { legacyImported: 2, nativeImported: 0, nativeSkipped: 2 }, diffs });
    assertNoUnlistedDiffs(r);
    expect(['allowed', 'pending-approval']).toContain(r.status);
    // 清掉成員（銷售批次由 afterAll 依檔名清除）
    await (await apiAs('admin')).delete(`/api/workspace/relationships/${id}`);
  } finally {
    await edit.dispose();
  }
});

async function legacyOpen(page: Page, tab?: '銷售明細報表') {
  await page.goto('/store/relationship-members', { waitUntil: 'networkidle' });
  await page.waitForSelector('table thead th');
  await page.waitForFunction(() => !document.querySelector('table tbody .animate-spin'), undefined, { timeout: 30_000 });
  if (tab) await page.getByRole('button', { name: tab }).click();
}

test('畫面對等：四個分頁計數、待填寫分頁 FKRS 最後一號、銷售統計三個數字（舊頁 vs 新頁）', async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = runIdOrThrow().replace('-', '');
  const number = `M6PUI${stamp}`;
  const edit = await apiAs('relationship_edit');
  const admin = await apiAs('admin');
  const ctx = await loginAs(browser, 'admin');
  try {
    const name = memberName('parity-ui');
    const id: string = (await (await edit.post('/api/workspace/relationships', { data: { member_name: name, phone: '0900000021', relationship: '自動測試' } })).json()).id;
    await edit.patch(`/api/workspace/relationships/${id}`, { data: { member_name: name, phone: '0900000021', relationship: '自動測試', member_number: number } });
    const file = book([['VW001', '2038/03/01 14:30', number, 'P1', '測試商品甲', 1, 100], ['VW001', '2038/03/01 14:31', number, 'P2', '測試商品乙', 2, 250.5], ['VW001', '2038/03/02 09:00', number, 'P3', '測試商品丙', 3, 1234.25]]);
    expect((await edit.post('/api/workspace/relationships/sales/import', { multipart: { file: { name: salesFileName('ui'), mimeType: XLSX_MIME, buffer: file } } })).status()).toBe(200);

    // ---- 舊頁
    const lp = await ctx.newPage();
    await legacyOpen(lp);
    const legacyCounts: Record<string, number> = {};
    for (const label of ['全部', '待填寫(已核可)', '待核可', '已駁回']) legacyCounts[label] = num((await lp.locator('button', { hasText: label }).first().textContent()) || '');
    await lp.locator('button', { hasText: '待填寫(已核可)' }).first().click();
    const legacyFkrs = ((await lp.getByText('目前 FKRS 會員編號最後一號').locator('xpath=following-sibling::span').textContent()) || '').trim();
    await legacyOpen(lp, '銷售明細報表');
    await lp.getByPlaceholder('輸入會員編號查詢').fill(number);
    await lp.getByRole('button', { name: '查詢', exact: true }).click();
    const card = async (label: string) => num((await lp.getByText(label, { exact: true }).locator('xpath=following-sibling::div').textContent()) || '');
    await expect.poll(() => card('明細筆數')).toBe(3);
    const legacyStats = { count: await card('明細筆數'), quantity: await card('數量合計'), amount: await card('金額合計') };
    await lp.close();

    // ---- 新頁
    const np = await ctx.newPage();
    await np.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await np.click('.menu-toggle');
    await np.locator('.workspace-menu button.catalog-item[title="關係會員"]').click();
    await expect(np.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
    await np.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
    const nativeCounts: Record<string, number> = {};
    for (const label of ['全部', '待填寫(已核可)', '待核可', '已駁回']) nativeCounts[label] = num((await np.locator('.relationship-page .toolbar .actions button', { hasText: label }).first().locator('strong').textContent()) || '');
    await np.locator('.relationship-page .toolbar .actions button', { hasText: '待填寫(已核可)' }).first().click();
    const nativeFkrs = ((await np.locator('.relationship-page p', { hasText: '目前 FKRS 會員編號最後一號' }).locator('strong').textContent()) || '').trim();
    await np.getByRole('button', { name: '銷售明細報表', exact: true }).click();
    await np.getByLabel('會員編號', { exact: true }).fill(number);
    await np.getByRole('button', { name: '查詢銷售明細' }).click();
    await expect(np.locator('.sales-total')).toContainText('3 筆');
    const totalText = (await np.locator('.sales-total').textContent()) || '';
    const nativeStats = { count: num(totalText.match(/·\s*([\d,]+)\s*筆/)![1]), quantity: num(totalText.match(/數量合計\s*([\d,.]+)/)![1]), amount: num(totalText.match(/金額合計\s*([\d,.]+)/)![1]) };
    await np.close();

    const diffs: Diff[] = [];
    for (const k of Object.keys(legacyCounts)) if (legacyCounts[k] !== nativeCounts[k]) diffs.push({ kind: 'changed', key: `count:${k}`, legacy: legacyCounts[k], native: nativeCounts[k] });
    if (legacyFkrs !== nativeFkrs) diffs.push({ kind: 'changed', key: 'fkrs-last', legacy: legacyFkrs, native: nativeFkrs });
    for (const k of ['count', 'quantity', 'amount'] as const) if (legacyStats[k] !== nativeStats[k]) diffs.push({ kind: 'changed', key: `sales-stat:${k}`, legacy: legacyStats[k], native: nativeStats[k] });
    const r = recorder.record({ entry: 'members-counts-fkrs-sales-stats', mechanism: 'ui-extract', role: 'admin', title: '分頁計數、FKRS 最後一號、銷售統計三個數字：舊頁 vs 新頁', legacy: { endpoint: '/store/relationship-members' }, native: { endpoint: '/workspace 關係會員' }, compared: { counts: 4, fkrs: legacyFkrs, salesCount: legacyStats.count }, diffs });
    assertNoUnlistedDiffs(r);
    expect(r.status).toBe('pass');
    expect(legacyStats).toEqual({ count: 3, quantity: 6, amount: 1584.75 });
    await admin.delete(`/api/workspace/relationships/${id}`);
  } finally {
    await ctx.close();
    await edit.dispose();
    await admin.dispose();
  }
});
