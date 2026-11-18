import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { buildPrescriptionTemplateWorkbook, writePrescriptionTemplate } from '../../../lib/performance/prescription-template';
import { ACCOUNTS, TEST_YEAR_MONTH, account, adminDb, cleanup, testStores, type Who } from '../support';
import { gsheetBuffer, legacyBuffer, type FixtureStore } from '../fixtures';

// 處方箋 Google Sheet 匯入 e2e：對 DEV 與本機 legacy dev server。只用 2038-10 與 VW/ZT 測試門市，結束清除自己建的。
// 設定 RXGS_SHOTS_DIR 時在 networkidle 後存 1920x1080 截圖。

const SHOTS = process.env.RXGS_SHOTS_DIR || '';
test.describe.configure({ mode: 'serial' });

type Pair = [string | number, string | number];
const m = (r: Pair, c: Pair, t: Pair) => ({ regular: r, chronic: c, total: t });
// 測試門市名稱：「Vue 測試一店」「Vue 測試二店」「ZT 測試門市 01..05」
const sheet: FixtureStore[] = [
  { alias: '測試一', months: { 十月: m(['1,200', '2,600,000'], ['550', '1,250,000'], ['1,750', '3,850,000']) } },
  { alias: '測試門市01', months: { 十月: m([100, '300.5'], [50, '100.25'], [151, '400.75']) } }, // 加總不符（張數）
  { alias: '測試', months: { 十月: m([10, 100], [5, 50], [15, 150]) } }, // 多個候選
  { alias: '義一', months: { 十月: m([20, 200], [6, 60], [26, 260]) } }, // 對不上
];
const fileBuf = gsheetBuffer({ monthLabels: ['九月', '十月'], stores: sheet.map(s => ({ ...s, months: { 九月: s.months['十月'], 十月: s.months['十月'] } })) });

let ids: Record<string, string> = {};

async function login(page: Page, who: Who) {
  const a = account(ACCOUNTS[who]);
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(a.email);
  await page.locator('input[type="password"]').fill(a.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 90_000 });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts?.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: path.join(SHOTS, name) });
}

async function post(page: Page, buf: Buffer, mode: string, selections: Record<string, string> = {}, yearMonth = TEST_YEAR_MONTH) {
  const res = await page.request.post('/api/prescription-monthly/import', {
    multipart: { file: { name: 'x.xlsx', mimeType: 'application/octet-stream', buffer: buf }, year_month: yearMonth, mode, selections: JSON.stringify(selections) },
  });
  return { status: res.status(), json: await res.json() };
}

async function reportsOf(storeIds: string[]) {
  const r = await adminDb().from('monthly_prescription_reports').select('*').eq('year_month', TEST_YEAR_MONTH).in('store_id', storeIds);
  return (r.data || []) as Record<string, unknown>[];
}

test.beforeAll(async () => { ids = await testStores(); await cleanup(); });
test.afterAll(async () => {
  const left = await cleanup();
  console.log(`殘留：月報 ${left.reports}、簡稱 ${left.aliases}`);
  expect(left).toEqual({ reports: 0, aliases: 0 });
});

test('權限：只有查看權限不能匯入、不能改對照表', async ({ page }) => {
  await login(page, 'viewer');
  expect((await post(page, fileBuf, 'preview')).status).toBe(403);
  const create = await page.request.post('/api/prescription-monthly/aliases', { data: { alias: '測試一', store_id: ids.VW001 } });
  expect(create.status()).toBe(403);
});

test('預覽：自動對上、多候選、對不上、加總不符，且預覽不寫入', async ({ page }) => {
  await login(page, 'admin');
  const { status, json } = await post(page, fileBuf, 'preview');
  expect(status).toBe(200);
  expect(json.plan.format).toBe('gsheet');
  expect(json.plan.monthLabel).toBe('十月');
  const byLabel = Object.fromEntries(json.plan.rows.map((r: { label: string }) => [r.label, r]));
  expect(byLabel['測試一'].status).toBe('auto');
  expect(byLabel['測試一'].store.store_code).toBe('VW001');
  expect(byLabel['測試一'].regular).toEqual({ count: 1200, points: 2600000 });
  expect(byLabel['測試門市01'].mismatches.length).toBe(1);
  expect(byLabel['測試'].status).toBe('ambiguous');
  expect(byLabel['義一'].status).toBe('unknown');
  expect(json.importable).toBe(false);
  expect(await reportsOf(Object.values(ids))).toHaveLength(0);
});

test('找不到月份、沒有權限的選擇、缺選擇：清楚報錯且不寫入', async ({ page }) => {
  await login(page, 'admin');
  const noMonth = await post(page, fileBuf, 'preview', {}, '2038-03');
  expect(noMonth.status).toBe(400);
  expect(noMonth.json.error).toContain('找不到');
  expect(noMonth.json.error).toContain('十月');
  const missing = await post(page, fileBuf, 'commit', {});
  expect(missing.status).toBe(400);
  expect(missing.json.error_count).toBeGreaterThan(0);
  const badStore = await post(page, fileBuf, 'commit', { 測試: '00000000-0000-0000-0000-000000000000', 義一: ids.ZT03 });
  expect(badStore.status).toBe(400);
  expect(await reportsOf(Object.values(ids))).toHaveLength(0);
  const aliases = await adminDb().from('prescription_store_aliases').select('id').in('store_id', Object.values(ids));
  expect(aliases.data).toHaveLength(0);
});

test('整批原子寫入：資料庫函式中途失敗整批還原（含簡稱）', async () => {
  const db = adminDb();
  const bad = await db.rpc('import_prescription_report_batch', {
    p_year_month: TEST_YEAR_MONTH,
    p_reports: [
      { store_id: ids.VW001, regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 },
      { store_id: '00000000-0000-0000-0000-000000000000', regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 },
    ],
    p_aliases: [{ alias: '測試原子', store_id: ids.VW001 }],
    p_user: account('admin').userId,
  });
  expect(bad.error).toBeTruthy();
  expect(await reportsOf([ids.VW001])).toHaveLength(0);
  const a = await db.from('prescription_store_aliases').select('id').eq('alias', '測試原子');
  expect(a.data).toHaveLength(0);
});

test('確認匯入：寫入月報、存簡稱對照、加總不符仍可匯入、表上沒有的門市不動', async ({ page }) => {
  // 先放一筆「表上沒有」的門市資料，匯入後應維持原樣
  await adminDb().from('monthly_prescription_reports').insert({ year_month: TEST_YEAR_MONTH, store_id: ids.ZT05, regular_prescription_count: 7, regular_prescription_point_value: 70, chronic_prescription_count: 3, chronic_prescription_point_value: 30 });
  await login(page, 'admin');
  const { status, json } = await post(page, fileBuf, 'commit', { 測試: ids.VW002, 義一: ids.ZT03 });
  expect(status).toBe(200);
  expect(json.imported).toBe(4);
  expect(json.saved_aliases).toBe(2);
  expect(json.mismatch_count).toBe(1);
  const rows = await reportsOf(Object.values(ids));
  const by = Object.fromEntries(rows.map(r => [r.store_id as string, r]));
  expect(by[ids.VW001].regular_prescription_count).toBe(1200);
  expect(Number(by[ids.VW001].regular_prescription_point_value)).toBe(2600000);
  expect(by[ids.VW001].chronic_prescription_count).toBe(550);
  expect(Number(by[ids.ZT01].regular_prescription_point_value)).toBe(300.5);
  expect(by[ids.VW002].regular_prescription_count).toBe(10);
  expect(by[ids.ZT03].chronic_prescription_count).toBe(6);
  expect(by[ids.ZT05].regular_prescription_count).toBe(7);
  const aliases = await adminDb().from('prescription_store_aliases').select('alias, store_id').in('store_id', Object.values(ids));
  expect(Object.fromEntries((aliases.data as { alias: string; store_id: string }[]).map(a => [a.alias, a.store_id]))).toEqual({ 測試: ids.VW002, 義一: ids.ZT03 });
});

test('再次預覽：對照表優先，不用再選', async ({ page }) => {
  await login(page, 'admin');
  const { json } = await post(page, fileBuf, 'preview');
  const by = Object.fromEntries(json.plan.rows.map((r: { label: string }) => [r.label, r]));
  expect(by['測試'].status).toBe('mapped');
  expect(by['測試'].store.store_code).toBe('VW002');
  expect(by['義一'].status).toBe('mapped');
  expect(json.importable).toBe(true);
});

test('對照表 API：新增、重複擋下、修改、刪除', async ({ page }) => {
  await login(page, 'admin');
  const ok = await page.request.post('/api/prescription-monthly/aliases', { data: { alias: ' 測試 二 ', store_id: ids.VW002 } });
  expect(ok.status()).toBe(200);
  const id = (await ok.json()).alias.id;
  const dup = await page.request.post('/api/prescription-monthly/aliases', { data: { alias: '測試二', store_id: ids.ZT01 } });
  expect(dup.status()).toBe(409);
  const patch = await page.request.patch(`/api/prescription-monthly/aliases/${id}`, { data: { store_id: ids.ZT01 } });
  expect(patch.status()).toBe(200);
  const list = await (await page.request.get('/api/prescription-monthly/aliases')).json();
  expect(list.aliases.find((a: { id: string }) => a.id === id).store_code).toBe('ZT01');
  expect((await page.request.delete(`/api/prescription-monthly/aliases/${id}`)).status()).toBe(200);
  expect((await page.request.delete(`/api/prescription-monthly/aliases/${id}`)).status()).toBe(404);
});

const TEMPLATE_MONTH = '2038-08';
const TEMPLATE_UI_MONTH = '2038-09';

/** 下載的範本（驗證 API），再用同一個產生器只留測試門市並「貼上」數字（改 D/E 欄）。 */
async function pastedTemplate(page: Page, month: string) {
  const res = await page.request.get('/api/prescription-monthly/template', { params: { year_month: month } });
  expect(res.status()).toBe(200);
  const body = await res.body();
  const dl = XLSX.read(body, { type: 'buffer' }).Sheets['處方箋月報'];
  const names = new Map<string, string>();
  for (let r = 3; dl[`A${r}`]; r += 3) names.set(String(dl[`A${r}`].v), String(dl[`B${r}`]?.v ?? ''));
  const stores = ['VW001', 'ZT01', 'ZT02'].map(code => ({ id: ids[code], store_code: code, store_name: names.get(code) || code }));
  const wb = buildPrescriptionTemplateWorkbook(month, stores, new Map());
  const out = wb.Sheets['處方箋月報'];
  out['D3'] = { t: 'n', v: 11 }; out['E3'] = { t: 's', v: '1,111.5' };
  out['D4'] = { t: 'n', v: 2 }; out['E4'] = { t: 'n', v: 22.5 };
  out['D5'] = { t: 'n', v: 13 }; out['E5'] = { t: 'n', v: 1134 };
  out['D6'] = { t: 'n', v: 5 }; out['E6'] = { t: 'n', v: 50 };
  out['D7'] = { t: 'n', v: 1 }; out['E7'] = { t: 'n', v: 10 };
  out['D8'] = { t: 'n', v: 7 }; out['E8'] = { t: 'n', v: 60 }; // ZT01 加總不符（張數 6 ≠ 7）
  out['D9'] = { t: 'n', v: 3 }; out['E9'] = { t: 'n', v: 30 };
  out['D10'] = { t: 'n', v: 4 }; out['E10'] = { t: 'n', v: 40 };
  out['D11'] = { t: 'n', v: 7 }; out['E11'] = { t: 'n', v: 70 };
  return { downloaded: Buffer.from(body), pasted: Buffer.from(writePrescriptionTemplate(wb)), names };
}

test('本月範本 API：下載版面、整份下載檔預覽全以代號對上；貼上數字後確認匯入（不寫簡稱）', async ({ page }) => {
  await login(page, 'admin');
  const { downloaded, pasted } = await pastedTemplate(page, TEMPLATE_MONTH);
  const sheet = XLSX.read(downloaded, { type: 'buffer' }).Sheets['處方箋月報'];
  expect([sheet['A1'].v, sheet['B1'].v, sheet['C1'].v, sheet['D1'].v, sheet['D2'].v, sheet['E2'].v]).toEqual(['門市代號', '店別', '項目', '8月', '張數', '金額']);
  const codes: string[] = [];
  for (let r = 3; sheet[`A${r}`]; r += 3) {
    codes.push(String(sheet[`A${r}`].v));
    expect([sheet[`C${r}`].v, sheet[`C${r + 1}`].v, sheet[`C${r + 2}`].v]).toEqual(['一般', '連續', '加總']);
    expect(sheet[`D${r + 2}`].f).toBe(`D${r}+D${r + 1}`);
  }
  expect(codes).toEqual(expect.arrayContaining(['VW001', 'ZT01', 'ZT02']));
  expect(codes).not.toContain('0000');
  const whole = await post(page, downloaded, 'preview', {}, TEMPLATE_MONTH);
  expect(whole.status).toBe(200);
  expect(whole.json.plan.hasCodeColumn).toBe(true);
  expect(whole.json.plan.rows.every((r: { status: string }) => r.status === 'coded')).toBe(true);
  expect(whole.json.importable).toBe(true);

  const pv = await post(page, pasted, 'preview', {}, TEMPLATE_MONTH);
  expect(pv.json.plan.rows.map((r: { mismatches: string[] }) => r.mismatches.length)).toEqual([0, 1, 0]);
  const c = await post(page, pasted, 'commit', {}, TEMPLATE_MONTH);
  expect(c.status).toBe(200);
  expect(c.json.imported).toBe(3);
  expect(c.json.saved_aliases).toBe(0);
  const r = await adminDb().from('monthly_prescription_reports').select('*').eq('year_month', TEMPLATE_MONTH).in('store_id', [ids.VW001, ids.ZT01, ids.ZT02]);
  const rows = Object.fromEntries((r.data || []).map((x: Record<string, unknown>) => [x.store_id as string, x]));
  expect(rows[ids.VW001]).toMatchObject({ regular_prescription_count: 11, chronic_prescription_count: 2 });
  expect(Number(rows[ids.VW001].regular_prescription_point_value)).toBe(1111.5);
  expect(rows[ids.ZT02]).toMatchObject({ regular_prescription_count: 3, chronic_prescription_count: 4 });

  // 代號找不到：確認匯入被擋
  const wb = XLSX.read(pasted, { type: 'buffer' });
  wb.Sheets['處方箋月報']['A3'] = { t: 's', v: 'NOPE99' };
  const bad = await post(page, Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer), 'commit', {}, TEMPLATE_MONTH);
  expect(bad.status).toBe(400);
  expect(String(bad.json.errors?.[0])).toContain('NOPE99');
});

test('舊的一門市一列範本已停用：預覽與確認都回停用錯誤，不寫入', async ({ page }) => {
  await login(page, 'admin');
  const buf = legacyBuffer([[TEST_YEAR_MONTH, 'ZT03', '', 99, 99, 9, '9.5']]);
  const before = JSON.stringify(await reportsOf([ids.ZT03]));
  for (const mode of ['preview', 'commit']) {
    const r = await post(page, buf, mode);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('這是舊版範本格式，已停用，請重新下載本月範本');
  }
  expect(JSON.stringify(await reportsOf([ids.ZT03]))).toBe(before); // 沒有任何寫入
});

test('畫面：本月範本上傳→預覽（代號對上、加總不符標黃）→確認；舊格式看到停用說明', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => { if (!/hydrat|Text content does not match/i.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await login(page, 'admin');
  const { pasted } = await pastedTemplate(page, TEMPLATE_UI_MONTH);
  await page.goto('/admin/performance');
  await page.getByRole('button', { name: '處方箋' }).first().click();
  await page.getByLabel('選擇處方箋年份').waitFor();
  await page.getByLabel('選擇處方箋年份').evaluate(el => { const o = document.createElement('option'); o.value = '2038'; o.textContent = '2038 年'; (el as HTMLSelectElement).appendChild(o); });
  await page.getByLabel('選擇處方箋年份').selectOption('2038');
  await page.getByLabel('選擇處方箋月份').selectOption('9');
  await expect(page.getByText('讀取中…')).toHaveCount(0);
  await expect(page.getByText('下載本月範本 → 從 Google Sheet 複製當月張數、金額貼到 D3 起 → 存檔上傳')).toBeVisible();

  // 舊格式：看到停用說明，不開預覽
  const legacyFile = path.join(__dirname, '..', '.results', 'legacy.xlsx');
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.writeFileSync(legacyFile, legacyBuffer([['2038-09', 'ZT03', '', 1, 1, 1, 1]]));
  await page.locator('input[type="file"]').setInputFiles(legacyFile);
  await expect(page.getByText('這是舊版範本格式，已停用，請重新下載本月範本')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /匯入預覽/ })).toHaveCount(0);

  const file = path.join(__dirname, '..', '.results', 'template.xlsx');
  fs.writeFileSync(file, pasted);
  await page.locator('input[type="file"]').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: /匯入預覽/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('本月範本，以門市代號對門市');
  await expect(dialog.getByTestId('rx-preview-row')).toHaveCount(3);
  await expect(dialog.locator('tr[data-status="coded"]')).toHaveCount(3);
  await expect(dialog.locator('tr.bg-yellow-100')).toHaveCount(1);
  await shot(page, '01-template-preview.png');
  await dialog.getByRole('button', { name: '確認匯入 3 間' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已匯入 3 間門市' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('畫面：上傳→預覽（黃色提醒＋待選門市）→選門市→確認→對照表', async ({ page }) => {
  await adminDb().from('monthly_prescription_reports').delete().like('year_month', '2038-%').in('store_id', Object.values(ids));
  await adminDb().from('prescription_store_aliases').delete().in('store_id', Object.values(ids));
  const errors: string[] = [];
  page.on('pageerror', e => { if (!/hydrat|Text content does not match/i.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await login(page, 'admin');
  await page.goto('/admin/performance');
  await page.getByRole('button', { name: '處方箋' }).first().click();
  await page.getByLabel('選擇處方箋年份').waitFor();
  // 2038 不在年份選單中（只到明年）；測試時動態補上這個選項
  await page.getByLabel('選擇處方箋年份').evaluate(el => { const o = document.createElement('option'); o.value = '2038'; o.textContent = '2038 年'; (el as HTMLSelectElement).appendChild(o); });
  await page.getByLabel('選擇處方箋年份').selectOption('2038');
  await page.getByLabel('選擇處方箋月份').selectOption('10');
  await expect(page.getByText('讀取中…')).toHaveCount(0);

  const fixture = path.join(__dirname, '..', '.results', 'sample.xlsx');
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  fs.writeFileSync(fixture, fileBuf);
  await page.locator('input[type="file"]').setInputFiles(fixture);
  const dialog = page.getByRole('dialog', { name: /匯入預覽/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('rx-preview-row')).toHaveCount(4);
  await expect(dialog.getByRole('button', { name: /還有 2 間未選門市/ })).toBeDisabled();
  await expect(dialog.locator('tr[data-status="auto"]')).toHaveCount(2);
  await shot(page, '01-preview-yellow-and-pending.png');

  await dialog.getByLabel('測試 對應的門市').selectOption(ids.VW002);
  await dialog.getByLabel('義一 對應的門市').selectOption(ids.ZT03);
  await expect(dialog.getByRole('button', { name: '確認匯入 4 間' })).toBeEnabled();
  await shot(page, '02-preview-all-selected.png');
  await dialog.getByRole('button', { name: '確認匯入 4 間' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已匯入 4 間門市' })).toBeVisible();
  await shot(page, '03-import-success.png');

  await page.getByRole('button', { name: /門市簡稱對照表/ }).click();
  await expect(page.getByTestId('rx-alias-row')).toHaveCount(2);
  await page.getByTestId('rx-alias-row').first().scrollIntoViewIfNeeded();
  await shot(page, '04-alias-table.png');
  expect(errors).toEqual([]);
});
