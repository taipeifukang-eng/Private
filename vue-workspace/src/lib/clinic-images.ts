// 診所自費藥截圖前處理（M6 W30/W31）：長邊縮到 1920px、轉 JPEG 品質 0.85（沿用舊版數值），讓每張壓縮後約在 5MB 內。
// 尺寸與檔名規則在 lib/clinic-selfpay/image-sizing.ts（純函式）。讀不了的圖原樣回傳（伺服端另有格式與大小檢查，會明確告知）。
import { JPEG_QUALITY, compressedName, fitWithin } from "../../../lib/clinic-selfpay/image-sizing";

export function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { width: w, height: h } = fitWithin(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(file);
        ctx.fillStyle = "#ffffff"; // 透明底的 png 轉 JPEG 會變黑，先鋪白底
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob ? new File([blob], compressedName(file.name), { type: "image/jpeg" }) : file), "image/jpeg", JPEG_QUALITY);
      } catch {
        resolve(file);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

/** 貼上事件裡的圖片檔（沿用舊版：檔名 clipboard_<時間>_<亂數>.<副檔名>）。 */
export function imagesFromClipboard(event: ClipboardEvent): File[] {
  const out: File[] = [];
  for (const item of Array.from(event.clipboardData?.items || [])) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    const ext = (file.type.split("/")[1] || "png").toLowerCase();
    out.push(new File([file], `clipboard_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`, { type: file.type }));
  }
  return out;
}
