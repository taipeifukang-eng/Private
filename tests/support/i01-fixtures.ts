import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { formatTaipeiDate } from '../../lib/inspection/gps-policy';

// I01 巡店（新增巡店強制定位）測試共用工具。
// 資料原則：只用 VW/ZT 測試門市；每筆測試建立的巡店主表備註帶 ZT<runId> 標記，並登錄 registry（id），
// 測試結束再以 service role 只刪自己建立的 id（子表 cascade）；sweeper 以備註標記作後備清除。

const nodeRequire = createRequire(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry, RUN_ID_RE } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = nodeRequire('./credentials.cjs') as { getAccount: (key: string) => { email: string; password: string; userId?: string } };

export const TEST_STORE_CODES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];
/** 手機與桌機各用不同門市，避免兩個 project 互相占用同一天的巡店。 */
export const E2E_STORES = { desktop: ['ZT01', 'ZT03', 'ZT05'], mobile: ['ZT02', 'ZT04', 'VW002'] } as const;

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}
/** 巡店備註標記：ZT + runId（runId 以 T 開頭，所以 sweeper 前綴為 ZTT）。 */
export const marker = (tag: string) => `ZT${runIdOrThrow()}-I01-${tag}`;

export function adminUserId(): string {
  const id = getAccount('admin').userId;
  if (!id) throw new Error('admin 測試帳號缺少 userId');
  return id;
}

function adminDb(): any {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function storeIdByCode(admin: APIRequestContext, code: string): Promise<string> {
  const res = await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor' } });
  expect(res.status(), '讀取巡店表單').toBe(200);
  const store = ((await res.json()).stores as { id: string; store_code: string }[]).find((s) => s.store_code === code);
  if (!store) throw new Error(`DEV 缺少測試門市 ${code}`);
  return store.id;
}

/** 登錄並（測試結束時）刪除自己建立的巡店；只允許刪除備註帶本次標記的列。 */
export async function registerInspection(id: string) {
  createRegistry({ runId: runIdOrThrow() }).record({ table: 'inspection_masters', column: 'id', values: [id], note: 'I01 測試巡店' });
}
export async function deleteInspections(ids: string[]) {
  if (!ids.length) return;
  const db = adminDb();
  const found = await db.from('inspection_masters').select('id,supervisor_notes').in('id', ids);
  if (found.error) throw new Error(`回查巡店失敗：${found.error.message}`);
  const safe = (found.data as { id: string; supervisor_notes: string | null }[]).filter((r) => (r.supervisor_notes || '').startsWith(`ZT${runIdOrThrow()}`)).map((r) => r.id);
  if (safe.length) {
    const del = await db.from('inspection_masters').delete().in('id', safe);
    if (del.error) throw new Error(`刪除測試巡店失敗：${del.error.message}`);
  }
}
/** 刪除本次 run 在指定門市建立的所有巡店（測試失敗或中斷後的保險）。 */
export async function deleteRunInspections() {
  const db = adminDb();
  const del = await db.from('inspection_masters').delete().like('supervisor_notes', `ZT${runIdOrThrow()}-I01-%`);
  if (del.error) throw new Error(`清除測試巡店失敗：${del.error.message}`);
}

export async function readMaster(id: string): Promise<Record<string, any> | null> {
  const r = await adminDb().from('inspection_masters').select('*').eq('id', id).maybeSingle();
  if (r.error) throw new Error(`回讀巡店失敗：${r.error.message}`);
  return r.data;
}
export async function findMasterByNotes(notes: string): Promise<Record<string, any>[]> {
  const r = await adminDb().from('inspection_masters').select('*').eq('supervisor_notes', notes);
  if (r.error) throw new Error(`回讀巡店失敗：${r.error.message}`);
  return r.data;
}
/** 以 service role 直接寫入巡店主表（用來驗證資料庫 trigger）。回傳 Supabase 的 { data, error }。 */
export async function insertMasterAsServiceRole(storeId: string, patch: Record<string, unknown>) {
  const num = `VW-I01-${randomUUID().slice(0, 8)}`;
  return adminDb()
    .from('inspection_masters')
    .insert({
      store_id: storeId,
      inspector_id: adminUserId(),
      created_by: adminUserId(),
      inspection_date: formatTaipeiDate(new Date()),
      inspection_type: 'supervisor',
      inspection_no: num,
      status: 'draft',
      supervisor_notes: marker('trigger'),
      ...patch,
    })
    .select('*')
    .maybeSingle();
}
export async function updateMasterAsServiceRole(id: string, patch: Record<string, unknown>) {
  return adminDb().from('inspection_masters').update(patch).eq('id', id).select('*').maybeSingle();
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}
export const GPS_BASE = { latitude: 25.033, longitude: 121.5654, accuracy: 20 };
export function fix(over: Partial<Fix> = {}): Fix {
  return { ...GPS_BASE, capturedAt: new Date().toISOString(), ...over };
}

/** 透過 workspace API（admin）建立一筆合格定位的巡店草稿；回傳 record。 */
export async function createInspectionViaApi(admin: APIRequestContext, storeId: string, tag: string, over: Record<string, unknown> = {}) {
  const body = await buildBody(admin, storeId, tag, over);
  const res = await admin.post('/api/workspace/inspection-form', { data: body });
  return { res, body, json: await res.json().catch(() => ({})) };
}
export async function buildBody(admin: APIRequestContext, storeId: string, tag: string, over: Record<string, unknown> = {}) {
  const form = await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', store: storeId } });
  expect(form.status(), '讀取巡店表單').toBe(200);
  const data = await form.json();
  const g = fix();
  return {
    id: null,
    version: 0,
    writeId: randomUUID(),
    store: storeId,
    type: 'supervisor',
    status: 'draft',
    date: formatTaipeiDate(g.capturedAt),
    temperature: 25,
    notes: marker(tag),
    gps: g,
    signature: '',
    supervisorSignature: '',
    staff: [],
    templateHash: data.templateHash,
    scores: (data.templates as { id: string }[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] })),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 瀏覽器：定位模擬與頁面操作
// ---------------------------------------------------------------------------

export async function applyProjectViewport(page: Page, testInfo: TestInfo) {
  const viewport = (testInfo.project.use as { viewport?: { width: number; height: number } }).viewport;
  if (viewport) await page.setViewportSize(viewport);
}
export const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile-390';
/** slot：同一輪的不同測試用不同門市（同店同日同類型只能有一筆）。 */
export const storeCodeFor = (testInfo: TestInfo, slot = 0) => (isMobile(testInfo) ? E2E_STORES.mobile : E2E_STORES.desktop)[slot];

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

/** 用 Playwright 真實的定位（grantPermissions + setGeolocation）。 */
export async function grantGeolocation(ctx: BrowserContext, origin: string, c: { latitude: number; longitude: number; accuracy: number }) {
  await ctx.grantPermissions(['geolocation'], { origin });
  await ctx.setGeolocation(c);
}

/**
 * 可控的 navigator.geolocation 模擬：每次 getCurrentPosition 都登記，由測試決定何時成功或失敗。
 * window.__geo.calls 記錄每次呼叫是否為高精度；pending 為尚未回應的呼叫。
 */
export async function installGeoStub(page: Page) {
  await page.addInitScript(() => {
    const state: any = { calls: [] as { high: boolean }[], pending: [] as any[] };
    (window as any).__geo = state;
    navigator.geolocation.getCurrentPosition = (ok: PositionCallback, err?: PositionErrorCallback | null, opts?: PositionOptions) => {
      const call = { high: !!(opts && opts.enableHighAccuracy) };
      state.calls.push(call);
      state.pending.push({ ok, err, high: call.high });
    };
    const take = (high?: boolean) => {
      // 取最新一筆：舊版在 next dev（React strict mode）會連呼叫兩次，只有最後一次的結果有效。
      let i = -1;
      for (let k = state.pending.length - 1; k >= 0; k -= 1) {
        if (high === undefined || state.pending[k].high === high) {
          i = k;
          break;
        }
      }
      return i < 0 ? null : state.pending.splice(i, 1)[0];
    };
    (window as any).__geoRespond = (c: any, high?: boolean) => {
      const p = take(high);
      if (!p) return false;
      p.ok({
        coords: { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: c.timestamp ?? Date.now(),
      });
      return true;
    };
    (window as any).__geoFail = (code: number, high?: boolean) => {
      const p = take(high);
      if (!p) return false;
      p.err && p.err({ code, message: 'stub', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return true;
    };
  });
}
/** 等到有一個（指定精度的）定位呼叫等待回應，然後回報成功。 */
export async function geoRespond(page: Page, c: { latitude: number; longitude: number; accuracy: number; timestamp?: number }, high?: boolean) {
  await expect.poll(() => page.evaluate((h) => (window as any).__geo.pending.some((p: any) => h === undefined || p.high === h), high), { timeout: 20_000, message: '等不到定位呼叫' }).toBe(true);
  await page.evaluate(([cc, h]) => (window as any).__geoRespond(cc, h), [c, high] as const);
}
export async function geoFail(page: Page, code: number, high?: boolean) {
  await expect.poll(() => page.evaluate((h) => (window as any).__geo.pending.some((p: any) => h === undefined || p.high === h), high), { timeout: 20_000, message: '等不到定位呼叫' }).toBe(true);
  await page.evaluate(([cc, h]) => (window as any).__geoFail(cc, h), [code, high] as const);
}
export const geoCalls = (page: Page) => page.evaluate(() => (window as any).__geo.calls as { high: boolean }[]);
/** 連續相同的呼叫視為一次（舊版 dev 模式 strict mode 會重複呼叫）。 */
export async function geoCallSequence(page: Page) {
  const calls = await geoCalls(page);
  return calls.filter((c, i) => i === 0 || c.high !== calls[i - 1].high);
}

export const workPage = (page: Page) => page.locator('section.work-page:visible');

/** 從全站功能選單開啟巡店列表。 */
export async function openInspectionList(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="巡店列表"]').click();
  await expect(page.getByRole('heading', { name: '巡店列表', exact: true })).toBeVisible();
}
/** 開啟新版「新增督導巡店」編輯頁（不等定位結果）。 */
export async function openNativeNew(page: Page) {
  await openInspectionList(page);
  await workPage(page).getByRole('button', { name: '新增督導巡店' }).click();
  await expect(page.getByRole('heading', { name: '新增巡店', exact: true })).toBeVisible();
  await expect(workPage(page).getByTestId('gps-panel')).toBeVisible({ timeout: 30_000 });
}
/** 在列表依流水號（RPC 以 id 去掉連字號組成）找到巡店，進入明細再開編輯頁。 */
export async function openNativeEdit(page: Page, id: string) {
  await openInspectionList(page);
  const row = workPage(page).locator('tbody tr', { hasText: id.replace(/-/g, '') });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: '查看明細' }).click();
  await page.getByRole('button', { name: '編輯巡店' }).click();
  await expect(page.getByRole('heading', { name: '編輯巡店', exact: true })).toBeVisible();
  await expect(workPage(page).getByTestId('gps-panel')).toBeVisible({ timeout: 30_000 });
}
export const gpsPanel = (page: Page) => workPage(page).getByTestId('gps-panel');
