import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { adminDb, adminUserId, runIdOrThrow } from './w05-fixtures';

// P02（門市、店長、督導與門市子頁、員工匯入對等驗收，M2 規格 D、F 組）測試共用工具。
// 資料原則：員編只用保留範圍 FK6xxx／FKF6xxxx／FKPT7xx（DEV 真實員編沒有；W05 用 FK8、W06 用 FK7、W01a 用 FKF9）；
// 門市只用 ZT01～ZT04 測試門市；月份名冊只放保留月份 2099-xx。建立的主檔、異動、調店申請都登錄到 registry
// （sweeper 後備清除），測試結束再以員編範圍清除。調店確認的測試會暫時替兩個測試角色加上
// employee.store_transfer.confirm 與督導任命，結束時還原。

const nodeRequire = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
};

export { adminDb, adminUserId, runIdOrThrow };
export {
  applyProjectViewport,
  collectErrors,
  noPageOverflow,
  openNativePage,
  workPanel,
} from './w05-fixtures';

// FK6\d{2} 是刻意不合法（只有 2 位數字）的員編，供「舊版接受、新版拒絕」的對等測試使用，同樣只用在測試範圍。
export const P02_CODE_RANGE = /^(FK6\d{3}|FK6\d{2}|FKF6\d{4}|FKPT7\d{2})$/;

function runHash(): number {
  let h = 0;
  for (const ch of runIdOrThrow().split('')) h = (h * 31 + ch.charCodeAt(0)) % 100;
  return h;
}

/** 測試員編。n 為同一個 run 內的流水（FK 0-9、FKF 0-99、FKPT 0-99），桌機與手機 project 用不同 n 區間。 */
export function p02Code(kind: 'FK' | 'FKF' | 'FKPT', n: number): string {
  const h = runHash();
  if (kind === 'FK') return `FK6${String(h).padStart(2, '0')}${n % 10}`;
  if (kind === 'FKF') return `FKF6${String(h).padStart(2, '0')}${String(n % 100).padStart(2, '0')}`;
  return `FKPT7${String((h + n * 7) % 100).padStart(2, '0')}`.slice(0, 7);
}

/** 刻意不合法的測試員編（FK6 + 2 位數字，只有 5 個字元）。 */
export function p02BadCode(n: number): string {
  return `FK6${String((runHash() + n * 13) % 100).padStart(2, '0')}`;
}

export async function p02Stores(): Promise<Record<string, string>> {
  const { data, error } = await adminDb().from('stores').select('id,store_code').in('store_code', ['ZT01', 'ZT02', 'ZT03', 'ZT04']);
  if (error) throw new Error(`讀取測試門市失敗：${error.message}`);
  const map: Record<string, string> = {};
  for (const s of data as { id: string; store_code: string }[]) map[s.store_code] = s.id;
  for (const code of ['ZT01', 'ZT02', 'ZT03', 'ZT04']) if (!map[code]) throw new Error(`DEV 缺少測試門市 ${code}`);
  return map;
}

function assertTestCode(code: string) {
  if (!P02_CODE_RANGE.test(code)) throw new Error(`拒絕操作測試範圍外的員編：${code}`);
}

export async function seedMaster(code: string, name: string, storeId: string, o: { position?: string; startDate?: string } = {}) {
  assertTestCode(code);
  const { error } = await adminDb().from('store_employees').insert({
    employee_code: code,
    employee_name: name,
    store_id: storeId,
    position: o.position ?? '專員',
    current_position: o.position ?? '專員',
    employment_type: 'full_time',
    employment_status: 'active',
    is_active: true,
    start_date: o.startDate ?? '2090-01-01',
  });
  if (error) throw new Error(`建立員工主檔失敗：${error.message}`);
}

export async function masterOf(code: string): Promise<Record<string, any>[]> {
  const { data } = await adminDb().from('store_employees').select('*').eq('employee_code', code).order('is_active', { ascending: false });
  return data || [];
}
export async function historyOf(code: string): Promise<Record<string, any>[]> {
  const { data } = await adminDb().from('employee_movement_history').select('*').eq('employee_code', code).order('movement_date').order('created_at');
  return data || [];
}
export async function transferRequestsOf(code: string): Promise<Record<string, any>[]> {
  const { data } = await adminDb().from('store_transfer_requests').select('*').eq('employee_code', code).order('created_at');
  return data || [];
}
export async function confirmationsOf(requestId: string): Promise<Record<string, any>[]> {
  const { data } = await adminDb().from('store_transfer_confirmations').select('*').eq('request_id', requestId).order('side');
  return data || [];
}

/** 把測試範圍員編的主檔、異動、調店申請登錄到 registry（sweeper 後備清除）。 */
export async function registerP02(codes: string[]) {
  const safe = Array.from(new Set(codes)).filter((c) => P02_CODE_RANGE.test(c));
  if (!safe.length) return;
  const db = adminDb();
  const reg = createRegistry({ runId: runIdOrThrow() });
  for (const table of ['employee_movement_history', 'store_employees', 'store_transfer_requests'] as const) {
    const { data } = await db.from(table).select('id').in('employee_code', safe);
    if (data?.length) reg.record({ table, column: 'id', values: data.map((r: any) => String(r.id)), note: `P02 ${table}` });
  }
}

/** 測試結束：只刪測試範圍內員編的資料（調店確認紀錄隨申請 cascade 清除）。 */
export async function purgeP02(codes: string[]) {
  const safe = Array.from(new Set(codes)).filter((c) => P02_CODE_RANGE.test(c));
  if (!safe.length) return;
  const db = adminDb();
  for (const table of ['store_transfer_requests', 'employee_movement_history', 'store_employees']) {
    const { error } = await db.from(table).delete().in('employee_code', safe);
    if (error) throw new Error(`清除 ${table} 失敗：${error.message}`);
  }
  const { error } = await db.from('monthly_staff_status').delete().in('employee_code', safe).like('year_month', '2099-%');
  if (error) throw new Error(`清除 monthly_staff_status 失敗：${error.message}`);
}

/** 清掉本 run 以 admin 身分留下的批次收據（只限測試期間建立的列）。 */
export async function purgeReceipts(since: string, stores: string[]) {
  const db = adminDb();
  const actor = adminUserId();
  await db.from('workspace_movement_requests').delete().eq('actor_id', actor).gte('created_at', since);
  await db.from('workspace_employee_import_receipts').delete().eq('actor_id', actor).gte('created_at', since);
  if (stores.length) await db.from('workspace_promotion_requests').delete().in('store_id', stores).gte('created_at', since);
}

export type ImportRow = [store: string, code: string, name: string, position: string, date: string];
/** 依員工匯入範本格式（第一列標題）產生 xlsx，日期一律用文字。 */
export function employeeWorkbook(rows: ImportRow[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([['門市代號', '員編', '姓名', '職位', '到職日期'], ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '員工資料');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function nativePreview(admin: APIRequestContext, rows: ImportRow[]) {
  const res = await admin.post('/api/workspace/employee-import', { multipart: { file: { name: 'p02.xlsx', mimeType: XLSX_MIME, buffer: employeeWorkbook(rows) } } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}
export async function nativeSave(admin: APIRequestContext, preview: any) {
  const res = await admin.put('/api/workspace/employee-import', { data: { requestId: randomUUID(), rows: preview.rows } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** 暫時授權：替角色加上權限、替使用者加上督導任命；回傳還原函式（測試 finally／afterAll 必須呼叫）。 */
export async function grantTransferSupervisors(plan: { roleCode: string; email: string; stores: string[] }[]): Promise<() => Promise<void>> {
  const db = adminDb();
  const { data: perm } = await db.from('permissions').select('id').eq('code', 'employee.store_transfer.confirm').single();
  const addedRolePerms: string[] = [];
  const addedAssignments: string[] = [];
  const undo = async () => {
    if (addedAssignments.length) await db.from('store_managers').delete().in('id', addedAssignments);
    if (addedRolePerms.length) await db.from('role_permissions').delete().in('id', addedRolePerms);
  };
  try {
    for (const p of plan) {
      const { data: role } = await db.from('roles').select('id').eq('code', p.roleCode).single();
      const { data: user } = await db.from('profiles').select('id').eq('email', p.email).single();
      const { data: has } = await db.from('role_permissions').select('id,is_allowed').eq('role_id', role.id).eq('permission_id', perm.id).maybeSingle();
      if (!has) {
        const { data: row, error } = await db.from('role_permissions').insert({ role_id: role.id, permission_id: perm.id, is_allowed: true }).select('id').single();
        if (error) throw new Error(`加上權限失敗：${error.message}`);
        addedRolePerms.push(row.id);
      } else if (!has.is_allowed) throw new Error('角色已明確禁止此權限，測試不覆寫');
      for (const store of p.stores) {
        const { data: ex } = await db.from('store_managers').select('id').eq('user_id', user.id).eq('store_id', store).eq('role_type', 'supervisor').maybeSingle();
        if (ex) continue;
        const { data: row, error } = await db.from('store_managers').insert({ user_id: user.id, store_id: store, role_type: 'supervisor', is_primary: false }).select('id').single();
        if (error) throw new Error(`加上督導任命失敗：${error.message}`);
        addedAssignments.push(row.id);
        createRegistry({ runId: runIdOrThrow() }).record({ table: 'store_managers', column: 'id', values: [String(row.id)], note: 'P02 督導任命 fixture' });
      }
    }
  } catch (e) {
    await undo();
    throw e;
  }
  return undo;
}
