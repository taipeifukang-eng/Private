import { expect, test, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { P01_MONTHS, posBuffer, registerPharmacists, registerPurchases, purgeSeededRoster, seedPurchases, staffCode, standardPos, xlsxFile, type SeededPurchases } from '../support/p01-fixtures';
import { testStoreIds } from '../support/w01a-fixtures';

// P01 整合層：員工購物 /api/workspace/employee-purchases、藥師管理 /api/workspace/pharmacists/*。
// 資料：員購 POS 銷售月份 2099-08（ZT01／ZT02）；藥師手動補入與月份關帳也只用 2099-08 與 ZT01。
// 藥師「督導區總覽」只用真實的過去月份、以無門市範圍的帳號讀取，不對 2099 月份讀取（避免替非測試門市同步出 2099 快照）。

const PURCHASES = '/api/workspace/employee-purchases';
const PHARM = '/api/workspace/pharmacists';
const MONTH = P01_MONTHS.integration;
let admin: APIRequestContext;
let seeded: SeededPurchases;
let zt01 = '';
const apis: APIRequestContext[] = [];

async function as(role: string) {
  const api = await apiAs(role);
  apis.push(api);
  return api;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  seeded = await seedPurchases(admin, MONTH);
  zt01 = (await testStoreIds(admin, MONTH)).ZT01;
});
test.afterAll(async () => {
  try {
    // 保險：藥師月份關帳一定要解除（會影響其他月份能不能解除關帳），並登錄所有列。
    const editor = await apiAs('pharmacist_edit');
    try {
      await editor.delete(`${PHARM}/month-lock`, { data: { year_month: MONTH } });
    } finally {
      await editor.dispose();
    }
    await registerPharmacists(MONTH, zt01);
    await registerPurchases(MONTH, [zt01]);
    await purgeSeededRoster(admin, seeded);
  } finally {
    await admin?.dispose();
    await Promise.all(apis.map((a) => a.dispose()));
  }
});

// ---------------------------------------------------------------------------
// 員工購物
// ---------------------------------------------------------------------------

test.describe('員工購物：權限與參數', () => {
  test('未登入：GET 與 POST 都是 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
    try {
      expect((await anon.get(PURCHASES, { params: { year_month: MONTH } })).status()).toBe(401);
      expect((await anon.post(`${PURCHASES}/import`, { multipart: { file: xlsxFile(Buffer.from('x')) } })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('無權限帳號 403；檢視者 GET 200 且 capabilities.import 為 false、匯入 403；匯入者 import 為 true', async () => {
    const denied = await as('denied');
    expect((await denied.get(PURCHASES, { params: { year_month: MONTH } })).status()).toBe(403);
    const view = await as('employee_purchase_view');
    const viewRes = await view.get(PURCHASES, { params: { year_month: MONTH } });
    expect(viewRes.status()).toBe(200);
    expect((await viewRes.json()).capabilities).toEqual({ import: false });
    const blocked = await view.post(`${PURCHASES}/import`, { multipart: { file: xlsxFile(posBuffer([])) } });
    expect(blocked.status()).toBe(403);
    const edit = await as('employee_purchase_edit');
    const editRes = await edit.get(PURCHASES, { params: { year_month: MONTH } });
    expect(editRes.status()).toBe(200);
    expect((await editRes.json()).capabilities).toEqual({ import: true });
    // 員工、藥師等其他角色也不行
    for (const role of ['employee', 'pharmacist']) {
      const api = await as(role);
      expect((await api.get(PURCHASES, { params: { year_month: MONTH } })).status(), role).toBe(403);
    }
  });

  test('月份格式與路徑：2099-1、2099-13、缺少月份都是 400「月份格式錯誤」；未知路徑 404；POST 未知路徑 404', async () => {
    const view = await as('employee_purchase_view');
    for (const bad of ['2099-1', '2099-13', '2099-00', 'abcd-ef', '']) {
      const res = await view.get(PURCHASES, { params: bad ? { year_month: bad } : {} });
      expect(res.status(), bad).toBe(400);
      expect((await res.json()).error).toBe('月份格式錯誤');
    }
    expect((await view.get(`${PURCHASES}/foo`, { params: { year_month: MONTH } })).status()).toBe(404);
    const edit = await as('employee_purchase_edit');
    expect((await edit.post(`${PURCHASES}/import/x`, { multipart: { file: xlsxFile(posBuffer([])) } })).status()).toBe(404);
    expect((await edit.post(`${PURCHASES}/other`, { multipart: { file: xlsxFile(posBuffer([])) } })).status()).toBe(404);
  });

  test('POST 帶錯誤的 Origin：403（checkOrigin），不會寫入', async ({ playwright }) => {
    const edit = await as('employee_purchase_edit');
    const state = await edit.storageState();
    const evil = await playwright.request.newContext({ baseURL: TEST_ORIGIN, storageState: state, extraHTTPHeaders: { Origin: 'http://evil.example' } });
    try {
      const res = await evil.post(`${PURCHASES}/import`, { multipart: { file: xlsxFile(posBuffer([])) } });
      expect(res.status()).toBe(403);
    } finally {
      await evil.dispose();
    }
  });
});

test.describe('員工購物：匯入與比對', () => {
  test('匯入結果：4 筆有效（比對 3、未比對 1）、跳過 1 筆未知門市、合計列被略過、總金額 450', async () => {
    expect(seeded.result).toMatchObject({
      success: true,
      imported: seeded.expected.imported,
      skipped: seeded.expected.skipped,
      matched: seeded.expected.matched,
      unmatched: seeded.expected.unmatched,
      total_amount: seeded.expected.total,
      year_month: MONTH,
    });
    expect((seeded.result.errors as string[]).some((e) => e.includes('ZZ999'))).toBe(true);
  });

  test('DB 列：只有測試門市；員編比對者用月份快照職稱，未比對者沒有員編與職稱', async () => {
    const rows = await readRowsAsServiceRole('employee_purchase_sales', { eq: { year_month: MONTH }, select: 'store_id,store_code,member_code,match_status,employee_code,employee_position,total_amount,sale_date' });
    expect(rows).toHaveLength(seeded.expected.imported);
    expect(rows.every((r) => r.store_id), '所有列都有門市 id（sweeper 才清得掉）').toBe(true);
    expect(new Set(rows.map((r) => r.store_code))).toEqual(new Set(['ZT01', 'ZT02']));
    expect(rows.every((r) => String(r.sale_date).startsWith(MONTH))).toBe(true);
    const byCode = (code: string) => rows.filter((r) => r.member_code === code.toUpperCase());
    expect(byCode(seeded.codes.a)).toHaveLength(2);
    expect(byCode(seeded.codes.a).every((r) => r.match_status === 'employee_code' && r.employee_position === '專員')).toBe(true);
    expect(byCode(seeded.codes.b)[0]).toMatchObject({ match_status: 'employee_code', employee_position: '店長' });
    const unmatched = rows.filter((r) => r.match_status === 'unmatched');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].employee_code).toBeNull();
    expect(unmatched[0].employee_position).toBeNull();
    const batches = await readRowsAsServiceRole('employee_purchase_import_batches', { eq: { year_month: MONTH }, select: 'row_count,matched_count,unmatched_count,total_amount' });
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]).toMatchObject({ row_count: 4, matched_count: 3, unmatched_count: 1 });
    expect(Number(batches[0].total_amount)).toBe(450);
  });

  test('列表 API：統計、職稱彙總、員工彙總與 DB 一致；職稱篩選只留該職稱', async () => {
    const view = await as('employee_purchase_view');
    const body = await (await view.get(PURCHASES, { params: { year_month: MONTH } })).json();
    expect(body).toMatchObject({ success: true, total_count: 4, total_amount: 450, matched_count: 3, unmatched_count: 1 });
    expect(body.latest_batch).toMatchObject({ row_count: 4, matched_count: 3, unmatched_count: 1 });
    const sum = (body.summary_by_position as { total_amount: number }[]).reduce((s, r) => s + Number(r.total_amount), 0);
    expect(sum).toBe(450);
    expect(body.positions).toEqual(expect.arrayContaining(['專員', '店長']));
    const rows = body.rows as { employee_code: string; employee_name: string; purchase_count: number; total_amount: number; recognized_store_code: string }[];
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => r.employee_code === seeded.codes.a)!;
    expect(a).toMatchObject({ purchase_count: 2, total_amount: 200, employee_name: 'ZT員購甲' });
    expect(rows.find((r) => r.employee_code === seeded.codes.b)).toMatchObject({ purchase_count: 1, total_amount: 200 });
    const filtered = await (await view.get(PURCHASES, { params: { year_month: MONTH, position: '專員' } })).json();
    expect(filtered).toMatchObject({ total_count: 2, total_amount: 200 });
    expect((filtered.rows as { employee_code: string }[]).map((r) => r.employee_code)).toEqual([seeded.codes.a]);
  });

  test('員工明細：依員編加總（筆數、數量、毛利、金額）；缺少識別資料 400；不存在的員編為空', async () => {
    const view = await as('employee_purchase_view');
    const res = await view.get(`${PURCHASES}/employee-details`, { params: { year_month: MONTH, employee_code: seeded.codes.a } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, purchase_count: 2, total_amount: 200, total_gross_profit: 40, total_quantity: 3 });
    expect((body.details as unknown[]).length).toBe(2);
    const missing = await view.get(`${PURCHASES}/employee-details`, { params: { year_month: MONTH } });
    expect(missing.status()).toBe(400);
    const none = await (await view.get(`${PURCHASES}/employee-details`, { params: { year_month: MONTH, employee_code: 'ZTNOBODY' } })).json();
    expect(none).toMatchObject({ details: [], total_amount: 0, purchase_count: 0 });
    expect((await (await as('denied')).get(`${PURCHASES}/employee-details`, { params: { year_month: MONTH, employee_code: seeded.codes.a } })).status()).toBe(403);
  });

  test('匯入檔驗證：缺欄位、缺 GridBand1、跨月份、非 Excel、沒有檔案、全是未知門市都被擋下，且不改動既有資料', async () => {
    const edit = await as('employee_purchase_edit');
    const pos = standardPos(MONTH, seeded.codes);
    const post = (file?: ReturnType<typeof xlsxFile>) => edit.post(`${PURCHASES}/import`, { multipart: file ? { file } : { note: 'x' } });
    const missingAmount = await post(xlsxFile(posBuffer(pos.rows, [], { omitHeader: '總金額' }), 'missing.xlsx'));
    // 舊 handler 對缺欄位丟出一般錯誤，被外層 catch 轉成 500 並附上可讀訊息（新舊相同，因為共用同一個 handler）。
    expect(missingAmount.status()).toBe(500);
    expect((await missingAmount.json()).error).toBe('Excel 缺少必要欄位：總金額');
    const noBand = await post(xlsxFile(posBuffer(pos.rows, [], { noBand: true }), 'noband.xlsx'));
    expect(noBand.status()).toBe(500);
    expect((await noBand.json()).error).toMatch(/Excel 資料不足|缺少必要欄位/);
    const cross = standardPos(MONTH, seeded.codes).rows.slice(0, 2);
    cross[1] = { ...cross[1], date: `2099-09-01 10:00` };
    const crossRes = await post(xlsxFile(posBuffer(cross), 'cross.xlsx'));
    expect(crossRes.status()).toBe(400);
    expect((await crossRes.json()).error).toContain('包含多個月份');
    const notExcel = await post({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') });
    expect(notExcel.status()).toBe(400);
    expect((await notExcel.json()).error).toBe('僅支援 .xlsx 或 .xls 檔案');
    const noFile = await post();
    expect(noFile.status()).toBe(400);
    expect((await noFile.json()).error).toBe('請選擇 Excel 檔案');
    const unknownStores = pos.rows.map((r) => ({ ...r, store: 'ZZ999' }));
    const unknown = await post(xlsxFile(posBuffer(unknownStores), 'unknown.xlsx'));
    expect(unknown.status()).toBe(400);
    expect((await unknown.json()).error).toContain('沒有可匯入資料');
    const still = await readRowsAsServiceRole('employee_purchase_sales', { eq: { year_month: MONTH }, select: 'id' });
    expect(still).toHaveLength(seeded.expected.imported);
  });

  test('覆蓋：同一銷售月份再匯入 B 檔，DB 只剩 B 的資料、批次多一筆、統計卡跟著變', async () => {
    const edit = await as('employee_purchase_edit');
    const before = await readRowsAsServiceRole('employee_purchase_import_batches', { eq: { year_month: MONTH }, select: 'id' });
    const only = standardPos(MONTH, seeded.codes).rows.slice(2, 3); // ZT02 乙，200 元
    const res = await edit.post(`${PURCHASES}/import`, { multipart: { file: xlsxFile(posBuffer(only), 'p01-b.xlsx') } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, matched: 1, unmatched: 0, skipped: 0, total_amount: 200 });
    const rows = await readRowsAsServiceRole('employee_purchase_sales', { eq: { year_month: MONTH }, select: 'id,sale_sequence,member_code' });
    expect(rows).toHaveLength(1);
    expect(rows[0].sale_sequence).toBe('ZTP-003');
    const after = await readRowsAsServiceRole('employee_purchase_import_batches', { eq: { year_month: MONTH }, select: 'id' });
    expect(after.length).toBe(before.length + 1);
    const view = await as('employee_purchase_view');
    expect(await (await view.get(PURCHASES, { params: { year_month: MONTH } })).json()).toMatchObject({ total_count: 1, total_amount: 200, matched_count: 1, unmatched_count: 0 });
    await registerPurchases(MONTH, [zt01]);
  });

  test('並行匯入同一月份：記錄實際行為（批次數、最終列數），不應造成伺服器崩潰', async () => {
    const edit = await as('employee_purchase_edit');
    const rows = standardPos(MONTH, seeded.codes).rows;
    const fileA = xlsxFile(posBuffer(rows.slice(0, 2)), 'concurrent-a.xlsx');
    const fileB = xlsxFile(posBuffer(rows.slice(2, 4)), 'concurrent-b.xlsx');
    const [ra, rb] = await Promise.all([
      edit.post(`${PURCHASES}/import`, { multipart: { file: fileA } }),
      edit.post(`${PURCHASES}/import`, { multipart: { file: fileB } }),
    ]);
    expect([200, 500]).toContain(ra.status());
    expect([200, 500]).toContain(rb.status());
    const finalRows = await readRowsAsServiceRole('employee_purchase_sales', { eq: { year_month: MONTH }, select: 'id,batch_id' });
    const batchIds = new Set(finalRows.map((r) => r.batch_id));
    test.info().annotations.push({ type: 'concurrent-import', description: `statuses=${ra.status()}/${rb.status()} rows=${finalRows.length} distinctBatches=${batchIds.size}` });
    expect(finalRows.length).toBeGreaterThan(0);
    await registerPurchases(MONTH, [zt01]);
  });
});

// ---------------------------------------------------------------------------
// 藥師管理
// ---------------------------------------------------------------------------

test.describe('藥師管理：權限矩陣', () => {
  test('未登入 401；無權限與員工 403', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
    try {
      expect((await anon.post(`${PHARM}/overview`, { params: { year_month: '2026-10' } })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
    for (const role of ['denied', 'employee', 'employee_purchase_view']) {
      const api = await as(role);
      expect((await api.post(`${PHARM}/overview`, { params: { year_month: '2026-10' } })).status(), role).toBe(403);
      expect((await api.get(`${PHARM}/fees`, { params: { employee_code: 'ZT1' } })).status(), role).toBe(403);
      expect((await api.get(`${PHARM}/month-lock`)).status(), role).toBe(403);
    }
  });

  test('只有 view（無門市範圍）：總覽 200 但沒有門市；月份格式錯誤 400；沒有主檔權限的 action 都 403', async () => {
    const api = await as('pharmacist');
    const ok = await api.post(`${PHARM}/overview`, { params: { year_month: '2026-10' } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.cards).toEqual([]);
    expect(body.capabilities).toMatchObject({ edit: false, master: false, masterEdit: false });
    for (const bad of ['2026-13', '2026-1', '']) {
      const res = await api.post(`${PHARM}/overview`, { params: bad ? { year_month: bad } : {} });
      expect(res.status(), bad).toBe(400);
      expect((await res.json()).error).toBe('月份格式不正確');
    }
    const master = await api.post(`${PHARM}/master`, { params: { year: '2026' } });
    expect(master.status()).toBe(403);
    expect((await master.json()).error).toBe('沒有藥師主檔查看權限');
    for (const action of ['profiles', 'annual-lock', 'annual-manual']) {
      const res = await api.get(`${PHARM}/${action}`, { params: { year: '2026' } });
      expect(res.status(), action).toBe(403);
    }
  });

  test('主檔檢視者（master.view、無 edit）：GET master 405「請使用同步查詢」；主檔寫入 403（舊版 handler 的 Forbidden，需要 management.edit）', async () => {
    const api = await as('pharmacist_view');
    const get = await api.get(`${PHARM}/master`, { params: { year: '2026' } });
    expect(get.status()).toBe(405);
    expect((await get.json()).error).toBe('請使用同步查詢');
    for (const [method, action, data] of [
      ['patch', 'profiles', { employee_code: 'ZT1', school: 'x' }],
      ['post', 'annual-manual', { year: 2099, employee_code: 'ZT1', employee_name: 'x' }],
      ['post', 'annual-lock', { year: 2099 }],
      ['delete', 'annual-manual', { year: 2099, employee_code: 'ZT1' }],
    ] as const) {
      const res = await api[method](`${PHARM}/${action}`, { data });
      expect(res.status(), `${method} ${action}`).toBe(403);
    }
    expect((await api.get(`${PHARM}/foo`)).status()).toBe(404);
  });

  test('重點風險：只有 view（無 edit）呼叫所有寫入 action 都被擋下（若回 2xx 就是安全缺口）', async () => {
    const viewOnly = await as('pharmacist_view');
    const probes: [string, string, unknown][] = [
      ['post', 'month-lock', { year_month: MONTH }],
      ['delete', 'month-lock', { year_month: MONTH }],
      ['post', 'monthly-manual', { year_month: MONTH, store_id: zt01, employee_code: 'ZTPROBE', employee_name: 'x' }],
      ['post', 'fees', { employee_code: 'ZTPROBE', association_city: '台北市', fee_year: 2099 }],
      ['delete', 'fees', {}],
    ];
    const leaked: string[] = [];
    for (const [method, action, data] of probes) {
      const res = await (viewOnly as any)[method](`${PHARM}/${action}`, action === 'fees' && method === 'delete' ? { params: { id: '00000000-0000-0000-0000-000000000000' } } : { data });
      if (res.status() < 400) leaked.push(`${method} ${action} -> ${res.status()}`);
    }
    const proof = await viewOnly.post(`${PHARM}/proof`, { multipart: { file: { name: 'p.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') }, employee_code: 'ZTPROBE' } });
    if (proof.status() < 400) leaked.push(`post proof -> ${proof.status()}`);
    // 若有缺口，立即清理（解除關帳、刪除探測快照）
    if (leaked.length) {
      const editor = await as('pharmacist_edit');
      await editor.delete(`${PHARM}/month-lock`, { data: { year_month: MONTH } });
      await registerPharmacists(MONTH, zt01);
    }
    expect(leaked, `view-only 帳號寫入成功：${leaked.join(', ')}`).toEqual([]);
  });

  test('POST 帶錯誤的 Origin：403，不會關帳', async ({ playwright }) => {
    const editor = await as('pharmacist_edit');
    const evil = await playwright.request.newContext({ baseURL: TEST_ORIGIN, storageState: await editor.storageState(), extraHTTPHeaders: { Origin: 'http://evil.example' } });
    try {
      const res = await evil.post(`${PHARM}/month-lock`, { data: { year_month: MONTH } });
      expect(res.status()).toBe(403);
    } finally {
      await evil.dispose();
    }
    const locks = await readRowsAsServiceRole('pharmacist_snapshot_locks', { eq: { year_month: MONTH }, select: 'year_month' });
    expect(locks).toHaveLength(0);
  });
});

test.describe('藥師管理：手動補入與月份關帳（2099-08、ZT01）', () => {
  test('補入：員編轉大寫、source 為 manual、預設職稱藥師；缺欄位 400', async () => {
    const editor = await as('pharmacist_edit');
    const code = staffCode('W');
    const miss = await editor.post(`${PHARM}/monthly-manual`, { data: { year_month: MONTH, store_id: zt01, employee_code: code } });
    expect(miss.status()).toBe(400);
    const bad = await editor.post(`${PHARM}/monthly-manual`, { data: { year_month: '2099-8', store_id: zt01, employee_code: code, employee_name: 'x' } });
    expect(bad.status()).toBe(400);
    const res = await editor.post(`${PHARM}/monthly-manual`, { data: { year_month: MONTH, store_id: zt01, employee_code: code.toLowerCase(), employee_name: 'ZT補入藥師' } });
    expect(res.status()).toBe(201);
    await registerPharmacists(MONTH, zt01);
    const rows = await readRowsAsServiceRole('pharmacist_monthly_snapshot', { eq: { year_month: MONTH, store_id: zt01 }, select: 'employee_code,employee_name,position,source,is_active' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employee_code: code, employee_name: 'ZT補入藥師', position: '藥師', source: 'manual', is_active: true });
  });

  test('關帳 → 補入 409「此月份已關帳」→ 解除關帳 → 補入 200 系列；月份關帳清單反映狀態', async () => {
    const editor = await as('pharmacist_edit');
    const payload = (n: string) => ({ year_month: MONTH, store_id: zt01, employee_code: staffCode(n), employee_name: `ZT補入${n}` });
    try {
      const lock = await editor.post(`${PHARM}/month-lock`, { data: { year_month: MONTH } });
      expect(lock.status()).toBe(200);
      await registerPharmacists(MONTH, zt01);
      const list = await (await editor.get(`${PHARM}/month-lock`)).json();
      expect((list.data as { year_month: string }[]).some((l) => l.year_month === MONTH)).toBe(true);
      const blocked = await editor.post(`${PHARM}/monthly-manual`, { data: payload('S') });
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).error).toBe('此月份已關帳，請先解除關帳');
      const rows = await readRowsAsServiceRole('pharmacist_monthly_snapshot', { eq: { year_month: MONTH, store_id: zt01 }, select: 'employee_code' });
      expect(rows.map((r) => r.employee_code)).not.toContain(staffCode('X'));
    } finally {
      expect((await editor.delete(`${PHARM}/month-lock`, { data: { year_month: MONTH } })).status()).toBe(200);
    }
    const ok = await editor.post(`${PHARM}/monthly-manual`, { data: payload('S') });
    expect(ok.status()).toBe(201);
    await registerPharmacists(MONTH, zt01);
    const locks = await readRowsAsServiceRole('pharmacist_snapshot_locks', { eq: { year_month: MONTH }, select: 'year_month' });
    expect(locks).toHaveLength(0);
  });

  test('關帳月份的規則：有較晚月份已關帳時，不能解除較早月份（409）', async () => {
    const editor = await as('pharmacist_edit');
    const early = '2099-08';
    const late = '2099-09';
    try {
      expect((await editor.post(`${PHARM}/month-lock`, { data: { year_month: early } })).status()).toBe(200);
      expect((await editor.post(`${PHARM}/month-lock`, { data: { year_month: late } })).status()).toBe(200);
      const res = await editor.delete(`${PHARM}/month-lock`, { data: { year_month: early } });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toContain(`${late} 已關帳`);
    } finally {
      await editor.delete(`${PHARM}/month-lock`, { data: { year_month: late } });
      await editor.delete(`${PHARM}/month-lock`, { data: { year_month: early } });
      for (const m of [early, late]) await registerPharmacists(m, zt01);
    }
    const locks = await readRowsAsServiceRole('pharmacist_snapshot_locks', { like: { year_month: '2099-%' }, select: 'year_month' });
    expect(locks).toHaveLength(0);
  });
});

test.describe('藥師管理：繳費證明上限', () => {
  test('伺服器端上限是 10 MB（超過直接 400，不寫入）、不支援格式 400；前端統一 3.5 MB（見單元層）', async () => {
    const editor = await as('pharmacist_edit');
    const big = await editor.post(`${PHARM}/proof`, { multipart: { file: { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024, 1) }, employee_code: 'ZTPROBE' } });
    expect(big.status()).toBe(400);
    expect((await big.json()).error).toBe('檔案大小超過 10 MB 限制');
    const bad = await editor.post(`${PHARM}/proof`, { multipart: { file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, employee_code: 'ZTPROBE' } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toContain('不支援的檔案格式');
    const missing = await editor.post(`${PHARM}/proof`, { multipart: { employee_code: 'ZTPROBE' } });
    expect(missing.status()).toBe(400);
    // 舊版 API 與新版 API 共用同一個 handler（不是各自實作）
    const wrapper = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app/api/workspace/pharmacists/[action]/route.ts'), 'utf8');
    expect(wrapper).toContain('@/app/api/pharmacist-annual-fees/upload/route');
  });
});
