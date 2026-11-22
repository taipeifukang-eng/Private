// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatBytes, prepareFile } from '../../../vue-workspace/src/lib/upload';

const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });
describe('全站共用上傳工具（前端檢查）', () => {
  it('超過 4MB 的 PDF 直接擋下並提示', async () => {
    const r = await prepareFile(file('a.pdf', 'application/pdf', 4 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('超過 4MB');
  });
  it('正常 PDF 通過，沒有預覽圖、不標示縮小', async () => {
    const r = await prepareFile(file('a.pdf', 'application/pdf', 1000));
    expect(r.ok).toBe(true);
    expect(r.ok && r.item.previewUrl).toBeNull();
    expect(r.ok && r.item.shrunk).toBe(false);
  });
  it('不支援的格式、空檔案被擋', async () => {
    expect((await prepareFile(file('a.txt', 'text/plain', 10))).ok).toBe(false);
    expect((await prepareFile(file('a.pdf', 'application/pdf', 0))).ok).toBe(false);
  });
  it('HEIC 不縮小、原檔通過（只看大小），不產生預覽', async () => {
    const r = await prepareFile(file('a.heic', 'image/heic', 2000));
    expect(r.ok).toBe(true);
    expect(r.ok && r.item.previewUrl).toBeNull();
  });
  it('大小顯示', () => {
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
  });
});
