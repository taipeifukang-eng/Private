// 請款單「付款日到期自動標記已付款」規則（純函式，無資料庫相依；API、Vue 頁面與單元測試共用）。
// 與資料庫 ga_pay_auto_pay_date、ga_apply_due_payment_requests、ga_ws_pay_request_cancel_auto_pay 逐條對齊（20261127100000_ga_auto_pay_due.sql）：
//   付款日 = 預計付款日；沒填時水電用所含帳單最早的繳費期限，採購沒有就不自動。只處理已送出、沒取消過自動付款、付款日 <= 今天（台北）的單。
//   付款方式用單上已有的，沒有記轉帳；paid_date = 付款日（不是執行日）；取消自動付款只限系統自動標記的已付款單，原因必填，取消後這張單不再自動。
import { isRealDate, taipeiToday } from "./payment-rules";

export const AUTO_PAY_REASON = "付款日到期，系統自動標記已付款";
export const AUTO_PAY_DEFAULT_METHOD = "TRANSFER";
/** 排程時間：每天台北 00:05（UTC 16:05）。 */
export const AUTO_PAY_CRON_UTC = "5 16 * * *";
export const CANCEL_AUTO_PAY_ACTION = "cancel_auto_pay";
export const CANCEL_AUTO_PAY_LABEL = "取消自動付款";
export const CANCEL_AUTO_PAY_NOTE = "取消後這張請款單會改回「已送出」，付款日期與付款時間會清除，而且之後系統不會再自動標記這張單；要付款時請用「標記已付款」手動處理。";

export type AutoPayInput = {
  status: string;
  source?: string | null;
  expected_pay_date?: string | null;
  /** 水電請款單所含有效帳單的繳費期限（沒有期限的帳單給 null 或不給）。 */
  bill_due_dates?: Array<string | null | undefined> | null;
  auto_pay_off?: boolean | null;
  /** 付款對象：同仁代墊（EMPLOYEE）要人工核付，不自動標記；沒給視為廠商。 */
  payee_type?: string | null;
  pay_method?: string | null;
};

const validDate = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && isRealDate(v.trim());

/** 付款日：預計付款日優先；沒填時只有水電才用帳單最早的繳費期限；其餘回 null（不自動）。 */
export function resolveAutoPayDate(input: Pick<AutoPayInput, "source" | "expected_pay_date" | "bill_due_dates">): string | null {
  if (validDate(input.expected_pay_date)) return input.expected_pay_date.trim();
  if (String(input.source ?? "PURCHASE").toUpperCase() !== "UTILITY") return null;
  const dates = (input.bill_due_dates ?? []).filter(validDate).map((d) => d.trim());
  if (!dates.length) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}

/** 付款日資料來源（操作紀錄用）：預計付款日或帳單繳費期限。 */
export function autoPayDateSource(input: Pick<AutoPayInput, "source" | "expected_pay_date" | "bill_due_dates">): "expected_pay_date" | "bill_due_date" | null {
  if (validDate(input.expected_pay_date)) return "expected_pay_date";
  return resolveAutoPayDate(input) ? "bill_due_date" : null;
}

/** 自動標記用的付款方式：單上已有就用，沒有記轉帳。 */
export const autoPayMethod = (payMethod: string | null | undefined) => String(payMethod ?? "").trim().toUpperCase() || AUTO_PAY_DEFAULT_METHOD;

export type AutoPayPlan = { mark: boolean; paid_date: string | null; pay_method: string | null; reason: string | null; skip: "NOT_SUBMITTED" | "NOT_VENDOR" | "AUTO_OFF" | "NO_DATE" | "NOT_DUE" | null };

/** 排程判斷：今天（台北）該不該把這張單自動標記為已付款。 */
export function planAutoPay(input: AutoPayInput, today: string = taipeiToday()): AutoPayPlan {
  const no = (skip: AutoPayPlan["skip"]): AutoPayPlan => ({ mark: false, paid_date: null, pay_method: null, reason: null, skip });
  if (input.status !== "SUBMITTED") return no("NOT_SUBMITTED");
  if (String(input.payee_type ?? "VENDOR").toUpperCase() !== "VENDOR") return no("NOT_VENDOR");
  if (input.auto_pay_off) return no("AUTO_OFF");
  const date = resolveAutoPayDate(input);
  if (!date) return no("NO_DATE");
  if (date > today) return no("NOT_DUE");
  return { mark: true, paid_date: date, pay_method: autoPayMethod(input.pay_method), reason: AUTO_PAY_REASON, skip: null };
}
export const isAutoPayDue = (input: AutoPayInput, today?: string) => planAutoPay(input, today).mark;

/** 畫面用：這張已付款單是不是系統自動標記的。 */
export const isAutoPaid = (r: { status?: string | null; paid_auto?: boolean | null } | null | undefined) => !!r && r.status === "PAID" && !!r.paid_auto;

/** 取消自動付款按鈕：只限系統自動標記的已付款單，且需請款管理權限。人工標記的不行。 */
export const canCancelAutoPay = (r: { status?: string | null; paid_auto?: boolean | null } | null | undefined, canManage: boolean) => canManage && isAutoPaid(r);

const slash = (d: string) => d.replace(/-/g, "/");
/** 「系統自動標記（付款日 YYYY/MM/DD）」。 */
export function autoPaidLabel(r: { paid_date?: string | null }): string {
  return r.paid_date ? `系統自動標記（付款日 ${slash(String(r.paid_date).slice(0, 10))}）` : "系統自動標記";
}

/** 已送出的單還沒到期時的提示；已取消自動付款的單說明不會再自動。沒有可顯示的回 null。 */
export function autoPayHint(input: AutoPayInput, today: string = taipeiToday()): string | null {
  if (input.status !== "SUBMITTED") return null;
  if (String(input.payee_type ?? "VENDOR").toUpperCase() !== "VENDOR") return "同仁代墊款需要人工核付，系統不會自動標記已付款。";
  if (input.auto_pay_off) return "已取消自動付款，系統不會再自動標記，請手動標記已付款。";
  const date = resolveAutoPayDate(input);
  if (!date) return "沒有預計付款日，系統不會自動標記已付款，請手動標記。";
  return date > today ? `付款日 ${slash(date)} 到期後，系統會自動標記已付款。` : `付款日 ${slash(date)} 已到期，系統會在每天凌晨 00:05 自動標記已付款（過期的付款日也會照該日期標記）。`;
}

/** 取消自動付款 payload：原因必填，最多 200 字。 */
export function validateCancelAutoPayPayload(raw: Record<string, any>): { reason: string } {
  const reason = String(raw?.reason ?? "").trim();
  if (!reason) throw new Error("請填寫取消自動付款的原因");
  if (reason.length > 200) throw new Error("原因不可超過 200 個字");
  return { reason };
}
