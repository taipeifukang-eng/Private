/**
 * W01b：編輯頁的天數／時數輸入模式、外務規劃時數自動換算、整月自動判斷（純函式）。
 * 公式沿用舊 app/monthly-status/edit/[id]/page.tsx；API（app/api/workspace/monthly/route.ts save）與 Vue 共用同一份。
 */
import { isSupervisorActingManagerDual } from './block';

export type InputMode = 'days' | 'hours';

/** 督導(代理店長)-雙與兼職填「時數」（基準 160 小時），其餘正職填「天數」。 */
export function inputMode(position: string | null | undefined, employmentType: string, isDual: boolean): InputMode {
  if (isSupervisorActingManagerDual(position, isDual)) return 'hours';
  return employmentType === 'full_time' ? 'days' : 'hours';
}

export const FULL_MONTH_BASE_HOURS = 160;

/**
 * 「該店規劃實上時數」：
 * 1. 職位為督導(代理店長)，或督導＋代理店長＋雙職務 → 本月上班時數
 * 2. 正職整月 → 160
 * 3. 正職非整月且有天數 → 上班天數 / 5 × 32（四捨五入到小數 1 位）
 * 其餘為 null（舊版以 `|| null` 儲存）。
 */
export function plannedExtraTaskHours(args: {
  position: string | null | undefined;
  employment_type: string;
  is_dual_position: boolean;
  monthly_status: string;
  work_days: number | string | null | undefined;
  work_hours: number | string | null | undefined;
}): number | null {
  const workDays = Number(args.work_days) || 0;
  const workHours = Number(args.work_hours) || 0;
  let hours = 0;
  if (args.position === '督導(代理店長)' || isSupervisorActingManagerDual(args.position, args.is_dual_position)) {
    hours = workHours;
  } else if (args.employment_type === 'full_time' && args.monthly_status === 'full_month') {
    hours = FULL_MONTH_BASE_HOURS;
  } else if (args.employment_type === 'full_time' && args.monthly_status !== 'full_month' && workDays > 0) {
    hours = Math.round(((workDays / 5) * 32) * 10) / 10;
  }
  return hours || null;
}

export const PARTIAL_MONTH_POSSIBLE_REASONS = ['新進', '調店', '留職停薪', '復職', '離職'] as const;

export interface MonthStatusAdvice {
  /** 天數剛好等於當月天數時要自動設成的狀態（整月在職）；不需要改則為 null。 */
  autoSet: 'full_month' | null;
  /** 天數不滿整月：顯示「請確認本月狀態」提示。 */
  needsConfirm: boolean;
}

/**
 * W01b-q3：天數滿月 → 自動整月在職；不滿月 → 不自動改，改為提示請確認本月狀態。
 * （舊版不滿月時若目前為整月，會自動改成「到職（本月新進）」；影響獎金的是職位認定，不能猜成新進。）
 */
export function monthStatusAdvice(args: {
  employment_type: string;
  monthly_status: string;
  work_days: number | string | null | undefined;
  total_days_in_month: number | null | undefined;
}): MonthStatusAdvice {
  const total = Number(args.total_days_in_month) || 0;
  const days = Number(args.work_days);
  if (args.employment_type !== 'full_time' || !total || !Number.isFinite(days)) return { autoSet: null, needsConfirm: false };
  if (days === total) return { autoSet: args.monthly_status !== 'full_month' ? 'full_month' : null, needsConfirm: false };
  return { autoSet: null, needsConfirm: days > 0 && days < total };
}
