const MOBILE_SAFE_MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
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

