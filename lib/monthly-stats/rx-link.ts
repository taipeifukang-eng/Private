// 每月人員狀態「該月營業狀態」的處方箋連動：純函式，無任何 I/O。
// 一般箋張數、慢箋張數、健保總點值取自業績管理處方箋 monthly_prescription_reports（即時讀取，不另存）。

export const NO_DATA_TEXT = '暫無資料';
export const LEGACY_IMPORT_NOTE = '舊匯入';

export type RxReportRow = {
  regular_prescription_count: number | string | null;
  regular_prescription_point_value: number | string | null;
  chronic_prescription_count: number | string | null;
  chronic_prescription_point_value: number | string | null;
} | null;

export type LegacySummary = {
  regular_prescription_count?: number | null;
  chronic_prescription_count?: number | null;
} | null;

export type RxCountDisplay = {
  value: number | null;
  source: 'prescription' | 'legacy' | 'none';
  text: string;
  legacy: boolean;
};

export type RxTotalPointDisplay = {
  value: number | null;
  text: string;
};

export type RxLinkDisplay = {
  regular: RxCountDisplay;
  chronic: RxCountDisplay;
  totalPoint: RxTotalPointDisplay;
};

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function isHeadOfficeStoreCode(code: unknown): boolean {
  return String(code ?? '').trim() === '0000';
}

/** 兩個點值相加，用 4 位小數的整數（萬分位）運算避免浮點誤差；任一為空則回 null。 */
export function sumPointValues(a: unknown, b: unknown): number | null {
  const x = toNumberOrNull(a);
  const y = toNumberOrNull(b);
  if (x === null || y === null) return null;
  const SCALE = 10000;
  return (Math.round(x * SCALE) + Math.round(y * SCALE)) / SCALE;
}

/** 整數、千分位（四捨五入）；內部值不受影響。 */
export function formatPointValue(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return NO_DATA_TEXT;
  return Math.round(v).toLocaleString('en-US');
}

export function formatCount(v: number): string {
  return v.toLocaleString('en-US');
}

function resolveCount(reportValue: unknown, legacyValue: unknown): RxCountDisplay {
  const fromReport = toNumberOrNull(reportValue);
  if (fromReport !== null) {
    return { value: fromReport, source: 'prescription', text: formatCount(fromReport), legacy: false };
  }
  const old = toNumberOrNull(legacyValue);
  if (old !== null) {
    return { value: old, source: 'legacy', text: formatCount(old), legacy: true };
  }
  return { value: null, source: 'none', text: NO_DATA_TEXT, legacy: false };
}

/**
 * 決定三個欄位顯示內容。
 * - 處方箋有值就用處方箋；張數為空（或該月該店無資料）退回 monthly_store_summary 舊匯入值並標示。
 * - 點值沒有舊值；健保總點值需一般箋、慢箋兩個點值都有才算。
 * - 總公司 0000 一律暫無資料（不退回舊值）。
 */
export function resolveRxLinkDisplay(input: {
  report: RxReportRow;
  legacySummary: LegacySummary;
  isHeadOffice?: boolean;
}): RxLinkDisplay {
  const { report, legacySummary, isHeadOffice } = input;
  if (isHeadOffice) {
    const none = (): RxCountDisplay => ({ value: null, source: 'none', text: NO_DATA_TEXT, legacy: false });
    return { regular: none(), chronic: none(), totalPoint: { value: null, text: NO_DATA_TEXT } };
  }
  const regular = resolveCount(report?.regular_prescription_count, legacySummary?.regular_prescription_count);
  const chronic = resolveCount(report?.chronic_prescription_count, legacySummary?.chronic_prescription_count);
  const total = sumPointValues(report?.regular_prescription_point_value, report?.chronic_prescription_point_value);
  return { regular, chronic, totalPoint: { value: total, text: formatPointValue(total) } };
}

// ---- 寫入端防護 ----

/** 這兩個欄位改由處方箋提供，任何月統計寫入路徑都不可再帶。 */
export const RX_DERIVED_SUMMARY_KEYS = ['regular_prescription_count', 'chronic_prescription_count'] as const;

export function stripRxDerivedKeys<T extends Record<string, unknown>>(
  stats: T
): Omit<T, 'regular_prescription_count' | 'chronic_prescription_count'> {
  const copy: Record<string, unknown> = { ...stats };
  for (const k of RX_DERIVED_SUMMARY_KEYS) delete copy[k];
  return copy as Omit<T, 'regular_prescription_count' | 'chronic_prescription_count'>;
}

/** 匯入門市統計 Excel 單列 → 要寫入 monthly_store_summary 的欄位（不含一般箋、慢箋）。 */
export function buildStoreStatsImportPayload(
  row: Record<string, any>,
  store: { store_code: string; store_name: string | null }
) {
  return {
    store_name: store.store_name || store.store_code,
    store_code: store.store_code,
    total_staff_count: parseInt(row['門市人數']) || 0,
    admin_staff_count: parseInt(row['行政人數']) || 0,
    newbie_count: parseInt(row['新人人數']) || 0,
    business_days: parseFloat(row['營業天數']) || 0,
    total_gross_profit: parseFloat(row['毛利']) || 0,
    total_customer_count: parseInt(row['總來客數']) || 0,
    prescription_addon_only_count: parseInt(row['單純處方加購來客數']) || 0,
  };
}

/** 支援時數表單存檔內容：沿用既有統計欄位，只改支援時數，不帶一般箋、慢箋。 */
export function buildSupportHoursUpdate(
  existing: Record<string, any> | null | undefined,
  hours: { support_to_other_stores_hours: number; support_from_other_stores_hours: number }
) {
  return {
    total_staff_count: existing?.total_staff_count ?? 0,
    admin_staff_count: existing?.admin_staff_count ?? 0,
    newbie_count: existing?.newbie_count ?? 0,
    business_days: existing?.business_days ?? 0,
    total_gross_profit: existing?.total_gross_profit ?? 0,
    total_customer_count: existing?.total_customer_count ?? 0,
    prescription_addon_only_count: existing?.prescription_addon_only_count ?? 0,
    support_to_other_stores_hours: hours.support_to_other_stores_hours,
    support_from_other_stores_hours: hours.support_from_other_stores_hours,
  };
}
