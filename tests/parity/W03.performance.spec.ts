import { expect, test, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs } from '../support/auth';
import {
  assertNoUnlistedDiffs,
  compareApiRead,
  loadMap,
  ParityRecorder,
  readRowsAsServiceRole,
  valueDiffsToDiffs,
  type Diff,
  type LegacyApiSource,
  type NativeApiSource,
} from '../support/parity';
import { diffNormalized, normalize } from '../support/normalize';
import { compareWorkbooks } from '../support/w02-xlsx';
import { MONTHLY_THRESHOLDS, QUARTERLY_THRESHOLDS, type ThresholdDef } from '../../lib/performance/bonus-calc';
import { calcYearBonus } from '../../lib/workspace/performance-year';
import { legacyYear } from '../unit/W03/legacy-year';
import {
  DEFAULT_MONTHLY,
  DEFAULT_QUARTERLY,
  W03_YEAR,
  bonusEmployeeCode,
  multipartFile,
  perfImportRow,
  perfStoreIds,
  registerPerfRows,
  restoreDefaultThresholds,
  savePerf,
  thresholdBody,
  type W03StoreCode,
} from '../support/w03-fixtures';

// W03 對等層：舊 /admin/performance 與新「業績管理」。
// 同一個角色、同一組 DEV 資料（2038 年、ZT/VW 測試門市），逐項比對舊 API 與 workspace API 的讀取、匯出（處方箋範本）、
// 寫入副作用與權限；月、季獎金以舊版年度頁計算（對照實作）與新版計算逐月比對，誤差 0 元。
// 與舊版不同的行為一律列在 tests/parity/allowlist.json（approvedBy 為 null，待使用者核可）。

const map = loadMap('performance');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('performance');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const YEAR = String(W03_YEAR);
const TOOLS = '/api/workspace/performance-tools';
const READ_ROLES = ['admin', 'performance_view', 'performance_edit', 'ops_assistant', 'denied'];

let admin: APIRequestContext;
let ids: Record<W03StoreCode, string>;
const apis: Record<string, APIRequestContext> = {};
async function as(role: string) {
  return (apis[role] ||= await apiAs(role));
}


// ---------------------------------------------------------------------------
// 種子資料（2038 年，只用測試門市）
// ---------------------------------------------------------------------------
const CUSTOM_MONTHLY = [3500, 5200, 7300, 8100, 10500];
const CUSTOM_QUARTERLY = [9500, 15200, 21300, 24100, 30500];

test.beforeAll(async () => {
  test.setTimeout(180_000);
  admin = await apiAs('admin');
  ids = await perfStoreIds(admin);
  const T = 780_000;
  const step = 26_000;
  // ZT01：全年 12 個月，自訂閾值。10 月有活動日毛利（觸發 80% 折減）、11 月毛利剛好等於第一檻、12 月未達第一檻；3 月營業天數 0.5。
  for (let m = 1; m <= 12; m++) {
    const over: Record<string, unknown> = { monthly_gross_profit_actual: T + step * (m % 5) };
    if (m === 3) Object.assign(over, { business_days: 0.5, monthly_gross_profit_target: 15_000, monthly_gross_profit_actual: 15_500 });
    if (m === 10) Object.assign(over, { monthly_gross_profit_actual: T + 100, activity_day_gross_profit: 200_000 });
    if (m === 11) Object.assign(over, { monthly_gross_profit_actual: T });
    if (m === 12) Object.assign(over, { monthly_gross_profit_actual: T - 1, monthly_revenue_actual: 1 });
    const res = await savePerf(admin, ids.ZT01, m, over);
    expect(res.status(), `seed ZT01 ${m}`).toBe(200);
  }
  expect((await admin.post(`${TOOLS}/thresholds`, { data: { store_id: ids.ZT01, ...thresholdBody(CUSTOM_MONTHLY, CUSTOM_QUARTERLY) } })).status()).toBe(200);
  // ZT03：從不修改閾值（永遠是系統預設），只填 1–3 月
  for (let m = 1; m <= 3; m++) expect((await savePerf(admin, ids.ZT03, m, { monthly_gross_profit_actual: T + step * m })).status()).toBe(200);
  // 處方箋 2038-03：ZT01 完整、ZT02 部分、VW001 未填
  const rx = await admin.post(`${TOOLS}/prescription`, {
    data: {
      year_month: `${YEAR}-03`,
      records: [
        { store_id: ids.ZT01, regular_prescription_count: 10, regular_prescription_point_value: 1.2345, chronic_prescription_count: 5, chronic_prescription_point_value: 2.5 },
        { store_id: ids.ZT02, regular_prescription_count: 7, regular_prescription_point_value: null, chronic_prescription_count: null, chronic_prescription_point_value: null },
      ],
    },
  });
  expect(rx.status(), await rx.text()).toBe(200);
  // 每月獎金 2038-04
  const bonus = await admin.post(`${TOOLS}/bonus-import`, {
    multipart: {
      year: YEAR,
      file: multipartFile([
        { 員編: bonusEmployeeCode('P1'), 姓名: 'W03 對等一', 門市代號: 'ZT01', 年月: `${YEAR}-04`, 團體獎金: 5000, 單品獎金: 200, 其他獎金: 100, 其他獎金備註: 'W03 對等' },
        { 員編: bonusEmployeeCode('P2'), 姓名: 'W03 對等二', 門市代號: 'ZT02', 年月: `${YEAR}-04`, 團體獎金: 100, 單品獎金: 0 },
      ]),
    },
  });
  expect(bonus.status(), await bonus.text()).toBe(200);
});

test.afterAll(async () => {
  try {
    if (admin && ids) {
      await restoreDefaultThresholds(admin, ids.ZT01);
      await registerPerfRows([ids.ZT01, ids.ZT02, ids.ZT03, ids.ZT04, ids.VW001]);
    }
  } finally {
    await admin?.dispose();
    await Promise.all(Object.values(apis).map((a) => a.dispose()));
  }
});

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

async function send(api: APIRequestContext, method: 'GET' | 'POST', url: string, opts: { params?: Record<string, string>; data?: unknown; multipart?: Record<string, any> } = {}) {
  // Next dev 伺服器第一次編譯路由時偶爾會重置連線；只對連線層錯誤重試一次（不會重送已經收到回應的請求）。
  let res;
  try {
    res = await api.fetch(url, { method, ...opts });
  } catch (e) {
    if (!/ECONNRESET|socket hang up/.test(String(e))) throw e;
    res = await api.fetch(url, { method, ...opts });
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __nonJson: text.slice(0, 200) };
  }
  return { status: res.status(), body, headers: res.headers() };
}

const statusDiff = (l: number, n: number): Diff[] => (l === n ? [] : [{ kind: 'status', key: 'http-status', legacy: l, native: n, detail: `舊 ${l} / 新 ${n}` }]);

function rowsStripped(rows: Record<string, unknown>[], drop: string[]) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
}

// ---------------------------------------------------------------------------
// 年度業績、閾值讀取
// ---------------------------------------------------------------------------

for (const role of READ_ROLES) {
  for (const code of ['ZT01', 'ZT03'] as const) {
    test(`年度業績讀取對等 ${role} ${code}`, async () => {
      const api = await as(role);
      const e = entry('year-read');
      const query = { year: YEAR, store_id: ids[code] };
      const result = await compareApiRead({
        recorder,
        entry: e.id,
        title: `年度業績 records（${code}、${YEAR}）`,
        role,
        legacyApi: api,
        legacy: { ...(e.legacy.api as LegacyApiSource), query },
        native: { ...(e.native.api as NativeApiSource), query },
        compareKey: e.compareKey,
      });
      assertNoUnlistedDiffs(result);
      if (role === 'admin') expect(Number(result.compared.legacyRows), '舊版必須真的讀到資料').toBeGreaterThanOrEqual(code === 'ZT01' ? 12 : 3);
    });
  }
}

for (const role of ['admin', 'performance_view', 'performance_edit']) {
  for (const code of ['ZT01', 'ZT03'] as const) {
    test(`獎金閾值讀取對等 ${role} ${code}`, async () => {
      const api = await as(role);
      const e = entry('thresholds-read');
      const query = { store_id: ids[code] };
      const result = await compareApiRead({
        recorder,
        entry: e.id,
        title: `獎金閾值（${code}，${code === 'ZT01' ? '自訂' : '預設'}）`,
        role,
        legacyApi: api,
        legacy: { ...(e.legacy.api as LegacyApiSource), query },
        native: { ...(e.native.api as NativeApiSource), query },
      });
      assertNoUnlistedDiffs(result);
      if (role === 'admin') {
        const body = await (await api.get('/api/performance-thresholds', { params: query })).json();
        expect(body.monthly.some((t: any) => t.isCustom)).toBe(code === 'ZT01');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 月、季獎金逐月比對（誤差 0 元）
// ---------------------------------------------------------------------------

test('月、季獎金逐月比對：舊版年度頁計算 vs 新版計算，誤差 0 元（ZT01 自訂閾值、ZT03 預設閾值）', async () => {
  for (const code of ['ZT01', 'ZT03'] as const) {
    const started = Date.now();
    const store = ids[code];
    const legacyRecords = (await send(admin, 'GET', '/api/performance-data', { params: { year: YEAR, store_id: store } })).body.records as any[];
    const nativeRecords = (await send(admin, 'GET', '/api/workspace/performance', { params: { year: YEAR, store_id: store } })).body.records as any[];
    const legacyTh = (await send(admin, 'GET', '/api/performance-thresholds', { params: { store_id: store } })).body;
    const nativeTh = (await send(admin, 'GET', `${TOOLS}/thresholds`, { params: { store_id: store } })).body;
    const toDefs = (list: any[]): ThresholdDef[] => list.map((t) => ({ multiplier: t.multiplier, baseAmount: t.baseAmount, label: t.label }));
    const legacy = legacyYear(legacyRecords, toDefs(legacyTh.monthly), toDefs(legacyTh.quarterly));
    const native = calcYearBonus(nativeRecords, toDefs(nativeTh.monthly), toDefs(nativeTh.quarterly));
    const pick = (y: { months: any[]; quarters: any[] }) => ({
      months: y.months.map((b) => (b ? { level: b.gpThresholdLevel, bonus: b.finalBonus, pre: b.preActivityPenaltyBonus, penalty: b.activityPenaltyApplied, weight: b.totalWeight } : null)),
      quarters: y.quarters.map((q) => (q ? { level: q.gpThresholdLevel, due: q.quarterlyBonus, monthSum: q.monthlyBonusSum, makeup: q.makeupBonus } : null)),
    });
    const diffs = valueDiffsToDiffs(diffNormalized(normalize(pick(legacy)), normalize(pick(native))));
    // 不是空比對：ZT01 要有活動日折減、剛好達第一檻、未達檻、營業天數 0.5 的月份
    if (code === 'ZT01') {
      expect(native.months[9]?.activityPenaltyApplied, '10 月活動日折減').toBe(true);
      expect(native.months[10]?.gpThresholdLevel, '11 月剛好第一檻').toBe(1);
      expect(native.months[11]?.gpThresholdLevel, '12 月未達').toBe(0);
      expect(native.months[2]?.gpThresholdLevel, '3 月（0.5 天）').toBeGreaterThanOrEqual(1);
    }
    const result = recorder.record({
      entry: entry('year-bonus-calc').id,
      mechanism: 'api-read',
      role: 'admin',
      title: `月、季獎金逐月比對（${code}）`,
      legacy: { endpoint: 'legacyYear（舊 page.tsx 計算）', status: 200 },
      native: { endpoint: 'calcYearBonus（lib/workspace/performance-year.ts）', status: 200 },
      compared: { months: native.months.filter(Boolean).length, quarters: native.quarters.filter(Boolean).length, sumMonthly: native.months.reduce((s, b) => s + (b?.finalBonus ?? 0), 0) },
      diffs,
      durationMs: Date.now() - started,
    });
    assertNoUnlistedDiffs(result);
    expect(result.diffs, `${code} 逐月、逐季必須完全相等`).toEqual([]);
  }
});

// ---------------------------------------------------------------------------
// 單月存檔
// ---------------------------------------------------------------------------

const SAVE_DROP = ['id', 'month', 'created_at', 'updated_at'];

test('單月存檔對等：同內容寫入不同月份，回傳與 DB 列逐欄相同', async () => {
  const started = Date.now();
  const body = (month: number) => ({
    store_id: ids.ZT02, year: W03_YEAR, month, business_days: 26, monthly_gross_profit_target: 900000, monthly_revenue_target: 2000000,
    monthly_customer_count_target: 3500, last_month_rx_target: 450, monthly_gross_profit_actual: 910000, activity_day_gross_profit: 3000,
    monthly_revenue_actual: 2100000, monthly_customer_count_actual: 3600, last_month_rx_actual: 460, system_monthly_revenue: 1, self_pay_monthly_revenue: 2,
    monthly_true_gross_profit: 3, system_monthly_gross_profit: 4, monthly_long_term_care_gross_profit: 5, monthly_rx_addon_makeup_gross_profit: 6,
    monthly_theft_compensation_makeup_gross_profit: 7, monthly_kamedis_deduction_gross_profit: 8,
  });
  const l = await send(admin, 'POST', '/api/performance-data', { data: body(7) });
  const n = await send(admin, 'POST', '/api/workspace/performance', { data: body(8) });
  const lRow = (await readRowsAsServiceRole('store_performance', { eq: { store_id: ids.ZT02, year: W03_YEAR, month: 7 } }))[0];
  const nRow = (await readRowsAsServiceRole('store_performance', { eq: { store_id: ids.ZT02, year: W03_YEAR, month: 8 } }))[0];
  const diffs: Diff[] = [...statusDiff(l.status, n.status)];
  if (lRow && nRow) {
    diffs.push(...valueDiffsToDiffs(diffNormalized(normalize(rowsStripped([lRow], SAVE_DROP)[0]), normalize(rowsStripped([nRow], SAVE_DROP)[0])), 'db.'));
    diffs.push(...valueDiffsToDiffs(diffNormalized(normalize(rowsStripped([l.body.record], SAVE_DROP)[0]), normalize(rowsStripped([n.body.record], SAVE_DROP)[0])), 'response.'));
  } else diffs.push({ kind: 'only-legacy', key: 'db-row', detail: `舊 ${!!lRow} / 新 ${!!nRow}` });
  const result = recorder.record({
    entry: entry('save-readback').id, mechanism: 'write-readback', role: 'admin', title: '單月業績存檔（ZT02，月份 7 vs 8）',
    legacy: { endpoint: 'POST /api/performance-data', status: l.status }, native: { endpoint: 'POST /api/workspace/performance', status: n.status },
    compared: { fields: Object.keys(lRow || {}).length }, diffs, durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
  expect(l.status).toBe(200);
  expect(n.status).toBe(200);
});

test('存檔嚴格度：缺數值欄位（舊版 200、新版 400）', async () => {
  const started = Date.now();
  const base = { store_id: ids.ZT02, year: W03_YEAR, month: 9, business_days: 26, monthly_gross_profit_target: 1000 };
  const l = await send(admin, 'POST', '/api/performance-data', { data: base });
  const n = await send(admin, 'POST', '/api/workspace/performance', { data: base });
  const result = recorder.record({
    entry: entry('save-partial-body').id, mechanism: 'write-readback', role: 'admin', title: '存檔內容缺少數值欄位',
    legacy: { endpoint: 'POST /api/performance-data', status: l.status }, native: { endpoint: 'POST /api/workspace/performance', status: n.status },
    compared: {}, diffs: statusDiff(l.status, n.status), durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
});

test('存檔門市範圍：有 performance.edit 但未被指派門市', async () => {
  const started = Date.now();
  const api = await as('performance_edit');
  const body = { store_id: ids.ZT02, year: W03_YEAR, month: 10, business_days: 26, monthly_gross_profit_target: 1000, monthly_revenue_target: null, monthly_customer_count_target: null, last_month_rx_target: null, monthly_gross_profit_actual: null, activity_day_gross_profit: null, monthly_revenue_actual: null, monthly_customer_count_actual: null, last_month_rx_actual: null, system_monthly_revenue: null, self_pay_monthly_revenue: null, monthly_true_gross_profit: null, system_monthly_gross_profit: null, monthly_long_term_care_gross_profit: null, monthly_rx_addon_makeup_gross_profit: null, monthly_theft_compensation_makeup_gross_profit: null, monthly_kamedis_deduction_gross_profit: null };
  const l = await send(api, 'POST', '/api/performance-data', { data: body });
  const n = await send(api, 'POST', '/api/workspace/performance', { data: body });
  const result = recorder.record({
    entry: entry('save-store-scope').id, mechanism: 'write-readback', role: 'performance_edit', title: '未指派門市的存檔',
    legacy: { endpoint: 'POST /api/performance-data', status: l.status }, native: { endpoint: 'POST /api/workspace/performance', status: n.status },
    compared: {}, diffs: statusDiff(l.status, n.status), durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
  expect(n.status).toBe(403);
});

test('閾值存檔嚴格度：舊版不驗證、不檢查門市；新版驗證並檢查門市指派', async () => {
  const bodyOf = (store: string, monthlyCount: number) => ({ store_id: store, ...thresholdBody(DEFAULT_MONTHLY.slice(0, monthlyCount), DEFAULT_QUARTERLY) });
  for (const [role, count, expectNative] of [['admin', 4, 400], ['performance_edit', 5, 403]] as const) {
    const started = Date.now();
    const api = await as(role);
    const l = await send(api, 'POST', '/api/performance-thresholds', { data: bodyOf(ids.ZT04, count) });
    const n = await send(api, 'POST', `${TOOLS}/thresholds`, { data: bodyOf(ids.ZT04, count) });
    const result = recorder.record({
      entry: entry('thresholds-save').id, mechanism: 'write-readback', role, title: role === 'admin' ? '閾值存檔：只給 4 檻' : '閾值存檔：未指派門市',
      legacy: { endpoint: 'POST /api/performance-thresholds', status: l.status }, native: { endpoint: 'POST performance-tools/thresholds', status: n.status },
      compared: {}, diffs: statusDiff(l.status, n.status), durationMs: Date.now() - started,
    });
    assertNoUnlistedDiffs(result);
    expect(n.status).toBe(expectNative);
  }
});

// ---------------------------------------------------------------------------
// 業績 Excel 匯入（W03-q1）
// ---------------------------------------------------------------------------

test('W03-q1 匯入對等：不選門市、依門市代號匯入多間門市（含找不到門市、營業天數錯誤的列）', async () => {
  const started = Date.now();
  const rows = (month: number) => [
    perfImportRow('ZT02', month, { 月實際毛利額: 850000 }),
    perfImportRow('VW001', month, { 月實際毛利額: 860000, 營業天數: 25.5 }),
    perfImportRow('NOPE99', month),
    perfImportRow('ZT02', month, { 營業天數: 40 }),
  ];
  const l = await send(admin, 'POST', '/api/performance-data/import', { multipart: { file: multipartFile(rows(5)), year: YEAR } });
  const n = await send(admin, 'POST', `${TOOLS}/performance-import`, { multipart: { file: multipartFile(rows(6)), year: YEAR } });
  const snap = async (month: number) =>
    rowsStripped(await readRowsAsServiceRole('store_performance', { in: { store_id: [ids.ZT02, ids.VW001] }, eq: { year: W03_YEAR, month }, order: 'store_id' }), [...SAVE_DROP, 'store_id']);
  const lRows = await snap(5);
  const nRows = await snap(6);
  const monthless = (b: any) => ({ ...b, errors: (b.errors || []).map((x: string) => x.replace(/第 \d+ 月/, '第 M 月')) });
  const diffs: Diff[] = [...statusDiff(l.status, n.status)];
  diffs.push(...valueDiffsToDiffs(diffNormalized(normalize(monthless(l.body)), normalize(monthless(n.body))), 'response.'));
  diffs.push(...valueDiffsToDiffs(diffNormalized(normalize(lRows), normalize(nRows)), 'db.'));
  const result = recorder.record({
    entry: entry('import-multistore').id, mechanism: 'write-readback', role: 'admin', title: '業績匯入（不選門市，月份 5 vs 6）',
    legacy: { endpoint: 'POST /api/performance-data/import', status: l.status }, native: { endpoint: 'POST performance-tools/performance-import', status: n.status },
    compared: { imported: l.body.imported, skipped: l.body.skipped, dbRows: lRows.length }, diffs, durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
  expect(l.status).toBe(200);
  expect(l.body.imported).toBe(2);
  expect(l.body.skipped).toBe(2);
  expect(lRows.length).toBe(2);
});

for (const role of ['performance_view', 'ops_manager', 'ops_assistant', 'performance_edit', 'denied']) {
  test(`業績匯入權限對等 ${role}`, async () => {
    const started = Date.now();
    const api = await as(role);
    const mk = () => ({ multipart: { file: multipartFile([perfImportRow('VW001', 12)]), year: YEAR } });
    const l = await send(api, 'POST', '/api/performance-data/import', mk());
    const n = await send(api, 'POST', `${TOOLS}/performance-import`, mk());
    const result = recorder.record({
      entry: entry('import-permission').id, mechanism: 'write-readback', role, title: '業績匯入的角色權限',
      legacy: { endpoint: 'POST /api/performance-data/import', status: l.status }, native: { endpoint: 'POST performance-tools/performance-import', status: n.status },
      compared: {}, diffs: statusDiff(l.status, n.status), durationMs: Date.now() - started,
    });
    assertNoUnlistedDiffs(result);
  });
}

// ---------------------------------------------------------------------------
// 處方箋
// ---------------------------------------------------------------------------

for (const role of ['admin', 'performance_view', 'denied']) {
  for (const [mode, query] of [['單月', { year_month: `${YEAR}-03` }], ['年度', { year: YEAR }]] as const) {
    test(`處方箋讀取對等 ${role} ${mode}`, async () => {
      const api = await as(role);
      const e = entry('prescription-read');
      const result = await compareApiRead({
        recorder,
        entry: e.id,
        title: `處方箋 records（${mode}）`,
        role,
        legacyApi: api,
        legacy: { ...(e.legacy.api as LegacyApiSource), query },
        native: { ...(e.native.api as NativeApiSource), query },
        compareKey: mode === '年度' ? ['store_id', 'year_month'] : e.compareKey,
        rules: { ignore: ['prescription_data_updated_by'] },
      });
      assertNoUnlistedDiffs(result);
      if (role === 'admin' && mode === '單月') {
        const zt01 = (await (await api.get('/api/prescription-monthly', { params: query })).json()).records.find((r: any) => r.store_id === ids.ZT01);
        expect(Number(zt01.total_chronic_prescription_count)).toBe(7.5);
      }
    });
  }
}

test('處方箋存檔對等：同內容寫入不同月份；非法內容新舊同狀態碼與訊息', async () => {
  const started = Date.now();
  const records = [
    { store_id: ids.ZT01, regular_prescription_count: 10, regular_prescription_point_value: 1.2345, chronic_prescription_count: 5, chronic_prescription_point_value: 2.5 },
    { store_id: ids.ZT02, regular_prescription_count: 7, regular_prescription_point_value: null, chronic_prescription_count: 3, chronic_prescription_point_value: null },
    { store_id: ids.VW001, regular_prescription_count: null, regular_prescription_point_value: null, chronic_prescription_count: null, chronic_prescription_point_value: null },
  ];
  const l = await send(admin, 'POST', '/api/prescription-monthly', { data: { year_month: `${YEAR}-05`, records } });
  const n = await send(admin, 'POST', `${TOOLS}/prescription`, { data: { year_month: `${YEAR}-06`, records } });
  const snap = async (ym: string) =>
    rowsStripped(await readRowsAsServiceRole('monthly_prescription_reports', { in: { store_id: [ids.ZT01, ids.ZT02, ids.VW001] }, eq: { year_month: ym }, order: 'store_id' }), ['year_month', 'created_at', 'updated_at', 'prescription_data_updated_at']);
  const diffs: Diff[] = [...statusDiff(l.status, n.status)];
  diffs.push(...valueDiffsToDiffs(diffNormalized(normalize({ ...l.body, updated_at: null }), normalize({ ...n.body, updated_at: null })), 'response.'));
  diffs.push(...valueDiffsToDiffs(diffNormalized(normalize(await snap(`${YEAR}-05`)), normalize(await snap(`${YEAR}-06`))), 'db.'));
  const bad: [string, any][] = [
    ['點值五位小數', { regular_prescription_point_value: 1.23456 }],
    ['張數負數', { regular_prescription_count: -1 }],
    ['張數小數', { chronic_prescription_count: 1.5 }],
    ['張數文字', { regular_prescription_count: 'abc' }],
  ];
  for (const [name, patch] of bad) {
    const body = { year_month: `${YEAR}-07`, records: [{ ...records[0], ...patch }] };
    const lb = await send(admin, 'POST', '/api/prescription-monthly', { data: body });
    const nb = await send(admin, 'POST', `${TOOLS}/prescription`, { data: body });
    diffs.push(...statusDiff(lb.status, nb.status).map((d) => ({ ...d, key: `invalid(${name}).${d.key}` })));
    if (lb.body?.error !== nb.body?.error) diffs.push({ kind: 'changed', key: `invalid(${name}).error`, legacy: lb.body?.error, native: nb.body?.error });
    expect(lb.status, name).toBe(400);
  }
  const result = recorder.record({
    entry: entry('prescription-save').id, mechanism: 'write-readback', role: 'admin', title: '處方箋存檔與驗證（月份 5 vs 6）',
    legacy: { endpoint: 'POST /api/prescription-monthly', status: l.status }, native: { endpoint: 'POST performance-tools/prescription', status: n.status },
    compared: { stores: records.length, invalidCases: bad.length }, diffs, durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
  expect(l.status).toBe(200);
});

for (const role of ['admin', 'performance_view']) {
  test(`處方箋範本下載（匯出）對等 ${role}：Excel 逐工作表、逐欄、逐格`, async () => {
    const started = Date.now();
    const api = await as(role);
    const params = { year_month: `${YEAR}-03` };
    const [l, n] = await Promise.all([api.get('/api/prescription-monthly/template', { params }), api.get(`${TOOLS}/prescription-template`, { params })]);
    const diffs: Diff[] = [...statusDiff(l.status(), n.status())];
    const compared: Record<string, number | string> = { legacyStatus: l.status(), nativeStatus: n.status() };
    if (l.status() === 200 && n.status() === 200) {
      for (const h of ['content-type', 'content-disposition']) {
        if ((l.headers()[h] || '') !== (n.headers()[h] || '')) diffs.push({ kind: 'changed', key: `header#${h}`, legacy: l.headers()[h], native: n.headers()[h] });
      }
      const cmp = compareWorkbooks(await l.body(), await n.body());
      diffs.push(...cmp.diffs);
      Object.assign(compared, cmp.stats);
      expect(cmp.stats.cells, '範本必須有內容').toBeGreaterThan(5);
    }
    const result = recorder.record({
      entry: entry('prescription-template').id, mechanism: 'api-read', role, title: '處方箋 Excel 範本（2038-03）',
      legacy: { endpoint: 'GET /api/prescription-monthly/template', status: l.status() }, native: { endpoint: 'GET performance-tools/prescription-template', status: n.status() },
      compared, diffs, durationMs: Date.now() - started,
    });
    assertNoUnlistedDiffs(result);
    if (role === 'admin') expect(l.status()).toBe(200);
  });
}

// ---------------------------------------------------------------------------
// 每月獎金
// ---------------------------------------------------------------------------

for (const role of ['admin', 'performance_view', 'ops_assistant', 'denied']) {
  test(`每月獎金讀取對等 ${role}`, async () => {
    const api = await as(role);
    const read = entry('bonus-read');
    const r1 = await compareApiRead({
      recorder, entry: read.id, title: '每月獎金 records（2038-04）', role, legacyApi: api,
      legacy: { ...(read.legacy.api as LegacyApiSource), query: { year_month: `${YEAR}-04` } },
      native: { ...(read.native.api as NativeApiSource), query: { year_month: `${YEAR}-04` } },
      compareKey: read.compareKey,
    });
    assertNoUnlistedDiffs(r1);
    const avg = entry('bonus-averages');
    for (const mode of ['continuous_employee', 'person_month']) {
      const query = { as_of_year_month: `${YEAR}-04`, start_year_month: `${YEAR}-01`, average_mode: mode };
      const r2 = await compareApiRead({
        recorder, entry: avg.id, title: `年度累積平均（${mode}）`, role, legacyApi: api,
        legacy: { ...(avg.legacy.api as LegacyApiSource), query },
        native: { ...(avg.native.api as NativeApiSource), query },
      });
      assertNoUnlistedDiffs(r2);
    }
    if (role === 'admin') expect(Number(r1.compared.legacyRows)).toBeGreaterThanOrEqual(2);
  });
}

test('督導與門市清單對等（admin）', async () => {
  const e = entry('bonus-stores');
  const result = await compareApiRead({
    recorder, entry: e.id, title: '督導與門市清單', role: 'admin', legacyApi: admin,
    legacy: e.legacy.api as LegacyApiSource, native: e.native.api as NativeApiSource,
  });
  assertNoUnlistedDiffs(result);
});

for (const role of ['performance_view', 'ops_manager', 'navigation', 'ops_assistant', 'denied']) {
  test(`每月獎金匯入權限對等 ${role}（不帶檔案，不寫資料）`, async () => {
    const started = Date.now();
    const api = await as(role);
    const l = await send(api, 'POST', '/api/performance-bonus/import', { multipart: { year: YEAR } });
    const n = await send(api, 'POST', `${TOOLS}/bonus-import`, { multipart: { year: YEAR } });
    const result = recorder.record({
      entry: entry('bonus-import-permission').id, mechanism: 'write-readback', role, title: '每月獎金匯入權限',
      legacy: { endpoint: 'POST /api/performance-bonus/import', status: l.status }, native: { endpoint: 'POST performance-tools/bonus-import', status: n.status },
      compared: {}, diffs: statusDiff(l.status, n.status), durationMs: Date.now() - started,
    });
    assertNoUnlistedDiffs(result);
  });
}

// ---------------------------------------------------------------------------
// 畫面行為（以舊頁與新頁原始碼特徵擷取）
// ---------------------------------------------------------------------------

test('畫面行為對照：差異逐項記錄並對應白名單', async () => {
  const started = Date.now();
  const legacyPage = read('app/admin/performance/page.tsx');
  const legacyRx = read('components/performance/PrescriptionTab.tsx');
  const group = read('vue-workspace/src/pages/PerformanceGroup.vue');
  const rx = read('vue-workspace/src/pages/PerformancePrescription.vue');
  const bonus = read('vue-workspace/src/pages/PerformanceBonus.vue');
  const api = read('vue-workspace/src/api.ts');
  const features: { key: string; legacyHas: boolean; nativeHas: boolean; legacy: string; native: string; kind: 'changed' | 'only-native' }[] = [
    { key: 'ui#row-edit', legacyHas: legacyPage.includes('async function saveRow(') && legacyPage.includes('setField(month'), nativeHas: group.includes('work.open("performance-edit"'), legacy: '逐月明細：儲存格直接編輯、逐列儲存', native: '點月份開新分頁，以表單編輯後存檔', kind: 'changed' },
    { key: 'ui#thresholds-editor', legacyHas: legacyPage.includes('startEditThreshold'), nativeHas: group.includes("openTool('performance-thresholds')"), legacy: '閾值在年度頁內就地編輯', native: '閾值另開分頁編輯', kind: 'changed' },
    { key: 'ui#import-confirmation', legacyHas: /onChange=\{handleImport\}/.test(legacyPage), nativeHas: group.includes('確認匯入業績'), legacy: '選檔後立即匯入', native: '選檔後須在確認視窗按「確認匯入」', kind: 'changed' },
    { key: 'ui#prescription-dirty-switch', legacyHas: legacyRx.includes("window.confirm('放棄尚未儲存的處方箋修改？')"), nativeHas: rx.includes(':disabled="tab.dirty || tab.busy || loading"'), legacy: '未儲存就切換：跳出確認視窗（可選擇放棄）', native: '未儲存時查詢條件被鎖住，須先儲存', kind: 'changed' },
    { key: 'ui#bonus-sort-interaction', legacyHas: legacyPage.includes('onContextMenu={e => { e.preventDefault(); handleSortClear'), nativeHas: bonus.includes('@click="sortBy(c[0])"') && !bonus.includes('contextmenu'), legacy: '欄位排序：左鍵排序、右鍵取消', native: '欄位排序：點按鈕切換升冪、降冪（沒有右鍵取消）', kind: 'changed' },
    { key: 'ui#import-timeout-message', legacyHas: legacyPage.includes('匯入逾時（超過 180 秒）'), nativeHas: api.includes('連線中斷或逾時，內容仍保留，請稍後重試'), legacy: '匯入逾時：「匯入逾時（超過 180 秒）- 伺服器忙碌，請稍後重試」', native: '逾時：「連線中斷或逾時，內容仍保留，請稍後重試」', kind: 'changed' },
    { key: 'ui#import-store-selector', legacyHas: !legacyPage.includes('匯入門市'), nativeHas: group.includes('aria-label="匯入門市"'), legacy: '(無)：匯入使用工具列所選門市，未選時依 Excel 門市代號', native: '匯入區塊有「匯入門市」選項：目前門市／不指定門市', kind: 'only-native' },
    { key: 'ui#threshold-auto-reload', legacyHas: !legacyPage.includes('BroadcastChannel'), nativeHas: group.includes('onThresholdsSaved'), legacy: '(無)：閾值在同頁就地編輯，儲存即生效', native: '閾值另開分頁儲存後，已開啟的年度頁自動重新載入（W03-q4）', kind: 'only-native' },
  ];
  const diffs: Diff[] = [];
  for (const f of features) {
    expect(f.legacyHas, `${f.key}：舊版特徵已不存在，請更新對照`).toBe(true);
    expect(f.nativeHas, `${f.key}：新版特徵已不存在，請更新對照`).toBe(true);
    diffs.push({ kind: f.kind, key: f.key, legacy: f.legacy, native: f.native });
  }
  const result = recorder.record({
    entry: entry('ui-behavior').id, mechanism: 'ui-extract', title: '畫面行為對照（原始碼特徵）',
    legacy: { endpoint: '/admin/performance', status: 'source' }, native: { endpoint: 'vue-workspace/src/pages/Performance*.vue', status: 'source' },
    compared: { features: features.length }, diffs, durationMs: Date.now() - started,
  });
  assertNoUnlistedDiffs(result);
  expect(result.diffs.length).toBe(features.length);
});

// 預設值檢查：避免閾值預設表被改成與舊版不同。
test('閾值預設表與舊版常數相同', async () => {
  expect(MONTHLY_THRESHOLDS.map((t) => t.baseAmount)).toEqual(DEFAULT_MONTHLY);
  expect(QUARTERLY_THRESHOLDS.map((t) => t.baseAmount)).toEqual(DEFAULT_QUARTERLY);
});
