// Q28 設備／設施轉移單 API（/api/workspace/general-affairs/transfers/**）。
// 平常換店一律走轉移單：總務發起 → 轉出門市店長確認交出 → 轉入門市店長確認收到（可附照片），收到才正式換店；QR token 沿用不重發。
// 解讀 (g)：確認交出／收到只認 store_managers.role_type = 'store_manager' 的人；解讀 (h)：進行中的報修單與工單留在原門市，只顯示警示張數。
// 讀取：用使用者自己的身分查（RLS 決定看得到哪些）；寫入：全部走資料庫函式（多步驟在同一交易，全成或全不變）；照片先傳儲存空間，函式失敗就移除剛傳的檔案。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { checkFile, checkTotalSize, fileExtension, isImageType, SIGNED_URL_SECONDS } from "./upload-rules";
import { GaError, body, dbError, must, respond, rpc, type Context } from "./server";

const BUCKET = "general-affairs-attachments";
export const TRANSFER_STATUSES = ["PENDING_HANDOVER", "PENDING_RECEIVE", "COMPLETED", "CANCELLED"] as const;
export const TRANSFER_PHOTO_MAX = 3;
const SELECT =
  "id,transfer_no,asset_type,asset_id,asset_name,asset_code,from_store_id,to_store_id,status,reason,note,open_request_count,requested_by_name,requested_at,handover_by_name,handover_at,handover_note,received_by_name,received_at,receive_note,cancelled_by_name,cancelled_at,cancel_reason,created_at,updated_at";

export async function transfersApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [id, action] = rest;
  const m = request.method;
  if (!id && m === "GET") return list(ctx, new URL(request.url));
  if (!id && m === "POST") return create(ctx, request);
  if (id && !action && m === "GET") return one(ctx, id);
  if (id && action === "handover" && m === "POST") return step(ctx, request, id, "HANDOVER");
  if (id && action === "receive" && m === "POST") return step(ctx, request, id, "RECEIVE");
  if (id && action === "cancel" && m === "POST") return cancel(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

const canManage = (ctx: Context, assetType: string) => dbCan(ctx.permissions, assetType === "FACILITY" ? GA.facilityManage : GA.equipmentManage);

/** 登入者「店長」身分的門市（role_type = store_manager）；督導與區經理不算（解讀 (g)）。 */
export async function managerStoreIds(ctx: Context): Promise<string[]> {
  const rows = ((await must((adminClient() as any).from("store_managers").select("store_id").eq("user_id", ctx.user.id).eq("role_type", "store_manager"))) as any[]) || [];
  return Array.from(new Set(rows.map((r) => r.store_id as string)));
}

type Row = Record<string, any>;
/** 每張單的「我能做什麼」：前端按鈕顯示與 API 預檢共用同一套規則（最終仍由資料庫函式判斷）。 */
function abilities(ctx: Context, t: Row, mine: string[]) {
  const open = t.status === "PENDING_HANDOVER" || t.status === "PENDING_RECEIVE";
  return {
    canHandover: t.status === "PENDING_HANDOVER" && mine.includes(t.from_store_id),
    canReceive: t.status === "PENDING_RECEIVE" && mine.includes(t.to_store_id),
    canCancel: open && canManage(ctx, t.asset_type),
  };
}

async function decorate(ctx: Context, rows: Row[], mine: string[]) {
  const ids = Array.from(new Set(rows.flatMap((r) => [r.from_store_id, r.to_store_id]).filter(Boolean)));
  const stores = ids.length ? (((await must((adminClient() as any).from("stores").select("id,store_code,store_name,short_name").in("id", ids))) as any[]) || []) : [];
  const name = new Map(stores.map((s) => [s.id, `${s.store_code} ${s.short_name || s.store_name}`]));
  return rows.map((r) => ({ ...r, from_store_name: name.get(r.from_store_id) || null, to_store_name: name.get(r.to_store_id) || null, ...abilities(ctx, r, mine) }));
}

/** 讀取範圍：設備／設施查看或管理，或轉移單上的店長身分；其餘 403（資料庫列級權限本來就看不到，這裡改成明確回應）。 */
async function readScope(ctx: Context) {
  const mine = await managerStoreIds(ctx);
  if (!mine.length && !dbCan(ctx.permissions, GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage)) throw new GaError(403, "沒有轉移單的查看權限");
  return mine;
}

async function list(ctx: Context, url: URL) {
  const p = url.searchParams;
  const mine = await readScope(ctx);
  const mineOnly = p.get("mine") === "1";
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const statuses = (p.get("status") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (statuses.some((s) => !(TRANSFER_STATUSES as readonly string[]).includes(s))) throw new GaError(400, "狀態參數錯誤");
  const type = (p.get("assetType") || "").trim().toUpperCase();
  if (type && type !== "EQUIPMENT" && type !== "FACILITY") throw new GaError(400, "資產類型錯誤");
  const storeId = (p.get("storeId") || "").trim();
  if (storeId && !isUuid(storeId)) throw new GaError(400, "門市 id 格式錯誤");
  const q = (p.get("q") || "").trim();

  const todoFilter = (ids: string[]) => {
    const list = ids.join(",");
    return `and(status.eq.PENDING_HANDOVER,from_store_id.in.(${list})),and(status.eq.PENDING_RECEIVE,to_store_id.in.(${list}))`;
  };
  const build = (head = false) => {
    let query = (ctx.auth as any).from("ga_asset_transfers").select(SELECT, head ? { count: "exact", head: true } : { count: "exact" });
    if (mineOnly) query = mine.length ? query.or(todoFilter(mine)) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    if (statuses.length) query = query.in("status", statuses);
    if (type) query = query.eq("asset_type", type);
    if (storeId) query = query.or(`from_store_id.eq.${storeId},to_store_id.eq.${storeId}`);
    if (q) query = query.or(orIlike(["transfer_no", "asset_name", "asset_code"], q));
    return query;
  };
  const res = await build().order("requested_at", { ascending: false }).order("id").range(from, to);
  if (res.error) throw dbError(res.error);
  // 「待我處理」張數：不受目前篩選影響，給手機分頁角標用。
  let todoCount = 0;
  if (mine.length) {
    const c = await (ctx.auth as any).from("ga_asset_transfers").select("id", { count: "exact", head: true }).or(todoFilter(mine));
    todoCount = c.error ? 0 : c.count || 0;
  }
  const total = res.count || 0;
  return respond({
    data: await decorate(ctx, res.data || [], mine),
    total,
    meta: pagingMeta(page, pageSize, total),
    todoCount,
    permissions: { create: dbCan(ctx.permissions, GA.equipmentManage, GA.facilityManage), createEquipment: dbCan(ctx.permissions, GA.equipmentManage), createFacility: dbCan(ctx.permissions, GA.facilityManage), isStoreManager: mine.length > 0 },
  });
}

async function one(ctx: Context, rawId: string) {
  if (!isUuid(rawId)) throw new GaError(400, "轉移單 id 格式錯誤");
  const mine = await readScope(ctx);
  const t = (await must((ctx.auth as any).from("ga_asset_transfers").select(SELECT).eq("id", rawId).maybeSingle())) as Row | null;
  if (!t) throw new GaError(404, "找不到轉移單，或不是您可以查看的轉移單");
  const [row] = await decorate(ctx, [t], mine);
  const events = (await must((ctx.auth as any).from("ga_asset_events").select("id,event_type,reason,note,open_request_count,actor_name,created_at,from_store_id,to_store_id").eq("transfer_id", rawId).order("created_at").order("id"))) as Row[];
  const photos = ((await must((ctx.auth as any).from("ga_asset_transfer_photos").select("id,step,storage_path,file_name,content_type,uploaded_at").eq("transfer_id", rawId).order("uploaded_at"))) as Row[]) || [];
  // 簽名網址每次重簽（Q3）；只有通過上面 RLS 讀取的轉移單才會走到這裡。
  const paths = photos.map((x) => x.storage_path);
  const signed = new Map<string, string>();
  if (paths.length) {
    const s = await (adminClient() as any).storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
    (s.data || []).forEach((item: any, i: number) => item?.signedUrl && signed.set(paths[i], item.signedUrl));
  }
  return respond({
    data: { ...row, events: events || [], photos: photos.map((x) => ({ id: x.id, step: x.step, file_name: x.file_name, content_type: x.content_type, url: signed.get(x.storage_path) || null })) },
  });
}

async function create(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const type = String(b.assetType || "").trim().toUpperCase();
  if (type !== "EQUIPMENT" && type !== "FACILITY") throw new GaError(400, "資產類型錯誤");
  if (!canManage(ctx, type)) throw new GaError(403, type === "FACILITY" ? "沒有設施管理權限" : "沒有設備管理權限");
  if (!isUuid(b.assetId)) throw new GaError(400, "缺少或錯誤的資產 id");
  if (!isUuid(b.toStoreId)) throw new GaError(400, "請選擇轉入門市");
  const r = await rpc(ctx, "ga_ws_transfer_create", { p_type: type, p_asset_id: b.assetId, p_to_store_id: b.toStoreId, p_reason: String(b.reason ?? ""), p_note: typeof b.note === "string" ? b.note : null });
  return respond({ data: r.data }, 201);
}

async function readFiles(request: NextRequest): Promise<{ note: string | null; files: File[] }> {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("multipart/form-data")) {
    const b = await body(request);
    return { note: typeof b.note === "string" ? b.note : null, files: [] };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new GaError(400, "上傳內容格式錯誤，或檔案太大（合計上限 4.25MB）");
  }
  const note = form.get("note");
  const files = form.getAll("files").filter((f): f is File => !!f && typeof f === "object" && "arrayBuffer" in f);
  return { note: typeof note === "string" ? note : null, files };
}

async function step(ctx: Context, request: NextRequest, rawId: string, which: "HANDOVER" | "RECEIVE") {
  if (!isUuid(rawId)) throw new GaError(400, "轉移單 id 格式錯誤");
  const { note, files } = await readFiles(request);
  if (files.length > TRANSFER_PHOTO_MAX) throw new GaError(400, `照片最多 ${TRANSFER_PHOTO_MAX} 張`);
  for (const f of files) {
    if (!isImageType(f.type)) throw new GaError(400, `${f.name}：這裡只收圖片（JPEG、PNG、WebP、HEIC）`);
    const c = checkFile({ name: f.name, type: f.type, size: f.size });
    if (!c.ok) throw new GaError(400, c.message);
  }
  if (files.length) {
    const total = checkTotalSize(files.map((f) => f.size));
    if (!total.ok) throw new GaError(400, total.message);
  }
  // 預檢：先確認看得到這張單，且是對的店長與對的步驟，避免替沒資格的人把檔案傳進儲存空間（最終仍由資料庫函式判斷）。
  const t = (await must((ctx.auth as any).from("ga_asset_transfers").select("id,status,from_store_id,to_store_id,asset_type").eq("id", rawId).maybeSingle())) as Row | null;
  if (!t) throw new GaError(404, "找不到轉移單，或不是您可以處理的轉移單");
  const mine = await managerStoreIds(ctx);
  if (which === "HANDOVER" && !mine.includes(t.from_store_id)) throw new GaError(403, "只有轉出門市的店長可以確認交出");
  if (which === "RECEIVE" && !mine.includes(t.to_store_id)) throw new GaError(403, "只有轉入門市的店長可以確認收到");

  const admin = adminClient() as any;
  const prefix = `asset-transfers/${rawId}/${which.toLowerCase()}/`;
  const uploaded: { path: string; file_name: string; content_type: string; size_bytes: number }[] = [];
  try {
    for (const f of files) {
      const path = `${prefix}${Date.now()}-${crypto.randomUUID()}.${fileExtension(f.name, f.type)}`;
      const up = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
      if (up.error) throw new GaError(503, "照片上傳失敗，請稍後重試");
      uploaded.push({ path, file_name: f.name.trim().slice(0, 200) || "photo", content_type: f.type, size_bytes: f.size });
    }
    const r = await rpc(ctx, which === "HANDOVER" ? "ga_ws_transfer_confirm_handover" : "ga_ws_transfer_confirm_receive", {
      p_transfer_id: rawId, p_note: note, p_photos: uploaded.length ? uploaded : null,
    });
    return respond({ data: r.data });
  } catch (error) {
    // 函式失敗（資料都沒寫入）：移除剛傳的檔案，沒有任何紀錄指向它們。
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded.map((u) => u.path)).catch(() => undefined);
    throw error;
  }
}

async function cancel(ctx: Context, request: NextRequest, rawId: string) {
  if (!isUuid(rawId)) throw new GaError(400, "轉移單 id 格式錯誤");
  const b = await body(request);
  // 預檢權限（資料庫函式仍會判斷）：只有該類資產的管理權限可取消。
  if (!dbCan(ctx.permissions, GA.equipmentManage, GA.facilityManage)) throw new GaError(403, "沒有取消轉移單的權限");
  const r = await rpc(ctx, "ga_ws_transfer_cancel", { p_transfer_id: rawId, p_reason: String(b.reason ?? "") });
  return respond({ data: r.data });
}
