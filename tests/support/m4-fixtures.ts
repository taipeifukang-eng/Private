import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

// M4（W13 巡店列表、W18 範本與評級設定）測試共用工具。
// 資料原則：只用 VW/ZT 測試門市與保留月份 2099；每筆巡店主表的備註帶 ZT<runId>-M4 標記並登錄 registry，
// 測試結束只刪「自己建立（備註帶本次標記）」的列；sweeper 以備註前綴作後備清除。

const nodeRequire = createRequire(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry, RUN_ID_RE } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = nodeRequire('./credentials.cjs') as { getAccount: (key: string) => { email: string; password: string; userId?: string } };

export const M4_MONTH = { stats: '2099-03', latest: '2099-04', scope: '2099-05', snapshot: '2099-06' } as const;

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}
export const marker = (tag: string) => `ZT${runIdOrThrow()}-M4-${tag}`;
export function userId(key: string): string {
  const id = getAccount(key).userId;
  if (!id) throw new Error(`${key} 測試帳號缺少 userId`);
  return id;
}
export function adminDb(): any {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const storeCache = new Map<string, string>();
export async function storeId(code: string): Promise<string> {
  if (!/^(ZT0[1-5]|VW00[12])$/.test(code)) throw new Error(`只允許測試門市：${code}`);
  if (storeCache.has(code)) return storeCache.get(code)!;
  const r = await adminDb().from('stores').select('id').eq('store_code', code).maybeSingle();
  if (r.error || !r.data) throw new Error(`DEV 缺少測試門市 ${code}`);
  storeCache.set(code, r.data.id);
  return r.data.id;
}

/** 預設評級門檻（與舊版寫死值相同），用來讓種子資料的評級與 DEV 目前設定無關。 */
export const DEFAULT_THRESHOLDS = [220, 215, 191, 181, 171, 161, 151, 141, 131, 121, 0].map((min_score, i) => ({ grade: 10 - i, min_score })).reverse();

export type SeedMaster = {
  store: string;
  inspector: string; // role-matrix key
  date: string; // YYYY-MM-DD（2099）
  status: 'draft' | 'in_progress' | 'completed' | 'closed';
  total?: number;
  type?: 'supervisor' | 'manager';
  tag: string;
  bonus?: number;
  /** 完成單預設用 DEFAULT_THRESHOLDS 當 snapshot（評級由 total 決定）；傳 null 則由 trigger 取目前設定。 */
  thresholds?: unknown | null;
};
/** 以 service role 建立一筆巡店主表（合格定位），登錄 registry；回傳 id。 */
export async function seedMaster(s: SeedMaster): Promise<string> {
  if (!/^2099-/.test(s.date)) throw new Error('只允許保留月份 2099');
  const finished = s.status === 'completed' || s.status === 'closed';
  const row: Record<string, unknown> = {
    store_id: await storeId(s.store),
    inspector_id: userId(s.inspector),
    created_by: userId(s.inspector),
    inspection_date: s.date,
    inspection_type: s.type || 'supervisor',
    inspection_no: `VW-M4-${randomUUID().slice(0, 8)}`,
    status: s.status,
    total_score: s.total ?? 0,
    max_possible_score: 220,
    supervisor_notes: marker(s.tag),
    improvement_bonus: s.bonus ?? 0,
    gps_latitude: 25.033,
    gps_longitude: 121.5654,
    gps_accuracy: 20,
    gps_timestamp: new Date().toISOString(),
  };
  if (finished && s.thresholds !== null) row.grade_thresholds = s.thresholds ?? DEFAULT_THRESHOLDS;
  const r = await adminDb().from('inspection_masters').insert(row).select('id').single();
  if (r.error) throw new Error(`建立測試巡店失敗：${r.error.message}`);
  createRegistry({ runId: runIdOrThrow() }).record({ table: 'inspection_masters', column: 'id', values: [r.data.id], note: 'M4 測試巡店' });
  return r.data.id;
}
export async function readMaster(id: string): Promise<Record<string, any>> {
  const r = await adminDb().from('inspection_masters').select('*').eq('id', id).single();
  if (r.error) throw new Error(`回讀巡店失敗：${r.error.message}`);
  return r.data;
}
/** 只刪本次 run 建立（備註帶 ZT<runId>-M4-）的巡店；子表 cascade。 */
export async function deleteRunMasters() {
  const del = await adminDb().from('inspection_masters').delete().like('supervisor_notes', `ZT${runIdOrThrow()}-M4-%`);
  if (del.error) throw new Error(`清除測試巡店失敗：${del.error.message}`);
}
