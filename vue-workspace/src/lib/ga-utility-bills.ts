// G23 水電網費：頁面用的型別與純函式（規則在 lib/workspace/general-affairs/utility-bill-rules.ts，伺服端與頁面共用）。
import { ApiError } from "../api";
import {
  BILL_STATUS_LABELS, EXPENSE_TYPES, EXPENSE_TYPE_LABELS, PAID_FIELD_LABELS, identifierLabel, paidDateRange, taipeiToday,
  type ExpenseType,
} from "../../../lib/workspace/general-affairs/utility-bill-rules";
import { UTILITY_BILL_CODE_MESSAGES } from "../../../lib/workspace/general-affairs/utility-bill-messages";

export { BILL_STATUS_LABELS, EXPENSE_TYPES, EXPENSE_TYPE_LABELS, PAID_FIELD_LABELS, identifierLabel, paidDateRange, taipeiToday };
export type { ExpenseType };

export type StoreOption = { id: string; store_code: string; store_name: string; short_name: string | null };
export type Bill = {
  id: string; store_id: string | null; location_name: string; expense_type: ExpenseType; billing_month: string; provider_name: string | null; service_label: string | null;
  service_identifier: string | null; account_number: string | null; equipment_serial: string | null; amount: number; electricity_kwh: number | null; due_date: string | null; paid_at: string | null;
  reference_no: string | null; notes: string | null; created_at: string; updated_at: string; created_by_name: string | null; updated_by_name: string | null;
  deleted_at: string | null; deleted_by_name: string | null; deletion_reason: string | null; status: "paid" | "unpaid" | "overdue" | "deleted"; overdue: boolean;
  store: { id: string; store_code: string; store_name: string; short_name: string | null; is_active: boolean } | null;
};
export type Abilities = { canView: boolean; canManage: boolean };
export type GlobalStats = { today: string; pending_count: number; pending_amount: number; overdue_count: number; overdue_amount: number; no_due_count: number; no_due_amount: number };
export type FilterSummary = { count: number; total_amount: number; paid_count: number; paid_amount: number; unpaid_count: number; unpaid_amount: number };
export type Anomaly = { warn: boolean; code?: string; reason: "ZERO" | "HIGH" | "LOW" | null; message: string | null; baseline: number | null; sample_count: number; partial: boolean; samples: Array<{ id?: string; billing_month: string; amount: number }> };
export type ReportRow = { store_id: string | null; store_code: string | null; location_name: string; WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };
export type ReportTotals = { WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };

export const money = (n: number | string | null | undefined) => "NT$ " + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
export const dateText = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
export const monthText = (s: string | null | undefined) => (s ? String(s).slice(0, 7) : "");
export const timeText = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "");
export const storeLabel = (s: { store_code: string; store_name: string; short_name?: string | null }) => `${s.store_code} ${s.short_name || s.store_name}`;
/** 帳單的據點顯示：門市（代號＋簡稱）或其他據點名稱，有線路名稱時加在後面。 */
export const siteOf = (b: Bill) => (b.location_name || "") + (b.service_label ? `｜${b.service_label}` : "");

/** 錯誤訊息：伺服端已回白話；沒有訊息時用代碼對照。 */
export function errorText(e: unknown, fallback = "操作失敗，請稍後重試") {
  if (e instanceof ApiError) {
    const code = String(e.data?.code || "");
    return e.message && e.message !== "服務暫時無法使用，請重試" ? e.message : UTILITY_BILL_CODE_MESSAGES[code] || e.message || fallback;
  }
  return (e as Error)?.message || fallback;
}
export const errorCodeOf = (e: unknown) => (e instanceof ApiError ? String(e.data?.code || "") : "");
export const errorDataOf = (e: unknown) => (e instanceof ApiError ? e.data || {} : {});

export type BillForm = {
  store_id: string; location_name: string; expense_type: ExpenseType; billing_month: string; provider_name: string; service_label: string; service_identifier: string; account_number: string;
  equipment_serial: string; amount: string; electricity_kwh: string; due_date: string; paid_at: string; reference_no: string; notes: string;
};
export const emptyBillForm = (): BillForm => ({
  store_id: "", location_name: "", expense_type: "WATER", billing_month: taipeiToday().slice(0, 7), provider_name: "", service_label: "", service_identifier: "", account_number: "",
  equipment_serial: "", amount: "", electricity_kwh: "", due_date: "", paid_at: "", reference_no: "", notes: "",
});
export function formFromBill(b: Bill): BillForm {
  const t = (v: unknown) => (v == null ? "" : String(v));
  return {
    store_id: t(b.store_id), location_name: t(b.location_name), expense_type: b.expense_type, billing_month: monthText(b.billing_month), provider_name: t(b.provider_name), service_label: t(b.service_label),
    service_identifier: t(b.service_identifier), account_number: t(b.account_number), equipment_serial: t(b.equipment_serial), amount: t(b.amount), electricity_kwh: t(b.electricity_kwh),
    due_date: dateText(b.due_date), paid_at: dateText(b.paid_at), reference_no: t(b.reference_no), notes: t(b.notes),
  };
}
/** 送出欄位：全部欄位都帶（編輯時是完整表單的值）；空字串送成 null 讓資料庫清除。 */
export function payloadFromForm(f: BillForm): Record<string, unknown> {
  // type=number 的輸入框經 v-model 會變成數字（Vue 自動轉型），所以欄位一律先轉成字串再處理。
  const n = (s: unknown) => (String(s ?? "").trim() === "" ? null : String(s).trim());
  return {
    store_id: f.store_id || null, location_name: n(f.location_name), expense_type: f.expense_type, billing_month: f.billing_month, provider_name: n(f.provider_name), service_label: n(f.service_label),
    service_identifier: n(f.service_identifier), account_number: n(f.account_number), equipment_serial: f.expense_type === "INTERNET" ? n(f.equipment_serial) : null,
    amount: n(f.amount), electricity_kwh: f.expense_type === "ELECTRICITY" ? n(f.electricity_kwh) : null, due_date: n(f.due_date), paid_at: n(f.paid_at),
    reference_no: n(f.reference_no), notes: n(f.notes),
  };
}
/** 送出前的欄位檢查（回白話說明；空字串＝可送出）。資料庫仍是最後一道防線。 */
export function formProblem(f: BillForm): string {
  if (!f.store_id && !f.location_name.trim()) return "請選擇門市，或輸入其他據點名稱";
  if (!/^\d{4}-\d{2}$/.test(f.billing_month)) return "請選擇帳單月份";
  const amount = String(f.amount ?? "").trim();
  if (amount === "") return "請輸入金額";
  if (!/^\d+(\.\d+)?$/.test(amount)) return "金額不可為負數或含文字";
  if (f.expense_type === "INTERNET" && !f.service_identifier.trim() && !f.equipment_serial.trim()) return "網路費請至少填寫電路編號或設備序號";
  if (f.expense_type !== "INTERNET" && !f.service_identifier.trim()) return `請填寫${identifierLabel(f.expense_type)}`;
  if (f.paid_at) {
    const r = paidDateRange(f.billing_month + "-01");
    if (f.paid_at > r.max) return `繳費日期不能是未來的日期（今天是 ${r.max}）`;
    if (f.paid_at < r.min) return `繳費日期不能早於帳單月份的前 1 個月（最早 ${r.min}）`;
  }
  return "";
}
