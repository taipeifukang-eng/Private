/**
 * 藥師主檔 / 每月藥師快照：重新整理（同步）的觸發判斷。
 *
 * 未關帳時，上次同步之後只要有符合原類型與範圍的異動，且滿足下列任一條件，就重新整理：
 *   (a) created_at  > last_synced_at          （新登錄）
 *   (b) updated_at  > last_synced_at          （事後修改）
 *   (c) movement_date 落在「上次同步的台灣日期」（不含）到「今天」（含）之間
 *       （提前登錄、生效日在上次同步之後才到）
 *
 * 純函式（taiwanDateOf / movementTriggersSync / buildSyncTriggerOrFilter）可直接單元測試；
 * hasSyncTriggeringMovement 只負責把同一套條件組成查詢，「今天」可注入以利測試。
 */

const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 轉成標準 ISO（UTC, Z 結尾）；避免 "+00:00" 的加號在查詢字串中被誤解。 */
export function normalizeIso(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${String(input)}`);
  return d.toISOString();
}

/** 時間點對應的台灣日期 YYYY-MM-DD。 */
export function taiwanDateOf(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${String(input)}`);
  return new Date(d.getTime() + TAIWAN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 台灣時間顯示：YYYY-MM-DD HH:mm。 */
export function formatTaiwanDateTime(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + TAIWAN_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

export interface SyncTriggerMovement {
  created_at?: string | null;
  updated_at?: string | null;
  movement_date?: string | null;
}

/** 單筆異動是否滿足三條件之一（類型與範圍由呼叫端先篩選）。 */
export function movementTriggersSync(
  m: SyncTriggerMovement,
  lastSyncedAt: string | Date,
  today: string,
): boolean {
  const last = new Date(lastSyncedAt).getTime();
  if (m.created_at && new Date(m.created_at).getTime() > last) return true;
  if (m.updated_at && new Date(m.updated_at).getTime() > last) return true;
  const lastDate = taiwanDateOf(lastSyncedAt);
  const md = m.movement_date ? String(m.movement_date).slice(0, 10) : '';
  return !!md && md > lastDate && md <= today;
}

/** PostgREST .or() 字串，與 movementTriggersSync 等價。 */
export function buildSyncTriggerOrFilter(lastSyncedAt: string | Date, today: string): string {
  const iso = normalizeIso(lastSyncedAt);
  const lastDate = taiwanDateOf(lastSyncedAt);
  return [
    `created_at.gt.${iso}`,
    `updated_at.gt.${iso}`,
    `and(movement_date.gt.${lastDate},movement_date.lte.${today})`,
  ].join(',');
}

export interface SyncTriggerQueryOptions {
  lastSyncedAt: string | Date;
  /** 台灣「今天」YYYY-MM-DD；測試時可注入。 */
  today: string;
  movementTypes: string[];
  /** 範圍（含）：movement_date 必須落在此區間。 */
  rangeStart: string;
  rangeEnd: string;
  storeIds?: string[];
  employeeCodes?: string[];
}

/** 範圍內是否存在符合三條件之一的異動（只查數量，不取資料）。 */
export async function hasSyncTriggeringMovement(
  client: any,
  opts: SyncTriggerQueryOptions,
): Promise<boolean> {
  let q = client
    .from('employee_movement_history')
    .select('id', { count: 'exact', head: true })
    .in('movement_type', opts.movementTypes)
    .gte('movement_date', opts.rangeStart)
    .lte('movement_date', opts.rangeEnd)
    .or(buildSyncTriggerOrFilter(opts.lastSyncedAt, opts.today));
  if (opts.storeIds) q = q.in('store_id', opts.storeIds);
  if (opts.employeeCodes) q = q.in('employee_code', opts.employeeCodes);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}
