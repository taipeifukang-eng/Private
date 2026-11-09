// G03 料件主檔 API。
// Q5：只有店長身分（沒有料件查看／管理權限）時，料件看不到內部備註。
// Q6（選 b）：補編輯、停用、刪除。刪除須填原因，且無庫存、無未結單；有庫存或有過庫存交易後單位欄位鎖定；
//   新增遇到「品牌＋型號＋規格」相同的既有料件時，先回傳既有料件，使用者確認後（confirm_duplicate）才建立。
import { NextRequest } from "next/server";
import { validateDeletionReason, validatePartPayload } from "../../general-affairs/parts/validation";
import { dbCan, GA } from "./access";
import {
  changedUnitFields, duplicateKey, FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging,
  partColumns, PART_SORT_COLUMNS, stripNotes, UNIT_LOCK_MESSAGE, partDeleteBlockText,
} from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

async function catalogAccess(ctx: Context) {
  const privileged = dbCan(ctx.permissions, GA.partView, GA.partManage);
  if (privileged) return { canSeeNotes: true, manage: dbCan(ctx.permissions, GA.partManage) };
  // 店長（含代理店長）：舊版 canAccessPartCatalog；改為看不到內部備註（Q5）。
  const { data } = await (ctx.auth as any).rpc("current_user_is_store_manager");
  if (data === true) return { canSeeNotes: false, manage: false };
  throw new GaError(403, "沒有料件查看權限");
}

export async function partsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const method = request.method;
  const [id, action] = rest;
  if (method === "GET" && !id) return list(ctx, new URL(request.url));
  if (method === "GET" && id && !action) return one(ctx, id);
  if (method === "GET" && id && action === "usage") return usage(ctx, id);
  if (method === "POST" && !id) return create(ctx, request);
  if (method === "PATCH" && id && !action) return update(ctx, request, id);
  if (method === "DELETE" && id && !action) return remove(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

const SELECT_CATEGORY = ",category:ga_part_categories(id,name,code)";

async function list(ctx: Context, url: URL) {
  const access = await catalogAccess(ctx);
  const { page, pageSize, from, to } = parsePaging(url.searchParams);
  const sortBy = PART_SORT_COLUMNS.has(url.searchParams.get("sortBy") || "") ? url.searchParams.get("sortBy")! : "updated_at";
  const ascending = url.searchParams.get("sortOrder") === "asc";
  let query = (ctx.auth as any).from("ga_parts").select(partColumns(access.canSeeNotes) + SELECT_CATEGORY, { count: "exact" }).is("deleted_at", null);
  const search = (url.searchParams.get("search") || "").trim();
  if (search) query = query.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search));
  const categoryId = url.searchParams.get("categoryId") || "";
  if (categoryId) {
    if (!isUuid(categoryId)) throw new GaError(400, "分類 id 格式錯誤");
    query = query.eq("category_id", categoryId);
  }
  const brand = (url.searchParams.get("brand") || "").trim();
  if (brand) query = query.ilike("brand", brand.replace(/[%_]/g, "\\$&"));
  const active = FILTERS_BOOL(url.searchParams.get("isActive"));
  if (active !== null) query = query.eq("is_active", active);
  const res = await query.order(sortBy, { ascending }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  return respond({
    data: res.data || [],
    meta: pagingMeta(page, pageSize, res.count || 0),
    permissions: { manage: access.manage, seeNotes: access.canSeeNotes },
  });
}

async function duplicatesOf(ctx: Context, part: Record<string, any>, excludeId?: string) {
  const key = duplicateKey(part);
  if (!key) return [];
  let q = (ctx.auth as any)
    .from("ga_parts")
    .select("id,name,part_code,brand,model,specification,base_unit,is_active")
    .eq("brand", key.brand)
    .eq("model", key.model)
    .eq("specification", key.specification)
    .is("deleted_at", null)
    .limit(5);
  if (excludeId) q = q.neq("id", excludeId);
  return ((await must(q)) as any[]) || [];
}

async function one(ctx: Context, rawId: string) {
  const access = await catalogAccess(ctx);
  if (!isUuid(rawId)) throw new GaError(400, "料件 id 格式錯誤");
  const row = (await must((ctx.auth as any).from("ga_parts").select(partColumns(access.canSeeNotes) + SELECT_CATEGORY).eq("id", rawId).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到料件");
  const warnings = access.manage ? await duplicatesOf(ctx, row, row.id) : [];
  return respond({ data: stripNotes(row, access.canSeeNotes), duplicates: warnings, permissions: { manage: access.manage, seeNotes: access.canSeeNotes } });
}

async function usage(ctx: Context, rawId: string) {
  if (!dbCan(ctx.permissions, GA.partView, GA.partManage)) throw new GaError(403, "沒有料件查看權限");
  if (!isUuid(rawId)) throw new GaError(400, "料件 id 格式錯誤");
  const r = await rpc(ctx, "ga_ws_part_usage", { p_part_id: rawId });
  return respond({ data: r.data, deleteBlock: partDeleteBlockText(r.data) });
}

async function create(ctx: Context, request: NextRequest) {
  if (!dbCan(ctx.permissions, GA.partManage)) throw new GaError(403, "沒有料件管理權限");
  const b = await body(request);
  const payload = validated(() => validatePartPayload(b)) as Record<string, any>;
  const duplicates = await duplicatesOf(ctx, payload);
  if (duplicates.length && b.confirm_duplicate !== true) {
    throw new GaError(409, "已有品牌、型號與規格相同的料件，請確認是否仍要新增", { code: "DUPLICATE", duplicates });
  }
  const row = await must((ctx.auth as any).from("ga_parts").insert(payload).select("*").single());
  return respond({ data: row, duplicates }, 201);
}

async function update(ctx: Context, request: NextRequest, rawId: string) {
  if (!dbCan(ctx.permissions, GA.partManage)) throw new GaError(403, "沒有料件管理權限");
  if (!isUuid(rawId)) throw new GaError(400, "料件 id 格式錯誤");
  const b = await body(request);
  const patch = validated(() => validatePartPayload(b, { partial: true })) as Record<string, any>;
  const current = (await must((ctx.auth as any).from("ga_parts").select("*").eq("id", rawId).is("deleted_at", null).maybeSingle())) as any;
  if (!current) throw new GaError(404, "找不到料件");
  const unitChanges = changedUnitFields(current, patch);
  if (unitChanges.length) {
    const u = await rpc(ctx, "ga_ws_part_usage", { p_part_id: rawId });
    if (u.data.unit_locked) throw new GaError(409, UNIT_LOCK_MESSAGE, { code: "UNIT_LOCKED", fields: unitChanges, usage: u.data });
  }
  let query = (ctx.auth as any).from("ga_parts").update(patch).eq("id", rawId).is("deleted_at", null);
  if (typeof b.expected_updated_at === "string") query = query.eq("updated_at", b.expected_updated_at);
  const row = (await must(query.select("*").maybeSingle())) as any;
  if (!row) throw new GaError(409, "這個料件已被其他人修改，請重新載入後再儲存", { code: "STALE" });
  return respond({ data: row, duplicates: await duplicatesOf(ctx, row, rawId) });
}

async function remove(ctx: Context, request: NextRequest, rawId: string) {
  if (!dbCan(ctx.permissions, GA.partManage)) throw new GaError(403, "沒有料件管理權限");
  if (!isUuid(rawId)) throw new GaError(400, "料件 id 格式錯誤");
  const b = await body(request);
  const reason = validated(() => validateDeletionReason(b.deletion_reason));
  const r = await rpc(ctx, "ga_ws_delete_part", { p_part_id: rawId, p_reason: reason });
  return respond({ data: r.data });
}
