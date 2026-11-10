import { deflateSync } from 'node:zlib';

// 測試用：產生 RGBA PNG（簽名圖片）。inkPixels = 在中間畫一條黑色橫線的像素數；transparent = 全透明。
function crc32(buf: Buffer) {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function makePng(opts: { width?: number; height?: number; inkPixels?: number; transparent?: boolean; colorful?: boolean } = {}): Buffer {
  const width = opts.width ?? 200;
  const height = opts.height ?? 60;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let ink = opts.inkPixels ?? 0;
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const o = y * (stride + 1) + 1 + x * 4;
      if (opts.colorful) {
        // 紅、綠、藍、黃色塊加對角線，一眼就看得出圖有沒有載入
        const band = Math.floor((x * 4) / width);
        const [r, g, b] = [[220, 40, 40], [40, 170, 60], [40, 80, 220], [240, 190, 30]][band];
        const diag = Math.abs(x - y * (width / height)) < 4;
        raw[o] = diag ? 255 : r;
        raw[o + 1] = diag ? 255 : g;
        raw[o + 2] = diag ? 255 : b;
        raw[o + 3] = 255;
        continue;
      }
      const drawn = ink > 0 && y === Math.floor(height / 2);
      if (drawn) {
        raw[o] = 20;
        raw[o + 1] = 20;
        raw[o + 2] = 20;
        raw[o + 3] = 255;
        ink--;
      } else if (opts.transparent) {
        raw[o + 3] = 0;
      } else {
        raw[o] = 255;
        raw[o + 1] = 255;
        raw[o + 2] = 255;
        raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const pngDataUrl = (png: Buffer) => 'data:image/png;base64,' + png.toString('base64');
export const SIGNED = () => pngDataUrl(makePng({ inkPixels: 150 }));
export const BLANK_WHITE = () => pngDataUrl(makePng());
export const BLANK_TRANSPARENT = () => pngDataUrl(makePng({ transparent: true }));
