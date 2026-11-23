import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M9 F01S 單元：備援開關伺服端（lib/workspace/page-fallbacks.ts）的權限、驗證與「讀不到就視為沒有」。
 * 以假的 ctx／admin client 測，不連資料庫（資料庫行為見 tests/integration/M9-F01S.page-fallbacks.spec.ts）。
 */
vi.mock('@/lib/workspace/server', () => {
  class WorkspaceError extends Error { constructor(public status: number, message: string) { super(message); } }
  return {
    WorkspaceError,
    adminClient: () => ({}),
    checkOrigin: (r: Request) => { if (r.headers.get('origin') !== 'http://localhost:5173') throw new WorkspaceError(403, '請從測試工作台操作'); },
    respond: (data: unknown, status = 200) => ({ status, json: async () => data }),
  };
});
import { activeFallbacks, listFallbacks, setFallback } from '@/lib/workspace/page-fallbacks';

const root = path.resolve(__dirname, '..', '..', '..');
const req = (body: unknown, origin = 'http://localhost:5173') => new Request('http://x/api', { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const okRpc = () => vi.fn(async (..._a: unknown[]) => ({ data: { kind: 'merchandise' } as unknown, error: null as unknown }));
const ctxWith = (isAdmin: boolean, rpc: ReturnType<typeof okRpc> = okRpc()) => ({ isAdmin, user: { id: 'u1' }, admin: { rpc, from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) } }) as any;
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.status as number; } };

describe('權限與驗證', () => {
  it('非系統管理員：清單與切換都是 403，且不會呼叫資料庫', async () => {
    const rpc = okRpc();
    expect(await status(listFallbacks(ctxWith(false)))).toBe(403);
    expect(await status(setFallback(ctxWith(false, rpc), req({ kind: 'merchandise', useLegacy: true, reason: 'x' })))).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('系統管理員：成功時以 rpc 寫入（帶操作者）', async () => {
    const rpc = okRpc();
    const res: any = await setFallback(ctxWith(true, rpc), req({ kind: 'merchandise', useLegacy: true, reason: '  新版很慢  ' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('workspace_set_page_fallback', { p_kind: 'merchandise', p_use_legacy: true, p_reason: '新版很慢', p_actor: 'u1' });
  });
  it('驗證：未知或不可切換的 kind、非布林、切舊版沒填原因、原因過長、Origin 不符、壞 JSON', async () => {
    const c = ctxWith(true);
    expect(await status(setFallback(c, req({ kind: 'ga-payment-requests', useLegacy: true, reason: 'x' })))).toBe(400); // 沒有舊版
    expect(await status(setFallback(c, req({ kind: 'employee-history', useLegacy: true, reason: 'x' })))).toBe(400); // 明細頁
    expect(await status(setFallback(c, req({ kind: 'no-such', useLegacy: true, reason: 'x' })))).toBe(400);
    expect(await status(setFallback(c, req({ kind: 'merchandise', useLegacy: 'yes', reason: 'x' })))).toBe(400);
    expect(await status(setFallback(c, req({ kind: 'merchandise', useLegacy: true })))).toBe(400);
    expect(await status(setFallback(c, req({ kind: 'merchandise', useLegacy: true, reason: 'x'.repeat(201) })))).toBe(400);
    expect(await status(setFallback(c, req({ kind: 'merchandise', useLegacy: true, reason: 'x' }, 'http://evil.test')))).toBe(403);
    expect(await status(setFallback(c, req('{bad')))).toBe(400);
  });
  it('改回新版不需要原因；資料庫錯誤回 503', async () => {
    const ok: any = await setFallback(ctxWith(true), req({ kind: 'merchandise', useLegacy: false }));
    expect(ok.status).toBe(200);
    const bad = vi.fn(async (..._a: unknown[]) => ({ data: null as unknown, error: { message: 'relation does not exist' } as unknown }));
    expect(await status(setFallback(ctxWith(true, bad as any), req({ kind: 'merchandise', useLegacy: false })))).toBe(503);
  });
});

describe('session 讀取（activeFallbacks）', () => {
  const adminWith = (result: () => Promise<unknown>) => ({ from: () => ({ select: () => ({ eq: result }) }) }) as any;
  it('只回傳 use_legacy 的可切換 kind；不可切換的髒資料被濾掉', async () => {
    const rows = [{ kind: 'merchandise', reason: 'r', updated_at: 't' }, { kind: 'ga-payment-requests', reason: null, updated_at: 't' }, { kind: 'zzz', reason: null, updated_at: 't' }];
    expect(await activeFallbacks(adminWith(async () => ({ data: rows, error: null })))).toEqual([{ kind: 'merchandise', reason: 'r', updatedAt: 't' }]);
  });
  it('表不存在、回傳錯誤、丟例外：一律視為沒有，不讓 session 失敗', async () => {
    expect(await activeFallbacks(adminWith(async () => ({ data: null, error: { message: 'x' } })))).toEqual([]);
    expect(await activeFallbacks(adminWith(async () => { throw new Error('boom'); }))).toEqual([]);
  });
});

describe('原始碼契約', () => {
  it('session 路由讀備援表、回傳 pageFallbacks，並把 fallbackKinds 傳給導覽；沒有任何伺服端快取', () => {
    const route = fs.readFileSync(path.join(root, 'app/api/workspace/session/route.ts'), 'utf8');
    expect(route).toContain('activeFallbacks(ctx.admin)');
    expect(route).toContain('fallbackKinds: new Set(pageFallbacks.map');
    expect(route).toContain('pageFallbacks,');
    expect(route).toContain('pageFallbackAdmin: ctx.isAdmin');
    const lib = fs.readFileSync(path.join(root, 'lib/workspace/page-fallbacks.ts'), 'utf8');
    expect(lib).not.toMatch(/setTimeout|ttl|Date\.now\(\)/i);
  });
  it('SQL 檔：開發版與正式區草稿內容相同；還原檔移除函式與兩張表；兩張表啟用 RLS 且只授權 service_role', () => {
    const dev = fs.readFileSync(path.join(root, 'supabase/workspace-dev/20261123150000_m9_page_fallbacks.sql'), 'utf8');
    const prod = fs.readFileSync(path.join(root, 'docs/vue-workspace/parity-plan/m9-sql/20261123150000_m9_page_fallbacks.sql'), 'utf8');
    expect(prod).toBe(dev);
    expect(dev).toContain('ENABLE ROW LEVEL SECURITY');
    expect(dev).toMatch(/GRANT ALL ON public\.workspace_page_fallbacks, public\.workspace_page_fallback_events TO service_role/);
    expect(dev).not.toMatch(/GRANT[^;]*(anon|authenticated)/);
    const rb = fs.readFileSync(path.join(root, 'supabase/workspace-dev/20261123150000_m9_page_fallbacks.rollback.sql'), 'utf8');
    for (const piece of ['DROP FUNCTION IF EXISTS public.workspace_set_page_fallback', 'DROP TABLE IF EXISTS public.workspace_page_fallback_events', 'DROP TABLE IF EXISTS public.workspace_page_fallbacks']) expect(rb).toContain(piece);
    expect(fs.readFileSync(path.join(root, 'docs/vue-workspace/parity-plan/m9-sql/20261123150000_m9_page_fallbacks.rollback.sql'), 'utf8')).toBe(rb);
  });
});
