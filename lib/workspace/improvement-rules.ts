// M4 W17／W16 改善回補與期限的純規則（與資料庫 calculate_improvement_bonus 同一套算法，供 API、畫面與新舊對照測試共用）。
// 日期一律是 YYYY-MM-DD 字串；「今天／回報日」按台灣日期（Q17），避免凌晨 0 到 8 點被當成前一天。

export type BonusRule = {
  day_from: number;
  day_to: number;
  /** 回補扣分的百分比（20 代表 20%）。 */
  bonus_score: number;
  sort_order?: number | null;
  is_active?: boolean | null;
  description?: string | null;
};

const taipeiFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** 台灣日期（YYYY-MM-DD）。 */
export const taipeiDate = (value: string | Date = new Date()) =>
  taipeiFormat.format(typeof value === "string" ? new Date(value) : value);
export const improvementToday = () => taipeiDate(new Date());

const DAY = 86400000;
const asUtc = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (from: string, to: string) =>
  Math.round((asUtc(to) - asUtc(from)) / DAY);
export const addDays = (date: string, days: number) =>
  new Date(asUtc(date) + days * DAY).toISOString().slice(0, 10);

/** 規則挑選：只看啟用中的，依 sort_order 由小到大取第一條天數範圍包含 days 的（與資料庫 ORDER BY sort_order LIMIT 1 相同）。 */
export function pickRule(rules: BonusRule[], days: number): BonusRule | null {
  return (
    rules
      .filter((r) => r.is_active !== false)
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.sort_order ?? 0) - (b.r.sort_order ?? 0) || a.i - b.i)
      .map((x) => x.r)
      .find((r) => days >= r.day_from && days <= r.day_to) || null
  );
}

/** 扣分乘回補百分比，四捨五入到小數一位（與資料庫 ROUND(numeric,1) 相同：正數半數進位）；用整數運算避免浮點誤差。 */
export function bonusScore(deduction: number, percent: number): number {
  const d = Math.round((Number(deduction) || 0) * 100);
  const p = Math.round((Number(percent) || 0) * 100);
  // d/100 * p/100 / 100 = d*p / 1e6；四捨五入到 0.1 → round(d*p / 1e5) / 10
  const scaled = d * p;
  const sign = scaled < 0 ? -1 : 1;
  return (sign * Math.floor((Math.abs(scaled) + 50000) / 100000)) / 10;
}

export type BonusResult = { days_taken: number; percent: number; bonus_score: number; overdue: boolean };

/** 新版（Q17、Q19）：天數按台灣日期；回報日超過期限回補 0。 */
export function reportBonus(input: {
  inspectionDate: string;
  deadline?: string | null;
  improvedAt: string | Date;
  deduction: number;
  rules: BonusRule[];
}): BonusResult {
  const reportDate = taipeiDate(input.improvedAt);
  const days = Math.max(daysBetween(input.inspectionDate, reportDate), 0);
  const overdue = !!input.deadline && reportDate > input.deadline.slice(0, 10);
  const percent = overdue ? 0 : pickRule(input.rules, days)?.bonus_score ?? 0;
  return { days_taken: days, percent, bonus_score: bonusScore(input.deduction, percent), overdue };
}

/** 舊版正式區函式（migration_improvement_bonus_percentage.sql）：天數按 UTC 日期，沒有逾期保護。供新舊同輸入對照測試。 */
export function legacyReportBonus(input: {
  inspectionDate: string;
  improvedAt: string | Date;
  deduction: number;
  rules: BonusRule[];
}): BonusResult {
  const utcDate = new Date(input.improvedAt).toISOString().slice(0, 10);
  const days = Math.max(daysBetween(input.inspectionDate, utcDate), 0);
  const percent = pickRule(input.rules, days)?.bonus_score ?? 0;
  return { days_taken: days, percent, bonus_score: bonusScore(input.deduction, percent), overdue: false };
}

/** 改善期限：巡店日加所有啟用規則中最大的 day_to（沒有規則時 7 天）。 */
export function improvementDeadline(inspectionDate: string, rules: BonusRule[]) {
  const active = rules.filter((r) => r.is_active !== false);
  const max = active.length ? Math.max(...active.map((r) => r.day_to)) : 7;
  return addDays(inspectionDate, max);
}

/** 顯示用狀態：pending 且期限已過（台灣日期）才顯示「已逾期」；不寫回資料庫。 */
export function displayStatus(status: string, deadline: string | null | undefined, today = improvementToday()) {
  return status === "pending" && deadline && deadline.slice(0, 10) < today ? "overdue" : status;
}
/** 距離期限剩幾天（今天到期為 0，逾期為負數）。 */
export const daysRemaining = (deadline: string, today = improvementToday()) =>
  daysBetween(today, deadline.slice(0, 10));
/** 舊版：待改善且剩 2 天內（含今天到期）標急迫；已過期限的另外顯示為「已逾期」，不再算急迫。 */
export const isUrgent = (status: string, deadline: string | null | undefined, today = improvementToday()) =>
  status === "pending" && !!deadline && daysRemaining(deadline, today) >= 0 && daysRemaining(deadline, today) <= 2;
export function remainingLabel(deadline: string, today = improvementToday()) {
  const n = daysRemaining(deadline, today);
  return n > 0 ? `剩 ${n} 天` : n === 0 ? "今天到期" : `逾期 ${Math.abs(n)} 天`;
}

/** 回補級距說明，例如「3 天內回補 20%」「4–5 天回補 10%」。 */
export function tierLabels(rules: BonusRule[]): string[] {
  return rules
    .filter((r) => r.is_active !== false)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => {
      const span = r.day_from === 0 ? `${r.day_to} 天內` : r.day_from === r.day_to ? `第 ${r.day_to} 天` : `${r.day_from}–${r.day_to} 天`;
      return `${span}回補 ${Number(r.bonus_score)}%`;
    });
}
