// G13 總務庫存調撥 API（/api/workspace/general-affairs/inventory/transfers/**）。
// 讀取：用使用者自己的登入身分查調撥單（RLS 決定看得到哪些單：有調撥／流水權限，或來源／目的位置在自己的門市名單內）；位置、料件名稱補欄位用服務身分只取公開欄位。
// 寫入：全部走資料庫函式（ga_ws_inv_transfer_create／action／store_report／set_overdue_days）——
//      鎖列、以目前狀態為條件、版本檢查（expected_updated_at，衝突回 409 STALE）、固定識別防重複扣帳、過帳與同步處理單同一個交易，任何一步失敗整張回復。
// 權限（資料庫語意，無管理員後備）：建單、交出、運送中、收貨、取消、未收註記＝調撥管理＋庫存交易管理＋料件查看（缺哪個講清楚）；店長回報＝目的門市名單上的店長（role_type=store_manager）；逾期天數＝調撥管理。
// C12：唯讀名單身分（店長、督導、區經理）看不到內部備註與未收註記；共通：非 GET 的 Origin 檢查在 runGa；分頁上限 100。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { INV, rosterStoreIds, storeNames } from "./inventory-locations";
import { creatorNames, LOCATION_PUBLIC, lookup, PART_PUBLIC } from "./inventory-stock";
import {
  AWAITING_RECEIPT, DEFAULT_OVERDUE_DAYS, EVENT_PAGE_MAX, isOverdue, maskEvent, maskTransfer, overdueCutoff, overdueDaysCount, parsePrefill,
  resolvePrefillUnit, toRequestUnit, transferAbilities, transferSearchable, TRANSFER_STATUSES, validateActionPayload, validateCreatePayload, validateOverdueDays,
  type Who,
} from "./inventory-transfer-rules";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

const TRANSFER_COLUMNS = "id,transfer_no,source_location_id,destination_location_id,status,reason,notes,shipping_method,source_confirmed_at,source_confirmed_by,shipped_at,received_at,received_by,canceled_at,canceled_by,cancel_reason,exception_type,unreceived_note,unreceived_marked_at,store_report_type,store_report_note,store_reported_at,created_at,created_by,updated_at";
const ITEM_COLUMNS = "id,transfer_id,part_id,quantity_input,input_unit_type,notes,source_transaction_id,receipt_transaction_id,return_transaction_id";
const SELECT = `${TRANSFER_COLUMNS},items:ga_inventory_transfer_items(${ITEM_COLUMNS})`;
const NIL = "00000000-0000-0000-0000-000000000000";

/** 登入者在哪些門市是「店長」（role_type=store_manager；督導與區經理不算，C10）。 */
async function managerStoreIds(ctx: Context): Promise<string[]> {
  const rows = ((await must((adminClient() as any).from("store_managers").select("store_id").eq("user_id", ctx.user.id).eq("role_type", "store_manager"))) as any[]) || [];
  return Array.from(new Set(rows.map((r) => r.store_id as string)));
}

export async function transferScope(ctx: Context) {
  const transferManage = dbCan(ctx.permissions, INV.transferManage);
  const transactionManage = dbCan(ctx.permissions, INV.transactionManage);
  const partView = dbCan(ctx.permissions, GA.partView, GA.partManage);
  const internal = dbCan(ctx.permissions, INV.transferView, INV.transferManage, INV.transactionView, INV.transactionManage);
  const legacyRead = internal || dbCan(ctx.permissions, INV.balanceView);
  const roster = legacyRead ? false : (await rosterStoreIds(ctx)).length > 0;
  const managers = await managerStoreIds(ctx);
  return { transferManage, transactionManage, partView, internal, read: legacyRead || roster, roster, managers, canOperate: transferManage && transactionManage && partView };
}
type Scope = Awaited<ReturnType<typeof transferScope>>;
function requireRead(s: Scope) {
  if (!s.read) throw new GaError(403, "沒有調撥單查看權限");
}
const whoFor = (s: Scope, destStoreManager: boolean): Who => ({ transferManage: s.transferManage, transactionManage: s.transactionManage, partView: s.partView, destinationStoreManager: destStoreManager });

export async function transfersApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return create(ctx, request);
  }
  if (a === "settings" && !b) {
    if (m === "GET") return getSettings(ctx);
    if (m === "PATCH") return patchSettings(ctx, request);
  }
  if (a === "prefill" && !b && m === "GET") return prefill(ctx, new URL(request.url));
  if (a === "options" && !b && m === "GET") return options(ctx, new URL(request.url));
  if (a && a !== "settings" && a !== "prefill" && a !== "options") {
    if (!isUuid(a)) throw new GaError(400, "調撥單 id 格式錯誤");
    if (!b && m === "GET") return detail(ctx, a);
    if (b === "actions" && m === "POST") return act(ctx, request, a);
  }
  throw new GaError(404, "找不到這個功能");
}

// ---------------------------------------------------------------- 設定（C11）
async function readSettings() {
  const row = (await must((adminClient() as any).from("ga_inventory_transfer_settings").select("overdue_days,updated_at").eq("id", true).maybeSingle())) as any;
  return { overdue_days: Number(row?.overdue_days) || DEFAULT_OVERDUE_DAYS, updated_at: (row?.updated_at as string) || null };
}
async function getSettings(ctx: Context) {
  requireRead(await transferScope(ctx));
  return respond({ data: await readSettings() });
}
async function patchSettings(ctx: Context, request: NextRequest) {
  const s = await transferScope(ctx);
  requireRead(s);
  if (!s.transferManage) throw new GaError(403, "沒有調撥管理權限，不能修改逾期天數");
  const b = await body(request);
  const days = validated(() => validateOverdueDays(b.overdue_days));
  const expected = String(b.expected_updated_at ?? "").trim();
  if (!expected) throw new GaError(400, "缺少版本資訊（expected_updated_at），請重新載入畫面");
  const r = await rpc(ctx, "ga_ws_inv_transfer_set_overdue_days", { p_days: days, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

// ---------------------------------------------------------------- 列表
async function enrich(rows: any[], s: Scope, settings: { overdue_days: number }) {
  const items = rows.flatMap((r) => (r.items as any[]) || []);
  const [locs, parts] = await Promise.all([
    lookup("ga_inventory_locations", LOCATION_PUBLIC, rows.flatMap((r) => [r.source_location_id, r.destination_location_id])),
    lookup("ga_parts", PART_PUBLIC, items.map((i) => i.part_id)),
  ]);
  const stores = await storeNames(Array.from(locs.values()).map((l) => l.store_id).filter(Boolean));
  const loc = (id: string) => {
    const l = locs.get(id);
    return l ? { ...l, store: l.store_id ? stores.get(l.store_id) || null : null } : null;
  };
  const now = new Date();
  return rows.map((r) => {
    const dest = locs.get(r.destination_location_id);
    const destManager = !!dest && dest.location_type === "STORE" && !!dest.store_id && s.managers.includes(dest.store_id);
    const shaped = {
      ...r,
      source_location: loc(r.source_location_id),
      destination_location: loc(r.destination_location_id),
      items: ((r.items as any[]) || []).map((i) => ({ ...i, part: parts.get(i.part_id) || null })),
      is_overdue: isOverdue(r, settings.overdue_days, now),
      days_since_issued: AWAITING_RECEIPT.includes(r.status) ? overdueDaysCount(r, now) : null,
      has_store_report: !!r.store_report_type,
      abilities: transferAbilities(whoFor(s, destManager), r),
    };
    const { created_by: _c, source_confirmed_by: _s, received_by: _r, canceled_by: _x, ...open } = shaped;
    return maskTransfer(open, s.internal);
  });
}

async function list(ctx: Context, url: URL) {
  const s = await transferScope(ctx);
  requireRead(s);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const status = (p.get("status") || "").trim().toUpperCase();
  if (status && !(TRANSFER_STATUSES as readonly string[]).includes(status)) throw new GaError(400, "狀態篩選錯誤");
  const locationId = (p.get("locationId") || "").trim();
  if (locationId && !isUuid(locationId)) throw new GaError(400, "庫存位置格式錯誤");
  const search = (p.get("search") || "").trim();
  const overdueOnly = FILTERS_BOOL(p.get("overdue")) === true;
  const reportedOnly = FILTERS_BOOL(p.get("reported")) === true;
  const settings = await readSettings();
  const cutoff = overdueCutoff(settings.overdue_days);

  // 統計基底：套用搜尋與位置條件，但不套狀態、逾期、回報篩選（卡片數字是整體精確筆數）。
  const base = (q: any) => {
    let x = q.is("deleted_at", null);
    if (locationId) x = x.or(`source_location_id.eq.${locationId},destination_location_id.eq.${locationId}`);
    if (search) x = x.or(orIlike(transferSearchable(s.internal), search));
    return x;
  };
  const head = () => base((ctx.auth as any).from("ga_inventory_transfers").select("id", { count: "exact", head: true }));
  const filtered = (q: any) => {
    let x = base(q);
    if (status) x = x.eq("status", status);
    if (overdueOnly) x = x.in("status", [...AWAITING_RECEIPT]).lt("source_confirmed_at", cutoff);
    if (reportedOnly) x = x.not("store_report_type", "is", null);
    return x;
  };
  const counts = await Promise.all([
    ...TRANSFER_STATUSES.map((st) => head().eq("status", st)),
    head().in("status", [...AWAITING_RECEIPT]).lt("source_confirmed_at", cutoff),
    head().not("store_report_type", "is", null),
    head(),
  ]);
  for (const c of counts) if (c.error) throw dbError(c.error);
  const res = await filtered((ctx.auth as any).from("ga_inventory_transfers").select(SELECT, { count: "exact" }))
    .order("created_at", { ascending: false }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const total = res.count || 0;
  const stats: Record<string, number> = { all: counts[TRANSFER_STATUSES.length + 2].count || 0, overdue: counts[TRANSFER_STATUSES.length].count || 0, reported: counts[TRANSFER_STATUSES.length + 1].count || 0 };
  TRANSFER_STATUSES.forEach((st, i) => (stats[st] = counts[i].count || 0));
  const data = await enrich((res.data as any[]) || [], s, settings);
  return respond({
    data, total, meta: pagingMeta(page, pageSize, total), stats, settings,
    permissions: {
      internal: s.internal, canOperate: s.canOperate, canCreate: s.canOperate, canSetOverdue: s.transferManage, canReport: s.managers.length > 0,
      problem: transferAbilities(whoFor(s, false), { status: "REQUESTED" }).problem,
    },
  });
}

async function detail(ctx: Context, id: string) {
  const s = await transferScope(ctx);
  requireRead(s);
  const row = (await must((ctx.auth as any).from("ga_inventory_transfers").select(SELECT).eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到這張調撥單，或不是您可以查看的調撥單");
  const settings = await readSettings();
  const [data] = await enrich([row], s, settings);
  const ev = await (ctx.auth as any).from("ga_inventory_transfer_events")
    .select("id,action,from_status,to_status,note,metadata,created_at,created_by").eq("transfer_id", id).order("created_at").order("id").limit(EVENT_PAGE_MAX);
  if (ev.error) throw dbError(ev.error);
  const events = (ev.data as any[]) || [];
  const names = await creatorNames(events.map((e) => e.created_by));
  const shaped = events.map(({ created_by, metadata, ...e }) =>
    maskEvent({ ...e, creator_name: names.get(created_by) || null, return_stock: metadata?.return_stock === true, exception_type: metadata?.exception_type ?? null, report_type: metadata?.report_type ?? null }, s.internal));
  return respond({ data: { ...data, events: shaped }, settings });
}

// ---------------------------------------------------------------- 建單與動作
async function create(ctx: Context, request: NextRequest) {
  const s = await transferScope(ctx);
  requireRead(s);
  const b = await body(request);
  const v = validated(() => validateCreatePayload(b));
  const r = await rpc(ctx, "ga_ws_inv_transfer_create", {
    p_source_location_id: v.source_location_id, p_destination_location_id: v.destination_location_id, p_part_id: v.part_id, p_quantity: v.quantity,
    p_input_unit_type: v.input_unit_type, p_reason: v.reason, p_notes: v.notes, p_shipping_method: v.shipping_method, p_request_id: v.request_id, p_idempotency_key: v.idempotency_key,
  });
  return respond({ data: r.data, replay: r.replay === true, warnings: r.warnings || [] }, r.status === 200 ? 200 : 201);
}

async function act(ctx: Context, request: NextRequest, id: string) {
  const s = await transferScope(ctx);
  requireRead(s);
  const b = await body(request);
  const v = validated(() => validateActionPayload(b));
  if (v.action === "store_report") {
    const r = await rpc(ctx, "ga_ws_inv_transfer_store_report", {
      p_transfer_id: id, p_type: v.report_type, p_note: v.note, p_expected_updated_at: v.expected_updated_at, p_idempotency_key: v.idempotency_key,
    });
    return respond({ data: r.data, replay: r.replay === true });
  }
  const r = await rpc(ctx, "ga_ws_inv_transfer_action", {
    p_transfer_id: id, p_action: v.action, p_expected_updated_at: v.expected_updated_at, p_idempotency_key: v.idempotency_key,
    p_note: v.note, p_shipping_method: v.shipping_method, p_return_stock: v.return_stock, p_exception_type: v.exception_type,
  });
  return respond({ data: r.data, replay: r.replay === true });
}

// ---------------------------------------------------------------- 建單選項（位置、來源位置的料件＋目的位置是否已設定 C8）
async function options(ctx: Context, url: URL) {
  const s = await transferScope(ctx);
  if (!s.transferManage && !s.transactionManage) throw new GaError(403, "沒有調撥管理權限，不能選擇調撥的位置與料件");
  const p = url.searchParams;
  const type = (p.get("type") || "locations").trim();
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const search = (p.get("search") || "").trim();
  const db = adminClient() as any;
  if (type === "locations") {
    let q = db.from("ga_inventory_locations").select(LOCATION_PUBLIC, { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "code"], search));
    const res = await q.order("location_type").order("name").order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    const rows = (res.data as any[]) || [];
    const stores = await storeNames(rows.map((r) => r.store_id));
    return respond({ data: rows.map((r) => ({ ...r, store: r.store_id ? stores.get(r.store_id) || null : null })), total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0) });
  }
  if (type === "parts") {
    const source = (p.get("locationId") || "").trim();
    const dest = (p.get("destinationLocationId") || "").trim();
    if (!isUuid(source)) throw new GaError(400, "請先選擇來源位置");
    if (dest && !isUuid(dest)) throw new GaError(400, "目的位置格式錯誤");
    if (!s.partView) return respond({ data: [], total: 0, meta: pagingMeta(page, pageSize, 0), partCatalogAccess: false, message: "缺少「料件查看」權限，因此無法載入料件選項，也不能建立調撥單。" });
    const sel = `id,part_id,part:ga_parts${search ? "!inner" : ""}(${PART_PUBLIC},is_active)`;
    let q = db.from("ga_inventory_location_parts").select(sel, { count: "exact" }).eq("location_id", source).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search), { foreignTable: "ga_parts" });
    const res = await q.order("created_at", { ascending: false }).order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    const rows = ((res.data as any[]) || []).filter((r) => r.part && r.part.is_active === true);
    const ids = rows.map((r) => r.part_id);
    const [bal, destCfg] = await Promise.all([
      ids.length ? must(db.from("ga_inventory_balances").select("part_id,quantity_base").eq("location_id", source).in("part_id", ids)) : Promise.resolve([] as any[]),
      dest && ids.length ? must(db.from("ga_inventory_location_parts").select("part_id").eq("location_id", dest).eq("is_active", true).is("deleted_at", null).in("part_id", ids)) : Promise.resolve([] as any[]),
    ]);
    const balBy = new Map(((bal as any[]) || []).map((x) => [x.part_id as string, Number(x.quantity_base)]));
    const cfg = new Set(((destCfg as any[]) || []).map((x) => x.part_id as string));
    return respond({
      data: rows.map((r) => ({ part_id: r.part_id, part: r.part, source_balance: balBy.get(r.part_id) ?? 0, destination_configured: dest ? cfg.has(r.part_id) : null })),
      total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0), partCatalogAccess: true,
    });
  }
  throw new GaError(400, "選項類型錯誤");
}

// ---------------------------------------------------------------- 網址參數預填（fromRequestId、requestNo、partId、quantity、sourceLocationId、destinationStoreId、reason、notes）
async function prefill(ctx: Context, url: URL) {
  const s = await transferScope(ctx);
  if (!s.transferManage && !s.transactionManage) throw new GaError(403, "沒有調撥管理權限，不能建立調撥單");
  const input = parsePrefill(url.searchParams);
  const db = adminClient() as any;
  const unresolved: { field: string; label: string; reason: string }[] = [];
  const notices: string[] = [];
  const values: Record<string, any> = { request_id: null, request_no: null, part_id: null, quantity: null, input_unit_type: "BASE", source_location_id: null, destination_location_id: null, reason: null, notes: null };
  let request: any = null;

  if (input.fromRequestId) {
    if (!isUuid(input.fromRequestId)) unresolved.push({ field: "fromRequestId", label: "來源需求單", reason: "需求單編號格式不正確，這張調撥單不會連結需求單" });
    else {
      request = (await must(db.from("ga_service_requests").select("id,request_no,store_id,part_id,desired_quantity,desired_unit,main_status,deleted_at").eq("id", input.fromRequestId).maybeSingle())) as any;
      if (!request || request.deleted_at) { request = null; unresolved.push({ field: "fromRequestId", label: "來源需求單", reason: "找不到這張需求單（可能已被刪除），這張調撥單不會連結需求單" }); }
      else if (["COMPLETED", "REJECTED", "CANCELED"].includes(request.main_status)) { unresolved.push({ field: "fromRequestId", label: "來源需求單", reason: `需求單 ${request.request_no} 已結案、退回或取消，不能再連結` }); request = null; }
      else { values.request_id = request.id; values.request_no = request.request_no; }
    }
  } else if (input.requestNo) notices.push(`需求單號 ${input.requestNo} 只是參考資訊，沒有帶需求單編號，不會連結需求單`);

  let part: any = null;
  const partId = input.partId || request?.part_id || "";
  if (input.partId && !isUuid(input.partId)) unresolved.push({ field: "partId", label: "料件", reason: "料件編號格式不正確" });
  else if (partId) {
    part = (await must(db.from("ga_parts").select(PART_PUBLIC + ",is_active,deleted_at").eq("id", partId).maybeSingle())) as any;
    if (!part || part.deleted_at) { part = null; unresolved.push({ field: "partId", label: "料件", reason: "找不到這個料件（可能已被刪除）" }); }
    else if (!part.is_active) { unresolved.push({ field: "partId", label: "料件", reason: `料件「${part.name}」已停用，不能調撥` }); part = null; }
    else values.part_id = part.id;
  }

  if (input.quantity) {
    const n = Number(input.quantity.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0 || Math.round(n * 10000) / 10000 !== n) unresolved.push({ field: "quantity", label: "數量", reason: `數量「${input.quantity}」不是大於 0 的數字（最多 4 位小數）` });
    else {
      values.quantity = n;
      if (part) {
        const u = resolvePrefillUnit(request?.desired_unit, part);
        values.input_unit_type = u.unit;
        if (u.note) notices.push(u.note);
      }
    }
  }

  if (input.sourceLocationId) {
    if (!isUuid(input.sourceLocationId)) unresolved.push({ field: "sourceLocationId", label: "來源位置", reason: "來源位置編號格式不正確" });
    else {
      const loc = (await must(db.from("ga_inventory_locations").select("id,name,is_active,deleted_at").eq("id", input.sourceLocationId).maybeSingle())) as any;
      if (!loc || loc.deleted_at) unresolved.push({ field: "sourceLocationId", label: "來源位置", reason: "找不到這個來源位置" });
      else if (!loc.is_active) unresolved.push({ field: "sourceLocationId", label: "來源位置", reason: `來源位置「${loc.name}」已停用` });
      else if (part && !(await configured(db, loc.id, part.id))) unresolved.push({ field: "sourceLocationId", label: "來源位置", reason: `來源位置「${loc.name}」還沒有設定這個料件` });
      else values.source_location_id = loc.id;
    }
  }

  const storeId = input.destinationStoreId || request?.store_id || "";
  if (input.destinationStoreId && !isUuid(input.destinationStoreId)) unresolved.push({ field: "destinationStoreId", label: "目的門市", reason: "門市編號格式不正確" });
  else if (storeId) {
    const locs = ((await must(db.from("ga_inventory_locations").select("id,name,is_default").eq("store_id", storeId).eq("location_type", "STORE").eq("is_active", true).is("deleted_at", null).order("is_default", { ascending: false }).order("name"))) as any[]) || [];
    if (!locs.length) unresolved.push({ field: "destinationStoreId", label: "目的門市", reason: "這間門市還沒有啟用中的庫存位置，請先到「庫存位置」建立" });
    else {
      let pick = locs[0];
      if (part) {
        const cfg = ((await must(db.from("ga_inventory_location_parts").select("location_id").eq("part_id", part.id).eq("is_active", true).is("deleted_at", null).in("location_id", locs.map((l) => l.id)))) as any[]) || [];
        const ok = locs.find((l) => cfg.some((c) => c.location_id === l.id));
        if (ok) pick = ok;
        else notices.push(`目的位置「${pick.name}」還沒有設定這個料件，建單前要先到「庫存位置」加入設定`);
      }
      values.destination_location_id = pick.id;
    }
  }
  if (input.reason) values.reason = input.reason.slice(0, 200);
  if (input.notes) values.notes = input.notes.slice(0, 500);
  if (request && values.quantity !== null && part && request.desired_quantity) {
    const need = toRequestUnit(values.quantity, values.input_unit_type, request.desired_unit, part);
    if (need > Number(request.desired_quantity) + 0.00005) notices.push(`帶入的數量超過需求單的需求量（${request.desired_quantity}${request.desired_unit || ""}），建單時會檢查剩餘需求量`);
  }
  // 畫面直接顯示為已選用的物件（位置含門市、料件含來源庫存與目的位置是否已設定）。
  const shown: Record<string, any> = {};
  for (const [key, id] of [["source", values.source_location_id], ["destination", values.destination_location_id]] as const) {
    if (!id) continue;
    const l = (await must(db.from("ga_inventory_locations").select(LOCATION_PUBLIC).eq("id", id).maybeSingle())) as any;
    if (l) shown[key] = { ...l, store: l.store_id ? (await storeNames([l.store_id])).get(l.store_id) || null : null };
  }
  if (part && values.source_location_id) {
    const bal = (await must(db.from("ga_inventory_balances").select("quantity_base").eq("location_id", values.source_location_id).eq("part_id", part.id).maybeSingle())) as any;
    shown.part = { part_id: part.id, part, source_balance: Number(bal?.quantity_base ?? 0), destination_configured: values.destination_location_id ? await configured(db, values.destination_location_id, part.id) : null };
  } else if (part) shown.part = { part_id: part.id, part, source_balance: 0, destination_configured: null };
  return respond({ values, unresolved, notices, shown, part: part || null, request: request ? { id: request.id, request_no: request.request_no } : null });
}

async function configured(db: any, locationId: string, partId: string) {
  const rows = ((await must(db.from("ga_inventory_location_parts").select("id").eq("location_id", locationId).eq("part_id", partId).eq("is_active", true).is("deleted_at", null).limit(1))) as any[]) || [];
  return rows.length > 0;
}
