// 診所截圖壓縮的尺寸與檔名規則（M6 W31）：長邊縮到 1920px、不放大、至少 1px；轉 JPEG 品質 0.85。純函式，前端壓縮與單元測試共用。
export const MAX_SIDE = 1920;
export const JPEG_QUALITY = 0.85;

/** 長邊超過上限才等比縮小，否則維持原尺寸；輸出至少 1x1。 */
export function fitWithin(width: number, height: number, maxSide: number = MAX_SIDE): { width: number; height: number } {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const longest = Math.max(w, h);
  const ratio = longest > 0 ? Math.min(1, maxSide / longest) : 1;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

/** 壓縮後檔名：去掉原副檔名、改 .jpg。 */
export function compressedName(name: string): string {
  return String(name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
}
