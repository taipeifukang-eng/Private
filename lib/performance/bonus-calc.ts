/**
 * 業績團體獎金計算核心邏輯
 *
 * 月團體獎金計算規則：
 * - 日毛利達到目標 100% → 第一檻: 3,000 元/人
 * - 日毛利達到目標 110% → 第二檻: 5,000 元/人
 * - 日毛利達到目標 120% → 第三檻: 7,000 元/人
 * - 日毛利達到目標 130% → 第四檻: 8,000 元/人
 * - 日毛利達到目標 140% → 第五檻: 10,000 元/人
 *
 * 各指標權重：
 * - 毛利: 90%（決定基本金額的門檻）
 * - 月營業額: 5%
 * - 月來客數: 5%
 * - 上月處方箋: 10%
 *
 * 最終獎金 = 達標檻金額 × 各已達標指標權重加總
 */

export interface MonthlyPerformance {
  businessDays: number;
  // 目標
  grossProfitTarget: number | null;   // 月毛利目標
  revenueTarget: number | null;       // 月營業額目標
  customerCountTarget: number | null; // 月來客數目標
  rxTarget: number | null;            // 上月處方箋目標
  // 實際
  grossProfitActual: number | null;
  revenueActual: number | null;
  customerCountActual: number | null;
  rxActual: number | null;
}

export interface BonusResult {
  // 月份資訊
  gpThresholdLevel: number; // 0-5，0代表未達標
  gpAchievementRate: number; // 毛利達成率 (%)
  thresholdBaseAmount: number; // 達標檻基本金額

  // 各指標達標情況
  gpAchieved: boolean;
  revenueAchieved: boolean;
  customerCountAchieved: boolean;
  rxAchieved: boolean;

  // 各指標達標率 (%)
  revenueAchievementRate: number;
  customerCountAchievementRate: number;
  rxAchievementRate: number;

  // 加權計算
  totalWeight: number; // 達標權重加總 (0~1.1)
  finalBonus: number;  // 最終獎金金額

  // 細節
  dailyGpTarget: number;   // 日毛利目標
  dailyGpActual: number;   // 日毛利實際
}

/** 月團體獎金檻定義 */
export const MONTHLY_THRESHOLDS = [
  { multiplier: 1.0, baseAmount: 3000, label: '第一檻' },
  { multiplier: 1.1, baseAmount: 5000, label: '第二檻' },
  { multiplier: 1.2, baseAmount: 7000, label: '第三檻' },
  { multiplier: 1.3, baseAmount: 8000, label: '第四檻' },
  { multiplier: 1.4, baseAmount: 10000, label: '第五檻' },
];

/** 季團體獎金檻定義 */
export const QUARTERLY_THRESHOLDS = [
  { multiplier: 1.0, baseAmount: 9000,  label: '第一檻' },
  { multiplier: 1.1, baseAmount: 15000, label: '第二檻' },
  { multiplier: 1.2, baseAmount: 21000, label: '第三檻' },
  { multiplier: 1.3, baseAmount: 24000, label: '第四檻' },
  { multiplier: 1.4, baseAmount: 30000, label: '第五檻' },
];

/** 指標權重 */
export const WEIGHTS = {
  grossProfit:   0.90,
  revenue:       0.05,
  customerCount: 0.05,
  rx:            0.10,
};

/**
 * 計算月毛利所達到的檻級別 (0=未達標, 1~5)
 */
export function calcGpThresholdLevel(actualGp: number, targetGp: number): number {
  if (!targetGp || targetGp <= 0) return 0;
  const rate = actualGp / targetGp;
  // 從高往低找
  for (let i = MONTHLY_THRESHOLDS.length - 1; i >= 0; i--) {
    if (rate >= MONTHLY_THRESHOLDS[i].multiplier) return i + 1;
  }
  return 0;
}

/**
 * 計算季毛利所達到的檻級別 (0=未達標, 1~5)
 */
export function calcQuarterlyGpThresholdLevel(actualGp: number, targetGp: number): number {
  if (!targetGp || targetGp <= 0) return 0;
  const rate = actualGp / targetGp;
  for (let i = QUARTERLY_THRESHOLDS.length - 1; i >= 0; i--) {
    if (rate >= QUARTERLY_THRESHOLDS[i].multiplier) return i + 1;
  }
  return 0;
}

/**
 * 計算單月團體獎金
 */
export function calcMonthlyBonus(perf: MonthlyPerformance): BonusResult {
  const {
    businessDays,
    grossProfitTarget, grossProfitActual,
    revenueTarget, revenueActual,
    customerCountTarget, customerCountActual,
    rxTarget, rxActual,
  } = perf;

  const safeGpTarget = grossProfitTarget || 0;
  const safeGpActual = grossProfitActual || 0;
  const dailyGpTarget = businessDays > 0 ? safeGpTarget / businessDays : 0;
  const dailyGpActual = businessDays > 0 ? safeGpActual / businessDays : 0;

  const gpAchievementRate = safeGpTarget > 0 ? (safeGpActual / safeGpTarget) * 100 : 0;
  const gpThresholdLevel = calcGpThresholdLevel(safeGpActual, safeGpTarget);
  const thresholdBaseAmount = gpThresholdLevel > 0 ? MONTHLY_THRESHOLDS[gpThresholdLevel - 1].baseAmount : 0;

  const gpAchieved = gpThresholdLevel > 0;
  const revenueAchieved = !!(revenueTarget && revenueTarget > 0 && revenueActual !== null && revenueActual >= revenueTarget);
  const customerCountAchieved = !!(customerCountTarget && customerCountTarget > 0 && customerCountActual !== null && customerCountActual >= customerCountTarget);
  const rxAchieved = !!(rxTarget && rxTarget > 0 && rxActual !== null && rxActual >= rxTarget);

  const revenueAchievementRate = (revenueTarget && revenueTarget > 0 && revenueActual !== null) ? (revenueActual / revenueTarget) * 100 : 0;
  const customerCountAchievementRate = (customerCountTarget && customerCountTarget > 0 && customerCountActual !== null) ? (customerCountActual / customerCountTarget) * 100 : 0;
  const rxAchievementRate = (rxTarget && rxTarget > 0 && rxActual !== null) ? (rxActual / rxTarget) * 100 : 0;

  // 毛利沒達標則獎金為0
  let totalWeight = 0;
  if (gpAchieved) {
    totalWeight += WEIGHTS.grossProfit;
    if (revenueAchieved) totalWeight += WEIGHTS.revenue;
    if (customerCountAchieved) totalWeight += WEIGHTS.customerCount;
    if (rxAchieved) totalWeight += WEIGHTS.rx;
  }

  const finalBonus = Math.round(thresholdBaseAmount * totalWeight);

  return {
    gpThresholdLevel,
    gpAchievementRate,
    thresholdBaseAmount,
    gpAchieved,
    revenueAchieved,
    customerCountAchieved,
    rxAchieved,
    revenueAchievementRate,
    customerCountAchievementRate,
    rxAchievementRate,
    totalWeight,
    finalBonus,
    dailyGpTarget,
    dailyGpActual,
  };
}

export interface QuarterlyData {
  months: MonthlyPerformance[]; // 3 months
}

export interface QuarterlyBonusResult {
  quarterlyGpTarget: number;     // 三個月毛利目標加總
  quarterlyGpActual: number;     // 三個月毛利實際加總
  quarterlyRevenueTarget: number;
  quarterlyRevenueActual: number;
  quarterlyCustomerCountTarget: number;
  quarterlyCustomerCountActual: number;
  quarterlyRxTarget: number;
  quarterlyRxActual: number;

  gpThresholdLevel: number;
  gpAchievementRate: number;
  thresholdBaseAmount: number;

  gpAchieved: boolean;
  revenueAchieved: boolean;
  customerCountAchieved: boolean;
  rxAchieved: boolean;

  totalWeight: number;
  quarterlyBonus: number;        // 季應得獎金
  monthlyBonusSum: number;       // 三個月已領獎金加總
  makeupBonus: number;           // 季回補獎金（季 - 月加總，<0 則為0）
}

/**
 * 計算季團體獎金
 */
export function calcQuarterlyBonus(
  months: MonthlyPerformance[],
  monthlyBonuses: number[], // 三個月實際領取的月獎金
): QuarterlyBonusResult {
  // 加總各指標
  const quarterlyGpTarget = months.reduce((s, m) => s + (m.grossProfitTarget || 0), 0);
  const quarterlyGpActual = months.reduce((s, m) => s + (m.grossProfitActual || 0), 0);
  const quarterlyRevenueTarget = months.reduce((s, m) => s + (m.revenueTarget || 0), 0);
  const quarterlyRevenueActual = months.reduce((s, m) => s + (m.revenueActual || 0), 0);
  const quarterlyCustomerCountTarget = months.reduce((s, m) => s + (m.customerCountTarget || 0), 0);
  const quarterlyCustomerCountActual = months.reduce((s, m) => s + (m.customerCountActual || 0), 0);
  const quarterlyRxTarget = months.reduce((s, m) => s + (m.rxTarget || 0), 0);
  const quarterlyRxActual = months.reduce((s, m) => s + (m.rxActual || 0), 0);

  const gpAchievementRate = quarterlyGpTarget > 0 ? (quarterlyGpActual / quarterlyGpTarget) * 100 : 0;
  const gpThresholdLevel = calcQuarterlyGpThresholdLevel(quarterlyGpActual, quarterlyGpTarget);
  const thresholdBaseAmount = gpThresholdLevel > 0 ? QUARTERLY_THRESHOLDS[gpThresholdLevel - 1].baseAmount : 0;

  const gpAchieved = gpThresholdLevel > 0;
  const revenueAchieved = quarterlyRevenueTarget > 0 && quarterlyRevenueActual >= quarterlyRevenueTarget;
  const customerCountAchieved = quarterlyCustomerCountTarget > 0 && quarterlyCustomerCountActual >= quarterlyCustomerCountTarget;
  const rxAchieved = quarterlyRxTarget > 0 && quarterlyRxActual >= quarterlyRxTarget;

  let totalWeight = 0;
  if (gpAchieved) {
    totalWeight += WEIGHTS.grossProfit;
    if (revenueAchieved) totalWeight += WEIGHTS.revenue;
    if (customerCountAchieved) totalWeight += WEIGHTS.customerCount;
    if (rxAchieved) totalWeight += WEIGHTS.rx;
  }

  const quarterlyBonus = Math.round(thresholdBaseAmount * totalWeight);
  const monthlyBonusSum = monthlyBonuses.reduce((s, b) => s + b, 0);
  const makeupBonus = Math.max(0, quarterlyBonus - monthlyBonusSum);

  return {
    quarterlyGpTarget,
    quarterlyGpActual,
    quarterlyRevenueTarget,
    quarterlyRevenueActual,
    quarterlyCustomerCountTarget,
    quarterlyCustomerCountActual,
    quarterlyRxTarget,
    quarterlyRxActual,
    gpThresholdLevel,
    gpAchievementRate,
    thresholdBaseAmount,
    gpAchieved,
    revenueAchieved,
    customerCountAchieved,
    rxAchieved,
    totalWeight,
    quarterlyBonus,
    monthlyBonusSum,
    makeupBonus,
  };
}

/** 取得某年某月所屬的季 (1-4) */
export function getQuarter(month: number): number {
  return Math.ceil(month / 3);
}

/** 取得某季的月份列表 */
export function getQuarterMonths(quarter: number): number[] {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

/** 格式化金額（加逗號） */
export function formatAmount(amount: number): string {
  return amount.toLocaleString('zh-TW');
}

/** 格式化達成率 */
export function formatRate(rate: number): string {
  return rate.toFixed(1) + '%';
}
