/**
 * W01b：新人升階判斷（純函式，無伺服器相依；Vue、API、測試共用）。
 *
 * 來源：
 * - 編輯頁（舊 app/monthly-status/edit/[id]/page.tsx handleSave）：到職後「剛好第 N 個月」才提示（monthsDiff === 1 / 2 / 6）。
 * - 送審前檢查（舊 app/store/actions.ts checkNewbieStatus）：「滿 N 個月以上」都列出（monthsDiff >= N），由 monthly-status-rules 引用。
 *
 * 修正規格 C.4（使用者 2026-11-04）：照舊版 confirm，取消即中止儲存；滿 6 個月提示「應升為專員，請加強員工訓練」，不改職位、不附異動連結。
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
  /** level：建議改新人階段（確定後套用）；promote：滿 6 個月，只提示應升為專員（不在此表單改職位）。 */
  kind: 'level' | 'promote';
  monthsDiff: number;
  message: string;
  /** kind 為 level 時，按「是」要套用的階段。 */
  suggestedLevel?: NewbieLevelValue;
}

export const PROMOTE_TO_SPECIALIST_MESSAGE = '應升為專員，請加強員工訓練';

/**
 * 編輯頁儲存前的新人升階提醒（舊版 252–294 行邏輯；滿 6 個月只提示、不直接改職位）。
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
    return { kind: 'promote', monthsDiff, message: `此新人已滿 6 個月，${PROMOTE_TO_SPECIALIST_MESSAGE}。` };
  return null;
}
