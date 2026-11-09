// G01 附件 API（全站共用：設備、設施、料件、維修回報、需求單、水電網費帳單）。
// Q3：照片在瀏覽器端先縮小（長邊約 2000 像素），其他檔最大 4MB；刪除只標記，實體檔保留（不呼叫 storage remove）。
// 沿用：資源類型限定、單次最多 10 個、圖片與 PDF、簽名網址短效期（每次開啟重新簽發）。
// 多檔上傳全成或全不變：先傳到儲存空間，再用一次 insert 寫入全部紀錄；任何一步失敗就移除這次剛傳的檔案。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { isUuid } from "./rules";
import {
  checkFile, checkFileCount, checkTotalSize, fileExtension, isResourceType, normalizePurpose, SIGNED_URL_SECONDS, storagePath, UPLOAD_LIMITS,
} from "./upload-rules";
import { GaError, dbError, must, respond, type Context } from "./server";

const BUCKET = "general-affairs-attachments";
const COLUMNS = "id,resource_type,resource_id,purpose,file_name,content_type,size_bytes,is_primary,sort_order,metadata,uploaded_at,uploaded_by";

export async function attachmentsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [id, action] = rest;
  const m = request.method;
  if (m === "GET" && !id) return list(ctx, new URL(request.url));
  if (m === "POST" && !id) return upload(ctx, request);
  if (m === "GET" && id && action === "url") return openUrl(ctx, id);
  if (m === "DELETE" && id && !action) return remove(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

function resourceOf(value: unknown) {
  const t = String(value || "").trim().toUpperCase();
  if (!isResourceType(t)) throw new GaError(400, "附件資源類型錯誤");
  return t;
}

/** 水電網費帳單附件：沿用舊版，由費用權限判斷（資料表 RLS 不涵蓋）。 */
async function utilityGate(ctx: Context, resourceType: string, resourceId: string, manage: boolean) {
  if (resourceType !== "UTILITY_BILL") return false;
  if (!(manage ? dbCan(ctx.permissions, GA.utilityBillManage) : dbCan(ctx.permissions, GA.utilityBillView, GA.utilityBillManage))) {
    throw new GaError(403, manage ? "沒有費用附件管理權限" : "沒有費用附件查看權限");
  }
  const bill = (await must(adminClient().from("ga_utility_bills").select("id").eq("id", resourceId).is("deleted_at", null).maybeSingle())) as any;
  if (!bill) throw new GaError(404, "找不到費用紀錄");
  return true;
}

async function list(ctx: Context, url: URL) {
  const resourceType = resourceOf(url.searchParams.get("resourceType"));
  const resourceId = url.searchParams.get("resourceId") || "";
  if (!isUuid(resourceId)) throw new GaError(400, "缺少或錯誤的 resourceId");
  const purposeRaw = url.searchParams.get("purpose");
  const useAdmin = await utilityGate(ctx, resourceType, resourceId, false);
  const client: any = useAdmin ? adminClient() : ctx.auth;
  let q = client.from("ga_resource_attachments").select(COLUMNS + ",storage_path").eq("resource_type", resourceType).eq("resource_id", resourceId).is("deleted_at", null);
  if (purposeRaw) {
    try { q = q.eq("purpose", normalizePurpose(purposeRaw)); } catch (e) { throw new GaError(400, (e as Error).message); }
  }
  const rows = ((await must(q.order("sort_order").order("uploaded_at", { ascending: false }))) as any[]) || [];
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
    if (error) throw new GaError(503, "附件連結產生失敗，請稍後重試");
    (data || []).forEach((item, i) => item?.signedUrl && signed.set(paths[i], item.signedUrl));
  }
  return respond({
    data: rows.map(({ storage_path, ...r }) => ({ ...r, signed_url: signed.get(storage_path) || null })),
    limits: { maxFileBytes: UPLOAD_LIMITS.maxFileBytes, maxFiles: UPLOAD_LIMITS.maxFilesPerRequest },
  });
}

async function upload(ctx: Context, request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new GaError(400, "上傳內容格式錯誤，或檔案太大（單檔上限 4MB）");
  }
  const resourceType = resourceOf(form.get("resource_type"));
  const resourceId = String(form.get("resource_id") || "").trim();
  if (!isUuid(resourceId)) throw new GaError(400, "缺少或錯誤的 resource_id");
  let purpose: string;
  try { purpose = normalizePurpose(form.get("purpose")); } catch (e) { throw new GaError(400, (e as Error).message); }
  const isPrimary = String(form.get("is_primary") || "").toLowerCase() === "true";
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  const count = checkFileCount(files.length);
  if (!count.ok) throw new GaError(400, count.message);
  for (const f of files) {
    const c = checkFile({ name: f.name, type: f.type || "application/octet-stream", size: f.size });
    if (!c.ok) throw new GaError(400, c.message);
  }
  const total = checkTotalSize(files.map((f) => f.size));
  if (!total.ok) throw new GaError(413, total.message);
  const useAdmin = await utilityGate(ctx, resourceType, resourceId, true);
  const admin = adminClient();
  const uploaded: string[] = [];
  try {
    const records: Record<string, unknown>[] = [];
    for (let index = 0; index < files.length; index++) {
      const f = files[index];
      const path = storagePath(resourceType, resourceId, purpose, crypto.randomUUID(), fileExtension(f.name, f.type));
      const { error } = await admin.storage.from(BUCKET).upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
      if (error) throw new GaError(503, "檔案上傳失敗，請稍後重試");
      uploaded.push(path);
      records.push({
        resource_type: resourceType, resource_id: resourceId, purpose, storage_bucket: BUCKET, storage_path: path,
        file_name: f.name.trim().slice(0, 200) || "file", content_type: f.type, size_bytes: f.size,
        is_primary: isPrimary && index === 0, metadata: {}, uploaded_by: ctx.user.id,
      });
    }
    const client: any = useAdmin ? admin : ctx.auth;
    const res = await client.from("ga_resource_attachments").insert(records).select(COLUMNS);
    if (res.error) throw dbError(res.error);
    return respond({ data: res.data }, 201);
  } catch (error) {
    // 全成或全不變：這次剛傳的實體檔全部移除（這些檔案還沒有任何紀錄指向它們，不是「刪除既有附件」）。
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
    if (error instanceof GaError) throw error;
    throw dbError(error);
  }
}

async function openUrl(ctx: Context, id: string) {
  if (!isUuid(id)) throw new GaError(400, "附件 id 格式錯誤");
  const admin = adminClient();
  const meta = (await must(admin.from("ga_resource_attachments").select("resource_type,resource_id,deleted_at").eq("id", id).maybeSingle())) as any;
  if (!meta || meta.deleted_at) throw new GaError(404, "找不到附件");
  const useAdmin = await utilityGate(ctx, meta.resource_type, meta.resource_id, false);
  // 一般資源：以使用者身分讀取（RLS 決定看不看得到）；讀不到就視為沒有權限。
  const client: any = useAdmin ? admin : ctx.auth;
  const row = (await must(client.from("ga_resource_attachments").select("id,storage_path,file_name,content_type").eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到附件，或沒有查看權限");
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS.open, { download: false });
  if (error || !data?.signedUrl) throw new GaError(503, "附件連結產生失敗，請稍後重試");
  return respond({ url: data.signedUrl, file_name: row.file_name, content_type: row.content_type, expires_in: SIGNED_URL_SECONDS.open });
}

async function remove(ctx: Context, request: NextRequest, id: string) {
  if (!isUuid(id)) throw new GaError(400, "附件 id 格式錯誤");
  const text = await request.text();
  let reason = "";
  try { reason = String(JSON.parse(text || "{}").deletion_reason || "").trim(); } catch { throw new GaError(400, "送出的內容格式錯誤"); }
  if (!reason) throw new GaError(400, "請輸入刪除原因");
  if (reason.length > 200) throw new GaError(400, "刪除原因不可超過 200 字");
  const admin = adminClient();
  const att = (await must(admin.from("ga_resource_attachments").select("id,resource_type,resource_id,deleted_at").eq("id", id).maybeSingle())) as any;
  if (!att) throw new GaError(404, "找不到附件");
  if (att.deleted_at) throw new GaError(409, "附件已刪除");
  if (await utilityGate(ctx, att.resource_type, att.resource_id, true)) {
    // 只標記刪除；不刪除儲存空間裡的檔案（Q3）。
    await must(admin.from("ga_resource_attachments").update({ deleted_at: new Date().toISOString(), deleted_by: ctx.user.id, deletion_reason: reason }).eq("id", id).is("deleted_at", null));
    return respond({ data: { id } });
  }
  // 一般資源沿用舊版資料庫函式（內含權限與原因檢查）；舊版 API 刪除後會順手移除實體檔，新版不做。
  const { data, error } = await (ctx.auth as any).rpc("ga_soft_delete_resource_attachment", { p_attachment_id: id, p_reason: reason });
  if (error) {
    const msg = String(error.message || "");
    if (msg.includes("PERMISSION_DENIED")) throw new GaError(403, "沒有刪除這個附件的權限");
    if (msg.includes("NOT_FOUND")) throw new GaError(404, "找不到附件");
    if (msg.includes("ALREADY_DELETED")) throw new GaError(409, "附件已刪除");
    if (msg.includes("REASON_REQUIRED")) throw new GaError(400, "請輸入刪除原因");
    throw dbError(error);
  }
  return respond({ data: { id: data?.id ?? id } });
}

