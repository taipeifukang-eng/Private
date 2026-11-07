// W13 巡店列表的純函式（M4 Q1–Q4）：統計口徑、預設月份、可見範圍（舊版聯集）。
import { taipeiDate } from "./home-rules";

/** 已送出的巡店單：已完成與已結案（草稿、進行中不是）。 */
export const FINISHED_STATUSES = ["completed", "closed"] as const;
export const isFinished = (status: string | null | undefined) =>
  FINISHED_STATUSES.includes(status as any);

type Graded = { status?: string | null; grade?: string | number | null };

/**
 * 四張統計卡（Q1 只算所選月份，由呼叫端先篩好月份；Q2 只算已完成）。
 * 等級分段新舊相同：8–10 優秀、6–7 良好、0–5 需改善。
 * includeDrafts=true 為舊版口徑（草稿、進行中也算，grade 空值當 0），僅供新舊對照測試。
 */
export function inspectionStats(records: Graded[], includeDrafts = false) {
  const rows = includeDrafts ? records : records.filter((r) => isFinished(r.status));
  const g = (r: Graded) => parseInt(String(r.grade ?? "0"), 10) || 0;
  return {
    total: rows.length,
    excellent: rows.filter((r) => g(r) >= 8).length,
    good: rows.filter((r) => g(r) >= 6 && g(r) < 8).length,
    improve: rows.filter((r) => g(r) < 6).length,
  };
}

/** Q4：預設月份＝可見資料中最新一筆巡店所在月份；完全沒資料才用本月（台灣）。 */
export function latestDataMonth(
  dates: (string | null | undefined)[],
  now: Date = new Date(),
): string {
  let latest = "";
  for (const d of dates) {
    const day = typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "";
    if (day > latest) latest = day;
  }
  return latest ? latest.slice(0, 7) : taipeiDate(now).yearMonth;
}

export type ListScope = { all: boolean; own: boolean; assigned: string[] };
/**
 * Q3：舊版可見範圍（RLS p1f_inspection_masters_read）的聯集：
 *   有 view_all → 全部；自己建立的一定看得到；有 view_store 或 view_own 其中之一，再加上被指派管理該門市 → 該門市所有人的單。
 */
export function listScopeFor(
  has: (code: string) => boolean,
  assignedStoreIds: string[],
): ListScope {
  if (has("inspection.view_all")) return { all: true, own: false, assigned: [] };
  const store = has("inspection.view_store") || has("inspection.view_own");
  return { all: false, own: true, assigned: store ? assignedStoreIds : [] };
}
export function rowInListScope(
  scope: ListScope,
  row: { inspector_id: string | null; store_id: string },
  userId: string,
) {
  return (
    scope.all ||
    (scope.own && row.inspector_id === userId) ||
    scope.assigned.includes(row.store_id)
  );
}
/** 舊版 RLS 謂詞（逐字照 p1f_inspection_masters_read），供等價測試當基準。 */
export function legacyRlsAllows(
  perms: { viewAll: boolean; viewStore: boolean; viewOwn: boolean },
  assignedStoreIds: string[],
  row: { inspector_id: string | null; store_id: string },
  userId: string,
) {
  return (
    perms.viewAll ||
    row.inspector_id === userId ||
    ((perms.viewStore || perms.viewOwn) && assignedStoreIds.includes(row.store_id))
  );
}
