// 設備／設施建檔貼標流程 API（Q29 的待辦與複核；設施比照設備，解讀 (b)）。
// 流程：待上傳照片 → 待上傳貼標照 → 待總務複核 → 完成；退回須填原因，且設備／設施照片與貼標照兩項都要重傳（解讀 (f)）。
// 店長待辦：範圍由資料庫函式 ga_ws_onboarding_list 判斷（自己有名單身分的門市；總務看全部），取代舊版「只載入 100 筆」。
// 上傳：伺服端先把檔案傳到儲存空間，再呼叫 ga_ws_submit_onboarding_photo（登錄附件、清重拍旗標、同步狀態在同一個交易）；函式失敗就移除剛傳的檔案。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { ONBOARDING_STATUSES } from "./asset-fields";
import { isUuid } from "./rules";
import { checkFile, fileExtension, isImageType, SIGNED_URL_SECONDS, storagePath } from "./upload-rules";
import { GaError, body, must, respond, rpc, type Context } from "./server";

const BUCKET = "general-affairs-attachments";
const PURPOSES = ["PRIMARY_IMAGE", "LABEL_POSITION_IMAGE"] as const;
const DEFAULT_TASK_STATUSES = ["NEEDS_EQUIPMENT_PHOTO", "NEEDS_LABEL_PHOTO"];

export async function onboardingApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [head] = rest;
  const m = request.method;
  if (head === "tasks" && m === "GET") return tasks(ctx, new URL(request.url), false);
  if (head === "photo" && m === "POST") return photo(ctx, request);
  if (head === "review" && m === "GET") return tasks(ctx, new URL(request.url), true);
  if (head === "review" && m === "POST") return review(ctx, request);
  if (head === "progress" && m === "GET") return progress(ctx, new URL(request.url));
  throw new GaError(404, "找不到這個功能");
}

function assetTypeOf(value: unknown, required = true): "EQUIPMENT" | "FACILITY" | null {
  const t = String(value || "").trim().toUpperCase();
  if (!t && !required) return null;
  if (t !== "EQUIPMENT" && t !== "FACILITY") throw new GaError(400, "資產類型錯誤");
  return t;
}

/** 每次重簽：待辦與複核頁每次載入都產生新的簽名網址（Q3）。 */
async function attachPhotos(rows: any[]) {
  if (!rows.length) return rows;
  const admin: any = adminClient();
  const out = rows.map((r) => ({ ...r, photos: { primary: null as any, label: null as any } }));
  for (const type of ["EQUIPMENT", "FACILITY"] as const) {
    const ids = out.filter((r) => r.asset_type === type).map((r) => r.id);
    if (!ids.length) continue;
    const res = await admin.from("ga_resource_attachments")
      .select("resource_id,purpose,storage_path,file_name,content_type,is_primary,uploaded_at")
      .eq("resource_type", type).in("resource_id", ids).in("purpose", PURPOSES as unknown as string[]).is("deleted_at", null)
      .order("is_primary", { ascending: false }).order("uploaded_at", { ascending: false });
    if (res.error) continue;
    const pick = new Map<string, any>();
    for (const a of res.data || []) {
      const key = `${a.resource_id}:${a.purpose}`;
      if (!pick.has(key)) pick.set(key, a);
    }
    const paths = Array.from(new Set(Array.from(pick.values()).map((a) => a.storage_path)));
    const signed = new Map<string, string>();
    if (paths.length) {
      const s = await admin.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
      (s.data || []).forEach((item: any, i: number) => item?.signedUrl && signed.set(paths[i], item.signedUrl));
    }
    for (const r of out) {
      if (r.asset_type !== type) continue;
      for (const [purpose, slot] of [["PRIMARY_IMAGE", "primary"], ["LABEL_POSITION_IMAGE", "label"]] as const) {
        const a = pick.get(`${r.id}:${purpose}`);
        r.photos[slot] = a && isImageType(a.content_type) ? { url: signed.get(a.storage_path) || null, file_name: a.file_name } : a ? { url: null, file_name: a.file_name } : null;
      }
    }
  }
  return out;
}

/** 待辦範圍（與資料庫函式相同）：設備／設施查看或管理、需求單管理或全部、門市管理者，或店長名單內任何身分；其餘 403（函式本身對沒範圍的人只會回空清單）。 */
async function requireTaskScope(ctx: Context) {
  if (dbCan(ctx.permissions, GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage, "general_affairs.request.manage", "general_affairs.request.view_all", "store.manage")) return;
  const { data, error } = await (adminClient() as any).from("store_managers").select("id").eq("user_id", ctx.user.id).limit(1);
  if (error || !(data || []).length) throw new GaError(403, "沒有貼標待辦的查看權限");
}

async function tasks(ctx: Context, url: URL, reviewOnly: boolean) {
  await requireTaskScope(ctx);
  if (reviewOnly && !dbCan(ctx.permissions, GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage)) throw new GaError(403, "沒有貼標複核的查看權限");
  const p = url.searchParams;
  const rawStatuses = reviewOnly ? ["PENDING_GA_REVIEW"] : (p.get("statuses") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const statuses = rawStatuses.length ? rawStatuses : DEFAULT_TASK_STATUSES;
  if (statuses.some((s) => !(ONBOARDING_STATUSES as readonly string[]).includes(s))) throw new GaError(400, "狀態參數錯誤");
  const type = assetTypeOf(p.get("assetType"), false);
  const storeId = (p.get("storeId") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市 id 格式錯誤");
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.get("pageSize") || 50)) || 50));
  const page = Math.max(1, Math.floor(Number(p.get("page") || 1)) || 1);
  const r = await rpc(ctx, "ga_ws_onboarding_list", {
    p_statuses: statuses, p_asset_type: type, p_store_id: storeId || null, p_search: (p.get("q") || p.get("search") || "").trim().slice(0, 100) || null,
    p_limit: pageSize, p_offset: (page - 1) * pageSize,
  });
  const rows = await attachPhotos(r.data.rows || []);
  const total = Number(r.data.total || 0);
  return respond({
    data: rows, total, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    permissions: { review: dbCan(ctx.permissions, GA.equipmentManage, GA.facilityManage) },
  });
}

async function photo(ctx: Context, request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new GaError(400, "上傳內容格式錯誤，或檔案太大（單檔上限 4MB）");
  }
  const type = assetTypeOf(form.get("assetType"))!;
  const id = String(form.get("assetId") || "").trim();
  if (!isUuid(id)) throw new GaError(400, "缺少或錯誤的 assetId");
  const purpose = String(form.get("purpose") || "").trim().toUpperCase();
  if (!(PURPOSES as readonly string[]).includes(purpose)) throw new GaError(400, "照片用途錯誤");
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) throw new GaError(400, "請選擇要上傳的照片");
  const f = file as File;
  if (!isImageType(f.type)) throw new GaError(400, `${f.name}：這裡只收圖片（JPEG、PNG、WebP、HEIC）`);
  const check = checkFile({ name: f.name, type: f.type, size: f.size });
  if (!check.ok) throw new GaError(400, check.message);
  // 先確認登入者看得到這一筆（RLS 範圍），避免替看不到的資產把檔案傳進儲存空間。
  const table = type === "EQUIPMENT" ? "ga_equipment" : "ga_facilities";
  const seen = (await must((ctx.auth as any).from(table).select("id").eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!seen) throw new GaError(404, "找不到資料，或不是您管理的門市");
  const admin = adminClient();
  const path = storagePath(type, id, purpose, crypto.randomUUID(), fileExtension(f.name, f.type));
  const up = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
  if (up.error) throw new GaError(503, "檔案上傳失敗，請稍後重試");
  try {
    const r = await rpc(ctx, "ga_ws_submit_onboarding_photo", {
      p_type: type, p_id: id, p_purpose: purpose, p_path: path, p_file_name: f.name.trim().slice(0, 200) || "photo", p_content_type: f.type, p_size_bytes: f.size,
    });
    return respond({ data: r.data }, 201);
  } catch (error) {
    // 這個檔案還沒有任何紀錄指向它，移除剛傳的檔案（不是刪除既有附件）。
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
}

async function review(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const type = assetTypeOf(b.assetType)!;
  if (!isUuid(b.assetId)) throw new GaError(400, "缺少或錯誤的 assetId");
  const action = String(b.action || "");
  if (action !== "approve" && action !== "reject") throw new GaError(400, "複核動作錯誤");
  const r = await rpc(ctx, "ga_ws_review_onboarding", { p_type: type, p_id: b.assetId, p_action: action, p_note: typeof b.note === "string" ? b.note : null });
  return respond({ data: r.data });
}

async function progress(ctx: Context, url: URL) {
  const storeId = (url.searchParams.get("storeId") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市 id 格式錯誤");
  const r = await rpc(ctx, "ga_ws_onboarding_progress", { p_store_id: storeId || null, p_include_empty: url.searchParams.get("includeEmpty") !== "false" });
  return respond({ data: r.data.stores || [] });
}

