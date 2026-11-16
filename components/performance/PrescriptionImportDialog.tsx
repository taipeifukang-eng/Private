'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, X } from 'lucide-react';
import type { ImportPlan, Money, PreviewRow, StoreLite } from '@/lib/performance/prescription-import';

type Props = {
  file: File;
  yearMonth: string;
  plan: ImportPlan;
  stores: StoreLite[];
  onClose: () => void;
  onImported: (message: string) => void | Promise<void>;
};

function fmt(value: number | null) {
  return value === null || value === undefined ? '—' : value.toLocaleString('zh-TW');
}

function money(m: Money) {
  return <><span>{fmt(m.count)}</span><span className="text-slate-400"> 張 / </span><span>{fmt(m.points)}</span></>;
}

/** 上傳後的預覽：列出對應結果、加總核對、待選門市；全部確認後才寫入。 */
export default function PrescriptionImportDialog({ file, yearMonth, plan: initialPlan, stores, onClose, onImported }: Props) {
  const [plan, setPlan] = useState(initialPlan);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byCode = plan.hasCodeColumn;

  async function request(mode: 'preview' | 'commit', chosen: Record<string, string>) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('year_month', yearMonth);
    formData.append('mode', mode);
    formData.append('selections', JSON.stringify(chosen));
    const response = await fetch('/api/prescription-monthly/import', { method: 'POST', body: formData });
    const json = await response.json();
    return { response, json };
  }

  // 選了門市之後，請伺服端重算一次預覽（檢查是否選到重複門市等）
  useEffect(() => {
    if (Object.keys(selections).length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { response, json } = await request('preview', selections);
        if (!cancelled && response.ok && json.plan) setPlan(json.plan);
      } catch { /* 預覽重算失敗不影響已顯示的內容，確認匯入時伺服端會再驗證 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  const pending = plan.rows.filter(row => !row.store);
  const mismatchRows = plan.rows.filter(row => row.mismatches.length > 0);
  const errorRows = plan.rows.filter(row => row.errors.length > 0);
  const canConfirm = plan.rows.length > 0 && pending.length === 0 && errorRows.length === 0 && !busy;

  const sortedStores = useMemo(() => [...stores].sort((a, b) => a.store_code.localeCompare(b.store_code)), [stores]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const { response, json } = await request('commit', selections);
      if (!response.ok || !json.success) {
        const details = Array.isArray(json.errors) ? json.errors.join('\n') : '';
        throw new Error([json.error || '匯入失敗', details].filter(Boolean).join('\n'));
      }
      const notes = [
        json.saved_aliases ? `已把 ${json.saved_aliases} 個簡稱存進對照表` : '',
        json.mismatch_count ? `${json.mismatch_count} 間門市的加總與表上不符（已照實匯入）` : '',
      ].filter(Boolean).join('；');
      await onImported(`已匯入 ${json.imported} 間門市的 ${yearMonth} 處方箋資料${notes ? `（${notes}）` : ''}`);
    } catch (e: any) {
      setError(e.message || '匯入失敗');
    } finally {
      setBusy(false);
    }
  }

  function rowTone(row: PreviewRow) {
    if (row.errors.length > 0) return 'bg-red-50';
    if (!row.store) return 'bg-sky-50';
    if (row.mismatches.length > 0) return 'bg-yellow-100';
    return '';
  }

  function statusText(row: PreviewRow) {
    switch (row.status) {
      case 'mapped': return '對照表';
      case 'auto': return '自動對上';
      case 'matched': return '你選的';
      case 'coded': return '門市代號';
      case 'ambiguous': return '有多家可能，請選擇';
      case 'unknown': return '找不到，請選擇';
      default: return '需修正';
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="rx-import-title">
      <div className="w-full max-w-6xl rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 id="rx-import-title" className="text-base font-semibold text-slate-900">匯入預覽：{yearMonth} 處方箋</h3>
            <p className="mt-1 text-sm text-slate-600">
              {byCode
                ? `檔案：${file.name}（本月範本，以門市代號對門市，讀取工作表「${plan.sheetName}」的「${plan.monthLabel}」那一組）。確認前不會寫入任何資料。`
                : `檔案：${file.name}（Google Sheet 格式，讀取工作表「${plan.sheetName}」的「${plan.monthLabel}」那一組，店別簡稱對照門市）。確認前不會寫入任何資料。`}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="關閉預覽" className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap gap-2 text-sm" aria-live="polite">
            <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">共 {plan.rows.length} 間</span>
            <span className={`rounded px-2 py-1 ${pending.length ? 'bg-sky-100 text-sky-900' : 'bg-emerald-50 text-emerald-800'}`}>待選門市 {pending.length}</span>
            <span className={`rounded px-2 py-1 ${mismatchRows.length ? 'bg-yellow-200 text-yellow-900' : 'bg-emerald-50 text-emerald-800'}`}>加總不符 {mismatchRows.length}</span>
            {errorRows.length > 0 && <span className="rounded bg-red-100 px-2 py-1 text-red-800">有錯誤 {errorRows.length}</span>}
          </div>

          {mismatchRows.length > 0 && (
            <p className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              標黃的門市：表上「一般＋連續」和「加總」那一列對不起來。這只是提醒，仍可匯入，匯入的是一般與連續兩列的數字（加總列不寫入）。
            </p>
          )}
          {pending.length > 0 && (
            <p className="flex items-start gap-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              藍底的店別系統對不上門市，請在右側選擇對應的門市。確認匯入時會記住你的選擇，下次同一個簡稱就會自動對上。
            </p>
          )}
          {plan.ignoredLabels.length > 0 && (
            <p className="text-xs text-slate-500">已略過總計用的列：{plan.ignoredLabels.join('、')}</p>
          )}

          <div className="max-h-[52vh] overflow-auto rounded border border-slate-200">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-600">
                <tr>
                  <th className="px-3 py-2">{byCode ? '店別' : '簡稱'}</th>
                  <th className="px-3 py-2">對應門市</th>
                  <th className="px-3 py-2 text-right">一般箋（張數／點值）</th>
                  <th className="px-3 py-2 text-right">慢箋（張數／點值）</th>
                  <th className="px-3 py-2">加總核對</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map(row => (
                  <tr key={`${row.key}-${row.rowNo}`} className={`border-t border-slate-100 align-top ${rowTone(row)}`} data-status={row.status} data-testid="rx-preview-row">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{row.label}</div>
                      <div className="text-xs text-slate-500">第 {row.rowNo} 列</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.store && row.status !== 'ambiguous' && row.status !== 'unknown' ? (
                        <div>
                          <div className="text-slate-900">{row.store.store_code} {row.store.store_name}</div>
                          <div className="text-xs text-slate-500">{statusText(row)}</div>
                        </div>
                      ) : (
                        <div>
                          <select
                            aria-label={`${row.label} 對應的門市`}
                            value={selections[row.key] || ''}
                            onChange={event => setSelections(prev => {
                              const next = { ...prev };
                              if (event.target.value) next[row.key] = event.target.value; else delete next[row.key];
                              return next;
                            })}
                            className="h-9 w-full min-w-[200px] rounded border border-slate-300 bg-white px-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                          >
                            <option value="">請選擇門市…</option>
                            {(row.candidates.length > 0 ? row.candidates : sortedStores).map(store => (
                              <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                            ))}
                            {row.candidates.length > 0 && <option disabled>────────</option>}
                            {row.candidates.length > 0 && sortedStores.filter(s => !row.candidates.some(c => c.id === s.id)).map(store => (
                              <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-sky-800">{statusText(row)}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.regular)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.chronic)}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.errors.length > 0 ? (
                        <ul className="space-y-0.5 text-red-700">{row.errors.map(e => <li key={e}>{e}</li>)}</ul>
                      ) : row.mismatches.length > 0 ? (
                        <ul className="space-y-0.5 text-yellow-900">{row.mismatches.map(m => <li key={m}>{m}</li>)}</ul>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={13} />相符</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500">表上沒有出現的門市不會被更動；匯入是整批一起成功或一起取消。</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button>
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm}
              className="h-10 rounded-md border border-orange-700 bg-orange-700 px-4 text-sm font-medium text-white hover:bg-orange-800 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
            >
              {busy ? '匯入中…' : pending.length > 0 ? `還有 ${pending.length} 間未選門市` : `確認匯入 ${plan.rows.length} 間`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
