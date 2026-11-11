// G13 庫存調撥單：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/inventory-transfer-rules.ts，伺服端與頁面共用）。
import type { LocationInfo, PartInfoLite, StoreInfo } from "./ga-inventory-stock";
import type { Abilities } from "../../../lib/workspace/general-affairs/inventory-transfer-rules";

export type TransferItemView = {
  id: string; part_id: string; quantity_input: number; input_unit_type: "BASE" | "PURCHASE"; notes: string | null;
  source_transaction_id: string | null; receipt_transaction_id: string | null; return_transaction_id: string | null; part: PartInfoLite | null;
};
export type TransferEventView = {
  id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string; creator_name: string | null;
  return_stock: boolean; exception_type: string | null; report_type: string | null;
};
export type TransferView = {
  id: string; transfer_no: string; status: string; reason: string; notes: string | null; shipping_method: string | null;
  source_confirmed_at: string | null; shipped_at: string | null; received_at: string | null; canceled_at: string | null; cancel_reason: string | null;
  exception_type: string | null; unreceived_note: string | null; unreceived_marked_at: string | null;
  store_report_type: string | null; store_report_note: string | null; store_reported_at: string | null;
  created_at: string; updated_at: string;
  source_location: (LocationInfo & { store?: StoreInfo }) | null; destination_location: (LocationInfo & { store?: StoreInfo }) | null;
  items: TransferItemView[]; is_overdue: boolean; days_since_issued: number | null; has_store_report: boolean; abilities: Abilities;
  events?: TransferEventView[];
};
export type TransferStats = { all: number; overdue: number; reported: number; REQUESTED: number; SOURCE_CONFIRMED: number; IN_TRANSIT: number; RECEIVED: number; CANCELED: number };

export const unitLabel = (i: TransferItemView) => (i.input_unit_type === "PURCHASE" ? i.part?.purchase_unit || "採購單位" : i.part?.base_unit || "");
export const itemText = (i: TransferItemView) => `${i.part?.name || "（料件資料不可見）"} × ${Number(i.quantity_input).toLocaleString("zh-TW", { maximumFractionDigits: 4 })} ${unitLabel(i)}`;
export const placeText = (l: { name: string; store?: StoreInfo } | null | undefined) => (l ? `${l.name}${l.store ? `（${l.store.short_name || l.store.store_name}）` : ""}` : "（位置資料不可見）");
/** 明細的扣帳狀態（舊版顯示已扣／待交出）。 */
export function itemState(status: string, i: TransferItemView): string {
  if (status === "CANCELED") return i.return_transaction_id ? "已取消，庫存已退回來源" : i.source_transaction_id ? "已取消，來源庫存沒有退回" : "已取消，未扣庫存";
  if (i.receipt_transaction_id) return "已入目的庫存";
  if (i.source_transaction_id) return "已扣來源庫存";
  return "待交出";
}
