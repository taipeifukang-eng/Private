// 全站共用上傳工具（M7/M8 Q2 從 M6 提前）：檔案檢查、照片縮小、預覽。
// 規則（Q3）：照片長邊縮到約 2000 像素；PDF 與其他檔最大 4MB；縮小後仍超過 4MB 的照片會被擋並提示。
// 規則本體在 lib/workspace/general-affairs/upload-rules.ts（伺服端用同一份檢查）。日後 M6 的改善單、巡店照片改接這裡即可。
import {
  checkFile,
  isPreviewableImage,
  isImageType,
  QUALITY_STEPS,
  scaledSize,
  UPLOAD_LIMITS,
} from "../../../lib/workspace/general-affairs/upload-rules";

export { UPLOAD_LIMITS, isImageType, isPreviewableImage };

export type PreparedFile = {
  id: string;
  file: File;
  /** 畫面預覽用的物件網址（只有 JPEG／PNG／WebP 會有；HEIC 與 PDF 顯示檔名）。 */
  previewUrl: string | null;
  /** 原始大小，用來顯示「已縮小」。 */
  originalSize: number;
  shrunk: boolean;
};
export type PrepareResult = { ok: true; item: PreparedFile } | { ok: false; message: string };

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** 長邊超過 2000 像素或超過 4MB 的 JPEG／PNG／WebP 縮成 JPEG；其餘原樣。 */
export async function shrinkImage(file: File): Promise<{ file: File; shrunk: boolean }> {
  if (!isPreviewableImage(file.type)) return { file, shrunk: false };
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    if (!size.scaled && file.size <= UPLOAD_LIMITS.maxFileBytes) return { file, shrunk: false };
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("瀏覽器無法處理照片");
    ctx.fillStyle = "#fff"; // PNG 透明背景轉 JPEG 時墊白底
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    let blob: Blob | null = null;
    for (const q of QUALITY_STEPS) {
      blob = await canvasBlob(canvas, q);
      if (blob && blob.size <= UPLOAD_LIMITS.maxFileBytes) break;
    }
    if (!blob) throw new Error("照片處理失敗");
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { file: new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified }), shrunk: true };
  } finally {
    bitmap.close();
  }
}

export async function prepareFile(file: File): Promise<PrepareResult> {
  if (file.size <= 0) return { ok: false, message: `${file.name}：是空檔案` };
  // 超過大小的圖片要縮小後才判斷；其他檔（PDF）在這裡就檢查大小。
  const pre = checkFile({ name: file.name, type: file.type, size: file.size });
  if (!pre.ok && !(isPreviewableImage(file.type) && file.size > UPLOAD_LIMITS.maxFileBytes)) return { ok: false, message: pre.message };
  let out = file;
  let shrunk = false;
  try {
    ({ file: out, shrunk } = await shrinkImage(file));
  } catch {
    return { ok: false, message: `${file.name}：照片無法讀取，請換一張` };
  }
  const check = checkFile({ name: out.name, type: out.type, size: out.size });
  if (!check.ok) return { ok: false, message: check.message };
  return {
    ok: true,
    item: {
      id: crypto.randomUUID(),
      file: out,
      previewUrl: isPreviewableImage(out.type) ? URL.createObjectURL(out) : null,
      originalSize: file.size,
      shrunk,
    },
  };
}

export function releasePreview(item: PreparedFile) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
