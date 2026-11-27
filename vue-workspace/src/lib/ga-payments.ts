// 第 4.5 批 請款單：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/payment-request-rules.ts，伺服端與頁面共用）。
import {
  PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_LABELS, availableActions, checkClaimLimit, holdsQuota, isEditable, lineDiffReasonRequired, paidDateProblem, paidDateRange, payErrorMessage, voidReasonRequired, PAID_BACKDATE_DAYS,
  PAYEE_PAY_METHODS, PAYEE_TYPE_LABELS, PR_KIND_LABELS,
  type PrAction, type PrStatus,
} from "../../../lib/workspace/general-affairs/payment-request-rules";

export { PAY_METHODS, PAY_METHOD_LABELS, PR_ACTION_LABELS, PR_STATUS_LABELS, availableActions, checkClaimLimit, holdsQuota, isEditable, lineDiffReasonRequired, paidDateProblem, paidDateRange, payErrorMessage, voidReasonRequired, PAID_BACKDATE_DAYS, PAYEE_PAY_METHODS, PAYEE_TYPE_LABELS, PR_KIND_LABELS };
import { errorCodeOf as _code, errorText as _text } from "./ga-invoices";
/** 請款單頁的錯誤文字：沿用伺服端白話訊息，再補上新規則的下一步提示。 */
export const payErrorText = (e: unknown, fallback?: string) => payErrorMessage(_code(e), _text(e, fallback));
export type { PrAction, PrStatus };
// 付款日到期自動標記已付款與取消（規則在 lib/workspace/general-affairs/auto-pay-rules.ts，伺服端與頁面共用）。
export {
  AUTO_PAY_REASON, CANCEL_AUTO_PAY_LABEL, CANCEL_AUTO_PAY_NOTE, autoPayHint, autoPaidLabel, canCancelAutoPay, isAutoPaid, resolveAutoPayDate,
} from "../../../lib/workspace/general-affairs/auto-pay-rules";
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
  due_date: string | null; service_period_start?: string | null; service_period_end?: string | null; period_days?: number | null; claim_total: number; active: boolean; bill_amount: number; bill_paid_at: string | null; bill_deleted: boolean; bill_paid_by_this: boolean; attachment_count: number;
  auto_paid_date: string | null; auto_reverted_at: string | null; auto_revert_reason: "RETURN" | "VOID" | null;
};
export type UtilityPayeeRow = { vendor_id: string; vendor_name: string; vendor_status: string; bill_count: number; eligible_count: number; eligible_amount: number };
export type UtilityCandidateBill = {
  id: string; store_id: string | null; location_name: string; expense_type: string; billing_month: string; identifier: string | null; service_label: string | null; amount: number; due_date: string | null; service_period_start?: string | null; service_period_end?: string | null; period_days?: number | null;
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
  // ga-improve-b1：預付款（G1）、付款方式（G4）、同仁代墊（G4）、買受人抬頭（G11）；舊資料都是預設值（一般請款、廠商、沒有抬頭）。
  pay_kind?: "NORMAL" | "PREPAY"; prepay_po_id?: string | null; prepay_po_no?: string | null; prepay_balance?: number; prepay_overdue?: boolean; prepay_overdue_days?: number | null; prepay_unsettled?: boolean;
  prepay_offset_total?: number; prepay_refund_total?: number; prepay_ledger?: PrepayLedgerRow[];
  card_last4?: string | null; pay_card_last4?: string | null; pay_platform?: string | null; platform?: string | null;
  payee_type?: "VENDOR" | "EMPLOYEE"; payee_profile_id?: string | null; payee_name?: string | null; payee_name_snapshot?: string | null;
  payee_account_snapshot?: PayeeAccount | Record<string, never>; payee_account_masked?: boolean; payee_account_last4?: string | null;
  buyer_company_id?: string | null; buyer_title_snapshot?: string | null; buyer_tax_id_snapshot?: string | null;
  // 紙本列印欄位（空白＝列印時用系統預設）
  applicant_name?: string | null; applicant_dept?: string | null; attach_docs?: string | null; reason_override?: string | null;
  print_units?: Record<string, string> | null;
  // 付款日到期自動付款：paid_auto＝這張已付款是系統自動標記的（沒有付款人）；auto_pay_off＝已取消自動付款，系統不會再自動標記。
  paid_auto?: boolean; auto_pay_off?: boolean;
};
export type PayeeAccount = { bank_name?: string | null; bank_branch?: string | null; bank_account?: string | null; bank_account_name?: string | null };
export type PrepayLedgerRow = { id: string; kind: "OFFSET" | "REFUND"; amount: number; receipt_no: string | null; reason: string | null; created_at: string; reversed_at: string | null; reversed_reason: string | null };
export type Candidate = {
  receipt_id: string; receipt_no: string; received_date: string; delivery_note_no: string | null; voucher_status: string; po_id: string; po_no: string; vendor_id: string; vendor_name: string;
  tax_rate: number; receipt_untaxed: number; receipt_tax: number; receipt_total: number; receipt_claimed: number; po_received_total: number; po_claimed_total: number; po_remaining: number;
  po_remaining_max: number; tolerance: number; receipt_prepay_offset?: number; prepay_covered?: boolean;
  invoices: Array<{ id: string; invoice_no: string | null; invoice_type: string; amount_total: number; allocated_total: number; missing_image: boolean }>;
};
export const PR_STATUS_CLASS: Record<string, string> = { DRAFT: "draft", SUBMITTED: "submitted", PAID: "paid", VOID: "void" };
export const EVENT_LABELS: Record<string, string> = {
  create: "建立草稿", update: "修改草稿", submit: "送出請款", return: "退回草稿", mark_paid: "標記已付款", void: "作廢", note: "備註", refresh_bank: "重抓廠商帳號", prepay_refund: "登記預付款退款或轉抵", cancel_auto_pay: "取消自動付款",
};
export const payeeBankText = (b: PayeeAccount | Record<string, never> | undefined | null) => bankText(b as PaymentRequest["bank_snapshot"]);
/** 付款對象名稱：同仁代墊顯示同仁姓名（含員編快照），其餘顯示廠商名稱。 */
export const payeeName = (r: Pick<PaymentRequest, "payee_type" | "payee_name" | "payee_name_snapshot" | "vendor_name_snapshot">) => (r.payee_type === "EMPLOYEE" ? r.payee_name_snapshot || r.payee_name || "（同仁）" : r.vendor_name_snapshot || "（廠商）");
export const bankText = (b: PaymentRequest["bank_snapshot"] | undefined) =>
  [b?.bank_name, b?.bank_branch, b?.bank_account, b?.bank_account_name].filter(Boolean).join(" / ");
