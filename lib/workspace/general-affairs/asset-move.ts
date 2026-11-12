// 第 4 批 G27（B6，D20、D21）：資產換店時「單子跟著走」的規則與資料整理（純函式，資料庫函式 ga_ws_asset_move_open_requests 以同樣規則實作）。
// 規則：只搬維修類（REPAIR）且未結案（不是已完成、退回、取消）的需求單及其工單，含待門市確認、待門市補資料；添購等其他類型不搬；
//      沒連到需求單的舊式工單不搬，只列清單請總務人工處理；時間軸記一筆公開事件，不發通知；舊店只留已結案的單。
export const MOVABLE_REQUEST_TYPE = "REPAIR";
export const TERMINAL_REQUEST_STATUSES = ["COMPLETED", "REJECTED", "CANCELED"] as const;
export type MoveMode = "TRANSFER" | "CORRECTION";

export type MoveRequestInfo = { request_type: string; main_status: string; deleted_at?: string | null; store_id?: string | null };

/** 這張需求單換店時要不要跟著搬（from 是轉出門市；沒給就不比對門市）。 */
export function isMovableRequest(r: MoveRequestInfo, fromStoreId?: string | null): boolean {
  if (r.deleted_at) return false;
  if (r.request_type !== MOVABLE_REQUEST_TYPE) return false;
  if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.main_status)) return false;
  if (fromStoreId && r.store_id && r.store_id !== fromStoreId) return false;
  return true;
}

/** 時間軸公開事件標題（D21）；與資料庫函式文字一致。 */
export function movedTimelineTitle(mode: MoveMode, fromName: string, toName: string): string {
  return mode === "CORRECTION" ? `因設備所屬門市更正，由 ${fromName} 轉到 ${toName}` : `因設備轉移，由 ${fromName} 轉到 ${toName}`;
}

/** 舊式工單（沒連到需求單）是否疑似屬於這項資產：同門市、未完成、資源類型相符，且標題或說明提到資產編號（至少 3 字）或名稱（至少 2 字）。 */
export function legacyWorkOrderMatches(
  wo: { ga_service_request_id?: string | null; store_id: string; status: string; resource_type?: string | null; title?: string | null; description?: string | null },
  asset: { type: "EQUIPMENT" | "FACILITY"; store_id: string; code?: string | null; name?: string | null },
): boolean {
  if (wo.ga_service_request_id) return false;
  if (wo.store_id !== asset.store_id || wo.status === "COMPLETED") return false;
  if (wo.resource_type && wo.resource_type.toLowerCase() !== asset.type.toLowerCase()) return false;
  const text = `${wo.title ?? ""} ${wo.description ?? ""}`.toLowerCase();
  const code = (asset.code ?? "").toLowerCase();
  const name = (asset.name ?? "").toLowerCase();
  return (code.length >= 3 && text.includes(code)) || (name.length >= 2 && text.includes(name));
}

export type MovePreview = {
  moving: { request_id: string; request_no: string; title: string; main_status: string; has_work_order: boolean }[];
  moving_count: number;
  staying: { request_id: string; request_no: string; title: string; main_status: string; request_type: string }[];
  staying_count: number;
  unlinked_work_orders: { work_order_id: string; title: string; status: string }[];
  unlinked_count: number;
};
export const EMPTY_MOVE_PREVIEW: MovePreview = { moving: [], moving_count: 0, staying: [], staying_count: 0, unlinked_work_orders: [], unlinked_count: 0 };

/** 資料庫預覽結果轉成固定形狀（缺欄位補空，數字以陣列長度為準）。 */
export function normalizeMovePreview(raw: any): MovePreview {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const moving = arr(raw?.moving), staying = arr(raw?.staying), unlinked = arr(raw?.unlinked_work_orders);
  return { moving, moving_count: moving.length, staying, staying_count: staying.length, unlinked_work_orders: unlinked, unlinked_count: unlinked.length };
}

export type MovedRow = {
  id: string; kind: "REQUEST" | "WORK_ORDER" | "UNLINKED_WORK_ORDER"; moved: boolean; request_id: string | null; work_order_id: string | null;
  doc_no: string | null; doc_title: string | null; doc_status: string | null; from_store_id: string; to_store_id: string; created_at: string;
};
/** 搬單明細整理成「搬走的需求單（含其工單）」與「沒搬的舊式工單」兩組，給轉移單詳情與異動紀錄顯示。 */
export function groupMoved(rows: MovedRow[]) {
  const requests = rows.filter((r) => r.kind === "REQUEST").map((r) => ({
    ...r,
    work_order: rows.find((w) => w.kind === "WORK_ORDER" && w.request_id === r.request_id && w.created_at === r.created_at) || rows.find((w) => w.kind === "WORK_ORDER" && w.request_id === r.request_id) || null,
  }));
  const unlinked = rows.filter((r) => r.kind === "UNLINKED_WORK_ORDER");
  return { requests, unlinked, movedCount: requests.length, unlinkedCount: unlinked.length };
}
