// G18／G19 工單照片：簽名連結（每次開啟短效重簽）、新照片上傳（共用附件；只收圖片）、舊 maintenance_photos 唯讀合併。
// 上傳全成或全不變：先傳到儲存空間，任何一步失敗就移除這次剛傳的檔案（這些檔案還沒有任何紀錄指向它們，不是「刪除既有附件」）。
import { adminClient } from "../server";
import { fileExtension, IMAGE_TYPES, checkFile, checkTotalSize, SIGNED_URL_SECONDS, storagePath } from "./upload-rules";
import { mergePhotos, sniffImageType, type WoPhoto } from "./work-order-rules";
import { GaError } from "./server";

export const WO_BUCKET = "general-affairs-attachments";
export const LEGACY_BUCKET = "maintenance-photos";

/** 把附件與舊照片合併成同一個照片區並簽名（舊版 bucket 不存在或簽不出來時，該張網址為 null，不讓整頁失敗）。 */
export async function signPhotos(attachments: any[], legacy: any[]): Promise<WoPhoto[]> {
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, path: string) => { if (path) { if (!byBucket.has(bucket)) byBucket.set(bucket, new Set()); byBucket.get(bucket)!.add(path); } };
  for (const a of attachments || []) add(a.storage_bucket || WO_BUCKET, a.storage_path);
  for (const l of legacy || []) add(l.storage_bucket || LEGACY_BUCKET, l.storage_path);
  const urls = new Map<string, string>();
  const admin = adminClient();
  for (const [bucket, set] of Array.from(byBucket.entries())) {
    const paths = Array.from(set) as string[];
    try {
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS.list);
      if (error) throw error;
      (data || []).forEach((item, i) => { if (item?.signedUrl) urls.set(`${bucket}/${paths[i]}`, item.signedUrl); });
    } catch {
      // 舊版 bucket 缺失等：這一批不給連結，其他照片照常顯示。
    }
  }
  return mergePhotos(attachments, legacy, (bucket, path) => urls.get(`${bucket}/${path}`) ?? null);
}

export type UploadedImage = { path: string; file_name: string; content_type: string; size_bytes: number };

/** 檢查檔案都是圖片（Content-Type 與檔頭都要是圖片）、單檔與合計大小；不合格丟 400／413。 */
export async function checkImages(files: File[], max: number) {
  if (!files.length) throw new GaError(400, "請選擇要上傳的照片");
  if (files.length > max) throw new GaError(400, `最多只能附 ${max} 張照片`);
  for (const f of files) {
    const type = f.type || "application/octet-stream";
    if (!(IMAGE_TYPES as readonly string[]).includes(type)) throw new GaError(400, `${f.name}：這裡只收圖片（JPEG、PNG、WebP、HEIC），不收其他檔案`);
    const c = checkFile({ name: f.name, type, size: f.size });
    if (!c.ok) throw new GaError(400, c.message);
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    if (!sniffImageType(head)) throw new GaError(400, `${f.name}：檔案內容不是圖片，已擋下`);
  }
  const total = checkTotalSize(files.map((f) => f.size));
  if (!total.ok) throw new GaError(413, total.message);
}

/** 上傳到共用附件 bucket；回傳已上傳清單。呼叫端失敗時要用 removeUploaded 清掉。 */
export async function uploadImages(files: File[], resourceType: "MAINTENANCE_REQUEST" | "MAINTENANCE_UPDATE", resourceId: string, purpose: string, uploaded: string[]): Promise<UploadedImage[]> {
  const admin = adminClient();
  const out: UploadedImage[] = [];
  for (const f of files) {
    const type = f.type;
    const path = storagePath(resourceType, resourceId, purpose, crypto.randomUUID(), fileExtension(f.name, type));
    const { error } = await admin.storage.from(WO_BUCKET).upload(path, await f.arrayBuffer(), { contentType: type, upsert: false });
    if (error) throw new GaError(503, "檔案上傳失敗，請稍後重試");
    uploaded.push(path);
    out.push({ path, file_name: (f.name.trim().slice(0, 200) || "photo"), content_type: type, size_bytes: f.size });
  }
  return out;
}

export async function removeUploaded(paths: string[]) {
  if (paths.length) await adminClient().storage.from(WO_BUCKET).remove(paths).catch(() => undefined);
}
