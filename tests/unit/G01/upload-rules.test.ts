import { describe, expect, it } from 'vitest';
import {
  checkFile, checkFileCount, fileExtension, isPreviewableImage, normalizePurpose, scaledSize, storagePath, UPLOAD_LIMITS, SIGNED_URL_SECONDS,
} from '@/lib/workspace/general-affairs/upload-rules';

const MB = 1024 * 1024;
describe('Q3 附件規則：4MB 上限、格式、數量', () => {
  it('上限固定為 4MB、照片長邊 2000、一次 10 個', () => {
    expect(UPLOAD_LIMITS).toEqual({ maxFileBytes: 4 * MB, imageLongEdge: 2000, maxFilesPerRequest: 10 });
  });
  it('PDF 4MB 剛好可以，超過就擋並提示壓縮', () => {
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 4 * MB })).toEqual({ ok: true });
    const r = checkFile({ name: 'big.pdf', type: 'application/pdf', size: 4 * MB + 1 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('超過 4MB');
    expect(!r.ok && r.message).toContain('壓縮');
  });
  it('縮小後仍超過 4MB 的照片會被擋並提示', () => {
    const r = checkFile({ name: 'p.jpg', type: 'image/jpeg', size: 5 * MB });
    expect(!r.ok && r.message).toContain('照片縮小後仍有');
  });
  it('只收圖片與 PDF；空檔案不收', () => {
    expect(checkFile({ name: 'a.txt', type: 'text/plain', size: 10 }).ok).toBe(false);
    expect(checkFile({ name: 'a.exe', type: 'application/octet-stream', size: 10 }).ok).toBe(false);
    expect(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).ok).toBe(false);
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) expect(checkFile({ name: 'x', type, size: 100 }).ok).toBe(true);
  });
  it('一次最多 10 個、至少 1 個', () => {
    expect(checkFileCount(0).ok).toBe(false);
    expect(checkFileCount(1).ok).toBe(true);
    expect(checkFileCount(10).ok).toBe(true);
    expect(checkFileCount(11).ok).toBe(false);
  });
  it('HEIC 不能在多數電腦預覽，只有 JPEG／PNG／WebP 做預覽', () => {
    expect(isPreviewableImage('image/jpeg')).toBe(true);
    expect(isPreviewableImage('image/heic')).toBe(false);
    expect(isPreviewableImage('application/pdf')).toBe(false);
  });
});

describe('照片縮小尺寸（長邊約 2000 像素）', () => {
  it('長邊超過 2000 才等比縮小', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500, scaled: true });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1500, height: 2000, scaled: true });
    expect(scaledSize(2000, 1000)).toEqual({ width: 2000, height: 1000, scaled: false });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
  });
  it('極端比例不會縮成 0', () => {
    expect(scaledSize(20000, 1).height).toBe(1);
  });
});

describe('儲存路徑與用途', () => {
  it('路徑 = 資源類型小寫/資源 id/用途小寫/時間-uuid.副檔名（與舊版相同，舊照片不搬家）', () => {
    expect(storagePath('EQUIPMENT', 'rid', 'LABEL', 'uuid1', 'jpg', 123)).toBe('equipment/rid/label/123-uuid1.jpg');
  });
  it('副檔名：先看檔名，沒有就看格式', () => {
    expect(fileExtension('a.PDF', 'application/pdf')).toBe('pdf');
    expect(fileExtension('noext', 'application/pdf')).toBe('pdf');
    expect(fileExtension('noext', 'image/png')).toBe('png');
    expect(fileExtension('noext', 'image/heic')).toBe('heic');
    expect(fileExtension('x', 'image/jpeg')).toBe('jpg');
  });
  it('用途只收大寫英數底線', () => {
    expect(normalizePurpose('label')).toBe('LABEL');
    expect(normalizePurpose('')).toBe('GENERAL');
    expect(() => normalizePurpose('../x')).toThrow();
  });
  it('簽名網址是短效期：列表 10 分鐘、開啟 5 分鐘（不是舊版的 24 小時）', () => {
    expect(SIGNED_URL_SECONDS).toEqual({ list: 600, open: 300 });
  });
});
