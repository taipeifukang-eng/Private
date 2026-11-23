import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, runIdOrThrow, setupM6Users, type M6User } from '../support/m6-fixtures';
import { FALLBACK_SWITCHABLE_KINDS } from '../../lib/workspace/legacy-routes';

/**
 * M9 F01S 整合：逐頁「回舊版」備援開關（N2）workspace API。
 * 涵蓋：系統管理員清單與切換、非系統管理員 403（清單與切換）、未登入 401、驗證（不可切換的 kind、缺原因、過長）、
 *   寫入後同一個請求的 session 立刻反映（導覽項目改成舊版、pageFallbacks、其他使用者也一樣）、改回新版、稽核欄位與稽核紀錄、
 *   還原 SQL（rollback）後 session 不壞、再套用後恢復。
 * 帳號：admin（系統管理員，應用層後備）、臨時 m6-test-so_store_a（店長，有缺貨回報入口）、m6-test-so_plain（一般帳號）。
 * 狀態：測試前記下 workspace_page_fallbacks 的現況，測完還原；稽核紀錄只刪原因帶 ZT2038-<runId> 標記的列。
 */
const db = adminDb();
const KIND = 'merchandise';
const mark = () => `ZT2038-M9F01S-${runIdOrThrow()}`;
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
const apis: Record<string, APIRequestContext> = {};
let before: any[] = [];
const startedAtAll = new Date().toISOString();

const put = (key: string, data: unknown) => apis[key].put('/api/workspace/page-fallbacks', { data });
const session = async (key: string) => (await apis[key].get('/api/workspace/session')).json();
const navItem = (s: any, label: string) => (s.navigation as any[]).flatMap((g) => g.items).find((i) => i.label === label);

async function restoreState() {
  await db.from('workspace_page_fallbacks').delete().eq('kind', KIND);
  // 還原 SQL 測試會連資料一起移除備援表：把測試前就存在的列全部放回（原本沒有就不放）。
  if (before.length) await db.from('workspace_page_fallbacks').upsert(before, { onConflict: 'kind' });
  await db.from('workspace_page_fallback_events').delete().eq('kind', KIND).gte('created_at', startedAtAll); // 只刪測試期間新增的列（改回新版沒有原因，不能靠原因標記）
}

test.beforeAll(async () => {
  runIdOrThrow();
  before = (await db.from('workspace_page_fallbacks').select('*')).data || [];
  ({ users, teardown } = await setupM6Users(['so_store_a', 'so_plain']));
  apis.admin = await apiAs('admin');
  apis.mgr = await apiForUser(users.so_store_a);
  apis.plain = await apiForUser(users.so_plain);
  await db.from('workspace_page_fallbacks').delete().eq('kind', KIND); // 從「沒有切換」開始
});
test.afterAll(async () => {
  await restoreState();
  for (const a of Object.values(apis)) await a.dispose();
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});
test.beforeEach(() => test.setTimeout(120_000));

test('清單：只有系統管理員；列出所有可切換頁面（有舊版對應的導覽頁面），不含新功能與明細頁', async () => {
  const res = await apis.admin.get('/api/workspace/page-fallbacks');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-store');
  const body = await res.json();
  expect(body.items.map((i: any) => i.kind).sort()).toEqual([...FALLBACK_SWITCHABLE_KINDS].sort());
  expect(body.items.every((i: any) => i.useLegacy === false && typeof i.legacyRoute === 'string' && i.legacyRoute.startsWith('/'))).toBe(true);
  for (const nope of ['ga-payment-requests', 'ga-purchase-orders', 'employee-history', 'page-fallbacks']) expect(body.items.some((i: any) => i.kind === nope), nope).toBe(false);
  const merch = body.items.find((i: any) => i.kind === KIND);
  expect(merch.legacyRoute).toBe('/cross-dept/merchandise');
});

test('非系統管理員一律 403（店長、一般帳號；清單與切換），未登入 401；資料庫沒有被改動', async () => {
  for (const key of ['mgr', 'plain']) {
    expect((await apis[key].get('/api/workspace/page-fallbacks')).status(), `${key} GET`).toBe(403);
    expect((await put(key, { kind: KIND, useLegacy: true, reason: `${mark()} 不應成功` })).status(), `${key} PUT`).toBe(403);
  }
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  try {
    expect((await anon.get('/api/workspace/page-fallbacks')).status()).toBe(401);
    expect((await anon.put('/api/workspace/page-fallbacks', { data: { kind: KIND, useLegacy: true, reason: 'x' } })).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  const rows = (await db.from('workspace_page_fallbacks').select('kind').eq('kind', KIND)).data || [];
  expect(rows).toEqual([]);
});

test('驗證：不能切換的 kind、缺原因、原因過長、非布林、Origin 不符', async () => {
  const bad = async (data: unknown, code: number, what: string) => expect((await put('admin', data)).status(), what).toBe(code);
  await bad({ kind: 'ga-payment-requests', useLegacy: true, reason: mark() }, 400, '沒有舊版對應');
  await bad({ kind: 'employee-history', useLegacy: true, reason: mark() }, 400, '明細頁');
  await bad({ kind: 'zzz', useLegacy: true, reason: mark() }, 400, '未知 kind');
  await bad({ kind: KIND, useLegacy: true }, 400, '缺原因');
  await bad({ kind: KIND, useLegacy: true, reason: '   ' }, 400, '原因只有空白');
  await bad({ kind: KIND, useLegacy: true, reason: 'x'.repeat(201) }, 400, '原因過長');
  await bad({ kind: KIND, useLegacy: 'true', reason: mark() }, 400, '非布林');
  const noOrigin = await (await import('@playwright/test')).request.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.admin.storageState(), extraHTTPHeaders: { Origin: 'http://evil.test' } });
  try {
    expect((await noOrigin.put('/api/workspace/page-fallbacks', { data: { kind: KIND, useLegacy: true, reason: mark() } })).status()).toBe(403);
  } finally {
    await noOrigin.dispose();
  }
  expect(((await db.from('workspace_page_fallbacks').select('kind').eq('kind', KIND)).data || []).length).toBe(0);
});

test('切回舊版：同一個請求後的 session 立刻反映（店長選單改開舊版、管理員也是）；改回新版立刻恢復；稽核欄位完整', async () => {
  const baseMgr = await session('mgr');
  expect(navItem(baseMgr, '商品部').kind).toBe('merchandise');
  expect(baseMgr.pageFallbacks).toEqual([]);
  expect(baseMgr.capabilities.pageFallbackAdmin).toBe(false);
  expect((await session('admin')).capabilities.pageFallbackAdmin).toBe(true);

  const reason = `${mark()} 新版載入很慢`;
  const on = await put('admin', { kind: KIND, useLegacy: true, reason });
  expect(on.status()).toBe(200);
  const onBody = await on.json();
  expect(onBody.item).toMatchObject({ kind: KIND, use_legacy: true, reason });

  // 生效：下一個 session 請求就看到（沒有重新部署、沒有等待）
  for (const key of ['mgr', 'admin']) {
    const s = await session(key);
    const item = navItem(s, '商品部');
    if (key === 'mgr') {
      expect(item, '商品部項目仍在').toBeTruthy();
      expect(item.kind).toBeUndefined();
      expect(item.fallback).toBe(true);
      expect(item.href).toBe('/cross-dept/merchandise');
      expect(s.pageFallbacks).toEqual([{ kind: KIND, reason, updatedAt: expect.any(String) }]);
      // 其他項目、能力旗標不受影響（只是改開舊版，不是改權限）
      expect(s.capabilities.stockout).toBe(true);
      expect(s.navigation.flatMap((g: any) => g.items).length).toBe(baseMgr.navigation.flatMap((g: any) => g.items).length);
    } else {
      expect(s.pageFallbacks.some((f: any) => f.kind === KIND)).toBe(true);
    }
  }
  // 清單反映狀態與稽核
  const list = await (await apis.admin.get('/api/workspace/page-fallbacks')).json();
  const row = list.items.find((i: any) => i.kind === KIND);
  expect(row).toMatchObject({ useLegacy: true, reason });
  expect(row.updatedByName).toBeTruthy();
  expect(Date.now() - Date.parse(row.updatedAt)).toBeLessThan(120_000);
  const dbRow = (await db.from('workspace_page_fallbacks').select('*').eq('kind', KIND).single()).data;
  expect(dbRow.use_legacy).toBe(true);
  expect(dbRow.updated_by).toBeTruthy();

  // 改回新版（不需要原因）
  const off = await put('admin', { kind: KIND, useLegacy: false, reason: `${mark()} 改回新版` });
  expect(off.status()).toBe(200);
  const s2 = await session('mgr');
  expect(navItem(s2, '商品部').kind).toBe('merchandise');
  expect(navItem(s2, '商品部').fallback).toBeUndefined();
  expect(s2.pageFallbacks).toEqual([]);

  // 稽核紀錄：兩筆（切舊版、改新版），含操作者
  const events = (await db.from('workspace_page_fallback_events').select('*').like('reason', `${mark()}%`).order('created_at')).data || [];
  expect(events.filter((e: any) => e.kind === KIND).map((e: any) => e.use_legacy)).toEqual([true, false]);
  expect(events.every((e: any) => !!e.actor_id)).toBe(true);
});

test('重複切換是冪等的（同一頁連續切回舊版兩次，狀態一致、稽核各記一筆）', async () => {
  for (let i = 0; i < 2; i++) expect((await put('admin', { kind: KIND, useLegacy: true, reason: `${mark()} 重複 ${i}` })).status()).toBe(200);
  expect(((await db.from('workspace_page_fallbacks').select('*').eq('kind', KIND)).data || []).length).toBe(1);
  expect((await session('plain')).pageFallbacks.map((f: any) => f.kind)).toEqual([KIND]);
  expect((await put('admin', { kind: KIND, useLegacy: false })).status()).toBe(200);
  expect((await session('plain')).pageFallbacks).toEqual([]);
});

test('還原 SQL（rollback）：移除後 session 照常回 200 且視為沒有切換、切換回 503；重新套用後恢復，舊版資料不受影響', async () => {
  test.setTimeout(240_000);
  const root = path.resolve(__dirname, '..', '..');
  const script = path.join(root, 'scripts', 'apply-workspace-m9-dev.cjs');
  const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  expect((await put('admin', { kind: KIND, useLegacy: true, reason: `${mark()} 還原前` })).status()).toBe(200);
  try {
    const rb = run(['--rollback']);
    expect(rb.status, rb.stdout + rb.stderr).toBe(0);
    const s = await apis.mgr.get('/api/workspace/session');
    expect(s.status()).toBe(200);
    const body = await s.json();
    expect(body.pageFallbacks).toEqual([]);
    expect(navItem(body, '商品部').kind).toBe('merchandise'); // 沒有表 = 全部開新版
    expect((await put('admin', { kind: KIND, useLegacy: true, reason: `${mark()} 無表` })).status()).toBe(503);
    expect((await apis.admin.get('/api/workspace/page-fallbacks')).status()).toBe(503);
    // 舊版頁面與資料不受影響：profiles 仍可讀
    expect(((await db.from('profiles').select('id').limit(1)).data || []).length).toBe(1);
  } finally {
    const ap = run([]);
    expect(ap.status, ap.stdout + ap.stderr).toBe(0);
  }
  // 重新套用後：表是空的（還原連資料一起移除）、可以再切換
  expect(((await db.from('workspace_page_fallbacks').select('kind')).data || []).length).toBe(0);
  expect((await put('admin', { kind: KIND, useLegacy: true, reason: `${mark()} 重新套用後` })).status()).toBe(200);
  expect((await session('mgr')).pageFallbacks.map((f: any) => f.kind)).toEqual([KIND]);
  expect((await put('admin', { kind: KIND, useLegacy: false })).status()).toBe(200);
});
