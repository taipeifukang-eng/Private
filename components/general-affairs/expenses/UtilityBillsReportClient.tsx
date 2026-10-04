'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Droplets, Loader2, Phone, Router, Zap } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type Mode = 'month' | 'quarter' | 'year';
type Totals = { WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };
type ReportRow = Totals & { store_id: string | null; store_code: string | null; location_name: string };

const now = new Date();
const taipeiParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(now);
const [currentYear, currentMonth] = taipeiParts.split('-');
const EXPENSES = [
  { key: 'WATER', label: '水費', icon: Droplets, color: 'text-sky-700' },
  { key: 'ELECTRICITY', label: '電費', icon: Zap, color: 'text-amber-700' },
  { key: 'PHONE', label: '電話費', icon: Phone, color: 'text-orange-700' },
  { key: 'INTERNET', label: '網路費', icon: Router, color: 'text-emerald-700' },
] as const;

function money(value: number) {
  return Number(value || 0).toLocaleString('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });
}

function periodLabel(mode: Mode, year: string, month: string, quarter: number) {
  if (mode === 'month') return `${month.replace('-', ' 年 ')} 月`;
  if (mode === 'quarter') return `${year} 年第 ${quarter} 季`;
  return `${year} 年`;
}

export default function UtilityBillsReportClient() {
  const [mode, setMode] = useState<Mode>('year');
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(taipeiParts);
  const [quarter, setQuarter] = useState(String(Math.ceil(Number(currentMonth) / 3)));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const period = useMemo(() => periodLabel(mode, year, month, Number(quarter)), [mode, year, month, quarter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setRows([]);
    setTotals(null);
    try {
      const params = new URLSearchParams({ mode, year: mode === 'month' ? month.slice(0, 4) : year });
      params.set('period', mode === 'month' ? month : mode === 'quarter' ? quarter : year);
      const response = await fetch(`/api/general-affairs/utility-bills/report?${params}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.success === false) throw new Error(typeof json.error === 'string' ? json.error : '報表載入失敗');
      setRows(json.data?.rows || []);
      setTotals(json.data?.totals || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '報表載入失敗');
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [mode, month, quarter, year]);

  useEffect(() => { void load(); }, [load]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-slate-200 bg-white p-1" role="group" aria-label="報表期間">
        {([['month', '月'], ['quarter', '季'], ['year', '年']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`h-8 min-w-12 rounded px-3 text-sm font-semibold ${mode === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
        ))}
      </div>
      {mode === 'month' ? (
        <input aria-label="報表月份" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setYear(event.target.value.slice(0, 4)); }} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" />
      ) : <>
        <input aria-label="報表年度" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} className="h-10 w-28 rounded-md border border-slate-300 bg-white px-3 text-sm" />
        {mode === 'quarter' && <select aria-label="報表季度" value={quarter} onChange={(event) => setQuarter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">{[1, 2, 3, 4].map((item) => <option key={item} value={item}>第 {item} 季</option>)}</select>}
      </>}
    </div>
  );

  return <div className="mx-auto flex max-w-7xl flex-col gap-4">
    <GeneralAffairsPageHeader
      eyebrow="費用管理"
      breadcrumbs={[{ label: '總務服務中心', href: '/general-affairs' }, { label: '水電電話網路費', href: '/general-affairs/utility-bills' }, { label: '費用報表' }]}
      title="據點費用報表"
      description="比較各據點水費、電費、電話費與網路費。"
      primaryAction={<Link href="/general-affairs/utility-bills" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">返回帳單</Link>}
    />

    <section className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-bold text-slate-950">{period}費用</h2><p className="mt-1 text-sm text-slate-500">{totals ? `${totals.bill_count} 筆帳單` : '依帳單月份統計'}</p></div>
      {controls}
    </section>

    {error && <div role="alert" className="flex items-center justify-between gap-3 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => void load()} className="shrink-0 font-bold underline">重試</button></div>}
    {totals && !error && <section aria-label="期間費用總額" className="grid grid-cols-2 border-y border-slate-200 bg-white sm:grid-cols-5">
      <div className="col-span-2 border-b border-slate-200 p-4 sm:col-span-1 sm:border-b-0 sm:border-r"><div className="text-xs font-semibold text-slate-500">期間總支出</div><div className="mt-1 text-xl font-black tabular-nums text-slate-950">{money(totals.total)}</div></div>
      {EXPENSES.map(({ key, label, icon: Icon, color }) => <div key={key} className="border-b border-r border-slate-100 p-4 last:border-r-0 sm:border-b-0"><div className={`flex items-center gap-1.5 text-xs font-semibold ${color}`}><Icon className="h-3.5 w-3.5" />{label}</div><div className="mt-1 font-bold tabular-nums text-slate-800">{money(totals[key])}</div></div>)}
    </section>}

    <section className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 className="font-bold text-slate-900">各據點費用明細</h2><span className="text-xs text-slate-500">{rows.length} 個據點</span></div>
      {loading ? <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在彙整帳單</div> : error ? <div className="p-10 text-center text-sm text-slate-500">目前無法載入報表。</div> : rows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">目前沒有可顯示的據點。</div> : <div className="overflow-x-auto">
        {totals?.bill_count === 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">這段期間尚未登錄帳單；下表列出啟用據點，金額為 0。</div>}
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600"><tr><th scope="col" className="sticky left-0 bg-slate-50 px-4 py-3">據點</th><th scope="col" className="px-4 py-3 text-right">水費</th><th scope="col" className="px-4 py-3 text-right">電費</th><th scope="col" className="px-4 py-3 text-right">電話費</th><th scope="col" className="px-4 py-3 text-right">網路費</th><th scope="col" className="px-4 py-3 text-right">合計</th><th scope="col" className="px-4 py-3 text-right">帳單</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.store_id || row.location_name} className="hover:bg-slate-50"><th scope="row" className="sticky left-0 bg-white px-4 py-3 font-semibold text-slate-800">{row.location_name}</th><td className="px-4 py-3 text-right tabular-nums">{money(row.WATER)}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.ELECTRICITY)}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.PHONE)}</td><td className="px-4 py-3 text-right tabular-nums">{money(row.INTERNET)}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{money(row.total)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-500">{row.bill_count}</td></tr>)}</tbody>
          {totals && <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold"><tr><th scope="row" className="sticky left-0 bg-slate-50 px-4 py-3">全據點合計</th><td className="px-4 py-3 text-right tabular-nums">{money(totals.WATER)}</td><td className="px-4 py-3 text-right tabular-nums">{money(totals.ELECTRICITY)}</td><td className="px-4 py-3 text-right tabular-nums">{money(totals.PHONE)}</td><td className="px-4 py-3 text-right tabular-nums">{money(totals.INTERNET)}</td><td className="px-4 py-3 text-right tabular-nums">{money(totals.total)}</td><td className="px-4 py-3 text-right tabular-nums">{totals.bill_count}</td></tr></tfoot>}
        </table>
      </div>}
    </section>
    <p className="flex items-center gap-2 text-xs text-slate-500"><BarChart3 className="h-3.5 w-3.5" />依帳單月份加總，包含已繳與未繳帳單；已刪除紀錄不列入。</p>
  </div>;
}
