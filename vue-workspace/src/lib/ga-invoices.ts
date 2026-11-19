// 第 4.5 批 進貨發票：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/payment-rules.ts，伺服端與頁面共用）。
import { ApiError } from "../api";
import {
  INVOICE_TYPES, INVOICE_TYPE_LABELS, NO_TAX_TYPES, VOUCHER_LABELS, calcTax, diffReasonRequired, buyerMismatch, invoiceMissingImage, taipeiToday,
  type InvoiceType,
} from "../../../lib/workspace/general-affairs/payment-rules";

export { INVOICE_TYPES, INVOICE_TYPE_LABELS, NO_TAX_TYPES, VOUCHER_LABELS, calcTax, diffReasonRequired, buyerMismatch, invoiceMissingImage, taipeiToday };
export type { InvoiceType };
export { money, newKey } from "./ga-requests";

export type InvoiceReceiptLink = {
  receipt_id: string; receipt_no: string; po_id: string; po_no: string; received_date: string; voided: boolean;
  allocated_untaxed: number; allocated_tax: number; receipt_untaxed: number; receipt_total: number;
};
export type Invoice = {
  id: string; invoice_type: InvoiceType; invoice_no: string | null; invoice_date: string; vendor_id: string; vendor_name: string | null;
  seller_tax_id_snapshot: string | null; seller_tax_masked: boolean; buyer_tax_id: string | null; amount_untaxed: number; tax_amount: number; amount_total: number;
  diff_reason: string | null; tax_mismatch_reason: string | null; no_image_reason: string | null; notes: string | null; status: "ACTIVE" | "VOID";
  image_count: number; missing_image: boolean; created_at: string; updated_at: string; created_by_name: string | null; updated_by_name: string | null;
  void_reason: string | null; voided_at: string | null; voided_by_name: string | null; receipts: InvoiceReceiptLink[];
  referenced_by: Array<{ id: string; pr_no: string; status: string }>;
};
export type ReceiptOption = {
  receipt_id: string; receipt_no: string; received_date: string; delivery_note_no: string | null; voucher_status: string; po_id: string; po_no: string; vendor_id: string; vendor_name: string;
  tax_rate: number; receipt_untaxed: number; receipt_tax: number; receipt_total: number; invoices: Array<{ id: string; invoice_no: string | null; invoice_type: string; amount_total: number; missing_image: boolean }>;
};
export type PayAbilities = { canView: boolean; canManage: boolean; vendorVisible: boolean; canPickReceipts: boolean };
export type PaySettings = { tolerance_amount: number; buyer_title: string | null; buyer_tax_id: string | null; updated_at: string | null };

/** 錯誤訊息：伺服端已回白話。 */
export function errorText(e: unknown, fallback = "操作失敗，請稍後重試") {
  if (e instanceof ApiError) return e.message || fallback;
  return (e as Error)?.message || fallback;
}
export const errorCodeOf = (e: unknown) => (e instanceof ApiError ? String(e.data?.code || "") : "");

export const dateText = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
export const timeText = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "");

export type InvoiceForm = {
  invoice_type: InvoiceType; invoice_no: string; invoice_date: string; vendor_id: string; vendor_name: string; seller_tax_id: string; buyer_tax_id: string;
  amount_untaxed: string; tax_amount: string; tax_touched: boolean; amount_total: string; diff_reason: string; tax_mismatch_reason: string; no_image_reason: string; notes: string;
};
export const emptyInvoiceForm = (): InvoiceForm => ({
  invoice_type: "E_INVOICE", invoice_no: "", invoice_date: taipeiToday(), vendor_id: "", vendor_name: "", seller_tax_id: "", buyer_tax_id: "",
  amount_untaxed: "", tax_amount: "", tax_touched: false, amount_total: "", diff_reason: "", tax_mismatch_reason: "", no_image_reason: "", notes: "",
});
export function formFromInvoice(i: Invoice): InvoiceForm {
  const t = (v: unknown) => (v == null ? "" : String(v));
  const noTax = (NO_TAX_TYPES as readonly string[]).includes(i.invoice_type);
  return {
    invoice_type: i.invoice_type, invoice_no: t(i.invoice_no), invoice_date: dateText(i.invoice_date), vendor_id: t(i.vendor_id), vendor_name: t(i.vendor_name),
    seller_tax_id: t(i.seller_tax_id_snapshot), buyer_tax_id: t(i.buyer_tax_id), amount_untaxed: noTax ? "" : t(i.amount_untaxed), tax_amount: noTax ? "" : t(i.tax_amount),
    tax_touched: !noTax && Number(i.tax_amount) !== calcTax(Number(i.amount_untaxed), 0.05) && Number(i.tax_amount) !== 0 ? true : false,
    amount_total: noTax ? t(i.amount_total) : "", diff_reason: t(i.diff_reason), tax_mismatch_reason: t(i.tax_mismatch_reason), no_image_reason: t(i.no_image_reason), notes: t(i.notes),
  };
}
const intOf = (s: string) => (String(s ?? "").trim() === "" ? NaN : Number(String(s).replace(/,/g, "")));
/** 畫面上的金額：未稅、稅額（沒手改就自動算）、含稅。收據與免開發票只有含稅金額。 */
export function amountsOf(f: InvoiceForm, rate: number) {
  if ((NO_TAX_TYPES as readonly string[]).includes(f.invoice_type)) {
    const total = intOf(f.amount_total);
    return { untaxed: total, tax: 0, total, noTax: true };
  }
  const untaxed = intOf(f.amount_untaxed);
  const tax = f.tax_touched && String(f.tax_amount).trim() !== "" ? intOf(f.tax_amount) : Number.isFinite(untaxed) ? calcTax(untaxed, rate) : NaN;
  return { untaxed, tax, total: Number.isFinite(untaxed) && Number.isFinite(tax) ? untaxed + tax : NaN, noTax: false };
}
