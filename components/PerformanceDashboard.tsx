'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  calcMonthlyBonus,
  calcQuarterlyBonus,
  formatAmount,
  formatRate,
  getQuarter,
  type MonthlyPerformance,
} from '@/lib/performance/bonus-calc';
import { TrendingUp, ArrowRight, Award, BarChart2 } from 'lucide-react';

interface PerformanceRecord {
  id?: string;
  store_id: string;
  year: number;
  month: number;
  business_days: number;
  monthly_gross_profit_target: number | null;
  monthly_revenue_target: number | null;
  monthly_customer_count_target: number | null;
  last_month_rx_target: number | null;
  monthly_gross_profit_actual: number | null;
  monthly_revenue_actual: number | null;
  monthly_customer_count_actual: number | null;
  last_month_rx_actual: number | null;
  stores?: { store_code: string; store_name: string };
}

interface Props {
  storeIds?: string[]; // 若不傳則查詢用戶有權限的門市
}

const THRESHOLD_COLORS = [
  'text-gray-400',
  'text-green-600',
  'text-blue-600',
  'text-purple-600',
  'text-orange-600',
  'text-red-600',
];

const THRESHOLD_BG = [
  'bg-gray-100',
  'bg-green-100',
  'bg-blue-100',
  'bg-purple-100',
  'bg-orange-100',
  'bg-red-100',
];

const THRESHOLD_LABELS = ['-', '第一檻', '第二檻', '第三檻', '第四檻', '第五檻'];

export default function PerformanceDashboard({ storeIds }: Props) {
  const [records, setRecords] = useState<PerformanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentQuarter = getQuarter(currentMonth);

  useEffect(() => {
    (async () => {
      try {
        let url = `/api/performance-data?year=${currentYear}`;
        if (storeIds?.length === 1) url += `&store_id=${storeIds[0]}`;
        const res = await fetch(url);
        const json = await res.json();
        setRecords(json.records || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [storeIds, currentYear]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-5 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  // Group records by store
  const storeMap = new Map<string, { storeName: string; storeCode: string; months: PerformanceRecord[] }>();
  records.forEach(r => {
    if (!storeMap.has(r.store_id)) {
      storeMap.set(r.store_id, {
        storeName: (r.stores as any)?.store_name ?? '',
        storeCode: (r.stores as any)?.store_code ?? '',
        months: [],
      });
    }
    storeMap.get(r.store_id)!.months.push(r);
  });

  if (storeMap.size === 0) return null;

  function recordToPerf(r: PerformanceRecord): MonthlyPerformance {
    return {
      businessDays: r.business_days || 26,
      grossProfitTarget: r.monthly_gross_profit_target,
      revenueTarget: r.monthly_revenue_target,
      customerCountTarget: r.monthly_customer_count_target,
      rxTarget: r.last_month_rx_target,
      grossProfitActual: r.monthly_gross_profit_actual,
      revenueActual: r.monthly_revenue_actual,
      customerCountActual: r.monthly_customer_count_actual,
      rxActual: r.last_month_rx_actual,
    };
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-blue-600" />
          <span className="font-semibold text-gray-800">業績儀表板</span>
          <span className="text-xs text-gray-400">{currentYear} 年</span>
        </div>
        <Link
          href="/admin/performance"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
        >
          詳細管理 <ArrowRight size={12} />
        </Link>
      </div>

      <div className="divide-y">
        {Array.from(storeMap.entries()).map(([storeId, { storeName, storeCode, months }]) => {
          // Current month bonus
          const curMonthRec = months.find(m => m.month === currentMonth);
          const curMonthBonus = curMonthRec && curMonthRec.monthly_gross_profit_target && curMonthRec.monthly_gross_profit_actual
            ? calcMonthlyBonus(recordToPerf(curMonthRec))
            : null;

          // Current quarter bonus
          const qMonthNums = [currentQuarter*3-2, currentQuarter*3-1, currentQuarter*3];
          const qPerfs = qMonthNums.map(m => {
            const rec = months.find(r => r.month === m);
            return rec ? recordToPerf(rec) : { businessDays:26, grossProfitTarget:null, revenueTarget:null, customerCountTarget:null, rxTarget:null, grossProfitActual:null, revenueActual:null, customerCountActual:null, rxActual:null } as MonthlyPerformance;
          });
          const qBonusAmounts = qMonthNums.map(m => {
            const rec = months.find(r => r.month === m);
            if (!rec || !rec.monthly_gross_profit_target || !rec.monthly_gross_profit_actual) return 0;
            return calcMonthlyBonus(recordToPerf(rec)).finalBonus;
          });
          const hasQData = qPerfs.some(p => p.grossProfitTarget && p.grossProfitActual);
          const qBonus = hasQData ? calcQuarterlyBonus(qPerfs, qBonusAmounts) : null;

          return (
            <div key={storeId} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-gray-700">{storeCode} {storeName}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Current month */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">{currentMonth} 月團體獎金</div>
                  {curMonthBonus ? (
                    <>
                      <div className={`text-lg font-bold ${THRESHOLD_COLORS[curMonthBonus.gpThresholdLevel]}`}>
                        {curMonthBonus.gpThresholdLevel > 0 ? formatAmount(curMonthBonus.finalBonus) : '未達標'}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${THRESHOLD_BG[curMonthBonus.gpThresholdLevel]} ${THRESHOLD_COLORS[curMonthBonus.gpThresholdLevel]}`}>
                          {THRESHOLD_LABELS[curMonthBonus.gpThresholdLevel]}
                        </span>
                        <span className="text-xs text-gray-400">毛利 {formatRate(curMonthBonus.gpAchievementRate)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400">尚無資料</div>
                  )}
                </div>

                {/* Current quarter */}
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Q{currentQuarter} 季獎金</div>
                  {qBonus ? (
                    <>
                      <div className={`text-lg font-bold ${THRESHOLD_COLORS[qBonus.gpThresholdLevel]}`}>
                        {qBonus.gpThresholdLevel > 0 ? formatAmount(qBonus.quarterlyBonus) : '未達標'}
                      </div>
                      {qBonus.makeupBonus > 0 && (
                        <div className="text-xs text-green-600 font-medium mt-0.5">
                          +{formatAmount(qBonus.makeupBonus)} 補差額
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">毛利 {formatRate(qBonus.gpAchievementRate)}</div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400">尚無資料</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
