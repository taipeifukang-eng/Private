import { randomUUID } from "node:crypto";
import { checked, respond, uuid, WorkspaceError, type Context } from "./server";
import {
  addDays,
  bucketFollowUp,
  buildTimeline,
  canAddFollowup,
  canAddRecord,
  canCreateCase,
  canEnter,
  canUpdateAny,
  canWritePlan,
  capsFrom,
  caseDeletable,
  caseManageable,
  caseScopeFilter,
  caseVisible,
  childEditable,
  cleanSearch,
  dbErrorInfo,
  escapeLike,
  isDateString,
  orContainsAny,
  planManageable,
  planScopeFilter,
  planVisible,
  statusFields,
  taipeiDate,
  UPCOMING_DAYS,
  visibilityTier,
  type Caps,
  type Viewer,
} from "../supervisor-management-log/workspace-rules";
import {
  validateCasePayload,
  validateDailyPlanPayload,
  validateDeletionReason,
  validateFollowupPayload,
  validateRecordPayload,
} from "../supervisor-management-log/validation";
import { readVoiceMeta, saveTranscript, viewableTranscriptIds } from "./supervisor-voice";

// M6 W32：workspace 督導管理日誌 API 的伺服端邏輯（路由在 app/api/workspace/supervisor-management/[[...path]]）。
// 重用舊版 lib/supervisor-management-log/validation（欄位驗證、列舉、UUID 與日期格式）與同一組資料表、權限碼，不重寫商業規則。
// 讀取：admin client 加應用層範圍過濾（E1，正式區 has_permission 語意：不檢查 roles.is_active、沒有資料庫 admin 繞過）。
// 寫入：以登入者身分的 client（ctx.auth）寫入，所以舊版資料表的 RLS 與驗證觸發器照常生效（第二道關卡）；
//        軟刪除走 workspace_supervisor_soft_delete（DEV 檔 20261122130000）；時間線事件由 admin client 補寫（best-effort）。

const T = {
  cases: "supervisor_management_cases",
  records: "supervisor_management_records",
  followups: "supervisor_management_followups",
  events: "supervisor_management_case_events",
  plans: "supervisor_management_daily_plans",
  categories: "supervisor_management_categories",
} as const;

const CASE_LIST_SELECT = `
  id, case_no, title, category_id, owner_user_id, assigned_user_id, target_type, store_id, employee_id,
  target_name_snapshot, status, priority, opened_at, next_follow_up_at, resolved_at, closed_at, summary, created_at, updated_at,
  category:supervisor_management_categories(id, code, name),
  store:stores(id, store_code, store_name, short_name),
  employee:store_employees(id, employee_code, employee_name, current_position, position),
  owner:profiles!supervisor_management_cases_owner_user_id_fkey(id, full_name, email),
  assigned_user:profiles!supervisor_management_cases_assigned_user_id_fkey(id, full_name, email)`;
const CASE_DETAIL_SELECT = `*,
  category:supervisor_management_categories(id, code, name),
  store:stores(id, store_code, store_name, short_name),
  employee:store_employees(id, employee_code, employee_name, current_position, position),
  owner:profiles!supervisor_management_cases_owner_user_id_fkey(id, full_name, email),
  assigned_user:profiles!supervisor_management_cases_assigned_user_id_fkey(id, full_name, email)`;
const PLAN_SELECT = `
  id, plan_date, owner_user_id, target_type, store_id, employee_id, target_name_snapshot, category_id, title, status, started_at, completed_at,
  linked_case_id, linked_record_id, notes, metadata, created_at, updated_at,
  category:supervisor_management_categories(id, code, name),
  store:stores(id, store_code, store_name, short_name),
  employee:store_employees(id, employee_code, employee_name, current_position, position),
  owner:profiles!supervisor_management_daily_plans_owner_user_id_fkey(id, full_name, email),
  linked_case:supervisor_management_cases(id, case_no, title, status, priority, next_follow_up_at),
  linked_record:supervisor_management_records(id, record_type, record_date, observation, action_summary)`;
const RECORD_COLUMNS =
  "id, case_id, record_type, record_date, store_id, employee_id, category_id, target_name_snapshot, observation, judgment, action_summary, action_options, requires_follow_up, follow_up_date, follow_up_owner_id, expected_result, follow_up_method, ai_generated, created_by, created_at, updated_at";
const FOLLOWUP_COLUMNS = "id, case_id, source_record_id, follow_up_date, result_status, result_notes, next_follow_up_date, created_by, created_at, updated_at";
const CASE_SORTS = new Set(["opened_at", "updated_at", "next_follow_up_at", "priority", "status", "title"]);
const PLAN_SORTS = new Set(["plan_date", "updated_at", "status", "title", "target_type"]);
const MANAGER_ROLE_TYPES = ["store_manager", "supervisor", "area_manager"];

type Body = Record<string, unknown>;
const one = (v: any) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const today = () => taipeiDate(new Date());

async function readBody(request: Request): Promise<Body> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkspaceError(400, "請求內容格式不正確");
  return body as Body;
}
/** 舊版 validation 以 Error 丟出欄位錯誤；轉成 400 與同一段文字。 */
function validated<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new WorkspaceError(400, e instanceof Error ? e.message : "資料格式錯誤");
  }
}
function dbFail(error: unknown): never {
  const info = dbErrorInfo(error as any);
  throw new WorkspaceError(info.status, info.message);
}
function dbOk<T>(result: { data: T; error: unknown }): T {
  if (result.error) dbFail(result.error);
  return result.data;
}
const pagination = (params: URLSearchParams) => {
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || 20) || 20));
  return { page, pageSize };
};

/** 登入者的可見範圍資料：權限（正式區語意）加管轄門市。 */
export async function viewerOf(ctx: Context): Promise<Viewer> {
  const caps = capsFrom(ctx.has);
  let managedStoreIds: string[] = [];
  if (caps.viewTeam || caps.followUp) {
    const rows = checked(await ctx.admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id).in("role_type", MANAGER_ROLE_TYPES)) as { store_id: string }[] | null;
    managedStoreIds = Array.from(new Set((rows || []).map((r) => r.store_id).filter(Boolean)));
  }
  return { userId: ctx.user.id, managedStoreIds, caps };
}
async function enter(ctx: Context): Promise<Viewer> {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  return v;
}
const viewerInfo = (v: Viewer) => ({ tier: visibilityTier(v.caps), caps: v.caps, user_id: v.userId });

async function addEvent(ctx: Context, caseId: string, type: string, title: string, body: string | null, extra: Record<string, unknown> = {}) {
  try {
    await ctx.admin.from(T.events).insert({ case_id: caseId, event_type: type, title, body, actor_user_id: ctx.user.id, metadata: { workspace: true }, ...extra });
  } catch {
    /* 時間線事件是輔助紀錄；寫入失敗不影響已完成的主要操作 */
  }
}

export async function loadCase(ctx: Context, v: Viewer, id: string, select = "*") {
  if (!uuid(id)) throw new WorkspaceError(400, "案件 id格式錯誤");
  const row = checked(await ctx.admin.from(T.cases).select(select).eq("id", id).is("deleted_at", null).maybeSingle()) as any;
  // 看不到與不存在一律 404（舊版由 RLS 讓查詢回空，同樣 404）
  if (!row || !caseVisible(row, v)) throw new WorkspaceError(404, "找不到督導管理案件");
  return row;
}
function withScope(query: any, filter: string | null) {
  return filter === null ? query : query.or(filter);
}

/* ───────────── 案件 ───────────── */

/** GET cases?page=&pageSize=&sortBy=&sortOrder=&status=&targetType=&storeId=&search=：E1 可見範圍內的案件清單。 */
export async function listCases(ctx: Context, params: URLSearchParams) {
  const v = await enter(ctx);
  const { page: want, pageSize } = pagination(params);
  const sortBy = CASE_SORTS.has(params.get("sortBy") || "") ? params.get("sortBy")! : "updated_at";
  const ascending = params.get("sortOrder") === "asc";
  const scope = caseScopeFilter(v);
  const base = { viewer: viewerInfo(v) };
  if (scope === "") return respond({ success: true, data: [], meta: { page: 1, pageSize, total: 0, totalPages: 1 }, ...base });
  const apply = (q: any) => {
    q = withScope(q.is("deleted_at", null), scope);
    const status = params.get("status")?.trim();
    if (status) q = q.eq("status", status.toUpperCase());
    const targetType = params.get("targetType")?.trim();
    if (targetType) q = q.eq("target_type", targetType.toUpperCase());
    const storeId = params.get("storeId")?.trim();
    if (storeId) {
      if (!uuid(storeId)) throw new WorkspaceError(400, "門市 id格式錯誤");
      q = q.eq("store_id", storeId);
    }
    const keyword = cleanSearch(params.get("search"));
    if (keyword) q = q.or(orContainsAny(["title", "target_name_snapshot", "summary", "case_no"], escapeLike(keyword)));
    return q;
  };
  const { count } = (await apply(ctx.admin.from(T.cases).select("id", { count: "exact", head: true }))) as { count: number | null };
  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(want, totalPages);
  const from = (page - 1) * pageSize;
  const rows = checked(await apply(ctx.admin.from(T.cases).select(CASE_LIST_SELECT)).order(sortBy, { ascending }).order("id", { ascending: true }).range(from, from + pageSize - 1)) as any[] | null;
  const data = (rows || []).map((r) => ({ ...r, can_edit: caseManageable(r, v), can_delete: caseDeletable(r, v) }));
  return respond({ success: true, data, meta: { page, pageSize, total, totalPages }, ...base });
}


/** POST cases：建立案件（建立者為登入者）。 */
export async function createCase(ctx: Context, request: Request) {
  const v = await viewerOf(ctx);
  if (!canCreateCase(v.caps)) throw new WorkspaceError(403, "沒有建立督導管理日誌權限");
  const body = await readBody(request);
  const id = randomUUID();
  const payload = { ...validated(() => validateCasePayload(body)), owner_user_id: ctx.user.id, id };
  dbOk(await ctx.auth.from(T.cases).insert(payload));
  return respond({ success: true, data: { id } }, 201);
}

/** GET cases/:id（?deleted=1 只有管理者：看已軟刪除的案件、被刪除的紀錄與刪除原因，供事後追查）。 */
export async function getCase(ctx: Context, id: string, params: URLSearchParams) {
  const v = await enter(ctx);
  if (!uuid(id)) throw new WorkspaceError(400, "案件 id格式錯誤");
  const includeDeleted = params.get("deleted") === "1";
  if (includeDeleted && !v.caps.manage) throw new WorkspaceError(403, "只有管理者可以查看已刪除的案件");
  let row: any;
  if (includeDeleted) {
    row = checked(await ctx.admin.from(T.cases).select(`${CASE_DETAIL_SELECT}, deleter:profiles!supervisor_management_cases_deleted_by_fkey(id, full_name, email)`).eq("id", id).maybeSingle());
    if (!row) throw new WorkspaceError(404, "找不到督導管理案件");
  } else {
    row = await loadCase(ctx, v, id, CASE_DETAIL_SELECT);
  }
  const recQuery = ctx.admin.from(T.records).select(`${RECORD_COLUMNS}, deleted_at, deletion_reason`).eq("case_id", id).order("record_date", { ascending: false }).order("created_at", { ascending: false });
  const fuQuery = ctx.admin.from(T.followups).select(`${FOLLOWUP_COLUMNS}, deleted_at, deletion_reason`).eq("case_id", id).order("follow_up_date", { ascending: false }).order("created_at", { ascending: false });
  const [records, followups, events] = await Promise.all([
    includeDeleted ? recQuery : recQuery.is("deleted_at", null),
    includeDeleted ? fuQuery : fuQuery.is("deleted_at", null),
    ctx.admin.from(T.events).select("id, case_id, record_id, followup_id, event_type, event_at, title, body, actor_user_id").eq("case_id", id).order("event_at", { ascending: false }),
  ]);
  const withTranscript = await viewableTranscriptIds(ctx, id, v.userId, v.caps.manage);
  const recs = ((checked(records) as any[] | null) || []).map((r) => ({ ...r, has_transcript: withTranscript.has(r.id), can_edit: !r.deleted_at && childEditable(r.created_by, row, v), can_delete: !r.deleted_at && childEditable(r.created_by, row, v) }));
  const fus = ((checked(followups) as any[] | null) || []).map((f) => ({ ...f, can_delete: !f.deleted_at && childEditable(f.created_by, row, v) }));
  const evs = (checked(events) as any[] | null) || [];
  const live = (x: any) => !x.deleted_at;
  const timeline = buildTimeline(row, recs.filter(live), fus.filter(live), evs);
  const data = {
    ...row,
    records: recs,
    followups: fus,
    events: evs,
    timeline,
    permissions: {
      edit: !row.deleted_at && caseManageable(row, v),
      delete: caseDeletable(row, v),
      add_record: !row.deleted_at && canAddRecord(row, v),
      add_followup: !row.deleted_at && canAddFollowup(row, v),
    },
  };
  return respond({ success: true, data, viewer: viewerInfo(v) });
}

/** PATCH cases/:id：修改案件（E2：自己的未結案案件、管理者全部）。狀態改成已改善或已結案時一併寫入 resolved_at／closed_at。 */
export async function updateCase(ctx: Context, request: Request, id: string) {
  const v = await viewerOf(ctx);
  if (!canUpdateAny(v.caps)) throw new WorkspaceError(403, "沒有編輯督導管理日誌權限");
  const row = await loadCase(ctx, v, id);
  if (!caseManageable(row, v)) throw new WorkspaceError(403, "沒有編輯這個案件的權限：只能編輯自己建立且未結案的案件，管理者可編輯全部");
  const body = await readBody(request);
  const payload: Record<string, unknown> = validated(() => validateCasePayload(body, { partial: true }));
  if ("assigned_user_id" in payload && payload.assigned_user_id !== row.assigned_user_id && !(v.caps.manage || row.owner_user_id === v.userId)) {
    throw new WorkspaceError(403, "只有建立者或管理者可以更換指派人員");
  }
  const statusChanged = typeof payload.status === "string" && payload.status !== row.status;
  if (statusChanged) Object.assign(payload, statusFields(row.status, payload.status as string, row, new Date().toISOString()));
  const updated = dbOk(await ctx.auth.from(T.cases).update(payload).eq("id", id).is("deleted_at", null).select("id")) as { id: string }[] | null;
  if (!updated?.length) throw new WorkspaceError(403, "沒有編輯這個案件的權限");
  const changed = Object.keys(payload).filter((k) => !["resolved_at", "closed_at"].includes(k) && JSON.stringify(payload[k] ?? null) !== JSON.stringify(row[k] ?? null));
  if (statusChanged) await addEvent(ctx, id, "STATUS_CHANGE", "案件狀態變更", `${row.status} -> ${payload.status}`);
  if (row.owner_user_id !== v.userId && changed.length) await addEvent(ctx, id, "MANAGER_EDIT", "他人修改案件", `修改欄位：${changed.join("、")}`);
  return respond({ success: true, data: null });
}

/** 讀刪除原因（舊版格式：body.deletion_reason）。 */
async function deletionReason(request: Request) {
  const body = await request.json().catch(() => ({}));
  return validated(() => validateDeletionReason(body));
}
async function softDelete(ctx: Context, kind: "case" | "record" | "followup", id: string, reason: string) {
  dbOk(await ctx.auth.rpc("workspace_supervisor_soft_delete", { p_kind: kind, p_id: id, p_reason: reason }));
}

/** DELETE cases/:id（body.deletion_reason）：軟刪除案件與其紀錄、追蹤，並寫時間線事件 SOFT_DELETE（E2）。 */
export async function deleteCase(ctx: Context, request: Request, id: string) {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  const row = await loadCase(ctx, v, id);
  if (!caseDeletable(row, v)) throw new WorkspaceError(403, "沒有刪除這個案件的權限：只能刪除自己建立且未結案的案件，管理者可刪除全部");
  await softDelete(ctx, "case", id, await deletionReason(request));
  return respond({ success: true, data: { ok: true, id } });
}

/* ───────────── 紀錄 ───────────── */

/** GET cases/:id/records */
export async function listRecords(ctx: Context, caseId: string) {
  const v = await enter(ctx);
  const row = await loadCase(ctx, v, caseId);
  const rows = (checked(await ctx.admin.from(T.records).select(RECORD_COLUMNS).eq("case_id", caseId).is("deleted_at", null).order("record_date", { ascending: false }).order("created_at", { ascending: false })) as any[] | null) || [];
  return respond({ success: true, data: rows.map((r) => ({ ...r, can_edit: childEditable(r.created_by, row, v), can_delete: childEditable(r.created_by, row, v) })) });
}

const RECORD_FIELDS = ["record_type", "record_date", "store_id", "employee_id", "category_id", "target_name_snapshot", "observation", "judgment", "action_summary", "action_options", "requires_follow_up", "follow_up_date", "follow_up_owner_id", "expected_result", "follow_up_method", "ai_generated", "metadata"];
/** 紀錄內容：缺的對象欄位從案件帶入；需要追蹤時負責人預設為案件指派人員或建立者；AI 產生的紀錄一律記錄由登入者人工確認。 */
function recordPayload(ctx: Context, c: any, body: Body, base: Body = {}) {
  const merged: Body = { ...base };
  for (const k of RECORD_FIELDS) if (k in body) merged[k] = body[k];
  for (const k of ["store_id", "employee_id", "category_id"]) if (merged[k] === undefined) merged[k] = c[k] ?? null;
  if (!merged.target_name_snapshot) merged.target_name_snapshot = c.target_name_snapshot;
  if (merged.requires_follow_up === true && !merged.follow_up_owner_id) merged.follow_up_owner_id = c.assigned_user_id || c.owner_user_id;
  if (!merged.record_date) merged.record_date = today();
  merged.ai_confirmed_by = merged.ai_generated === true ? ctx.user.id : null;
  const out: Record<string, unknown> = validated(() => validateRecordPayload(merged));
  if (out.requires_follow_up) {
    if (!out.follow_up_date || !out.expected_result) throw new WorkspaceError(400, "需要追蹤時，請填寫追蹤日期與預期結果");
  } else {
    out.follow_up_date = out.follow_up_date ?? null;
  }
  return out;
}

/** POST cases/:id/records：新增管理紀錄（發現、判斷、動作三欄必填）。 */
export async function addRecord(ctx: Context, request: Request, caseId: string) {
  const v = await viewerOf(ctx);
  if (!canUpdateAny(v.caps)) throw new WorkspaceError(403, "沒有新增督導管理紀錄權限");
  const row = await loadCase(ctx, v, caseId);
  if (!canAddRecord(row, v)) throw new WorkspaceError(403, "沒有在這個案件新增管理紀錄的權限");
  const body = await readBody(request);
  // W33：語音口述流程送來的紀錄（body.voice）。儲存一律是人工送出（發現、判斷、動作三欄仍由 validateRecordPayload 把關）；
  // 只有 OpenAI 路徑才標 ai_generated（確認人固定為送出者）；逐字稿存在獨立資料表，只有建立者與管理者看得到（E6）。
  const voice = readVoiceMeta(body.voice);
  if (voice) {
    body.ai_generated = voice.ai_provider === "OPENAI";
    const base = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? (body.metadata as Body) : {};
    body.metadata = { ...base, voice: { source: voice.source, ai_provider: voice.ai_provider } };
  }
  const id = randomUUID();
  const payload = { ...recordPayload(ctx, row, body), case_id: caseId, id };
  dbOk(await ctx.auth.from(T.records).insert(payload));
  const transcriptSaved = voice ? await saveTranscript(ctx, caseId, id, voice) : undefined;
  return respond({ success: true, data: { id, ...(voice ? { transcript_saved: transcriptSaved } : {}) } }, 201);
}

export async function loadRecord(ctx: Context, caseId: string, recordId: string) {
  if (!uuid(recordId)) throw new WorkspaceError(400, "紀錄 id格式錯誤");
  const rec = checked(await ctx.admin.from(T.records).select(`${RECORD_COLUMNS}, metadata`).eq("id", recordId).eq("case_id", caseId).is("deleted_at", null).maybeSingle()) as any;
  if (!rec) throw new WorkspaceError(404, "找不到督導管理紀錄");
  return rec;
}

/** PATCH cases/:id/records/:rid：修改紀錄（E2：自己建立的、案件仍可修改；管理者全部），留 RECORD_EDIT 事件。 */
export async function editRecord(ctx: Context, request: Request, caseId: string, recordId: string) {
  const v = await viewerOf(ctx);
  if (!canUpdateAny(v.caps)) throw new WorkspaceError(403, "沒有編輯督導管理紀錄權限");
  const row = await loadCase(ctx, v, caseId);
  const rec = await loadRecord(ctx, caseId, recordId);
  if (!childEditable(rec.created_by, row, v)) throw new WorkspaceError(403, "沒有編輯這筆紀錄的權限：只能編輯自己建立的紀錄，管理者可編輯全部");
  const body = await readBody(request);
  const base: Body = {};
  for (const k of RECORD_FIELDS) base[k] = rec[k];
  const payload = recordPayload(ctx, row, body, base);
  const updated = dbOk(await ctx.auth.from(T.records).update(payload).eq("id", recordId).eq("case_id", caseId).is("deleted_at", null).select("id")) as { id: string }[] | null;
  if (!updated?.length) throw new WorkspaceError(403, "沒有編輯這筆紀錄的權限");
  await addEvent(ctx, caseId, "RECORD_EDIT", "修改督導管理紀錄", rec.created_by === v.userId ? null : "由他人修改", { record_id: recordId });
  return respond({ success: true, data: null });
}

/** DELETE cases/:id/records/:rid（body.deletion_reason）：軟刪除並寫 RECORD_SOFT_DELETE 事件。 */
export async function deleteRecord(ctx: Context, request: Request, caseId: string, recordId: string) {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  const row = await loadCase(ctx, v, caseId);
  const rec = await loadRecord(ctx, caseId, recordId);
  if (!childEditable(rec.created_by, row, v)) throw new WorkspaceError(403, "沒有刪除這筆紀錄的權限：只能刪除自己建立的紀錄，管理者可刪除全部");
  await softDelete(ctx, "record", recordId, await deletionReason(request));
  return respond({ success: true, data: { ok: true, id: recordId } });
}

/* ───────────── 追蹤 ───────────── */

/** GET cases/:id/followups */
export async function listFollowups(ctx: Context, caseId: string) {
  const v = await enter(ctx);
  const row = await loadCase(ctx, v, caseId);
  const rows = (checked(await ctx.admin.from(T.followups).select(FOLLOWUP_COLUMNS).eq("case_id", caseId).is("deleted_at", null).order("follow_up_date", { ascending: false }).order("created_at", { ascending: false })) as any[] | null) || [];
  return respond({ success: true, data: rows.map((f) => ({ ...f, can_delete: childEditable(f.created_by, row, v) })) });
}

/** POST cases/:id/followups：新增追蹤結果（需 follow_up 權限且案件可修改，同舊版資料表政策）。 */
export async function addFollowup(ctx: Context, request: Request, caseId: string) {
  const v = await viewerOf(ctx);
  if (!canUpdateAny(v.caps)) throw new WorkspaceError(403, "沒有新增督導追蹤紀錄權限");
  const row = await loadCase(ctx, v, caseId);
  if (!canAddFollowup(row, v)) throw new WorkspaceError(403, "沒有在這個案件新增追蹤紀錄的權限（需要追蹤權限，且案件未結案）");
  const body = await readBody(request);
  const payload: Record<string, unknown> = validated(() => validateFollowupPayload({ ...body, follow_up_date: body.follow_up_date || today() }));
  if (payload.source_record_id) {
    const src = checked(await ctx.admin.from(T.records).select("id").eq("id", payload.source_record_id as string).eq("case_id", caseId).is("deleted_at", null).maybeSingle());
    if (!src) throw new WorkspaceError(400, "來源紀錄不存在或不屬於這個案件");
  }
  const id = randomUUID();
  dbOk(await ctx.auth.from(T.followups).insert({ ...payload, case_id: caseId, id }));
  return respond({ success: true, data: { id } }, 201);
}

/** DELETE cases/:id/followups/:fid（body.deletion_reason）：軟刪除並寫 FOLLOWUP_SOFT_DELETE 事件。 */
export async function deleteFollowup(ctx: Context, request: Request, caseId: string, followupId: string) {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  const row = await loadCase(ctx, v, caseId);
  if (!uuid(followupId)) throw new WorkspaceError(400, "追蹤 id格式錯誤");
  const fu = checked(await ctx.admin.from(T.followups).select("id, created_by").eq("id", followupId).eq("case_id", caseId).is("deleted_at", null).maybeSingle()) as any;
  if (!fu) throw new WorkspaceError(404, "找不到督導追蹤紀錄");
  if (!childEditable(fu.created_by, row, v)) throw new WorkspaceError(403, "沒有刪除這筆追蹤的權限：只能刪除自己建立的追蹤，管理者可刪除全部");
  await softDelete(ctx, "followup", followupId, await deletionReason(request));
  return respond({ success: true, data: { ok: true, id: followupId } });
}

/** GET cases/:id/timeline：案件時間線（建立、紀錄、追蹤、狀態變更、他人修改、刪除事件），新到舊。 */
export async function getTimeline(ctx: Context, caseId: string) {
  const v = await enter(ctx);
  const row = await loadCase(ctx, v, caseId);
  const [records, followups, events] = await Promise.all([
    ctx.admin.from(T.records).select("id, created_at, created_by, record_type, action_summary").eq("case_id", caseId).is("deleted_at", null),
    ctx.admin.from(T.followups).select("id, created_at, created_by, result_status, result_notes").eq("case_id", caseId).is("deleted_at", null),
    ctx.admin.from(T.events).select("record_id, followup_id, event_type, event_at, title, body, actor_user_id").eq("case_id", caseId),
  ]);
  const items = buildTimeline(row, (checked(records) as any[]) || [], (checked(followups) as any[]) || [], (checked(events) as any[]) || []);
  return respond({ success: true, data: items });
}

/* ───────────── 今日工作台與每日計畫（E3） ───────────── */

/** GET today?date=：今日規劃、追蹤佇列（逾期、今天、七天內）、今日紀錄與摘要；日期預設為台北今天（舊版用 UTC 日期）。 */
export async function todayWorkspace(ctx: Context, params: URLSearchParams) {
  const v = await enter(ctx);
  const requested = params.get("date");
  const date = isDateString(requested) ? requested : today();
  const upcomingEnd = addDays(date, UPCOMING_DAYS);
  const planScope = planScopeFilter(v);
  const caseScope = caseScopeFilter(v);

  const plansQuery = planScope === "" ? null : withScope(ctx.admin.from(T.plans).select(PLAN_SELECT).eq("plan_date", date).is("deleted_at", null), planScope).order("status", { ascending: true }).order("updated_at", { ascending: false });
  const queueQuery = caseScope === "" ? null : withScope(ctx.admin.from(T.cases).select(
    `id, case_no, title, target_type, store_id, employee_id, owner_user_id, assigned_user_id, target_name_snapshot, status, priority, next_follow_up_at, summary, updated_at,
     store:stores(id, store_code, store_name, short_name),
     employee:store_employees(id, employee_code, employee_name, current_position, position)`,
  ).is("deleted_at", null).not("next_follow_up_at", "is", null).lte("next_follow_up_at", upcomingEnd).not("status", "in", "(CLOSED,CANCELLED)"), caseScope).order("next_follow_up_at", { ascending: true });
  const recordsQuery = ctx.admin.from(T.records).select(`${RECORD_COLUMNS.replace("created_by, ", "")}, case:supervisor_management_cases(id, case_no, title, status, priority, next_follow_up_at, owner_user_id, assigned_user_id, store_id, deleted_at)`).eq("record_date", date).is("deleted_at", null).order("created_at", { ascending: false });

  const [plansRes, queueRes, recordsRes] = await Promise.all([plansQuery, queueQuery, recordsQuery]);
  const plans = ((plansRes ? checked(plansRes) : []) as any[] | null || []).map((p) => ({ ...p, can_edit: planManageable(p, v), can_delete: planManageable(p, v) }));
  const queueCases = ((queueRes ? checked(queueRes) : []) as any[] | null) || [];
  // 今日紀錄：只留所屬案件在可見範圍內的（紀錄的可見範圍跟著案件）
  const todayRecords = (((checked(recordsRes) as any[] | null) || []).filter((r) => { const c = one(r.case); return !!c && caseVisible(c, v); })).map((r) => { const c = one(r.case); return { ...r, case: c ? { id: c.id, case_no: c.case_no, title: c.title, status: c.status, priority: c.priority, next_follow_up_at: c.next_follow_up_at } : null }; });

  const ids = queueCases.map((c) => c.id);
  const latest = new Map<string, unknown>();
  if (ids.length) {
    const rows = (checked(await ctx.admin.from(T.records).select("id, case_id, record_date, observation, judgment, action_summary, follow_up_date, expected_result, created_at").in("case_id", ids).is("deleted_at", null).order("record_date", { ascending: false }).order("created_at", { ascending: false })) as any[] | null) || [];
    for (const r of rows) if (!latest.has(r.case_id)) latest.set(r.case_id, r);
  }
  const followUpQueue = queueCases.map((c) => ({ ...c, bucket: bucketFollowUp(c.next_follow_up_at, date), latest_record: latest.get(c.id) || null }));
  const count = <T,>(list: T[], pick: (x: T) => string) => list.reduce<Record<string, number>>((a, x) => ((a[pick(x)] = (a[pick(x)] || 0) + 1), a), {});
  const ps = count(plans, (p: any) => p.status);
  const fs = count(followUpQueue, (c: any) => c.bucket);
  return respond({
    success: true,
    data: {
      date,
      plans,
      followUpQueue,
      todayRecords,
      summary: {
        plans: { total: plans.length, planned: ps.PLANNED || 0, inProgress: ps.IN_PROGRESS || 0, done: ps.DONE || 0, cancelled: ps.CANCELLED || 0 },
        followUps: { total: followUpQueue.length, overdue: fs.overdue || 0, today: fs.today || 0, upcoming: fs.upcoming || 0 },
        records: { total: todayRecords.length },
      },
    },
    viewer: viewerInfo(v),
  });
}

/** GET daily-plans?date=&status=&targetType=&storeId=&employeeId=&search=&page=&pageSize=&sortBy=&sortOrder= */
export async function listPlans(ctx: Context, params: URLSearchParams) {
  const v = await enter(ctx);
  const { page: want, pageSize } = pagination(params);
  const sortBy = PLAN_SORTS.has(params.get("sortBy") || "") ? params.get("sortBy")! : "plan_date";
  const ascending = params.get("sortOrder") === "asc";
  const scope = planScopeFilter(v);
  if (scope === "") return respond({ success: true, data: [], meta: { page: 1, pageSize, total: 0, totalPages: 1 }, viewer: viewerInfo(v) });
  const apply = (q: any) => {
    q = withScope(q.is("deleted_at", null), scope);
    const date = params.get("date")?.trim();
    if (date) {
      if (!isDateString(date)) throw new WorkspaceError(400, "日期格式錯誤");
      q = q.eq("plan_date", date);
    }
    const status = params.get("status")?.trim();
    if (status) q = q.eq("status", status.toUpperCase());
    const targetType = params.get("targetType")?.trim();
    if (targetType) q = q.eq("target_type", targetType.toUpperCase());
    for (const [param, col] of [["storeId", "store_id"], ["employeeId", "employee_id"]] as const) {
      const val = params.get(param)?.trim();
      if (val) {
        if (!uuid(val)) throw new WorkspaceError(400, "id格式錯誤");
        q = q.eq(col, val);
      }
    }
    const keyword = cleanSearch(params.get("search"));
    if (keyword) q = q.or(orContainsAny(["title", "target_name_snapshot", "notes"], escapeLike(keyword)));
    return q;
  };
  const { count } = (await apply(ctx.admin.from(T.plans).select("id", { count: "exact", head: true }))) as { count: number | null };
  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(want, totalPages);
  const from = (page - 1) * pageSize;
  const rows = checked(await apply(ctx.admin.from(T.plans).select(PLAN_SELECT)).order(sortBy, { ascending }).order("updated_at", { ascending: false }).order("id", { ascending: true }).range(from, from + pageSize - 1)) as any[] | null;
  return respond({ success: true, data: (rows || []).map((p) => ({ ...p, can_edit: planManageable(p, v), can_delete: planManageable(p, v) })), meta: { page, pageSize, total, totalPages }, viewer: viewerInfo(v) });
}

async function loadPlan(ctx: Context, v: Viewer, id: string, select = PLAN_SELECT) {
  if (!uuid(id)) throw new WorkspaceError(400, "今日管理規劃 id格式錯誤");
  const row = checked(await ctx.admin.from(T.plans).select(select).eq("id", id).is("deleted_at", null).maybeSingle()) as any;
  if (!row || !planVisible(row, v)) throw new WorkspaceError(404, "找不到今日管理規劃");
  return row;
}
/** 關聯案件必須在登入者可見範圍內（舊版由資料庫觸發器檢查）。 */
async function assertLinkedCase(ctx: Context, v: Viewer, caseId: unknown) {
  if (!caseId) return;
  const c = checked(await ctx.admin.from(T.cases).select("id, owner_user_id, assigned_user_id, store_id, status, deleted_at").eq("id", caseId as string).maybeSingle()) as any;
  if (!c || !caseVisible(c, v)) throw new WorkspaceError(400, "關聯案件不存在、已刪除或無權限");
}

/** GET daily-plans/:id */
export async function getPlan(ctx: Context, id: string) {
  const v = await enter(ctx);
  const row = await loadPlan(ctx, v, id);
  return respond({ success: true, data: { ...row, can_edit: planManageable(row, v), can_delete: planManageable(row, v) } });
}

/** POST daily-plans：建立今日規劃（擁有人為登入者）。 */
export async function createPlan(ctx: Context, request: Request) {
  const v = await viewerOf(ctx);
  if (!canCreateCase(v.caps)) throw new WorkspaceError(403, "沒有建立今日管理規劃權限");
  const body = await readBody(request);
  const payload = validated(() => validateDailyPlanPayload({ ...body, plan_date: body.plan_date || today() }));
  await assertLinkedCase(ctx, v, payload.linked_case_id);
  const id = randomUUID();
  dbOk(await ctx.auth.from(T.plans).insert({ ...payload, owner_user_id: ctx.user.id, id }));
  return respond({ success: true, data: { id } }, 201);
}

/** PATCH daily-plans/:id：修改規劃或更新狀態（本人未完成的規劃、管理者全部）。 */
export async function updatePlan(ctx: Context, request: Request, id: string) {
  const v = await viewerOf(ctx);
  if (!canWritePlan(v.caps)) throw new WorkspaceError(403, "沒有編輯今日管理規劃權限");
  const row = await loadPlan(ctx, v, id);
  if (!planManageable(row, v)) throw new WorkspaceError(403, "沒有編輯這筆今日管理規劃的權限：只能編輯自己未完成的規劃，管理者可編輯全部");
  const body = await readBody(request);
  const payload: Record<string, unknown> = validated(() => validateDailyPlanPayload(body, { partial: true }));
  if (payload.linked_case_id && payload.linked_case_id !== row.linked_case_id) await assertLinkedCase(ctx, v, payload.linked_case_id);
  const updated = dbOk(await ctx.auth.from(T.plans).update(payload).eq("id", id).is("deleted_at", null).select("id")) as { id: string }[] | null;
  if (!updated?.length) throw new WorkspaceError(403, "沒有編輯這筆今日管理規劃的權限");
  return respond({ success: true, data: null });
}

/** DELETE daily-plans/:id（body.deletion_reason）：軟刪除（本人未完成的規劃、管理者全部；舊版只有管理者）。 */
export async function deletePlan(ctx: Context, request: Request, id: string) {
  const v = await viewerOf(ctx);
  if (!canEnter(v.caps)) throw new WorkspaceError(403, "沒有督導管理日誌查看權限");
  const row = await loadPlan(ctx, v, id);
  if (!planManageable(row, v)) throw new WorkspaceError(403, "沒有刪除這筆今日管理規劃的權限：只能刪除自己未完成的規劃，管理者可刪除全部");
  const reason = await deletionReason(request);
  const data = dbOk(await ctx.auth.rpc("supervisor_management_soft_delete_daily_plan", { p_plan_id: id, p_reason: reason }));
  return respond({ success: true, data });
}

/* ───────────── 選項與分類 ───────────── */

const CATEGORY_COLUMNS = "id, code, name, description";
/** GET categories：啟用中的分類。 */
export async function listCategories(ctx: Context) {
  await enter(ctx);
  const rows = checked(await ctx.admin.from(T.categories).select("id, code, name, description, sort_order, is_active").is("deleted_at", null).eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }));
  return respond({ success: true, data: rows || [] });
}

/**
 * GET options?store_id=&q=：分類、門市，以及員工候選。
 * 舊版回傳前 300 筆員工（沒有依門市，超過就被截斷）；新版只在指定 store_id 或搜尋字串 q 時回傳員工（最多 100／30 筆）。
 */
export async function getOptions(ctx: Context, params: URLSearchParams) {
  const v = await enter(ctx);
  const storeId = params.get("store_id")?.trim() || "";
  const q = cleanSearch(params.get("q"));
  if (storeId && !uuid(storeId)) throw new WorkspaceError(400, "門市 id格式錯誤");
  const empSelect = "id, store_id, employee_code, employee_name, current_position, position, employment_status, is_active";
  let empQuery: any = null;
  if (storeId) empQuery = ctx.admin.from("store_employees").select(empSelect).eq("is_active", true).eq("store_id", storeId).order("employee_code", { ascending: true }).limit(100);
  else if (q) {
    const quoted = '"%' + escapeLike(q).replace(/[\\"]/g, (c) => "\\" + c) + '%"';
    empQuery = ctx.admin.from("store_employees").select(empSelect).eq("is_active", true).or(`employee_name.ilike.${quoted},employee_code.ilike.${quoted}`).order("employee_code", { ascending: true }).limit(30);
  }
  // 門市候選：管理者全部；其他人只有自己管轄的門市（舊版靠資料表政策，DEV 與此相同；allowlist m6-w32-options-stores-scope）
  let storeQuery: any = ctx.admin.from("stores").select("id, store_code, store_name, short_name").eq("is_active", true).order("store_code", { ascending: true }).limit(1000);
  if (!v.caps.manage) {
    const mine = (checked(await ctx.admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id)) as { store_id: string }[] | null) || [];
    const mineIds = Array.from(new Set(mine.map((r) => r.store_id).filter(Boolean)));
    storeQuery = mineIds.length ? storeQuery.in("id", mineIds) : null;
  }
  const [categories, stores, employees] = await Promise.all([
    ctx.admin.from(T.categories).select(CATEGORY_COLUMNS).is("deleted_at", null).eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    storeQuery,
    empQuery,
  ]);
  return respond({ success: true, data: { categories: checked(categories) || [], stores: (stores ? checked(stores) : []) || [], employees: (employees ? checked(employees) : []) || [] } });
}
