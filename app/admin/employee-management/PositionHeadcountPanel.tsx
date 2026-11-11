'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  HEADCOUNT_COLUMNS,
  buildHeadcountExportRows,
  computeHeadcountTrend,
  computeMonthHeadcount,
  excludedReasonLabel,
  FRANCHISE_FILTER_LABELS,
  buildFilterSheetRows,
  franchiseTotalLabel,
  headcountExportFileName,
  nextFranchiseFilter,
  summarySheetColumnWidths,
  unfinalizedStoresForMonth,
  type AreaHeadcount,
  type ColumnKey,
  type FranchiseFilter,
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

/** 表格容器：可內部垂直捲動（約視窗高度減上方區塊），標題列用 sticky 固定 */
const SCROLL_BOX = 'bg-white rounded-lg shadow overflow-auto max-h-[calc(100vh-18rem)] min-h-[16rem]';
/** 標題儲存格：背景不透明、底線用 inset 陰影（不增加列高，第二列 top 才會剛好等於第一列高度） */
const TH = 'bg-gray-50 shadow-[inset_0_-1px_0_0_#e5e7eb]';
/** 第一列（群組列）高度；第二列 sticky top 必須等於它 */
const GROUP_ROW_H = 28;

interface ListModal {
  title: string;
  entries: HeadcountEntry[];
  /** 不計入名單：多顯示「不計入原因」欄 */
  showReason?: boolean;
}

export default function PositionHeadcountPanel() {
  const [month, setMonth] = useState(currentMonthTaipei());
  const [view, setView] = useState<'month' | 'trend'>('month');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<PositionHeadcountPayload | null>(null);
  const [franchise, setFranchise] = useState<FranchiseFilter>('all');
  const [modal, setModal] = useState<ListModal | null>(null);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/admin/position-headcount?month=${month}${view === 'trend' ? '&trend=1' : ''}&franchise=${franchise}`)
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
  }, [month, view, franchise]);

  const result = useMemo(
    () => (payload && payload.yearMonth === month && payload.franchise === franchise ? computeMonthHeadcount(payload.records, payload.stores, month, franchise) : null),
    [payload, month, franchise],
  );
  const trend = useMemo(
    () => (payload && payload.yearMonth === month && payload.franchise === franchise && payload.trend ? computeHeadcountTrend(payload.records, payload.stores, month, 12, franchise) : null),
    [payload, month, franchise],
  );

  const openList = (title: string, entries: HeadcountEntry[], showReason = false) => setModal({ title, entries, showReason });
  const excludedByStore = useMemo(() => {
    const m = new Map<string, HeadcountEntry[]>();
    (result?.excluded ?? []).forEach((e) => {
      const arr = m.get(e.store_id) ?? [];
      arr.push(e);
      m.set(e.store_id, arr);
    });
    return m;
  }, [result]);

  const handleExport = () => {
    if (!result) return;
    const { summaryRows, detailRows } = buildHeadcountExportRows(result, franchise);
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.json_to_sheet(summaryRows);
    s1['!cols'] = summarySheetColumnWidths(Object.keys(summaryRows[0] ?? {}));
    const s2 = XLSX.utils.json_to_sheet(detailRows);
    s2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 8 }, { wch: 22 }, { wch: 12 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, s1, '人數統計');
    XLSX.utils.book_append_sheet(wb, s2, '人員明細');
    const filterRows = buildFilterSheetRows(franchise, month);
    if (filterRows) {
      const s0 = XLSX.utils.aoa_to_sheet(filterRows);
      s0['!cols'] = [{ wch: 12 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, s0, '篩選條件');
    }
    XLSX.writeFile(wb, headcountExportFileName(month, franchise));
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
        {col === 'acting' && g.rotationActing.length > 0 && (
          <button
            type="button"
            onClick={() => openList(`${scopeTitle}｜督導卡班代理（${g.rotationActing.length} 位，不計入人數）`, g.rotationActing)}
            className="block mx-auto text-xs text-purple-700 hover:underline"
          >
            督導卡班代理 {g.rotationActing.length} 位
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
          <button
            type="button"
            data-testid="headcount-franchise-btn"
            onClick={() => setFranchise(nextFranchiseFilter(franchise))}
            title="點一下切換：全部 → 只看加盟店 → 不含加盟店"
            className={`px-4 py-2 rounded-lg border text-sm font-medium ${
              franchise === 'all'
                ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                : franchise === 'only'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-teal-600 text-white border-teal-600'
            }`}
          >
            加盟店：{FRANCHISE_FILTER_LABELS[franchise]}
          </button>
          {loading && <span className="text-sm text-gray-500">讀取中…</span>}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-semibold"
        >
          <Download size={18} />
          匯出 Excel（{month}{franchise === 'all' ? '' : `・${FRANCHISE_FILTER_LABELS[franchise]}`}）
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
            只統計「月底仍在職」的人（不含當月離職、留職停薪、調出、支援卡班，也不含督導卡班）。同一人同月在兩間以上門市都有登記時，只算在一間「主要歸屬門市」
            （依序：該月是代理店長的那間 → 他自己督導區的門市 → 非雙店長／雙職 → 職等較高 → 門市代號較小），其他門市的登記列入「不計入」，原因寫「已計入○○」。
            所以各門市加總 = 督導區小計、各督導區小計加總 = 全公司合計。點任一數字可看名單。
            {franchise !== 'all' && (
              <span data-testid="headcount-franchise-note" className="block mt-1 text-orange-700">
                目前只顯示「{franchise === 'only' ? '加盟店' : '直營店'}」：先用全部門市決定每人的主要歸屬與不計入原因，再依每筆登記所在的門市篩選。
                主要歸屬在{franchise === 'only' ? '直營' : '加盟'}店的人不計入人數，但他在{franchise === 'only' ? '加盟' : '直營'}店的登記仍會出現在該店的不計入名單（原因寫「已計入○○店」）。
                合計列、督導區小計與匯出都只算留下的門市（整區都被篩掉的督導區不顯示）。「只看加盟店」加「不含加盟店」等於「全部」。
              </span>
            )}
          </p>
          {result.excluded.length > 0 && (
            <div>
              <button
                type="button"
                data-testid="headcount-excluded-btn"
                onClick={() => openList(`不計入名單（${result.excluded.length} 人）`, result.excluded, true)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                不計入 {result.excluded.length} 人
              </button>
            </div>
          )}
          <div className={SCROLL_BOX} data-testid="headcount-month-scroll">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead className="text-gray-700">
                <tr>
                  <th rowSpan={2} className={`${TH} px-3 py-2 text-left sticky left-0 top-0 z-30 whitespace-nowrap`}>門市</th>
                  {groupHeads.map((g) => (
                    <th key={g.label} colSpan={g.span} style={{ height: GROUP_ROW_H }} className={`${TH} px-3 py-1 text-center border-l border-gray-200 sticky top-0 z-20`}>{g.label}</th>
                  ))}
                  <th rowSpan={2} className={`${TH} px-3 py-2 text-center border-l border-gray-200 whitespace-nowrap sticky top-0 z-20`}>總人數</th>
                </tr>
                <tr>
                  {HEADCOUNT_COLUMNS.map((c) => (
                    <th key={c.key} style={{ top: GROUP_ROW_H, height: GROUP_ROW_H }} className={`${TH} px-3 py-1 text-center font-medium whitespace-nowrap sticky z-20`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr>td]:border-b [&>tr>td]:border-gray-100">
                <tr className="bg-blue-50 font-semibold">
                  <td className="px-3 py-2 sticky left-0 bg-blue-50 z-10 whitespace-nowrap">{franchiseTotalLabel(franchise)}</td>
                  {rowCells(result.company, franchiseTotalLabel(franchise))}
                </tr>
                {result.areas.map((a) => (
                  <AreaRows key={a.key} area={a} rowCells={rowCells} excludedByStore={excludedByStore} onOpenExcluded={(t, e) => openList(t, e, true)} />
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
          <p className="text-sm text-gray-600">{franchise === 'all' ? '全公司' : franchise === 'only' ? '加盟店' : '直營店'}近 12 個月（到 {month} 為止）每月各欄人數（不含督導卡班），跨店的人只算在主要歸屬門市，口徑同全公司合計。沒有資料的月份顯示「—」。{franchise !== 'all' && '趨勢依門市目前的加盟／直營設定歸類。'}</p>
          <div className={SCROLL_BOX} data-testid="headcount-trend-scroll">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead className="text-gray-700">
                <tr>
                  <th className={`${TH} px-3 py-2 text-left sticky left-0 top-0 z-30 whitespace-nowrap`}>月份</th>
                  {HEADCOUNT_COLUMNS.map((c) => (
                    <th key={c.key} className={`${TH} px-3 py-2 text-center whitespace-nowrap sticky top-0 z-20`}>{c.label}</th>
                  ))}
                  <th className={`${TH} px-3 py-2 text-center whitespace-nowrap sticky top-0 z-20`}>其中督導代理</th>
                  <th className={`${TH} px-3 py-2 text-center whitespace-nowrap sticky top-0 z-20`}>督導卡班代理（不計入）</th>
                  <th className={`${TH} px-3 py-2 text-center whitespace-nowrap sticky top-0 z-20`}>總人數</th>
                </tr>
              </thead>
              <tbody className="[&>tr>td]:border-b [&>tr>td]:border-gray-100">
                {trend.map((t) => (
                  <tr key={t.yearMonth}>
                    <td className="px-3 py-2 sticky left-0 bg-white z-10 whitespace-nowrap font-medium">{t.yearMonth}</td>
                    {HEADCOUNT_COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-center">{t.hasData ? t.counts[c.key] : '—'}</td>
                    ))}
                    <td className="px-3 py-2 text-center">{t.hasData ? t.actingBySupervisor : '—'}</td>
                    <td className="px-3 py-2 text-center">{t.hasData ? t.rotationActing : '—'}</td>
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
            <div className="overflow-auto px-4 pb-4">
              <table className="min-w-full text-sm border-separate border-spacing-0">
                <thead className="text-gray-700">
                  <tr>
                    {(modal.showReason ? ['門市', '員編', '姓名', '職位', '月狀態', '不計入原因'] : ['員編', '姓名', '門市', '職位', '階段', '月狀態', '備註']).map((h) => (
                      <th key={h} className={`${TH} px-3 py-2 text-left whitespace-nowrap sticky top-0 z-20`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:border-b [&>tr>td]:border-gray-100">
                  {modal.entries.map((e, i) => (
                    modal.showReason ? (
                    <tr key={`${e.key}-${e.store_id}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{`${e.store_code} ${e.store_name}`.trim()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_code}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.position || '（未填）'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.statusLabel}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{excludedReasonLabel(e)}</td>
                    </tr>
                    ) : (
                    <tr key={`${e.key}-${e.store_id}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_code}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.employee_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{`${e.store_code} ${e.store_name}`.trim()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.position || '（未填）'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.newbie_level || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.statusLabel}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                        {[e.crossStore ? (e.crossStoreNote ? `跨店，${e.crossStoreNote}` : '跨店') : '', e.isDual ? '雙' : '', e.supervisorActing ? '督導代理' : '', e.isRotation ? '督導卡班（不計入）' : '', e.rotationActing ? '卡班代理店長' : '', e.unknownStatus ? '狀態待確認' : '']
                          .filter(Boolean)
                          .join('、')}
                      </td>
                    </tr>
                    )
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
  excludedByStore,
  onOpenExcluded,
}: {
  area: AreaHeadcount;
  rowCells: (g: HeadcountGroup, scopeTitle: string) => JSX.Element;
  excludedByStore: Map<string, HeadcountEntry[]>;
  onOpenExcluded: (title: string, entries: HeadcountEntry[]) => void;
}) {
  return (
    <>
      <tr className="bg-gray-100 font-semibold">
        <td className="px-3 py-2 sticky left-0 bg-gray-100 z-10 whitespace-nowrap">{area.name}　小計（{area.stores.length} 間）</td>
        {rowCells(area.subtotal, `${area.name} 小計`)}
      </tr>
      {area.stores.map((s) => (
        <tr key={s.store.id}>
          <td className="px-3 py-2 sticky left-0 bg-white z-10 whitespace-nowrap">
            {`${s.store.store_code} ${s.store.store_name}`.trim()}
            {(excludedByStore.get(s.store.id)?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => onOpenExcluded(`${`${s.store.store_code} ${s.store.store_name}`.trim()}｜不計入名單`, excludedByStore.get(s.store.id)!)}
                className="ml-2 text-xs text-gray-500 hover:underline"
              >
                不計入 {excludedByStore.get(s.store.id)!.length}
              </button>
            )}
          </td>
          {rowCells(s, `${s.store.store_code} ${s.store.store_name}`.trim())}
        </tr>
      ))}
    </>
  );
}
