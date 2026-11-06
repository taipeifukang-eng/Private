import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { hasSyncTriggeringMovement } from '../../lib/pharmacist/sync-trigger';

// P01 藥師同步漏同步修正（DEV 整合層）：對齊舊版 fix/pharmacist-sync-triggers。
//  A. 資料庫層（「今天」注入）：三種漏同步情況，「修正前」只看 created_at 的判斷會漏、修正後會補上；沒變動仍跳過；
//     範圍外（類型、門市、月份）不觸發。生效日（條件 c）依賴真正的今天，只能在這一層驗證。
//  B. Vue 工作台 API（督導區總覽，月份 2099-03、門市只有 ZT01 的臨時帳號）：沒變動跳過、新登錄、事後修改會重算；
//     關帳月份不動；sync log 記的是同步開始時間。
//  C. 年度主檔 API（年度 2099，只有 sync log 會被寫入）：畫面拿到的是真正最後同步時間，不是「現在」；未變動時不重新同步；關帳年度不動。
// 資料：只用 ZT01／2099 保留月份與年度；所有建立的資料以 id／標記精準刪除，結束檢查殘留為 0。

const nodeRequire = createRequire(path.join(__dirname, 'P01.pharmacist-sync-trigger.spec.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
const PHARM = '/api/workspace/pharmacists';
const EMAIL = 'cvp-test-p01sync@example.test';
const ROLE_CODE = 'cvp_test_p01sync';
const M_PREV = '2099-02';
const M = '2099-03';
const YEAR = 2099;

type Db = any;
const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
};
function adminDb(): Db {
  const guard = nodeRequire(path.join(ROOT, 'tests', 'support', 'env-guard.cjs')) as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => Db };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.describe.configure({ mode: 'serial' });

let db: Db;
let zt01 = '';
let zt02 = '';
const movementIds: string[] = [];
let tag = 0;
const code = (k: number) => 'FKF' + String(tag + k);
const TYPES_ANNUAL = ['resignation', 'leave_without_pay', 'leave_of_absence', 'return_to_work', 'onboarding'];
const TYPES_MONTHLY = ['resignation', 'onboarding', 'return_to_work', 'store_transfer', 'promotion', 'leave_without_pay', 'leave_of_absence'];

async function insertMovement(row: Record<string, unknown>) {
  const data = must(
    await db.from('employee_movement_history').insert({ employee_name: '同步測試', store_id: zt01, ...row }).select('id, created_at, updated_at').single(),
    '建立異動',
  ) as { id: string };
  movementIds.push(data.id);
  return data;
}

test.beforeAll(async () => {
  db = adminDb();
  const stores = must(await db.from('stores').select('id, store_code').in('store_code', ['ZT01', 'ZT02']), '讀取測試門市') as { id: string; store_code: string }[];
  zt01 = stores.find((s) => s.store_code === 'ZT01')?.id || '';
  zt02 = stores.find((s) => s.store_code === 'ZT02')?.id || '';
  expect(zt01 && zt02, 'DEV 需要 ZT01／ZT02').toBeTruthy();
  // DEV 員編規則：FKF + 5 碼；找一段沒有任何異動資料的號碼
  for (let i = 0; i < 20 && !tag; i += 1) {
    const base = 90000 + Math.floor(Math.random() * 990) * 10;
    const codes = Array.from({ length: 10 }, (_, k) => 'FKF' + String(base + k));
    const { count, error } = await db.from('employee_movement_history').select('id', { count: 'exact', head: true }).in('employee_code', codes);
    if (error) throw error;
    if (count === 0) tag = base;
  }
  expect(tag, '找不到可用的測試員編').toBeGreaterThan(0);
});

test.afterAll(async () => {
  const problems: string[] = [];
  try {
    if (movementIds.length) {
      const r = await db.from('employee_movement_history').delete().in('id', movementIds);
      if (r.error) problems.push(`movements: ${r.error.message}`);
    }
    await db.from('pharmacist_monthly_snapshot').delete().in('year_month', [M_PREV, M]).eq('store_id', zt01).like('employee_code', 'FKF9%');
    await db.from('pharmacist_monthly_snapshot_sync_log').delete().in('year_month', [M_PREV, M]);
    await db.from('pharmacist_snapshot_locks').delete().eq('year_month', M);
    await db.from('pharmacist_annual_master_sync_log').delete().eq('year', YEAR);
    await db.from('pharmacist_annual_master_locks').delete().eq('year', YEAR);
    const { data: profs } = await db.from('profiles').select('id').eq('email', EMAIL);
    const uids = (profs || []).map((p: { id: string }) => p.id);
    if (uids.length) {
      await db.from('store_managers').delete().in('user_id', uids);
      await db.from('user_roles').delete().in('user_id', uids);
    }
    const { data: roles } = await db.from('roles').select('id').eq('code', ROLE_CODE);
    for (const r of roles || []) {
      await db.from('user_roles').delete().eq('role_id', r.id);
      await db.from('role_permissions').delete().eq('role_id', r.id);
      await db.from('roles').delete().eq('id', r.id);
    }
    const list = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of list.data?.users || []) if (u.email === EMAIL) await db.auth.admin.deleteUser(u.id);

    // 殘留檢查
    const left = async (table: string, f: (q: any) => any) => {
      const { count } = await f(db.from(table).select('*', { count: 'exact', head: true }));
      return count ?? 0;
    };
    const residue = {
      movements: movementIds.length ? await left('employee_movement_history', (q) => q.in('id', movementIds)) : 0,
      snapshot: await left('pharmacist_monthly_snapshot', (q) => q.in('year_month', [M_PREV, M]).eq('store_id', zt01).like('employee_code', 'FKF9%')),
      monthlyLog: await left('pharmacist_monthly_snapshot_sync_log', (q) => q.in('year_month', [M_PREV, M])),
      annualLog: await left('pharmacist_annual_master_sync_log', (q) => q.eq('year', YEAR)),
      locks: (await left('pharmacist_snapshot_locks', (q) => q.eq('year_month', M))) + (await left('pharmacist_annual_master_locks', (q) => q.eq('year', YEAR))),
      profiles: await left('profiles', (q) => q.eq('email', EMAIL)),
      roles: await left('roles', (q) => q.eq('code', ROLE_CODE)),
    };
    for (const [k, v] of Object.entries(residue)) if (v) problems.push(`殘留 ${k}=${v}`);
  } catch (e) {
    problems.push((e as Error).message);
  }
  expect(problems).toEqual([]);
});

// ---------------------------------------------------------------------------
// A. 資料庫層：三種漏同步情況（今天注入）
// ---------------------------------------------------------------------------
test.describe('A. 觸發判斷（資料庫、今天注入）', () => {
  const REG = '2099-03-01T02:00:00Z'; // 登錄
  const LASTSYNC = '2099-03-01T10:00:00Z'; // 上次同步（台灣 3/1 18:00）
  const Y0 = '2099-01-01';
  const Y1 = '2099-12-31';

  // 修正前的判斷（只看 created_at）
  async function oldNeedsSync(o: { lastSyncedAt: string; types: string[]; start: string; end: string; codes: string[]; storeIds?: string[] }) {
    let q = db
      .from('employee_movement_history')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', o.lastSyncedAt)
      .in('movement_type', o.types)
      .gte('movement_date', o.start)
      .lte('movement_date', o.end)
      .in('employee_code', o.codes);
    if (o.storeIds) q = q.in('store_id', o.storeIds);
    const { count, error } = await q;
    if (error) throw error;
    return (count ?? 0) > 0;
  }
  const newNeedsSync = (o: { lastSyncedAt?: string; today: string; types?: string[]; start: string; end: string; codes: string[]; storeIds?: string[] }) =>
    hasSyncTriggeringMovement(db, {
      lastSyncedAt: o.lastSyncedAt ?? LASTSYNC,
      today: o.today,
      movementTypes: o.types || TYPES_ANNUAL,
      rangeStart: o.start,
      rangeEnd: o.end,
      employeeCodes: o.codes,
      storeIds: o.storeIds,
    });

  test('資料庫 trigger 會在 UPDATE 時更新 updated_at（條件 b 的前提）', async () => {
    const r = await insertMovement({ employee_code: code(6), movement_type: 'onboarding', movement_date: '2099-03-05', onboarding_is_pharmacist: false, created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-01T00:00:00Z' });
    const { data, error } = await db.from('employee_movement_history').update({ onboarding_is_pharmacist: true }).eq('id', r.id).select('updated_at').single();
    if (error) throw error;
    expect(new Date(data.updated_at).getTime()).toBeGreaterThan(new Date('2000-01-01T00:00:00Z').getTime());
  });

  test('情況 1 提前登錄的入職：修正前漏掉，修正後在生效日補上；未到生效日仍跳過', async () => {
    const c = code(0);
    await insertMovement({ employee_code: c, movement_type: 'onboarding', movement_date: '2099-03-10', onboarding_is_pharmacist: true, created_at: REG, updated_at: REG });
    const o = { start: Y0, end: '2099-03-11', codes: [c] };
    expect(await oldNeedsSync({ lastSyncedAt: LASTSYNC, types: TYPES_ANNUAL, ...o }), 'old').toBe(false);
    expect(await newNeedsSync({ ...o, today: '2099-03-11' }), 'new').toBe(true);
    expect(await newNeedsSync({ ...o, end: '2099-03-10', today: '2099-03-10' }), '生效日當天').toBe(true);
    expect(await newNeedsSync({ ...o, end: '2099-03-09', today: '2099-03-09' }), '未到生效日').toBe(false);
    // 每月總覽的範圍（月份＋門市）
    const m = { lastSyncedAt: LASTSYNC, types: TYPES_MONTHLY, start: '2099-03-01', end: '2099-03-31', codes: [c], storeIds: [zt01] };
    expect(await oldNeedsSync(m), 'monthly old').toBe(false);
    expect(await newNeedsSync({ ...m, today: '2099-03-12' }), 'monthly new').toBe(true);
    expect(await newNeedsSync({ ...m, today: '2099-03-12', storeIds: [zt02] }), '其他門市範圍').toBe(false);
    expect(await newNeedsSync({ ...m, today: '2099-03-12', start: '2099-04-01', end: '2099-04-30' }), '其他月份').toBe(false);
  });

  test('情況 2 事後修改（是否藥師改為是）：修正前漏掉，修正後由 updated_at 補上', async () => {
    const c = code(1);
    await insertMovement({ employee_code: c, movement_type: 'onboarding', movement_date: '2099-02-20', onboarding_is_pharmacist: true, created_at: REG, updated_at: '2099-03-02T03:00:00Z' });
    const o = { start: Y0, end: '2099-03-05', codes: [c] };
    expect(await oldNeedsSync({ lastSyncedAt: LASTSYNC, types: TYPES_ANNUAL, ...o }), 'old').toBe(false);
    expect(await newNeedsSync({ ...o, today: '2099-03-05' }), 'new').toBe(true);
  });

  test('情況 3 提前登錄的離職：修正前漏掉，修正後在最後上班日之後補上', async () => {
    const c = code(2);
    await insertMovement({ employee_code: c, movement_type: 'resignation', movement_date: '2099-03-20', created_at: REG, updated_at: REG });
    const o = { start: Y0, end: '2099-03-21', codes: [c] };
    expect(await oldNeedsSync({ lastSyncedAt: LASTSYNC, types: TYPES_ANNUAL, ...o }), 'old').toBe(false);
    expect(await newNeedsSync({ ...o, today: '2099-03-21' }), 'new').toBe(true);
    expect(await newNeedsSync({ ...o, end: '2099-03-19', today: '2099-03-19' }), '生效日前').toBe(false);
  });

  test('既有行為不變：同步後才新登錄仍會觸發', async () => {
    const c = code(3);
    await insertMovement({ employee_code: c, movement_type: 'resignation', movement_date: '2099-02-10', created_at: '2099-03-02T00:00:00Z', updated_at: '2099-03-02T00:00:00Z' });
    const o = { start: Y0, end: '2099-03-05', codes: [c] };
    expect(await oldNeedsSync({ lastSyncedAt: LASTSYNC, types: TYPES_ANNUAL, ...o })).toBe(true);
    expect(await newNeedsSync({ ...o, today: '2099-03-05' })).toBe(true);
  });

  test('沒有變動：修正前後都跳過；原類型清單以外（升遷）不觸發；+00:00 時間格式可用', async () => {
    const c5 = code(4);
    await insertMovement({ employee_code: c5, movement_type: 'onboarding', movement_date: '2099-03-01', onboarding_is_pharmacist: true, created_at: REG, updated_at: REG });
    await insertMovement({ employee_code: c5, movement_type: 'resignation', movement_date: '2099-02-15', created_at: REG, updated_at: REG });
    const o = { start: Y0, end: Y1, codes: [c5] };
    expect(await oldNeedsSync({ lastSyncedAt: LASTSYNC, types: TYPES_ANNUAL, ...o })).toBe(false);
    expect(await newNeedsSync({ ...o, today: '2099-06-30' })).toBe(false);
    expect(await newNeedsSync({ ...o, today: '2099-03-01' })).toBe(false);
    const c6 = code(5);
    await insertMovement({ employee_code: c6, movement_type: 'promotion', movement_date: '2099-03-10', new_value: '店長', created_at: REG, updated_at: REG });
    expect(await newNeedsSync({ today: '2099-03-11', start: Y0, end: '2099-03-11', codes: [c6] })).toBe(false);
    expect(await newNeedsSync({ lastSyncedAt: '2099-03-01T10:00:00+00:00', today: '2099-03-11', start: Y0, end: '2099-03-11', codes: [code(0)] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Vue 工作台：督導區總覽（月份 2099-03、門市只有 ZT01）
// ---------------------------------------------------------------------------
test.describe('B. Vue 督導區總覽的月份快照同步', () => {
  let api: APIRequestContext;
  let userId = '';
  const SEED = () => 'FKF9' + String(tag).slice(1, 5) + '0';
  const hour = 60 * 60 * 1000;

  const logOf = async (month: string) => {
    const { data } = await db.from('pharmacist_monthly_snapshot_sync_log').select('last_synced_at').eq('year_month', month).maybeSingle();
    return data?.last_synced_at ? new Date(data.last_synced_at).getTime() : null;
  };
  const setLog = async (month: string, ms: number) => {
    must(await db.from('pharmacist_monthly_snapshot_sync_log').upsert({ year_month: month, last_synced_at: new Date(ms).toISOString() }, { onConflict: 'year_month' }), `設定 sync log ${month}`);
  };
  async function visit() {
    const res = await api.post(`${PHARM}/overview`, { params: { year_month: M } });
    expect(res.status(), 'overview').toBe(200);
  }

  test.beforeAll(async () => {
    // A 區的異動 created_at／updated_at 是未來時間（2099），會讓 B 區每次都觸發；A 區結束，先清掉。
    if (movementIds.length) must(await db.from('employee_movement_history').delete().in('id', movementIds), '清除 A 區異動');
    movementIds.length = 0;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: 'P01 sync test' } });
    if (created.error) throw new Error(`建立帳號失敗：${created.error.message}`);
    userId = created.data.user.id;
    must(await db.from('profiles').update({ role: 'member', department: null }).eq('id', userId), 'profile');
    const role = must(await db.from('roles').insert({ name: 'P01 sync test', code: ROLE_CODE, description: 'p01 sync trigger test', is_system: false, is_active: true }).select('id').single(), '建立角色') as { id: string };
    const perm = must(await db.from('permissions').select('id').eq('code', 'pharmacist.management.view').single(), '讀取權限') as { id: string };
    must(await db.from('role_permissions').insert({ role_id: role.id, permission_id: perm.id, is_allowed: true }), '角色權限');
    must(await db.from('user_roles').insert({ user_id: userId, role_id: role.id, is_active: true }), 'user_roles');
    must(await db.from('store_managers').insert({ user_id: userId, store_id: zt01, role_type: 'store_manager', is_primary: true }), 'store_managers');

    const pre = await db.from('pharmacist_monthly_snapshot_sync_log').select('year_month').in('year_month', [M_PREV, M]);
    expect(pre.data, '保留月份 2099-02／03 不應已有 sync log').toEqual([]);
    // 兩個月份都有快照（才會走增量判斷）、前月人員都已帶入本月（沒有補帶需求）
    for (const month of [M_PREV, M]) {
      must(
        await db.from('pharmacist_monthly_snapshot').insert({ year_month: month, store_id: zt01, employee_code: SEED(), employee_name: 'P01 sync seed', position: '藥師', is_active: true, source: 'movement', notes: 'seed' }),
        `快照 ${month}`,
      );
    }
    const ctx = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
    const login = await ctx.post('/api/workspace/login', { data: { email: EMAIL, password } });
    if (!login.ok()) throw new Error(`臨時帳號登入失敗（HTTP ${login.status()}）`);
    api = ctx;
  });
  test.afterAll(async () => {
    await api?.dispose();
  });

  test('沒有變動：跳過，sync log 不動', async () => {
    const L = Date.now() - hour;
    await setLog(M, L);
    await setLog(M_PREV, L);
    await visit();
    expect(await logOf(M)).toBe(L);
    expect(await logOf(M_PREV)).toBe(L);
  });

  test('(a) 上次同步後新登錄的異動：重算，sync log 記的是這次同步的開始時間', async () => {
    const L = Date.now() - hour;
    await setLog(M, L);
    await setLog(M_PREV, L);
    const t0 = Date.now();
    await insertMovement({ employee_code: code(7), movement_type: 'onboarding', movement_date: '2099-03-10', onboarding_is_pharmacist: false });
    await visit();
    const t1 = Date.now();
    const log = (await logOf(M))!;
    expect(log).toBeGreaterThan(L);
    expect(log).toBeGreaterThanOrEqual(t0 - 2000);
    expect(log).toBeLessThanOrEqual(t1);
    expect(await logOf(M_PREV), '異動不在前月範圍，前月不重算').toBe(L);
  });

  test('(b) 事後修改：舊登錄的異動沒變動時跳過；修改後（updated_at 變新）才重算', async () => {
    // 先清掉 (a) 建立的新登錄異動（UPDATE 會被資料庫 trigger 把 updated_at 設成現在，不能用改舊的方式），避免它觸發
    if (movementIds.length) must(await db.from('employee_movement_history').delete().in('id', movementIds), '清除 (a) 異動');
    movementIds.length = 0;
    const old = '2020-01-01T00:00:00Z';
    const m = await insertMovement({ employee_code: code(8), movement_type: 'onboarding', movement_date: '2099-03-12', onboarding_is_pharmacist: false, created_at: old, updated_at: old });
    const L = Date.now() - hour;
    await setLog(M, L);
    await setLog(M_PREV, L);
    await visit();
    expect(await logOf(M), '沒修改：跳過').toBe(L);
    must(await db.from('employee_movement_history').update({ onboarding_is_pharmacist: true }).eq('id', m.id), '修改異動');
    await visit();
    expect(await logOf(M), '修改後：重算').toBeGreaterThan(L);
  });

  test('關帳月份：即使有新異動也完全不動', async () => {
    const L = Date.now() - hour;
    await setLog(M, L);
    must(await db.from('pharmacist_snapshot_locks').insert({ year_month: M, locked_by: userId }), '關帳');
    try {
      await insertMovement({ employee_code: code(9), movement_type: 'resignation', movement_date: '2099-03-14' });
      await visit();
      expect(await logOf(M)).toBe(L);
    } finally {
      await db.from('pharmacist_snapshot_locks').delete().eq('year_month', M);
    }
  });
});

// ---------------------------------------------------------------------------
// C. 年度主檔 API：畫面顯示真正最後同步時間
// ---------------------------------------------------------------------------
test.describe('C. 年度主檔同步時間與關帳', () => {
  let admin: APIRequestContext;
  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const pre = await db.from('pharmacist_annual_master_sync_log').select('year').eq('year', YEAR);
    expect(pre.data, '保留年度 2099 不應已有 sync log').toEqual([]);
  });
  test.afterAll(async () => {
    await admin?.dispose();
  });
  const annualLog = async () => {
    const { data } = await db.from('pharmacist_annual_master_sync_log').select('last_synced_at').eq('year', YEAR).maybeSingle();
    return data?.last_synced_at ? new Date(data.last_synced_at).getTime() : null;
  };

  test('第一次同步：syncedAt = sync log（開始時間）；間隔後再開頁沒有變動就不重新同步，syncedAt 維持原值而不是現在', async () => {
    const t0 = Date.now();
    const first = await admin.post(`${PHARM}/master`, { params: { year: String(YEAR) } });
    expect(first.status()).toBe(200);
    const b1 = await first.json();
    const t1 = Date.now();
    const log1 = (await annualLog())!;
    expect(log1).toBeGreaterThanOrEqual(t0 - 2000);
    expect(log1).toBeLessThanOrEqual(t1);
    expect(new Date(b1.syncedAt).getTime()).toBe(log1);

    await new Promise((r) => setTimeout(r, 1500));
    const second = await admin.post(`${PHARM}/master`, { params: { year: String(YEAR) } });
    const b2 = await second.json();
    expect(await annualLog()).toBe(log1);
    expect(new Date(b2.syncedAt).getTime(), '顯示的是真正最後同步時間，不是這次請求的時間').toBe(log1);
  });

  test('只讀模式（readonly=1）不同步，仍回傳真正最後同步時間', async () => {
    const log = (await annualLog())!;
    const res = await admin.post(`${PHARM}/master`, { params: { year: String(YEAR), readonly: '1' } });
    expect(res.status()).toBe(200);
    expect(new Date((await res.json()).syncedAt).getTime()).toBe(log);
    expect(await annualLog()).toBe(log);
  });

  test('關帳年度：不同步、syncedAt 為空、sync log 不動', async () => {
    const log = (await annualLog())!;
    const { data: me } = await db.from('profiles').select('id').limit(1).single();
    must(await db.from('pharmacist_annual_master_locks').insert({ year: YEAR, locked_by: me.id }), '年度關帳');
    try {
      const res = await admin.post(`${PHARM}/master`, { params: { year: String(YEAR) } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.isLocked).toBe(true);
      expect(body.syncedAt).toBeNull();
      expect(await annualLog()).toBe(log);
    } finally {
      await db.from('pharmacist_annual_master_locks').delete().eq('year', YEAR);
    }
  });
});
