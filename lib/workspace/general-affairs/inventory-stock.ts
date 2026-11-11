// G12 庫存餘額、流水、過帳、持有狀態 API（/api/workspace/general-affairs/inventory/{options,balances,transactions,holding}/**）。
// 讀取：餘額走資料庫函式 ga_ws_inv_balance_page（每列用餘額表 RLS 同一個可見性函式過濾）；流水與持有紀錄用使用者自己的身分查（RLS 決定看得到哪些列）。
// 寫入：全部走資料庫函式（ga_ws_inv_post、ga_ws_inv_set_holding），過帳固定識別防重複、核心錯誤整筆回復。
// C12：只憑門市名單身分（店長、督導、區經理）的人唯讀，流水的原因與備註、持有狀態的調整原因由這裡遮蔽；記錄人只回姓名（不回 email）。
// 共通：非 GET 的 Origin 檢查在 runGa；分頁上限 100；持有狀態調整帶 expected_updated_at（衝突回 409 STALE）。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { INV, rosterStoreIds, storeNames } from "./inventory-locations";
import {
  BALANCE_CSV_COLUMNS, BALANCE_SORTS, buildCsv, CSV_MAX_ROWS, HOLDING_FILTERS, likeTerm, maskHolding, maskTransaction, POST_TYPES,
  postPermissionText, TRANSACTION_CSV_COLUMNS, TRANSACTION_SORTS, taipeiDayRange, transactionSource, validateHoldingPayload, validatePostPayload,
} from "./inventory-stock-rules";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

/** 讀取範圍：餘額＝餘額查看或交易管理；流水＝流水查看或交易管理；或門市名單身分（唯讀，RLS 只給自己門市）。 */
export async function stockScope(ctx: Context) {
  const canBalance = dbCan(ctx.permissions, INV.balanceView, INV.transactionManage);
  const canTxn = dbCan(ctx.permissions, INV.transactionView, INV.transactionManage);
  const canPost = dbCan(ctx.permissions, INV.transactionManage);
  const canPart = dbCan(ctx.permissions, GA.partView, GA.partManage);
  const roster = canBalance && canTxn ? false : (await rosterStoreIds(ctx)).length > 0;
  return {
    balances: canBalance || roster,
    transactions: canTxn || roster,
    balancesInternal: canBalance,
    transactionsInternal: canTxn,
    canPost,
    canPart,
    canAdjust: canPost,
    roster,
    postProblem: postPermissionText({ canPost, canPartView: canPart }),
  };
}
type Scope = Awaited<ReturnType<typeof stockScope>>;

function requireBalances(s: Scope) {
  if (!s.balances) throw new GaError(403, "沒有庫存餘額查看權限");
}
function requireTransactions(s: Scope) {
  if (!s.transactions) throw new GaError(403, "沒有庫存流水查看權限");
}
function uuidParam(p: URLSearchParams, key: string, label: string) {
  const v = (p.get(key) || "").trim();
  if (v && !isUuid(v)) throw new GaError(400, `${label}格式錯誤`);
  return v || null;
}
function requireId(value: string, label: string) {
  if (!isUuid(value)) throw new GaError(400, `${label}格式錯誤`);
}

export async function stockApi(ctx: Context, request: NextRequest, head: string, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (head === "access" && !a && m === "GET") return access(ctx);
  if (head === "options" && !a && m === "GET") return options(ctx, new URL(request.url));
  if (head === "balances") {
    if (!a && m === "GET") return balances(ctx, new URL(request.url));
    if (a === "export" && !b && m === "GET") return exportBalances(ctx, new URL(request.url));
  }
  if (head === "transactions") {
    if (!a && m === "GET") return transactions(ctx, new URL(request.url));
    if (a === "export" && !b && m === "GET") return exportTransactions(ctx, new URL(request.url));
    if (a === "post" && !b && m === "POST") return post(ctx, request);
  }
  if (head === "holding") {
    if (!a && m === "GET") return holding(ctx, new URL(request.url));
    if (a && !b && m === "PATCH") return adjustHolding(ctx, request, a);
    if (a && b === "events" && m === "GET") return holdingEvents(ctx, a, new URL(request.url));
  }
  throw new GaError(404, "找不到這個功能");
}

/** 頁面決定要顯示哪些分頁與按鈕用（資料庫語意的實際權限）。 */
async function access(ctx: Context) {
  const s = await stockScope(ctx);
  if (!s.balances && !s.transactions) throw new GaError(403, "沒有庫存查看權限");
  return respond({
    balances: s.balances, transactions: s.transactions, holding: s.balances, canPost: s.canPost, canAdjust: s.canAdjust, canPartView: s.canPart,
    internal: s.balancesInternal || s.transactionsInternal, readOnly: !s.canPost, postProblem: s.postProblem,
  });
}

// ---------------------------------------------------------------- 共用：把位置與料件、門市補到列上
export const LOCATION_PUBLIC = "id,code,name,location_type,store_id,allow_negative_stock,is_default";
export const PART_PUBLIC = "id,name,part_code,barcode,brand,model,specification,base_unit,purchase_unit,purchase_to_base_rate,minimum_issue_qty,allow_fractional_issue,allow_unpacking";

export async function lookup(table: string, columns: string, ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map<string, any>();
  const rows: any[] = [];
  for (let i = 0; i < unique.length; i += 100) rows.push(...(((await must((adminClient() as any).from(table).select(columns).in("id", unique.slice(i, i + 100)))) as any[]) || []));
  return new Map(rows.map((r) => [r.id as string, r]));
}
export async function creatorNames(ids: string[]) {
  const m = await lookup("profiles", "id,full_name", ids);
  return new Map(Array.from(m, ([k, v]) => [k, (v.full_name as string) || "（未命名）"]));
}

// ---------------------------------------------------------------- 餘額
type BalanceArgs = { locationId: string | null; partId: string | null; search: string; includeZero: boolean; lowOnly: boolean; holding: string; sort: string; ascending: boolean };
function balanceArgs(p: URLSearchParams, defaults: { sort: string; ascending: boolean; includeZero: boolean }): BalanceArgs {
  const holding = (p.get("holding") || "").trim().toUpperCase();
  if (holding && !(HOLDING_FILTERS as readonly string[]).includes(holding)) throw new GaError(400, "持有狀態篩選錯誤");
  const sortRaw = (p.get("sort") || "").trim();
  if (sortRaw && !BALANCE_SORTS.has(sortRaw)) throw new GaError(400, "排序欄位錯誤");
  const order = p.get("sortOrder");
  const include = FILTERS_BOOL(p.get("includeZero"));
  return {
    locationId: uuidParam(p, "locationId", "庫存位置"), partId: uuidParam(p, "partId", "料件"), search: (p.get("search") || "").trim(),
    includeZero: include === null ? defaults.includeZero : include, lowOnly: FILTERS_BOOL(p.get("lowOnly")) === true, holding,
    sort: sortRaw || defaults.sort, ascending: order ? order === "asc" : defaults.ascending,
  };
}
async function balancePage(ctx: Context, a: BalanceArgs, offset: number, limit: number) {
  const { data, error } = await (ctx.auth as any).rpc("ga_ws_inv_balance_page", {
    p_location_id: a.locationId, p_part_id: a.partId, p_search: a.search || null, p_include_zero: a.includeZero, p_low_only: a.lowOnly,
    p_holding: a.holding || null, p_sort: a.sort, p_ascending: a.ascending, p_offset: offset, p_limit: limit,
  });
  if (error) throw dbError(error);
  return data as { total: number; stats: Record<string, number>; rows: any[] };
}
async function withStores<T extends { location?: any }>(rows: T[]) {
  const stores = await storeNames(rows.map((r) => r.location?.store_id).filter(Boolean));
  return rows.map((r) => ({ ...r, store: r.location?.store_id ? stores.get(r.location.store_id) || null : null }));
}
function shapeBalance(row: any, internal: boolean) {
  return { ...row, quantity_on_hand: row.quantity_base, base_unit: row.part?.base_unit ?? null, holding: maskHolding(row.holding, internal) };
}

async function balances(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  requireBalances(s);
  const p = url.searchParams;
  const { page, pageSize, from } = parsePaging(p, { pageSize: 20, max: 100 });
  const args = balanceArgs(p, { sort: "last_transaction_at", ascending: false, includeZero: false });
  const res = await balancePage(ctx, args, from, pageSize);
  const data = (await withStores(res.rows)).map((r) => shapeBalance(r, s.balancesInternal));
  return respond({
    data, total: res.total, meta: pagingMeta(page, pageSize, res.total), stats: res.stats,
    permissions: { internal: s.balancesInternal, readOnly: !s.canPost, canPost: s.canPost, canAdjust: s.canAdjust, canViewTransactions: s.transactions, postProblem: s.postProblem },
  });
}

async function exportBalances(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  requireBalances(s);
  const args = balanceArgs(url.searchParams, { sort: "last_transaction_at", ascending: false, includeZero: false });
  const rows: any[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += 1000) {
    const res = await balancePage(ctx, args, offset, 1000);
    rows.push(...res.rows);
    if (rows.length >= res.total) break;
    if (rows.length >= CSV_MAX_ROWS) { truncated = true; break; }
  }
  const shaped = (await withStores(rows.slice(0, CSV_MAX_ROWS))).map((r) => shapeBalance(r, s.balancesInternal));
  return csvResponse(buildCsv(shaped, BALANCE_CSV_COLUMNS), "庫存餘額", truncated);
}

function csvResponse(csv: string, name: string, truncated: boolean) {
  const stamp = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}-${stamp}.csv`)}`,
      "Cache-Control": "no-store",
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}

// ---------------------------------------------------------------- 流水
const TRANSACTION_COLUMNS = "id,transaction_no,transaction_type,location_id,part_id,quantity_input,input_unit_type,unit_conversion_rate,quantity_base,balance_before,balance_after,reference_type,reference_id,reason,notes,metadata,occurred_at,created_at,created_by";

async function transactionQuery(ctx: Context, p: URLSearchParams, internal: boolean) {
  const type = (p.get("transactionType") || "").trim().toUpperCase();
  if (type && !(POST_TYPES as readonly string[]).includes(type)) throw new GaError(400, "交易類型錯誤");
  const sortRaw = (p.get("sort") || "").trim();
  if (sortRaw && !TRANSACTION_SORTS.has(sortRaw)) throw new GaError(400, "排序欄位錯誤");
  const source = (p.get("source") || "").trim();
  if (source && !["manual", "transfer", "return_stock"].includes(source)) throw new GaError(400, "來源篩選錯誤");
  const locationId = uuidParam(p, "locationId", "庫存位置");
  const partId = uuidParam(p, "partId", "料件");
  const referenceId = uuidParam(p, "referenceId", "參考單據");
  let from: string | null = null;
  let to: string | null = null;
  const dateFrom = (p.get("dateFrom") || "").trim();
  const dateTo = (p.get("dateTo") || "").trim();
  if (dateFrom) from = validated(() => taipeiDayRange(dateFrom).from);
  if (dateTo) to = validated(() => taipeiDayRange(dateTo).to);
  if (from && to && from > to) throw new GaError(400, "起始日期不可晚於結束日期");
  const creator = (p.get("creator") || "").trim();
  let creatorIds: string[] | null = null;
  if (creator) {
    const rows = ((await must((adminClient() as any).from("profiles").select("id").ilike("full_name", likeTerm(creator)).limit(200))) as any[]) || [];
    creatorIds = rows.map((r) => r.id);
  }
  // 原因欄位對唯讀名單身分是遮蔽的，不能拿來當搜尋條件（否則可以猜出內容）。
  const reason = internal ? (p.get("reason") || "").trim() : "";
  const query = (q: any) => {
    let x = q;
    if (type) x = x.eq("transaction_type", type);
    if (locationId) x = x.eq("location_id", locationId);
    if (partId) x = x.eq("part_id", partId);
    if (referenceId) x = x.eq("reference_id", referenceId);
    if (from) x = x.gte("occurred_at", from);
    if (to) x = x.lte("occurred_at", to);
    if (creatorIds) x = creatorIds.length ? x.in("created_by", creatorIds) : x.eq("id", "00000000-0000-0000-0000-000000000000");
    if (reason) x = x.ilike("reason", likeTerm(reason));
    if (source === "manual") x = x.is("reference_type", null);
    if (source === "transfer") x = x.eq("reference_type", "INVENTORY_TRANSFER");
    if (source === "return_stock") x = x.eq("reference_type", "INVENTORY_TRANSFER").eq("metadata->>action", "return_stock");
    return x;
  };
  return { query, sort: sortRaw || "occurred_at", ascending: p.get("sortOrder") === "asc" };
}

async function enrichTransactions(rows: any[], internal: boolean) {
  const [locs, parts, names] = await Promise.all([
    lookup("ga_inventory_locations", LOCATION_PUBLIC, rows.map((r) => r.location_id)),
    lookup("ga_parts", PART_PUBLIC, rows.map((r) => r.part_id)),
    creatorNames(rows.map((r) => r.created_by)),
  ]);
  const stores = await storeNames(Array.from(locs.values()).map((l) => l.store_id).filter(Boolean));
  return rows.map((r) => {
    const loc = locs.get(r.location_id) || null;
    const src = transactionSource(r);
    const { metadata: _m, reference_id: _ref, created_by: _c, ...rest } = r;
    return maskTransaction({
      ...rest,
      location: loc ? { ...loc, store: loc.store_id ? stores.get(loc.store_id) || null : null } : null,
      part: parts.get(r.part_id) || null,
      creator_name: names.get(r.created_by) || null,
      source_label: src.label, transfer_no: src.transfer_no, return_stock: src.return_stock,
    }, internal);
  });
}

async function transactions(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  requireTransactions(s);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const f = await transactionQuery(ctx, p, s.transactionsInternal);
  const res = await f.query((ctx.auth as any).from("ga_inventory_transactions").select(TRANSACTION_COLUMNS, { count: "exact" }))
    .order(f.sort, { ascending: f.ascending }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const total = res.count || 0;
  const data = await enrichTransactions((res.data as any[]) || [], s.transactionsInternal);
  return respond({ data, total, meta: pagingMeta(page, pageSize, total), permissions: { internal: s.transactionsInternal, readOnly: !s.canPost, canPost: s.canPost, postProblem: s.postProblem } });
}

async function exportTransactions(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  requireTransactions(s);
  const f = await transactionQuery(ctx, url.searchParams, s.transactionsInternal);
  const rows: any[] = [];
  let truncated = false;
  for (let from = 0; ; from += 1000) {
    const res = await f.query((ctx.auth as any).from("ga_inventory_transactions").select(TRANSACTION_COLUMNS, { count: "exact" }))
      .order(f.sort, { ascending: f.ascending }).order("id").range(from, from + 999);
    if (res.error) throw dbError(res.error);
    rows.push(...((res.data as any[]) || []));
    if (rows.length >= (res.count || 0) || !(res.data || []).length) break;
    if (rows.length >= CSV_MAX_ROWS) { truncated = true; break; }
  }
  const data = await enrichTransactions(rows.slice(0, CSV_MAX_ROWS), s.transactionsInternal);
  return csvResponse(buildCsv(data, TRANSACTION_CSV_COLUMNS), "庫存流水", truncated);
}

// ---------------------------------------------------------------- 過帳
async function post(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const payload = validated(() => validatePostPayload(b));
  const r = await rpc(ctx, "ga_ws_inv_post", {
    p_transaction_type: payload.transaction_type, p_location_id: payload.location_id, p_part_id: payload.part_id, p_quantity: payload.quantity,
    p_input_unit_type: payload.input_unit_type, p_reason: payload.reason, p_notes: payload.notes, p_idempotency_key: payload.idempotency_key,
    p_occurred_at: payload.occurred_at,
  });
  return respond({ data: r.data, replay: r.data?.idempotent_replay === true }, r.status === 200 ? 200 : 201);
}

// ---------------------------------------------------------------- 選項（位置、料件設定含餘額；搜尋加分頁）
async function options(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  if (!s.balances && !s.transactions && !s.canPost) throw new GaError(403, "沒有庫存查看權限");
  const p = url.searchParams;
  const type = (p.get("type") || "locations").trim();
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const search = (p.get("search") || "").trim();
  const db = adminClient() as any;
  const internal = s.balancesInternal || s.transactionsInternal || s.canPost;
  // 門市名單身分只看自己門市的 STORE 位置；其餘（總務、記帳）看全部啟用中的位置。
  const rosterStores = internal ? null : await rosterStoreIds(ctx);

  if (type === "locations") {
    let q = db.from("ga_inventory_locations").select(`${LOCATION_PUBLIC}`, { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (rosterStores) q = rosterStores.length ? q.eq("location_type", "STORE").in("store_id", rosterStores) : q.eq("id", "00000000-0000-0000-0000-000000000000");
    if (search) q = q.or(orIlike(["name", "code"], search));
    const res = await q.order("location_type").order("name").order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    const rows = (res.data as any[]) || [];
    const stores = await storeNames(rows.map((r) => r.store_id));
    return respond({ data: rows.map((r) => ({ ...r, store: r.store_id ? stores.get(r.store_id) || null : null })), total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0) });
  }
  if (type === "parts") {
    // 篩選用：有庫存或有設定過的料件不限，直接搜尋啟用中的料件（只回公開欄位）。
    if (!s.canPart && !s.balances && !s.transactions) throw new GaError(403, "沒有料件查看權限");
    let q = db.from("ga_parts").select("id,name,part_code,brand,model,specification,base_unit", { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search));
    const res = await q.order("name").order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    return respond({ data: res.data || [], total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0) });
  }
  if (type === "location-parts") {
    // 過帳用：這個位置啟用中的料件設定＋目前餘額。需要「料件查看」才看得到料件目錄（與舊版一致，缺少時回說明）。
    const locationId = uuidParam(p, "locationId", "庫存位置");
    if (!locationId) throw new GaError(400, "請先選擇庫存位置");
    if (!s.canPost) throw new GaError(403, "沒有庫存交易管理權限，不能選擇過帳的料件");
    if (!s.canPart) return respond({ data: [], total: 0, meta: pagingMeta(page, pageSize, 0), partCatalogAccess: false, message: "缺少「料件查看」權限，因此無法載入料件選項。" });
    const loc = (await must(db.from("ga_inventory_locations").select(LOCATION_PUBLIC).eq("id", locationId).eq("is_active", true).is("deleted_at", null).maybeSingle())) as any;
    if (!loc) throw new GaError(404, "找不到這個庫存位置，或已停用");
    if (rosterStores && !(loc.location_type === "STORE" && rosterStores.includes(loc.store_id))) throw new GaError(404, "找不到這個庫存位置，或已停用");
    const sel = `id,part_id,safety_stock_qty,reorder_point_qty,maximum_stock_qty,preferred_issue_unit_type,part:ga_parts${search ? "!inner" : ""}(${PART_PUBLIC},is_active)`;
    let q = db.from("ga_inventory_location_parts").select(sel, { count: "exact" }).eq("location_id", locationId).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search), { foreignTable: "ga_parts" });
    const res = await q.order("created_at", { ascending: false }).order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    const rows = ((res.data as any[]) || []).filter((r) => r.part && r.part.is_active === true);
    const bal = rows.length ? (((await must(db.from("ga_inventory_balances").select("id,part_id,quantity_base,version,last_transaction_at").eq("location_id", locationId).in("part_id", rows.map((r) => r.part_id)))) as any[]) || []) : [];
    const byPart = new Map(bal.map((x) => [x.part_id as string, x]));
    return respond({
      data: rows.map((r) => ({ ...r, location_id: locationId, currentBalance: byPart.get(r.part_id) || null })),
      location: loc, total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0), partCatalogAccess: true,
    });
  }
  throw new GaError(400, "選項類型錯誤");
}

// ---------------------------------------------------------------- 持有狀態（C4）
async function holding(ctx: Context, url: URL) {
  const s = await stockScope(ctx);
  requireBalances(s);
  const p = url.searchParams;
  const { page, pageSize, from } = parsePaging(p, { pageSize: 20, max: 100 });
  const args = { ...balanceArgs(p, { sort: "idle_quantity", ascending: false, includeZero: false }), includeZero: false };
  // 持有狀態只看有庫存（大於 0）的列：holding='ALL' 是「數量大於 0」；沒有選持有狀態篩選時用它。
  const base = { ...args, holding: args.holding || "ALL" };
  const [res, top] = await Promise.all([
    balancePage(ctx, base, from, pageSize),
    balancePage(ctx, { ...args, holding: "IDLE", sort: "idle_quantity", ascending: false }, 0, 3),
  ]);
  const data = (await withStores(res.rows)).map((r) => shapeBalance(r, s.balancesInternal));
  const topRows = (await withStores(top.rows)).map((r) => shapeBalance(r, s.balancesInternal));
  const st = res.stats;
  return respond({
    data, total: res.total, meta: pagingMeta(page, pageSize, res.total),
    summary: { total_qty: st.total_qty, in_use: st.in_use, idle: st.idle, unclassified: st.unclassified },
    top: topRows,
    permissions: { internal: s.balancesInternal, canAdjust: s.canAdjust },
  });
}

async function adjustHolding(ctx: Context, request: NextRequest, balanceId: string) {
  requireId(balanceId, "庫存餘額 id");
  if (!dbCan(ctx.permissions, INV.transactionManage)) throw new GaError(403, "沒有庫存交易管理權限，不能調整持有狀態");
  const b = await body(request);
  const v = validated(() => validateHoldingPayload(b));
  const r = await rpc(ctx, "ga_ws_inv_set_holding", { p_balance_id: balanceId, p_in_use: v.in_use_quantity, p_idle: v.idle_quantity, p_reason: v.reason, p_expected_updated_at: v.expected_updated_at });
  return respond({ data: r.data });
}

async function holdingEvents(ctx: Context, balanceId: string, url: URL) {
  const s = await stockScope(ctx);
  requireBalances(s);
  requireId(balanceId, "庫存餘額 id");
  const { page, pageSize, from, to } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  // 先確認這筆餘額看得到（RLS）；看不到一律 404。
  const bal = (await must((ctx.auth as any).from("ga_inventory_balances").select("id").eq("id", balanceId).maybeSingle())) as any;
  if (!bal) throw new GaError(404, "找不到庫存餘額，或不是您可以查看的餘額");
  const res = await (ctx.auth as any).from("ga_inventory_holding_events")
    .select("id,balance_id,before_in_use_quantity,before_idle_quantity,after_in_use_quantity,after_idle_quantity,notes,created_at,created_by", { count: "exact" })
    .eq("balance_id", balanceId).order("created_at", { ascending: false }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const rows = (res.data as any[]) || [];
  const names = await creatorNames(rows.map((r) => r.created_by));
  const data = rows.map(({ created_by, notes, ...r }) => ({ ...r, notes: s.balancesInternal ? notes : null, creator_name: names.get(created_by) || null }));
  const total = res.count || 0;
  return respond({ data, total, meta: pagingMeta(page, pageSize, total) });
}
