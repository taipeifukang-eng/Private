// M7/M8 第 6 批 G23 水電網費規則（純函式，無外部相依，單元測試直接引用；伺服端 API 與頁面共用）。
// 與資料庫函式（ga_ub_*、ga_ws_ub_*）逐條對齊：逾期定義、金額異常基準（V7）、標記已繳日期範圍（V8）、已繳帳單關鍵欄位確認（V6）、權限碼、列表與報表參數整形、其他據點名稱正規化。
// 資料庫是最後一道防線（同交易、鎖列、版本檢查、唯一鍵）；這裡讓 API 在送出前先擋掉明顯錯誤，並讓畫面與測試用同一套說法。
import { isUuid } from "./rules";

// ---------------------------------------------------------------- 權限碼（與資料庫 ga_ub_can_* 相同）
export const UB = { view: "general_affairs.utility_bill.view", manage: "general_affairs.utility_bill.manage" } as const;

type Has = { has(code: string): boolean };
export function utilityBillAbilities(p: Has) {
  const manage = p.has(UB.manage);
  const view = manage || p.has(UB.view);
  return { canView: view, canManage: manage };
}
export type UtilityBillAbilities = ReturnType<typeof utilityBillAbilities>;

// ---------------------------------------------------------------- 類型
export const EXPENSE_TYPES = ["WATER", "ELECTRICITY", "PHONE", "INTERNET"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = { WATER: "水費", ELECTRICITY: "電費", PHONE: "電話費", INTERNET: "網路費" };
export const isExpenseType = (v: unknown): v is ExpenseType => (EXPENSE_TYPES as readonly string[]).includes(String(v));
export function identifierLabel(type: string) {
  if (type === "ELECTRICITY") return "電號";
  if (type === "WATER") return "水號";
  if (type === "PHONE") return "電話號碼／用戶號碼";
  return "電路編號／用戶號碼";
}
export const BILL_STATUSES = ["paid", "unpaid", "overdue", "no_due"] as const;
export const BILL_STATUS_LABELS: Record<string, string> = { paid: "已繳費", unpaid: "待繳費", overdue: "已逾期", no_due: "未填繳費期限", deleted: "已刪除" };

// ---------------------------------------------------------------- 日期（台北）
export function taipeiToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
/** 帳單月份 YYYY-MM 或 YYYY-MM-DD -> 該月 1 日；不合法回 null。 */
export function monthStart(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return null;
  const first = `${s.slice(0, 7)}-01`;
  return isValidDate(first) ? first : null;
}
/** 月份往前（負數）或往後推幾個月，回該月 1 日。 */
export function shiftMonth(first: string, months: number): string {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 逾期（V8）
type DueFields = { paid_at?: string | null; due_date?: string | null; deleted_at?: string | null };
/** 逾期＝未刪除、未繳、有到期日且早於台北今天（到期當天不算逾期；沒填到期日的永不逾期）。 */
export function isOverdue(b: DueFields, today: string = taipeiToday()): boolean {
  return !b.deleted_at && !b.paid_at && !!b.due_date && b.due_date < today;
}
export function billStatus(b: DueFields, today: string = taipeiToday()): "deleted" | "paid" | "overdue" | "unpaid" {
  if (b.deleted_at) return "deleted";
  if (b.paid_at) return "paid";
  return isOverdue(b, today) ? "overdue" : "unpaid";
}
/** 沒填到期日的未繳帳單（另列提示，不計入逾期與徽章）。 */
export const isNoDueDate = (b: DueFields) => !b.deleted_at && !b.paid_at && !b.due_date;

// ---------------------------------------------------------------- 標記已繳日期範圍（V8）
/** 繳費日期可選範圍：最早＝帳單月份前 1 個月的 1 日，最晚＝台北今天。 */
export function paidDateRange(billingMonth: string, today: string = taipeiToday()): { min: string; max: string } {
  const first = monthStart(billingMonth) || billingMonth;
  return { min: shiftMonth(first, -1), max: today };
}
export function validatePaidDate(paid: string, billingMonth: string, today: string = taipeiToday()): { ok: true } | { ok: false; code: "PAID_FUTURE" | "PAID_TOO_EARLY" | "DATE_FORMAT"; message: string } {
  if (!isValidDate(paid)) return { ok: false, code: "DATE_FORMAT", message: "繳費日期格式要是 YYYY-MM-DD" };
  const r = paidDateRange(billingMonth, today);
  if (paid > r.max) return { ok: false, code: "PAID_FUTURE", message: `繳費日期不能是未來的日期（今天是 ${today}）` };
  if (paid < r.min) return { ok: false, code: "PAID_TOO_EARLY", message: `繳費日期不能早於帳單月份的前 1 個月（這筆帳單最早可選 ${r.min}）` };
  return { ok: true };
}

// ---------------------------------------------------------------- 金額異常（V7）
export type AnomalySample = { billing_month: string; amount: number };
export type AnomalyResult = { warn: boolean; reason: "ZERO" | "HIGH" | "LOW" | null; baseline: number | null; sample_count: number; partial: boolean; samples: AnomalySample[] };
/**
 * 同據點＋同費用類型＋同識別號碼，取帳單月份早於本筆的最近三筆（排除自己與 0 元）算平均：
 * 本筆 > 平均 2 倍、< 平均一半、或本筆為 0 元提醒（恰好 2 倍或一半不提醒）；歷史 0 筆不比較（只提醒 0 元）；1–2 筆照用現有筆數並標「僅 N 筆參考」。
 * history：同鍵的其他帳單（任意順序，含 0 元與本筆月份以後的，函式內自行篩選）。
 */
export function computeAnomaly(history: Array<{ billing_month: string; amount: number }>, current: { billing_month: string; amount: number }): AnomalyResult {
  const samples = history
    .filter((h) => h.billing_month < current.billing_month && Number(h.amount) > 0)
    .sort((a, b) => (a.billing_month < b.billing_month ? 1 : a.billing_month > b.billing_month ? -1 : 0))
    .slice(0, 3)
    .map((h) => ({ billing_month: h.billing_month, amount: Number(h.amount) }));
  const n = samples.length;
  const avg = n ? samples.reduce((s, x) => s + x.amount, 0) / n : null;
  const amount = Number(current.amount);
  let reason: AnomalyResult["reason"] = null;
  if (amount === 0) reason = "ZERO";
  else if (avg !== null && amount > 2 * avg) reason = "HIGH";
  else if (avg !== null && amount < avg / 2) reason = "LOW";
  return { warn: reason !== null, reason, baseline: avg === null ? null : Math.round(avg * 100) / 100, sample_count: n, partial: n > 0 && n < 3, samples };
}

// ---------------------------------------------------------------- 已繳帳單改關鍵欄位（V6）
export const PAID_GUARDED_FIELDS = ["amount", "location", "expense_type", "billing_month", "provider_name", "identifier"] as const;
type Bill = Record<string, unknown>;
/** 已繳帳單的哪些關鍵欄位被改了（金額、據點、類型、月份、供應商、識別號碼）；空陣列＝可直接存。 */
export function paidChangedFields(before: Bill, after: Bill): string[] {
  const norm = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v).trim());
  const out: string[] = [];
  if (Number(before.amount) !== Number(after.amount)) out.push("amount");
  if (norm(before.store_id) !== norm(after.store_id) || norm(before.location_name) !== norm(after.location_name)) out.push("location");
  if (norm(before.expense_type) !== norm(after.expense_type)) out.push("expense_type");
  if (norm(monthStart(before.billing_month)) !== norm(monthStart(after.billing_month))) out.push("billing_month");
  if (norm(before.provider_name) !== norm(after.provider_name)) out.push("provider_name");
  if (norm(before.service_identifier) !== norm(after.service_identifier) || norm(before.equipment_serial) !== norm(after.equipment_serial) || norm(before.account_number) !== norm(after.account_number)) out.push("identifier");
  return out;
}
export const PAID_FIELD_LABELS: Record<string, string> = { amount: "金額", location: "據點", expense_type: "費用類型", billing_month: "帳單月份", provider_name: "供應商", identifier: "識別號碼", delete: "刪除" };

// ---------------------------------------------------------------- 其他據點名稱正規化（報表分組，與資料庫 ga_ws_ub_report 同口徑）
export function normalizeLocationName(value: unknown): string {
  const s = String(value ?? "").trim() || "未命名據點";
  return s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------- 請求整形
export function parseUtilityFilters(params: URLSearchParams): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const month = (params.get("month") || "").trim();
  if (month) {
    if (!monthStart(month)) throw new Error("月份格式要是 YYYY-MM");
    f.month = month.slice(0, 7);
  }
  const type = (params.get("type") || "").trim().toUpperCase();
  if (type) {
    if (!isExpenseType(type)) throw new Error("費用類型篩選值錯誤");
    f.type = type;
  }
  const store = (params.get("storeId") || "").trim();
  if (store) {
    if (!isUuid(store)) throw new Error("據點格式錯誤");
    f.store_id = store;
  }
  const status = (params.get("status") || "").trim();
  if (status) {
    if (!(BILL_STATUSES as readonly string[]).includes(status)) throw new Error("狀態篩選值錯誤");
    f.status = status;
  }
  if (params.get("overdue") === "1" || params.get("overdue") === "true") f.overdue = true;
  if (params.get("deleted") === "1" || params.get("deleted") === "true") f.deleted = true;
  const search = (params.get("search") || "").trim();
  if (search) f.search = search.slice(0, 100);
  return f;
}

export function parseReportParams(params: URLSearchParams): { mode: "month" | "quarter" | "year"; year: number; period: string | null } {
  const mode = params.get("mode");
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("請選擇正確年度");
  if (mode === "month") {
    const period = params.get("period") || "";
    if (!new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(period)) throw new Error("請選擇正確月份");
    return { mode, year, period };
  }
  if (mode === "quarter") {
    const period = params.get("period") || "";
    if (!/^[1-4]$/.test(period)) throw new Error("請選擇正確季度");
    return { mode, year, period };
  }
  if (mode === "year") return { mode, year, period: null };
  throw new Error("請選擇月、季或年報表");
}

/** 新增與編輯送進資料庫函式的欄位（白名單；其他欄位一律丟掉，不信任前端送來的 id、建立者、刪除欄位）。 */
export const BILL_PAYLOAD_FIELDS = [
  "store_id", "location_name", "expense_type", "billing_month", "provider_name", "service_label", "service_identifier", "account_number", "equipment_serial",
  "amount", "electricity_kwh", "due_date", "paid_at", "reference_no", "notes",
] as const;
export function pickBillPayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BILL_PAYLOAD_FIELDS) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  return out;
}
