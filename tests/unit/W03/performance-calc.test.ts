import { describe, expect, it } from 'vitest';
import {
  MONTHLY_DAILY_GP_STEP,
  MONTHLY_THRESHOLDS,
  QUARTERLY_THRESHOLDS,
  calcGpThresholdLevel,
  calcMonthlyBonus,
  calcQuarterlyBonus,
  calcQuarterlyGpThresholdLevel,
  getQuarter,
  getQuarterMonths,
  type MonthlyPerformance,
  type ThresholdDef,
} from '../../../lib/performance/bonus-calc';
import { calcYearBonus, rowToPerf, usesCustomThresholds } from '../../../lib/workspace/performance-year';
import { legacyRowToPerf, legacyYear, type LegacyRow } from './legacy-year';

// W03 單元層：新版年度頁計算（lib/workspace/performance-year.ts）與舊版年度頁計算（legacy-year.ts，舊 page.tsx 的逐行移植）
// 對同一組輸入逐月、逐季比對，誤差 0 元（toEqual 完全相等，包含所有中間欄位）。

const CUSTOM: ThresholdDef[] = MONTHLY_THRESHOLDS.map((t, i) => ({ ...t, baseAmount: t.baseAmount + (i + 1) * 111 }));
const CUSTOM_Q: ThresholdDef[] = QUARTERLY_THRESHOLDS.map((t, i) => ({ ...t, baseAmount: t.baseAmount + (i + 1) * 333 }));

function row(month: number, over: Partial<LegacyRow> = {}): LegacyRow {
  return {
    month,
    business_days: 26,
    monthly_gross_profit_target: 780_000,
    monthly_revenue_target: 3_000_000,
    monthly_customer_count_target: 4_000,
    last_month_rx_target: 500,
    monthly_gross_profit_actual: 780_000,
    activity_day_gross_profit: null,
    monthly_revenue_actual: 3_000_000,
    monthly_customer_count_actual: 4_000,
    last_month_rx_actual: 500,
    ...over,
  };
}

const D = 26; // 營業天數
const T = 780_000; // 毛利目標
const step = MONTHLY_DAILY_GP_STEP * D;

interface Case {
  name: string;
  rows: Partial<LegacyRow>[];
  monthly?: ThresholdDef[];
  quarterly?: ThresholdDef[];
}
const cases: Case[] = [
  { name: '整年空資料', rows: [] },
  { name: '毛利未達第一檻：獎金 0', rows: [row(1, { monthly_gross_profit_actual: T - 1 })] },
  { name: '剛好達第一檻', rows: [row(1, { monthly_gross_profit_actual: T })] },
  ...[1, 2, 3, 4].map((i) => ({
    name: `第 ${i + 1} 檻邊界 ±1`,
    rows: [
      row(1, { monthly_gross_profit_actual: T + step * i - 1 }),
      row(2, { monthly_gross_profit_actual: T + step * i }),
      row(3, { monthly_gross_profit_actual: T + step * i + 1 }),
    ],
  })),
  { name: '營業天數 30.5', rows: [row(1, { business_days: 30.5, monthly_gross_profit_actual: T + 30.5 * MONTHLY_DAILY_GP_STEP * 2 })] },
  { name: '營業天數 0.5', rows: [row(1, { business_days: 0.5, monthly_gross_profit_target: 15_000, monthly_gross_profit_actual: 15_500 })] },
  { name: '營業天數 1：除以 0 邊界', rows: [row(1, { business_days: 1, monthly_gross_profit_target: 30_000, monthly_gross_profit_actual: 31_000, activity_day_gross_profit: 5_000 })] },
  { name: '營業天數 0：舊版 || 26 後備', rows: [row(1, { business_days: 0 })] },
  { name: '活動日折減：其他營業日平均低於第一檻 x0.8', rows: [row(10, { monthly_gross_profit_actual: T + 100, activity_day_gross_profit: 200_000 })] },
  { name: '活動日有填但平均不低於第一檻：不折減', rows: [row(10, { monthly_gross_profit_actual: T * 2, activity_day_gross_profit: 10_000 })] },
  { name: '活動日 0：視為沒填', rows: [row(10, { activity_day_gross_profit: 0 })] },
  { name: '毛利目標 0：舊版視為沒資料', rows: [row(1, { monthly_gross_profit_target: 0 })] },
  { name: '毛利實際 0：舊版視為沒資料', rows: [row(1, { monthly_gross_profit_actual: 0 })] },
  { name: '只有目標沒有實績', rows: [row(1, { monthly_gross_profit_actual: null })] },
  { name: '營收、客數、慢箋各別未達', rows: [row(1, { monthly_revenue_actual: 1 }), row(2, { monthly_customer_count_actual: 1 }), row(3, { last_month_rx_actual: 1 })] },
  { name: '權重：只毛利達標 0.9', rows: [row(1, { monthly_revenue_actual: 0, monthly_customer_count_actual: 0, last_month_rx_actual: 0 })] },
  { name: '權重：全部達標 1.1', rows: [row(1)] },
  { name: '營收目標為 null', rows: [row(1, { monthly_revenue_target: null, monthly_revenue_actual: null })] },
  { name: '季：三個月都有，季回補為正', rows: [row(1, { monthly_gross_profit_actual: T }), row(2, { monthly_gross_profit_actual: T }), row(3, { monthly_gross_profit_actual: T + step * 4 })] },
  { name: '季：月獎金合計大於季應得，回補為 0', rows: [row(4, { monthly_gross_profit_actual: T + step * 4 }), row(5, { monthly_gross_profit_actual: T + step * 4 }), row(6, { monthly_gross_profit_actual: T + step * 4 })] },
  { name: '季：只有一個月有資料', rows: [row(7)] },
  { name: '季：中間月缺資料', rows: [row(10), row(12)] },
  { name: '全年 12 個月', rows: Array.from({ length: 12 }, (_, i) => row(i + 1, { monthly_gross_profit_actual: T + step * (i % 5) })) },
  { name: '自訂閾值：全年', rows: Array.from({ length: 12 }, (_, i) => row(i + 1, { monthly_gross_profit_actual: T + step * (i % 5) })), monthly: CUSTOM, quarterly: CUSTOM_Q },
];

describe('年度頁：新版計算 = 舊版計算（誤差 0 元）', () => {
  for (const c of cases) {
    it(c.name, () => {
      const monthly = c.monthly ?? MONTHLY_THRESHOLDS;
      const quarterly = c.quarterly ?? QUARTERLY_THRESHOLDS;
      const legacy = legacyYear(c.rows, monthly, quarterly);
      const next = calcYearBonus(c.rows as any, monthly, quarterly);
      expect(next.months).toEqual(legacy.months);
      expect(next.quarters).toEqual(legacy.quarters);
      // 金額逐筆再比一次
      next.months.forEach((b, i) => expect(b?.finalBonus ?? null, `月 ${i + 1}`).toBe(legacy.months[i]?.finalBonus ?? null));
      next.quarters.forEach((q, i) => {
        expect(q?.quarterlyBonus ?? null, `Q${i + 1} 季應得`).toBe(legacy.quarters[i]?.quarterlyBonus ?? null);
        expect(q?.makeupBonus ?? null, `Q${i + 1} 回補`).toBe(legacy.quarters[i]?.makeupBonus ?? null);
      });
    });
  }

  it('隨機 500 組年度資料（固定種子）新舊完全一致', () => {
    let seed = 20381103;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = (xs: number[]) => xs[Math.floor(rnd() * xs.length)];
    const maybe = (v: number) => (rnd() < 0.15 ? null : v);
    for (let n = 0; n < 500; n++) {
      const rows: Partial<LegacyRow>[] = [];
      for (let m = 1; m <= 12; m++) {
        if (rnd() < 0.25) continue;
        const days = pick([0.5, 1, 20, 25.5, 26, 30, 30.5, 31]);
        const target = Math.round(days * pick([20_000, 30_000, 45_000]));
        rows.push({
          month: m,
          business_days: days,
          monthly_gross_profit_target: maybe(target),
          monthly_gross_profit_actual: maybe(Math.round(target * (0.7 + rnd() * 0.9))),
          activity_day_gross_profit: rnd() < 0.3 ? Math.round(target * rnd() * 0.3) : null,
          monthly_revenue_target: maybe(1_000_000),
          monthly_revenue_actual: maybe(Math.round(1_000_000 * (0.8 + rnd() * 0.4))),
          monthly_customer_count_target: maybe(3000),
          monthly_customer_count_actual: maybe(Math.round(3000 * (0.8 + rnd() * 0.4))),
          last_month_rx_target: maybe(400),
          last_month_rx_actual: maybe(Math.round(400 * (0.8 + rnd() * 0.4))),
        });
      }
      const monthly = rnd() < 0.5 ? MONTHLY_THRESHOLDS : CUSTOM;
      const quarterly = rnd() < 0.5 ? QUARTERLY_THRESHOLDS : CUSTOM_Q;
      const legacy = legacyYear(rows, monthly, quarterly);
      const next = calcYearBonus(rows as any, monthly, quarterly);
      expect(next.months).toEqual(legacy.months);
      expect(next.quarters).toEqual(legacy.quarters);
    }
  });

  it('rowToPerf 與舊版 rowToPerf 逐欄相同（含 business_days 0／null）', () => {
    for (const days of [0, null, undefined, 0.5, 26, 31]) {
      const r = row(1, { business_days: days as any });
      expect(rowToPerf(r)).toEqual(legacyRowToPerf(r));
    }
  });
});

describe('bonus-calc 規則（絕對值）', () => {
  const perf = (over: Partial<MonthlyPerformance> = {}): MonthlyPerformance => ({
    businessDays: D,
    grossProfitTarget: T,
    revenueTarget: 100,
    customerCountTarget: 100,
    rxTarget: 100,
    grossProfitActual: T,
    revenueActual: 100,
    customerCountActual: 100,
    rxActual: 100,
    ...over,
  });
  it('未達第一檻 0；剛好達第一檻 3000 x 1.1', () => {
    expect(calcMonthlyBonus(perf({ grossProfitActual: T - 1 })).finalBonus).toBe(0);
    expect(calcMonthlyBonus(perf()).finalBonus).toBe(3300);
  });
  it('第二至第五檻每檻加 1000 x 營業天數', () => {
    const expected = [3300, 5500, 7700, 8800, 11000];
    expected.forEach((v, i) => expect(calcMonthlyBonus(perf({ grossProfitActual: T + MONTHLY_DAILY_GP_STEP * D * i })).finalBonus).toBe(v));
    expect(calcGpThresholdLevel(T + step * 4 - 1, T, D)).toBe(4);
    expect(calcGpThresholdLevel(T + step * 4, T, D)).toBe(5);
  });
  it('權重：毛利 90% + 營收 5% + 客數 5% + 慢箋 10%', () => {
    const only = (over: Partial<MonthlyPerformance>) => calcMonthlyBonus(perf({ revenueActual: 0, customerCountActual: 0, rxActual: 0, ...over })).totalWeight;
    expect(only({})).toBeCloseTo(0.9, 10);
    expect(only({ revenueActual: 100 })).toBeCloseTo(0.95, 10);
    expect(only({ customerCountActual: 100 })).toBeCloseTo(0.95, 10);
    expect(only({ rxActual: 100 })).toBeCloseTo(1.0, 10);
    expect(only({ revenueActual: 100, customerCountActual: 100, rxActual: 100 })).toBeCloseTo(1.1, 10);
  });
  it('活動日折減 x0.8；營業天數 1 不套用（除以 0 邊界）', () => {
    const hit = calcMonthlyBonus(perf({ grossProfitActual: T + 100, activityDayGrossProfit: 200_000 }));
    expect(hit.activityPenaltyApplied).toBe(true);
    expect(hit.finalBonus).toBe(Math.round(hit.preActivityPenaltyBonus * 0.8));
    const one = calcMonthlyBonus(perf({ businessDays: 1, grossProfitTarget: 30_000, grossProfitActual: 31_000, activityDayGrossProfit: 5_000 }));
    expect(one.activityAdjustedDailyGp).toBeNull();
    expect(one.activityPenaltyApplied).toBe(false);
  });
  it('季：回補＝max(0, 季應得 − 月合計)', () => {
    const months = [perf(), perf(), perf()];
    const q = calcQuarterlyBonus(months, [3300, 3300, 3300], QUARTERLY_THRESHOLDS);
    expect(q.quarterlyBonus).toBe(9900);
    expect(q.monthlyBonusSum).toBe(9900);
    expect(q.makeupBonus).toBe(0);
    expect(calcQuarterlyBonus(months, [0, 0, 0], QUARTERLY_THRESHOLDS).makeupBonus).toBe(9900);
    expect(calcQuarterlyBonus(months, [20_000, 0, 0], QUARTERLY_THRESHOLDS).makeupBonus).toBe(0);
  });
  it('季毛利檻邊界 ±1', () => {
    const qt = T * 3;
    const qd = D * 3;
    for (let i = 0; i < 5; i++) {
      const edge = qt + MONTHLY_DAILY_GP_STEP * qd * i;
      expect(calcQuarterlyGpThresholdLevel(edge, qt, qd)).toBe(i + 1);
      expect(calcQuarterlyGpThresholdLevel(edge - 1, qt, qd)).toBe(i);
    }
  });
  it('getQuarter／getQuarterMonths', () => {
    expect([1, 3, 4, 12].map(getQuarter)).toEqual([1, 1, 2, 4]);
    expect(getQuarterMonths(1)).toEqual([1, 2, 3]);
    expect(getQuarterMonths(4)).toEqual([10, 11, 12]);
  });
});

describe('自訂閾值標記', () => {
  it('與預設相同：不顯示；任一檻不同：顯示', () => {
    expect(usesCustomThresholds(MONTHLY_THRESHOLDS, MONTHLY_THRESHOLDS)).toBe(false);
    expect(usesCustomThresholds(CUSTOM, MONTHLY_THRESHOLDS)).toBe(true);
    const one = MONTHLY_THRESHOLDS.map((t, i) => (i === 4 ? { ...t, baseAmount: t.baseAmount + 1 } : t));
    expect(usesCustomThresholds(one, MONTHLY_THRESHOLDS)).toBe(true);
  });
});

describe('W03 修正：未達第一檻照舊版顯示', () => {
  it('level 0 顯示「-」且不顯示獎金金額', async () => {
    const { levelLabel, hasBonusAmount } = await import('../../../lib/workspace/performance-year');
    const y = calcYearBonus([row(1, { monthly_gross_profit_actual: 1 })] as never, MONTHLY_THRESHOLDS, QUARTERLY_THRESHOLDS);
    const b = y.months[0]!;
    expect(b.gpThresholdLevel).toBe(0);
    expect(levelLabel(b.gpThresholdLevel)).toBe('-');
    expect(hasBonusAmount(b)).toBe(false);
    expect(levelLabel(0)).toBe('-');
    expect(levelLabel(y.quarters[0]!.gpThresholdLevel)).toBe('-');
    expect(levelLabel(1)).toBe('第一檻');
    expect(levelLabel(5)).toBe('第五檻');
    expect(hasBonusAmount(null)).toBe(false);
  });
});
