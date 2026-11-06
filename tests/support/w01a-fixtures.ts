import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { readRowsAsServiceRole } from './parity';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry, RUN_ID_RE } = require('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};

/**
 * W01a 測試資料（D15）：只用 ZT 測試門市、保留月份 2099。
 * 一律透過 app 自己的 API（admin）建立，再以 service role 只讀回查 id 並登錄到 registry，
 * 後備清除由 sweeper 負責（保留月份 2099 + 測試門市的列會被清除）。
 */

export const TEST_STORE_CODES = ['ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}

export function registry() {
  return createRegistry({ runId: runIdOrThrow() });
}

/** 取得測試門市 id（以 admin 的 allStores 為準）。 */
export async function testStoreIds(admin: APIRequestContext, month: string): Promise<Record<string, string>> {
  const res = await admin.get('/api/workspace/monthly', { params: { month } });
  if (res.status() !== 200) throw new Error(`讀取門市失敗 HTTP ${res.status()}`);
  const body = await res.json();
  const map: Record<string, string> = {};
  for (const s of body.allStores as { id: string; store_code: string }[]) if (TEST_STORE_CODES.includes(s.store_code)) map[s.store_code] = s.id;
  for (const code of TEST_STORE_CODES.slice(0, 3)) if (!map[code]) throw new Error(`DEV 缺少測試門市 ${code}`);
  return map;
}

export interface ManualStaff {
  name: string;
  code: string;
  position?: string;
  employment_type?: 'full_time' | 'part_time';
  monthly_status?: string;
  work_days?: number;
  work_hours?: number;
  newbie_level?: string;
}

export async function addManual(admin: APIRequestContext, store: string, month: string, s: ManualStaff) {
  const res = await admin.post('/api/workspace/monthly/tools', {
    data: {
      op: 'manual',
      store,
      month,
      requestId: randomUUID(),
      employee: {
        employee_name: s.name,
        employee_code: s.code,
        position: s.position || '專員',
        employment_type: s.employment_type || 'full_time',
        monthly_status: s.monthly_status || 'full_month',
        work_days: s.work_days ?? (s.employment_type === 'part_time' ? 0 : 30),
        work_hours: s.work_hours ?? 0,
        newbie_level: s.newbie_level,
      },
    },
  });
  if (res.status() !== 200) throw new Error(`新增測試人員失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).data as { id: string };
}

/** 門市統計（會建立 monthly_store_summary 列，總覽與統計卡片需要）。 */
export async function ensureSummary(admin: APIRequestContext, store: string, month: string) {
  const res = await admin.post('/api/workspace/monthly/tools', {
    data: {
      op: 'stats',
      store,
      month,
      version: null,
      updates: {
        total_staff_count: 3,
        admin_staff_count: 0,
        newbie_count: 0,
        business_days: 20,
        total_gross_profit: 0,
        total_customer_count: 0,
        prescription_addon_only_count: 0,
        regular_prescription_count: 0,
        chronic_prescription_count: 0,
      },
    },
  });
  if (res.status() !== 200) throw new Error(`建立門市統計失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 120)}`);
}

/** 讀月份名冊與門市狀態（admin）。 */
export async function readMonth(api: APIRequestContext, store: string, month: string) {
  const res = await api.get('/api/workspace/monthly', { params: { month, store } });
  return { status: res.status(), body: await res.json() };
}

/** 完整的 save updates（照 API 驗證需要的欄位），patch 覆蓋。 */
export function fullUpdates(rec: Record<string, any>, patch: Record<string, unknown> = {}) {
  return {
    position: rec.position,
    employment_type: rec.employment_type,
    monthly_status: rec.monthly_status,
    start_date: rec.start_date || null,
    newbie_level: rec.newbie_level || null,
    partial_month_reason: rec.partial_month_reason || null,
    is_dual_position: !!rec.is_dual_position,
    has_manager_bonus: !!rec.has_manager_bonus,
    is_supervisor_rotation: !!rec.is_supervisor_rotation,
    is_pharmacist: !!rec.is_pharmacist,
    is_acting_manager: !!rec.is_acting_manager,
    supervisor_employee_code: '',
    supervisor_name: '',
    supervisor_position: '',
    partial_month_notes: '',
    supervisor_shift_hours: null,
    extra_task_external_hours: null,
    extra_tasks: [],
    work_days: rec.work_days ?? 0,
    work_hours: rec.work_hours ?? 0,
    notes: rec.notes || '',
    ...patch,
  };
}

export async function saveRow(api: APIRequestContext, store: string, month: string, rec: Record<string, any>, patch: Record<string, unknown>) {
  const res = await api.post('/api/workspace/monthly', {
    data: { action: 'save', store, month, id: rec.id, version: rec.updated_at || null, updates: fullUpdates(rec, patch) },
  });
  if (res.status() !== 200) throw new Error(`儲存測試人員失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).record as Record<string, any>;
}

/** 登錄 fixture 列（員編帶 ZT + runId 標記）供 sweeper 後備清除。 */
export async function registerFixtureRows(store: string, month: string) {
  const reg = registry();
  const staff = await readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: store, year_month: month }, select: 'id' });
  if (staff.length) reg.record({ table: 'monthly_staff_status', values: staff.map((r) => String(r.id)), note: `W01a ${month}` });
  const summary = await readRowsAsServiceRole('monthly_store_summary', { eq: { store_id: store, year_month: month }, select: 'id' });
  if (summary.length) reg.record({ table: 'monthly_store_summary', values: summary.map((r) => String(r.id)), note: `W01a ${month}` });
}

/**
 * 測試人員員編。M2 規格 E.1 起，每月人員狀態手動新增必須符合員編規則（FK+4、FKF+5、FKPT+3），
 * 所以不能再用 ZT+runId 當員編。改成 FKF + 9 + 兩碼 runId 雜湊 + 兩碼標籤序號（FKF9xxxx，DEV 真實員編沒有這個範圍）：
 * 同一個 run 內每個標籤唯一；列屬保留月份 2099-xx 的測試門市，由 sweeper 清除（員編本身不再帶標記）。
 */
export function staffCode(tag: string, partTime = false) {
  const runId = runIdOrThrow();
  let hash = 0;
  for (const ch of runId.split('')) hash = (hash * 31 + ch.charCodeAt(0)) % 100;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let index = tag.length === 1 ? alphabet.indexOf(tag.toUpperCase()) : -1;
  if (index < 0) index = tag.split('').reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 64, 7) + 36;
  // H.8：每月手動新增的僱用類型一律依員編決定，兼職列必須用 FKPT 員編（FKPT9nn，DEV 真實員編沒有這個範圍）。
  if (partTime) return `FKPT9${String((hash + index) % 100).padStart(2, '0')}`;
  return `FKF9${String(hash).padStart(2, '0')}${String(index).padStart(2, '0')}`.slice(0, 8);
}
