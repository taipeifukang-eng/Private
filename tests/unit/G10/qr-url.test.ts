import { describe, expect, it } from 'vitest';
import {
  applyLabelLimit, getQrBaseUrl, isProductionRuntime, isValidQrToken, labelExclusion, labelWatermark, QR_LABEL_LIMIT, qrUrlFor, QrUrlError, scanRedirectEnabled, workspaceScanTarget,
} from '../../../lib/workspace/general-affairs/qr-url';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4';
const DEV_URL = 'https://mjpdfpxqttbhzeimmtqr.supabase.co';
const PROD_URL = 'https://odvksgucvfoaqrumpran.supabase.co';

describe('G10 QR 網址規則（Q9）', () => {
  it('網域取自 NEXT_PUBLIC_SITE_URL：trim、去結尾斜線', () => {
    expect(getQrBaseUrl({ NEXT_PUBLIC_SITE_URL: ' https://example.com/ ' })).toBe('https://example.com');
    expect(getQrBaseUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3002///' })).toBe('http://localhost:3002');
  });
  it('缺值、空白、含路徑、非 http 一律報錯，且不會退回其他網址', () => {
    for (const v of [undefined, '', '   ', 'https://example.com/app', 'ftp://example.com', 'example.com', 'https://', 'https://exa mple.com', 'https://a.com?x=1']) {
      expect(() => getQrBaseUrl({ NEXT_PUBLIC_SITE_URL: v }), String(v)).toThrow(QrUrlError);
    }
    // 即使有其他看起來像網址的環境變數，也不能拿來用。
    expect(() => getQrBaseUrl({ VERCEL_URL: 'x.vercel.app', WORKSPACE_ORIGIN: 'http://localhost:5173' })).toThrow(/尚未設定/);
  });
  it('錯誤訊息是白話，指出要設定的變數名稱', () => {
    try { getQrBaseUrl({}); } catch (e) { expect((e as QrUrlError).status).toBe(500); expect((e as Error).message).toContain('NEXT_PUBLIC_SITE_URL'); }
  });
  it('永久網址 = 網域 + /general-affairs/assets/scan/ + token，token 原樣沿用', () => {
    expect(qrUrlFor(TOKEN, { NEXT_PUBLIC_SITE_URL: 'https://example.com/' })).toBe(`https://example.com/general-affairs/assets/scan/${TOKEN}`);
  });
  it('token 格式不符不產生網址', () => {
    for (const t of ['', 'short', 'UPPERCASEUPPERCASEUPPERCASE', 'abc-abc-abc-abc-abc-abc-abc', '../../etc/passwd'.padEnd(30, 'a')]) {
      expect(isValidQrToken(t)).toBe(false);
      expect(() => qrUrlFor(t, { NEXT_PUBLIC_SITE_URL: 'https://example.com' })).toThrow(QrUrlError);
    }
    expect(isValidQrToken(TOKEN)).toBe(true);
    expect(isValidQrToken('a'.repeat(64))).toBe(true);
    expect(isValidQrToken('a'.repeat(65))).toBe(false);
  });
});

describe('G10 正式環境與測試浮水印', () => {
  it('Vercel production 一定是正式環境，不加浮水印', () => {
    const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: DEV_URL };
    expect(isProductionRuntime(env)).toBe(true);
    expect(labelWatermark(env)).toBe(false);
  });
  it('資料庫不是測試專案 = 正式環境', () => {
    expect(isProductionRuntime({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL })).toBe(true);
    expect(isProductionRuntime({})).toBe(true); // 讀不到設定時保守視為正式（不會誤加浮水印，但缺網域會先報錯）
  });
  it('測試專案且非 Vercel production = 非正式，標籤加「測試」浮水印', () => {
    expect(isProductionRuntime({ NEXT_PUBLIC_SUPABASE_URL: DEV_URL })).toBe(false);
    expect(isProductionRuntime({ NEXT_PUBLIC_SUPABASE_URL: DEV_URL, VERCEL_ENV: 'preview' })).toBe(false);
    expect(labelWatermark({ NEXT_PUBLIC_SUPABASE_URL: DEV_URL })).toBe(true);
  });
});

describe('G10 掃描網址轉址旗標（解讀 k）', () => {
  it('預設關閉；只有 true 才開', () => {
    expect(scanRedirectEnabled({})).toBe(false);
    for (const v of ['', 'false', '1', 'yes', 'on']) expect(scanRedirectEnabled({ WORKSPACE_SCAN_REDIRECT: v })).toBe(false);
    expect(scanRedirectEnabled({ WORKSPACE_SCAN_REDIRECT: 'true' })).toBe(true);
    expect(scanRedirectEnabled({ WORKSPACE_SCAN_REDIRECT: ' TRUE ' })).toBe(true);
  });
  it('轉址目標是新版深連結', () => {
    expect(workspaceScanTarget(TOKEN)).toBe(`/workspace/index.html#/open/ga-asset-scan/${TOKEN}`);
  });
});

describe('G10 標籤排除與上限', () => {
  const base = { id: '1', name: 'x', code: 'C1', status: 'ACTIVE', qr_token: TOKEN, qr_token_revoked_at: null, deleted_at: null };
  it('正常的可印', () => {
    expect(labelExclusion('EQUIPMENT', base)).toBeNull();
    expect(labelExclusion('FACILITY', base)).toBeNull();
    expect(labelExclusion('EQUIPMENT', { ...base, status: 'RETIRED' })).toBeNull(); // 設備退役 QR 不作廢（舊版行為）
  });
  it('報廢設備、退役設施、已刪除、QR 作廢、無 token 都排除並給原因', () => {
    expect(labelExclusion('EQUIPMENT', { ...base, status: 'SCRAPPED' })?.reason).toBe('SCRAPPED');
    expect(labelExclusion('FACILITY', { ...base, status: 'RETIRED' })?.reason).toBe('RETIRED');
    expect(labelExclusion('FACILITY', { ...base, status: 'SCRAPPED' })).toBeNull(); // 設施沒有報廢狀態
    expect(labelExclusion('EQUIPMENT', { ...base, deleted_at: '2026-01-01' })?.reason).toBe('DELETED');
    expect(labelExclusion('EQUIPMENT', { ...base, qr_token_revoked_at: '2026-01-01' })?.reason).toBe('REVOKED');
    expect(labelExclusion('EQUIPMENT', { ...base, qr_token: null })?.reason).toBe('NO_TOKEN');
    expect(labelExclusion('EQUIPMENT', { ...base, status: 'SCRAPPED' })?.message).toContain('作廢');
  });
  it('沒有編號仍可印（由 API 加警告，不在排除）', () => {
    expect(labelExclusion('EQUIPMENT', { ...base, code: null })).toBeNull();
  });
  it('單次上限 300 張，超過截斷並標記', () => {
    expect(QR_LABEL_LIMIT).toBe(300);
    const many = Array.from({ length: 301 }, (_, i) => i);
    const r = applyLabelLimit(many);
    expect(r.items).toHaveLength(300);
    expect(r.truncated).toBe(true);
    expect(applyLabelLimit(many.slice(0, 300)).truncated).toBe(false);
    expect(applyLabelLimit([]).items).toEqual([]);
  });
});
