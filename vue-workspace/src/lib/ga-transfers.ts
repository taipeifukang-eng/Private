// Q28 轉移單：狀態與事件文字（頁面與資產詳情共用）。
export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  PENDING_HANDOVER: "等轉出門市確認交出",
  PENDING_RECEIVE: "等轉入門市確認收到",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
export const TRANSFER_STATUS_SHORT: Record<string, string> = {
  PENDING_HANDOVER: "待交出", PENDING_RECEIVE: "待收到", COMPLETED: "已完成", CANCELLED: "已取消",
};
export const TRANSFER_EVENT_LABEL: Record<string, string> = {
  TRANSFER_REQUESTED: "總務發起轉移", TRANSFER_HANDED_OVER: "轉出門市確認交出", STORE_TRANSFER: "轉入門市確認收到（已換店）", TRANSFER_CANCELLED: "取消轉移",
};
export const assetNoun = (type: string) => (type === "FACILITY" ? "設施" : "設備");

export type TransferRow = {
  id: string; transfer_no: string; asset_type: "EQUIPMENT" | "FACILITY"; asset_id: string; asset_name: string; asset_code: string | null;
  from_store_id: string; to_store_id: string; from_store_name: string | null; to_store_name: string | null; status: string; reason: string; note: string | null;
  open_request_count: number; requested_by_name: string | null; requested_at: string; handover_by_name: string | null; handover_at: string | null; handover_note: string | null;
  received_by_name: string | null; received_at: string | null; receive_note: string | null; cancelled_by_name: string | null; cancelled_at: string | null; cancel_reason: string | null;
  canHandover: boolean; canReceive: boolean; canCancel: boolean;
};
export type TransferDetail = TransferRow & {
  events: { id: string; event_type: string; reason: string | null; note: string | null; open_request_count: number | null; actor_name: string | null; created_at: string }[];
  photos: { id: string; step: "HANDOVER" | "RECEIVE"; file_name: string; content_type: string; url: string | null }[];
};
/** 台北時間的「月/日 時:分」。 */
export const formatDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
