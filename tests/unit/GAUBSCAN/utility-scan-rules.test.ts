import { describe, expect, it } from 'vitest';
import {
  clientKey, createLimiter, isScanHash, isScanToken, mimeMatches, scanBaseUrl, scanMessage, scanUrl, sniffMime,
  SCAN_PAGE_PATH, SCAN_PURPOSE, SCAN_RESOURCE_TYPE, SCAN_TOKEN_MAX_FILES, SCAN_TOKEN_TTL_MINUTES,
} from '@/lib/workspace/general-affairs/utility-scan-rules';
import { hashScanToken, newScanToken } from '@/lib/workspace/general-affairs/utility-scan';

// 水電帳單手機掃 QR 上傳：權杖產生與雜湊、規則常數、網址、檔頭檢查、流量限制。
describe('權杖', () => {
  it('每次產生 43 字元 base64url 隨機權杖，彼此不同，格式檢查通過', () => {
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < 200; i += 1) {
      const t = newScanToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isScanToken(t)).toBe(true);
      expect(seen[t]).toBeUndefined();
      seen[t] = true;
    }
  });
  it('雜湊是 SHA-256 十六進位 64 字元，同權杖同雜湊，不含權杖本身', () => {
    const t = newScanToken();
    const h = hashScanToken(t);
    expect(isScanHash(h)).toBe(true);
    expect(hashScanToken(t)).toBe(h);
    expect(h).not.toContain(t);
    expect(hashScanToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashScanToken(newScanToken())).not.toBe(h);
  });
  it('錯誤格式的權杖一律不通過', () => {
    for (const bad of ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '/', ' ' + 'a'.repeat(42), null, undefined, 123, "' OR 1=1 --" + 'a'.repeat(40)]) {
      expect(isScanToken(bad as any), String(bad)).toBe(false);
    }
    expect(isScanHash('A'.repeat(64))).toBe(false);
    expect(isScanHash('a'.repeat(63))).toBe(false);
  });
  it('規則常數：15 分鐘、10 張、只寫帳單掃描檔', () => {
    expect(SCAN_TOKEN_TTL_MINUTES).toBe(15);
    expect(SCAN_TOKEN_MAX_FILES).toBe(10);
    expect(SCAN_PURPOSE).toBe('BILL_DOCUMENT');
    expect(SCAN_RESOURCE_TYPE).toBe('UTILITY_BILL');
  });
});

describe('QR 網址', () => {
  const t = 'a'.repeat(43);
  it('WORKSPACE_ORIGIN 清單含目前網域就用目前網域，否則用第一個，沒設用目前網址', () => {
    const env = { WORKSPACE_ORIGIN: 'https://a.example.com/, https://b.example.com' };
    expect(scanBaseUrl(env, 'https://b.example.com')).toBe('https://b.example.com');
    expect(scanBaseUrl(env, 'http://localhost:3002')).toBe('https://a.example.com');
    expect(scanBaseUrl({}, 'http://localhost:3002/')).toBe('http://localhost:3002');
    expect(scanBaseUrl({ WORKSPACE_ORIGIN: '  ' }, 'http://x.test')).toBe('http://x.test');
  });
  it('網址把權杖放在 hash 路徑（不進伺服器紀錄與 Referer）', () => {
    const u = scanUrl('https://a.example.com/', t);
    expect(u).toBe('https://a.example.com' + SCAN_PAGE_PATH + t);
    expect(u).toContain('#/bill-scan/');
    expect(u).not.toContain('?');
  });
});

describe('訊息', () => {
  it('無效、過期、不存在共用同一句，不洩漏差別；超量與鎖定各有白話說明', () => {
    expect(scanMessage('INVALID')).toContain('無效或已過期');
    expect(scanMessage('FULL')).toContain('10 張');
    expect(scanMessage('BILL_LOCKED')).toContain('鎖定');
    expect(scanMessage(undefined)).toBe('上傳失敗，請稍後重試');
  });
});

describe('檔案內容檢查', () => {
  const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(16).fill(0)]);
  it('辨識 JPEG、PNG、WebP、PDF、HEIC', () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe('application/pdf');
    expect(sniffMime(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toBe('image/heic');
    expect(sniffMime(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31))).toBe('image/heif');
  });
  it('網頁、腳本、可執行檔、空內容都不是', () => {
    expect(sniffMime(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(bytes(0x4d, 0x5a))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
  it('宣稱類型與檔頭不一致就拒絕（HEIC／HEIF 互通）', () => {
    expect(mimeMatches('image/jpeg', 'image/jpeg')).toBe(true);
    expect(mimeMatches('image/png', 'image/jpeg')).toBe(false);
    expect(mimeMatches('image/jpeg', null)).toBe(false);
    expect(mimeMatches('image/heif', 'image/heic')).toBe(true);
  });
});

describe('流量限制', () => {
  it('視窗內超過上限就擋並回等待秒數，視窗過後重新計算，各 key 獨立', () => {
    let now = 1_000_000;
    const l = createLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i += 1) expect(l.hit('1.1.1.1').ok).toBe(true);
    const r = l.hit('1.1.1.1');
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(60);
    expect(l.hit('2.2.2.2').ok).toBe(true);
    now += 61_000;
    expect(l.hit('1.1.1.1').ok).toBe(true);
  });
  it('blocked 只看不計；reset 可解除', () => {
    const now = 5_000;
    const l = createLimiter({ limit: 2, windowMs: 1000, now: () => now });
    l.hit('k');
    l.hit('k');
    expect(l.blocked('k').ok).toBe(true);
    l.hit('k');
    expect(l.blocked('k').ok).toBe(false);
    expect(l.blocked('k').ok).toBe(false);
    l.reset('k');
    expect(l.blocked('k').ok).toBe(true);
  });
  it('key 太多時清表避免記憶體無限成長', () => {
    const l = createLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    for (let i = 0; i < 10; i += 1) expect(l.hit('k' + i).ok).toBe(true);
  });
  it('clientKey 取 x-forwarded-for 第一段，沒有就歸 unknown', () => {
    expect(clientKey('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4');
    expect(clientKey(null)).toBe('unknown');
    expect(clientKey('')).toBe('unknown');
  });
});
