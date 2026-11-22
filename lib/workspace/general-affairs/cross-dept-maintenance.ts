// G19 跨部門維修（總務組頁）API：新增舊式回報（POST /cross-dept-maintenance）與維修分類管理（/maintenance-categories）。
// 工單的列表、詳情與動作與總務服務中心共用同一套（/work-orders/**），這裡只放這頁獨有的兩件事（Q19、W6：最小移植，不增欄位、不加新功能）。
// 新增舊式回報：標題、說明、最多 5 張照片（只收圖片）；照片先傳到共用附件儲存空間，再由 ga_ws_wo_create_legacy 同交易建立工單與附件紀錄，失敗就移除剛傳的檔案；同人同識別碼重送回原工單。
// 維修分類：維持舊權限（看＝任一維修查看碼；編輯＝cross_dept.maintenance.category.edit）；舊版英文資料庫錯誤（分類重名）改白話。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan } from "./access";
import { isUuid } from "./rules";
import { checkImages, removeUploaded, uploadImages } from "./work-order-photos";
import { LEGACY_MAX_PHOTOS, WO, WO_CATEGORY_VIEW_CODES, validateLegacyReport, workOrderAbilities } from "./work-order-rules";
import { GaError, body, dbError, must, respond, rpc, validated, type Context } from "./server";

export async function crossDeptMaintenanceApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length || request.method !== "POST") throw new GaError(404, "找不到這個功能");
  const ab = workOrderAbilities(ctx.permissions, { isAdminProfile: !!ctx.isAdmin });
  if (!ab.canCreateLegacy) throw new GaError(403, "沒有回報維修問題的權限（需要維修回報或工單更新權限）");
  const ct = request.headers.get("content-type") || "";
  let fields: Record<string, any> = {};
  let files: File[] = [];
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch { throw new GaError(400, "上傳內容格式錯誤，或檔案太大（單檔上限 4MB）"); }
    form.forEach((v, k) => { if (typeof v === "string") fields[k] = v; });
    files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  } else {
    fields = await body(request);
  }
  const report = validated(() => validateLegacyReport(fields));
  if (files.length > LEGACY_MAX_PHOTOS) throw new GaError(400, `最多只能附 ${LEGACY_MAX_PHOTOS} 張照片`);
  if (files.length) await checkImages(files, LEGACY_MAX_PHOTOS);
  const id = crypto.randomUUID();
  const uploaded: string[] = [];
  try {
    const stored = files.length ? await uploadImages(files, "MAINTENANCE_REQUEST", id, "REPORT_PHOTO", uploaded) : [];
    const { key, ...rest2 } = report;
    const r = await rpc(ctx, "ga_ws_wo_create_legacy", {
      p_payload: { id, ...rest2, attachments: stored.map((s) => ({ storage_path: s.path, file_name: s.file_name, content_type: s.content_type, size_bytes: s.size_bytes })) },
      p_key: key,
    });
    // 同識別碼重送：資料庫回原工單，這次剛傳的檔案沒有任何紀錄指向，一併移除。
    const replay = !!(r as any).idempotent_replay;
    if (replay) await removeUploaded(uploaded);
    return respond({ data: r.data, replay }, replay ? 200 : 201);
  } catch (error) {
    await removeUploaded(uploaded);
    throw error;
  }
}

// ---------------------------------------------------------------- 維修分類
const CATEGORY_COLUMNS = "id,name,sort_order,is_active,created_at,updated_at";
const duplicateText = "已有相同名稱的維修分類（含已停用的），請換一個名稱";

export async function maintenanceCategoriesApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [id, extra] = rest;
  if (extra) throw new GaError(404, "找不到這個功能");
  if (id && !isUuid(id)) throw new GaError(400, "分類 id 格式錯誤");
  const canView = dbCan(ctx.permissions, ...WO_CATEGORY_VIEW_CODES);
  const canEdit = dbCan(ctx.permissions, WO.crossCategoryEdit);
  if (m === "GET" && !id) {
    if (!canView) throw new GaError(403, "沒有維修分類查看權限");
    const includeInactive = canEdit && ["1", "true"].includes(new URL(request.url).searchParams.get("include_inactive") || "");
    let q = (adminClient() as any).from("maintenance_categories").select(CATEGORY_COLUMNS).order("sort_order").order("name");
    if (!includeInactive) q = q.eq("is_active", true);
    return respond({ data: (await must(q)) || [], permissions: { canEdit } });
  }
  if (!(m === "POST" && !id) && m !== "PATCH" && m !== "DELETE") throw new GaError(404, "找不到這個功能");
  if (!canEdit) throw new GaError(403, "沒有編輯維修分類的權限");
  const admin: any = adminClient();
  const sameName = async (name: string, exceptId?: string) => {
    const rows = ((await must(admin.from("maintenance_categories").select("id,name"))) as any[]) || [];
    return rows.some((r) => r.id !== exceptId && String(r.name).trim().toLowerCase() === name.toLowerCase());
  };
  const readOne = async (cid: string) => {
    const row = (await must(admin.from("maintenance_categories").select(CATEGORY_COLUMNS).eq("id", cid).maybeSingle())) as any;
    if (!row) throw new GaError(404, "找不到這個維修分類");
    return row;
  };
  if (m === "POST") {
    const b = await body(request);
    const name = String(b.name ?? "").trim();
    if (!name) throw new GaError(400, "請輸入分類名稱");
    if (name.length > 50) throw new GaError(400, "分類名稱不可超過 50 字");
    if (await sameName(name)) throw new GaError(409, duplicateText);
    const max = (await must(admin.from("maintenance_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle())) as any;
    const res = await admin.from("maintenance_categories").insert({ name, sort_order: Number(max?.sort_order ?? 0) + 10, is_active: true, created_by: ctx.user.id, updated_by: ctx.user.id }).select(CATEGORY_COLUMNS).single();
    if (res.error) throw res.error.code === "23505" ? new GaError(409, duplicateText) : dbError(res.error);
    return respond({ data: res.data }, 201);
  }
  const b = m === "PATCH" ? await body(request) : {};
  const cid = id || String(b.id ?? "").trim() || new URL(request.url).searchParams.get("id") || "";
  if (!isUuid(cid)) throw new GaError(400, "缺少或錯誤的分類 id");
  const current = await readOne(cid);
  if (m === "DELETE") {
    // 舊版語意：刪除＝停用（不實刪，既有工單仍帶著這個分類）。
    const res = await admin.from("maintenance_categories").update({ is_active: false, updated_by: ctx.user.id }).eq("id", cid).select(CATEGORY_COLUMNS).single();
    if (res.error) throw dbError(res.error);
    return respond({ data: res.data });
  }
  const expected = String(b.expected_updated_at ?? "").trim();
  if (expected && current.updated_at && Date.parse(expected) !== Date.parse(current.updated_at)) throw new GaError(409, "這個分類剛被其他人修改，請重新載入後再操作", { code: "STALE" });
  const patch: Record<string, unknown> = { updated_by: ctx.user.id };
  if (typeof b.name === "string") {
    const name = b.name.trim();
    if (!name) throw new GaError(400, "請輸入分類名稱");
    if (name.length > 50) throw new GaError(400, "分類名稱不可超過 50 字");
    if (await sameName(name, cid)) throw new GaError(409, duplicateText);
    patch.name = name;
  }
  if (typeof b.is_active === "boolean") patch.is_active = b.is_active;
  if (b.sort_order !== undefined && b.sort_order !== null && b.sort_order !== "") {
    const n = Number(b.sort_order);
    if (!Number.isFinite(n)) throw new GaError(400, "排序必須是數字");
    patch.sort_order = Math.trunc(n);
  }
  if (Object.keys(patch).length === 1) throw new GaError(400, "沒有要修改的欄位");
  const res = await admin.from("maintenance_categories").update(patch).eq("id", cid).select(CATEGORY_COLUMNS).single();
  if (res.error) throw res.error.code === "23505" ? new GaError(409, duplicateText) : dbError(res.error);
  return respond({ data: res.data });
}
