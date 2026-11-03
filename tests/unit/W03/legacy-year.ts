import {
  calcMonthlyBonus,
  calcQuarterlyBonus,
  type BonusResult,
  type MonthlyPerformance,
  type QuarterlyBonusResult,
  type ThresholdDef,
} from '../../../lib/performance/bonus-calc';

/**
 * 舊版 app/admin/performance/page.tsx 年度頁計算的逐行移植（rowToPerf、bonusResults、quarterlyResults、emptyRecord）。
 * 舊頁是 React 元件、不能 import，所以在這裡保留一份「舊版對照實作」；
 * tests/unit/W03/legacy-source.test.ts 會檢查舊頁原始碼仍含這幾段字面，防止舊頁變動後這份對照失效。
 */
export interface LegacyRow {
  month: number;
  business_days: number;
  monthly_gross_profit_target: number | null;
  monthly_revenue_target: number | null;
  monthly_customer_count_target: number | null;
  last_month_rx_target: number | null;
  monthly_gross_profit_actual: number | null;
  activity_day_gross_profit: number | null;
  monthly_revenue_actual: number | null;
  monthly_customer_count_actual: number | null;
  last_month_rx_actual: number | null;
}

export function legacyEmptyRecord(month: number): LegacyRow {
  return {
    month,
    business_days: 26,
    monthly_gross_profit_target: null,
    monthly_revenue_target: null,
    monthly_customer_count_target: null,
    last_month_rx_target: null,
    monthly_gross_profit_actual: null,
    monthly_revenue_actual: null,
    activity_day_gross_profit: null,
    monthly_customer_count_actual: null,
    last_month_rx_actual: null,
  };
}

export function legacyRowToPerf(r: LegacyRow): MonthlyPerformance {
  return {
    businessDays: r.business_days || 26,
    grossProfitTarget: r.monthly_gross_profit_target,
    revenueTarget: r.monthly_revenue_target,
    customerCountTarget: r.monthly_customer_count_target,
    rxTarget: r.last_month_rx_target,
    grossProfitActual: r.monthly_gross_profit_actual,
    activityDayGrossProfit: r.activity_day_gross_profit,
    revenueActual: r.monthly_revenue_actual,
    customerCountActual: r.monthly_customer_count_actual,
    rxActual: r.last_month_rx_actual,
  };
}

export function legacyYear(
  serverRows: Partial<LegacyRow>[],
  monthlyThresholds: ThresholdDef[],
  quarterlyThresholds: ThresholdDef[],
): { months: (BonusResult | null)[]; quarters: (QuarterlyBonusResult | null)[] } {
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const rows: LegacyRow[] = MONTHS.map((m) => {
    const found = serverRows.find((r) => r.month === m);
    return found ? ({ ...legacyEmptyRecord(m), ...found } as LegacyRow) : legacyEmptyRecord(m);
  });
  const bonusResults = rows.map((r) => {
    const perf = legacyRowToPerf(r);
    if (!perf.grossProfitTarget || !perf.grossProfitActual) return null;
    return calcMonthlyBonus(perf, monthlyThresholds);
  });
  const quarterlyResults = [0, 1, 2, 3].map((qi) => {
    const qMonths = [qi * 3 + 1, qi * 3 + 2, qi * 3 + 3];
    const monthPerfs = qMonths.map((m) => legacyRowToPerf(rows.find((r) => r.month === m) ?? legacyEmptyRecord(m)));
    const monthBonusAmounts = qMonths.map((m) => bonusResults[m - 1]?.finalBonus ?? 0);
    if (monthPerfs.every((p) => !p.grossProfitTarget || !p.grossProfitActual)) return null;
    try {
      return calcQuarterlyBonus(monthPerfs, monthBonusAmounts, quarterlyThresholds);
    } catch {
      return null;
    }
  });
  return { months: bonusResults, quarters: quarterlyResults };
}
