// G14 回報建立、G15 我的追蹤、G16 需求單工作台 API（/api/workspace/general-affairs/reports/**、requests/**、request-targets）。
// 讀取：用使用者自己的登入身分查需求單（RLS 決定看得到哪些單：需求單查看全部／管理，或查看自己門市）；留言、事件、採購單等補充資料在確認可見後用服務身分取。
// 寫入：全部走資料庫函式（ga_ws_req_*）——鎖列、以目前狀態為條件、版本檢查（expected_updated_at，衝突回 409 STALE）、合法流轉、同交易寫事件與同步工單／處理單。
// 權限（資料庫語意，無管理員後備）：建立＝需求單建立（替別的門市建立另需管理／門市管理／員工管理）；受理、駁回、取消等＝需求單管理；門市動作＝自己門市名單＋留言／確認權限，或需求單管理（總務代按須說明並標記）。
// Q16：內部備註、內部事件與內部留言不傳給門市；沒有採購評估權限者看不到採購單金額與供應商；留言可改刪但標示並保留原文給總務。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { validateServiceRequestPayload } from "../../general-affairs/service-requests/validation";
import { validatePurchaseReviewPayload } from "../../general-affairs/purchase-reviews/validation";
import { dbCan } from "./access";
import {
  DEFAULT_OVERDUE_CONFIRM_DAYS, REQUEST_SORT, REQUEST_STATUSES, isConfirmOverdue, maskComments, maskEvents, maskRequest, overdueCutoff, requestAbilities, validateOverdueDays,
  type DocSummary,
} from "./request-rules";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";
import { fetchVendorOptions } from "./vendors";

export const RQ = {
  create: "general_affairs.request.create",
  manage: "general_affairs.request.manage",
  viewAll: "general_affairs.request.view_all",
  viewOwn: "general_affairs.request.view_own_store",
  commentOwn: "general_affairs.request.comment_own_store",
  confirmOwn: "general_affairs.request.confirm_own_store",
} as const;
export const PR = { view: "general_affairs.purchase_review.view", manage: "general_affairs.purchase_review.manage", txn: "general_affairs.inventory_transaction.manage", approve: "general_affairs.purchase_order.approve" } as const;

const BASE_COLUMNS = "id,request_no,store_id,created_by,request_type,title,description,resource_type,equipment_id,facility_id,part_id,desired_quantity,desired_unit,desired_spec,impact_description,temporary_workaround,contact_name,contact_phone,main_status,intake_route,assignee_role,assignee_name,maintenance_request_id,public_progress,rejection_reason,rejection_note,supplement_type,supplement_note,completed_at,created_at,updated_at,created_by_name";
const INTERNAL_COLUMNS = ",internal_note,assignee_user_id,cancel_reason,reopened_count,waiting_confirm_since";
const REL = ",store:stores(id,store_code,store_name,short_name),equipment:ga_equipment(id,name,asset_code,area,location_detail),facility:ga_facilities(id,name,facility_code,area,location_detail),part:ga_parts(id,name,part_code,base_unit)";
const NIL = "00000000-0000-0000-0000-000000000000";

export async function managerStoreIds(ctx: Context): Promise<string[]> {
  const rows = ((await must((adminClient() as any).from("store_managers").select("store_id").eq("user_id", ctx.user.id))) as any[]) || [];
  return Array.from(new Set(rows.map((r) => r.store_id as string)));
}

export async function requestScope(ctx: Context) {
  const p = ctx.permissions;
  const manage = dbCan(p, RQ.manage);
  const viewAll = manage || dbCan(p, RQ.viewAll);
  const viewOwn = dbCan(p, RQ.viewOwn);
  const stores = await managerStoreIds(ctx);
  return {
    manage, viewAll, viewOwn, stores, read: viewAll || viewOwn,
    create: dbCan(p, RQ.create), createAny: dbCan(p, RQ.manage, "store.manage", "employee.manage"),
    commentOwn: dbCan(p, RQ.commentOwn), confirmOwn: dbCan(p, RQ.confirmOwn),
    purchaseManage: dbCan(p, PR.manage), purchaseView: dbCan(p, PR.view, PR.manage, PR.approve),
    stockIssue: dbCan(p, PR.txn) && dbCan(p, "general_affairs.part.view", "general_affairs.part.manage") && dbCan(p, "general_affairs.part_fulfillment.manage"),
  };
}
type Scope = Awaited<ReturnType<typeof requestScope>>;
const requireRead = (s: Scope) => { if (!s.read) throw new GaError(403, "沒有總務需求單查看權限"); };
const expectedOf = (b: Record<string, any>) => {
  const v = String(b.expected_updated_at ?? "").trim();
  if (!v) throw new GaError(400, "缺少版本資訊（expected_updated_at），請重新載入畫面");
  return v;
};

// ---------------------------------------------------------------- 路由
export async function reportsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [a] = rest;
  if (!a && request.method === "POST") return create(ctx, request);
  if (a === "mine" && request.method === "GET") return list(ctx, new URL(request.url), true);
  throw new GaError(404, "找不到這個功能");
}

export async function requestsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b, c, d] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url), false);
    if (m === "POST") return create(ctx, request);
  }
  if (a === "settings" && !b) {
    if (m === "GET") return getSettings(ctx);
    if (m === "PATCH") return patchSettings(ctx, request);
  }
  if (a && a !== "settings") {
    if (!isUuid(a)) throw new GaError(400, "需求單 id 格式錯誤");
    if (!b) {
      if (m === "GET") return detail(ctx, a, new URL(request.url));
      if (m === "PATCH") return act(ctx, request, a);
    }
    if (b === "comments") {
      if (!c && m === "POST") return commentAdd(ctx, request, a);
      if (c && isUuid(c)) {
        if (!d && m === "PATCH") return commentEdit(ctx, request, a, c);
        if (!d && m === "DELETE") return commentDelete(ctx, a, c);
        if (d === "read" && m === "POST") return commentRead(ctx, a, c);
      }
    }
    if (b === "store-actions" && m === "POST") return storeAction(ctx, request, a);
    if (b === "stock-issue" && m === "POST") return stockIssue(ctx, request, a);
    if (b === "purchase-review") {
      if (m === "GET") return reviewGet(ctx, a);
      if (m === "POST") return reviewSave(ctx, request, a);
    }
  }
  throw new GaError(404, "找不到這個功能");
}

// ---------------------------------------------------------------- 設定（D5 逾期天數）
async function readSettings() {
  const row = (await must((adminClient() as any).from("ga_workflow_settings").select("value_num,updated_at").eq("key", "request_overdue_confirm_days").maybeSingle())) as any;
  return { overdue_days: Number(row?.value_num) || DEFAULT_OVERDUE_CONFIRM_DAYS, updated_at: (row?.updated_at as string) || null };
}
async function getSettings(ctx: Context) {
  requireRead(await requestScope(ctx));
  return respond({ data: await readSettings() });
}
async function patchSettings(ctx: Context, request: NextRequest) {
  const s = await requestScope(ctx);
  requireRead(s);
  if (!s.manage) throw new GaError(403, "沒有總務需求單管理權限，不能修改逾期天數");
  const b = await body(request);
  const days = validated(() => validateOverdueDays(b.overdue_days));
  const r = await rpc(ctx, "ga_ws_req_settings_set", { p_days: days, p_expected_updated_at: expectedOf(b) });
  return respond({ data: r.data });
}

// ---------------------------------------------------------------- 建立（G14）
async function create(ctx: Context, request: NextRequest) {
  const s = await requestScope(ctx);
  if (!s.create) throw new GaError(403, "沒有建立總務需求單權限");
  const b = await body(request);
  const payload = validated(() => validateServiceRequestPayload(b));
  if (!s.createAny && !s.stores.includes(payload.store_id)) throw new GaError(403, "只能替自己管理的門市建立需求單");
  const key = String(b.idempotency_key ?? "").trim().slice(0, 80) || null;
  const { main_status: _m, public_progress: _p, ...fields } = payload as any;
  const r = await rpc(ctx, "ga_ws_req_create", { p_payload: fields, p_key: key });
  return respond({ data: r.data, replay: !!(r as any).replay }, r.status === 201 ? 201 : 200);
}

// 建立需求單時的標的選擇（設備與設施，依門市）。
export async function requestTargets(ctx: Context, url: URL) {
  const s = await requestScope(ctx);
  if (!s.create) throw new GaError(403, "沒有建立總務需求單權限");
  const storeId = (url.searchParams.get("storeId") || "").trim();
  if (!isUuid(storeId)) throw new GaError(400, "請選擇門市");
  if (!s.createAny && !s.stores.includes(storeId)) throw new GaError(403, "只能查詢自己可建立需求的門市標的");
  const search = (url.searchParams.get("search") || "").trim();
  const admin: any = adminClient();
  let eq = admin.from("ga_equipment").select("id,name,asset_code,barcode,brand,model,area,location_detail").eq("store_id", storeId).is("deleted_at", null);
  let fq = admin.from("ga_facilities").select("id,name,facility_code,area,location_detail").eq("store_id", storeId).is("deleted_at", null);
  if (search) {
    eq = eq.or(orIlike(["name", "asset_code", "brand", "model", "barcode"], search));
    fq = fq.or(orIlike(["name", "facility_code", "area"], search));
  }
  const [e, f] = await Promise.all([eq.order("name").limit(100), fq.order("name").limit(100)]);
  if (e.error) throw dbError(e.error);
  if (f.error) throw dbError(f.error);
  return respond({ equipment: e.data || [], facilities: f.data || [] });
}

// ---------------------------------------------------------------- 列表
type ReplyState = { last_store_comment_at: string | null; last_ga_response_at: string | null; last_store_read_at: string | null; last_store_read_by_name: string | null; unread_store_comment_count: number };
async function replyState(rows: any[]) {
  if (!rows.length) return new Map<string, ReplyState>();
  const admin: any = adminClient();
  const ids = rows.map((r) => r.id);
  const [comments, events] = await Promise.all([
    must(admin.from("ga_service_request_comments").select("id,request_id,created_by,created_at").in("request_id", ids).eq("visibility", "PUBLIC").is("deleted_at", null)),
    must(admin.from("ga_service_request_events").select("request_id,event_type,visibility,metadata,created_at,created_by,created_by_name").in("request_id", ids).in("event_type", ["PUBLIC_COMMENT_ADDED", "STORE_COMMENT_READ", "REQUEST_ACCEPTED", "REQUEST_PROGRESS_UPDATED", "SUPPLEMENT_REQUESTED"])),
  ]);
  const byReq = new Map(rows.map((r) => [r.id, r]));
  const source = new Map<string, string>();
  const read = new Set<string>();
  const gaAt = new Map<string, string>();
  const readAt = new Map<string, { at: string; by: string }>();
  for (const e of (events as any[]) || []) {
    const cid = e.metadata?.comment_id;
    if (e.event_type === "STORE_COMMENT_READ" && cid) { read.add(cid); if (!readAt.get(e.request_id) || e.created_at > readAt.get(e.request_id)!.at) readAt.set(e.request_id, { at: e.created_at, by: e.created_by_name || "" }); }
    else if (e.event_type === "PUBLIC_COMMENT_ADDED" && cid && e.metadata?.source_context) source.set(cid, e.metadata.source_context);
    else if (e.visibility === "PUBLIC" && (!gaAt.get(e.request_id) || e.created_at > gaAt.get(e.request_id)!)) gaAt.set(e.request_id, e.created_at);
  }
  const out = new Map<string, ReplyState>();
  for (const r of rows) out.set(r.id, { last_store_comment_at: null, last_ga_response_at: gaAt.get(r.id) || null, last_store_read_at: readAt.get(r.id)?.at || null, last_store_read_by_name: readAt.get(r.id)?.by || null, unread_store_comment_count: 0 });
  for (const c of (comments as any[]) || []) {
    const req = byReq.get(c.request_id);
    const st = out.get(c.request_id);
    if (!req || !st) continue;
    const isStore = source.get(c.id) === "STORE_TRACKING" || (!source.has(c.id) && c.created_by === req.created_by);
    if (!isStore) { if (!st.last_ga_response_at || c.created_at > st.last_ga_response_at) st.last_ga_response_at = c.created_at; continue; }
    if (!st.last_store_comment_at || c.created_at > st.last_store_comment_at) st.last_store_comment_at = c.created_at;
    if (!read.has(c.id)) st.unread_store_comment_count += 1;
  }
  return out;
}

async function list(ctx: Context, url: URL, mine: boolean) {
  const s = await requestScope(ctx);
  requireRead(s);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const status = (p.get("status") || "").trim().toUpperCase();
  if (status && !(REQUEST_STATUSES as readonly string[]).includes(status)) throw new GaError(400, "狀態篩選錯誤");
  const type = (p.get("type") || "").trim().toUpperCase();
  if (type && !["REPAIR", "PURCHASE_SUPPLEMENT", "ASSIGNED_RESPONSE"].includes(type)) throw new GaError(400, "類型篩選錯誤");
  const storeId = (p.get("storeId") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市格式錯誤");
  if (storeId && !s.viewAll && !s.stores.includes(storeId)) throw new GaError(403, "沒有此門市的查看權限");
  const search = (p.get("search") || "").trim();
  // 逾期篩選與逾期統計只給總務：門市不可用它反推哪些單逾期（D5：門市看不到逾期標示）。
  const overdueOnly = s.manage && FILTERS_BOOL(p.get("overdue")) === true;
  const settings = await readSettings();
  const cutoff = overdueCutoff(settings.overdue_days);
  const sort = REQUEST_SORT.has(p.get("sort") || "") ? (p.get("sort") as string) : "created_at";
  const asc = p.get("sortOrder") === "asc";
  // 我的追蹤（mine）只看自己管理的門市；需求單工作台依權限看全部。
  const scopeStores = mine ? (s.stores.length ? s.stores : [NIL]) : null;
  const base = (q: any) => {
    let x = q.is("deleted_at", null);
    if (scopeStores) x = x.in("store_id", scopeStores);
    if (storeId) x = x.eq("store_id", storeId);
    if (type) x = x.eq("request_type", type);
    if (search) x = x.or(orIlike(["request_no", "title", "description"], search));
    return x;
  };
  const cols = BASE_COLUMNS + (s.manage ? INTERNAL_COLUMNS : "") + REL;
  let q = base((ctx.auth as any).from("ga_service_requests").select(cols, { count: "exact" }));
  if (status) q = q.eq("main_status", status);
  if (overdueOnly) q = q.eq("main_status", "WAITING_STORE_CONFIRMATION").lt("waiting_confirm_since", cutoff);
  const countOf = (extra: (q: any) => any) => extra(base((ctx.auth as any).from("ga_service_requests").select("id", { count: "exact", head: true }))).then((r: any) => { if (r.error) throw dbError(r.error); return r.count || 0; });
  const [res, ...counts] = await Promise.all([
    q.order(sort, { ascending: asc }).order("id").range(from, to),
    countOf((x) => x),
    ...REQUEST_STATUSES.map((st) => countOf((x) => x.eq("main_status", st))),
    countOf((x) => x.eq("main_status", "WAITING_STORE_CONFIRMATION").lt("waiting_confirm_since", cutoff)),
  ]);
  if ((res as any).error) throw dbError((res as any).error);
  const rows = (((res as any).data as any[]) || []);
  const reply = s.manage ? await replyState(rows) : new Map();
  const now = new Date();
  const stats: Record<string, number> = { all: counts[0] as number };
  REQUEST_STATUSES.forEach((st, i) => { stats[st] = counts[i + 1] as number; });
  if (s.manage) stats.overdue = counts[REQUEST_STATUSES.length + 1] as number;
  const data = rows.map((r) => {
    const open: any = maskRequest(r, s.manage);
    return {
      ...open,
      is_overdue_confirm: isConfirmOverdue(r, settings.overdue_days, now),
      ...(s.manage ? { ...(reply.get(r.id) || {}), store_reply_pending: (reply.get(r.id)?.unread_store_comment_count || 0) > 0 } : {}),
    };
  });
  return respond({
    data, total: (res as any).count || 0, meta: pagingMeta(page, pageSize, (res as any).count || 0), stats, settings,
    permissions: { manage: s.manage, create: s.create, purchaseManage: s.purchaseManage, purchaseView: s.purchaseView, stockIssue: s.stockIssue, commentOwn: s.commentOwn, confirmOwn: s.confirmOwn, stores: s.stores },
  });
}

// ---------------------------------------------------------------- 詳情
async function readRequest(ctx: Context, id: string, s: Scope) {
  const row = (await must((ctx.auth as any).from("ga_service_requests").select(BASE_COLUMNS + (s.manage ? INTERNAL_COLUMNS : "") + REL).eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到需求單");
  return row;
}
async function docSummary(id: string): Promise<DocSummary> {
  const { data, error } = await (adminClient() as any).rpc("ga_rq_docs", { p_request_id: id });
  if (error) throw dbError(error);
  return { po_count: Number(data?.po_count) || 0, po_received: Number(data?.po_received) || 0, issued: Number(data?.issued) || 0, transfer_active: Number(data?.transfer_active) || 0, work_order_open: !!data?.work_order_open };
}
async function linkedOrders(id: string, canSeeMoney: boolean) {
  const admin: any = adminClient();
  const res = await admin.from("ga_purchase_orders").select("id,po_no,status,expected_delivery_date,total_amount,vendor_id,vendor_name_snapshot,source_request_id,updated_at,items:ga_purchase_order_items(request_id,quantity,unit,received_qty,item_name)").or(`source_request_id.eq.${id}`);
  const byItems = await admin.from("ga_purchase_order_items").select("po_id").eq("request_id", id);
  if (res.error) throw dbError(res.error);
  const extra = Array.from(new Set(((byItems.data as any[]) || []).map((r) => r.po_id).filter((x: string) => !((res.data as any[]) || []).some((o) => o.id === x))));
  let rows = ((res.data as any[]) || []);
  if (extra.length) {
    const more = await admin.from("ga_purchase_orders").select("id,po_no,status,expected_delivery_date,total_amount,vendor_id,vendor_name_snapshot,source_request_id,updated_at,items:ga_purchase_order_items(request_id,quantity,unit,received_qty,item_name)").in("id", extra);
    if (more.error) throw dbError(more.error);
    rows = rows.concat((more.data as any[]) || []);
  }
  const vendorIds = Array.from(new Set(rows.map((r) => r.vendor_id).filter(Boolean)));
  const vendors = new Map<string, string>();
  if (canSeeMoney && vendorIds.length) {
    const v = await admin.from("ga_vendors").select("id,name").in("id", vendorIds);
    for (const x of (v.data as any[]) || []) vendors.set(x.id, x.name);
  }
  return rows.sort((a, b) => String(a.po_no).localeCompare(String(b.po_no))).map((o) => {
    const mine = ((o.items as any[]) || []).filter((i) => i.request_id === id || o.source_request_id === id);
    const ordered = mine.reduce((n, i) => n + Number(i.quantity || 0), 0);
    const received = mine.reduce((n, i) => n + Number(i.received_qty || 0), 0);
    const base: any = { id: o.id, po_no: o.po_no, status: o.status, expected_delivery_date: o.expected_delivery_date, ordered_qty: ordered, received_qty: received, updated_at: o.updated_at };
    if (canSeeMoney) { base.total_amount = o.total_amount; base.vendor_name = o.vendor_name_snapshot || vendors.get(o.vendor_id) || null; }
    return base;
  });
}

async function detail(ctx: Context, id: string, url: URL) {
  const s = await requestScope(ctx);
  requireRead(s);
  const row = await readRequest(ctx, id, s);
  const internal = s.manage;
  const admin: any = adminClient();
  const surface = url.searchParams.get("surface");
  const [events, comments, docs, ful] = await Promise.all([
    must(admin.from("ga_service_request_events").select("id,event_type,old_status,new_status,visibility,title,description,metadata,created_by_name,created_at,proxy_for_store").eq("request_id", id).order("created_at")),
    must(admin.from("ga_service_request_comments").select("id,visibility,body,original_body,created_by,created_by_name,edited_at,deleted_at,created_at,updated_at").eq("request_id", id).order("created_at")),
    docSummary(id),
    must(admin.from("ga_part_fulfillments").select("id,fulfillment_no,status,requested_quantity,fulfilled_quantity,unit,current_step,ready_to_deliver_at,updated_at").eq("request_id", id).is("deleted_at", null).maybeSingle()),
  ]);
  const evs = (events as any[]) || [];
  const sourceOf = new Map<string, string>();
  const readOf = new Map<string, { read_by_name: string | null; read_at: string | null }>();
  for (const e of evs) {
    const cid = e.metadata?.comment_id;
    if (e.event_type === "STORE_COMMENT_READ" && cid) readOf.set(cid, { read_by_name: e.created_by_name || null, read_at: e.created_at || null });
    else if (e.event_type === "PUBLIC_COMMENT_ADDED" && cid && e.metadata?.source_context) sourceOf.set(cid, e.metadata.source_context);
  }
  const commentTypes = new Set(["PUBLIC_COMMENT_ADDED", "PUBLIC_COMMENT_EDITED", "PUBLIC_COMMENT_DELETED", "INTERNAL_COMMENT_ADDED", "INTERNAL_COMMENT_EDITED", "INTERNAL_COMMENT_DELETED", "STORE_COMMENT_READ"]);
  const timeline = maskEvents(evs.filter((e) => !commentTypes.has(e.event_type)), internal).map((e: any) => internal ? e : { id: e.id, event_type: e.event_type, title: e.title, description: e.description, created_by_name: e.created_by_name, created_at: e.created_at, proxy_for_store: e.proxy_for_store });
  const isOwn = s.stores.includes(row.store_id);
  const shaped = maskComments(((comments as any[]) || []), internal).map((c: any) => {
    const src = sourceOf.get(c.id) || (c.created_by === row.created_by ? "STORE_TRACKING" : "UNKNOWN");
    const mineStore = c.created_by === ctx.user.id && c.visibility === "PUBLIC" && s.commentOwn && isOwn;
    const canMutate = !c.is_deleted && (src === "STORE_TRACKING" ? mineStore && surface !== "GA_WORKBENCH" : (s.manage || mineStore));
    const { created_by: _cb, ...open } = c;
    return { ...open, source_context: src, mine: c.created_by === ctx.user.id, can_edit: canMutate, can_delete: canMutate, ...(readOf.get(c.id) || { read_by_name: null, read_at: null }) };
  });
  const who = { manage: s.manage, ownStore: isOwn, creator: row.created_by === ctx.user.id, commentOwnStore: s.commentOwn, confirmOwnStore: s.confirmOwn, purchaseManage: s.purchaseManage, stockIssue: s.stockIssue };
  const settings = await readSettings();
  const orders = internal && s.purchaseView ? await linkedOrders(id, true) : internal && ful ? await linkedOrders(id, false) : [];
  const open: any = maskRequest(row, internal);
  return respond({
    data: { ...open, is_overdue_confirm: isConfirmOverdue(row, settings.overdue_days) },
    events: timeline, comments: shaped, abilities: requestAbilities(who, row, docs),
    documents: internal ? docs : undefined, fulfillment: internal ? ful : null, purchase_orders: orders,
  });
}

// ---------------------------------------------------------------- 動作
async function act(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const action = String(b.action ?? "").trim();
  const expected = expectedOf(b);
  if (action === "accept") {
    const r = await rpc(ctx, "ga_ws_req_accept", {
      p_id: id, p_expected_updated_at: expected, p_route: b.intake_route ?? null, p_role: b.assignee_role ?? null,
      p_assignee_user: isUuid(b.assignee_user_id) ? b.assignee_user_id : null, p_assignee_name: b.assignee_name ?? null, p_internal_note: b.internal_note ?? null,
    });
    return respond({ data: r.data });
  }
  if (["reject", "request_supplement", "update_progress", "request_store_confirmation", "assign", "cancel", "reopen", "withdraw"].includes(action)) {
    const { action: _a, expected_updated_at: _e, ...payload } = b;
    const r = await rpc(ctx, "ga_ws_req_transition", { p_id: id, p_action: action, p_expected_updated_at: expected, p_payload: payload });
    return respond({ data: r.data });
  }
  throw new GaError(400, "需求單處理動作錯誤");
}

async function storeAction(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const action = String(b.action ?? "").trim();
  if (!["submit_supplement", "confirm_complete", "report_problem"].includes(action)) throw new GaError(400, "門市回覆動作錯誤");
  const expected = String(b.expected_updated_at ?? "").trim() || null;
  const r = await rpc(ctx, "ga_ws_req_store_action", { p_id: id, p_action: action, p_note: b.note ?? null, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

async function commentAdd(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_req_comment", { p_id: id, p_op: "add", p_comment_id: null, p_body: b.body ?? null, p_visibility: b.visibility ?? "PUBLIC", p_source: b.source_context ?? "GA_WORKBENCH" });
  return respond({ data: r.data }, 201);
}
async function commentEdit(ctx: Context, request: NextRequest, id: string, cid: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_req_comment", { p_id: id, p_op: "edit", p_comment_id: cid, p_body: b.body ?? null });
  return respond({ data: r.data });
}
async function commentDelete(ctx: Context, id: string, cid: string) {
  const r = await rpc(ctx, "ga_ws_req_comment", { p_id: id, p_op: "delete", p_comment_id: cid });
  return respond({ data: r.data });
}
async function commentRead(ctx: Context, id: string, cid: string) {
  const r = await rpc(ctx, "ga_ws_req_comment", { p_id: id, p_op: "read", p_comment_id: cid });
  return respond({ data: r.data, already_read: !!(r as any).already_read });
}

async function stockIssue(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new GaError(400, "數量必須大於 0");
  if (!isUuid(b.location_id) || !isUuid(b.part_id)) throw new GaError(400, "請選擇出庫位置與料件");
  const key = String(b.idempotency_key ?? "").trim();
  if (!key) throw new GaError(400, "缺少防重複識別碼，請重新整理畫面後再送出");
  const r = await rpc(ctx, "ga_ws_req_stock_issue", {
    p_id: id, p_location_id: b.location_id, p_part_id: b.part_id, p_quantity: qty, p_input_unit_type: b.input_unit_type ?? "BASE",
    p_reason: b.reason ?? null, p_notes: b.notes ?? null, p_substitute_reason: b.substitute_reason ?? null, p_key: key,
  });
  return respond({ data: r.data }, r.status === 201 ? 201 : 200);
}

// ---------------------------------------------------------------- 採購評估
const vendorStub = (v: any) => ({ id: v.id, name: v.name, alias: v.alias, status: v.status, contact_name: v.contact_name ?? null, contact_phone: v.contact_phone ?? null });
async function reviewGet(ctx: Context, id: string) {
  const s = await requestScope(ctx);
  if (!s.purchaseView) throw new GaError(403, "沒有採購評估查看權限");
  const [review, vendors, locations, orders] = await Promise.all([
    must((ctx.auth as any).from("ga_purchase_reviews").select("*,receiving_location:ga_inventory_locations(id,code,name,location_type),quotes:ga_purchase_review_quotes(id,vendor_id,vendor_name,quote_amount,negotiated_amount,lead_time_days,is_selected,notes,superseded_at,created_at,deleted_at)").eq("request_id", id).is("deleted_at", null).maybeSingle()),
    // 第 6 批：ga_vendors 的 RLS 收緊為廠商檢視／管理，下拉改走伺服端函式（不含統編與帳務機密欄位）。
    fetchVendorOptions(ctx).then((rows) => rows.map(vendorStub)),
    dbCan(ctx.permissions, "general_affairs.inventory_balance.view", "general_affairs.inventory_transaction.manage", "general_affairs.inventory_location.view", "general_affairs.inventory_location.manage")
      ? must((ctx.auth as any).from("ga_inventory_locations").select("id,code,name,location_type").eq("is_active", true).is("deleted_at", null).order("name").limit(200))
      : Promise.resolve([]),
    linkedOrders(id, true),
  ]);
  // 評估單上目前選的廠商（可能已暫停或停用，不在合作中清單裡）：改由伺服端函式帶 id 取回，原本的 ga_vendors 內嵌查詢在 RLS 收緊後會是空的。
  const rv = review as any;
  let reviewOut: any = rv;
  if (rv?.vendor_id) {
    const hit = (vendors || []).find((v: any) => v.id === rv.vendor_id) ?? (await fetchVendorOptions(ctx, { includeIds: [rv.vendor_id] })).map(vendorStub).find((v: any) => v.id === rv.vendor_id) ?? null;
    reviewOut = { ...rv, vendor: hit ? { id: hit.id, name: hit.name, alias: hit.alias, status: hit.status } : null };
  }
  return respond({ data: { review: reviewOut, vendors: vendors || [], inventoryLocations: locations || [], purchase_orders: orders } });
}
async function reviewSave(ctx: Context, request: NextRequest, id: string) {
  const s = await requestScope(ctx);
  if (!s.purchaseManage) throw new GaError(403, "沒有採購評估管理權限");
  const b = await body(request);
  const p = validated(() => validatePurchaseReviewPayload(b));
  const payload = {
    decision: p.decision, vendor_id: p.vendorId, vendor_name: p.vendorName, approved_quantity: p.approvedQuantity, approved_unit: p.approvedUnit, estimated_amount: p.estimatedAmount,
    quoted_amount: p.quotedAmount, negotiated_amount: p.negotiatedAmount, final_amount: p.finalAmount, expected_delivery_date: p.expectedDeliveryDate, delivery_method: p.deliveryMethod,
    receiving_location_id: p.receivingLocationId, substitute_description: p.substituteDescription, decision_note: p.decisionNote, public_note: p.publicNote,
    quote_lead_time_days: p.quoteLeadTimeDays, quote_notes: p.quoteNotes,
  };
  const r = await rpc(ctx, "ga_ws_req_purchase_review", { p_id: id, p_payload: payload, p_expected_updated_at: expectedOf(b) });
  return respond({ data: r.data }, 201);
}
