// 第 4.5 批 請款單：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/payment-request-rules.ts，伺服端與頁面共用）。
import {
  PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_LABELS, availableActions, checkClaimLimit, holdsQuota, isEditable, lineDiffReasonRequired, paidDateProblem, paidDateRange, payErrorMessage, voidReasonRequired, PAID_BACKDATE_DAYS,
  type PrAction, type PrStatus,
} from "../../../lib/workspace/general-affairs/payment-request-rules";

export { PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_LABELS, availableActions, checkClaimLimit, holdsQuota, isEditable, lineDiffReasonRequired, paidDateProblem, paidDateRange, payErrorMessage, voidReasonRequired, PAID_BACKDATE_DAYS };
import { errorCodeOf as _code, errorText as _text } from "./ga-invoices";
/** 請款單頁的錯誤文字：沿用伺服端白話訊息，再補上新規則的下一步提示。 */
export const payErrorText = (e: unknown, fallback?: string) => payErrorMessage(_code(e), _text(e, fallback));
export type { PrAction, PrStatus };
export { downloadCsv } from "./ga-inventory-stock";
export { dateText, errorCodeOf, errorText, money, newKey, timeText } from "./ga-invoices";
export type { PayAbilities } from "./ga-invoices";
// G46 水電話費請款：來源、帳單能不能請款、缺附件、鎖定、自動標記規則（規則在 lib/workspace/general-affairs/utility-payment-rules.ts，伺服端與頁面共用）。
export {
  EXCLUDED_LABELS, UTILITY_PRINT_HEADERS, billLabel, identifierHeader, isUtilityRequest, missingAttachmentBills, missingAttachmentMessage, noPayeeNotice, sourceName, sourceOf, utilityErrorMessage, utilityPrintRow, voidPaidWarning,
  PR_SOURCE_NAMES, PR_SOURCE_VALUES,
} from "../../../lib/workspace/general-affairs/utility-payment-rules";
export type { PrSourceValue } from "../../../lib/workspace/general-affairs/utility-payment-rules";

export type PrLine = {
  id: string; line_no: number; po_id: string; po_no: string; tax_rate: number; receipt_id: string; receipt_no: string; received_date: string; delivery_note_no: string | null;
  receipt_voided: boolean; receipt_untaxed: number; receipt_total: number; invoice_id: string | null; invoice_no: string | null; invoice_type: string | null; invoice_status: string | null;
  invoice_total: number | null; invoice_missing_image: boolean; claim_untaxed: number; claim_tax: number; claim_total: number; diff_reason: string | null;
  items?: Array<{ item_name: string; unit: string | null; ordered_qty: number; unit_price: number; accepted_qty: number; rejected_qty: number; amount_untaxed: number }> | null;
};
export type PrEvent = { id: string; event_type: string; from_status: string | null; to_status: string | null; actor_name: string | null; reason: string | null; amount_total: number | null; payload: Record<string, any>; created_at: string };
export type UtilityBillLine = {
  id: string; line_no: number; bill_id: string; store_id: string | null; location_name: string; expense_type: string; billing_month: string; identifier: string | null; service_label: string | null;
  due_date: string | null; claim_total: number; active: boolean; bill_amount: number; bill_paid_at: string | null; bill_deleted: boolean; bill_paid_by_this: boolean; attachment_count: number;
  auto_paid_date: string | null; auto_reverted_at: string | null; auto_revert_reason: "RETURN" | "VOID" | null;
};
export type UtilityPayeeRow = { vendor_id: string; vendor_name: string; vendor_status: string; bill_count: number; eligible_count: number; eligible_amount: number };
export type UtilityCandidateBill = {
  id: string; store_id: string | null; location_name: string; expense_type: string; billing_month: string; identifier: string | null; service_label: string | null; amount: number; due_date: string | null;
  paid_at: string | null; attachment_count: number; eligible: boolean; code: string | null; reason: string | null; pr_no: string | null;
};
export type UtilityCandidates = {
  month: string; no_payee_count: number; bills_masked: boolean; payees?: UtilityPayeeRow[]; vendor?: { id: string; name: string; status: string };
  bill_count?: number; eligible_count?: number; eligible_amount?: number; bills?: UtilityCandidateBill[];
};
export type UtilityAbilities = {
  canView: boolean; canManage: boolean; vendorVisible: boolean; canPickReceipts: boolean; billsVisible: boolean; billManage: boolean; canCreateUtility: boolean; missingForCreate: string[];
};
export type PaymentRequest = {
  id: string; pr_no: string; status: PrStatus; vendor_id: string; vendor_name_snapshot: string | null; vendor_tax_id_snapshot: string | null; vendor_masked: boolean;
  bank_snapshot: { bank_name?: string | null; bank_branch?: string | null; bank_account?: string | null; bank_account_name?: string | null };
  amount_untaxed: number; tax_amount: number; amount_total: number; expected_pay_date: string | null; notes: string | null; line_count: number; po_nos: string[];
  pay_method: string | null; paid_date: string | null; paid_ref: string | null; last_return_reason: string | null; void_reason: string | null;
  created_by_name: string | null; submitted_by_name: string | null; paid_by_name: string | null; voided_by_name: string | null;
  created_at: string; updated_at: string; submitted_at: string | null; paid_at: string | null; voided_at: string | null;
  lines?: PrLine[]; events?: PrEvent[];
  // G46 水電話費請款（採購單沒有這些欄位或是預設值）
  source?: "PURCHASE" | "UTILITY"; bill_month?: string | null; auto_mark_paid?: boolean; bill_count?: number; bills_masked?: boolean; bill_lines?: UtilityBillLine[];
  auto_marked_count?: number; auto_reverted_count?: number;
};
export type Candidate = {
  receipt_id: string; receipt_no: string; received_date: string; delivery_note_no: string | null; voucher_status: string; po_id: string; po_no: string; vendor_id: string; vendor_name: string;
  tax_rate: number; receipt_untaxed: number; receipt_tax: number; receipt_total: number; receipt_claimed: number; po_received_total: number; po_claimed_total: number; po_remaining: number;
  po_remaining_max: number; tolerance: number;
  invoices: Array<{ id: string; invoice_no: string | null; invoice_type: string; amount_total: number; allocated_total: number; missing_image: boolean }>;
};
export const PR_STATUS_CLASS: Record<string, string> = { DRAFT: "draft", SUBMITTED: "submitted", PAID: "paid", VOID: "void" };
export const EVENT_LABELS: Record<string, string> = {
  create: "建立草稿", update: "修改草稿", submit: "送出請款", return: "退回草稿", mark_paid: "標記已付款", void: "作廢", note: "備註", refresh_bank: "重抓廠商帳號",
};
export const bankText = (b: PaymentRequest["bank_snapshot"] | undefined) =>
  [b?.bank_name, b?.bank_branch, b?.bank_account, b?.bank_account_name].filter(Boolean).join(" / ");
