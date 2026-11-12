// G14 至 G17 需求單與料件處理單：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/request-rules.ts，伺服端與頁面共用）。
import { ApiError } from "../api";

export type RequestAbilities = {
  accept: boolean; reject: boolean; requestSupplement: boolean; updateProgress: boolean; requestStoreConfirmation: boolean; assign: boolean; cancel: boolean; reopen: boolean;
  withdraw: boolean; submitSupplement: boolean; confirmComplete: boolean; reportProblem: boolean; confirmIsProxy: boolean; stockIssue: boolean; purchaseReview: boolean;
  comment: boolean; internalComment: boolean;
};
export type RequestRow = {
  id: string; request_no: string; store_id: string; request_type: string; title: string; description: string; resource_type: string | null;
  desired_quantity: number | null; desired_unit: string | null; desired_spec: string | null; impact_description: string | null; temporary_workaround: string | null;
  contact_name: string | null; contact_phone: string | null; main_status: string; intake_route: string | null; assignee_role: string | null; assignee_name: string | null;
  maintenance_request_id: string | null; public_progress: string | null; rejection_reason: string | null; rejection_note: string | null; supplement_type: string | null; supplement_note: string | null;
  created_at: string; updated_at: string; created_by_name?: string | null;
  internal_note?: string | null; cancel_reason?: string | null; reopened_count?: number; waiting_confirm_since?: string | null;
  store?: { id: string; store_code: string; store_name: string; short_name: string | null } | null;
  equipment?: { id: string; name: string; asset_code: string | null } | null; facility?: { id: string; name: string; facility_code: string | null } | null;
  part?: { id: string; name: string; part_code: string | null; base_unit?: string | null } | null;
  is_overdue_confirm?: boolean; unread_store_comment_count?: number; store_reply_pending?: boolean;
};
export type RequestStats = Record<string, number>;
export type RequestPerms = { manage: boolean; create: boolean; purchaseManage: boolean; purchaseView: boolean; stockIssue: boolean; commentOwn: boolean; confirmOwn: boolean; stores: string[] };
export type CommentView = {
  id: string; visibility: string; body: string; original_body?: string | null; created_by_name: string | null; created_at: string; edited_at: string | null;
  is_edited: boolean; is_deleted: boolean; mine: boolean; can_edit: boolean; can_delete: boolean; source_context: string; read_by_name: string | null; read_at: string | null;
};
export type EventView = { id: string; event_type: string; title: string; description: string | null; created_by_name: string | null; created_at: string; visibility?: string; proxy_for_store?: boolean };
export type LinkedOrder = { id: string; po_no: string; status: string; expected_delivery_date: string | null; ordered_qty: number; received_qty: number; total_amount?: number; vendor_name?: string | null };

export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", PENDING_APPROVAL: "待核准", APPROVED: "已核准待下訂", ORDERED: "已下訂", PARTIALLY_RECEIVED: "部分到貨", RECEIVED: "全部到貨", CLOSED: "已結案", CANCELED: "已取消",
};
export const storeText = (s?: { store_name: string; short_name: string | null } | null) => (s ? s.short_name || s.store_name : "（門市資料不可見）");
export const targetText = (r: RequestRow) => r.equipment?.name || r.facility?.name || (r.part ? `${r.part.name}${r.part.part_code ? "（" + r.part.part_code + "）" : ""}` : "");
export const num = (n: number | null | undefined) => (n === null || n === undefined ? "" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 4 }));
export const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : "$" + Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 0 }));
/** 每次開表單產生一個固定識別（防連點與重送重複建立）。 */
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const isStale = (e: unknown) => e instanceof ApiError && (e.data?.code === "STALE" || e.status === 409);
