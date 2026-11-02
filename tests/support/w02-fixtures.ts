import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { readRowsAsServiceRole } from './parity';
import { addManual, readMonth, registry, staffCode, testStoreIds } from './w01a-fixtures';
import { canonicalWorkbook, compareWorkbooks } from './w02-xlsx';

export { staffCode, testStoreIds, readMonth, canonicalWorkbook, compareWorkbooks };

/**
 * W02 測試資料（D15）：只用 ZT 測試門市（ZT03 草稿、ZT04 已送審、ZT05 已確認）與保留月份 2099。
 * 與 W01a／W01b 使用的 ZT01／ZT02 錯開，避免同一次 run 內互相鎖定月份。
 * 一律透過 app 自己的 API（admin）建立，再以 service role 只讀回查 id 並登錄到 registry，後備清除由 sweeper 負責。
 */
export const W02_MONTHS = {
  smoke: '2099-01',
  integration: '2099-02',
  e2eDesktop: '2099-03',
  e2eMobile: '2099-04',
  parity: '2099-05',
} as const;

export const W02_STORE_CODES = { draft: 'ZT03', submitted: 'ZT04', confirmed: 'ZT05' } as const;
export type W02State = keyof typeof W02_STORE_CODES;

export interface SeededMonth {
  month: string;
  ids: Record<W02State, string>;
  /** 各狀態門市的員編（a/b 一般；c 為調店：submitted 為調出、confirmed 為調入）。 */
  codes: Record<W02State, { a: string; b: string; c?: string }>;
}

const TAGS: Record<W02State, { a: string; b: string; c?: string }> = {
  draft: { a: 'A', b: 'B' },
  submitted: { a: 'C', b: 'D', c: 'E' },
  confirmed: { a: 'F', b: 'G', c: 'H' },
};

async function post(admin: APIRequestContext, url: string, data: unknown, what: string) {
  const res = await admin.post(url, { data });
  if (res.status() !== 200) throw new Error(`${what} 失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 160)}`);
  return res;
}

async function allowance(admin: APIRequestContext, store: string, month: string, kind: string, records: Record<string, unknown>[]) {
  // 樂觀鎖：expected 必須是目前資料庫內容（GET 回傳的 expected）。
  const current = await (await admin.get('/api/workspace/monthly/tools', { params: { op: 'allowance', kind, store, month } })).json();
  await post(admin, '/api/workspace/monthly/tools', { op: 'allowance', kind, store, month, records, expected: current.expected }, `寫入 ${kind}`);
}

/** 建立一個月份：三間門市三種狀態，含各種津貼資料與一組調店人員（調出／調入）。 */
export async function seedExportMonth(admin: APIRequestContext, month: string): Promise<SeededMonth> {
  const stores = await testStoreIds(admin, month);
  const ids = { draft: stores[W02_STORE_CODES.draft], submitted: stores[W02_STORE_CODES.submitted], confirmed: stores[W02_STORE_CODES.confirmed] };
  for (const [state, id] of Object.entries(ids)) if (!id) throw new Error(`DEV 缺少測試門市 ${W02_STORE_CODES[state as W02State]}`);
  const codes = {} as SeededMonth['codes'];
  const reg = registry();
  // 冪等：同一次 run 內（例如桌機與手機 project 各跑一次 beforeAll）已建立過就直接回傳。
  const probe = await readMonth(admin, ids.confirmed, month);
  if (probe.status === 200 && probe.body.records?.some((r: any) => r.employee_code === staffCode(TAGS.confirmed.a))) {
    for (const state of ['draft', 'submitted', 'confirmed'] as W02State[]) {
      const t = TAGS[state];
      codes[state] = { a: staffCode(t.a), b: staffCode(t.b), c: t.c ? staffCode(t.c) : undefined };
    }
    return { month, ids, codes };
  }
  for (const state of ['draft', 'submitted', 'confirmed'] as W02State[]) {
    const store = ids[state];
    const t = TAGS[state];
    const c = { a: staffCode(t.a), b: staffCode(t.b), c: t.c ? staffCode(t.c) : undefined };
    codes[state] = c;
    await addManual(admin, store, month, { name: `W02 ${state} 專員`, code: c.a });
    await addManual(admin, store, month, { name: `W02 ${state} 兼職`, code: c.b, position: '兼職專員', employment_type: 'part_time', work_hours: 40, work_days: 0 });
    if (c.c) {
      await addManual(admin, store, month, {
        name: state === 'submitted' ? 'W02 調出專員' : 'W02 調入專員',
        code: c.c,
        monthly_status: state === 'submitted' ? 'transferred_out' : 'transferred_in',
        work_days: state === 'submitted' ? 12 : 18,
      });
    }
    await post(admin, '/api/workspace/monthly/tools', {
      op: 'stats', store, month, version: null,
      updates: {
        total_staff_count: c.c ? 3 : 2, admin_staff_count: 0, newbie_count: 0, business_days: 20, total_gross_profit: 123456,
        total_customer_count: 800, prescription_addon_only_count: 10, regular_prescription_count: 200, chronic_prescription_count: 50,
      },
    }, '寫入門市統計');
    const meta = await (await admin.get('/api/workspace/monthly/tools', { params: { op: 'meta', store, month } })).json();
    await post(admin, '/api/workspace/monthly/tools', {
      op: 'supportHours', store, month, version: meta.version || null,
      updates: { support_to_other_stores_hours: state === 'draft' ? 3 : state === 'submitted' ? 8 : 5, support_from_other_stores_hours: state === 'confirmed' ? 6 : 2 },
    }, '寫入支援時數');
    await allowance(admin, store, month, 'transport', [{ employee_code: c.a.toUpperCase(), employee_name: `W02 ${state} 專員`, monthly_transport_expense: 150, transport_expense_notes: 'W02 交通測試' }]);
    await allowance(admin, store, month, 'support', [{ employee_code: c.b.toUpperCase(), employee_name: `W02 ${state} 兼職`, bonus_amount: 500 }]);
    await allowance(admin, store, month, 'talent', [{ employee_code: c.a.toUpperCase(), employee_name: `W02 ${state} 專員`, cultivation_bonus: 300, cultivation_target: 'W02 育才對象' }]);
    await allowance(admin, store, month, 'spring', [{ employee_code: c.a.toUpperCase(), employee_name: `W02 ${state} 專員`, attendance_date: `${month}-05`, category: '專員', bonus_amount: 800 }]);
    await allowance(admin, store, month, 'meal', [{ employee_code: c.b.toUpperCase(), employee_name: `W02 ${state} 兼職`, record_date: `${month.slice(5)}/06`, work_hours: '09:00-22:00', meal_period: '晚餐', employee_type: '非藥師' }]);
  }
  // 狀態：draft 維持草稿；submitted 送審；confirmed 送審後確認。
  for (const state of ['submitted', 'confirmed'] as W02State[])
    await post(admin, '/api/workspace/monthly', { action: 'submit', store: ids[state], month, skipChecks: true }, `送審 ${state}`);
  await post(admin, '/api/workspace/monthly', { action: 'confirm', store: ids.confirmed, month }, '確認');

  // 登錄供 sweeper 清除（單次 fixture，D15）。
  for (const state of ['draft', 'submitted', 'confirmed'] as W02State[]) {
    for (const table of ['monthly_staff_status', 'monthly_store_summary', 'support_staff_bonus', 'talent_cultivation_bonus', 'spring_festival_bonus', 'meal_allowance_records']) {
      const rows = await readRowsAsServiceRole(table, { eq: { store_id: ids[state], year_month: month }, select: 'id' });
      if (rows.length) reg.record({ table, values: rows.map((r) => String(r.id)), note: `W02 ${month} ${state}` });
    }
  }
  return { month, ids, codes };
}

/** 讀取門市目前在 stores 清單（native）的狀態，確認 fixture 三種狀態確實存在。 */
export async function nativeStoreStatuses(api: APIRequestContext, month: string) {
  const res = await api.get('/api/workspace/monthly-export/stores', { params: { year_month: month } });
  return { status: res.status(), body: res.status() === 200 ? await res.json() : await res.json().catch(() => ({})) };
}

export const randomRequestId = () => randomUUID();
