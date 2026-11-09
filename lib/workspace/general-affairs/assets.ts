// G06／G08 設備與設施主檔 API（兩者同結構，用 kind 區分：equipment／facilities）。
// Q5：只有店長身分（沒有設備／設施查看或管理權限）時只看基本欄位，由伺服端挑欄位（資料庫端就不取敏感欄位）。
// Q8：報廢／退役後總務可「恢復使用並重新啟用 QR」，token 不變。Q10：有未結案單禁止刪除並顯示張數；編輯不能改所屬門市，另有「更正所屬門市」。
// 編輯只更新有改的欄位（specs 合併，修正舊版整包清空「購買來源供應商」「保固申請方式」）；保固以台北時間到期日當天結束才過期。
// 所有寫入以使用者登入身分執行（RLS 與資料庫函式判斷權限）；多步驟寫入在資料庫函式內全成或全不變。
import { NextRequest } from "next/server";
import { validateDeletionReason as equipmentReason, validateEquipmentPayload } from "../../general-affairs/equipment/validation";
import { validateDeletionReason as facilityReason, validateFacilityPayload } from "../../general-affairs/facilities/validation";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import {
  ASSET_TABLE, ASSET_TYPE, basicSelect, diffAssetPatch, LABEL_REPRINT_MESSAGE, pickAssetFields, RESTORE_REQUIRED_MESSAGE, STORE_ID_EDIT_MESSAGE, TERMINAL_STATUS,
  warrantyInput, warrantyRanges, warrantyState, WARRANTY_FILTERS, type AssetKind, type AssetLevel, type WarrantyFilter,
} from "./asset-fields";
import { isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { SIGNED_URL_SECONDS } from "./upload-rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

const BUCKET = "general-affairs-attachments";
const QR = "qr_token,qr_token_issued_at,qr_token_revoked_at";
const ONBOARDING = "onboarding_status,onboarding_review_note,onboarding_reviewed_at,onboarding_reviewed_by,onboarding_requires_primary_photo,onboarding_requires_label_photo";
const FULL_SELECT: Record<AssetKind, string> = {
  equipment: `id,store_id,category_id,template_id,name,asset_code,barcode,brand,model,serial_number,status,criticality,area,location_detail,purpose,installed_at,purchased_at,activated_at,purchase_amount,specs,tags,notes,has_warranty,warranty_end_date,image_path,created_at,updated_at,${ONBOARDING},${QR}`,
  facilities: `id,store_id,category_id,facility_template_id,name,facility_code,status,criticality,area,location_detail,quantity,unit,is_fixed_asset,installed_at,purchased_at,purchase_unit_amount,purchase_amount,last_renovated_at,description,specs,tags,image_path,notes,created_at,updated_at,${ONBOARDING},${QR}`,
};
const BASIC_SELECT: Record<AssetKind, string> = {
  equipment: basicSelect("equipment"),
  facilities: basicSelect("facilities"),
};
const CATEGORY_TABLE: Record<AssetKind, string> = { equipment: "ga_equipment_categories", facilities: "ga_facility_categories" };
const TEMPLATE_TABLE: Record<AssetKind, { table: string; column: string; select: string }> = {
  equipment: { table: "ga_equipment_templates", column: "template_id", select: "id,name,brand,model" },
  facilities: { table: "ga_facility_templates", column: "facility_template_id", select: "id,code,name,brand,model" },
};
const CODE_COLUMN: Record<AssetKind, string> = { equipment: "asset_code", facilities: "facility_code" };
/** 詳情、新增、編輯回傳整列（與舊版相同）；清單用明確欄位。 */
const SORT_COLUMNS: Record<AssetKind, Set<string>> = {
  equipment: new Set(["name", "asset_code", "status", "updated_at", "created_at", "warranty_end_date"]),
  facilities: new Set(["name", "facility_code", "status", "area", "updated_at", "created_at", "installed_at", "last_renovated_at", "warranty_end_date"]),
};
const ATTENTION_STATUS: Record<AssetKind, string[]> = {
  equipment: ["TEMPORARILY_STOPPED", "RETIRED", "SCRAPPED"],
  facilities: ["PARTIALLY_DAMAGED", "OUT_OF_SERVICE", "UNDER_RENOVATION", "RETIRED"],
};
const PERMS: Record<AssetKind, { view: string; manage: string }> = {
  equipment: { view: GA.equipmentView, manage: GA.equipmentManage },
  facilities: { view: GA.facilityView, manage: GA.facilityManage },
};
const NOUN: Record<AssetKind, string> = { equipment: "設備", facilities: "設施" };

export type AssetAccess = { level: AssetLevel; manage: boolean; storeIds: string[] | null };

/** 取得登入者對這類資產的存取層級。有查看或管理權限看全部欄位；只有店長名單身分看自己門市的基本欄位；其餘 403。 */
export async function assetAccess(ctx: Context, kind: AssetKind): Promise<AssetAccess> {
  const manage = dbCan(ctx.permissions, PERMS[kind].manage);
  if (manage || dbCan(ctx.permissions, PERMS[kind].view)) return { level: "full", manage, storeIds: null };
  const mine = ((await must(adminClient().from("store_managers").select("store_id").eq("user_id", ctx.user.id))) as any[]) || [];
  const storeIds = Array.from(new Set(mine.map((r) => r.store_id as string)));
  if (!storeIds.length) throw new GaError(403, `沒有${NOUN[kind]}查看權限`);
  return { level: "basic", manage: false, storeIds };
}

function requireManage(ctx: Context, kind: AssetKind) {
  if (!dbCan(ctx.permissions, PERMS[kind].manage)) throw new GaError(403, `沒有${NOUN[kind]}管理權限`);
}

function requireUuid(value: unknown, label: string) {
  if (!isUuid(value)) throw new GaError(400, `${label} 格式錯誤`);
  return value as string;
}

export function equipmentApi(ctx: Context, request: NextRequest, rest: string[]) {
  return assetApi(ctx, request, rest, "equipment");
}
export function facilitiesApi(ctx: Context, request: NextRequest, rest: string[]) {
  return assetApi(ctx, request, rest, "facilities");
}

async function assetApi(ctx: Context, request: NextRequest, rest: string[], kind: AssetKind) {
  const m = request.method;
  const [id, action] = rest;
  if (m === "GET" && !id) return list(ctx, kind, new URL(request.url));
  if (m === "POST" && !id) return create(ctx, kind, request);
  if (id && !action) {
    if (m === "GET") return one(ctx, kind, id);
    if (m === "PATCH") return update(ctx, kind, request, id);
    if (m === "DELETE") return remove(ctx, kind, request, id);
  }
  if (id && action === "open-orders" && m === "GET") return openOrders(ctx, kind, id);
  if (id && action === "correct-store" && m === "POST") return correctStore(ctx, kind, request, id);
  if (id && action === "restore" && m === "POST") return restore(ctx, kind, request, id);
  if (id && action === "events" && m === "GET") return events(ctx, kind, id);
  throw new GaError(404, "找不到這個功能");
}

// ---------------------------------------------------------------------------------------- 關聯資料與縮圖
async function relations(kind: AssetKind, rows: any[], level: AssetLevel) {
  if (!rows.length) return;
  const admin: any = adminClient();
  const storeIds = Array.from(new Set(rows.map((r) => r.store_id).filter(Boolean)));
  const catIds = Array.from(new Set(rows.map((r) => r.category_id).filter(Boolean)));
  const tpl = TEMPLATE_TABLE[kind];
  const tplIds = level === "full" ? Array.from(new Set(rows.map((r) => r[tpl.column]).filter(Boolean))) : [];
  const [stores, cats, tpls] = await Promise.all([
    storeIds.length ? must(admin.from("stores").select("id,store_code,store_name,short_name").in("id", storeIds)) : [],
    catIds.length ? must(admin.from(CATEGORY_TABLE[kind]).select("id,name,code").in("id", catIds)) : [],
    tplIds.length ? must(admin.from(tpl.table).select(tpl.select).in("id", tplIds)) : [],
  ]);
  const byId = (list: any) => new Map(((list as any[]) || []).map((r) => [r.id, r]));
  const s = byId(stores), c = byId(cats), t = byId(tpls);
  for (const r of rows) {
    r.store = s.get(r.store_id) || null;
    r.category = c.get(r.category_id) || null;
    if (level === "full") r.template = t.get(r[tpl.column]) || null;
  }
}

/** 主圖縮圖：每次重簽（Q3 沿用）。已通過列表範圍檢查的資產才會到這裡。 */
async function thumbnails(kind: AssetKind, rows: any[]) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  const admin: any = adminClient();
  const res = await admin
    .from("ga_resource_attachments")
    .select("resource_id,storage_path,content_type,is_primary,purpose,uploaded_at")
    .eq("resource_type", ASSET_TYPE[kind]).in("resource_id", ids).eq("purpose", "PRIMARY_IMAGE").is("deleted_at", null)
    .like("content_type", "image/%").order("is_primary", { ascending: false }).order("uploaded_at", { ascending: false });
  if (res.error) return;
  const first = new Map<string, string>();
  for (const a of res.data || []) if (!first.has(a.resource_id)) first.set(a.resource_id, a.storage_path);
  const paths = Array.from(new Set(first.values()));
  const signed = new Map<string, string>();
  if (paths.length) {
    const s = await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
    (s.data || []).forEach((item: any, i: number) => item?.signedUrl && signed.set(paths[i], item.signedUrl));
  }
  for (const r of rows) r.thumbnail_url = signed.get(first.get(r.id) || "") || null;
}

/** 保固頁用：這一頁資產的保固文件（發票、單據、圖片、PDF），簽名網址每次重簽（Q3）。已通過列表範圍檢查的資產才會到這裡。 */
async function warrantyDocuments(kind: AssetKind, rows: any[]) {
  const ids = rows.map((r) => r.id);
  for (const r of rows) r.warranty_documents = [];
  if (!ids.length) return;
  const admin: any = adminClient();
  const res = await admin
    .from("ga_resource_attachments")
    .select("id,resource_id,storage_path,file_name,content_type,uploaded_at")
    .eq("resource_type", ASSET_TYPE[kind]).in("resource_id", ids).eq("purpose", "WARRANTY_DOCUMENT").is("deleted_at", null)
    .order("uploaded_at", { ascending: false });
  if (res.error) return;
  const paths = Array.from(new Set<string>((res.data || []).map((a: any) => a.storage_path)));
  const signed = new Map<string, string>();
  if (paths.length) {
    const s = await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
    (s.data || []).forEach((item: any, i: number) => item?.signedUrl && signed.set(paths[i], item.signedUrl));
  }
  const byAsset = new Map<string, any[]>();
  for (const a of res.data || []) byAsset.set(a.resource_id, [...(byAsset.get(a.resource_id) || []), { id: a.id, file_name: a.file_name, content_type: a.content_type, signed_url: signed.get(a.storage_path) || null }]);
  for (const r of rows) r.warranty_documents = byAsset.get(r.id) || [];
}

/** 分類含子孫的 id（搜尋與篩選用）。 */
async function categoryWithDescendants(ctx: Context, kind: AssetKind, id: string) {
  const rows = ((await must((ctx.auth as any).from(CATEGORY_TABLE[kind]).select("id,parent_id").is("deleted_at", null).range(0, 4999))) as any[]) || [];
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.parent_id) children.set(r.parent_id, [...(children.get(r.parent_id) || []), r.id]);
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const c of children.get(stack.pop()!) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
  return Array.from(out);
}

// ---------------------------------------------------------------------------------------- 清單
type Filters = {
  search: string; storeId: string; templateId: string; categoryIds: string[] | null; status: string; onboarding: string; warranty: WarrantyFilter | ""; area: string; templateUnlinked: boolean;
};

function parseFilters(p: URLSearchParams, kind: AssetKind): Filters {
  const storeId = (p.get("storeId") || "").trim();
  const templateId = (p.get("templateId") || "").trim();
  const warranty = (p.get("warranty") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市 id 格式錯誤");
  if (templateId && !isUuid(templateId)) throw new GaError(400, "型號 id 格式錯誤");
  if (warranty && !(WARRANTY_FILTERS as readonly string[]).includes(warranty)) throw new GaError(400, "保固篩選條件錯誤");
  return {
    search: (p.get("search") || "").trim(), storeId, templateId, categoryIds: null, status: (p.get("status") || "").trim(), warranty: warranty as WarrantyFilter | "",
    onboarding: (p.get("onboardingStatus") || "").trim(), area: (p.get("area") || "").trim(), templateUnlinked: p.get("templateStatus") === "unlinked" && kind === "equipment",
  };
}

const SPEC_HAS = "specs->>facility_has_warranty";
const SPEC_END = "specs->>facility_warranty_end_date";

/** 保固條件：設備用欄位，設施用 specs 內的鍵；以台北今天為基準。 */
function applyWarranty(q: any, kind: AssetKind, f: WarrantyFilter, range: { today: string; expiringEnd: string }) {
  const has = kind === "equipment" ? "has_warranty" : SPEC_HAS;
  const end = kind === "equipment" ? "warranty_end_date" : SPEC_END;
  const yes = kind === "equipment" ? true : "true";
  if (f === "none") return kind === "equipment" ? q.eq(has, false) : q.or(`${SPEC_HAS}.is.null,${SPEC_HAS}.neq.true`);
  q = q.eq(has, yes);
  if (f === "missing") return q.is(end, null);
  if (f === "expired") return q.lt(end, range.today);
  if (f === "expiring") return q.gte(end, range.today).lte(end, range.expiringEnd);
  return q.gt(end, range.expiringEnd);
}

function applyFilters(q: any, kind: AssetKind, level: AssetLevel, access: AssetAccess, f: Filters, range: { today: string; expiringEnd: string }) {
  q = q.is("deleted_at", null);
  if (access.storeIds) q = q.in("store_id", access.storeIds);
  if (f.search) {
    // 基本層級只能用名稱與編號搜尋，避免用序號、品牌型號探測看不到的欄位。
    const cols = level === "basic" ? ["name", CODE_COLUMN[kind]] : kind === "equipment" ? ["name", "asset_code", "barcode", "brand", "model", "serial_number"] : ["name", "facility_code", "area", "location_detail"];
    q = q.or(orIlike(cols, f.search));
  }
  if (f.storeId) q = q.eq("store_id", f.storeId);
  if (f.templateId && level === "full") q = q.eq(TEMPLATE_TABLE[kind].column, f.templateId);
  if (f.templateUnlinked && level === "full") q = q.is("template_id", null);
  if (f.categoryIds) q = q.in("category_id", f.categoryIds);
  if (f.status) q = q.eq("status", f.status);
  if (f.onboarding) q = q.eq("onboarding_status", f.onboarding);
  if (f.area) q = q.eq("area", f.area);
  if (f.warranty) q = applyWarranty(q, kind, f.warranty, range);
  return q;
}

async function list(ctx: Context, kind: AssetKind, url: URL) {
  const access = await assetAccess(ctx, kind);
  const { page, pageSize, from, to } = parsePaging(url.searchParams);
  const f = parseFilters(url.searchParams, kind);
  const categoryId = (url.searchParams.get("categoryId") || "").trim();
  if (categoryId) {
    requireUuid(categoryId, "分類 id");
    f.categoryIds = await categoryWithDescendants(ctx, kind, categoryId);
  }
  const sortBy = SORT_COLUMNS[kind].has(url.searchParams.get("sortBy") || "") ? url.searchParams.get("sortBy")! : "updated_at";
  const ascending = (url.searchParams.get("sortDir") || url.searchParams.get("sortOrder")) === "asc";
  const range = warrantyRanges();
  const client: any = ctx.auth;
  const select = access.level === "full" ? FULL_SELECT[kind] : BASIC_SELECT[kind];
  const res = await applyFilters(client.from(ASSET_TABLE[kind]).select(select, { count: "exact" }), kind, access.level, access, f, range)
    .order(kind === "facilities" && sortBy === "warranty_end_date" ? SPEC_END : sortBy, { ascending }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  const rows = ((res.data || []) as any[]).map((r) => ({ ...r }));
  await Promise.all([relations(kind, rows, access.level), thumbnails(kind, rows), access.level === "full" && url.searchParams.get("withWarrantyDocs") === "1" ? warrantyDocuments(kind, rows) : Promise.resolve()]);

  // 統計卡（符合目前篩選的精確筆數，不是只算這一頁）
  const count = async (extra?: (q: any) => any) => {
    let q = applyFilters(client.from(ASSET_TABLE[kind]).select("id", { count: "exact", head: true }), kind, access.level, access, f, range);
    if (extra) q = extra(q);
    const r = await q;
    if (r.error) throw dbError(r.error);
    return r.count || 0;
  };
  const hasKey = kind === "equipment" ? "has_warranty.eq.true" : `${SPEC_HAS}.eq.true`;
  const endKey = kind === "equipment" ? "warranty_end_date" : SPEC_END;
  const [attention, warrantyAttention] = await Promise.all([
    count((q) => q.in("status", ATTENTION_STATUS[kind])),
    count((q) => q.or(`and(${hasKey},${endKey}.is.null),and(${hasKey},${endKey}.lte.${range.expiringEnd})`)),
  ]);
  const total = res.count || 0;
  // 保固頁的統計卡：目前篩選（不含保固條件）下各保固狀態的精確筆數。
  let warrantyBuckets: Record<string, number> | undefined;
  if (url.searchParams.get("warrantyStats") === "1") {
    const base = { ...f, warranty: "" as const };
    const counts = await Promise.all(WARRANTY_FILTERS.map(async (w) => {
      const r = await applyWarranty(applyFilters(client.from(ASSET_TABLE[kind]).select("id", { count: "exact", head: true }), kind, access.level, access, base, range), kind, w, range);
      if (r.error) throw dbError(r.error);
      return [w, r.count || 0] as const;
    }));
    warrantyBuckets = Object.fromEntries(counts);
  }
  return respond({
    data: rows.map((r) => pickAssetFields(kind, r, access.level)),
    meta: pagingMeta(page, pageSize, total),
    total,
    stats: { total, attention, warrantyAttention, ...(warrantyBuckets ? { warrantyBuckets } : {}) },
    permissions: { manage: access.manage, level: access.level, seeFull: access.level === "full" },
  });
}

// ---------------------------------------------------------------------------------------- 詳情
async function loadOne(ctx: Context, kind: AssetKind, id: string, access: AssetAccess) {
  requireUuid(id, `${NOUN[kind]} id`);
  let q = (ctx.auth as any).from(ASSET_TABLE[kind]).select(access.level === "full" ? "*" : BASIC_SELECT[kind]).eq("id", id).is("deleted_at", null);
  if (access.storeIds) q = q.in("store_id", access.storeIds);
  const row = (await must(q.maybeSingle())) as any;
  if (!row) throw new GaError(404, `找不到${NOUN[kind]}`);
  return { ...row };
}

async function warnings(ctx: Context, kind: AssetKind, row: Record<string, any>) {
  const out: { code: string; message: string; duplicate_count?: number }[] = [];
  const client: any = ctx.auth;
  if (kind === "equipment") {
    if (row.has_warranty === true && !row.warranty_end_date) out.push({ code: "WARRANTY_INCOMPLETE", message: "此設備標記為有保固，但尚未填寫保固到期日。" });
    if (row.brand && row.model && row.serial_number) {
      const r = await client.from("ga_equipment").select("id", { count: "exact", head: true }).eq("brand", row.brand).eq("model", row.model).eq("serial_number", row.serial_number).is("deleted_at", null).neq("id", row.id);
      if (!r.error && (r.count || 0) > 0) out.push({ code: "POSSIBLE_DUPLICATE_SERIAL", message: "同品牌、型號、序號已有其他未刪除設備，請確認是否重複建檔。", duplicate_count: r.count });
    }
  } else if (row.store_id && row.category_id && row.name) {
    let q = client.from("ga_facilities").select("id", { count: "exact", head: true }).eq("store_id", row.store_id).eq("category_id", row.category_id).ilike("name", String(row.name).trim()).is("deleted_at", null).neq("id", row.id);
    q = row.area ? q.eq("area", row.area) : q.is("area", null);
    q = row.location_detail ? q.eq("location_detail", row.location_detail) : q.is("location_detail", null);
    const r = await q;
    if (!r.error && (r.count || 0) > 0) out.push({ code: "POSSIBLE_DUPLICATE_FACILITY", message: "同門市、分類、名稱、區域與位置已有其他未刪除設施，請確認是否重複建檔。", duplicate_count: r.count });
  }
  return out;
}

async function one(ctx: Context, kind: AssetKind, rawId: string) {
  const access = await assetAccess(ctx, kind);
  const row = await loadOne(ctx, kind, rawId, access);
  await Promise.all([relations(kind, [row], access.level), thumbnails(kind, [row])]);
  // 進行中的轉移單（讀不到就當沒有：轉移單表有自己的讀取範圍）
  const t = await (ctx.auth as any).from("ga_asset_transfers").select("id,transfer_no,status,from_store_id,to_store_id,open_request_count,requested_at")
    .eq("asset_type", ASSET_TYPE[kind]).eq("asset_id", row.id).in("status", ["PENDING_HANDOVER", "PENDING_RECEIVE"]).maybeSingle();
  row.open_transfer = t.error ? null : t.data || null;
  return respond({
    data: pickAssetFields(kind, row, access.level),
    warnings: access.level === "full" ? await warnings(ctx, kind, row) : [],
    permissions: { manage: access.manage, level: access.level, seeFull: access.level === "full" },
  });
}

// ---------------------------------------------------------------------------------------- 新增
const reasonOf = (kind: AssetKind, value: unknown) => validated(() => (kind === "equipment" ? equipmentReason(value) : facilityReason(value)));

async function create(ctx: Context, kind: AssetKind, request: NextRequest) {
  requireManage(ctx, kind);
  const b = await body(request);
  if (kind === "equipment") {
    const quantity = b.quantity === undefined ? 1 : Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new GaError(400, "新增數量必須是 1 至 100 的整數");
    const normalized = validated(() => validateEquipmentPayload(b)) as Record<string, any>;
    if (quantity > 1 && normalized.asset_code) throw new GaError(400, "一次新增多台時不能指定同一個資產編號（留空由系統自動產生）");
    const payload = { ...normalized, ...(normalized.has_warranty === false ? { warranty_end_date: null } : {}), created_by: ctx.user.id, updated_by: ctx.user.id };
    const rows = Array.from({ length: quantity }, () => ({ ...payload, ...(quantity > 1 ? { serial_number: null, barcode: null, onboarding_status: "NEEDS_EQUIPMENT_PHOTO" } : {}) }));
    // 單一 insert 陳述式：任何一台（例如編號重複）失敗，整批都不會建立。
    const created = ((await must((ctx.auth as any).from("ga_equipment").insert(rows).select("*"))) as any[]) || [];
    await relations(kind, created, "full");
    const items = created.map((r) => pickAssetFields(kind, r, "full"));
    return respond({ data: items[0] || null, items, createdCount: items.length, warnings: quantity === 1 && created[0] ? await warnings(ctx, kind, created[0]) : [] }, 201);
  }
  const payload = validated(() => validateFacilityPayload(b)) as Record<string, any>;
  const created = (await must((ctx.auth as any).from("ga_facilities").insert(payload).select("*").single())) as any;
  await relations(kind, [created], "full");
  return respond({ data: pickAssetFields(kind, created, "full"), items: [pickAssetFields(kind, created, "full")], createdCount: 1, warnings: await warnings(ctx, kind, created) }, 201);
}

// ---------------------------------------------------------------------------------------- 編輯
async function update(ctx: Context, kind: AssetKind, request: NextRequest, rawId: string) {
  requireManage(ctx, kind);
  requireUuid(rawId, `${NOUN[kind]} id`);
  const b = await body(request);
  if (Object.prototype.hasOwnProperty.call(b, "store_id")) throw new GaError(400, STORE_ID_EDIT_MESSAGE, { code: "STORE_NOT_EDITABLE" });
  const expected = typeof b.expected_updated_at === "string" ? b.expected_updated_at : "";
  if (!expected) throw new GaError(400, "缺少 expected_updated_at（請先載入資料再儲存）");
  const { expected_updated_at: _drop, ...fields } = b;
  const normalized = validated(() => (kind === "equipment" ? validateEquipmentPayload(fields, { partial: true }) : validateFacilityPayload(fields, { partial: true }))) as Record<string, any>;
  // 保固：舊版整包送 specs: {} 會清空供應商與保固申請方式；改為只送有改的欄位，specs 合併。
  const select = "*"; // 與舊版相同：整列回傳
  const current = (await must((ctx.auth as any).from(ASSET_TABLE[kind]).select(select).eq("id", rawId).is("deleted_at", null).maybeSingle())) as any;
  if (!current) throw new GaError(404, `找不到${NOUN[kind]}`);
  delete normalized.onboarding_status; // 貼標進度只能由貼標流程（上傳照片、總務複核）改，不能從編輯畫面直接改
  if (kind === "equipment" && normalized.has_warranty === false) normalized.warranty_end_date = null;
  if (kind === "equipment" && normalized.has_warranty === undefined && normalized.warranty_end_date && current.has_warranty !== true) {
    throw new GaError(400, "無保固時不可填寫保固到期日");
  }
  const terminal = TERMINAL_STATUS[kind];
  if (current.status === terminal && normalized.status && normalized.status !== terminal) throw new GaError(400, RESTORE_REQUIRED_MESSAGE, { code: "USE_RESTORE" });
  const changed = diffAssetPatch(current, normalized);
  if (changed.status === terminal) changed.qr_token_revoked_at = new Date().toISOString();
  const codeKey = CODE_COLUMN[kind];
  const codeChanged = codeKey in changed && !!current[codeKey];
  if (!Object.keys(changed).length) {
    if (current.updated_at !== expected) throw new GaError(409, `這個${NOUN[kind]}已被其他人修改，請重新載入後再儲存`, { code: "STALE" });
    await relations(kind, [current], "full");
    return respond({ data: pickAssetFields(kind, current, "full"), warnings: await warnings(ctx, kind, current), changedFields: [] });
  }
  if (kind === "equipment") changed.updated_by = ctx.user.id;
  const row = (await must((ctx.auth as any).from(ASSET_TABLE[kind]).update(changed).eq("id", rawId).eq("updated_at", expected).is("deleted_at", null).select(select).maybeSingle())) as any;
  if (!row) throw new GaError(409, `這個${NOUN[kind]}已被其他人修改，請重新載入後再儲存`, { code: "STALE" });
  await relations(kind, [row], "full");
  const w = await warnings(ctx, kind, row);
  if (codeChanged) w.push({ code: "LABEL_REPRINT", message: LABEL_REPRINT_MESSAGE });
  return respond({ data: pickAssetFields(kind, row, "full"), warnings: w, changedFields: Object.keys(changed).filter((k) => !["updated_by", "qr_token_revoked_at"].includes(k)) });
}

// ---------------------------------------------------------------------------------------- 刪除、更正、恢復、未結案單
async function openOrders(ctx: Context, kind: AssetKind, rawId: string) {
  requireUuid(rawId, `${NOUN[kind]} id`);
  const r = await rpc(ctx, "ga_ws_asset_open_orders", { p_type: ASSET_TYPE[kind], p_id: rawId });
  return respond({ data: r.data });
}

async function remove(ctx: Context, kind: AssetKind, request: NextRequest, rawId: string) {
  requireManage(ctx, kind);
  requireUuid(rawId, `${NOUN[kind]} id`);
  const b = await body(request);
  const reason = reasonOf(kind, b.reason ?? b.deletion_reason);
  const r = await rpc(ctx, "ga_ws_delete_asset", { p_type: ASSET_TYPE[kind], p_id: rawId, p_reason: reason, p_expected_updated_at: typeof b.expected_updated_at === "string" ? b.expected_updated_at : null });
  return respond({ data: r.data });
}

async function correctStore(ctx: Context, kind: AssetKind, request: NextRequest, rawId: string) {
  requireManage(ctx, kind);
  requireUuid(rawId, `${NOUN[kind]} id`);
  const b = await body(request);
  const to = requireUuid(b.to_store_id, "新門市 id");
  const r = await rpc(ctx, "ga_ws_correct_asset_store", {
    p_type: ASSET_TYPE[kind], p_id: rawId, p_to_store_id: to, p_reason: String(b.reason ?? ""), p_expected_updated_at: typeof b.expected_updated_at === "string" ? b.expected_updated_at : null,
  });
  return respond({ data: r.data });
}

async function restore(ctx: Context, kind: AssetKind, request: NextRequest, rawId: string) {
  requireManage(ctx, kind);
  requireUuid(rawId, `${NOUN[kind]} id`);
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_restore_asset", { p_type: ASSET_TYPE[kind], p_id: rawId, p_reason: String(b.reason ?? ""), p_expected_updated_at: typeof b.expected_updated_at === "string" ? b.expected_updated_at : null });
  return respond({ data: r.data });
}

async function events(ctx: Context, kind: AssetKind, rawId: string) {
  await assetAccess(ctx, kind); // 沒有查看權限也不是名單店長：403（異動紀錄本身另由資料庫列級權限限制範圍）
  requireUuid(rawId, `${NOUN[kind]} id`);
  const res = await (ctx.auth as any).from("ga_asset_events").select("*").eq("asset_type", ASSET_TYPE[kind]).eq("asset_id", rawId).order("created_at", { ascending: false }).order("id").limit(200);
  if (res.error) throw dbError(res.error);
  const rows = (res.data || []) as any[];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.from_store_id, r.to_store_id]).filter(Boolean)));
  const stores = ids.length ? (((await must((adminClient() as any).from("stores").select("id,store_code,store_name,short_name").in("id", ids))) as any[]) || []) : [];
  const name = new Map(stores.map((s) => [s.id, `${s.store_code} ${s.short_name || s.store_name}`]));
  return respond({ data: rows.map((r) => ({ ...r, from_store_name: name.get(r.from_store_id) || null, to_store_name: name.get(r.to_store_id) || null })) });
}

export { warrantyInput, warrantyState };
