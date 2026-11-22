// 繳費證明上限：新舊版實際行為相同（超過 3.5 MB 即擋下），畫面文字統一顯示 3.5 MB（M1 P01）。
export const MOBILE_SAFE_MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
export const PROOF_LIMIT_LABEL = '3.5 MB';
export const PROOF_TOO_LARGE_MESSAGE = `檔案過大，請壓縮至 ${PROOF_LIMIT_LABEL} 以內`;
export const PROOF_FIELD_HINT = `大張照片會嘗試壓縮，上傳檔案需在 ${PROOF_LIMIT_LABEL} 以內。`;

/** 壓縮後仍超過上限（舊版同一條件：size > 3.5 MB）。 */
export function isProofTooLarge(size: number): boolean {
  return size > MOBILE_SAFE_MAX_UPLOAD_BYTES;
}

/**
 * 執照更新日是否逾期（舊版 PharmacistMasterList：new Date(date) < new Date()）。
 * 空值不逾期；日期字串以 UTC 午夜解析，與舊版 new Date('YYYY-MM-DD') 相同，今天當天的日期視為已逾期（午夜早於現在）。
 */
export function isLicenseOverdue(date: string | null | undefined, now: Date = new Date()): boolean {
  if (!date) return false;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed < now;
}

/** 督導區卡片的門市數與藥師數（舊版 PharmacistSupervisorCards 標頭）。 */
export function zoneTotals(card: { stores?: Array<{ pharmacistCount?: number }> }) {
  const stores = card.stores || [];
  return { stores: stores.length, pharmacists: stores.reduce((sum, s) => sum + Number(s.pharmacistCount || 0), 0) };
}
export async function compressImageForMobile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= MOBILE_SAFE_MAX_UPLOAD_BYTES) return file;

  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('無法讀取圖片'));
      el.src = objectUrl;
    });

    let targetW = img.naturalWidth;
    let targetH = img.naturalHeight;
    const longest = Math.max(targetW, targetH);
    if (longest > 1920) {
      const ratio = 1920 / longest;
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    canvas.width = targetW;
    canvas.height = targetH;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let bestBlob: Blob | null = null;
    const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54];

    for (const quality of qualitySteps) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });
      if (!blob) continue;
      bestBlob = blob;
      if (blob.size <= MOBILE_SAFE_MAX_UPLOAD_BYTES) break;
    }

    if (!bestBlob) return file;
    if (bestBlob.size >= file.size) return file;

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([bestBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

