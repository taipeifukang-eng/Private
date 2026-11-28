// 水電帳單「計費期間（起～迄）」規則（純函式；伺服端 API、頁面、紙本列印、Excel 共用，單元測試直接引用）。
// 與資料庫 ga_ws_ub_save 逐條對齊：水費、電費必填、電話與網路選填；起迄要一起填或一起留空；迄日不得早於起日；天數＝迄－起＋1（含頭含尾）；超過 70 天只提醒不擋。
// 注意：根目錄 tsconfig 的 target 較低，這裡不對 Set/Map 用展開或 for-of。
import { EXPENSE_TYPE_LABELS, EXPENSE_TYPES, isValidDate, type ExpenseType } from "./utility-bill-rules";

export const PERIOD_REQUIRED_TYPES: ReadonlyArray<string> = ["WATER", "ELECTRICITY"];
export const PERIOD_LONG_DAYS = 70;
export const PERIOD_FIELDS = ["service_period_start", "service_period_end"] as const;

export const isPeriodRequired = (type: string | null | undefined) => PERIOD_REQUIRED_TYPES.indexOf(String(type ?? "")) >= 0;

const DAY = 86400000;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayOf = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");

/** 計費天數（含頭含尾）；任一邊空白或不合法或迄早於起回 null。 */
export function periodDays(start: unknown, end: unknown): number | null {
  const s = dayOf(start);
  const e = dayOf(end);
  if (!isValidDate(s) || !isValidDate(e)) return null;
  const n = Math.round((ts(e) - ts(s)) / DAY) + 1;
  return n >= 1 ? n : null;
}
export const isLongPeriod = (days: number | null) => days !== null && days > PERIOD_LONG_DAYS;
/** 某日期加減幾天（YYYY-MM-DD）。 */
export const addDays = (d: string, n: number): string => iso(ts(d) + n * DAY);

export type PeriodCheck = { ok: true; days: number | null; long: boolean } | { ok: false; code: "PERIOD_INCOMPLETE" | "PERIOD_REQUIRED" | "PERIOD_ORDER" | "DATE_FORMAT"; message: string };
/**
 * 檢查計費期間（空字串、null、undefined 都算沒填）。
 * isLegacyEdit：編輯一筆原本沒有期間的舊水電帳單，訊息改成「請補填」。
 */
export function checkPeriod(type: string | null | undefined, start: unknown, end: unknown, isLegacyEdit = false): PeriodCheck {
  const s = String(start ?? "").trim();
  const e = String(end ?? "").trim();
  if ((s && !isValidDate(s)) || (e && !isValidDate(e))) return { ok: false, code: "DATE_FORMAT", message: "計費期間的日期格式要是 YYYY-MM-DD" };
  if (!s !== !e) return { ok: false, code: "PERIOD_INCOMPLETE", message: "計費起日與迄日要一起填（或一起留空）" };
  if (!s) {
    if (isPeriodRequired(type)) return { ok: false, code: "PERIOD_REQUIRED", message: isLegacyEdit ? "水費、電費請填寫計費期間（起日與迄日）；這筆舊帳單原本沒有填，請這次一併補上" : "水費、電費請填寫計費期間（起日與迄日）" };
    return { ok: true, days: null, long: false };
  }
  if (e < s) return { ok: false, code: "PERIOD_ORDER", message: "計費迄日不能早於起日" };
  const days = periodDays(s, e);
  return { ok: true, days, long: isLongPeriod(days) };
}
export const longPeriodMessage = (days: number) => `計費期間共 ${days} 天，超過 ${PERIOD_LONG_DAYS} 天，請確認起迄日是否正確。`;

/** 與上一期（迄日）的銜接：起日＝上一期迄日＋1 為正常；其餘是空檔（起日較晚）或重疊（起日較早或同一天）。 */
export function gapNote(start: unknown, prevEnd: unknown): { kind: "ok" | "gap" | "overlap"; days: number; message: string } | null {
  const s = dayOf(start);
  const p = dayOf(prevEnd);
  if (!isValidDate(s) || !isValidDate(p)) return null;
  const diff = Math.round((ts(s) - ts(p)) / DAY); // 正常＝1
  if (diff === 1) return { kind: "ok", days: 0, message: "" };
  if (diff > 1) return { kind: "gap", days: diff - 1, message: `和上一期（迄 ${slashDate(p)}）中間空了 ${diff - 1} 天，請確認起日是否正確。` };
  return { kind: "overlap", days: 1 - diff, message: `和上一期（迄 ${slashDate(p)}）有 ${1 - diff} 天重疊，請確認起日是否正確。` };
}

/** 2026-11-05 → 2026/11/05；空值回空字串。 */
export const slashDate = (v: unknown): string => {
  const d = dayOf(v);
  return isValidDate(d) ? d.replace(/-/g, "/") : "";
};
/** 畫面用：2026/11/05～2027/01/04（61 天）；沒有期間回空字串。 */
export function periodText(start: unknown, end: unknown, withDays = true): string {
  const s = slashDate(start);
  const e = slashDate(end);
  if (!s || !e) return "";
  const n = periodDays(start, end);
  return `${s}～${e}${withDays && n !== null ? `（${n} 天）` : ""}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });
/**
 * 紙本請款單事由後的計費期間（單一段）：同年 → 「水費 11/05～12/04」；跨年 → 民國年完整寫「水費 114/12/05～115/01/04」（讓人看得懂）。
 * label＝費用類型名稱（寫在期間前面）；沒有期間回空字串。跨年判斷以這一段自己的起迄為準。
 */
export function paperPeriodText(start: unknown, end: unknown, label = ""): string {
  const s = dayOf(start);
  const e = dayOf(end);
  if (!isValidDate(s) || !isValidDate(e)) return "";
  const a = parts(s);
  const b = parts(e);
  const head = label ? `${label} ` : "";
  if (a.y === b.y) return `${head}${pad2(a.m)}/${pad2(a.d)}～${pad2(b.m)}/${pad2(b.d)}`;
  return `${head}${a.y - 1911}/${pad2(a.m)}/${pad2(a.d)}～${b.y - 1911}/${pad2(b.m)}/${pad2(b.d)}`;
}
/**
 * 一列（同一門市）多張帳單的事由期間：依費用類型分段，每種有期間的類型各寫一段「水費 01/01～03/31」，用「、」相連；
 * 同類型多張取最早起日～最晚迄日；沒有期間的類型不寫；都沒有回空字串。類型順序依第一次出現的順序。
 */
export function paperPeriodsByType(list: Array<{ expense_type?: string | null; service_period_start?: string | null; service_period_end?: string | null }>): string {
  const order: string[] = [];
  const buckets: Record<string, Array<{ service_period_start?: string | null; service_period_end?: string | null }>> = {};
  for (let i = 0; i < list.length; i += 1) {
    const t = String(list[i].expense_type ?? "").trim();
    if (order.indexOf(t) < 0) { order.push(t); buckets[t] = []; }
    buckets[t].push(list[i]);
  }
  const segs: string[] = [];
  for (let i = 0; i < order.length; i += 1) {
    const m = mergePeriods(buckets[order[i]]);
    if (!m) continue;
    const seg = paperPeriodText(m.start, m.end, EXPENSE_TYPE_LABELS[order[i] as ExpenseType] ?? order[i]);
    if (seg) segs.push(seg);
  }
  return segs.join("、");
}
/** 一組帳單（同一列）的合併計費期間：取最早起日～最晚迄日；都沒有期間回 null。 */
export function mergePeriods(list: Array<{ service_period_start?: string | null; service_period_end?: string | null }>): { start: string; end: string } | null {
  let start = "";
  let end = "";
  for (let i = 0; i < list.length; i += 1) {
    const s = dayOf(list[i].service_period_start);
    const e = dayOf(list[i].service_period_end);
    if (!isValidDate(s) || !isValidDate(e)) continue;
    if (!start || s < start) start = s;
    if (!end || e > end) end = e;
  }
  return start && end ? { start, end } : null;
}

// ---------------------------------------------------------------- Excel「帳單明細」頁
export type DetailRow = {
  bill_id?: string; store_id?: string | null; store_code?: string | null; location_name: string; expense_type: string; billing_month: string;
  service_period_start?: string | null; service_period_end?: string | null; period_days?: number | null; electricity_kwh?: number | string | null; amount: number | string;
  identifier?: string | null; service_label?: string | null;
};
export const DETAIL_SHEET_NAME = "帳單明細";
export const DETAIL_HEADERS = ["門市／據點", "費用類型", "帳單月份", "計費起", "計費迄", "天數", "度數", "金額", "每日平均金額", "識別號碼"] as const;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const typeRank = (t: string) => {
  const i = (EXPENSE_TYPES as ReadonlyArray<string>).indexOf(t);
  return i < 0 ? 99 : i;
};
export type DetailSheetRow = Array<string | number>;
/** 每日平均金額＝金額 ÷ 天數（取兩位小數）；沒有期間回 null。 */
export const dailyAverage = (amount: number | string, days: number | null): number | null => (days && days > 0 ? round2(Number(amount) / days) : null);
/** 「帳單明細」工作表：每張帳單一列，排序 門市→費用類型→帳單月份；沒有期間的天數、每日平均留空；度數只有電費才有。 */
export function detailSheet(rows: DetailRow[]): { name: string; aoa: DetailSheetRow[] } {
  const sorted = rows.slice().sort((a, b) => {
    const ka = (a.store_code || "￿") + "|" + a.location_name;
    const kb = (b.store_code || "￿") + "|" + b.location_name;
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (typeRank(a.expense_type) !== typeRank(b.expense_type)) return typeRank(a.expense_type) - typeRank(b.expense_type);
    const ma = String(a.billing_month).slice(0, 7);
    const mb = String(b.billing_month).slice(0, 7);
    if (ma !== mb) return ma < mb ? -1 : 1;
    const ia = String(a.identifier || "");
    const ib = String(b.identifier || "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  const aoa: DetailSheetRow[] = [DETAIL_HEADERS.slice() as string[]];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i];
    const days = r.service_period_start && r.service_period_end ? periodDays(r.service_period_start, r.service_period_end) : null;
    const avg = dailyAverage(r.amount, days);
    aoa.push([
      r.location_name,
      EXPENSE_TYPE_LABELS[r.expense_type as ExpenseType] ?? r.expense_type,
      String(r.billing_month).slice(0, 7),
      days === null ? "" : slashDate(r.service_period_start),
      days === null ? "" : slashDate(r.service_period_end),
      days === null ? "" : days,
      r.expense_type === "ELECTRICITY" && r.electricity_kwh !== null && r.electricity_kwh !== undefined && String(r.electricity_kwh) !== "" ? round2(Number(r.electricity_kwh)) : "",
      round2(Number(r.amount)),
      avg === null ? "" : avg,
      r.identifier ? String(r.identifier) : "",
    ]);
  }
  return { name: DETAIL_SHEET_NAME, aoa };
}

/** 讀「上一期」的查詢參數整形（GET utility-bills/prev-period）。 */
export function parsePrevPeriodParams(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = ["store_id", "location_name", "expense_type", "service_identifier", "equipment_serial", "account_number", "exclude_id"];
  for (let i = 0; i < keys.length; i += 1) {
    const v = (params.get(keys[i]) || "").trim();
    if (v) out[keys[i]] = v.slice(0, 200);
  }
  return out;
}
