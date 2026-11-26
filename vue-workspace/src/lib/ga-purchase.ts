// G25 採購單：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/purchase-order-rules.ts，伺服端與頁面共用）。
import { ApiError } from "../api";
import type { PoAbilities } from "../../../lib/workspace/general-affairs/purchase-order-rules";
export { PO_STATUS_LABEL, isStale, money, newKey, num, storeText } from "./ga-requests";

export type PoListRow = {
  id: string; po_no: string; status: string; status_label: string; vendor_id: string | null; vendor_name: string | null; source_request_id: string | null;
  expected_delivery_date: string | null; subtotal: number; tax_amount: number; total_amount: number; approval_required: boolean; item_count: number; first_item_name: string | null;
  ordered_qty_base: number; received_qty: number; overdue: boolean;
  // ga-improve-b1 G1：已預付（有請款檢視權限者才有）；沒有預付單時不出現
  prepay_balance?: number; prepaid?: number; prepay_overdue?: boolean; prepay_overdue_days?: number | null; created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string; ordered_at: string | null;
};
export type PoItem = {
  id: string; line_no: number; part_id: string | null; part_name: string | null; item_name: string; spec: string | null; unit: string | null; quantity: number; quantity_base: number; base_unit: string | null;
  unit_price: number; line_amount: number; unit_price_gross?: number | null; line_gross?: number | null; request_id: string | null; request_no: string | null; fulfil_mode: "STOCK" | "DIRECT_ASSET" | "NO_STOCK"; target_store_id: string | null;
  target_store_name: string | null; equipment_template_id: string | null; over_request_reason: string | null; received_qty: number; dispatched_qty: number; notes: string | null;
};
export type PoAdjustment = { id: string; line_no: number; kind: "FREIGHT" | "DISCOUNT" | "COUPON" | "POINTS" | "OTHER"; label: string; amount: number; original_price: number | null; campaign_name: string | null; note: string | null; receipt_no?: string | null };
export type PoPrepay = {
  prepaid: number; paid: number; draft: number; offset: number; refunded: number; balance: number; overdue?: boolean; overdue_days?: number | null; unsettled?: boolean;
  requests: Array<{ id: string; pr_no: string; status: string; amount_total: number; balance: number }>;
};
export type PoEvent = { id: string; event_type: string; from_status: string | null; to_status: string | null; actor_id: string | null; actor_name: string | null; note: string | null; payload: any; created_at: string };
export type PoDetail = {
  id: string; po_no: string; status: string; status_label: string; vendor_id: string | null; vendor_name: string | null; vendor_current_name: string | null; vendor_current_status: string | null;
  vendor_billing_visible: boolean; vendor_tax_id: string | null; vendor_payment_terms: string | null; source_request_id: string | null; source_request_no: string | null;
  receiving_location_id: string | null; receiving_location_name: string | null; expected_delivery_date: string | null; tax_rate: number; subtotal: number; tax_amount: number; total_amount: number;
  approval_required: boolean; approval_threshold_snapshot: number | null; created_by: string | null; created_by_name: string | null; submitted_by: string | null; submitted_by_name: string | null; submitted_at: string | null;
  approved_by_name: string | null; approved_at: string | null; approval_note: string | null; last_reject_reason: string | null; last_reject_at: string | null; ordered_by_name: string | null; ordered_at: string | null;
  cancel_reason: string | null; short_close_reason: string | null; notes: string | null; created_at: string; updated_at: string; items: PoItem[]; events: PoEvent[];
  received_qty_total: number; abilities: PoAbilities;
  // ga-improve-b1：計價方式（G2）、調整列（G3）、買受人抬頭（G11）、預付摘要（G1，有請款檢視權限且有預付單才有）
  price_mode?: "EXCL" | "INCL"; adjustments?: PoAdjustment[]; adjustment_total?: number; buyer_company_id?: string | null; buyer_company_name?: string | null; buyer_company_tax_id?: string | null;
  prepay?: PoPrepay | null;
};
export type ReceiptView = {
  id: string; receipt_no: string; received_date: string; delivery_note_no: string | null; notes: string | null; created_at: string; created_by_name?: string | null;
  updated_at?: string; voided_at?: string | null; void_reason?: string | null;
  voucher_status?: string | null; has_paid_claim?: boolean; amount_total?: number; prepay_offset?: number; adjustments?: Array<{ po_adjustment_id: string; kind: string; label: string; amount: number }>;
  items: Array<{ id: string; po_item_id: string; fulfil_mode?: string; dispatched_qty?: number; delivered_qty: number; accepted_qty: number; rejected_qty: number; reason: string | null; location_id: string | null; location_name?: string | null; received_part_id: string | null; received_part_name?: string | null; change_reason: string | null; item_name?: string | null; equipment?: Array<{ id: string; asset_code: string | null; name: string; serial_number: string | null }> }>;
};
export type DispatchView = { id: string; dispatch_no: string; po_item_id: string; store_id: string; store_name?: string | null; quantity: number; created_at: string; notes: string | null; equipment?: Array<{ id: string; asset_code: string | null; name: string; serial_number: string | null }> };
export type Receiving = {
  receipts: ReceiptView[]; dispatches: DispatchView[];
  items: Array<{ po_item_id: string; line_no: number; item_name: string; unit: string | null; fulfil_mode: string; quantity: number; received_qty: number; remaining_qty: number; received_base: number; dispatched_base: number; dispatchable_base: number; part_equipment_template_id: string | null }>;
};
export const FULFIL_TEXT: Record<string, string> = { STOCK: "入總部庫存", DIRECT_ASSET: "到貨直接建設備", NO_STOCK: "只登錄到貨" };
export const EVENT_TEXT: Record<string, string> = {
  create: "建立草稿", update: "修改", submit: "送核准", withdraw: "撤回送簽", approve: "核准", reject: "駁回並退回草稿", revoke_approval: "撤回核准", place_order: "下訂",
  cancel: "取消", short_close: "短收結案", close: "結案", receive: "登錄到貨並驗入", receipt_void: "作廢進貨", dispatch: "配發為設備", from_review: "由採購評估產生草稿", settings: "調整設定",
};
export const eventText = (t: string) => EVENT_TEXT[t] || t;
export const dateText = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
export const taipeiToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
export const errorCode = (e: unknown) => (e instanceof ApiError ? String(e.data?.code || "") : "");

/** 詳情要顯示的動作按鈕（順序固定）：草稿依是否超過核准門檻只留一條路（超過：送核准；未超過：直接下訂），避免按了才被擋。 */
export function visibleActions(po: { status: string; approval_required: boolean; abilities: PoAbilities }): Array<keyof PoAbilities & string> {
  const order = ["submit", "withdraw", "approve", "reject", "revoke_approval", "place_order", "cancel", "short_close", "close"] as const;
  return order.filter((x) => {
    if (!po.abilities[x]) return false;
    if (po.status === "DRAFT" && x === "submit") return po.approval_required;
    if (po.status === "DRAFT" && x === "place_order") return !po.approval_required;
    return true;
  });
}
