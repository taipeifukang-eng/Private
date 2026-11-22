// M6 W32 督導管理日誌（workspace）共用規則：純函式，無相依；日期一律以 Asia/Taipei 計算，today 由呼叫端注入。
// 規則來源：舊版資料庫函式 supervisor_management_case_is_visible / case_is_manageable / daily_plan_is_visible / daily_plan_is_manageable
// （supabase/migrations/20260812154708、20260812155612、20260813063209）與 lib/supervisor-management-log/access.ts。
// 與舊版不同處見 tests/parity/allowlist.json 的 m6-w32-* 條目。
//
// E1 可見範圍三層：
//   管理（manage）          -> 全部案件
//   看團隊（view_team）     -> 自己管轄門市（store_managers：store_manager／supervisor／area_manager）的案件
//   一般（view_own 等）     -> 自己建立或被指派的案件
//   三層取聯集（同舊版資料庫政策）。
// E2 修改與刪除：自己的可改、可刪（未結案或取消）；管理者全部可改、可刪；刪除一律是軟刪除並留時間線事件。

export const SML_CODES = {
  viewOwn: "supervisor.management_log.view_own",
  viewTeam: "supervisor.management_log.view_team",
  create: "supervisor.management_log.create",
  updateOwn: "supervisor.management_log.update_own",
  followUp: "supervisor.management_log.follow_up",
  manage: "supervisor.management_log.manage",
} as const;
export const SML_ENTRY_CODES: string[] = Object.values(SML_CODES);

export type Caps = { viewOwn: boolean; viewTeam: boolean; create: boolean; updateOwn: boolean; followUp: boolean; manage: boolean };
export type Viewer = { userId: string; managedStoreIds: string[]; caps: Caps };
export const capsFrom = (has: (...codes: string[]) => boolean): Caps => ({
  viewOwn: has(SML_CODES.viewOwn),
  viewTeam: has(SML_CODES.viewTeam),
  create: has(SML_CODES.create),
  updateOwn: has(SML_CODES.updateOwn),
  followUp: has(SML_CODES.followUp),
  manage: has(SML_CODES.manage),
});
export const canEnter = (c: Caps) => Object.values(c).some(Boolean);
/** 舊版 canUpdateSupervisorManagementLog：update_own、follow_up、manage 任一。 */
export const canUpdateAny = (c: Caps) => c.updateOwn || c.followUp || c.manage;
export const canCreateCase = (c: Caps) => c.create || c.manage;
/** 舊版 canWriteSupervisorManagementDailyPlan。 */
export const canWritePlan = (c: Caps) => c.create || c.updateOwn || c.followUp || c.manage;

export type Tier = "all" | "team" | "own" | "none";
/** 畫面用：目前可見範圍的最高層（manage -> all；view_team -> team；其餘有權限 -> own）。 */
export function visibilityTier(c: Caps): Tier {
  if (c.manage) return "all";
  if (c.viewTeam) return "team";
  return canEnter(c) ? "own" : "none";
}

export type CaseLike = {
  owner_user_id: string;
  assigned_user_id?: string | null;
  store_id?: string | null;
  status?: string | null;
  deleted_at?: string | null;
};
const isClosed = (c: CaseLike) => c.status === "CLOSED" || c.status === "CANCELLED";
const manages = (v: Viewer, store: string | null | undefined) => !!store && v.managedStoreIds.includes(store);
const mine = (v: Viewer, c: CaseLike) => c.owner_user_id === v.userId;
const assignedToMe = (v: Viewer, c: CaseLike) => !!c.assigned_user_id && c.assigned_user_id === v.userId;

/** E1：案件是否在可見範圍（同舊版 supervisor_management_case_is_visible，權限語意改為正式區 has_permission）。 */
export function caseVisible(c: CaseLike, v: Viewer): boolean {
  if (c.deleted_at) return false;
  const k = v.caps;
  if (k.manage) return true;
  if ((k.viewOwn || k.create) && (mine(v, c) || assignedToMe(v, c))) return true;
  if (k.updateOwn && mine(v, c)) return true;
  if (k.followUp && (assignedToMe(v, c) || manages(v, c.store_id))) return true;
  if (k.viewTeam && manages(v, c.store_id)) return true;
  return false;
}
/** E2：案件是否可修改（同舊版 supervisor_management_case_is_manageable）。 */
export function caseManageable(c: CaseLike, v: Viewer): boolean {
  if (c.deleted_at) return false;
  const k = v.caps;
  if (k.manage) return true;
  if (isClosed(c)) return false;
  if (k.updateOwn && mine(v, c)) return true;
  if (k.followUp && (assignedToMe(v, c) || manages(v, c.store_id))) return true;
  return false;
}
/** E2：案件可否軟刪除：管理者全部；其他人只能刪自己建立、未結案的（需 update_own）。 */
export function caseDeletable(c: CaseLike, v: Viewer): boolean {
  if (c.deleted_at) return false;
  if (v.caps.manage) return true;
  return v.caps.updateOwn && mine(v, c) && !isClosed(c);
}
/** 追蹤紀錄的新增：舊版資料表政策要求同時持有 follow_up 權限且案件可修改。 */
export const canAddFollowup = (c: CaseLike, v: Viewer) => v.caps.followUp && caseManageable(c, v);
/** 新增管理紀錄：案件可修改。 */
export const canAddRecord = (c: CaseLike, v: Viewer) => canUpdateAny(v.caps) && caseManageable(c, v);
/** 紀錄或追蹤的修改、刪除（E2）：管理者全部；其他人只能動自己建立的，且案件仍可修改。 */
export function childEditable(createdBy: string | null | undefined, c: CaseLike, v: Viewer): boolean {
  if (c.deleted_at) return false;
  if (v.caps.manage) return true;
  return !!createdBy && createdBy === v.userId && caseManageable(c, v);
}

/**
 * 案件可見範圍的 PostgREST or() 條件；null 表示不限制（管理者），"" 表示沒有任何可見範圍。
 * 與 caseVisible 逐項對應（整合測試會用資料庫實際資料驗證兩者一致）。
 */
export function caseScopeFilter(v: Viewer): string | null {
  const k = v.caps;
  if (k.manage) return null;
  const parts = new Set<string>();
  const u = v.userId;
  if (k.viewOwn || k.create) {
    parts.add(`owner_user_id.eq.${u}`);
    parts.add(`assigned_user_id.eq.${u}`);
  }
  if (k.updateOwn) parts.add(`owner_user_id.eq.${u}`);
  const ids = v.managedStoreIds;
  if (k.followUp) {
    parts.add(`assigned_user_id.eq.${u}`);
    if (ids.length) parts.add(`store_id.in.(${ids.join(",")})`);
  }
  if (k.viewTeam && ids.length) parts.add(`store_id.in.(${ids.join(",")})`);
  return Array.from(parts).join(",");
}

export type PlanLike = { owner_user_id: string; store_id?: string | null; status?: string | null; deleted_at?: string | null };
/** 今日規劃可見範圍（同舊版 daily_plan_is_visible）：管理者全部；有任一寫入類權限者看自己的；看團隊者另看管轄門市。 */
export function planVisible(p: PlanLike, v: Viewer): boolean {
  if (p.deleted_at) return false;
  const k = v.caps;
  if (k.manage) return true;
  if ((k.viewOwn || k.create || k.updateOwn || k.followUp) && p.owner_user_id === v.userId) return true;
  if (k.viewTeam && manages(v, p.store_id)) return true;
  return false;
}
/** 今日規劃可修改、可刪除（同舊版 daily_plan_is_manageable；E2 新版刪除放寬到本人，見 m6-w32-e2-own-delete）。 */
export function planManageable(p: PlanLike, v: Viewer): boolean {
  if (p.deleted_at) return false;
  const k = v.caps;
  if (k.manage) return true;
  return p.owner_user_id === v.userId && p.status !== "DONE" && p.status !== "CANCELLED" && (k.create || k.updateOwn || k.followUp);
}
export function planScopeFilter(v: Viewer): string | null {
  const k = v.caps;
  if (k.manage) return null;
  const parts: string[] = [];
  if (k.viewOwn || k.create || k.updateOwn || k.followUp) parts.push(`owner_user_id.eq.${v.userId}`);
  if (k.viewTeam && v.managedStoreIds.length) parts.push(`store_id.in.(${v.managedStoreIds.join(",")})`);
  return parts.join(",");
}

/* ── 日期與追蹤佇列 ── */
const pad = (n: number) => String(n).padStart(2, "0");
export function taipeiDate(at: Date | string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const isDateString = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export type Bucket = "overdue" | "today" | "upcoming";
/** E4：逾期只標示不處理。沒有日期歸在「近期」，同舊版。 */
export function bucketFollowUp(date: string | null | undefined, today: string): Bucket {
  if (!date) return "upcoming";
  if (date < today) return "overdue";
  if (date === today) return "today";
  return "upcoming";
}
export const UPCOMING_DAYS = 7;

/* ── 案件狀態與結案欄位 ── */
export const CASE_STATUSES = ["OPEN", "FOLLOW_UP", "IMPROVING", "RESOLVED", "CLOSED", "CANCELLED"] as const;
/**
 * 資料庫限制：RESOLVED／CLOSED 必須有 resolved_at，CLOSED 必須有 closed_at；其他狀態兩者都必須為空。
 * 舊版 API 沒有處理這兩個欄位，所以把案件改成已改善或已結案會被資料庫限制擋下（500）；
 * 新版由這個函式依「新舊狀態」算出要寫入的欄位（allowlist：m6-w32-close-case-fields）。
 */
export function statusFields(prevStatus: string, nextStatus: string, prev: { resolved_at: string | null; closed_at: string | null }, nowIso: string) {
  const resolved = nextStatus === "RESOLVED" || nextStatus === "CLOSED";
  return {
    resolved_at: resolved ? prev.resolved_at || nowIso : null,
    closed_at: nextStatus === "CLOSED" ? prev.closed_at || nowIso : null,
  };
}

/* ── 時間線（事件） ── */
export type TimelineItem = { at: string; type: string; title: string; body: string | null; actor_user_id: string | null; record_id?: string | null; followup_id?: string | null; source: "event" | "case" | "record" | "followup" };
const FOLLOWUP_LABEL: Record<string, string> = { IMPROVED: "已改善", IMPROVING: "改善中", NOT_IMPROVED: "未改善", POSTPONED: "延後追蹤", CLOSED: "結案" };
const RECORD_LABEL: Record<string, string> = { MANAGEMENT: "管理紀錄", FOLLOW_UP: "追蹤安排", RESULT: "結果紀錄", NOTE: "備註" };
/**
 * 案件時間線：資料表事件（刪除、狀態變更、管理者修改）加上「建立案件、新增紀錄、新增追蹤」的即時合成項目，新到舊排序。
 * 合成項目不另外寫入資料庫（舊版資料庫沒有這些事件，也不需要補寫），所以已軟刪除的紀錄只留下刪除事件。
 */
export function buildTimeline(
  c: { created_at: string; created_by?: string | null; owner_user_id: string; title: string },
  records: { id: string; created_at: string; created_by?: string | null; record_type: string; action_summary: string }[],
  followups: { id: string; created_at: string; created_by?: string | null; result_status: string; result_notes: string }[],
  events: { event_type: string; event_at: string; title: string; body?: string | null; actor_user_id?: string | null; record_id?: string | null; followup_id?: string | null }[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  items.push({ at: c.created_at, type: "CASE_CREATED", title: "建立案件", body: c.title, actor_user_id: c.created_by ?? c.owner_user_id, source: "case" });
  for (const r of records) items.push({ at: r.created_at, type: "RECORD_ADDED", title: `新增${RECORD_LABEL[r.record_type] || "管理紀錄"}`, body: r.action_summary, actor_user_id: r.created_by ?? null, record_id: r.id, source: "record" });
  for (const f of followups) items.push({ at: f.created_at, type: "FOLLOWUP_ADDED", title: `新增追蹤：${FOLLOWUP_LABEL[f.result_status] || f.result_status}`, body: f.result_notes, actor_user_id: f.created_by ?? null, followup_id: f.id, source: "followup" });
  for (const e of events) items.push({ at: e.event_at, type: e.event_type, title: e.title, body: e.body ?? null, actor_user_id: e.actor_user_id ?? null, record_id: e.record_id ?? null, followup_id: e.followup_id ?? null, source: "event" });
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/* ── 搜尋 ── */
/** 搜尋字串：去前後空白、最長 100；LIKE 的 % _ \ 以反斜線跳脫（舊版直接把關鍵字組進 or() 字串，逗號與括號會改寫條件）。 */
export const cleanSearch = (q: unknown) => (typeof q === "string" ? q.trim().slice(0, 100) : "");
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => "\\" + c);
/** PostgREST or() 的「多欄位包含」條件；值整個以雙引號包起來，逗號與括號只是一般文字。 */
export function orContainsAny(columns: string[], escaped: string): string {
  const quoted = '"%' + escaped.replace(/[\\"]/g, (c) => "\\" + c) + '%"';
  return columns.map((c) => `${c}.ilike.${quoted}`).join(",");
}

/** 資料庫觸發器與函式的錯誤文字（格式 CODE: 訊息）轉成使用者看得到的訊息與狀態碼。 */
export function dbErrorInfo(error: { code?: string; message?: string } | null | undefined): { status: number; message: string } {
  const text = String(error?.message || "");
  const m = /^(?:SUPERVISOR|WORKSPACE_SUPERVISOR)_[A-Z_]+: ([\s\S]+)$/.exec(text);
  if (m) {
    if (/PERMISSION_DENIED|NOT_AUTHENTICATED|OWNER_MISMATCH/.test(text)) return { status: 403, message: m[1] };
    if (/NOT_FOUND/.test(text)) return { status: 404, message: m[1] };
    if (/ALREADY_DELETED/.test(text)) return { status: 409, message: m[1] };
    return { status: 400, message: m[1] };
  }
  if (error?.code === "42501") return { status: 403, message: "沒有此操作的權限" };
  if (error?.code === "23505") return { status: 409, message: "資料重複（例如案件編號已存在）" };
  if (error?.code === "23503") return { status: 400, message: "指定的人員、門市或關聯資料不存在" };
  if (error?.code === "23514") return { status: 400, message: "資料不符合規則，請檢查欄位" };
  return { status: 503, message: "資料讀取或寫入失敗，請稍後重試" };
}
