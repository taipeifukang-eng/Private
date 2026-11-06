// 職等表（M2 規格 B.2，使用者 2026-11-05 survey/m2 確認）。A 組與 B 組共用。
//
// 系統實際值（DEV 唯讀盤點，2026-11-05）：
//   職位（monthly_staff_status.position、store_employees.position／current_position）為 types/workflow.ts POSITION_OPTIONS 的字串，
//   例如「新人」「專員」「組長」「主任」「副店長」「店長」「行政」。
//   階段存在 monthly_staff_status.newbie_level：「未過階新人」「一階新人」「二階新人」（職位＝新人）、
//   「未過階行政」「過階行政」（職位＝行政）；專員以上沒有階段（null）。
//   升職異動（employee_movement_history）的 new_value 是職位，階段寫在 notes 的「新人等級：xxx」或「行政階級：xxx」
//   （lib/monthly-staff/promotion-level.ts getPromotionLevelFromNotes）。
//   「代理店長」是註記（is_acting_manager、異動 acting_manager），不是正式職位，不參與職等比較。
//
// 規格職等表只涵蓋下列 12 個層級；POSITION_OPTIONS 其餘職位（總經理、副總經理、資深經理、資深副理、副理、資深專員、
// 高級專員、出納專員、助理、兼職專員、兼職藥師、兼職藥師專員、兼職助理）不在表內，一律回傳 null（無職等），
// 不自行猜測，已列入回報給使用者。

export type RankTrack = 'store' | 'admin';
export type PositionRank = { track: RankTrack; rank: number; position: string; level: string | null; label: string; stageKnown: boolean };

/** 門市職等，由低到高。 */
export const STORE_RANK_ORDER = [
  '新人（未過階）',
  '新人（一階）',
  '新人（二階）',
  '專員',
  '組長',
  '主任',
  '副店長',
  '店長',
  '督導',
  '經理',
] as const;
/** 門市行政職等，由低到高。 */
export const ADMIN_RANK_ORDER = ['行政（未過階）', '行政（過階）'] as const;

export const ACTING_MANAGER_POSITION = '代理店長';

const NEWBIE_STAGES: Record<string, number> = { 未過階: 0, 一階: 1, 二階: 2 };
const ADMIN_STAGES: Record<string, number> = { 未過階: 0, 過階: 1 };

/** 階段字串正規化：接受「一階新人」「一階」「新人（一階）」「過階行政」「行政（過階）」。 */
export function normalizeStage(level: unknown, position: '新人' | '行政'): string | null {
  const text = typeof level === 'string' ? level.replace(/[\s（）()]/g, '').replace(position, '') : '';
  const table = position === '新人' ? NEWBIE_STAGES : ADMIN_STAGES;
  return Object.prototype.hasOwnProperty.call(table, text) ? text : null;
}

/** 回傳職等；不在規格職等表內（含代理店長、兼職職位、空值）回傳 null。 */
export function positionRank(position: unknown, level?: unknown): PositionRank | null {
  const name = typeof position === 'string' ? position.trim() : '';
  if (name === '新人') {
    const stage = normalizeStage(level, '新人');
    // 新人但階段未記錄：保守視為最低一階（未過階），並以 stageKnown=false 標示。
    const index = stage === null ? 0 : NEWBIE_STAGES[stage];
    return { track: 'store', rank: index, position: name, level: stage, label: STORE_RANK_ORDER[index], stageKnown: stage !== null };
  }
  if (name === '行政') {
    const stage = normalizeStage(level, '行政');
    const index = stage === null ? 0 : ADMIN_STAGES[stage];
    return { track: 'admin', rank: index, position: name, level: stage, label: ADMIN_RANK_ORDER[index], stageKnown: stage !== null };
  }
  const index = (STORE_RANK_ORDER as readonly string[]).indexOf(name);
  // 新人三階佔 0..2，其餘從 3 起算；「專員」之後的名稱依序遞增。
  if (index >= 3) return { track: 'store', rank: index, position: name, level: null, label: name, stageKnown: true };
  return null;
}

/** 比較兩個職等；不同軌道或任一邊沒有職等回傳 null（無法比較）。 */
export function compareRank(a: PositionRank | null, b: PositionRank | null): number | null {
  if (!a || !b || a.track !== b.track) return null;
  return a.rank - b.rank;
}

export type RankedEntry = { position: string; level?: string | null; effective_date: string };

/**
 * B.2：同時登記多階升職時，員工目前職位呈現「相對最高的職等」。
 * 判斷順序：生效日較晚者優先；生效日相同時取職等最高者；職等無法比較時保留先出現者（穩定）。
 * 代理店長只是註記，不參與。
 */
export function pickEffectivePosition<T extends RankedEntry>(entries: readonly T[]): T | null {
  let best: T | null = null;
  for (const entry of entries) {
    if (!entry || entry.position === ACTING_MANAGER_POSITION) continue;
    if (!best) { best = entry; continue; }
    if (entry.effective_date > best.effective_date) { best = entry; continue; }
    if (entry.effective_date < best.effective_date) continue;
    const order = compareRank(positionRank(entry.position, entry.level), positionRank(best.position, best.level));
    if (order !== null && order > 0) best = entry;
  }
  return best;
}

// H.6：升職職位下拉的分組（使用者 2026-11-06 survey/m2-followup）。
// 預設只列門市職等與兼職職位；偏向總部的職位收在「顯示總部職位」之後，仍可選。只影響畫面分組，不改排名規則、不限制可儲存的職位；
// 批次升遷 Excel 匯入與 API 仍接受總部職位。
export const HQ_POSITIONS = ['總經理', '副總經理', '資深經理', '資深副理', '副理', '資深專員', '高級專員', '出納專員', '助理'] as const;
/** 兼職四職位視為門市一般選項。 */
export const PART_TIME_POSITIONS = ['兼職專員', '兼職藥師', '兼職藥師專員', '兼職助理'] as const;

export function isHeadquartersPosition(position: unknown): boolean {
  return typeof position === 'string' && (HQ_POSITIONS as readonly string[]).includes(position.trim());
}

/** 把職位清單分成「門市（含兼職）」與「總部」兩組，保留原順序。 */
export function splitPromotionPositions(all: readonly string[]): { store: string[]; headquarters: string[] } {
  const store: string[] = [];
  const headquarters: string[] = [];
  for (const position of all || []) (isHeadquartersPosition(position) ? headquarters : store).push(position);
  return { store, headquarters };
}
