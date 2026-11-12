// G14 至 G17 需求單與料件處理單的純規則（無相依；伺服端、Vue 頁面與單元測試共用）。
// 資料庫函式（ga_ws_req_*、ga_ws_ful_*）是最後把關者，這裡的合法流轉表與它逐項相同，用來決定畫面上能按哪些鈕，並由單元測試釘住。

export const REQUEST_STATUSES = [
  "PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS", "WAITING_STORE_CONFIRMATION", "COMPLETED", "REJECTED", "CANCELED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING_INTAKE: "待受理", WAITING_STORE_SUPPLEMENT: "待門市補資料", WAITING_GA_REVIEW: "待總務複核", ACCEPTED: "已受理", IN_PROGRESS: "處理中",
  WAITING_STORE_CONFIRMATION: "待門市確認", COMPLETED: "已完成", REJECTED: "已駁回", CANCELED: "已取消",
};
export const REQUEST_TYPE_LABEL: Record<string, string> = { REPAIR: "維修回報", PURCHASE_SUPPLEMENT: "添購／補充", ASSIGNED_RESPONSE: "總務指派" };
export const ROUTE_LABEL: Record<string, string> = {
  REPAIR_DISPATCH: "維修派工", PURCHASE_REVIEW: "添購／採購評估", STOCK_ISSUE: "庫存出庫", TRANSFER: "調撥處理", ASSET_TASK: "資產異動／門市配合",
};
export const ROLE_LABEL: Record<string, string> = { GENERAL_AFFAIRS: "總務", WORKS: "工務" };
export const RESOURCE_LABEL: Record<string, string> = { EQUIPMENT: "設備", FACILITY: "設施", PART: "料件", GENERAL_SUPPLY: "一般耗材", OTHER_PURCHASE: "其他採購" };
export const REJECTION_LABEL: Record<string, string> = {
  OUT_OF_SCOPE: "不屬於總務/工務處理範圍", INSUFFICIENT_DATA_RECREATE: "資料不足，請重新提出", DUPLICATE_REQUEST: "重複申請", NOT_ELIGIBLE: "不符合採購/維修條件",
  ALTERNATIVE_AVAILABLE: "已有替代處理方式", OTHER: "其他",
};
export const SUPPLEMENT_LABEL: Record<string, string> = {
  PHOTO_UNCLEAR: "照片不清楚", MISSING_PHOTO: "缺少必要照片", DESCRIPTION_INSUFFICIENT: "問題描述不足", RESOURCE_SELECTION_WRONG: "設備/設施選擇錯誤",
  QUANTITY_OR_SPEC_INSUFFICIENT: "數量/規格說明不足", OTHER: "其他",
};
export const FULFILLMENT_STATUS_LABEL: Record<string, string> = {
  PENDING_DECISION: "待決定", STOCK_ISSUE: "庫存出庫", TRANSFER: "調撥", PURCHASING: "採購中", WAITING_ARRIVAL: "等待到貨", WAITING_STORE_CONFIRMATION: "待門市確認",
  EXCEPTION: "異常", COMPLETED: "已完成", CANCELED: "已取消",
};
export const FULFILLMENT_STATUSES = Object.keys(FULFILLMENT_STATUS_LABEL);
export const EXCEPTION_TYPES = ["少收", "未收", "破損", "收錯", "取消"] as const;
export const DEFAULT_OVERDUE_CONFIRM_DAYS = 7;
export const REQUEST_SORT = new Set(["created_at", "updated_at"]);

export type RequestAction =
  | "accept" | "reject" | "request_supplement" | "update_progress" | "request_store_confirmation" | "assign" | "cancel" | "reopen" | "withdraw"
  | "submit_supplement" | "confirm_complete" | "report_problem";

const OPEN = ["PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS", "WAITING_STORE_CONFIRMATION"];
export const REQUEST_TRANSITIONS: Record<RequestAction, { from: string[]; to: (from: string) => string }> = {
  accept: { from: ["PENDING_INTAKE", "WAITING_GA_REVIEW"], to: () => "ACCEPTED" },
  reject: { from: ["PENDING_INTAKE", "WAITING_GA_REVIEW", "ACCEPTED"], to: () => "REJECTED" },
  request_supplement: { from: ["PENDING_INTAKE", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS"], to: () => "WAITING_STORE_SUPPLEMENT" },
  update_progress: { from: ["ACCEPTED", "IN_PROGRESS"], to: () => "IN_PROGRESS" },
  request_store_confirmation: { from: ["IN_PROGRESS"], to: () => "WAITING_STORE_CONFIRMATION" },
  assign: { from: OPEN.filter((s) => s !== "WAITING_STORE_CONFIRMATION").concat(["WAITING_STORE_CONFIRMATION"]), to: (f) => f },
  cancel: { from: ["PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS"], to: () => "CANCELED" },
  reopen: { from: ["COMPLETED", "REJECTED"], to: (f) => (f === "COMPLETED" ? "IN_PROGRESS" : "PENDING_INTAKE") },
  withdraw: { from: ["PENDING_INTAKE"], to: () => "CANCELED" },
  submit_supplement: { from: ["WAITING_STORE_SUPPLEMENT"], to: () => "WAITING_GA_REVIEW" },
  confirm_complete: { from: ["WAITING_STORE_CONFIRMATION"], to: () => "COMPLETED" },
  report_problem: { from: ["WAITING_STORE_CONFIRMATION"], to: () => "IN_PROGRESS" },
};
export const TERMINAL_STATUSES = ["COMPLETED", "REJECTED", "CANCELED"];

export function canTransition(action: string, from: string): boolean {
  const t = (REQUEST_TRANSITIONS as Record<string, { from: string[] }>)[action];
  return !!t && t.from.includes(from);
}
export function nextStatus(action: string, from: string): string | null {
  const t = (REQUEST_TRANSITIONS as Record<string, { from: string[]; to: (f: string) => string }>)[action];
  return t && t.from.includes(from) ? t.to(from) : null;
}

/** D4：受理時不合理的「類型＋標的＋處理方式」組合（回傳白話原因，合理回 null）。 */
export function acceptConflict(req: { request_type: string; resource_type?: string | null }, route: string): string | null {
  if (route === "PURCHASE_REVIEW" && req.request_type === "REPAIR") return "維修單不能走採購評估，請選「維修派工」";
  if (route === "STOCK_ISSUE" && (req.resource_type || "") !== "PART") return "只有料件需求可以走庫存出庫，這張需求不是料件";
  if (route === "REPAIR_DISPATCH" && req.request_type !== "REPAIR") return "只有維修需求可以分流為維修派工";
  return null;
}

export type DocSummary = { po_count: number; po_received: number; issued: number; transfer_active: number; work_order_open: boolean };
/** Q17、D4：有進行中工單或有效單據（採購單含草稿、已出庫、調撥）時，哪些動作被擋與原因。 */
export function blockedByDocuments(action: string, d: DocSummary): string | null {
  if (action === "reject" && (d.work_order_open || d.po_count > 0 || d.issued > 0 || d.transfer_active > 0)) return "已有進行中的工單或有效單據，不能駁回";
  if (action === "cancel" && (d.issued > 0 || d.po_count > 0 || d.transfer_active > 0 || d.work_order_open)) return "已有單據或進行中的工單，不能取消";
  if (action === "request_supplement" && (d.po_count > 0 || d.issued > 0)) return "已有採購單（含草稿）或已出庫，不能請門市補資料，請改用留言";
  return null;
}

/** D5：待門市確認超過 N 天視為逾期（只標示，不自動結案）。waitingSince 為進入「待門市確認」的時間。 */
export function isConfirmOverdue(row: { main_status: string; waiting_confirm_since?: string | null }, days: number, now = new Date()): boolean {
  if (row.main_status !== "WAITING_STORE_CONFIRMATION" || !row.waiting_confirm_since) return false;
  const since = new Date(row.waiting_confirm_since).getTime();
  return Number.isFinite(since) && now.getTime() - since > days * 86_400_000;
}
export function overdueCutoff(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
export function validateOverdueDays(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new Error("逾期天數必須是 1 到 90 的整數");
  return n;
}

export type RequestWho = { manage: boolean; ownStore: boolean; creator: boolean; commentOwnStore: boolean; confirmOwnStore: boolean; purchaseManage: boolean; stockIssue: boolean };
/** 畫面上可按的動作（伺服端回傳給前端；資料庫仍會再驗一次）。 */
export function requestAbilities(who: RequestWho, row: { main_status: string; request_type: string; resource_type?: string | null; intake_route?: string | null }, d: DocSummary) {
  const s = row.main_status;
  const can = (a: string) => canTransition(a, s);
  const storeSide = who.ownStore;
  return {
    accept: who.manage && can("accept"),
    reject: who.manage && can("reject") && !blockedByDocuments("reject", d),
    requestSupplement: who.manage && can("request_supplement") && !blockedByDocuments("request_supplement", d),
    updateProgress: who.manage && can("update_progress"),
    requestStoreConfirmation: who.manage && can("request_store_confirmation"),
    assign: who.manage && can("assign"),
    cancel: who.manage && can("cancel") && !blockedByDocuments("cancel", d),
    reopen: who.manage && can("reopen"),
    withdraw: (who.creator || storeSide) && can("withdraw"),
    submitSupplement: (who.manage || (who.commentOwnStore && storeSide)) && can("submit_supplement"),
    confirmComplete: (who.manage || (who.confirmOwnStore && storeSide)) && can("confirm_complete"),
    reportProblem: (who.manage || (who.confirmOwnStore && storeSide)) && can("report_problem"),
    confirmIsProxy: who.manage && !storeSide,
    stockIssue: who.manage && who.stockIssue && row.intake_route === "STOCK_ISSUE" && ["ACCEPTED", "IN_PROGRESS"].includes(s) && (row.resource_type || "") === "PART",
    purchaseReview: who.purchaseManage && row.intake_route === "PURCHASE_REVIEW" && ["ACCEPTED", "IN_PROGRESS", "WAITING_GA_REVIEW"].includes(s) && row.request_type !== "REPAIR",
    comment: who.manage || (who.commentOwnStore && storeSide),
    internalComment: who.manage,
  };
}

// ------------------------------------------------------------ 欄位遮蔽（Q16）
const STORE_HIDDEN_REQUEST_FIELDS = ["internal_note", "assignee_user_id", "cancel_reason", "waiting_confirm_since"];
/** 門市（沒有需求單管理權限）看不到內部備註等內部欄位。 */
export function maskRequest<T extends Record<string, any>>(row: T, internal: boolean): T {
  if (internal) return row;
  const out: Record<string, any> = { ...row };
  for (const k of STORE_HIDDEN_REQUEST_FIELDS) delete out[k];
  return out as T;
}
export function maskEvents<T extends { visibility?: string | null; metadata?: any }>(events: T[], internal: boolean): T[] {
  if (internal) return events;
  // 門市只看公開事件，且不含內部流程細節（metadata 只保留與門市有關的少數欄位）。
  return events.filter((e) => e.visibility === "PUBLIC").map((e) => ({ ...e, metadata: undefined as any }));
}
export type CommentRow = { id: string; visibility: string; body: string; original_body?: string | null; edited_at?: string | null; deleted_at?: string | null; created_by?: string | null };
/** 留言：已刪除只留占位；已編輯標示；原文只給總務。門市看不到內部備註。 */
export function maskComments<T extends CommentRow>(rows: T[], internal: boolean): Array<T & { is_edited: boolean; is_deleted: boolean }> {
  return rows
    .filter((c) => internal || c.visibility === "PUBLIC")
    .map((c) => {
      const deleted = !!c.deleted_at;
      const edited = !!c.edited_at && !deleted;
      const base: any = { ...c, is_edited: edited, is_deleted: deleted };
      if (deleted) base.body = "（此留言已刪除）";
      if (!internal) delete base.original_body;
      return base;
    });
}

// ------------------------------------------------------------ 料件處理單
export type FulfillmentLike = { status: string; requested_quantity?: number | null; fulfilled_quantity?: number | null; ready_to_deliver_at?: string | null };
/** 待交付：已處理量達需求量、還沒送門市確認（資料庫觸發器記錄達標時間 ready_to_deliver_at）。 */
export function isReadyToDeliver(f: FulfillmentLike): boolean {
  if (["WAITING_STORE_CONFIRMATION", "COMPLETED", "CANCELED", "EXCEPTION", "PENDING_DECISION"].includes(f.status)) return false;
  const need = Number(f.requested_quantity || 0);
  return need > 0 && Number(f.fulfilled_quantity || 0) >= need;
}
export function fulfillmentLabel(f: FulfillmentLike): string {
  return isReadyToDeliver(f) ? "待交付" : FULFILLMENT_STATUS_LABEL[f.status] || f.status;
}
export function remainingQuantity(f: FulfillmentLike): number {
  return Math.max(0, Number(f.requested_quantity || 0) - Number(f.fulfilled_quantity || 0));
}
export type FulfillmentWho = { manage: boolean; stockIssue: boolean; transfer: boolean; purchase: boolean };
export function fulfillmentAbilities(who: FulfillmentWho, f: FulfillmentLike) {
  const locked = ["WAITING_STORE_CONFIRMATION", "COMPLETED", "CANCELED"].includes(f.status);
  return {
    decide: who.manage && !locked,
    deliver: who.manage && isReadyToDeliver(f),
    reportException: who.manage && !["COMPLETED", "CANCELED"].includes(f.status),
    voidDocuments: who.manage && f.status === "EXCEPTION",
    stockIssue: who.manage && who.stockIssue && f.status === "STOCK_ISSUE",
    transfer: who.manage && who.transfer && f.status === "TRANSFER",
    purchase: who.manage && who.purchase && ["PURCHASING", "WAITING_ARRIVAL"].includes(f.status),
  };
}
/** 單據明細：採購單（含金額與供應商）只給有採購評估權限者。 */
export function maskPurchaseDoc<T extends Record<string, any>>(doc: T, canSeeMoney: boolean): T {
  if (canSeeMoney) return doc;
  const out: Record<string, any> = { ...doc };
  for (const k of ["vendor_id", "vendor_name", "vendor", "vendor_name_snapshot", "estimated_amount", "quoted_amount", "negotiated_amount", "final_amount", "subtotal", "tax_amount", "total_amount", "quotes", "items"]) delete out[k];
  return out as T;
}
