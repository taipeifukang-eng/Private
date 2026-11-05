import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

// W05（員工管理與員編規則）測試共用工具。
// 資料原則：員編一律用保留的測試範圍（FK8xxx、FKF8xxxx、FKPT9xx，另有對等測試用的 FK8x／FK9x、FK8xx／FK9xx、FKI8xx／FKI9xx；DEV 真實員編沒有這些範圍），
// 每個 run 以 runId 雜湊錯開；月人員狀態只放 ZT 測試門市、保留月份 2099-xx。
// 建立的員工主檔登錄到 registry（id，sweeper 後備清除），測試結束再以 service role 只刪測試範圍內的員編。

const nodeRequire = createRequire(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry, RUN_ID_RE } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = nodeRequire('./credentials.cjs') as { getAccount: (key: string) => { email: string; password: string; userId?: string } };
export function adminUserId(): string {
  const id = getAccount('admin').userId;
  if (!id) throw new Error('admin 測試帳號缺少 userId');
  return id;
}

export const W05_MONTHS = { draft: '2099-11', locked: '2099-12' } as const;
/** 測試員編範圍；任何刪除都必須先通過這個檢查。 */
export const TEST_CODE_RANGE = /^(FK8\d{3}|FK[89]\d{1,2}|FKF8\d{4}|FKPT9\d{2}|FKI[89]\d{2})$/;

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}

function runHash(): number {
  let h = 0;
  for (const ch of runIdOrThrow().split('')) h = (h * 31 + ch.charCodeAt(0)) % 100;
  return h;
}

/** 測試員編。n 為同一個 run 內的流水（FK 0-9、FKF 0-99、FKPT 0-99），桌機與手機 project 用不同 n 區間。 */
export function w05Code(kind: 'FK' | 'FKF' | 'FKPT', n: number): string {
  const h = runHash();
  if (kind === 'FK') return `FK8${String(h).padStart(2, '0')}${n % 10}`;
  if (kind === 'FKF') return `FKF8${String(h).padStart(2, '0')}${String(n % 100).padStart(2, '0')}`;
  return `FKPT9${String((h + n * 7) % 100).padStart(2, '0')}`;
}

export function adminDb(): any {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 只讀：該員編在員工主檔的列。 */
export async function masterRows(code: string): Promise<Record<string, any>[]> {
  const { data, error } = await adminDb().from('store_employees').select('*').eq('employee_code', code);
  if (error) throw new Error(`讀取員工主檔失敗：${error.message}`);
  return data || [];
}

export async function monthlyRows(code: string, months: string[] = [W05_MONTHS.draft, W05_MONTHS.locked]): Promise<Record<string, any>[]> {
  const { data, error } = await adminDb().from('monthly_staff_status').select('*').eq('employee_code', code).in('year_month', months).order('year_month');
  if (error) throw new Error(`讀取月人員狀態失敗：${error.message}`);
  return data || [];
}

export async function recheckRows(code: string): Promise<Record<string, any>[]> {
  const { data, error } = await adminDb().from('monthly_staff_recheck').select('*').eq('employee_code', code).order('year_month');
  if (error) throw new Error(`讀取需重新確認失敗：${error.message}`);
  return data || [];
}

/** 登錄員工主檔與需重新確認的 id，讓 sweeper 在測試中斷時也能清除。 */
export async function registerCode(code: string) {
  if (!TEST_CODE_RANGE.test(code)) throw new Error(`拒絕登錄測試範圍外的員編：${code}`);
  const reg = createRegistry({ runId: runIdOrThrow() });
  const masters = await masterRows(code);
  if (masters.length) reg.record({ table: 'store_employees', column: 'id', values: masters.map((r) => String(r.id)), note: `W05 ${code}` });
  const rechecks = await recheckRows(code);
  if (rechecks.length) reg.record({ table: 'monthly_staff_recheck', column: 'id', values: rechecks.map((r) => String(r.id)), note: `W05 ${code}` });
}

/** 測試結束：只刪測試範圍內員編的主檔、需重新確認，以及保留月份 2099-xx 的月人員狀態。 */
export async function purgeCodes(codes: string[]) {
  const safe = Array.from(new Set(codes)).filter((c) => TEST_CODE_RANGE.test(c));
  if (!safe.length) return;
  const db = adminDb();
  for (const [table, extra] of [['monthly_staff_recheck', null], ['monthly_staff_status', '2099-%'], ['store_employees', null]] as const) {
    let q = db.from(table).delete().in('employee_code', safe);
    if (extra) q = q.like('year_month', extra);
    const { error } = await q;
    if (error) throw new Error(`清除 ${table} 失敗：${error.message}`);
  }
}

/** 清掉測試門市在 W05 保留月份（2099-xx）的名冊與月統計，讓每個測試從乾淨狀態開始。 */
export async function resetMonths(storeIdList: string[], months: string[] = [W05_MONTHS.draft, W05_MONTHS.locked]) {
  if (months.some((m) => !/^2099-(0[1-9]|1[0-2])$/.test(m))) throw new Error('只允許清除保留月份 2099-xx');
  const db = adminDb();
  for (const table of ['monthly_staff_status', 'monthly_store_summary']) {
    const { error } = await db.from(table).delete().in('store_id', storeIdList).in('year_month', months);
    if (error) throw new Error(`清除 ${table} 失敗：${error.message}`);
  }
}

export async function purgeRange(prefixes: string[]) {
  const db = adminDb();
  const { data } = await db.from('store_employees').select('employee_code').or(prefixes.map((p) => `employee_code.like.${p}%`).join(','));
  await purgeCodes((data || []).map((r: any) => String(r.employee_code)));
}

export async function createEmployee(admin: APIRequestContext, body: Record<string, unknown>) {
  const res = await admin.post('/api/workspace/employees', { data: { requestId: randomUUID(), data: body } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

export async function storeIds(admin: APIRequestContext, month: string): Promise<Record<string, string>> {
  const res = await admin.get('/api/workspace/monthly', { params: { month } });
  if (res.status() !== 200) throw new Error(`讀取門市失敗 HTTP ${res.status()}`);
  const map: Record<string, string> = {};
  for (const s of (await res.json()).allStores as { id: string; store_code: string }[]) map[s.store_code] = s.id;
  for (const code of ['ZT01', 'ZT02']) if (!map[code]) throw new Error(`DEV 缺少測試門市 ${code}`);
  return map;
}

export async function addMonthlyManual(admin: APIRequestContext, store: string, month: string, employee: Record<string, unknown>) {
  const res = await admin.post('/api/workspace/monthly/tools', {
    data: {
      op: 'manual',
      store,
      month,
      requestId: randomUUID(),
      employee: { position: '專員', employment_type: 'full_time', monthly_status: 'full_month', work_days: 30, work_hours: 0, ...employee },
    },
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

export async function ensureStats(admin: APIRequestContext, store: string, month: string) {
  const res = await admin.post('/api/workspace/monthly/tools', {
    data: { op: 'stats', store, month, version: null, updates: { total_staff_count: 3, admin_staff_count: 0, newbie_count: 0, business_days: 20, total_gross_profit: 0, total_customer_count: 0, prescription_addon_only_count: 0, regular_prescription_count: 0, chronic_prescription_count: 0 } },
  });
  if (res.status() !== 200) throw new Error(`建立門市統計失敗 HTTP ${res.status()}`);
}

/** 把保留月份的 ZT 門市名冊登錄到 registry（月份名冊另有 2099-xx sweeper 後備）。 */
export async function registerRoster(store: string, month: string) {
  const reg = createRegistry({ runId: runIdOrThrow() });
  for (const table of ['monthly_staff_status', 'monthly_store_summary'] as const) {
    const { data } = await adminDb().from(table).select('id').eq('store_id', store).eq('year_month', month);
    if (data?.length) reg.record({ table, values: data.map((r: any) => String(r.id)), note: `W05 ${month}` });
  }
}

export async function openNativePage(page: Page, title: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator(`.workspace-menu button.catalog-item[title="${title}"]`).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

/** 新增員工不在選單，從「員工管理」的「新增員工」按鈕開啟。 */
export async function openEmployeeCreate(page: Page) {
  await openNativePage(page, '員工管理');
  await workPanel(page).getByRole('button', { name: '新增員工' }).first().click();
  await expect(page.getByRole('heading', { name: '新增員工', exact: true })).toBeVisible();
}

export function workPanel(page: Page) {
  return page.locator('section.work-page:not([hidden])');
}

export async function applyProjectViewport(page: Page, testInfo: TestInfo) {
  await page.setViewportSize((testInfo.project.use as any).viewport);
}

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  return errors;
}
