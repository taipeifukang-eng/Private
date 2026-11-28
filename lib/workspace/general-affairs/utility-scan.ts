// 水電帳單「手機掃 QR 拍照上傳」伺服端。
//   1. 發 QR（登入者）：POST /api/workspace/general-affairs/utility-bills/:id/scan-token；需要水電網費管理權限。權杖在這裡產生、只回給呼叫者一次，資料庫只存雜湊。
//   2. 公開上傳（不需登入，只認權杖）：/api/workspace/bill-scan-upload
//        GET  標頭 X-Scan-Token：回權杖是否有效、剩餘張數、到期時間（不回帳單任何資料）。
//        POST 標頭 X-Scan-Token ＋ multipart files：驗證權杖與檔案內容，上傳到這張帳單的 BILL_DOCUMENT，回新增張數。
//      這個路由「只能寫入」：沒有任何讀檔、列表、刪除、換帳單的功能；權杖放標頭，不放網址查詢字串（不進伺服器紀錄）。
//      權杖無效、過期、已作廢、不存在一律回同一個 403 與同一句話；每個 IP 有流量限制，連續失敗（每 IP 15 分鐘內 20 次）會被暫時封鎖。
import { randomBytes, createHash } from "crypto";
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { isUuid } from "./rules";
import { checkFile, checkFileCount, checkTotalSize, REQUEST_TOTAL_BYTES, storagePath } from "./upload-rules";
import {
  cleanFileName, clientKey, createLimiter, extensionOfMime, isScanToken, mimeMatches, scanBaseUrl, scanMessage, scanUrl, sniffMime, SCAN_API_PATH, SCAN_PURPOSE, SCAN_RESOURCE_TYPE, SCAN_TOKEN_HEADER,
} from "./utility-scan-rules";
import { utilityBillAbilities, UTILITY_BILL_MANAGE_LABEL } from "./utility-bill-rules";
import { GaError, respond, rpc, type Context } from "./server";

const BUCKET = "general-affairs-attachments";

export function newScanToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashScanToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** POST utility-bills/:id/scan-token（登入者）。 */
export async function scanTokenCreate(ctx: Context, request: NextRequest, billId: string) {
  if (!isUuid(billId)) throw new GaError(400, "帳單 id 格式錯誤");
  if (!utilityBillAbilities(ctx.permissions).canManage) throw new GaError(403, `沒有用手機上傳附件的權限（需要${UTILITY_BILL_MANAGE_LABEL}權限）`);
  const token = newScanToken();
  const r = await rpc(ctx, "ga_ws_ub_scan_token_create", { p_bill_id: billId, p_token_hash: hashScanToken(token) });
  const base = scanBaseUrl(process.env, request.nextUrl.origin);
  return respond({ data: { token, url: scanUrl(base, token), expires_at: r.data.expires_at, max_files: r.data.max_files } }, 201);
}

/** POST utility-bills/:id/scan-token-revoke（登入者）：關閉手機上傳視窗時，把自己對這張帳單發出的有效 QR 作廢。 */
export async function scanTokenRevoke(ctx: Context, billId: string) {
  if (!isUuid(billId)) throw new GaError(400, "帳單 id 格式錯誤");
  if (!utilityBillAbilities(ctx.permissions).canManage) throw new GaError(403, `沒有用手機上傳附件的權限（需要${UTILITY_BILL_MANAGE_LABEL}權限）`);
  const r = await rpc(ctx, "ga_ws_ub_scan_token_revoke", { p_bill_id: billId });
  return respond({ data: { revoked: r.data?.revoked ?? 0 } });
}

// ---- 公開上傳 ----
const ipLimiter = createLimiter({ limit: 60, windowMs: 60_000 });
const failLimiter = createLimiter({ limit: 20, windowMs: 15 * 60_000 });

function tooMany(retryAfterSec: number) {
  const res = respond({ error: "操作太頻繁，請稍後再試" }, 429);
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}
function fail(status: number, message: string, code?: string) {
  const res = respond(code ? { error: message, code } : { error: message }, status);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
const failedStatus = (d: any) => (d && d.ok === false ? Number(d.status) || 400 : 0);

/** 共同前置：IP 流量限制與「連續失敗封鎖」。回傳 Response 代表已被擋下。 */
function precheck(request: NextRequest) {
  const key = clientKey(request.headers.get("x-forwarded-for"));
  const hit = ipLimiter.hit(key);
  if (!hit.ok) return { key, blocked: tooMany(hit.retryAfterSec) };
  const b = failLimiter.blocked(key);
  if (!b.ok) return { key, blocked: tooMany(b.retryAfterSec) };
  return { key, blocked: null as Response | null };
}
/** 權杖無效：算一次失敗（20 次／15 分鐘後封鎖），回同一句話。 */
function invalid(key: string) {
  const f = failLimiter.hit(key);
  return f.ok ? fail(403, scanMessage("INVALID"), "INVALID") : tooMany(f.retryAfterSec);
}

async function status(hash: string) {
  const { data, error } = await adminClient().rpc("ga_ub_scan_token_status", { p_token_hash: hash });
  if (error) throw new GaError(503, "服務暫時無法使用，請稍後重試");
  return data as any;
}

/** GET：權杖狀態。 */
export async function publicScanStatus(request: NextRequest) {
  try {
    const { key, blocked } = precheck(request);
    if (blocked) return blocked;
    const token = request.headers.get(SCAN_TOKEN_HEADER) || "";
    if (!isScanToken(token)) return invalid(key);
    const d = await status(hashScanToken(token));
    if (d?.ok !== true) return d?.code === "INVALID" ? invalid(key) : fail(failedStatus(d) || 403, scanMessage(d?.code), d?.code);
    const res = respond({ ok: true, expires_at: d.data.expires_at, remaining: d.data.remaining, max_files: d.data.max_files });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    if (error instanceof GaError) return fail(error.status, error.message);
    return fail(503, "服務暫時無法使用，請稍後重試");
  }
}

/** POST：上傳。 */
export async function publicScanUpload(request: NextRequest) {
  const uploaded: string[] = [];
  const admin = (() => {
    try { return adminClient(); } catch { return null; }
  })();
  try {
    const { key, blocked } = precheck(request);
    if (blocked) return blocked;
    const bad = () => invalid(key);
    const token = request.headers.get(SCAN_TOKEN_HEADER) || "";
    if (!isScanToken(token)) return bad();
    if (!admin) return fail(503, "服務暫時無法使用，請稍後重試");
    const hash = hashScanToken(token);
    const st = await status(hash);
    if (st?.ok !== true) {
      if (st?.code === "INVALID") return bad();
      return fail(failedStatus(st) || 403, scanMessage(st?.code), st?.code);
    }
    const billId = String(st.data.bill_id);
    const remaining = Number(st.data.remaining);

    // 先看標頭宣告的大小，過大不解析
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > REQUEST_TOTAL_BYTES + 512 * 1024) return fail(413, "檔案太大，請縮小後再傳（單次合計不能超過 4.25MB）");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "上傳內容格式錯誤，或檔案太大（單檔上限 4MB）");
    }
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    const count = checkFileCount(files.length);
    if (!count.ok) return fail(400, count.message);
    if (files.length > remaining) return fail(409, scanMessage("FULL") + `（還可以傳 ${remaining} 張）`, "FULL");
    for (const f of files) {
      const c = checkFile({ name: f.name, type: f.type || "application/octet-stream", size: f.size });
      if (!c.ok) return fail(400, c.message);
    }
    const total = checkTotalSize(files.map((f) => f.size));
    if (!total.ok) return fail(413, total.message);

    const records: Record<string, unknown>[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = await f.arrayBuffer();
      const sniffed = sniffMime(new Uint8Array(buf.slice(0, 16)));
      if (!mimeMatches(f.type, sniffed)) return fail(400, `${cleanFileName(f.name) || "檔案"}：檔案內容與格式不符，只收圖片與 PDF`);
      // 副檔名由偵測到的實際格式決定，不採用使用者檔名的副檔名
      const path = storagePath(SCAN_RESOURCE_TYPE, billId, SCAN_PURPOSE, crypto.randomUUID(), extensionOfMime(sniffed));
      const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: f.type, upsert: false });
      if (error) throw new GaError(503, "檔案上傳失敗，請稍後重試");
      uploaded.push(path);
      records.push({ storage_path: path, file_name: cleanFileName(f.name).slice(0, 200) || "photo.jpg", content_type: f.type, size_bytes: f.size });
    }
    const { data, error } = await admin.rpc("ga_ub_scan_token_commit", { p_token_hash: hash, p_records: records });
    if (error) throw new GaError(503, "服務暫時無法使用，請稍後重試");
    const d = data as any;
    if (d?.ok !== true) {
      await admin.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
      uploaded.length = 0;
      if (d?.code === "INVALID") return bad();
      return fail(failedStatus(d) || 400, d?.error || scanMessage(d?.code), d?.code);
    }
    const res = respond({ ok: true, added: d.data.added, remaining: d.data.remaining }, 201);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    // 全成或全不變：這次剛傳的實體檔移除（還沒有任何紀錄指向它們）
    if (uploaded.length && admin) await admin.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
    if (error instanceof GaError) return fail(error.status, error.message);
    return fail(503, "服務暫時無法使用，請稍後重試");
  }
}

export { SCAN_API_PATH };
