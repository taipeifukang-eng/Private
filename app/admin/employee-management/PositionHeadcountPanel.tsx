'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  HEADCOUNT_COLUMNS,
  buildHeadcountExportRows,
  computeHeadcountTrend,
  computeMonthHeadcount,
  unfinalizedStoresForMonth,
  type AreaHeadcount,
  type ColumnKey,
  type HeadcountEntry,
  type HeadcountGroup,
} from '@/lib/monthly-staff/position-headcount';
import type { PositionHeadcountPayload } from '@/lib/monthly-staff/position-headcount-data';

function currentMonthTaipei(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

interface ListModal {
  title: string;
  entries: HeadcountEntry[];
}

export default function PositionHeadcountPanel() {
  const [month, setMonth] = useState(currentMonthTaipei());
  const [view, setView] = useState<'month' | 'trend'>('month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<PositionHeadcountPayload | null>(null);
  const [modal, setModal] = useState<ListModal | null>(null);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/admin/position-headcount?month=${month}${view === 'trend' ? '&trend=1' : ''}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error || `讀取失敗（${res.status}）`);
        if (!cancelled) setPayload(json.data as PositionHeadcountPayload);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setPayload(null);
          setError(e?.message || '讀取失敗');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, view]);

  const result = useMemo(
    () => (payload && payload.yearMonth === month ? computeMonthHeadcount(payload.records, payload.stores, month) : null),
    [payload, month],
  );
  const trend = useMemo(
    () => (payload && payload.yearMonth === month && payload.trend ? computeHeadcountTrend(payload.records, payload.stores, month, 12) : null),
    [payload, month],
  );

  const openList = (title: string, entries: HeadcountEntry[]) => setModal({ title, entries });

  const handleExport = () => {
    if (!result) return;
    const { summaryRows, detailRows } = buildHeadcountExportRows(result);
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.json_to_sheet(summaryRows);
    s1['!cols'] = [{ wch: 14 }, { wch: 24 }, ...HEADCOUNT_COLUMNS.map(() => ({ wch: 12 })), { wch: 18 }, { wch: 10 }];
    const s2 = XLSX.utils.json_to_sheet(detailRows);
    s2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, s1, '人數統計');
    XLSX.utils.book_append_sheet(wb, s2, '人員明細');
    XLSX.writeFile(wb, `每月職位人數統計_${month}.xlsx`);
  };

  const cell = (g: HeadcountGroup, col: ColumnKey, scopeTitle: string) => {
    const n = g.people[col].length;
    const label = HEADCOUNT_COLUMNS.find((c) => c.key === col)!.label;
    const supActing = col === 'acting' ? g.actingBySupervisor.length : 0;
    return (
      <td key={col} className="px-3 py-2 text-center whitespace-nowrap">
        {n > 0 ? (
          <button
            type="button"
            onClick={() => openList(`${scopeTitle}｜${label}（${n} 人）`, g.people[col])}
            className="font-semibold text-blue-700 hover:underline"
          >
            {n}
          </button>
        ) : (
          <span className="text-gray-300">0</span>
        )}
        {col === 'acting' && g.actingBySupervisor.length > 0 && (
          <button
            type="button"
            onClick={() => openList(`${scopeTitle}｜由督導代理店長（${supActing} 人，已算在「督導」欄）`, g.actingBySupervisor)}
            className="block mx-auto text-xs text-amber-700 hover:underline"
          >
            其中 {supActing} 位由督導代理
          </button>
        )}
      </td>
    );
  };

  const rowCells = (g: HeadcountGroup, scopeTitle: string) => (
    <>
      {HEADCOUNT_COLUMNS.map((c) => cell(g, c.key, scopeTitle))}
      <td className="px-3 py-2 text-center font-semibold text-gray-900">{g.totalPeople}</td>
    </>
  );

  const groupHeads = ['行政', '門市人員', '其他'].map((label) => ({
    label,
    span: HEADCOUNT_COLUMNS.filter((c) => c.group === label).length,
  }));

  const unfinalized = unfinalizedStoresForMonth(payload, month);
  const otherPositions = (entries: HeadcountEntry[]) => {
    const m = new Map<string, number>();
    entries.forEach((e) => {
      const p = e.position || '（未填職位）';
      m.set(p, (m.get(p) || 0) + 1);
    });
    return Array.from(m.entries()).map(([p, n]) => `${p} ${n}`).join('、');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-gray-700">
            月份{' '}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="ml-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setView('month')}
              className={`px-4 py-2 ${view === 'month' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              當月明細
            </button>
            <button
              type="button"
              onClick={() => setView('trend')}
              className={`px-4 py-2 ${view === 'trend' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              近 12 個月趨勢
            </button>
          </div>
          {loading && <span className="text-sm text-gray-500">讀取中…</span>}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-semibold"
        >
          <Download size={18} />
          匯出 Excel（{month}）
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">{error}</div>}

      {unfinalized.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-4 text-sm">
          <p className="font-semibold">本月資料尚未定稿，數字可能變動</p>
          <p className="mt-1">
            尚有 {unfinalized.length} 間門市的每月人員狀態未確認：
            {unfinalized.map((s) => `${s.store_code} ${s.store_name}`.trim()).join('、')}
          </p>
        </div>
      )}

      {result && result.unknownStatusPeople.length > 0 && view === 'month' && (
        <div className="bg-orange-50 border border-orange-300 text-orange-900 rounded-lg p-4 text-sm">
          有 {result.unknownStatusPeople.length} 筆人員的月狀態無法辨識（狀態待確認），已先計入統計。
          <button
            type="button"
            className="ml-2 underline font-semibold"
            onClick={() => openList('狀態待確認名單（已計入統計）', result.unknownStatusPeople)}
          >
            查看名單
          </button>
        </div>
      )}

      {view === 'month' && result && (
        <>
          <p className="text-sm text-gray-600">
            只統計「月底仍在職」的人（不含當月離職、留職停薪、調出、支援卡班）。全公司合計每人只算一次；各門市與督導區照實際登記顯示，
            跨店的人會在每間門市各出現一次，所以門市／督導區加總可能大於全公司合計。點任一數字可看名單。
          </p>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-left sticky left-0 bg-gray-50 z-10 whitespace-nowrap">門市</th>
                  {groupHeads.map((g) => (
                    <th key={g.label} colSpan={g.span} className="px-3 py-1 text-center border-l border-gray-200">{g.label}</th>
                  ))}
                  <th rowSpan={2} className="px-3 py-2 text-center border-l border-gray-200 whitespace-nowrap">總人數</th>
                </tr>
                <tr>
                  {HEADCOUNT_COLUMNS.map((c) => (
                    <th key={c.key} className="px-3 py-1 text-center font-medium whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-blue-50 font-semibold">
                  <td className="px-3 py-2 sticky left-0 bg-blue-50 z-10 whitespace-nowrap">全公司合計</td>
                  {rowCells(result.company, '全公司')}
                </tr>
                {result.areas.map((a) => (
                  <AreaRows key={a.key} area={a} rowCells={rowCells} />
                ))}
                {result.areas.length === 0 && (
                  <tr>
                    <td colSpan={HEADCOUNT_COLUMNS.length + 2} className="px-3 py-8 text-center text-gray-500">這個月沒有人員狀態資料</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'trend' && trend && (
        <>
          <p className="text-sm text-gray-600">全公司近 12 個月（到 {month} 為止）每月各欄人數，每人只算一次，口徑同全公司合計。沒有資料的月份顯示「—」。</p>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left sticky left-0 bg-gray-50 z-10 whitespace-nowrap">月份</th>
                  {HEADCOUNT_COLUMNS.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-center whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="px-3 py-2 text-center whitespace-nowrap">其中督導代理</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">總人數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {trend.map((t) => (
                  <tr key={t.yearMonth}>
                    <td className="px-3 py-2 sticky left-0 bg-white z-10 whitespace-nowrap font-medium">{t.yearMonth}</td>
                    {HEADCOUNT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-center">{t.hasData ? t.counts[c.key] : '—'}</td>
                    ))}
                    <td className="px-3 py-2 text-center">{t.hasData ? t.actingBySupervisor : '—'}</td>
                    <td className="px-3 py-2 text-center font-semibold">{t.hasData ? t.totalPeople : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setModal(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{modal.title}</h3>
                {modal.entries.some((e) => e.column === 'other') && (
                  <p className="text-xs text-gray-600 mt-1">職位分布：{otherPositions(modal.entries.filter((e) => e.column === 'other'))}</p>
                )}
              </div>
              <button type="button" onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-800" aria-label="關閉">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-auto p-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    {['員編', '姓名', '門市', '職位', '階段', '月狀態', '備註'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modal.entries.map((e, i) => (
                    <tr key={`${e.key}-${e.store_id}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_code}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{`${e.store_code} ${e.store_name}`.trim()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.position || '（未填）'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.newbie_level || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.statusLabel}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                        {[e.crossStore ? '跨店' : '', e.isDual ? '雙' : '', e.supervisorActing ? '督導代理' : '', e.unknownStatus ? '狀態待確認' : '']
                          .filter(Boolean)
                          .join('、')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {modal.entries.length === 0 && <p className="text-center text-gray-500 py-6">沒有資料</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AreaRows({
  area,
  rowCells,
}: {
  area: AreaHeadcount;
  rowCells: (g: HeadcountGroup, scopeTitle: string) => JSX.Element;
}) {
  return (
    <>
      <tr className="bg-gray-100 font-semibold">
        <td className="px-3 py-2 sticky left-0 bg-gray-100 z-10 whitespace-nowrap">{area.name}　小計（{area.stores.length} 間）</td>
        {rowCells(area.subtotal, `${area.name} 小計`)}
      </tr>
      {area.stores.map((s) => (
        <tr key={s.store.id}>
          <td className="px-3 py-2 sticky left-0 bg-white z-10 whitespace-nowrap">{`${s.store.store_code} ${s.store.store_name}`.trim()}</td>
          {rowCells(s, `${s.store.store_code} ${s.store.store_name}`.trim())}
        </tr>
      ))}
    </>
  );
}
