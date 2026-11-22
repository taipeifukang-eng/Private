import {
  calcMonthlyBonus,
  calcQuarterlyBonus,
  type BonusResult,
  type MonthlyPerformance,
  type QuarterlyBonusResult,
  type ThresholdDef,
} from "../performance/bonus-calc";

/**
 * 績效年度頁的月、季獎金計算（Vue 年度頁與測試共用）。
 * 判斷規則逐行對照舊版 app/admin/performance/page.tsx：
 *  - rowToPerf：business_days || 26；其餘欄位原樣帶入（null 保持 null）。
 *  - 月獎金：毛利目標或毛利實際為「假值」（null、undefined、0）時不計算（null）。
 *  - 季獎金：三個月都沒有毛利目標與實績時為 null；否則以該季三個月的 perf 與月獎金（缺月為 0）計算。
 */
export interface PerformanceRow {
  month: number;
  business_days?: number | null;
  monthly_gross_profit_target?: number | null;
  monthly_revenue_target?: number | null;
  monthly_customer_count_target?: number | null;
  last_month_rx_target?: number | null;
  monthly_gross_profit_actual?: number | null;
  activity_day_gross_profit?: number | null;
  monthly_revenue_actual?: number | null;
  monthly_customer_count_actual?: number | null;
  last_month_rx_actual?: number | null;
}

export function rowToPerf(r: PerformanceRow): MonthlyPerformance {
  return {
    businessDays: r.business_days || 26,
    grossProfitTarget: r.monthly_gross_profit_target ?? null,
    revenueTarget: r.monthly_revenue_target ?? null,
    customerCountTarget: r.monthly_customer_count_target ?? null,
    rxTarget: r.last_month_rx_target ?? null,
    grossProfitActual: r.monthly_gross_profit_actual ?? null,
    activityDayGrossProfit: r.activity_day_gross_profit ?? null,
    revenueActual: r.monthly_revenue_actual ?? null,
    customerCountActual: r.monthly_customer_count_actual ?? null,
    rxActual: r.last_month_rx_actual ?? null,
  };
}

export interface YearBonus {
  /** 12 個月（索引 0 為 1 月）；沒有毛利目標或實績者為 null。 */
  months: (BonusResult | null)[];
  /** 4 季；三個月都沒有資料者為 null。 */
  quarters: (QuarterlyBonusResult | null)[];
  /** 每季有毛利目標與實績的月份數。 */
  filled: number[];
}

export function calcYearBonus(
  rows: PerformanceRow[],
  monthly: ThresholdDef[],
  quarterly: ThresholdDef[],
): YearBonus {
  const byMonth = Array.from(
    { length: 12 },
    (_, i) => rows.find((r) => r.month === i + 1) || ({ month: i + 1, business_days: 26 } as PerformanceRow),
  );
  const perfs = byMonth.map(rowToPerf);
  const months = perfs.map((p) =>
    !p.grossProfitTarget || !p.grossProfitActual ? null : calcMonthlyBonus(p, monthly),
  );
  const quarters = [0, 1, 2, 3].map((q) => {
    const qp = perfs.slice(q * 3, q * 3 + 3);
    if (qp.every((p) => !p.grossProfitTarget || !p.grossProfitActual)) return null;
    try {
      return calcQuarterlyBonus(
        qp,
        months.slice(q * 3, q * 3 + 3).map((b) => b?.finalBonus ?? 0),
        quarterly,
      );
    } catch {
      return null;
    }
  });
  const filled = [0, 1, 2, 3].map((q) => months.slice(q * 3, q * 3 + 3).filter(Boolean).length);
  return { months, quarters, filled };
}

/** 舊版判斷「此門市使用自訂閾值」：月閾值任一檻的金額與系統預設不同。 */
export function usesCustomThresholds(monthly: ThresholdDef[], defaults: ThresholdDef[]): boolean {
  return monthly.some((t, i) => t.baseAmount !== defaults[i]?.baseAmount);
}

/** 舊版 thresholdBadge：未達第一檻顯示「-」。 */
export function levelLabel(level: number): string {
  return ["-", "第一檻", "第二檻", "第三檻", "第四檻", "第五檻"][level] ?? `第 ${level} 檻`;
}

/** 舊版：獎金金額只在達到第一檻以上才顯示，否則顯示「—」。 */
export function hasBonusAmount(b: BonusResult | null | undefined): b is BonusResult {
  return !!b && b.gpThresholdLevel > 0;
}
