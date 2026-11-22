// G11 庫存位置與料件設定 API（/api/workspace/general-affairs/inventory/locations/**）。
// 讀取：用使用者自己的身分查（RLS 決定看得到哪些位置）；寫入：全部走資料庫函式 ga_ws_inv_*（版本檢查、鎖列、停用與移除保護、全成或全不變）。
// C12：位置描述與位置料件備註只有「位置查看／管理權限」的人看得到；只憑門市名單身分（店長、督導、區經理）的人唯讀，內部欄位由這裡遮蔽。
// 共通：非 GET 的 Origin 檢查在 runGa；分頁上限 100；寫入帶 expected_updated_at（衝突回 409 STALE）。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import {
  impactSummary, LOCATION_SORT_COLUMNS, LOCATION_TYPES, locationAccess, maskLocation, maskSetting, resolvedIssueUnit,
  validateLocationPartItems, validateLocationPartPayload, validateLocationPayload,
} from "./inventory-rules";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

export const INV = {
  locationView: "general_affairs.inventory_location.view",
  locationManage: "general_affairs.inventory_location.manage",
  balanceView: "general_affairs.inventory_balance.view",
  transactionView: "general_affairs.inventory_transaction.view",
  transactionManage: "general_affairs.inventory_transaction.manage",
  transferView: "general_affairs.inventory_transfer.view",
  transferManage: "general_affairs.inventory_transfer.manage",
} as const;

/** 登入者在門市名單（store_managers，任何身分）上的門市；店長、督導、區經理都算（C12）。 */
export async function rosterStoreIds(ctx: Context): Promise<string[]> {
  const rows = ((await must((adminClient() as any).from("store_managers").select("store_id").eq("user_id", ctx.user.id))) as any[]) || [];
  return Array.from(new Set(rows.map((r) => r.store_id as string)));
}

/** 讀取範圍：位置查看／管理權限，或門市名單身分；其餘 403（與舊版 canAccessInventoryLocations 相同）。 */
export async function locationScope(ctx: Context) {
  const canView = dbCan(ctx.permissions, INV.locationView, INV.locationManage);
  const canManage = dbCan(ctx.permissions, INV.locationManage);
  const roster = canView ? false : (await rosterStoreIds(ctx)).length > 0;
  const access = locationAccess({ canView, canManage, roster });
  if (!access.read) throw new GaError(403, "沒有庫存位置查看權限");
  return access;
}

const LOCATION_COLUMNS = "id,code,name,location_type,store_id,is_active,allow_negative_stock,is_default,created_at,updated_at";
const locationSelect = (internal: boolean) => (internal ? LOCATION_COLUMNS + ",description" : LOCATION_COLUMNS);
const PART_COLUMNS = "id,category_id,name,part_code,barcode,brand,model,specification,base_unit,purchase_unit,purchase_to_base_rate,is_active,category:ga_part_categories(id,name,code)";
const SETTING_COLUMNS = "id,location_id,part_id,is_active,safety_stock_qty,reorder_point_qty,maximum_stock_qty,preferred_issue_unit_type,notes,created_at,updated_at";

export async function locationsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [id, sub, subId] = rest;
  const m = request.method;
  if (!id) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return create(ctx, request);
  } else if (!sub) {
    if (m === "GET") return one(ctx, id);
    if (m === "PATCH") return update(ctx, request, id);
    if (m === "DELETE") return remove(ctx, request, id);
  } else if (sub === "impact" && !subId && m === "GET") {
    return impact(ctx, id);
  } else if (sub === "parts") {
    if (!subId) {
      if (m === "GET") return listParts(ctx, id, new URL(request.url));
      if (m === "POST") return addParts(ctx, request, id);
    } else {
      if (m === "PATCH") return updatePart(ctx, request, id, subId);
      if (m === "DELETE") return removePart(ctx, request, id, subId);
    }
  }
  throw new GaError(404, "找不到這個功能");
}

function requireId(value: string, label: string) {
  if (!isUuid(value)) throw new GaError(400, `${label}格式錯誤`);
}
function requireExpected(b: Record<string, any>) {
  if (typeof b.expected_updated_at !== "string" || !b.expected_updated_at) throw new GaError(400, "缺少 expected_updated_at（請重新載入後再操作）");
  if (Number.isNaN(Date.parse(b.expected_updated_at))) throw new GaError(400, "expected_updated_at 格式錯誤");
  return b.expected_updated_at as string;
}
function requireManage(ctx: Context) {
  if (!dbCan(ctx.permissions, INV.locationManage)) throw new GaError(403, "沒有庫存位置管理權限");
}
function reasonOf(b: Record<string, any>, label: string) {
  const reason = String(b.deletion_reason ?? "").trim();
  if (!reason) throw new GaError(400, `請輸入${label}原因`);
  if (reason.length > 200) throw new GaError(400, `${label}原因不可超過 200 字`);
  return reason;
}

export async function storeNames(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map<string, any>();
  const rows = ((await must((adminClient() as any).from("stores").select("id,store_code,store_name,short_name").in("id", unique))) as any[]) || [];
  return new Map(rows.map((s) => [s.id as string, s]));
}

async function counts(ctx: Context, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const r = await rpc(ctx, "ga_ws_inv_location_counts", { p_ids: ids });
  return new Map<string, any>((r.data as any[]).map((c) => [c.id, c]));
}

async function list(ctx: Context, url: URL) {
  const access = await locationScope(ctx);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const sortBy = LOCATION_SORT_COLUMNS.has(p.get("sortBy") || "") ? p.get("sortBy")! : "updated_at";
  const ascending = p.get("sortOrder") === "asc";
  const type = (p.get("locationType") || "").trim().toUpperCase();
  if (type && !(LOCATION_TYPES as readonly string[]).includes(type)) throw new GaError(400, "庫存位置類型錯誤");
  const storeId = (p.get("storeId") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市格式錯誤");
  const search = (p.get("search") || "").trim();
  const active = FILTERS_BOOL(p.get("isActive"));

  const base = (query: any) => {
    let q = query.is("deleted_at", null);
    if (type) q = q.eq("location_type", type);
    if (storeId) q = q.eq("store_id", storeId);
    if (search) q = q.or(orIlike(access.internal ? ["name", "code", "description"] : ["name", "code"], search));
    return q;
  };
  const head = () => (ctx.auth as any).from("ga_inventory_locations").select("id", { count: "exact", head: true });
  let rowsQuery = base((ctx.auth as any).from("ga_inventory_locations").select(locationSelect(access.internal), { count: "exact" }));
  if (active !== null) rowsQuery = rowsQuery.eq("is_active", active);
  const [res, totalAll, totalActive, totalInactive, totalDefault] = await Promise.all([
    rowsQuery.order(sortBy, { ascending }).order("id").range(from, to),
    base(head()),
    base(head()).eq("is_active", true),
    base(head()).eq("is_active", false),
    base(head()).eq("is_active", true).eq("is_default", true),
  ]);
  if (res.error) throw dbError(res.error);
  for (const c of [totalAll, totalActive, totalInactive, totalDefault]) if (c.error) throw dbError(c.error);
  const rows = (res.data as any[]) || [];
  const [stores, countMap] = await Promise.all([storeNames(rows.map((r) => r.store_id)), counts(ctx, rows.map((r) => r.id))]);
  const data = rows.map((r) => {
    const c = countMap.get(r.id) || {};
    return { ...maskLocation(r, access.internal), store: stores.get(r.store_id) || null, parts_count: c.parts ?? 0, stock_items: c.stock_items ?? null, open_transfers: c.open_transfers ?? null, has_history: c.has_history ?? null };
  });
  const total = res.count || 0;
  return respond({
    data,
    total,
    meta: pagingMeta(page, pageSize, total),
    stats: { total: totalAll.count || 0, active: totalActive.count || 0, inactive: totalInactive.count || 0, defaults: totalDefault.count || 0 },
    permissions: { manage: access.manage, internal: access.internal, readOnly: access.readOnly, canAddParts: access.manage && dbCan(ctx.permissions, GA.partView, GA.partManage), canSeeBalances: dbCan(ctx.permissions, INV.balanceView, INV.transactionManage) },
  });
}

async function loadLocation(ctx: Context, id: string, internal: boolean) {
  requireId(id, "庫存位置 id");
  const row = (await must((ctx.auth as any).from("ga_inventory_locations").select(locationSelect(internal)).eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到庫存位置，或不是您可以查看的位置");
  return row;
}

async function one(ctx: Context, id: string) {
  const access = await locationScope(ctx);
  const row = await loadLocation(ctx, id, access.internal);
  const [stores, countMap] = await Promise.all([storeNames([row.store_id]), counts(ctx, [row.id])]);
  const c = countMap.get(row.id) || {};
  return respond({
    data: { ...maskLocation(row, access.internal), store: stores.get(row.store_id) || null, parts_count: c.parts ?? 0, stock_items: c.stock_items ?? null, open_transfers: c.open_transfers ?? null, has_history: c.has_history ?? null },
    permissions: { manage: access.manage, internal: access.internal, readOnly: access.readOnly },
  });
}

async function impact(ctx: Context, id: string) {
  requireManage(ctx);
  requireId(id, "庫存位置 id");
  const r = await rpc(ctx, "ga_ws_inv_location_impact", { p_location_id: id });
  return respond({ data: r.data, summary: { disable: impactSummary(r.data, "disable"), delete: impactSummary(r.data, "delete") } });
}

const CONTROL_KEYS = ["expected_updated_at", "confirm_stock", "replace_default"] as const;
function splitControl(b: Record<string, any>) {
  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(b)) if (!(CONTROL_KEYS as readonly string[]).includes(k)) patch[k] = v;
  return { patch, options: { confirm_stock: b.confirm_stock === true, replace_default: b.replace_default === true } };
}

async function create(ctx: Context, request: NextRequest) {
  requireManage(ctx);
  const b = await body(request);
  const { patch, options } = splitControl(b);
  const payload = validated(() => validateLocationPayload(patch));
  const r = await rpc(ctx, "ga_ws_inv_save_location", { p_location_id: null, p_patch: payload, p_expected_updated_at: null, p_options: options });
  return respond({ data: r.data }, 201);
}

async function update(ctx: Context, request: NextRequest, id: string) {
  requireManage(ctx);
  requireId(id, "庫存位置 id");
  const b = await body(request);
  const expected = requireExpected(b);
  const { patch, options } = splitControl(b);
  const payload = validated(() => validateLocationPayload(patch, { partial: true }));
  const r = await rpc(ctx, "ga_ws_inv_save_location", { p_location_id: id, p_patch: payload, p_expected_updated_at: expected, p_options: options });
  return respond({ data: r.data });
}

async function remove(ctx: Context, request: NextRequest, id: string) {
  requireManage(ctx);
  requireId(id, "庫存位置 id");
  const b = await body(request);
  const expected = requireExpected(b);
  const reason = reasonOf(b, "刪除");
  const r = await rpc(ctx, "ga_ws_inv_delete_location", { p_location_id: id, p_reason: reason, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

// ---------------------------------------------------------------- 位置料件設定
async function listParts(ctx: Context, locationId: string, url: URL) {
  const access = await locationScope(ctx);
  await loadLocation(ctx, locationId, access.internal);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const active = FILTERS_BOOL(p.get("isActive"));
  const search = (p.get("search") || "").trim();
  const partId = (p.get("partId") || "").trim();
  if (partId && !isUuid(partId)) throw new GaError(400, "料件格式錯誤");
  const select = `${SETTING_COLUMNS},part:ga_parts${search ? "!inner" : ""}(${PART_COLUMNS})`;
  // 位置本身已用使用者身分確認看得到（資料庫規則：看得到位置就看得到它的設定）；設定與料件名稱用服務身分讀，
  // 因為只有位置權限（沒有料件查看）的人也要看得到設定的是哪個料件。只取料件的公開欄位，不含內部備註。
  let q = (adminClient() as any).from("ga_inventory_location_parts").select(select, { count: "exact" }).eq("location_id", locationId).is("deleted_at", null);
  if (active !== null) q = q.eq("is_active", active);
  if (partId) q = q.eq("part_id", partId);
  if (search) q = q.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search), { foreignTable: "ga_parts" });
  const res = await q.order("updated_at", { ascending: false }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const rows = (res.data as any[]) || [];
  const canSeeBalances = dbCan(ctx.permissions, INV.balanceView, INV.transactionManage);
  let stock = new Map<string, number>();
  if (canSeeBalances && rows.length) {
    const b = await (ctx.auth as any).from("ga_inventory_balances").select("part_id,quantity_base").eq("location_id", locationId).in("part_id", rows.map((r) => r.part_id));
    if (!b.error) stock = new Map((b.data || []).map((x: any) => [x.part_id as string, Number(x.quantity_base)]));
  }
  const data = rows.map((r) => ({
    ...maskSetting(r, access.internal),
    resolvedPreferredIssueUnit: resolvedIssueUnit(r.preferred_issue_unit_type, r.part),
    ...(canSeeBalances ? { stock_qty: stock.get(r.part_id) ?? 0 } : {}),
  }));
  const total = res.count || 0;
  return respond({ data, total, meta: pagingMeta(page, pageSize, total), permissions: { manage: access.manage, internal: access.internal, canSeeBalances } });
}

async function addParts(ctx: Context, request: NextRequest, locationId: string) {
  requireManage(ctx);
  requireId(locationId, "庫存位置 id");
  if (!dbCan(ctx.permissions, GA.partView, GA.partManage)) throw new GaError(403, "缺少料件查看權限，因此無法新增位置料件設定");
  const b = await body(request);
  const raw = Array.isArray(b.items) ? b.items : b.part_id ? [b] : [];
  const items = validated(() => validateLocationPartItems(raw));
  const r = await rpc(ctx, "ga_ws_inv_add_location_parts", { p_location_id: locationId, p_items: items });
  return respond({ data: r.data, count: (r.data as any[]).length }, 201);
}

async function updatePart(ctx: Context, request: NextRequest, locationId: string, settingId: string) {
  requireManage(ctx);
  requireId(locationId, "庫存位置 id");
  requireId(settingId, "位置料件設定 id");
  const b = await body(request);
  const expected = requireExpected(b);
  const { expected_updated_at: _e, ...fields } = b;
  const patch = validated(() => validateLocationPartPayload(fields));
  await assertSettingBelongs(ctx, locationId, settingId);
  const r = await rpc(ctx, "ga_ws_inv_update_location_part", { p_location_part_id: settingId, p_patch: patch, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

async function removePart(ctx: Context, request: NextRequest, locationId: string, settingId: string) {
  requireManage(ctx);
  requireId(locationId, "庫存位置 id");
  requireId(settingId, "位置料件設定 id");
  const b = await body(request);
  const expected = requireExpected(b);
  const reason = reasonOf(b, "移除");
  await assertSettingBelongs(ctx, locationId, settingId);
  const r = await rpc(ctx, "ga_ws_inv_remove_location_part", { p_location_part_id: settingId, p_reason: reason, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

/** 網址上的位置與設定要對得起來（避免拿 A 位置的網址改 B 位置的設定）。 */
async function assertSettingBelongs(ctx: Context, locationId: string, settingId: string) {
  const row = (await must((ctx.auth as any).from("ga_inventory_location_parts").select("id").eq("id", settingId).eq("location_id", locationId).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到位置料件設定");
}
