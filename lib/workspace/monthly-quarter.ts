import {calcMonthlyBonus,calcQuarterlyBonus,MONTHLY_THRESHOLDS,QUARTERLY_THRESHOLDS,type MonthlyPerformance,type ThresholdDef} from '../performance/bonus-calc';

// Match the legacy monthly-status quarter preview: full-quarter targets,
// actuals only through the selected month (not the machine's current month).
export function monthlyQuarterSummary(month: string, records: any[], monthly: ThresholdDef[] = MONTHLY_THRESHOLDS, quarterly: ThresholdDef[] = QUARTERLY_THRESHOLDS) {
  const [year, includedThroughMonth] = month.split('-').map(Number);
  const quarterNumber = Math.ceil(includedThroughMonth / 3);
  const months = [0,1,2].map(i=>(quarterNumber-1)*3+1+i);
  const perfs: MonthlyPerformance[] = months.map(m=>{
    const r=records.find(r=>Number(r.month)===m), future=m>includedThroughMonth;
    return {
      businessDays:Number(r?.business_days || 0), grossProfitTarget:r?.monthly_gross_profit_target ?? null,
      revenueTarget:r?.monthly_revenue_target ?? null, customerCountTarget:r?.monthly_customer_count_target ?? null, rxTarget:r?.last_month_rx_target ?? null,
      grossProfitActual:future?null:r?.monthly_gross_profit_actual ?? null, revenueActual:future?null:r?.monthly_revenue_actual ?? null,
      customerCountActual:future?null:r?.monthly_customer_count_actual ?? null, rxActual:future?null:r?.last_month_rx_actual ?? null,
      activityDayGrossProfit:future?null:r?.activity_day_gross_profit ?? null,
    };
  });
  const monthlyBonuses=perfs.map(p=>!p.grossProfitTarget || !p.grossProfitActual ? null : calcMonthlyBonus(p,monthly));
  return {year,quarterNumber,months,includedThroughMonth,quarterLabel:`${year}-Q${quarterNumber} (${months[0]}-${months[2]}月)`,monthlyBonuses,quarterlyThresholds:quarterly,
    quarterlyResult:perfs.some(p=>p.grossProfitTarget || p.grossProfitActual) ? calcQuarterlyBonus(perfs,monthlyBonuses.map(b=>b?.finalBonus ?? 0),quarterly) : null};
}
