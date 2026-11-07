import { inflateSync } from "node:zlib";

/**
 * M4 Q12：空白簽名不能算已簽名。
 * 伺服端解析簽名 PNG，確認真的有筆跡（不是全白或全透明的圖片）。
 * 簽名板輸出為 8 位元、非交錯的 PNG；其他格式的 data URL 一律視為無法確認。
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 至少要有這麼多個「有墨水」的像素才算簽過名（一個點擊不會產生筆跡）。 */
export const MIN_INK_PIXELS = 30;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function pngInkPixels(png: Buffer): number {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return -1;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (!channels || depth !== 8 || interlace !== 0 || !width || !height || width * height > 4_000_000) return -1;
  const stride = width * channels;
  let raw: Buffer;
  try {
    // 解壓後大小上限＝像素資料實際需要的大小，超過（壓縮炸彈）會丟錯而回 -1。
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  } catch {
    return -1;
  }
  if (raw.length < (stride + 1) * height) return -1;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let ink = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter > 4) return -1;
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = x * channels;
      let alpha = 255;
      let min: number;
      if (colorType === 6) {
        alpha = cur[o + 3];
        min = Math.min(cur[o], cur[o + 1], cur[o + 2]);
      } else if (colorType === 4) {
        alpha = cur[o + 1];
        min = cur[o];
      } else if (colorType === 2) min = Math.min(cur[o], cur[o + 1], cur[o + 2]);
      else min = cur[o];
      if (alpha > 32 && min < 200) ink++;
    }
    cur.copy(prev);
  }
  return ink;
}

/** true＝這張簽名圖片有實際筆跡。https 網址是先前已存的簽名，視為有效。 */
export function isSignedImage(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  if (/^https:\/\/\S+$/.test(value)) return true;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return false;
  return pngInkPixels(Buffer.from(m[1], "base64")) >= MIN_INK_PIXELS;
}

/** 正式送出（completed）前的簽名檢查；回傳錯誤訊息，沒有問題回 null。草稿不檢查。 */
export function completedSignatureError(
  signature: unknown,
  supervisorSignature: unknown,
): string | null {
  if (!signature || !supervisorSignature)
    return "正式送出必須有店長／當班主管與督導兩個簽名";
  if (!isSignedImage(signature) || !isSignedImage(supervisorSignature))
    return "簽名是空白的，請在簽名板上實際簽名後再送出";
  return null;
}
