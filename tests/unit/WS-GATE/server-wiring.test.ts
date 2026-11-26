import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const jwt = (ref: string, role: string) =>
  `h.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.s`;
const DEV = 'mjpdfpxqttbhzeimmtqr';
const PROD = 'abcdefghijklmnopqrst';
const envFor = (ref: string, extra: Record<string, string> = {}) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  EXPECTED_SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(ref, 'anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, 'service_role'),
  WORKSPACE_ENABLED: 'true',
  ...extra,
});

// 假的 supabase：getUser 回固定使用者；profiles.role 由 state 決定
const state = { admin: false };
vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/server', () => ({ NextResponse: { json: (b: unknown, i: any) => ({ body: b, status: i?.status ?? 200 }) } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { id: 'u1', full_name: 'x', role: state.admin ? 'admin' : 'staff' }, error: null }),
        then: (res: any) => res({ data: [], error: null }),
      };
      return q;
    },
  }),
}));

import { WorkspaceError, assertWorkspace, checkOrigin, context } from '@/lib/workspace/server';

const saved = { ...process.env };
const setEnv = (e: Record<string, string>) => {
  process.env = { ...saved } as any;
  for (const k of ['WORKSPACE_ENABLED', 'WORKSPACE_DEV_ENABLED', 'WORKSPACE_AUDIENCE', 'WORKSPACE_ORIGIN', 'WORKSPACE_ALLOWED_REFS', 'VERCEL_ENV', 'VERCEL_URL', 'WORKSPACE_CALENDAR_MOCK'])
    delete (process.env as any)[k];
  Object.assign(process.env, e);
};
const status = async (p: unknown) => { try { await p; return 200; } catch (e: any) { return e instanceof WorkspaceError ? e.status : -1; } };
const msgOf = (f: () => void) => { try { f(); return ''; } catch (e: any) { return String(e.message); } };

afterEach(() => { process.env = { ...saved } as any; });

describe('server.ts 接線（原始碼）', () => {
  const src = read('lib/workspace/server.ts');
  it('保留函式名稱與 context 的 resolveAccess／Promise.all 接線', () => {
    for (const n of ['export function assertWorkspace', 'export function checkOrigin', 'export function sessionClient', 'export function adminClient', 'export async function context'])
      expect(src).toContain(n);
    expect(src).toContain('resolveAccess(');
    expect(src).toContain('Promise.all([');
  });
  it('改用 site-gate，server.ts 不再有 DEV ref 字面值', () => {
    expect(src).toContain('evaluateGate(process.env)');
    expect(src).toContain('allowedOrigin(process.env');
    expect(src).not.toContain('mjpdfpxqttbhzeimmtqr');
  });
  it('session 路由用 audienceCheck:false，並以 environmentName 取代寫死的 DEV', () => {
    const route = read('app/api/workspace/session/route.ts');
    expect(route).toContain('context({ audienceCheck: false })');
    expect(route).toContain('environment: environmentName(process.env)');
    expect(route).not.toContain('environment: "DEV"');
    expect(route).toContain('siteState');
  });
});

describe('assertWorkspace', () => {
  it('開關關閉：503「新版暫時關閉」', async () => {
    setEnv(envFor(DEV, { WORKSPACE_ENABLED: 'false' }));
    expect(msgOf(assertWorkspace)).toBe('新版暫時關閉');
    expect(await status((async () => assertWorkspace())())).toBe(503);
  });
  it('沒設任何新環境變數（正式區首次合併）：關閉', () => {
    setEnv(envFor(PROD, { VERCEL_ENV: 'production' }));
    delete process.env.WORKSPACE_ENABLED;
    expect(msgOf(assertWorkspace)).toBe('新版暫時關閉');
  });
  it('設定不符：通用訊息，不含環境值', () => {
    setEnv(envFor(PROD, { VERCEL_ENV: 'production' })); // 沒有 allowlist
    const m = msgOf(assertWorkspace);
    expect(m).not.toBe('');
    expect(m).not.toContain(PROD);
    expect(m).not.toContain('supabase');
  });
  it('正式區：白名單含 ref 就放行；DEV 舊別名在正式 ref 無效', () => {
    setEnv(envFor(PROD, { VERCEL_ENV: 'production', WORKSPACE_ALLOWED_REFS: PROD }));
    expect(msgOf(assertWorkspace)).toBe('');
    setEnv(envFor(PROD, { VERCEL_ENV: 'production', WORKSPACE_ALLOWED_REFS: PROD, WORKSPACE_DEV_ENABLED: 'true' }));
    delete process.env.WORKSPACE_ENABLED;
    expect(msgOf(assertWorkspace)).toBe('新版暫時關閉');
  });
  it('本機 DEV：舊別名仍可用', () => {
    setEnv(envFor(DEV));
    delete process.env.WORKSPACE_ENABLED;
    process.env.WORKSPACE_DEV_ENABLED = 'true';
    expect(msgOf(assertWorkspace)).toBe('');
  });
});

describe('checkOrigin', () => {
  const req = (origin: string | null, headers: Record<string, string> = {}) =>
    new Request('http://x/api', { method: 'POST', headers: { ...(origin ? { origin } : {}), ...headers } });
  it('本機預設值只在沒有 VERCEL_ENV 時給', () => {
    setEnv(envFor(DEV));
    expect(msgOf(() => checkOrigin(req('http://localhost:5173')))).toBe('');
    setEnv(envFor(DEV, { VERCEL_ENV: 'preview' }));
    expect(msgOf(() => checkOrigin(req('http://localhost:5173')))).not.toBe('');
  });
  it('請求自己的網域可通過；別的網域與缺少 Origin 都是 403', () => {
    setEnv(envFor(PROD, { VERCEL_ENV: 'production', WORKSPACE_ALLOWED_REFS: PROD }));
    const h = { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' };
    expect(msgOf(() => checkOrigin(req('https://app.example.com', h)))).toBe('');
    expect(msgOf(() => checkOrigin(req('https://evil.example.com', h)))).not.toBe('');
    expect(msgOf(() => checkOrigin(req(null, h)))).not.toBe('');
  });
  it('preview：VERCEL_URL 的網域可通過', () => {
    setEnv(envFor(DEV, { VERCEL_ENV: 'preview', VERCEL_URL: 'my-preview.vercel.app' }));
    expect(msgOf(() => checkOrigin(req('https://my-preview.vercel.app')))).toBe('');
  });
  it('WORKSPACE_ORIGIN 逗號清單', () => {
    setEnv(envFor(PROD, { VERCEL_ENV: 'production', WORKSPACE_ALLOWED_REFS: PROD, WORKSPACE_ORIGIN: 'https://a.test, https://b.test' }));
    expect(msgOf(() => checkOrigin(req('https://b.test')))).toBe('');
  });
});

describe('context 的 audience 閘門', () => {
  it('admin_only：非管理員 403 NOT_OPEN_YET；管理員通過', async () => {
    setEnv(envFor(DEV, { WORKSPACE_AUDIENCE: 'admin_only' }));
    state.admin = false;
    await expect(context()).rejects.toMatchObject({ status: 403, message: 'NOT_OPEN_YET' });
    state.admin = true;
    expect(await status(context())).toBe(200);
  });
  it('預設（未設 audience）也是 admin_only', async () => {
    setEnv(envFor(DEV));
    state.admin = false;
    expect(await status(context())).toBe(403);
  });
  it('all：非管理員通過', async () => {
    setEnv(envFor(DEV, { WORKSPACE_AUDIENCE: 'all' }));
    state.admin = false;
    expect(await status(context())).toBe(200);
  });
  it('audienceCheck:false（session 路由）：非管理員不被擋', async () => {
    setEnv(envFor(DEV, { WORKSPACE_AUDIENCE: 'admin_only' }));
    state.admin = false;
    expect(await status(context({ audienceCheck: false }))).toBe(200);
  });
  it('開關關閉：503', async () => {
    setEnv(envFor(DEV, { WORKSPACE_ENABLED: 'false', WORKSPACE_AUDIENCE: 'all' }));
    state.admin = true;
    expect(await status(context())).toBe(503);
  });
});

describe('行事曆 mock 旗標', () => {
  it('正式部署或非 DEV ref 永遠不啟用', async () => {
    const { calendarMockEnabled } = await import('@/lib/workspace/calendar-mock');
    setEnv(envFor(DEV, { WORKSPACE_CALENDAR_MOCK: 'true', WORKSPACE_DEV_ENABLED: 'true' }));
    expect(calendarMockEnabled()).toBe(true);
    setEnv(envFor(DEV, { WORKSPACE_CALENDAR_MOCK: 'true', WORKSPACE_DEV_ENABLED: 'true', VERCEL_ENV: 'production' }));
    expect(calendarMockEnabled()).toBe(false);
    setEnv(envFor(PROD, { WORKSPACE_CALENDAR_MOCK: 'true', WORKSPACE_DEV_ENABLED: 'true' }));
    expect(calendarMockEnabled()).toBe(false);
  });
});
