'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  calcMonthlyBonus,
  calcQuarterlyBonus,
  MONTHLY_THRESHOLDS,
  QUARTERLY_THRESHOLDS,
  formatAmount,
  formatRate,
  type MonthlyPerformance,
  type BonusResult,
  type QuarterlyBonusResult,
} from '@/lib/performance/bonus-calc';
import {
  TrendingUp, Upload, Save, Edit2, X, Check,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle,
  BarChart2, Award, Target, Calendar,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Store {
  id: string;
  store_code: string;
  store_name: string;
}

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
}

type EditRow = PerformanceRecord & { _edited: boolean };

const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
const QUARTER_LABELS = ['Q1 (1-3月)', 'Q2 (4-6月)', 'Q3 (7-9月)', 'Q4 (10-12月)'];

function emptyRecord(storeId: string, year: number, month: number): EditRow {
  return {
    store_id: storeId, year, month, business_days: 26,
    monthly_gross_profit_target: null, monthly_revenue_target: null,
    monthly_customer_count_target: null, last_month_rx_target: null,
    monthly_gross_profit_actual: null, monthly_revenue_actual: null,
    monthly_customer_count_actual: null, last_month_rx_actual: null,
    _edited: false,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null); // month being saved
  const [importLoading, setImportLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Auth ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from('profiles')
        .select('id, full_name, role, job_title, managed_stores')
        .eq('id', user.id)
        .single();
      setProfile(p);
    })();
  }, []);

  // ─── Stores list ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;
    (async () => {
      let q = supabase.from('stores').select('id, store_code, store_name').eq('is_active', true).order('store_code');
      const { data } = await q;
      const list: Store[] = data || [];

      // 非 admin/supervisor 只能看自己管理的門市
      if (!['admin', 'supervisor'].includes(profile.role)) {
        const managed = profile.managed_stores as string[] | null;
        const filtered = managed ? list.filter(s => managed.includes(s.id)) : [];
        setStores(filtered);
        if (filtered.length > 0) setSelectedStoreId(filtered[0].id);
      } else {
        setStores(list);
        if (list.length > 0) setSelectedStoreId(list[0].id);
      }
    })();
  }, [profile]);

  // ─── Load data ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/performance-data?store_id=${selectedStoreId}&year=${selectedYear}`
      );
      const json = await res.json();
      const serverRows: PerformanceRecord[] = json.records || [];
      const mapped = MONTHS.map(m => {
        const found = serverRows.find(r => r.month === m);
        return found
          ? { ...found, _edited: false }
          : emptyRecord(selectedStoreId, selectedYear, m);
      });
      setRows(mapped);
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, selectedYear]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Edit helpers ────────────────────────────────────────────────────────
  function setField(month: number, field: keyof PerformanceRecord, rawValue: string) {
    setRows(prev => prev.map(r =>
      r.month !== month ? r : {
        ...r,
        [field]: rawValue === '' ? null : (
          ['business_days'].includes(field)
            ? parseInt(rawValue) || 0
            : parseFloat(rawValue.replace(/,/g, '')) || null
        ),
        _edited: true,
      }
    ));
  }

  // ─── Save single row ─────────────────────────────────────────────────────
  async function saveRow(month: number) {
    const row = rows.find(r => r.month === month);
    if (!row) return;
    setSaving(month);
    try {
      const res = await fetch('/api/performance-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRows(prev => prev.map(r => r.month === month ? { ...r, _edited: false, id: json.record?.id } : r));
      showMsg('success', `${month} 月資料儲存成功`);
    } catch (e: any) {
      showMsg('error', `儲存失敗：${e.message}`);
    } finally {
      setSaving(null);
    }
  }

  // ─── Excel import ────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedStoreId) return;
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('store_id', selectedStoreId);
      fd.append('year', String(selectedYear));
      const res = await fetch('/api/performance-data/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      showMsg('success', `匯入完成：成功 ${json.imported} 筆，略過 ${json.skipped} 筆${json.errors?.length ? '；有警告請見主控台' : ''}`);
      if (json.errors?.length) console.warn('[Import]', json.errors);
      await loadData();
    } catch (e: any) {
      showMsg('error', `匯入失敗：${e.message}`);
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ─── Bonus calculations ──────────────────────────────────────────────────
  function rowToPerf(r: EditRow): MonthlyPerformance {
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

  const bonusResults: (BonusResult | null)[] = rows.map(r => {
    const perf = rowToPerf(r);
    if (!perf.grossProfitTarget || !perf.grossProfitActual) return null;
    return calcMonthlyBonus(perf);
  });

  const quarterlyResults: (QuarterlyBonusResult | null)[] = [0,1,2,3].map(qi => {
    const qMonths = [qi*3+1, qi*3+2, qi*3+3];
    const monthPerfs = qMonths.map(m => rowToPerf(rows.find(r => r.month === m) ?? emptyRecord(selectedStoreId, selectedYear, m)));
    const monthBonusAmounts = qMonths.map(m => bonusResults[m-1]?.finalBonus ?? 0);
    if (monthPerfs.every(p => !p.grossProfitTarget || !p.grossProfitActual)) return null;
    try {
      return calcQuarterlyBonus(monthPerfs, monthBonusAmounts);
    } catch { return null; }
  });

  // ─── Utility ─────────────────────────────────────────────────────────────
  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }

  function thresholdBadge(level: number) {
    const colors = [
      'bg-gray-100 text-gray-500',
      'bg-green-100 text-green-700',
      'bg-blue-100 text-blue-700',
      'bg-purple-100 text-purple-700',
      'bg-orange-100 text-orange-700',
      'bg-red-100 text-red-700',
    ];
    const labels = ['-', '第一檻', '第二檻', '第三檻', '第四檻', '第五檻'];
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[level]}`}>
        {labels[level]}
      </span>
    );
  }

  const years = [selectedYear - 1, selectedYear, selectedYear + 1];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-3">
        <BarChart2 className="text-blue-600" size={24} />
        <h1 className="text-xl font-bold text-gray-800">業績管理</h1>
        <span className="text-sm text-gray-500">— 團體獎金計算</span>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Toolbar */}
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-4">
          {/* Store selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600 whitespace-nowrap">門市</label>
            <select
              value={selectedStoreId}
              onChange={e => setSelectedStoreId(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>
              ))}
            </select>
          </div>

          {/* Year selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">年份</label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {years.map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
          </div>

          {/* Reload */}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            重新載入
          </button>

          {/* Import */}
          <div className="ml-auto flex items-center gap-2">
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              onChange={handleImport}
              className="hidden"
              id="import-file"
            />
            <label
              htmlFor="import-file"
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer
                ${importLoading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
            >
              <Upload size={14} />
              {importLoading ? '匯入中...' : '匯入 Excel'}
            </label>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium
            ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            <AlertCircle size={16} />
            {message.text}
          </div>
        )}

        {/* 閾值說明 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Target size={16} className="text-blue-500" />
            月獎金門檻標準（每人）
          </h2>
          <div className="flex flex-wrap gap-3">
            {MONTHLY_THRESHOLDS.map((t, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                {thresholdBadge(i + 1)}
                <span className="text-gray-600">日毛利達 {Math.round(t.multiplier * 100)}%：</span>
                <span className="font-bold text-gray-800">{formatAmount(t.baseAmount)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            最終獎金 = 閾值金額 × (毛利90% + 營業額5% + 來客數5% + 處方箋10%)。毛利未達標則全部清零。
          </p>
        </div>

        {/* Quarterly Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0,1,2,3].map(qi => {
            const qr = quarterlyResults[qi];
            const isExpanded = expandedQuarter === qi;
            return (
              <div key={qi}
                className="bg-white rounded-xl shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setExpandedQuarter(isExpanded ? null : qi)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">{QUARTER_LABELS[qi]}</span>
                  {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                </div>
                {qr ? (
                  <>
                    <div className="text-2xl font-bold text-blue-600 mb-1">{formatAmount(qr.quarterlyBonus)}</div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <div>{thresholdBadge(qr.gpThresholdLevel)} 毛利達成 {formatRate(qr.gpAchievementRate)}</div>
                      <div>月合計：{formatAmount(qr.monthlyBonusSum)}</div>
                      {qr.makeupBonus > 0 && (
                        <div className="text-green-600 font-medium">補差額：+{formatAmount(qr.makeupBonus)}</div>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t text-xs text-gray-500 space-y-1">
                        <div>季毛利目標：{formatAmount(qr.quarterlyGpTarget ?? 0)}</div>
                        <div>季毛利實際：{formatAmount(qr.quarterlyGpActual ?? 0)}</div>
                        <div>加權達成：{formatRate(qr.totalWeight * 100)}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-gray-400 text-sm">尚無資料</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Monthly Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b flex items-center gap-2">
            <Calendar size={18} className="text-blue-500" />
            <h2 className="font-semibold text-gray-800">逐月業績明細</h2>
            <span className="text-xs text-gray-400 ml-2">點擊儲存格直接編輯，修改後按儲存</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">月份</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">營業天數</th>
                  <th className="px-3 py-2 text-center bg-blue-50 whitespace-nowrap">毛利目標</th>
                  <th className="px-3 py-2 text-center bg-blue-50 whitespace-nowrap">毛利實際</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">營業額目標</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">營業額實際</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">來客數目標</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">來客數實際</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">處方箋目標</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">處方箋實際</th>
                  <th className="px-3 py-2 text-center bg-green-50 whitespace-nowrap">達成門檻</th>
                  <th className="px-3 py-2 text-center bg-green-50 whitespace-nowrap">獎金</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, idx) => {
                  const bonus = bonusResults[idx];
                  const isQ1 = [1,4,7,10].includes(row.month);
                  return (
                    <tr key={row.month}
                      className={`hover:bg-gray-50 ${isQ1 ? 'border-t-2 border-blue-100' : ''} ${row._edited ? 'bg-yellow-50/50' : ''}`}
                    >
                      <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                        {row.month} 月
                        {row._edited && <span className="ml-1 text-xs text-yellow-600">*</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.business_days} onChange={v => setField(row.month, 'business_days', v)} />
                      </td>
                      <td className="px-2 py-1.5 bg-blue-50/30">
                        <NumInput value={row.monthly_gross_profit_target} onChange={v => setField(row.month, 'monthly_gross_profit_target', v)} />
                      </td>
                      <td className="px-2 py-1.5 bg-blue-50/30">
                        <NumInput value={row.monthly_gross_profit_actual} onChange={v => setField(row.month, 'monthly_gross_profit_actual', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.monthly_revenue_target} onChange={v => setField(row.month, 'monthly_revenue_target', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.monthly_revenue_actual} onChange={v => setField(row.month, 'monthly_revenue_actual', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.monthly_customer_count_target} onChange={v => setField(row.month, 'monthly_customer_count_target', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.monthly_customer_count_actual} onChange={v => setField(row.month, 'monthly_customer_count_actual', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.last_month_rx_target} onChange={v => setField(row.month, 'last_month_rx_target', v)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={row.last_month_rx_actual} onChange={v => setField(row.month, 'last_month_rx_actual', v)} />
                      </td>
                      <td className="px-3 py-2 text-center bg-green-50/30">
                        {bonus ? thresholdBadge(bonus.gpThresholdLevel) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center bg-green-50/30 font-bold text-blue-700">
                        {bonus && bonus.gpThresholdLevel > 0
                          ? formatAmount(bonus.finalBonus)
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row._edited && (
                          <button
                            onClick={() => saveRow(row.month)}
                            disabled={saving === row.month}
                            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 mx-auto"
                          >
                            {saving === row.month
                              ? <RefreshCw size={12} className="animate-spin" />
                              : <Save size={12} />
                            }
                            儲存
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quarterly detailed cards */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {[0,1,2,3].map(qi => {
            const qr = quarterlyResults[qi];
            if (!qr) return null;
            const qMonths = [qi*3+1, qi*3+2, qi*3+3];
            return (
              <div key={qi} className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Award size={18} className="text-yellow-500" />
                  <h3 className="font-semibold text-gray-800">{QUARTER_LABELS[qi]} 季獎金明細</h3>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {qMonths.map(m => {
                    const br = bonusResults[m-1];
                    return (
                      <div key={m} className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 mb-1">{m} 月</div>
                        {br && br.gpThresholdLevel > 0 ? (
                          <>
                            {thresholdBadge(br.gpThresholdLevel)}
                            <div className="text-sm font-bold text-blue-600 mt-1">{formatAmount(br.finalBonus)}</div>
                            <div className="text-xs text-gray-400">達成 {formatRate(br.gpAchievementRate)}</div>
                          </>
                        ) : (
                          <div className="text-xs text-gray-400 mt-2">無資料</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="border-t pt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">月獎金合計</span>
                    <span className="font-medium">{formatAmount(qr.monthlyBonusSum)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">季獎金應得</span>
                    <span className="font-bold text-blue-700">{formatAmount(qr.quarterlyBonus)}</span>
                  </div>
                  {qr.makeupBonus > 0 && (
                    <div className="flex justify-between text-green-600 font-semibold">
                      <span>補差額</span>
                      <span>+{formatAmount(qr.makeupBonus)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {thresholdBadge(qr.gpThresholdLevel)}
                    <span className="text-xs text-gray-400">季毛利達成 {formatRate(qr.gpAchievementRate)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Excel template tip */}
      <div className="max-w-7xl mx-auto px-4 pb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          <strong>Excel 匯入格式：</strong>
          第一列為標題列，必要欄位：<code className="bg-blue-100 px-1 rounded">月份</code> <code className="bg-blue-100 px-1 rounded">營業天數</code>；
          其餘欄位：月毛利目標、月營業額目標、月來客數目標、上個月處方箋目標、月毛利實際、月營業額實際、月來客數實際、上個月處方箋實際
        </div>
      </div>
    </div>
  );
}

// ─── NumInput ─────────────────────────────────────────────────────────────────
function NumInput({ value, onChange }: { value: number | null; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      defaultValue={value ?? ''}
      key={value ?? 'empty'}
      onBlur={e => onChange(e.target.value)}
      className="w-full min-w-[80px] text-right border-0 bg-transparent text-sm
        focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-1 py-0.5
        hover:bg-white hover:border hover:border-gray-200"
      step="any"
    />
  );
}
