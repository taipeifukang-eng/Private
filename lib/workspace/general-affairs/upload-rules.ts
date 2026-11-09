// 共用上傳工具規則（Q2、Q3）：Vue 前端與伺服端共用，無相依。
// Q2：只做上傳、照片縮小、預覽、檔案檢查；放成全站共用（M6 之後只需把改善單、巡店等舊頁面改接同一個）。
// Q3：照片長邊縮到約 2000 像素；其他檔（PDF）最大 4MB；刪除只標記、實體檔保留（伺服端不呼叫 storage remove）。

export const UPLOAD_LIMITS = {
  /** 非圖片檔（PDF）與縮小後照片的位元組上限（主機單次請求約 4.5MB，留餘裕）。 */
  maxFileBytes: 4 * 1024 * 1024,
  /** 照片長邊像素。 */
  imageLongEdge: 2000,
  /** 單次最多檔案數。 */
  maxFilesPerRequest: 10,
} as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const UPLOAD_ACCEPT_TYPES = [...IMAGE_TYPES, "application/pdf"] as const;
/** 瀏覽器端能縮小的格式（HEIC／HEIF 多數電腦無法解碼，原檔直接上傳，仍受 4MB 限制）。 */
export const RESIZABLE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const RESOURCE_TYPES = [
  "EQUIPMENT", "FACILITY", "PART", "MAINTENANCE_REQUEST", "MAINTENANCE_UPDATE", "SERVICE_REQUEST", "SERVICE_REQUEST_COMMENT", "UTILITY_BILL",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const isImageType = (t: string) => (IMAGE_TYPES as readonly string[]).includes(t);
export const isPreviewableImage = (t: string) => (RESIZABLE_TYPES as readonly string[]).includes(t);
export const isResourceType = (v: string): v is ResourceType => (RESOURCE_TYPES as readonly string[]).includes(v);

export type FileCheck = { ok: true } | { ok: false; message: string };

/** 檔案檢查（前後端同一套）：格式、空檔、大小。size 為處理後（縮小後）的大小。 */
export function checkFile(file: { name: string; type: string; size: number }): FileCheck {
  if (!(UPLOAD_ACCEPT_TYPES as readonly string[]).includes(file.type)) return { ok: false, message: `${file.name}：只收圖片（JPEG、PNG、WebP、HEIC）與 PDF` };
  if (file.size <= 0) return { ok: false, message: `${file.name}：是空檔案` };
  if (file.size > UPLOAD_LIMITS.maxFileBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      message: isImageType(file.type)
        ? `${file.name}：照片縮小後仍有 ${mb}MB，超過 4MB，請換一張或先縮小再傳`
        : `${file.name}：檔案 ${mb}MB 超過 4MB 上限，請壓縮後再傳（例如請廠商提供較小的 PDF）`,
    };
  }
  return { ok: true };
}

/** 單次請求檔案合計上限：主機單次請求約 4.5MB，扣掉 multipart 開銷留 0.25MB 餘裕。 */
export const REQUEST_TOTAL_BYTES = 4 * 1024 * 1024 + 256 * 1024;

/** 一次請求的檔案總量檢查（前後端同一套）；超過請分批上傳。 */
export function checkTotalSize(sizes: number[]): FileCheck {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > REQUEST_TOTAL_BYTES) {
    return { ok: false, message: `這次選的檔案合計 ${(total / 1024 / 1024).toFixed(1)}MB，單次上傳合計不能超過 4.25MB，請分批上傳（每次少選幾個檔案）` };
  }
  return { ok: true };
}

export function checkFileCount(count: number): FileCheck {
  if (count <= 0) return { ok: false, message: "請選擇要上傳的附件" };
  if (count > UPLOAD_LIMITS.maxFilesPerRequest) return { ok: false, message: `單次最多上傳 ${UPLOAD_LIMITS.maxFilesPerRequest} 個附件` };
  return { ok: true };
}

/** 縮小後的尺寸：長邊超過 limit 才等比縮小，否則維持原尺寸。 */
export function scaledSize(width: number, height: number, longEdge: number = UPLOAD_LIMITS.imageLongEdge) {
  const edge = Math.max(width, height);
  if (!edge || edge <= longEdge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), scaled: false };
  const ratio = longEdge / edge;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), scaled: true };
}

/** 照片縮小後的 JPEG 品質階梯：一次比一次低，直到不超過上限。 */
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5] as const;

export function normalizePurpose(value: unknown) {
  const purpose = String(value || "GENERAL").trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,40}$/.test(purpose)) throw new Error("附件用途格式錯誤");
  return purpose;
}

export function fileExtension(name: string, type: string) {
  const fromName = name.includes(".") ? name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (fromName && fromName.length <= 8) return fromName;
  if (type === "application/pdf") return "pdf";
  if (type.includes("webp")) return "webp";
  if (type.includes("png")) return "png";
  if (type.includes("heic")) return "heic";
  if (type.includes("heif")) return "heif";
  return "jpg";
}

/** 儲存路徑：<resource>/<id>/<purpose>/<時間>-<uuid>.<ext>（與舊版相同，工單照片等舊路徑不搬家）。 */
export function storagePath(resourceType: string, resourceId: string, purpose: string, uuid: string, ext: string, now = Date.now()) {
  return `${resourceType.toLowerCase()}/${resourceId}/${purpose.toLowerCase()}/${now}-${uuid}.${ext}`;
}

/** 簽名網址有效秒數：每次開啟重新簽發（Q3 沿用）。列表縮圖 10 分鐘，點開／下載 5 分鐘。 */
export const SIGNED_URL_SECONDS = { list: 600, open: 300 } as const;
