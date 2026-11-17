// M7/M8 第 5 批 G18／G19 工單規則（純函式，無相依，單元測試直接引用）。
// 與資料庫函式（ga_ws_wo_*）逐條對齊：階段常數、合法流轉表、焦點卡分類、工單編號、權限能力（缺哪個權限講清楚）、搜尋整形、輸入驗證、伺服端欄位遮蔽、列印資料整形、照片合併。
// 資料庫是最後一道防線（同交易、鎖列、版本檢查）；這裡的規則讓 API 在送出前先擋掉明顯錯誤，並讓畫面與測試用同一套說法。
import { isUuid } from "./rules";

// ---------------------------------------------------------------- 權限碼
export const WO = {
  viewOwn: "general_affairs.work_order.view_own_store",
  viewAll: "general_affairs.work_order.view_all",
  update: "general_affairs.work_order.update",
  manage: "general_affairs.work_order.manage",
  mrCreate: "general_affairs.maintenance_request.create",
  mrViewOwn: "general_affairs.maintenance_request.view_own_store",
  mrViewAll: "general_affairs.maintenance_request.view_all",
  mrUpdate: "general_affairs.maintenance_request.update",
  crossSubmit: "cross_dept.maintenance.submit",
  crossViewAll: "cross_dept.maintenance.view_all",
  crossUpdate: "cross_dept.maintenance.update",
  crossCategoryEdit: "cross_dept.maintenance.category.edit",
  forceClose: "general_affairs.service_center.force_close",
  txn: "general_affairs.inventory_transaction.manage",
  partView: "general_affairs.part.view",
  partManage: "general_affairs.part.manage",
} as const;

/** 與資料庫 ga_wo_can_update 相同：只有「查看全部」不算更新。 */
export const WO_UPDATE_CODES = [WO.update, WO.manage, WO.mrUpdate, WO.crossUpdate] as const;
export const WO_VIEW_ALL_CODES = [WO.viewAll, WO.mrViewAll, WO.crossViewAll] as const;
export const WO_OWN_CODES = [WO.viewOwn, WO.mrViewOwn, WO.mrCreate, WO.crossSubmit] as const;
/** 刪除權限（總務端）：與資料庫 ga_wo_can_delete_perm 相同。 */
export const WO_DELETE_CODES = [WO.manage, WO.mrUpdate, WO.crossUpdate] as const;
/** 維修分類可看：舊版 SHARED_MAINTENANCE_CATEGORY_VIEW_CODES。 */
export const WO_CATEGORY_VIEW_CODES = [...WO_UPDATE_CODES, ...WO_VIEW_ALL_CODES, ...WO_OWN_CODES, WO.crossCategoryEdit] as const;

// ---------------------------------------------------------------- 狀態與階段
export const WO_STATUSES = ["UNACCEPTED", "ACCEPTED", "PROCESSING", "COMPLETED"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_STATUS_LABELS: Record<WoStatus, string> = { UNACCEPTED: "未受理", ACCEPTED: "已受理", PROCESSING: "處理中", COMPLETED: "已完成" };

/** 16 階段（碼、名稱、排序、是否執行類）。排序與 DB maintenance_progress_stages 一致（OTHER 為 990）。 */
export const WO_STAGES = [
  { code: "INITIAL_REVIEW", label: "初步評估", sort: 10, exec: false },
  { code: "WAITING_STORE_INFO", label: "等待門市補充資料", sort: 20, exec: true },
  { code: "INTERNAL_HANDLING", label: "總務自行處理", sort: 30, exec: false },
  { code: "SEARCHING_VENDOR", label: "尋找廠商", sort: 40, exec: true },
  { code: "WAITING_VENDOR_REPLY", label: "等待廠商回覆", sort: 50, exec: true },
  { code: "WAITING_VENDOR_QUOTE", label: "等待廠商報價", sort: 60, exec: true },
  { code: "QUOTE_REVIEW", label: "報價確認中", sort: 70, exec: true },
  { code: "VENDOR_ASSIGNED", label: "已安排廠商", sort: 80, exec: true },
  { code: "WAITING_VENDOR_VISIT", label: "等待廠商到場", sort: 90, exec: true },
  { code: "VENDOR_WORKING", label: "廠商施工中", sort: 100, exec: true },
  { code: "WAITING_PARTS", label: "等待料件", sort: 110, exec: true },
  { code: "PARTS_IN_TRANSIT", label: "料件配送中", sort: 120, exec: true },
  { code: "WAITING_INTERNAL_APPROVAL", label: "等待內部確認", sort: 130, exec: true },
  { code: "WAITING_STORE_CONFIRMATION", label: "處理完成待門市確認", sort: 140, exec: true },
  { code: "REOPENED", label: "門市反映仍有問題", sort: 150, exec: true },
  { code: "OTHER", label: "其他", sort: 990, exec: false },
] as const;
export type WoStage = (typeof WO_STAGES)[number]["code"];
export const WO_STAGE_CODES: readonly string[] = WO_STAGES.map((s) => s.code);
export const stageLabel = (code: unknown) => WO_STAGES.find((s) => s.code === code)?.label ?? null;
export const isExecStage = (code: unknown) => !!WO_STAGES.find((s) => s.code === code)?.exec;
export const isStage = (code: unknown): code is WoStage => typeof code === "string" && WO_STAGE_CODES.includes(code);

/** 工單編號：WO- 加 id 前 8 碼大寫（與資料庫 ga_wo_no 相同）。 */
export const woNo = (id: string) => `WO-${String(id).slice(0, 8).toUpperCase()}`;

// ---------------------------------------------------------------- 焦點卡
export const WO_FOCUS_KEYS = ["store_rejected", "arrange", "vendor", "parts", "store_confirmation", "completed"] as const;
export type WoFocus = (typeof WO_FOCUS_KEYS)[number];
const VENDOR_STAGES = ["SEARCHING_VENDOR", "WAITING_VENDOR_REPLY", "WAITING_VENDOR_QUOTE", "QUOTE_REVIEW", "VENDOR_ASSIGNED", "WAITING_VENDOR_VISIT", "VENDOR_WORKING"];
/** 焦點卡分類（與資料庫 ga_wo_focus、舊版 getWorkOrderFocusKey 相同）。 */
export function focusOf(status: string, stage: string | null | undefined): WoFocus {
  if (status === "COMPLETED") return "completed";
  if (stage === "REOPENED") return "store_rejected";
  if (stage === "WAITING_STORE_CONFIRMATION") return "store_confirmation";
  if (stage === "WAITING_PARTS" || stage === "PARTS_IN_TRANSIT") return "parts";
  if (stage && VENDOR_STAGES.includes(stage)) return "vendor";
  return "arrange";
}

export const WO_SOURCES = ["REQUEST", "LEGACY"] as const;
export const WO_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const WO_SUPPLEMENT_TYPES = ["PHOTO_UNCLEAR", "MISSING_PHOTO", "DESCRIPTION_INSUFFICIENT", "RESOURCE_SELECTION_WRONG", "QUANTITY_OR_SPEC_INSUFFICIENT", "OTHER"] as const;
export const WO_COMPLETION_LABELS: Record<string, string> = { STORE_CONFIRMED: "門市確認完成", ADMIN_FORCE_CLOSED: "強制結案" };

// ---------------------------------------------------------------- 合法流轉表
export type WoAction = "SAVE_PROGRESS" | "REQUEST_COMPLETION" | "FORCE_CLOSE" | "REQUEST_SUPPLEMENT" | "STORE_CONFIRM" | "REPORT_UNRESOLVED" | "REPLY_SUPPLEMENT" | "ISSUE_PART" | "DELETE";
export const WO_ACTIONS: readonly WoAction[] = ["SAVE_PROGRESS", "REQUEST_COMPLETION", "FORCE_CLOSE", "REQUEST_SUPPLEMENT", "STORE_CONFIRM", "REPORT_UNRESOLVED", "REPLY_SUPPLEMENT", "ISSUE_PART", "DELETE"];

export type WoState = {
  status: WoStatus;
  stage: string | null;
  /** 是否連結需求單 */
  linked: boolean;
  /** 需求單目前主狀態（連結且需求單存在時） */
  requestStatus?: string | null;
};
export type WoActionInput = {
  /** SAVE_PROGRESS 時使用者選的階段 */
  stage?: string | null;
  /** 需求單單據摘要（補資料守衛）：採購單數（含草稿）、已出庫數量 */
  docs?: { po_count?: number; issued?: number } | null;
};
export type WoCheck = { ok: true; next: { status: WoStatus; stage: string | null } } | { ok: false; httpStatus: 409 | 422; code: string; message: string };

const deny = (httpStatus: 409 | 422, code: string, message: string): WoCheck => ({ ok: false, httpStatus, code, message });
const waitingConfirm = (s: WoState) => s.status === "PROCESSING" && s.stage === "WAITING_STORE_CONFIRMATION";
const waitingSupplement = (s: WoState) => s.stage === "WAITING_STORE_INFO" && s.linked && s.requestStatus === "WAITING_STORE_SUPPLEMENT";
const isOpen = (s: WoState) => s.status === "ACCEPTED" || s.status === "PROCESSING";

/**
 * 合法流轉表（設計文件 §3.1）。非法回 409／422 與白話說明；合法回流轉後的主狀態與階段。
 * 伺服端與資料庫函式共用同一套說法；資料庫以鎖列後的實際狀態為準。
 */
export function checkWoAction(action: WoAction, s: WoState, input: WoActionInput = {}): WoCheck {
  switch (action) {
    case "SAVE_PROGRESS": {
      if (s.status === "COMPLETED") {
        return deny(409, "INVALID_STATE", s.linked ? "工單已完成，不能再存進度；若要重新處理，請到需求單按「重新開啟」" : "工單已完成，不能再存進度；沒有需求單的舊式工單完成後不能重新開啟，需要時請另開新單");
      }
      if (waitingConfirm(s)) return deny(409, "WAITING_STORE_CONFIRMATION", "已送門市確認，請等門市回覆；如需聯絡門市請用留言");
      if (waitingSupplement(s)) return deny(409, "WAITING_STORE_SUPPLEMENT", "已請門市補資料，請等門市在「我的追蹤」回覆後再存進度");
      const picked = input.stage ?? null;
      if (picked === "WAITING_STORE_CONFIRMATION") return deny(422, "USE_REQUEST_COMPLETION", "要送門市確認請按「送門市確認」，不要直接選這個階段");
      if (picked === "WAITING_STORE_INFO" && s.linked) return deny(422, "USE_SUPPLEMENT", "要請門市補資料請按「補資料」，不要直接選這個階段");
      let target = picked ?? s.stage;
      if (target && isExecStage(target)) return { ok: true, next: { status: "PROCESSING", stage: target } };
      if (s.status === "UNACCEPTED") {
        target = target ?? "INITIAL_REVIEW";
        return { ok: true, next: { status: "ACCEPTED", stage: target } };
      }
      return { ok: true, next: { status: s.status, stage: target } };
    }
    case "REQUEST_COMPLETION": {
      if (!isOpen(s)) return deny(409, "INVALID_STATE", s.status === "COMPLETED" ? "工單已完成" : "工單還沒受理，請先存進度再送門市確認");
      if (s.stage === "WAITING_STORE_CONFIRMATION") return deny(409, "WAITING_STORE_CONFIRMATION", "已經送門市確認了，請等門市回覆");
      if (s.linked && s.requestStatus === "WAITING_STORE_SUPPLEMENT") return deny(409, "WAITING_STORE_SUPPLEMENT", "已請門市補資料，請等門市回覆後再送門市確認");
      return { ok: true, next: { status: "PROCESSING", stage: "WAITING_STORE_CONFIRMATION" } };
    }
    case "FORCE_CLOSE": {
      if (!isOpen(s)) return deny(409, "INVALID_STATE", s.status === "COMPLETED" ? "工單已經完成" : "工單還沒受理，不需要處理請直接刪除（沒有連需求單時）或先受理");
      return { ok: true, next: { status: "COMPLETED", stage: s.stage ?? "OTHER" } };
    }
    case "REQUEST_SUPPLEMENT": {
      if (!isOpen(s)) return deny(409, "INVALID_STATE", s.status === "COMPLETED" ? "工單已完成，不能請門市補資料" : "工單還沒受理，請先存進度再請門市補資料");
      if (s.stage === "WAITING_STORE_INFO") return deny(409, "INVALID_STATE", "已經在等門市補資料了");
      if (s.stage === "WAITING_STORE_CONFIRMATION") return deny(409, "INVALID_STATE", "已送門市確認，不能同時請門市補資料");
      if (s.linked && s.requestStatus != null) {
        if (!["ACCEPTED", "IN_PROGRESS", "WAITING_GA_REVIEW"].includes(s.requestStatus)) {
          return deny(409, "REQUEST_STATE", s.requestStatus === "WAITING_STORE_SUPPLEMENT" ? "需求單已經在等門市補資料" : s.requestStatus === "WAITING_STORE_CONFIRMATION" ? "需求單已送門市確認，不能請門市補資料" : "需求單已結案、退回或取消，不能請門市補資料");
        }
        if ((input.docs?.po_count ?? 0) > 0) return deny(409, "HAS_DOCUMENTS", "這張需求單已有採購單（含草稿），不能請門市補資料；請改用留言");
        if ((input.docs?.issued ?? 0) > 0) return deny(409, "HAS_DOCUMENTS", "這張需求單已經出庫，不能請門市補資料；請改用留言");
      }
      return { ok: true, next: { status: "PROCESSING", stage: "WAITING_STORE_INFO" } };
    }
    case "STORE_CONFIRM": {
      if (!waitingConfirm(s)) return deny(409, "INVALID_STATE", "目前不是「處理完成待門市確認」，不能按確認完成");
      if (s.linked && s.requestStatus === "WAITING_STORE_CONFIRMATION") return deny(409, "USE_REQUEST", "這張工單有需求單，請到「我的追蹤」確認完成");
      return { ok: true, next: { status: "COMPLETED", stage: s.stage } };
    }
    case "REPORT_UNRESOLVED": {
      if (!waitingConfirm(s)) return deny(409, "INVALID_STATE", "目前不是「處理完成待門市確認」，不能回報仍有問題");
      if (s.linked && s.requestStatus === "WAITING_STORE_CONFIRMATION") return deny(409, "USE_REQUEST", "這張工單有需求單，請到「我的追蹤」回報問題");
      return { ok: true, next: { status: "PROCESSING", stage: "REOPENED" } };
    }
    case "REPLY_SUPPLEMENT": {
      if (s.linked) return deny(409, "USE_REQUEST", "這張工單有需求單，請到「我的追蹤」回覆補資料");
      if (!(s.status === "PROCESSING" && s.stage === "WAITING_STORE_INFO")) return deny(409, "INVALID_STATE", "目前不是「等待門市補充資料」，不需要回覆");
      return { ok: true, next: { status: "PROCESSING", stage: "INITIAL_REVIEW" } };
    }
    case "ISSUE_PART": {
      if (!isOpen(s)) return deny(409, "INVALID_STATE", s.status === "COMPLETED" ? "工單已完成，不能領用料件" : "工單還沒受理，請先存進度再領用料件");
      if (s.stage === "WAITING_STORE_CONFIRMATION") return deny(409, "INVALID_STATE", "已送門市確認，不能再領用料件");
      return { ok: true, next: { status: s.status, stage: s.stage } };
    }
    case "DELETE": {
      if (s.status !== "UNACCEPTED") return deny(409, "INVALID_STATE", "這張工單已受理，不能刪除；不需要處理請用「不處理，強制結案」");
      if (s.linked) return deny(409, "HAS_REQUEST", "這張工單已連結需求單，不能刪除；不需要處理請用「不處理，強制結案」");
      return { ok: true, next: { status: s.status, stage: s.stage } };
    }
  }
}

// ---------------------------------------------------------------- 權限能力（頁面層級）
type Has = { has(code: string): boolean };
const any = (p: Has, codes: readonly string[]) => codes.some((c) => p.has(c));

export type WoAbilities = {
  canEnter: boolean;
  canViewAll: boolean;
  canViewOwnOnly: boolean;
  /** 總務端：看得到內部內容與處理人姓名 */
  gaSide: boolean;
  /** 可列印內部備註：只有更新／管理類權限；只有 view_all 的人看得到內部內容但不能列印（2026-11-17 使用者決定） */
  canPrintInternal: boolean;
  canUpdate: boolean;
  readOnly: boolean;
  /** 唯讀原因（白話，缺哪個權限講清楚）；可更新時為 null */
  readOnlyReason: string | null;
  canDeleteAny: boolean;
  canForceClose: boolean;
  forceCloseMissing: string | null;
  canIssuePart: boolean;
  issuePartMissing: string[];
  issuePartReason: string | null;
  canCreateLegacy: boolean;
  canViewCategories: boolean;
  canEditCategories: boolean;
};

/**
 * 頁面層級能力（對齊資料庫函式；DB 無管理員後備）。
 * profiles.role === 'admin' 只作說明用：沒有任何帶更新權限的有效角色時，只能看（若有看權）並白話說明（W9）。
 */
export function workOrderAbilities(p: Has, opts: { isAdminProfile?: boolean } = {}): WoAbilities {
  const viewAll = any(p, WO_VIEW_ALL_CODES);
  const update = any(p, WO_UPDATE_CODES);
  const own = any(p, WO_OWN_CODES);
  const enter = viewAll || update || own;
  const missing = [!update && "工單更新", !p.has(WO.txn) && "庫存交易管理", !(p.has(WO.partView) || p.has(WO.partManage)) && "料件查看"].filter(Boolean) as string[];
  const readOnlyReason = update ? null : viewAll ? "您只有查看工單的權限，不能修改；需要「工單更新」或「工單管理」權限"
    : opts.isAdminProfile ? "您的帳號沒有可修改工單的角色，請洽管理員授權" : "您沒有修改工單的權限";
  return {
    canEnter: enter,
    canViewAll: viewAll || update,
    canViewOwnOnly: enter && !(viewAll || update),
    gaSide: viewAll || update,
    canPrintInternal: update,
    canUpdate: update,
    readOnly: !update,
    readOnlyReason,
    canDeleteAny: any(p, WO_DELETE_CODES),
    canForceClose: update && p.has(WO.forceClose),
    forceCloseMissing: update && !p.has(WO.forceClose) ? "強制結案" : null,
    canIssuePart: missing.length === 0,
    issuePartMissing: missing,
    issuePartReason: missing.length ? `領用料件需要「工單更新」、「庫存交易管理」與「料件查看」三個權限，您缺少：${missing.join("、")}` : null,
    canCreateLegacy: update || p.has(WO.mrCreate) || p.has(WO.crossSubmit),
    canViewCategories: any(p, WO_CATEGORY_VIEW_CODES),
    canEditCategories: p.has(WO.crossCategoryEdit),
  };
}

// ---------------------------------------------------------------- 搜尋與輸入
/** 搜尋字串整形：去頭尾與控制字元、合併空白、最長 100 字。跳脫 LIKE 萬用字元由資料庫函式處理（ga_po_like_escape）。 */
export function normalizeSearch(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return s || null;
}
/** LIKE 萬用字元跳脫（與資料庫 ga_po_like_escape 相同）：% _ \ 都當成一般字元。 */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => "\\" + c);

export type ListFilters = { store_id?: string; status?: string; focus?: string; q?: string; source?: string; category_id?: string };
export class WoInputError extends Error {}
const bad = (m: string): never => { throw new WoInputError(m); };

export function parseListFilters(p: URLSearchParams): ListFilters {
  const out: ListFilters = {};
  const store = (p.get("store_id") || p.get("storeId") || "").trim();
  if (store) out.store_id = isUuid(store) ? store : bad("門市篩選格式錯誤");
  const cat = (p.get("category_id") || "").trim();
  if (cat) out.category_id = isUuid(cat) ? cat : bad("分類篩選格式錯誤");
  const status = (p.get("status") || "").trim().toUpperCase();
  if (status) out.status = (WO_STATUSES as readonly string[]).includes(status) ? status : bad("狀態篩選錯誤");
  const focus = (p.get("focus") || "").trim().toLowerCase();
  if (focus && focus !== "all") out.focus = (WO_FOCUS_KEYS as readonly string[]).includes(focus) ? focus : bad("焦點篩選錯誤");
  // 待我處理（V9）：attention=store_rejected 等於焦點卡「門市退回」，與徽章同一個述詞（ga_wo_focus）。
  const attention = (p.get("attention") || "").trim().toLowerCase();
  if (attention) { if (attention !== "store_rejected") bad("待辦篩選錯誤"); out.focus = "store_rejected"; }
  const source = (p.get("source") || "").trim().toUpperCase();
  if (source && source !== "ALL") out.source = (WO_SOURCES as readonly string[]).includes(source) ? source : bad("來源篩選錯誤");
  const q = normalizeSearch(p.get("q") ?? p.get("search"));
  if (q) out.q = q;
  return out;
}

const text = (v: unknown, max: number, label: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (s.length > max) bad(`${label}不可超過 ${max} 字`);
  return s;
};

/** 版本欄位：必填且要是可解析的時間（原字串原樣傳給資料庫，保留微秒精度）。 */
export function parseExpected(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return bad("缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(v))) return bad("版本資訊格式錯誤（expected_updated_at），請重新載入畫面");
  return v;
}

/** 存進度／送確認共用欄位：有填才送（不覆蓋承辦人、處理方式、廠商）。 */
export function validateProgressPayload(b: Record<string, any>, opts: { notesRequired: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const notes = text(b.notes, 2000, "處理說明");
  if (opts.notesRequired && !notes) bad("請填寫處理說明");
  if (notes) out.notes = notes;
  const vis = String(b.visibility ?? "").trim().toUpperCase();
  if (vis) out.visibility = ["PUBLIC", "INTERNAL"].includes(vis) ? vis : bad("公開範圍錯誤");
  const stage = String(b.progress_stage ?? "").trim().toUpperCase();
  if (stage) out.progress_stage = isStage(stage) ? stage : bad("進度階段錯誤");
  const date = String(b.progress_date ?? "").trim();
  if (date) out.progress_date = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : bad("進度日期格式錯誤（請用 YYYY-MM-DD）");
  for (const k of ["category_id", "assignee_id", "vendor_id"] as const) {
    const v = String(b[k] ?? "").trim();
    if (v) out[k] = isUuid(v) ? v : bad("分類、承辦人或廠商的識別碼格式錯誤");
  }
  const name = text(b.assignee_name, 100, "承辦人");
  if (name) out.assignee_name = name;
  const how = text(b.handling_method, 500, "處理方式");
  if (how) out.handling_method = how;
  return out;
}

export function validateForceClose(b: Record<string, any>) {
  const reason = text(b.force_close_reason ?? b.reason, 2000, "原因");
  if (!reason) bad("強制結案必須填寫原因");
  return { force_close_reason: reason as string };
}

export function validateSupplement(b: Record<string, any>) {
  const type = String(b.supplement_type ?? "").trim().toUpperCase();
  if (!(WO_SUPPLEMENT_TYPES as readonly string[]).includes(type)) bad("補資料類型錯誤");
  const note = text(b.supplement_note ?? b.note, 2000, "說明");
  if (!note) bad("要求補資料時必須填寫說明");
  return { supplement_type: type, supplement_note: note as string };
}

export function validateIssuePart(b: Record<string, any>) {
  if (!isUuid(b.location_id) || !isUuid(b.part_id)) bad("請選擇領用位置與料件");
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0) bad("數量必須大於 0");
  const unit = String(b.input_unit_type ?? "BASE").trim().toUpperCase();
  if (!["BASE", "PURCHASE"].includes(unit)) bad("單位類型錯誤");
  const key = String(b.idempotency_key ?? "").trim().slice(0, 120);
  if (!key) bad("缺少防重複識別碼，請重新整理畫面後再送出");
  return { location_id: b.location_id as string, part_id: b.part_id as string, quantity: qty, input_unit_type: unit, reason: text(b.reason, 500, "領用原因") ?? null, notes: text(b.notes, 500, "備註") ?? null, key };
}

export type LegacyReport = { store_id: string; title: string; description?: string; contact_name?: string; contact_phone?: string; priority: string; category_id?: string; issue_type?: string; resource_type?: string; key: string };
export const LEGACY_MAX_PHOTOS = 5;
export function validateLegacyReport(b: Record<string, any>): LegacyReport {
  const store = String(b.store_id ?? "").trim();
  if (!isUuid(store)) bad("請選擇門市");
  const title = text(b.title, 200, "標題");
  if (!title) bad("請填寫標題");
  const priority = String(b.priority ?? "normal").trim().toLowerCase() || "normal";
  if (!(WO_PRIORITIES as readonly string[]).includes(priority)) bad("優先順序錯誤");
  const cat = String(b.category_id ?? "").trim();
  if (cat && !isUuid(cat)) bad("分類識別碼格式錯誤");
  const key = String(b.idempotency_key ?? "").trim().slice(0, 120);
  if (!key) bad("缺少防重複識別碼，請重新整理畫面後再送出");
  return {
    store_id: store, title: title as string, description: text(b.description, 2000, "說明"), contact_name: text(b.contact_name, 100, "聯絡窗口"), contact_phone: text(b.contact_phone, 50, "聯絡電話"),
    priority, category_id: cat || undefined, issue_type: text(b.issue_type, 100, "問題類型"), resource_type: text(b.resource_type, 50, "資源類型"), key,
  };
}

// ---------------------------------------------------------------- 欄位遮蔽（伺服端第二道防線；資料庫函式本身已依身分整形）
const GA_ONLY_ROW_FIELDS = ["assignee_id", "assignee_name", "handling_method", "vendor_id", "accepted_by", "completed_by"] as const;

/** 非總務端：移除處理人、處理方式、廠商與一切 INTERNAL 內容（時間軸、用料清單、強制結案原因）。 */
export function maskWorkOrderRow<T extends Record<string, any>>(row: T, gaSide: boolean): T {
  if (gaSide) return row;
  const out: Record<string, any> = { ...row };
  for (const k of GA_ONLY_ROW_FIELDS) delete out[k];
  return out as T;
}
export function maskTimeline(items: any[] | null | undefined, gaSide: boolean) {
  const rows = Array.isArray(items) ? items : [];
  if (gaSide) return rows;
  return rows.filter((t) => t?.visibility === "PUBLIC").map(({ by_name: _b, ...rest }) => rest);
}
export function maskWorkOrderDetail(data: any, gaSide: boolean) {
  if (!data) return data;
  return {
    ...data,
    work_order: maskWorkOrderRow(data.work_order || {}, gaSide),
    timeline: maskTimeline(data.timeline, gaSide),
    parts: gaSide ? data.parts || [] : [],
    ga_side: gaSide,
  };
}

// ---------------------------------------------------------------- 照片
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"] as const;
export const isImageName = (name: unknown) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
  return !!m && (IMAGE_EXTENSIONS as readonly string[]).includes(m[1].toLowerCase());
};
export const isImageContentType = (t: unknown) => /^image\//i.test(String(t || ""));

export type WoPhoto = { id: string; source: "attachment" | "legacy"; legacy: boolean; label: string | null; file_name: string; content_type: string | null; at: string | null; update_id: string | null; signed_url: string | null };
/**
 * 四個來源合併成同一個照片區：新版共用附件（回報照片、進度照片）＋舊版 maintenance_photos、maintenance_update_photos（唯讀，標「舊版照片」）。
 * 非圖片一律擋下（不列入、不簽名）。簽名網址由呼叫端提供（path -> url），不外露儲存路徑。
 */
export function mergePhotos(attachments: any[], legacy: any[], signed: (bucket: string, path: string) => string | null): WoPhoto[] {
  const out: WoPhoto[] = [];
  for (const a of attachments || []) {
    if (!isImageContentType(a.content_type)) continue;
    out.push({ id: a.id, source: "attachment", legacy: false, label: a.resource_type === "MAINTENANCE_UPDATE" ? "進度照片" : "回報照片", file_name: a.file_name, content_type: a.content_type ?? null, at: a.uploaded_at ?? null, update_id: a.resource_type === "MAINTENANCE_UPDATE" ? a.resource_id ?? null : null, signed_url: signed(a.storage_bucket || "general-affairs-attachments", a.storage_path) });
  }
  for (const l of legacy || []) {
    if (!isImageName(l.file_name) && !isImageName(l.storage_path)) continue;
    out.push({ id: l.id, source: "legacy", legacy: true, label: "舊版照片", file_name: l.file_name, content_type: null, at: l.created_at ?? null, update_id: l.update_id ?? null, signed_url: signed(l.storage_bucket || "maintenance-photos", l.storage_path) });
  }
  return out.sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")) || x.id.localeCompare(y.id));
}

// ---------------------------------------------------------------- 列印
export type PrintPayload = {
  work_order: Record<string, any>;
  public_timeline: any[];
  include_internal: boolean;
  internal_updates: any[];
  force_close_reason: string | null;
  photos: WoPhoto[];
  printed_at: string | null;
};
/** 列印資料整形：非總務端一律不含內部（即使參數帶了也不給）；內部備註與強制結案原因只在 include_internal 時出現。 */
export function shapePrint(data: any, photos: WoPhoto[], gaSide: boolean, includeInternal: boolean): PrintPayload {
  const internal = gaSide && includeInternal && !!data?.include_internal;
  return {
    work_order: maskWorkOrderRow(data?.work_order || {}, gaSide),
    public_timeline: Array.isArray(data?.public_timeline) ? data.public_timeline : [],
    include_internal: internal,
    internal_updates: internal ? data?.internal_updates || [] : [],
    force_close_reason: internal ? data?.force_close_reason ?? null : null,
    photos,
    printed_at: data?.printed_at ?? null,
  };
}

// ---------------------------------------------------------------- 圖片檔頭檢查（Content-Type 可偽造，伺服端再看檔頭）
/** 依檔頭判斷真實格式；不是圖片回 null。支援 JPEG、PNG、WebP、HEIC／HEIF。 */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | "image/heic" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  const ascii = (from: number, len: number) => String.fromCharCode(...Array.from(b.slice(from, from + len)));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 4))) return "image/heic";
  return null;
}
