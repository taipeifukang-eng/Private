import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { publicRedirectEnabled, workspaceEntryNoStore } from '@/lib/workspace/middleware-rules';
import { DEV_REF } from '@/lib/workspace/site-gate';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const PROD_URL = 'https://abcdefghijklmnopqrst.supabase.co';

describe('WS-MW 轉址開關', () => {
  it('正式區沒設旗標：不轉址', () => {
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL })).toBe(false);
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: 'production' })).toBe(false);
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, WORKSPACE_PUBLIC_REDIRECT_ENABLED: 'false' })).toBe(false);
    expect(publicRedirectEnabled({})).toBe(false);
  });
  it('WORKSPACE_ENABLED / AUDIENCE 不會連帶開啟轉址', () => {
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, WORKSPACE_ENABLED: 'true', WORKSPACE_AUDIENCE: 'all' })).toBe(false);
  });
  it('DEV 網址維持原行為；正式區可用旗標明確開啟', () => {
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co` })).toBe(true);
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, WORKSPACE_PUBLIC_REDIRECT_ENABLED: 'true' })).toBe(true);
  });
  it('網址不合法時不轉址', () => {
    expect(publicRedirectEnabled({ NEXT_PUBLIC_SUPABASE_URL: 'not a url' })).toBe(false);
  });
});

describe('WS-MW 入口頁不快取', () => {
  it('三個入口路徑一律 no-store', () => {
    for (const p of ['/workspace', '/workspace/', '/workspace/index.html']) expect(workspaceEntryNoStore(p), p).toBe(true);
    for (const p of ['/workspace/assets/a.js', '/', '/workspaces']) expect(workspaceEntryNoStore(p), p).toBe(false);
  });
});

describe('WS-MW 接線', () => {
  it('middleware 不再有 DEV ref 字面值，no-store 不綁 isDevWorkspace', () => {
    const m = read('middleware.ts');
    expect(m).not.toContain(DEV_REF);
    expect(m).toContain('publicRedirectEnabled(process.env)');
    expect(m).toMatch(/if \(workspaceEntryNoStore\(request\.nextUrl\.pathname\)\)/);
    expect(m).toMatch(/if \(isDevWorkspace\) \{[\s\S]*resolveWorkspacePublicRedirect/);
  });
  it('next.config.js 有入口 no-store、assets immutable，且保留 sw.js', () => {
    const c = read('next.config.js');
    expect(c).toContain("source: '/workspace/index.html'");
    expect(c).toContain("source: '/workspace/assets/:path*'");
    expect(c).toContain('public, max-age=31536000, immutable');
    expect(c).toContain("source: '/sw.js'");
  });
  it('sw.js 不攔截 API 與頁面導覽', () => {
    const s = read('public/sw.js');
    expect(s).toContain("request.url.includes('/api/')");
    expect(s).toContain("request.mode === 'navigate'");
  });
});
