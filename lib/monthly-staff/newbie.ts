/**
 * W01b：新人升階判斷（純函式，無伺服器相依；Vue、API、測試共用）。
 *
 * 來源：
 * - 編輯頁（舊 app/monthly-status/edit/[id]/page.tsx handleSave）：到職後「剛好第 N 個月」才提示（monthsDiff === 1 / 2 / 6）。
 * - 送審前檢查（舊 app/store/actions.ts checkNewbieStatus）：「滿 N 個月以上」都列出（monthsDiff >= N），由 monthly-status-rules 引用。
 *
 * W01b-q2（使用者 2026-11-02）：提醒不阻擋儲存；滿 6 個月時不在此表單直接改職位，改為提示以人員異動紀錄處理。
 */

export type NewbieLevelValue = '一階新人' | '二階新人';

/** 'YYYY-MM' 或 'YYYY-MM-DD' 轉為「年 × 12 + 月」序號；格式不合回 null。不經過 Date，避免時區位移。 */
export function monthIndex(value: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

/** 月份名冊月份相對到職月份經過幾個月（到職當月為 0）。 */
export function monthsSinceHire(startDate: string | null | undefined, yearMonth: string | null | undefined): number | null {
  const hired = monthIndex(startDate);
  const current = monthIndex(yearMonth);
  if (hired === null || current === null) return null;
  return current - hired;
}

/** 是否適用新人階段規則：職位為新人，或本月狀態為本月新進。 */
export function isNewbieCandidate(position: string | null | undefined, monthlyStatus: string | null | undefined): boolean {
  return position === '新人' || monthlyStatus === 'new_hire';
}

/**
 * 編輯頁是否套用新人階段（一階／二階）：與舊版一致，職位為新人或本月狀態為 new_hire 即套用（含行政＋new_hire），
 * 與送審前檢查共用 isNewbieCandidate，兩處判斷一致。
 */
export function usesNewbieLevel(position: string | null | undefined, monthlyStatus: string | null | undefined): boolean {
  return isNewbieCandidate(position, monthlyStatus);
}

/** 送審前檢查用（累積判斷）：回傳建議文字，沒有則空字串。順序與舊版 checkNewbieStatus 一致。 */
export function suggestedNewbieAction(monthsDiff: number, position: string | null | undefined, level: string | null | undefined): string {
  let suggested = '';
  if (monthsDiff >= 1 && level !== '一階新人' && level !== '二階新人') suggested = '應該過一階段';
  else if (monthsDiff >= 2 && level !== '二階新人') suggested = '應該過二階段';
  if (monthsDiff >= 6 && position === '新人') suggested = '應該要過專員考試';
  return suggested;
}

export interface NewbiePrompt {
  /** level：建議改新人階段（可一鍵套用）；promote：滿 6 個月，提示改以人員異動紀錄處理（不可在此改職位）。 */
  kind: 'level' | 'promote';
  monthsDiff: number;
  message: string;
  /** kind 為 level 時，按「是」要套用的階段。 */
  suggestedLevel?: NewbieLevelValue;
}

export const PROMOTION_BY_MOVEMENT_NOTICE = '升階請以人員異動紀錄處理';

/**
 * 編輯頁儲存前的新人升階提醒（舊版 252–294 行邏輯，W01b-q2 調整為不阻擋、不直接改職位）。
 * 判斷條件沿用舊版：有到職日，且（職位為新人或本月狀態為本月新進）；到職後剛好第 1 / 2 / 6 個月。
 */
export function newbiePromotionPrompt(
  startDate: string | null | undefined,
  yearMonth: string | null | undefined,
  position: string | null | undefined,
  monthlyStatus: string | null | undefined,
  newbieLevel: string | null | undefined,
): NewbiePrompt | null {
  if (!startDate || !usesNewbieLevel(position, monthlyStatus)) return null;
  const monthsDiff = monthsSinceHire(startDate, yearMonth);
  if (monthsDiff === null) return null;
  if (monthsDiff === 1 && newbieLevel !== '一階新人')
    return { kind: 'level', monthsDiff, suggestedLevel: '一階新人', message: '此新人應該過一階段，是否要改成一階新人？' };
  if (monthsDiff === 2 && newbieLevel !== '二階新人')
    return { kind: 'level', monthsDiff, suggestedLevel: '二階新人', message: '此新人應該過二階段，是否要改成二階新人？' };
  if (monthsDiff === 6 && position === '新人')
    return { kind: 'promote', monthsDiff, message: `此新人已滿 6 個月，應該要過專員考試。${PROMOTION_BY_MOVEMENT_NOTICE}，本表單不會直接改職位。` };
  return null;
}
