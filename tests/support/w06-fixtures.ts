import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { adminDb, adminUserId, runIdOrThrow } from './w05-fixtures';

// W06（人事異動回寫每月人員名冊，M2 規格 A、B 組）測試共用工具。
// 資料原則：員編只用保留範圍 FK7xxx／FKF7xxxx／FKPT8xx（DEV 真實員編沒有；W05 用 FK8、W01a 用 FKF9）；
// 月份名冊只放 ZT01／ZT02 測試門市、保留月份 2099-07～2099-09。建立的異動歷史、主檔、需重新確認與調整紀錄
// 都登錄到 registry（sweeper 後備清除），測試結束以員編範圍加保留月份清除。

const nodeRequire = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
};

export { adminDb, adminUserId, runIdOrThrow };
export const W06_MONTHS = { m1: '2099-07', m2: '2099-08', m3: '2099-09' } as const;
export const W06_CODE_RANGE = /^(FK7\d{3}|FKF7\d{4}|FKPT8\d{2})$/;
export const MOVEMENT_HINT = '請填寫本店實際時數';

function runHash(): number {
  let h = 0;
  for (const ch of runIdOrThrow().split('')) h = (h * 31 + ch.charCodeAt(0)) % 100;
  return h;
}

/** 測試員編。n 為同一個 run 內的流水（FK 0-9、FKF 0-99、FKPT 0-99），桌機與手機 project 用不同區間。 */
export function w06Code(kind: 'FK' | 'FKF' | 'FKPT', n: number): string {
  const h = runHash();
  if (kind === 'FK') return `FK7${String(h).padStart(2, '0')}${n % 10}`;
  if (kind === 'FKF') return `FKF7${String(h).padStart(2, '0')}${String(n % 100).padStart(2, '0')}`;
  return `FKPT8${String((h + n * 7) % 100).padStart(2, '0')}`.slice(0, 7);
}

export async function w06StoreIds(admin: APIRequestContext, month: string): Promise<Record<string, string>> {
  const res = await admin.get('/api/workspace/monthly', { params: { month } });
  if (res.status() !== 200) throw new Error(`讀取門市失敗 HTTP ${res.status()}`);
  const map: Record<string, string> = {};
  for (const s of (await res.json()).allStores as { id: string; store_code: string }[]) map[s.store_code] = s.id;
  for (const code of ['ZT01', 'ZT02']) if (!map[code]) throw new Error(`DEV 缺少測試門市 ${code}`);
  return map;
}

export async function storeName(storeId: string): Promise<string> {
  const { data } = await adminDb().from('stores').select('store_name').eq('id', storeId).single();
  return data.store_name;
}

function assertTestCode(code: string) {
  if (!W06_CODE_RANGE.test(code)) throw new Error(`拒絕操作測試範圍外的員編：${code}`);
}

/** 建立員工主檔（測試員編範圍）。 */
export async function seedMaster(code: string, name: string, storeId: string, o: { position?: string; type?: 'full_time' | 'part_time'; status?: string; active?: boolean; startDate?: string } = {}) {
  assertTestCode(code);
  const { error } = await adminDb().from('store_employees').insert({
    employee_code: code,
    employee_name: name,
    store_id: storeId,
    position: o.position ?? '專員',
    current_position: o.position ?? '專員',
    employment_type: o.type ?? 'full_time',
    employment_status: o.status ?? 'active',
    is_active: o.active ?? true,
    start_date: o.startDate ?? '2090-01-01',
  });
  if (error) throw new Error(`建立員工主檔失敗：${error.message}`);
}

export type SeedRow = { code: string; name: string; position?: string; status?: 'draft' | 'submitted' | 'confirmed'; type?: 'full_time' | 'part_time'; days?: number | null };
/** 直接在測試門市保留月份建立名冊列（模擬已初始化的月份）。 */
export async function seedRoster(storeId: string, month: string, rows: SeedRow[]) {
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const { error } = await adminDb().from('monthly_staff_status').insert(
    rows.map((r) => ({
      year_month: month,
      store_id: storeId,
      employee_code: r.code,
      employee_name: r.name,
      position: r.position ?? '專員',
      employment_type: r.type ?? 'full_time',
      is_pharmacist: false,
      monthly_status: 'full_month',
      work_days: (r.type ?? 'full_time') === 'full_time' ? (r.days === undefined ? dim : r.days) : null,
      work_hours: (r.type ?? 'full_time') === 'part_time' ? 0 : null,
      total_days_in_month: dim,
      status: r.status ?? 'draft',
    })),
  );
  if (error) throw new Error(`建立名冊列失敗：${error.message}`);
}

export async function rosterRows(code: string, months: string[] = Object.values(W06_MONTHS)) {
  const { data, error } = await adminDb().from('monthly_staff_status').select('*').eq('employee_code', code).in('year_month', months).order('year_month').order('store_id');
  if (error) throw new Error(`讀取名冊失敗：${error.message}`);
  return (data || []) as Record<string, any>[];
}
export async function masterOf(code: string) {
  const { data } = await adminDb().from('store_employees').select('*').eq('employee_code', code).order('is_active', { ascending: false });
  return (data || []) as Record<string, any>[];
}
export async function historyOf(code: string) {
  const { data } = await adminDb().from('employee_movement_history').select('*').eq('employee_code', code).order('movement_date').order('created_at');
  return (data || []) as Record<string, any>[];
}
export async function recheckOf(code: string, status = 'pending') {
  const { data } = await adminDb().from('monthly_staff_recheck').select('*').eq('employee_code', code).eq('status', status).order('year_month');
  return (data || []) as Record<string, any>[];
}
export async function adjustmentsOf(code: string) {
  const { data } = await adminDb().from('monthly_staff_adjustment_log').select('*').eq('employee_code', code).order('created_at');
  return (data || []) as Record<string, any>[];
}

/** 直接寫入一筆異動歷史（測試員編範圍），不經回寫流程；之後以 recompute 驗證計算。 */
export async function insertHistory(row: { code: string; name: string; store: string; type: string; date: string; old?: string | null; new?: string | null; notes?: string | null; pharmacist?: boolean | null }) {
  assertTestCode(row.code);
  const { data, error } = await adminDb()
    .from('employee_movement_history')
    .insert({ employee_code: row.code, employee_name: row.name, store_id: row.store, movement_type: row.type, movement_date: row.date, old_value: row.old ?? null, new_value: row.new ?? null, notes: row.notes ?? null, created_by: adminUserId(), onboarding_is_pharmacist: row.pharmacist ?? null })
    .select('id')
    .single();
  if (error) throw new Error(`寫入異動歷史失敗：${error.message}`);
  return String(data.id);
}

export async function recompute(code: string, fromMonth: string, o: { toMonth?: string | null; store?: string | null; log?: boolean; applyLocked?: boolean; type?: string; label?: string } = {}) {
  assertTestCode(code);
  const { data, error } = await adminDb().rpc('workspace_roster_recompute', {
    p_actor: adminUserId(),
    p_code: code,
    p_from_month: fromMonth,
    p_to_month: o.toMonth ?? null,
    p_only_store: o.store ?? null,
    p_log: o.log ?? true,
    p_apply_locked: o.applyLocked ?? false,
    p_move_type: o.type ?? 'test',
    p_source_id: null,
    p_label: o.label ?? 'W06 測試',
  });
  if (error) throw new Error(`workspace_roster_recompute 失敗：${error.message}`);
  return data as { updated: number; created: number; removed: number; recheck: number; adjusted: number };
}

export async function applyStoreMonth(store: string, month: string, o: { log?: boolean } = {}) {
  const { data, error } = await adminDb().rpc('workspace_roster_apply_store_month', { p_actor: adminUserId(), p_store: store, p_month: month, p_log: o.log ?? false, p_apply_locked: false, p_label: 'W06 測試' });
  if (error) throw new Error(`workspace_roster_apply_store_month 失敗：${error.message}`);
  return data as Record<string, number>;
}

export type MovementInput = Partial<{ employee_code: string; employee_name: string; store_id: string; movement_type: string; birthday: string; position: string; newbie_level: string; effective_date: string; notes: string; from_store_id: string; to_store_id: string; onboarding_is_pharmacist: boolean }>;
const blank = { employee_code: '', employee_name: '', store_id: '', movement_type: '', birthday: '', position: '', newbie_level: '', effective_date: '', notes: '', from_store_id: '', to_store_id: '', onboarding_is_pharmacist: false };

/** 走新版 API：查核（movement-validation）再儲存（movement-submit）。 */
export async function submitMovements(admin: APIRequestContext, rows: MovementInput[]) {
  const full = rows.map((r) => ({ ...blank, ...r }));
  const v = await admin.post('/api/workspace/movement-validation', { data: { rows: full } });
  const vb = await v.json().catch(() => ({}));
  if (v.status() !== 200 || !vb.valid) return { ok: false as const, status: v.status(), stage: 'validate', body: vb };
  const s = await admin.post('/api/workspace/movement-submit', { data: { rows: vb.rows, version: vb.version, requestId: randomUUID() } });
  const sb = await s.json().catch(() => ({}));
  return { ok: s.status() === 200, status: s.status(), stage: 'submit', body: sb };
}

export async function initializeMonth(admin: APIRequestContext, store: string, month: string) {
  const res = await admin.post('/api/workspace/monthly', { data: { action: 'initialize', store, month } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

export async function monthlyView(admin: APIRequestContext, store: string, month: string) {
  const res = await admin.get('/api/workspace/monthly', { params: { month, store } });
  return { status: res.status(), body: await res.json() };
}

function registry() {
  return createRegistry({ runId: runIdOrThrow() });
}

/** 登錄 W06 建立的資料 id（sweeper 後備）。 */
export async function registerW06(codes: string[]) {
  const safe = Array.from(new Set(codes)).filter((c) => W06_CODE_RANGE.test(c));
  if (!safe.length) return;
  const db = adminDb();
  const reg = registry();
  for (const [table, column] of [['employee_movement_history', 'employee_code'], ['store_employees', 'employee_code'], ['monthly_staff_recheck', 'employee_code'], ['monthly_staff_adjustment_log', 'employee_code'], ['store_transfer_requests', 'employee_code']] as const) {
    const { data } = await db.from(table).select('id').in(column, safe);
    if (data?.length) reg.record({ table, column: 'id', values: data.map((r: any) => String(r.id)), note: `W06 ${table}` });
  }
}

/** 測試結束：只清測試員編範圍與保留月份 2099-xx 的資料。 */
export async function purgeW06(codes: string[], stores: string[] = []) {
  const safe = Array.from(new Set(codes)).filter((c) => W06_CODE_RANGE.test(c));
  const db = adminDb();
  if (safe.length) {
    for (const table of ['store_transfer_requests', 'monthly_staff_adjustment_log', 'monthly_staff_recheck', 'employee_movement_history', 'store_employees']) {
      const { error } = await db.from(table).delete().in('employee_code', safe);
      if (error) throw new Error(`清除 ${table} 失敗：${error.message}`);
    }
    const { error } = await db.from('monthly_staff_status').delete().in('employee_code', safe).like('year_month', '2099-%');
    if (error) throw new Error(`清除 monthly_staff_status 失敗：${error.message}`);
  }
  if (stores.length) {
    for (const table of ['monthly_staff_status', 'monthly_store_summary']) {
      const { error } = await db.from(table).delete().in('store_id', stores).in('year_month', Object.values(W06_MONTHS));
      if (error) throw new Error(`清除 ${table} 失敗：${error.message}`);
    }
  }
}

/** 清掉本次測試期間產生的請求回條（只限本測試帳號與測試門市）。 */
export async function purgeReceipts(since: string, stores: string[]) {
  const db = adminDb();
  await db.from('workspace_movement_requests').delete().eq('actor_id', adminUserId()).gte('created_at', since);
  if (stores.length) await db.from('workspace_promotion_requests').delete().in('store_id', stores).gte('created_at', since);
}

export const here = path.resolve(__dirname);
