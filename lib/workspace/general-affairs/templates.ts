// G04 公司設備型號與設施架型、G05 適用料件對照。
// Q7：既有設備歸戶前逐台顯示「原值 → 新值」，確認後才改；用中的型號／架型只能停用，沒人用才能刪（須填原因）。
// G05：適用料件沿用「整批取代」語意，改為失敗全部回復，被他人同時修改時提示重新載入；型號儲存與適用料件合併成一次請求。
import { NextRequest } from "next/server";
import { findDuplicateEquipmentTemplate, findDuplicateFacilityTemplate } from "../../general-affairs/catalog-identity";
import { validateEquipmentTemplatePayload, validateDeletionReason } from "../../general-affairs/equipment/validation";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging, rehomeDiff } from "./rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

type Kind = "equipment" | "facility";
const kindOf = (v: string | undefined): Kind => {
  if (v === "equipment" || v === "facility") return v;
  throw new GaError(404, "找不到這個功能");
};
const TABLE: Record<Kind, string> = { equipment: "ga_equipment_templates", facility: "ga_facility_templates" };
const TARGET: Record<Kind, string> = { equipment: "EQUIPMENT_TEMPLATE", facility: "FACILITY_TEMPLATE" };
const readCodes = (k: Kind) => (k === "equipment" ? [GA.equipmentTemplateView, GA.equipmentTemplateManage] : [GA.facilityView, GA.facilityManage]);
const manageCode = (k: Kind) => (k === "equipment" ? GA.equipmentTemplateManage : GA.facilityManage);

function requireRead(ctx: Context, k: Kind) {
  if (!dbCan(ctx.permissions, ...readCodes(k))) throw new GaError(403, k === "equipment" ? "沒有設備型號查看權限" : "沒有設施查看權限");
}
function requireManage(ctx: Context, k: Kind) {
  if (!dbCan(ctx.permissions, manageCode(k))) throw new GaError(403, k === "equipment" ? "沒有設備型號管理權限" : "沒有設施管理權限");
}

function text(value: unknown, label: string, required = false) {
  const v = String(value ?? "").trim();
  if (required && !v) throw new Error(`請輸入${label}`);
  return v || null;
}
function dimension(value: unknown, label: string) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label}必須大於 0`);
  return n;
}
/** 設施架型欄位驗證（與舊版 /api/general-affairs/facility-templates 相同規則，body 欄位用 snake_case）。 */
export function facilityTemplatePayload(b: Record<string, any>) {
  const categoryId = text(b.category_id, "設施分類");
  if (categoryId && !isUuid(categoryId)) throw new Error("設施分類格式錯誤");
  return {
    code: String(text(b.code, "架型代碼", true)).toUpperCase(),
    name: text(b.name, "架型名稱", true),
    category_id: categoryId,
    brand: text(b.brand, "品牌"),
    model: text(b.model, "型號"),
    width_cm: dimension(b.width_cm, "寬度"),
    height_cm: dimension(b.height_cm, "高度"),
    depth_cm: dimension(b.depth_cm, "深度"),
    description: text(b.description, "說明"),
    is_active: b.is_active !== false,
  };
}

export async function templatesApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [kindRaw, id, action] = rest;
  const kind = kindOf(kindRaw);
  const m = request.method;
  const url = new URL(request.url);
  if (m === "GET" && !id) return list(ctx, kind, url);
  if (m === "POST" && !id) return save(ctx, kind, request, null);
  if (!id || !isUuid(id)) throw new GaError(id ? 400 : 404, id ? "id 格式錯誤" : "找不到這個功能");
  if (m === "GET" && !action) return one(ctx, kind, id);
  if (m === "PATCH" && !action) return save(ctx, kind, request, id);
  if (m === "DELETE" && !action) return remove(ctx, kind, request, id);
  if (kind === "equipment" && m === "GET" && action === "link-preview") return linkPreview(ctx, id, url);
  if (kind === "equipment" && m === "POST" && action === "link") return link(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

// 使用筆數只回傳數字，不受檢視者的設備權限影響（型號頁要顯示精確的「使用中」筆數，用來判斷能不能刪除）。
async function usageCounts(_ctx: Context, kind: Kind, ids: string[]) {
  const admin: any = adminClient();
  const out = new Map<string, { assets: number; stores: Set<string> }>();
  if (!ids.length) return out;
  const [table, col] = kind === "equipment" ? ["ga_equipment", "template_id"] : ["ga_facilities", "facility_template_id"];
  for (let from = 0; ; from += 1000) {
    const rows = (await must(admin.from(table).select(`id,${col},store_id`).in(col, ids).is("deleted_at", null).order("id").range(from, from + 999))) as any[];
    for (const r of rows || []) {
      const u = out.get(r[col]) || { assets: 0, stores: new Set<string>() };
      u.assets += 1;
      if (r.store_id) u.stores.add(r.store_id);
      out.set(r[col], u);
    }
    if (!rows || rows.length < 1000) break;
  }
  return out;
}

async function list(ctx: Context, kind: Kind, url: URL) {
  requireRead(ctx, kind);
  const { page, pageSize, from, to } = parsePaging(url.searchParams);
  const catTable = kind === "equipment" ? "ga_equipment_categories" : "ga_facility_categories";
  let q = (ctx.auth as any).from(TABLE[kind]).select(`*,category:${catTable}(id,name,code)`, { count: "exact" }).is("deleted_at", null);
  const search = (url.searchParams.get("search") || "").trim();
  if (search) q = q.or(orIlike(kind === "equipment" ? ["name", "brand", "model"] : ["code", "name", "brand", "model"], search));
  const categoryId = url.searchParams.get("categoryId") || "";
  if (categoryId) {
    if (!isUuid(categoryId)) throw new GaError(400, "分類 id 格式錯誤");
    q = q.eq("category_id", categoryId);
  }
  const active = FILTERS_BOOL(url.searchParams.get("active") ?? url.searchParams.get("isActive"));
  if (active !== null) q = q.eq("is_active", active);
  const res = await q.order(kind === "equipment" ? "updated_at" : "code", { ascending: kind !== "equipment" }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const rows = (res.data || []) as any[];
  const usage = await usageCounts(ctx, kind, rows.map((r) => r.id));
  return respond({
    data: rows.map((r) => ({ ...r, asset_count: usage.get(r.id)?.assets || 0, site_count: usage.get(r.id)?.stores.size || 0 })),
    meta: pagingMeta(page, pageSize, res.count || 0),
    permissions: { manage: dbCan(ctx.permissions, manageCode(kind)), manageParts: dbCan(ctx.permissions, GA.partManage) },
  });
}

export async function compatOf(ctx: Context, targetType: string, targetId: string) {
  // 對應到已刪除或停用料件的舊對照不顯示（刪料件時不動對照列，避免觸發器擋下）。
  const rows = (await must(
    (ctx.auth as any)
      .from("ga_part_target_compatibilities")
      .select("id,target_type,target_id,part_id,notes,part:ga_parts!inner(id,name,part_code,brand,model,specification,base_unit,is_active,deleted_at)")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .is("deleted_at", null)
      .is("part.deleted_at", null)
      .order("created_at", { ascending: true }),
  )) as any[];
  const { data: version } = await (ctx.auth as any).rpc("ga_ws_target_compat_version", { p_target_type: targetType, p_target_id: targetId });
  return { parts: rows || [], version: typeof version === "string" ? version : "" };
}

async function one(ctx: Context, kind: Kind, id: string) {
  requireRead(ctx, kind);
  const catTable = kind === "equipment" ? "ga_equipment_categories" : "ga_facility_categories";
  const row = (await must((ctx.auth as any).from(TABLE[kind]).select(`*,category:${catTable}(id,name,code)`).eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到型號或架型");
  const canParts = dbCan(ctx.permissions, GA.partView, GA.partManage);
  const compat = canParts ? await compatOf(ctx, TARGET[kind], id) : null;
  const usage = await usageCounts(ctx, kind, [id]);
  return respond({
    data: { ...row, asset_count: usage.get(id)?.assets || 0, site_count: usage.get(id)?.stores.size || 0 },
    compat,
    permissions: { manage: dbCan(ctx.permissions, manageCode(kind)), manageParts: dbCan(ctx.permissions, GA.partManage) },
  });
}

async function save(ctx: Context, kind: Kind, request: NextRequest, id: string | null) {
  requireManage(ctx, kind);
  const b = await body(request);
  const partIds = Array.isArray(b.part_ids) ? Array.from(new Set(b.part_ids.map((v: unknown) => (isUuid(v) ? v : (() => { throw new GaError(400, "料件 id 格式錯誤"); })())))) : null;
  if (partIds && !dbCan(ctx.permissions, GA.partManage)) throw new GaError(403, "沒有料件管理權限，不能設定適用料件");
  let current: any = null;
  if (id) {
    current = await must((ctx.auth as any).from(TABLE[kind]).select("*").eq("id", id).is("deleted_at", null).maybeSingle());
    if (!current) throw new GaError(404, "找不到型號或架型");
  }
  const patch =
    kind === "equipment"
      ? (validated(() => validateEquipmentTemplatePayload(b, { partial: !!id })) as Record<string, any>)
      : validated(() => facilityTemplatePayload(id ? { ...current, ...b } : b));
  const data = id ? { ...current, ...patch } : patch;
  // 重複偵測（沿用舊版：同品牌型號或名稱就擋下並指出是哪一筆）。
  const rows = ((await must((ctx.auth as any).from(TABLE[kind]).select(kind === "equipment" ? "id,name,brand,model,is_active" : "id,code,name,brand,model,is_active").is("deleted_at", null).limit(5000))) as any[]) || [];
  const dup = kind === "equipment" ? findDuplicateEquipmentTemplate(rows, data, id || undefined) : findDuplicateFacilityTemplate(rows, data, id || undefined);
  if (dup) {
    const label = kind === "equipment" ? `${(dup as any).name}${(dup as any).model ? ` / ${(dup as any).model}` : ""}` : `${(dup as any).code} / ${(dup as any).name}`;
    throw new GaError(409, `${kind === "equipment" ? "公司設備主檔" : "公司設施主檔"}已存在：${label}`, { code: "DUPLICATE", duplicate: dup });
  }
  const r = await rpc(ctx, "ga_ws_save_template", {
    p_kind: kind,
    p_id: id,
    p_data: data,
    p_part_ids: partIds,
    p_expected_updated_at: typeof b.expected_updated_at === "string" ? b.expected_updated_at : null,
    p_expected_compat_version: typeof b.expected_compat_version === "string" ? b.expected_compat_version : null,
  });
  return respond({ data: r.data, compat: r.compat || null }, id ? 200 : 201);
}

async function remove(ctx: Context, kind: Kind, request: NextRequest, id: string) {
  requireManage(ctx, kind);
  const b = await body(request);
  const reason = validated(() => validateDeletionReason(b.deletion_reason));
  const r = await rpc(ctx, "ga_ws_delete_template", { p_kind: kind, p_id: id, p_reason: reason });
  return respond({ data: r.data });
}

// ---- 既有設備歸戶（設備型號專用）
function requireLink(ctx: Context) {
  if (!dbCan(ctx.permissions, GA.equipmentTemplateManage) || !dbCan(ctx.permissions, GA.equipmentManage)) {
    throw new GaError(403, "需要公司設備型號與據點設備管理權限");
  }
}

export async function unlinkedEquipment(ctx: Context, url: URL) {
  requireLink(ctx);
  const { page, pageSize, from, to } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  let q = (ctx.auth as any)
    .from("ga_equipment")
    .select("id,name,asset_code,brand,model,category_id,store_id,updated_at,store:stores(store_code,store_name,short_name)", { count: "exact" })
    .is("template_id", null)
    .is("deleted_at", null);
  const search = (url.searchParams.get("search") || "").trim();
  if (search) q = q.or(orIlike(["name", "asset_code", "brand", "model", "serial_number"], search));
  const storeId = url.searchParams.get("storeId") || "";
  if (storeId) {
    if (!isUuid(storeId)) throw new GaError(400, "據點 id 格式錯誤");
    q = q.eq("store_id", storeId);
  }
  const res = await q.order("asset_code", { ascending: true }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  return respond({ data: res.data || [], meta: pagingMeta(page, pageSize, res.count || 0) });
}

async function linkPreview(ctx: Context, templateId: string, url: URL) {
  requireLink(ctx);
  const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
  if (!ids.length) throw new GaError(400, "請至少選擇一台既有設備");
  if (ids.length > 100) throw new GaError(400, "單次最多整理 100 台設備");
  if (!ids.every(isUuid)) throw new GaError(400, "設備 id 格式錯誤");
  const template = (await must((ctx.auth as any).from("ga_equipment_templates").select("id,category_id,name,brand,model,is_active,updated_at").eq("id", templateId).is("deleted_at", null).maybeSingle())) as any;
  if (!template) throw new GaError(404, "找不到公司設備型號");
  if (!template.is_active) throw new GaError(409, "停用的公司設備型號不可用於設備歸戶");
  const equipment = ((await must((ctx.auth as any).from("ga_equipment").select("id,name,asset_code,brand,model,category_id,template_id,updated_at,store:stores(store_code,short_name,store_name)").in("id", ids).is("deleted_at", null))) as any[]) || [];
  const cats = new Map<string, string>();
  const catIds = Array.from(new Set([template.category_id, ...equipment.map((e) => e.category_id)].filter(Boolean)));
  if (catIds.length) {
    const c = ((await must((ctx.auth as any).from("ga_equipment_categories").select("id,name").in("id", catIds))) as any[]) || [];
    for (const r of c) cats.set(r.id, r.name);
  }
  const label = (id: string | null) => (id ? cats.get(id) || id : null);
  return respond({
    template,
    items: equipment.map((e) => ({
      id: e.id,
      asset_code: e.asset_code,
      store: e.store,
      updated_at: e.updated_at,
      already_linked: !!e.template_id,
      diff: rehomeDiff(e, template).map((d) => (d.field === "category_id" ? { ...d, from: label(d.from as string), to: label(d.to as string), changed: d.from !== d.to } : d)),
    })),
    missing: ids.filter((i) => !equipment.some((e) => e.id === i)),
    irreversible: true,
  });
}

async function link(ctx: Context, request: NextRequest, templateId: string) {
  requireLink(ctx);
  const b = await body(request);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.every((i: any) => isUuid(i?.id) && typeof i?.updated_at === "string")) throw new GaError(400, "歸戶清單格式錯誤，請重新預覽");
  if (typeof b.template_updated_at !== "string" || !b.template_updated_at) throw new GaError(400, "缺少型號版本，請重新預覽");
  if (b.confirmed !== true) throw new GaError(400, "請先確認覆蓋內容（歸戶後不能還原）");
  const r = await rpc(ctx, "ga_ws_link_equipment_to_template", { p_template_id: templateId, p_items: items, p_template_updated_at: b.template_updated_at });
  return respond({ data: r.data });
}

// ---- G05 適用料件對照（以對象為單位）
const TARGET_TYPES = ["EQUIPMENT", "EQUIPMENT_TEMPLATE", "FACILITY", "FACILITY_TEMPLATE"];
export async function compatApi(ctx: Context, request: NextRequest) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (!dbCan(ctx.permissions, GA.partView, GA.partManage)) throw new GaError(403, "沒有料件查看權限");
    const targetType = (url.searchParams.get("targetType") || "").toUpperCase();
    const targetId = url.searchParams.get("targetId") || "";
    if (!TARGET_TYPES.includes(targetType)) throw new GaError(400, "相容性對象類型錯誤");
    if (!isUuid(targetId)) throw new GaError(400, "對象 id 格式錯誤");
    return respond({ data: await compatOf(ctx, targetType, targetId) });
  }
  if (request.method === "PUT") {
    if (!dbCan(ctx.permissions, GA.partManage)) throw new GaError(403, "沒有料件管理權限");
    const b = await body(request);
    const targetType = String(b.targetType || "").toUpperCase();
    if (!TARGET_TYPES.includes(targetType)) throw new GaError(400, "相容性對象類型錯誤");
    if (!isUuid(b.targetId)) throw new GaError(400, "對象 id 格式錯誤");
    if (!Array.isArray(b.partIds) || !b.partIds.every(isUuid)) throw new GaError(400, "料件清單格式錯誤");
    const r = await rpc(ctx, "ga_ws_replace_target_compat", {
      p_target_type: targetType,
      p_target_id: b.targetId,
      p_part_ids: b.partIds,
      p_expected_version: typeof b.expectedVersion === "string" ? b.expectedVersion : null,
    });
    return respond({ data: r.data });
  }
  throw new GaError(404, "找不到這個功能");
}
