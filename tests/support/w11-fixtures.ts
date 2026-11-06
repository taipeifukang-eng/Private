import { createRequire } from 'node:module';
import { adminDb, runIdOrThrow, userId } from './m3-fixtures';
import { loadHome } from '../../lib/workspace/home';

// W11 / W12 首頁測試共用工具。
// 資料原則：
//  - 獎金明細用保留年度 2038-xx 與測試門市（ZT05）；測試帳號的員編只在測試期間暫時設成 ZT<runId>（sweeper 以 ZTT% 偵測殘留），結束一律還原。
//  - 調店申請的員編為 ZT<runId>（sweeper 標記，action: delete），只刪自己建立的 id。
//  - 壽星、新人入職用 P02 保留員編範圍（FKF6xxxx）與測試門市 ZT01，結束以員編範圍清除。
// 用「替身 context」呼叫 loadHome（admin 為真實 DEV service role，使用者 id 為測試帳號，權限由測試指定），
// 這樣可以驗證目前測試帳號沒有的權限組合（例如只有調店確認權限的督導）。

const nodeRequire = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
};

export const marker = () => `ZT${runIdOrThrow()}`.toUpperCase();

export function stubCtx(role: string, permissions: string[] = [], isAdmin = false) {
  return {
    admin: adminDb(),
    user: { id: userId(role), email: `${role}@example.test` },
    has: (...codes: string[]) => isAdmin || codes.some((c) => permissions.includes(c)),
    isAdmin,
  } as any;
}
export const homeFor = (role: string, permissions: string[] = [], isAdmin = false) => loadHome(stubCtx(role, permissions, isAdmin));

export async function storeIds(): Promise<Record<string, string>> {
  const { data, error } = await adminDb().from('stores').select('id,store_code').in('store_code', ['ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05', 'VW001']);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data as any[]).map((s) => [s.store_code, s.id]));
}

/** 暫時把測試帳號的員編設成 ZT<runId>，回傳還原函式（還原成原值，通常是 null）。 */
export async function withEmployeeCode(role: string): Promise<() => Promise<void>> {
  const db = adminDb();
  const id = userId(role);
  const before = await db.from('profiles').select('employee_code').eq('id', id).single();
  if (before.error) throw new Error(before.error.message);
  const up = await db.from('profiles').update({ employee_code: marker() }).eq('id', id);
  if (up.error) throw new Error(`設定測試員編失敗：${up.error.message}`);
  return async () => {
    const r = await db.from('profiles').update({ employee_code: before.data.employee_code }).eq('id', id);
    if (r.error) throw new Error(`還原測試員編失敗：${r.error.message}`);
  };
}

type BonusSeed = { yearMonth: string; store: string; amounts: Record<string, number>; note?: string };
/** 寫入獎金列與（可選）月結摘要；回傳清除函式（只刪自己建立的 id）。 */
export async function seedBonus(rows: BonusSeed[], confirmed: { yearMonth: string; store: string }[] = []) {
  const db = adminDb();
  const reg = createRegistry({ runId: runIdOrThrow() });
  const ids: string[] = [],
    summaryIds: string[] = [];
  for (const r of rows) {
    const ins = await db
      .from('monthly_bonus_records')
      .insert({ store_id: r.store, year_month: r.yearMonth, employee_code: marker(), employee_name: '自動測試', other_bonus_note: r.note ?? null, ...r.amounts })
      .select('id')
      .single();
    if (ins.error) throw new Error(`建立獎金測試列失敗：${ins.error.message}`);
    ids.push(ins.data.id);
  }
  if (ids.length) reg.record({ table: 'monthly_bonus_records', values: ids, note: 'W11 bonus 2038' });
  for (const c of confirmed) {
    const ins = await db.from('monthly_store_summary').insert({ year_month: c.yearMonth, store_id: c.store, store_status: 'confirmed' }).select('id').single();
    if (ins.error) throw new Error(`建立月結摘要失敗：${ins.error.message}`);
    summaryIds.push(ins.data.id);
  }
  if (summaryIds.length) reg.record({ table: 'monthly_store_summary', values: summaryIds, note: 'W11 summary 2038' });
  return async () => {
    if (ids.length) {
      const d = await db.from('monthly_bonus_records').delete().in('id', ids);
      if (d.error) throw new Error(`清除獎金測試列失敗：${d.error.message}`);
    }
    if (summaryIds.length) {
      const d = await db.from('monthly_store_summary').delete().in('id', summaryIds);
      if (d.error) throw new Error(`清除月結摘要失敗：${d.error.message}`);
    }
  };
}

/** 建立待確認調店申請（員編為 ZT<runId> 標記）；回傳清除函式。 */
export async function seedTransfers(pairs: { from: string; to: string }[]) {
  const db = adminDb();
  const reg = createRegistry({ runId: runIdOrThrow() });
  const ids: string[] = [];
  for (let i = 0; i < pairs.length; i += 1) {
    const ins = await db
      .from('store_transfer_requests')
      .insert({ employee_code: marker(), employee_name: `自動測試${i}`, from_store_id: pairs[i].from, to_store_id: pairs[i].to, status: 'pending', created_by: userId('admin'), notes: '' })
      .select('id')
      .single();
    if (ins.error) throw new Error(`建立調店測試申請失敗：${ins.error.message}`);
    ids.push(ins.data.id);
  }
  if (ids.length) reg.record({ table: 'store_transfer_requests', column: 'id', values: ids, note: 'W11 transfers' });
  return async () => {
    if (!ids.length) return;
    const d = await adminDb().from('store_transfer_requests').delete().in('id', ids);
    if (d.error) throw new Error(`清除調店測試申請失敗：${d.error.message}`);
  };
}

export async function pendingTransferRows() {
  const r = await adminDb().from('store_transfer_requests').select('from_store_id,to_store_id').eq('status', 'pending');
  if (r.error) throw new Error(r.error.message);
  return r.data as { from_store_id: string; to_store_id: string }[];
}
