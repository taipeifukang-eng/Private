// G02 三種分類樹 API（設備、設施、料件共用）。
// Q4：停用前查精確筆數、底下還有啟用中的項目或子分類不可停用；新增「刪除分類」（限完全沒有項目與子分類）。
// 舊版「只算前 100 筆」「分類全部一次載入」改為搜尋、分頁與精確筆數；搜尋輸入逗號、括號不再壞掉。
import { NextRequest } from "next/server";
import { CATEGORY_CONFIGS } from "../../general-affairs/categories/access";
import { validateCategoryId, validateCategoryPayload } from "../../general-affairs/categories/validation";
import { categoryPermissions, isCategoryType, type CategoryType } from "./access";
import { categoryPath, categoryUsageText, isUuid, orIlike, pagingMeta, parsePaging, FILTERS_BOOL } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

const kindOf = (type: CategoryType) => type; // ga_category_kind 列舉值與 type 相同

function typeOf(value: unknown): CategoryType {
  if (!isCategoryType(value)) throw new GaError(400, "分類類型錯誤");
  return value;
}

async function ancestorMap(ctx: Context, table: string) {
  const map = new Map<string, { name: string; parent_id: string | null }>();
  for (let from = 0; ; from += 1000) {
    const rows = (await must((ctx.auth as any).from(table).select("id,name,parent_id").is("deleted_at", null).order("id").range(from, from + 999))) as any[];
    for (const r of rows || []) map.set(r.id, { name: r.name, parent_id: r.parent_id });
    if (!rows || rows.length < 1000) break;
  }
  return map;
}

async function childCounts(ctx: Context, table: string, ids: string[]) {
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  for (let from = 0; ; from += 1000) {
    const rows = (await must((ctx.auth as any).from(table).select("id,parent_id").in("parent_id", ids).is("deleted_at", null).order("id").range(from, from + 999))) as any[];
    for (const r of rows || []) counts.set(r.parent_id, (counts.get(r.parent_id) || 0) + 1);
    if (!rows || rows.length < 1000) break;
  }
  return counts;
}

export async function categoriesApi(ctx: Context, request: NextRequest, rest: string[]) {
  const url = new URL(request.url);
  const method = request.method;
  const [id, action] = rest;

  if (method === "GET" && !id) return list(ctx, url);
  if (method === "GET" && id && !action) return one(ctx, url, id);
  if (method === "GET" && id && action === "usage") return usage(ctx, url, id);
  if (method === "POST" && !id) return create(ctx, request);
  if (method === "PATCH" && id && !action) return update(ctx, request, id);
  if (method === "POST" && id && action === "active") return setActive(ctx, request, id);
  if (method === "DELETE" && id && !action) return remove(ctx, url, id);
  throw new GaError(404, "找不到這個功能");
}

async function list(ctx: Context, url: URL) {
  const type = typeOf(url.searchParams.get("type"));
  const perm = categoryPermissions(type, ctx.permissions);
  if (!perm.read) throw new GaError(403, "沒有分類查看權限");
  const config = CATEGORY_CONFIGS[type];
  const { page, pageSize, from, to } = parsePaging(url.searchParams, { pageSize: 50, max: 500 });
  const search = (url.searchParams.get("search") || "").trim();
  const parentId = url.searchParams.get("parentId") || "";
  const active = FILTERS_BOOL(url.searchParams.get("active"));
  let query = (ctx.auth as any).from(config.table).select("*", { count: "exact" }).is("deleted_at", null);
  if (search) query = query.or(orIlike(["name", "code", "description"], search));
  // 沒有搜尋時逐層瀏覽：預設只列最上層；指定 parentId 列該層的子分類。有搜尋時跨層搜尋，每筆帶完整路徑。
  else if (parentId) {
    if (!isUuid(parentId)) throw new GaError(400, "父分類 id 格式錯誤");
    query = query.eq("parent_id", parentId);
  } else if (url.searchParams.get("all") !== "1") query = query.is("parent_id", null);
  if (active !== null) query = query.eq("is_active", active);
  const res = await query.order("sort_order", { ascending: true }).order("name", { ascending: true }).range(from, to);
  if (res.error) throw dbError(res.error);
  const rows = (res.data || []) as any[];
  const [map, counts] = await Promise.all([ancestorMap(ctx, config.table), childCounts(ctx, config.table, rows.map((r) => r.id))]);
  return respond({
    data: rows.map((r) => ({ ...r, path: categoryPath(r.id, map), child_count: counts.get(r.id) || 0 })),
    meta: pagingMeta(page, pageSize, res.count || 0),
    permissions: { manage: perm.manage },
  });
}

async function one(ctx: Context, url: URL, rawId: string) {
  const type = typeOf(url.searchParams.get("type"));
  const perm = categoryPermissions(type, ctx.permissions);
  if (!perm.read) throw new GaError(403, "沒有分類查看權限");
  const id = validated(() => validateCategoryId(rawId));
  const config = CATEGORY_CONFIGS[type];
  const row = (await must((ctx.auth as any).from(config.table).select("*").eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到分類");
  const map = await ancestorMap(ctx, config.table);
  return respond({ data: { ...row, path: categoryPath(row.id, map) } });
}

async function usage(ctx: Context, url: URL, rawId: string) {
  const type = typeOf(url.searchParams.get("type"));
  if (!categoryPermissions(type, ctx.permissions).read) throw new GaError(403, "沒有分類查看權限");
  const id = validated(() => validateCategoryId(rawId));
  const r = await rpc(ctx, "ga_ws_category_usage", { p_kind: kindOf(type), p_category_id: id });
  return respond({
    data: r.data,
    text: { disable: categoryUsageText(r.data, "disable"), delete: categoryUsageText(r.data, "delete") },
  });
}

async function create(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const type = typeOf(b.type);
  if (!categoryPermissions(type, ctx.permissions).manage) throw new GaError(403, "沒有分類管理權限");
  const config = CATEGORY_CONFIGS[type];
  const payload = validated(() => validateCategoryPayload(config, b)) as Record<string, unknown>;
  if (payload.parent_id) await assertParentUsable(ctx, config.table, String(payload.parent_id));
  const row = await must((ctx.auth as any).from(config.table).insert({ ...payload, created_by: ctx.user.id, updated_by: ctx.user.id }).select("*").single());
  return respond({ data: row }, 201);
}

async function assertParentUsable(ctx: Context, table: string, parentId: string) {
  const parent = (await must((ctx.auth as any).from(table).select("id,is_active").eq("id", parentId).is("deleted_at", null).maybeSingle())) as any;
  if (!parent) throw new GaError(400, "找不到父分類");
}

async function update(ctx: Context, request: NextRequest, rawId: string) {
  const b = await body(request);
  const type = typeOf(b.type);
  if (!categoryPermissions(type, ctx.permissions).manage) throw new GaError(403, "沒有分類管理權限");
  const config = CATEGORY_CONFIGS[type];
  const id = validated(() => validateCategoryId(rawId));
  const patch = validated(() => validateCategoryPayload(config, b, { partial: true })) as Record<string, unknown>;
  // 停用／啟用一律走 /active（要查底下使用情形）；一般編輯不接受 is_active，避免繞過 Q4 的檢查。
  delete patch.is_active;
  if (patch.parent_id === id) throw new GaError(400, "不能把分類放到自己底下");
  let query = (ctx.auth as any).from(config.table).update({ ...patch, updated_by: ctx.user.id }).eq("id", id).is("deleted_at", null);
  if (typeof b.expected_updated_at === "string") query = query.eq("updated_at", b.expected_updated_at);
  const row = (await must(query.select("*").maybeSingle())) as any;
  if (!row) {
    const exists = (await must((ctx.auth as any).from(config.table).select("id").eq("id", id).is("deleted_at", null).maybeSingle())) as any;
    if (!exists) throw new GaError(404, "找不到分類");
    throw new GaError(409, "這個分類已被其他人修改，請重新載入後再儲存", { code: "STALE" });
  }
  return respond({ data: row });
}

async function setActive(ctx: Context, request: NextRequest, rawId: string) {
  const b = await body(request);
  const type = typeOf(b.type);
  if (!categoryPermissions(type, ctx.permissions).manage) throw new GaError(403, "沒有分類管理權限");
  if (typeof b.active !== "boolean") throw new GaError(400, "請指定要啟用或停用");
  const id = validated(() => validateCategoryId(rawId));
  const r = await rpc(ctx, "ga_ws_set_category_active", {
    p_kind: kindOf(type),
    p_category_id: id,
    p_active: b.active,
    p_expected_updated_at: typeof b.expected_updated_at === "string" ? b.expected_updated_at : null,
  });
  return respond({ data: r.data });
}

async function remove(ctx: Context, url: URL, rawId: string) {
  const type = typeOf(url.searchParams.get("type"));
  if (!categoryPermissions(type, ctx.permissions).manage) throw new GaError(403, "沒有分類管理權限");
  const id = validated(() => validateCategoryId(rawId));
  const r = await rpc(ctx, "ga_ws_delete_category", { p_kind: kindOf(type), p_category_id: id });
  return respond({ data: r.data });
}
