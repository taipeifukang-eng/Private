'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  calcMonthlyBonus,
  calcQuarterlyBonus,
  MONTHLY_THRESHOLDS,
  QUARTERLY_THRESHOLDS,
  formatAmount,
  formatRate,
  type ThresholdDef,
  type MonthlyPerformance,
  type BonusResult,
  type QuarterlyBonusResult,
} from '@/lib/performance/bonus-calc';
import {
  TrendingUp, Upload, Save, Edit2, X, Check,
  ChevronDown, ChevronRight, RefreshCw, AlertCircle,
  BarChart2, Award, Target, Calendar, DollarSign, Filter,
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
  const [canViewBonusTab, setCanViewBonusTab] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null); // month being saved
  const [importLoading, setImportLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'performance' | 'bonus-import'>('performance');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 門市自訂獎金閾值
  const [monthlyThresholds, setMonthlyThresholds] = useState<ThresholdDef[]>(
    MONTHLY_THRESHOLDS.map(t => ({ ...t }))
  );
  const [quarterlyThresholds, setQuarterlyThresholds] = useState<ThresholdDef[]>(
    QUARTERLY_THRESHOLDS.map(t => ({ ...t }))
  );
  const [thresholdEditing, setThresholdEditing] = useState(false);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [editMonthly, setEditMonthly] = useState<ThresholdDef[]>([]);
  const [editQuarterly, setEditQuarterly] = useState<ThresholdDef[]>([]);

  // ─── 載入門市自訂閾值 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedStoreId) return;
    (async () => {
      try {
        const res = await fetch(`/api/performance-thresholds?store_id=${selectedStoreId}`);
        const json = await res.json();
        if (json.monthly)   setMonthlyThresholds(json.monthly.map((t: any) => ({ multiplier: t.multiplier, baseAmount: t.baseAmount, label: t.label })));
        if (json.quarterly) setQuarterlyThresholds(json.quarterly.map((t: any) => ({ multiplier: t.multiplier, baseAmount: t.baseAmount, label: t.label })));
      } catch { /* 失敗則保留預設值 */ }
    })();
  }, [selectedStoreId]);

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

  // ─── RBAC: 是否可檢視「匯入每月獎金」Tab ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'performance.bonus.view' })
        });
        const json = await res.json();
        const allowed = Boolean(json.allowed);
        setCanViewBonusTab(allowed);
        if (!allowed) setActiveTab('performance');
      } catch {
        setCanViewBonusTab(false);
        setActiveTab('performance');
      }
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
    return calcMonthlyBonus(perf, monthlyThresholds);
  });

  const quarterlyResults: (QuarterlyBonusResult | null)[] = [0,1,2,3].map(qi => {
    const qMonths = [qi*3+1, qi*3+2, qi*3+3];
    const monthPerfs = qMonths.map(m => rowToPerf(rows.find(r => r.month === m) ?? emptyRecord(selectedStoreId, selectedYear, m)));
    const monthBonusAmounts = qMonths.map(m => bonusResults[m-1]?.finalBonus ?? 0);
    if (monthPerfs.every(p => !p.grossProfitTarget || !p.grossProfitActual)) return null;
    try {
      return calcQuarterlyBonus(monthPerfs, monthBonusAmounts, quarterlyThresholds);
    } catch { return null; }
  });

  // ─── Utility ─────────────────────────────────────────────────────────────
  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }

  // ─── Threshold helpers ───────────────────────────────────────────────────
  function startEditThreshold() {
    setEditMonthly(monthlyThresholds.map(t => ({ ...t })));
    setEditQuarterly(quarterlyThresholds.map(t => ({ ...t })));
    setThresholdEditing(true);
  }

  function cancelEditThreshold() {
    setEditMonthly([]);
    setEditQuarterly([]);
    setThresholdEditing(false);
  }

  async function saveThresholds() {
    if (!selectedStoreId) return;
    setThresholdSaving(true);
    try {
      const res = await fetch('/api/performance-thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStoreId,
          monthly:   editMonthly.map((t, i)   => ({ level: i + 1, base_amount: t.baseAmount })),
          quarterly: editQuarterly.map((t, i) => ({ level: i + 1, base_amount: t.baseAmount })),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setMonthlyThresholds(editMonthly.map(t => ({ ...t })));
      setQuarterlyThresholds(editQuarterly.map(t => ({ ...t })));
      setThresholdEditing(false);
      showMsg('success', '閾值設定已儲存');
    } catch (e: any) {
      showMsg('error', `儲存失敗：${e.message}`);
    } finally {
      setThresholdSaving(false);
    }
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
      {/* Header + Tabs */}
      <div className="bg-white border-b px-6 pt-4">
        <div className="flex items-center gap-3 mb-3">
          <BarChart2 className="text-blue-600" size={24} />
          <h1 className="text-xl font-bold text-gray-800">業績管理</h1>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('performance')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'performance'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart2 size={14} />
            團體獎金計算
          </button>
          {canViewBonusTab && (
            <button
              onClick={() => setActiveTab('bonus-import')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'bonus-import'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <DollarSign size={14} />
              匯入每月獎金
            </button>
          )}
        </div>
      </div>

      {canViewBonusTab && activeTab === 'bonus-import' && (
        <BonusImportTab profile={profile} allStores={stores} />
      )}

      {activeTab === 'performance' && (
        <div>
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

        {/* 閾值設定 */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Target size={16} className="text-blue-500" />
              獎金閾值設定（每人）
            </h2>
            <div className="flex items-center gap-2">
              {thresholdEditing ? (
                <>
                  <button
                    onClick={saveThresholds}
                    disabled={thresholdSaving}
                    className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                  >
                    {thresholdSaving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                    儲存
                  </button>
                  <button
                    onClick={cancelEditThreshold}
                    className="flex items-center gap-1 px-3 py-1 border rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <X size={12} /> 取消
                  </button>
                </>
              ) : (
                <button
                  onClick={startEditThreshold}
                  className="flex items-center gap-1 px-3 py-1 border rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                >
                  <Edit2 size={12} /> 設定閾值
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* 月閾值 */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">月獎金閾值</div>
              <div className="space-y-1.5">
                {(thresholdEditing ? editMonthly : monthlyThresholds).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {thresholdBadge(i + 1)}
                    <span className="text-gray-500 text-xs w-24 whitespace-nowrap">日毛利達 {Math.round(t.multiplier * 100)}%：</span>
                    {thresholdEditing ? (
                      <input
                        type="number"
                        value={t.baseAmount}
                        onChange={e => setEditMonthly(prev => prev.map((x, j) => j === i ? { ...x, baseAmount: parseInt(e.target.value) || 0 } : x))}
                        className="w-24 text-right border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    ) : (
                      <span className="font-bold text-gray-800">{formatAmount(t.baseAmount)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* 季閾值 */}
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">季獎金閾值</div>
              <div className="space-y-1.5">
                {(thresholdEditing ? editQuarterly : quarterlyThresholds).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {thresholdBadge(i + 1)}
                    <span className="text-gray-500 text-xs w-24 whitespace-nowrap">季毛利達 {Math.round(t.multiplier * 100)}%：</span>
                    {thresholdEditing ? (
                      <input
                        type="number"
                        value={t.baseAmount}
                        onChange={e => setEditQuarterly(prev => prev.map((x, j) => j === i ? { ...x, baseAmount: parseInt(e.target.value) || 0 } : x))}
                        className="w-24 text-right border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    ) : (
                      <span className="font-bold text-gray-800">{formatAmount(t.baseAmount)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            最終獎金 = 閾值金額 × (毛利90% + 營業額5% + 來客數5% + 處方箋10%)。毛利未達標則全部清零。
            {monthlyThresholds.some((t, i) => t.baseAmount !== MONTHLY_THRESHOLDS[i].baseAmount) && (
              <span className="ml-2 text-blue-500">• 此門市使用自訂閾值</span>
            )}
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
              第一列為標題列。<br />
              <span className="font-medium">選填欄位（可跨門市/跨年份匯入）：</span>
              <code className="bg-blue-100 px-1 rounded mx-1">門市代號</code>
              <code className="bg-blue-100 px-1 rounded mx-1">年份</code>
              — 省略時使用頁面所選門市與年份。<br />
              <span className="font-medium">必填欄位：</span>
              <code className="bg-blue-100 px-1 rounded mx-1">月份</code>
              <code className="bg-blue-100 px-1 rounded mx-1">營業天數</code>；
              其餘欄位：月毛利目標、月營業額目標、月來客數目標、上個月處方箋目標、月毛利實際、月營業額實際、月來客數實際、上個月處方箋實際
            </div>
          </div>
        </div>
      )}
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

// ─── BonusImportTab ───────────────────────────────────────────────────────────

interface StoreWithSupervisor {
  id: string;
  store_code: string;
  store_name: string;
  supervisor_id: string | null;
  supervisor_name: string | null;
}

interface BonusRecord {
  id: string;
  store_id: string;
  year_month: string;
  employee_code: string;
  employee_name: string | null;
  group_bonus: number;
  hr_subsidy_bonus: number;
  single_item_bonus: number;
  inventory_diff_penalty: number;
  talent_bonus: number;
  transport_fee: number;
  inventory_bonus: number;
  rx_incentive_bonus: number;
  quarterly_makeup_bonus: number;
  meal_allowance: number;
  spring_festival_bonus: number;
  pharmacist_guarantee: number;
  owner_rx_makeup: number;
  sales_competition_bonus: number;
  owner_signing_bonus: number;
  long_term_care_bonus: number;
  store?: { store_code: string; store_name: string } | { store_code: string; store_name: string }[];
}

const BONUS_COLS: { key: keyof BonusRecord; label: string }[] = [
  { key: 'group_bonus',            label: '團體獎金' },
  { key: 'hr_subsidy_bonus',       label: '人力補貼' },
  { key: 'single_item_bonus',      label: '單品獎金' },
  { key: 'inventory_diff_penalty', label: '盤差承擔' },
  { key: 'talent_bonus',           label: '育才獎金' },
  { key: 'transport_fee',          label: '交通費' },
  { key: 'inventory_bonus',        label: '盤點獎金' },
  { key: 'rx_incentive_bonus',     label: '處方激勵' },
  { key: 'quarterly_makeup_bonus', label: '季回補' },
  { key: 'meal_allowance',         label: '誤餐費' },
  { key: 'spring_festival_bonus',  label: '春節出勤' },
  { key: 'pharmacist_guarantee',   label: '藥師保證金' },
  { key: 'owner_rx_makeup',        label: '負責人處方回補' },
  { key: 'sales_competition_bonus',label: '銷售競賽' },
  { key: 'owner_signing_bonus',    label: '負責人簽約金' },
  { key: 'long_term_care_bonus',   label: '長照獎金' },
];

function getStoreInfo(store: BonusRecord['store']) {
  if (!store) return { code: '', name: '' };
  const s = Array.isArray(store) ? store[0] : store;
  return { code: s?.store_code || '', name: s?.store_name || '' };
}

function fmt(v: number) {
  if (!v) return '';
  return v.toLocaleString('zh-TW');
}

function rowTotal(r: BonusRecord): number {
  return BONUS_COLS.reduce((sum, c) => sum + (Number(r[c.key]) || 0), 0);
}

function rowTotalByCols(r: BonusRecord, cols: { key: keyof BonusRecord; label: string }[]): number {
  return cols.reduce((sum, c) => sum + (Number(r[c.key]) || 0), 0);
}

function isAllBonusZero(r: BonusRecord): boolean {
  return BONUS_COLS.every(c => (Number(r[c.key]) || 0) === 0);
}

function BonusImportTab({ profile, allStores }: { profile: any; allStores: Store[] }) {
  const now = new Date();
  const defaultYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [yearMonth,      setYearMonth]      = useState(defaultYM);
  const [quarter,        setQuarter]        = useState('');
  const [supervisorId,   setSupervisorId]   = useState('');
  const [filterStoreId,  setFilterStoreId]  = useState('');
  const [employeeCode,   setEmployeeCode]   = useState('');
  const [bonusKey,       setBonusKey]       = useState('');
  const [records,        setRecords]        = useState<BonusRecord[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [importLoading,  setImportLoading]  = useState(false);
  const [canImportBonus, setCanImportBonus] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>('store');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [message,        setMessage]        = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [storesWS,       setStoresWS]       = useState<StoreWithSupervisor[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // 載入督導-門市對應
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/stores-with-supervisors');
      const json = await res.json();
      if (json.success) setStoresWS(json.data || []);
    })();
  }, []);

  // RBAC: 是否可匯入每月獎金（admin 保底放行）
  useEffect(() => {
    (async () => {
      if (profile?.role === 'admin') {
        setCanImportBonus(true);
        return;
      }
      try {
        const res = await fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'performance.bonus.import' })
        });
        const json = await res.json();
        setCanImportBonus(Boolean(json.allowed));
      } catch {
        setCanImportBonus(false);
      }
    })();
  }, [profile?.role]);

  // 督導清單（不重複）
  const supervisors = Array.from(
    new Map(
      storesWS
        .filter(s => s.supervisor_id && s.supervisor_name)
        .map(s => [s.supervisor_id!, { id: s.supervisor_id!, name: s.supervisor_name! }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

  // 依督導篩選門市列表
  const visibleStores = supervisorId
    ? storesWS.filter(s => s.supervisor_id === supervisorId)
    : allStores;

  // 載入資料
  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const baseParams = new URLSearchParams();
      if (supervisorId && !filterStoreId) baseParams.set('supervisor_id', supervisorId);
      if (filterStoreId) baseParams.append('store_id', filterStoreId);

      if (!quarter) {
        const params = new URLSearchParams(baseParams);
        params.set('year_month', yearMonth);
        const res = await fetch(`/api/performance-bonus?${params}`);
        const json = await res.json();
        const loadedRecords = json.records || [];
        
        // 🔍 DEBUG: 追踪 FK0278
        const fk0278 = loadedRecords.find((r: BonusRecord) => r.employee_code?.toUpperCase() === 'FK0278');
        console.log(`[bonusImport DEBUG] 已加载 ${loadedRecords.length} 筆記錄`);
        if (fk0278) {
          console.log(`[bonusImport DEBUG] ✓ FK0278 在記錄中:`, {
            employee_code: fk0278.employee_code,
            employee_name: fk0278.employee_name,
            store: fk0278.store,
            single_item_bonus: fk0278.single_item_bonus,
            all_fields: fk0278,
          });
        } else {
          console.warn(`[bonusImport DEBUG] ✗ FK0278 未在記錄中`);
        }
        
        setRecords(loadedRecords);
      } else {
        const year = yearMonth.split('-')[0];
        const q = Number(quarter);
        const startMonth = (q - 1) * 3 + 1;
        const quarterMonths = [0, 1, 2].map(i => `${year}-${String(startMonth + i).padStart(2, '0')}`);

        const responses = await Promise.all(
          quarterMonths.map(async (ym) => {
            const params = new URLSearchParams(baseParams);
            params.set('year_month', ym);
            const res = await fetch(`/api/performance-bonus?${params}`);
            const json = await res.json();
            return (json.records || []) as BonusRecord[];
          })
        );

        const flatRecords = responses.flat();
        
        // 🔍 DEBUG: 季度数据追踪
        const fk0278Quarterly = flatRecords.find((r: BonusRecord) => r.employee_code?.toUpperCase() === 'FK0278');
        console.log(`[bonusImport DEBUG] 季度模式: 已加载 ${flatRecords.length} 筆記錄`);
        if (fk0278Quarterly) {
          console.log(`[bonusImport DEBUG] ✓ FK0278 在季度記錄中:`, fk0278Quarterly);
        }
        
        const grouped = new Map<string, BonusRecord>();

        flatRecords.forEach((r) => {
          const key = `${r.store_id}__${r.employee_code}`;
          const existing = grouped.get(key);

          if (!existing) {
            const initRecord = {
              ...r,
              id: `${year}-Q${quarter}__${r.store_id}__${r.employee_code}`,
              year_month: `${year}-Q${quarter}`,
            };
            BONUS_COLS.forEach((c) => {
              (initRecord[c.key] as unknown as number) = Number(r[c.key]) || 0;
            });
            grouped.set(key, initRecord);
            return;
          }

          BONUS_COLS.forEach((c) => {
            const prev = Number(existing[c.key]) || 0;
            const cur = Number(r[c.key]) || 0;
            (existing[c.key] as unknown as number) = prev + cur;
          });
        });

        const finalRecords = Array.from(grouped.values());
        
        // 🔍 DEBUG: 合并后追踪
        const fk0278Final = finalRecords.find((r: BonusRecord) => r.employee_code?.toUpperCase() === 'FK0278');
        console.log(`[bonusImport DEBUG] 合并后: ${finalRecords.length} 筆記錄`);
        if (fk0278Final) {
          console.log(`[bonusImport DEBUG] ✓ FK0278 在合并記錄中:`, fk0278Final);
        } else {
          console.warn(`[bonusImport DEBUG] ✗ FK0278 在合并后消失了!`);
        }
        
        setRecords(finalRecords);
      }
    } finally {
      setLoading(false);
    }
  }, [yearMonth, quarter, supervisorId, filterStoreId]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // 匯入
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      console.log('❌ 未選擇檔案');
      return;
    }
    console.log('📤 開始匯入，檔案:', file.name, '大小:', file.size, 'bytes');
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('year', yearMonth.split('-')[0]);
      if (filterStoreId) fd.append('store_id', filterStoreId);
      console.log('📡 發送請求到 /api/performance-bonus/import');
      
      // 添加 180 秒超時（避免大量資料時過早中斷）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);
      
      const res  = await fetch('/api/performance-bonus/import', { 
        method: 'POST', 
        body: fd,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      console.log('✅ 收到回應，Status:', res.status, res.statusText);
      const json = await res.json();
      console.log('📦 回應內容:', json);
      
      // 🔍 DEBUG: 导入后立即检查FK0278
      console.log('⏳ 导入完成，刷新数据中...');
      
      if (!json.success) {
        throw new Error(json.error || '匯入失敗（無詳細錯誤訊息）');
      }
      
      const importedMonths = Array.isArray(json.importedMonths) ? json.importedMonths : [];
      const importErrors = Array.isArray(json.errors) ? json.errors : [];
      const monthHint = importedMonths.length > 0
        ? `\n匯入月份：${importedMonths.join('、')}`
        : '';
      const viewHint = importedMonths.length > 1 && !quarter
        ? `\n目前頁面只會顯示你篩選的年月 ${yearMonth}，請切換年月或改用季別查看。`
        : '';
      const errorHint = importErrors.length > 0
        ? `\n略過原因：\n${importErrors.slice(0, 5).join('\n')}${importErrors.length > 5 ? `\n... 另有 ${importErrors.length - 5} 筆` : ''}`
        : '';
      const msg = `匯入完成：${json.imported} 筆${json.skipped ? `，略過 ${json.skipped} 筆` : ''}${monthHint}${viewHint}${errorHint}`;
      showMsg('success', msg);
      console.log('✅ ' + msg);
      
      // 导入成功后，加延迟再查询，确保数据已写入
      await new Promise(r => setTimeout(r, 500));
      
      await loadRecords();
      
      // 导入后再次检查FK0278
      console.log('🔍 [导入后检查] 正在查找FK0278...');
    } catch (err: any) {
      console.error('❌ 匯入錯誤:', err);
      let errorMsg = err?.message || String(err);
      if (err?.name === 'AbortError') {
        errorMsg = '匯入逾時（超過 180 秒）- 伺服器忙碌，請稍後重試';
      }
      showMsg('error', `匯入失敗：${errorMsg}`);
    } finally {
      setImportLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  }

  // 可用年月選項（近 12 個月 + 未來 2 個月）
  const ymOptions: string[] = [];
  for (let i = -12; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    ymOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  ymOptions.sort().reverse();

  const visibleBonusCols = useMemo(() => {
    if (!bonusKey) return BONUS_COLS;
    return BONUS_COLS.filter(c => String(c.key) === bonusKey);
  }, [bonusKey]);

  // 員編過濾（支援包含查詢）
  const employeeCodeKeyword = employeeCode.trim().toUpperCase();

  // 僅顯示至少有一個可視獎金欄位不為0，且符合員編過濾的資料列
  const visibleRecords = useMemo(
    () => {
      const step1 = records.filter(r => visibleBonusCols.some(c => (Number(r[c.key]) || 0) !== 0));
      
      // 🔍 DEBUG: 检查 FK0278 是否在 step1
      const fk0278_step1 = step1.find(r => r.employee_code?.toUpperCase() === 'FK0278');
      if (fk0278_step1) {
        console.log(`[bonusImport FILTER] FK0278 在步骤1（奖金列过滤）中:`, {
          store: fk0278_step1.store,
          single_item_bonus: fk0278_step1.single_item_bonus,
          visibleBonusColsCount: visibleBonusCols.length,
          visibleBonusCols: visibleBonusCols.map(c => c.key),
          hasNonZeroBonus: visibleBonusCols.some(c => (Number(fk0278_step1[c.key]) || 0) !== 0),
        });
      } else if (records.find(r => r.employee_code?.toUpperCase() === 'FK0278')) {
        console.warn(`[bonusImport FILTER] FK0278 被奖金列过滤过掉了! visibleBonusCols=${visibleBonusCols.map(c => c.key).join(',')}`);
      }
      
      const step2 = step1.filter(r => {
        if (!employeeCodeKeyword) return true;
        return String(r.employee_code || '').toUpperCase().includes(employeeCodeKeyword);
      });
      
      // 🔍 DEBUG: 检查 FK0278 是否在 step2
      const fk0278_final = step2.find(r => r.employee_code?.toUpperCase() === 'FK0278');
      if (fk0278_final) {
        console.log(`[bonusImport FILTER] FK0278 在最终可见记录中 ✓`);
      } else if (fk0278_step1 && !fk0278_final) {
        console.warn(`[bonusImport FILTER] FK0278 被员编过滤过掉了! employeeCodeKeyword="${employeeCodeKeyword}"`);
      }
      
      return step2;
    },
    [records, visibleBonusCols, employeeCodeKeyword]
  );

  // 合計列（只計可見資料、可視獎金欄位）
  const grandTotal = visibleRecords.reduce((sum, r) => sum + rowTotalByCols(r, visibleBonusCols), 0);

  function handleSortClick(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
      return;
    }
    setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
  }

  function handleSortClear(key: string) {
    if (sortKey === key) {
      setSortKey(null);
      setSortDirection('asc');
    }
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  function getSortValue(record: BonusRecord, key: string): string | number {
    const storeInfo = getStoreInfo(record.store);
    if (key === 'store') return `${storeInfo.code} ${storeInfo.name}`;
    if (key === 'year_month') return record.year_month || '';
    if (key === 'employee_code') return record.employee_code || '';
    if (key === 'employee_name') return record.employee_name || '';
    if (key === 'total') return rowTotalByCols(record, visibleBonusCols);
    if (key.startsWith('bonus:')) {
      const bonusKey = key.replace('bonus:', '') as keyof BonusRecord;
      return Number(record[bonusKey]) || 0;
    }
    return '';
  }

  const sortedRecords = useMemo(() => {
    if (!sortKey) return visibleRecords;

    const sorted = [...visibleRecords];
    sorted.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);

      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), 'zh-Hant', { numeric: true, sensitivity: 'base' });
      }

      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [visibleRecords, sortKey, sortDirection, visibleBonusCols]);

  return (
    <div className="max-w-full px-4 py-6 space-y-4">

      {/* 篩選列 */}
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Filter size={16} className="text-gray-400" />

        {/* 年月份 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">年月份</label>
          <select
            value={yearMonth}
            onChange={e => setYearMonth(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ymOptions.map(ym => (
              <option key={ym} value={ym}>{ym}</option>
            ))}
          </select>
        </div>

        {/* 年季度 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">年季度</label>
          <select
            value={quarter}
            onChange={e => setQuarter(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">不套用</option>
            <option value="1">第1季 (Q1)</option>
            <option value="2">第2季 (Q2)</option>
            <option value="3">第3季 (Q3)</option>
            <option value="4">第4季 (Q4)</option>
          </select>
        </div>

        {/* 督導區 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">督導區</label>
          <select
            value={supervisorId}
            onChange={e => { setSupervisorId(e.target.value); setFilterStoreId(''); }}
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部</option>
            {supervisors.map(sv => (
              <option key={sv.id} value={sv.id}>{sv.name}</option>
            ))}
          </select>
        </div>

        {/* 門市別 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">門市別</label>
          <select
            value={filterStoreId}
            onChange={e => setFilterStoreId(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部</option>
            {visibleStores.map(s => (
              <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>
            ))}
          </select>
        </div>

        {/* 獎金名稱 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">獎金名稱</label>
          <select
            value={bonusKey}
            onChange={e => setBonusKey(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部</option>
            {BONUS_COLS.map(c => (
              <option key={String(c.key)} value={String(c.key)}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* 員編 */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">員編</label>
          <input
            type="text"
            value={employeeCode}
            onChange={e => setEmployeeCode(e.target.value.toUpperCase())}
            placeholder="例如 FK1067"
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          />
        </div>

        {/* 重新載入 */}
        <button
          onClick={loadRecords}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          重新載入
        </button>

        {/* 匯入按鈕（RBAC: performance.bonus.import） */}
        {canImportBonus && (
          <div className="ml-auto flex items-center gap-2">
            <input type="file" accept=".xlsx,.xls" ref={fileRef} onChange={handleImport} className="hidden" id="bonus-import-file" />
            <label
              htmlFor="bonus-import-file"
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer ${
                importLoading ? 'bg-gray-100 text-gray-400 pointer-events-none' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <Upload size={14} />
              {importLoading ? '匯入中...' : '匯入 Excel'}
            </label>
          </div>
        )}
      </div>

      {/* 訊息列 */}
      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <AlertCircle size={16} />
          {message.text}
        </div>
      )}

      {/* 統計摘要 */}
      <div className="bg-white rounded-xl shadow-sm px-5 py-3 flex items-center gap-6 text-sm">
        <span className="text-gray-500">共 <strong>{visibleRecords.length}</strong> 筆</span>
        <span className="text-gray-500">獎金合計：<strong className="text-blue-700">{grandTotal.toLocaleString('zh-TW')}</strong> 元</span>
        {quarter && (
          <span className="text-blue-600">季別模式：{yearMonth.split('-')[0]}-Q{quarter}（同人員各獎金已加總）</span>
        )}
      </div>

      {/* 資料表格 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap border border-gray-200 border-collapse">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th
                  className="px-3 py-2 text-left sticky left-0 bg-gray-50 z-10 cursor-pointer select-none border border-gray-200"
                  title="左鍵排序，右鍵取消排序"
                  onClick={() => handleSortClick('store')}
                  onContextMenu={e => { e.preventDefault(); handleSortClear('store'); }}
                >
                  門市{sortIndicator('store')}
                </th>
                <th
                  className="px-3 py-2 text-left cursor-pointer select-none border border-gray-200"
                  title="左鍵排序，右鍵取消排序"
                  onClick={() => handleSortClick('year_month')}
                  onContextMenu={e => { e.preventDefault(); handleSortClear('year_month'); }}
                >
                  年月{sortIndicator('year_month')}
                </th>
                <th
                  className="px-3 py-2 text-left cursor-pointer select-none border border-gray-200"
                  title="左鍵排序，右鍵取消排序"
                  onClick={() => handleSortClick('employee_code')}
                  onContextMenu={e => { e.preventDefault(); handleSortClear('employee_code'); }}
                >
                  員編{sortIndicator('employee_code')}
                </th>
                <th
                  className="px-3 py-2 text-left cursor-pointer select-none border border-gray-200"
                  title="左鍵排序，右鍵取消排序"
                  onClick={() => handleSortClick('employee_name')}
                  onContextMenu={e => { e.preventDefault(); handleSortClear('employee_name'); }}
                >
                  姓名{sortIndicator('employee_name')}
                </th>
                {visibleBonusCols.map(c => (
                  <th
                    key={c.key}
                    className="px-3 py-2 text-right cursor-pointer select-none border border-gray-200"
                    title="左鍵排序，右鍵取消排序"
                    onClick={() => handleSortClick(`bonus:${String(c.key)}`)}
                    onContextMenu={e => { e.preventDefault(); handleSortClear(`bonus:${String(c.key)}`); }}
                  >
                    {c.label}{sortIndicator(`bonus:${String(c.key)}`)}
                  </th>
                ))}
                <th
                  className="px-3 py-2 text-right bg-blue-50 font-semibold text-blue-700 cursor-pointer select-none border border-gray-200"
                  title="左鍵排序，右鍵取消排序"
                  onClick={() => handleSortClick('total')}
                  onContextMenu={e => { e.preventDefault(); handleSortClear('total'); }}
                >
                  合計{sortIndicator('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4 + visibleBonusCols.length + 1} className="px-4 py-8 text-center text-gray-400 border border-gray-200">
                    <RefreshCw size={18} className="animate-spin inline-block mr-2" />載入中...
                  </td>
                </tr>
              ) : sortedRecords.length === 0 ? (
                <tr>
                  <td colSpan={4 + visibleBonusCols.length + 1} className="px-4 py-10 text-center text-gray-400 border border-gray-200">
                    尚無可顯示資料（全0資料列已自動隱藏）
                  </td>
                </tr>
              ) : (
                sortedRecords.map(r => {
                  const storeInfo = getStoreInfo(r.store);
                  const total = rowTotalByCols(r, visibleBonusCols);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 sticky left-0 bg-white font-medium text-gray-700 z-10 border border-gray-200">
                        {storeInfo.code}<br />
                        <span className="text-gray-400 font-normal">{storeInfo.name}</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 border border-gray-200">{r.year_month}</td>
                      <td className="px-3 py-1.5 text-gray-600 border border-gray-200">{r.employee_code}</td>
                      <td className="px-3 py-1.5 text-gray-700 border border-gray-200">{r.employee_name || '—'}</td>
                      {visibleBonusCols.map(c => {
                        const v = Number(r[c.key]) || 0;
                        return (
                          <td key={c.key} className={`px-3 py-1.5 text-right border border-gray-200 ${v < 0 ? 'text-red-600' : v > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                            {fmt(v)}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-1.5 text-right font-semibold bg-blue-50/50 border border-gray-200 ${total < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                        {total.toLocaleString('zh-TW')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excel 格式說明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <strong>Excel 匯入格式（第一列為標題列）：</strong><br />
        <span className="font-medium">必填欄位：</span>
        <code className="bg-blue-100 px-1 rounded mx-0.5">員編</code>
        <code className="bg-blue-100 px-1 rounded mx-0.5">年月</code>（格式：2026-03）或
        <code className="bg-blue-100 px-1 rounded mx-0.5">月份</code> + <code className="bg-blue-100 px-1 rounded mx-0.5">年份</code>（省略年份則使用篩選器所選年份）<br />
        <span className="font-medium">選填欄位：</span>
        <code className="bg-blue-100 px-1 rounded mx-0.5">門市代號</code>（省略時使用篩選器所選門市）
        <code className="bg-blue-100 px-1 rounded mx-0.5">姓名</code><br />
        <span className="font-medium">獎金欄位：</span>
        團體獎金、人力補貼團體獎金、單品獎金、盤點盤差承擔金額、育才獎金、交通費、
        盤點獎金、處方激勵獎金、季回補獎金、誤餐費、春節出勤獎金、藥師保證金、
        負責人處方回補獎金、銷售競賽獎金、負責人簽約金
      </div>
    </div>
  );
}
