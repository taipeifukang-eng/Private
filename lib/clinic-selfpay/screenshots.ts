// 診所檔截圖規則（D6）：至少 1 張、單次最多 10 張、每張約 5MB 內（前端壓縮後）、只收 png／jpeg／webp。
// 永久保存直到刪批次；舊版沒有張數、大小與格式限制（差異已列白名單）。純函式，前後端共用。

export const SCREENSHOT_MAX_COUNT = 10;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SCREENSHOT_BUCKET = 'clinic-selfpay-screenshots';

export type ScreenshotLike = { name?: string; type?: string; size: number };

export function screenshotExt(type: string | undefined): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

/** 回傳第一個違規的說明；通過回傳 null。 */
export function validateScreenshots(files: ScreenshotLike[]): string | null {
  const usable = files.filter((f) => f && f.size > 0);
  if (!usable.length) return '請至少上傳 1 張健保系統截圖';
  if (usable.length > SCREENSHOT_MAX_COUNT) return `單次最多上傳 ${SCREENSHOT_MAX_COUNT} 張截圖，目前有 ${usable.length} 張`;
  for (const f of usable) {
    if (!(SCREENSHOT_TYPES as readonly string[]).includes(String(f.type || ''))) {
      return `截圖只接受 png、jpeg、webp 圖片格式（${f.name || '未命名'}）`;
    }
    if (f.size > SCREENSHOT_MAX_BYTES) {
      return `每張截圖壓縮後需在 5MB 以內（${f.name || '未命名'}）`;
    }
  }
  return null;
}

/** 依檔頭（magic bytes）判斷真實格式；不是 PNG／JPEG／WebP 就回傳 null。不信任瀏覽器自報的 type。 */
export function detectImageType(buf: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
