import { createRequire } from 'node:module';
import type { APIRequestContext } from '@playwright/test';
import { readRowsAsServiceRole } from './parity';
import { registry } from './w01a-fixtures';

const nodeRequire = createRequire(__filename);

/**
 * W03 績效獎金測試資料（D15）。
 *  - 年度固定 2038（保留年份）；門市只用 VW/ZT 測試門市（ZT01、ZT02、VW001 會被改動；
 *    ZT03 專供對等測試的「預設閾值」基準，從不修改閾值；ZT04 專供閾值存檔嚴格度測試）。
 *  - 建立：一律透過 app 自己的 API（admin）寫入，再以 service role「只讀」回查 id，登錄到 tests/support/registry
 *    （store_performance、store_performance_thresholds、monthly_bonus_records 以 id 登錄；
 *    monthly_prescription_reports 沒有 id 欄，由 sweeper 的「保留年份 2038」機制清除）。
 *  - 清除：run-all 的 sweeper(pre/post) 依 created.json 與保留年份規則刪除 2038 年、測試門市的列，
 *    以及測試門市的 store_performance_thresholds（還原為系統預設）；非測試門市出現 2038 年資料時中止（退出碼 3）。
 *  - 測試內若改了閾值，結尾一律用 restoreDefaultThresholds 還原（不依賴 sweeper 才恢復，避免同一次 run 的後續測試被污染）。
 */
export const W03_YEAR = 2038;
export const W03_STORE_CODES = ['ZT01', 'ZT02', 'ZT03', 'ZT04', 'VW001'] as const;
export type W03StoreCode = (typeof W03_STORE_CODES)[number];

export const DEFAULT_MONTHLY = [3000, 5000, 7000, 8000, 10000];
export const DEFAULT_QUARTERLY = [9000, 15000, 21000, 24000, 30000];

/** 取得測試門市 id（admin 的 performance 門市清單）。 */
export async function perfStoreIds(admin: APIRequestContext): Promise<Record<W03StoreCode, string>> {
  const res = await admin.get('/api/workspace/performance', { params: { year: String(W03_YEAR) } });
  if (res.status() !== 200) throw new Error(`讀取績效門市失敗 HTTP ${res.status()}`);
  const body = await res.json();
  const map = {} as Record<W03StoreCode, string>;
  for (const s of body.stores as { id: string; store_code: string }[]) {
    if ((W03_STORE_CODES as readonly string[]).includes(s.store_code)) map[s.store_code as W03StoreCode] = s.id;
  }
  for (const code of W03_STORE_CODES) if (!map[code]) throw new Error(`DEV 缺少測試門市 ${code}`);
  return map;
}

/** 測試資料完整的一個月（所有欄位）。 */
export function perfBody(store: string, month: number, over: Record<string, unknown> = {}) {
  return {
    store_id: store,
    year: W03_YEAR,
    month,
    business_days: 26,
    monthly_gross_profit_target: 780_000,
    monthly_revenue_target: 3_000_000,
    monthly_customer_count_target: 4_000,
    last_month_rx_target: 500,
    monthly_gross_profit_actual: 780_000,
    activity_day_gross_profit: null,
    monthly_revenue_actual: 3_000_000,
    monthly_customer_count_actual: 4_000,
    last_month_rx_actual: 500,
    system_monthly_revenue: null,
    self_pay_monthly_revenue: null,
    monthly_true_gross_profit: null,
    system_monthly_gross_profit: null,
    monthly_long_term_care_gross_profit: null,
    monthly_rx_addon_makeup_gross_profit: null,
    monthly_theft_compensation_makeup_gross_profit: null,
    monthly_kamedis_deduction_gross_profit: null,
    ...over,
  };
}

export async function savePerf(api: APIRequestContext, store: string, month: number, over: Record<string, unknown> = {}) {
  return api.post('/api/workspace/performance', { data: perfBody(store, month, over) });
}

/** 讀回某門市 2038 年的列（service role 只讀）。 */
export async function readPerfRows(store: string, year = W03_YEAR) {
  return readRowsAsServiceRole('store_performance', { eq: { store_id: store, year }, order: 'month' });
}

/** 登錄 fixture 列供 sweeper 依 id 清除（後備清除另有保留年份機制）。 */
export async function registerPerfRows(stores: string[]) {
  const reg = registry();
  const perf = await readRowsAsServiceRole('store_performance', { in: { store_id: stores }, eq: { year: W03_YEAR }, select: 'id' });
  if (perf.length) reg.record({ table: 'store_performance', values: perf.map((r) => String(r.id)), note: 'W03 2038' });
  const th = await readRowsAsServiceRole('store_performance_thresholds', { in: { store_id: stores }, select: 'id' });
  if (th.length) reg.record({ table: 'store_performance_thresholds', values: th.map((r) => String(r.id)), note: 'W03 thresholds' });
  const bonus = await readRowsAsServiceRole('monthly_bonus_records', { in: { store_id: stores }, like: { year_month: `${W03_YEAR}-%` }, select: 'id' });
  if (bonus.length) reg.record({ table: 'monthly_bonus_records', values: bonus.map((r) => String(r.id)), note: 'W03 bonus 2038' });
}

export async function restoreDefaultThresholds(api: APIRequestContext, store: string) {
  const res = await api.post('/api/workspace/performance-tools/thresholds', {
    data: { store_id: store, ...thresholdBody(DEFAULT_MONTHLY, DEFAULT_QUARTERLY) },
  });
  if (res.status() !== 200) throw new Error(`還原閾值失敗 HTTP ${res.status()}`);
}

export function thresholdBody(monthly: number[], quarterly: number[]) {
  return {
    monthly: monthly.map((base_amount, i) => ({ level: i + 1, base_amount })),
    quarterly: quarterly.map((base_amount, i) => ({ level: i + 1, base_amount })),
  };
}

// ---------------------------------------------------------------------------
// Excel 產生（SheetJS）
// ---------------------------------------------------------------------------

export function xlsxBuffer(rows: Record<string, unknown>[], sheetName = '測試'): Buffer {
  const XLSX = nodeRequire('xlsx') as typeof import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function multipartFile(rows: Record<string, unknown>[], name = 'w03.xlsx') {
  return { name, mimeType: XLSX_MIME, buffer: xlsxBuffer(rows) };
}

/** 業績匯入列（舊版欄位名）。 */
export function perfImportRow(code: string | null, month: number, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    ...(code ? { 門市代號: code } : {}),
    年月份: `${W03_YEAR}-${String(month).padStart(2, '0')}`,
    營業天數: 26,
    月毛利額目標: 780000,
    月實際毛利額: 800000,
    月營業額目標: 3000000,
    月營業額實際: 3100000,
    月來客數目標: 4000,
    月實際來客數: 4100,
    上個月慢箋總張數目標: 500,
    上個月慢箋總張數實際: 520,
    ...over,
  };
  return row;
}

/** 測試員編：ZT + runId + 標籤（sweeper 標記）。 */
export function bonusEmployeeCode(tag: string) {
  const runId = process.env.TEST_RUN_ID || 'T00000000-xxxx';
  return `ZT${runId}-${tag}`.toUpperCase();
}
