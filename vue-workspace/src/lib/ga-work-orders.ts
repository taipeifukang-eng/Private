// G18／G19 工單中心與跨部門維修頁：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/work-order-rules.ts，伺服端與頁面共用同一份）。
import { ApiError } from "../api";
import { WO_FOCUS_KEYS, WO_STAGES, type WoFocus } from "../../../lib/workspace/general-affairs/work-order-rules";

export type WoRow = {
  id: string; wo_no: string; store_id: string; store_code: string; store_name: string; title: string; description: string | null;
  status: "UNACCEPTED" | "ACCEPTED" | "PROCESSING" | "COMPLETED"; status_label: string; progress_stage: string | null; stage_label: string | null; priority: string;
  reported_by: string | null; reporter_name: string | null; reported_at: string; contact_name: string | null; contact_phone: string | null;
  issue_type: string | null; resource_type: string | null; category_id: string | null; category_name: string | null;
  source: "REQUEST" | "LEGACY"; ga_service_request_id: string | null; request_no: string | null; request_status: string | null; request_public_progress: string | null;
  equipment_name?: string | null; facility_name?: string | null; focus: WoFocus;
  accepted_at: string | null; completed_at: string | null; completion_requested_at: string | null; unresolved_reason: string | null;
  completion_method: string | null; completion_method_label: string | null; created_at: string; updated_at: string;
  assignee_name?: string | null; handling_method?: string | null;
};
export type WoTimelineItem = { kind: "update" | "event"; id: string; at: string; visibility: string; text: string | null; stage?: string | null; stage_label?: string | null; event_type?: string; by_name?: string | null; progress_date?: string | null };
export type WoPart = { event_id: string; at: string; transaction_no: string | null; part_code: string | null; part_name: string | null; location_name: string | null; quantity: string | null; unit: string | null; reason: string | null; by_name: string | null; verified_quantity_base: number | null };
export type WoPhotoView = { id: string; source: "attachment" | "legacy"; legacy: boolean; label: string | null; file_name: string; at: string | null; signed_url: string | null };
export type WoAbilitiesDb = {
  read_only: boolean; read_only_reason: string | null; can_save_progress: boolean; save_progress_reason: string | null; can_request_completion: boolean; request_completion_reason?: string | null;
  can_force_close: boolean; force_close_missing: string | null; can_request_supplement: boolean; request_supplement_reason: string | null;
  can_issue_part: boolean; issue_part_reason: string | null; issue_part_missing: string[] | null; can_delete: boolean; delete_reason: string | null; can_change_category: boolean;
  can_store_confirm: boolean; can_report_unresolved: boolean; store_use_request: boolean; can_reply_supplement: boolean; reply_supplement_use_request: boolean;
  can_reopen: boolean; reopen_note: string | null; can_print_internal: boolean; can_view_assignee: boolean;
};
export type WoDetail = { work_order: WoRow; timeline: WoTimelineItem[]; parts: WoPart[]; photos: WoPhotoView[]; abilities: WoAbilitiesDb; ga_side: boolean };
export type WoPageAbilities = {
  canEnter: boolean; canViewAll: boolean; canViewOwnOnly: boolean; gaSide: boolean; canPrintInternal: boolean; canUpdate: boolean; readOnly: boolean; readOnlyReason: string | null;
  canDeleteAny: boolean; canForceClose: boolean; canIssuePart: boolean; canCreateLegacy: boolean; canViewCategories: boolean; canEditCategories: boolean;
};
export type WoCategory = { id: string; name: string; sort_order: number; is_active: boolean; updated_at?: string };

export const FOCUS_LABEL: Record<WoFocus, string> = {
  store_rejected: "門市反映仍有問題", arrange: "待安排處理", vendor: "廠商處理中", parts: "等待料件", store_confirmation: "待門市確認", completed: "已完成",
};
export const FOCUS_KEYS = WO_FOCUS_KEYS;
export const PRIORITY_LABEL: Record<string, string> = { low: "低", normal: "一般", high: "高", urgent: "緊急" };
export const SUPPLEMENT_LABEL: Record<string, string> = {
  PHOTO_UNCLEAR: "照片不清楚", MISSING_PHOTO: "缺少照片", DESCRIPTION_INSUFFICIENT: "說明不足", RESOURCE_SELECTION_WRONG: "設備或設施選錯", QUANTITY_OR_SPEC_INSUFFICIENT: "數量或規格不足", OTHER: "其他",
};
/** 更新進度可選的階段：不含「待門市確認」（要按「送門市確認」）；有需求單時也不含「等待門市補充資料」（要按「補資料」）。 */
export function selectableStages(linked: boolean) {
  return WO_STAGES.filter((s) => s.code !== "WAITING_STORE_CONFIRMATION" && !(linked && s.code === "WAITING_STORE_INFO"));
}
/** 進度快捷鈕：一鍵帶入階段與說明。 */
export const QUICK_PROGRESS = [
  { id: "vendor-contacted", label: "已聯絡廠商", stage: "WAITING_VENDOR_REPLY", note: "已聯絡廠商，等待回覆。" },
  { id: "vendor-working", label: "廠商施工中", stage: "VENDOR_WORKING", note: "廠商已到場施工中。" },
  { id: "parts-waiting", label: "等待料件", stage: "WAITING_PARTS", note: "等待料件到貨。" },
  { id: "internal", label: "總務自行處理", stage: "INTERNAL_HANDLING", note: "由總務自行處理中。" },
] as const;

export const isStaleWo = (e: unknown) => e instanceof ApiError && e.data?.code === "STALE";
export const storeLabel = (r: { store_code?: string | null; store_name?: string | null }) => [r.store_code, r.store_name].filter(Boolean).join(" ") || "—";
export const EVENT_LABEL: Record<string, string> = {
  CREATED: "回報建立", ACCEPT: "受理", MIGRATED: "轉入工單", STORE_MOVED: "門市搬遷", PART_ISSUED: "領用料件", CATEGORY_CHANGED: "更換分類", FORCE_CLOSE_NOTICE: "總務已結案", REQUEST_SYNC_SKIPPED: "需求單同步未完成",
};
