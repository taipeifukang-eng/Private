'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, Pencil, Save, X } from 'lucide-react';

type PrescriptionRow = {
  store_id: string;
  store_code: string;
  store_name: string;
  regular_prescription_count: string;
  regular_prescription_point_value: string;
  chronic_prescription_count: string;
  chronic_prescription_point_value: string;
  total_chronic_prescription_count: number | null;
  prescription_data_updated_at: string | null;
};

type ApiRecord = Omit<PrescriptionRow,
  | 'regular_prescription_count'
  | 'regular_prescription_point_value'
  | 'chronic_prescription_count'
  | 'chronic_prescription_point_value'
  | 'total_chronic_prescription_count'
> & {
  regular_prescription_count: number | null;
  regular_prescription_point_value: number | null;
  chronic_prescription_count: number | null;
  chronic_prescription_point_value: number | null;
  total_chronic_prescription_count: number | string | null;
};

const FIELD_KEYS = [
  'regular_prescription_count',
  'regular_prescription_point_value',
  'chronic_prescription_count',
  'chronic_prescription_point_value',
] as const;

function rowSignature(row: PrescriptionRow) {
  return JSON.stringify(FIELD_KEYS.map(key => row[key]));
}

function stringValue(value: number | null) {
  return value === null || value === undefined ? '' : String(value);
}

function validCount(value: string) {
  return /^\d+$/.test(value.trim());
}

function validPointValue(value: string) {
  return /^\d+(\.\d{1,4})?$/.test(value.trim());
}

function calculatedTotal(row: PrescriptionRow): number | null {
  const regular = row.regular_prescription_count.trim();
  const chronic = row.chronic_prescription_count.trim();
  if (!validCount(regular) || !validCount(chronic)) return null;
  const roundedRegularQuarter = Math.round((Number(regular) / 4 + Number.EPSILON) * 10) / 10;
  return roundedRegularQuarter + Number(chronic);
}

export default function PrescriptionTab({
  canEdit,
  permissionLoading,
}: {
  canEdit: boolean;
  permissionLoading: boolean;
}) {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [rows, setRows] = useState<PrescriptionRow[]>([]);
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestSequence = useRef(0);
  const yearMonth = `${selectedYear}-${selectedMonth.padStart(2, '0')}`;
  const years = Array.from({ length: now.getFullYear() - 2018 + 3 }, (_, index) => 2018 + index);

  const loadData = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/prescription-monthly?year_month=${encodeURIComponent(yearMonth)}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || '讀取處方箋資料失敗');
      if (requestId !== requestSequence.current) return;

      const nextRows: PrescriptionRow[] = (json.records as ApiRecord[]).map(record => ({
        store_id: record.store_id,
        store_code: record.store_code,
        store_name: record.store_name,
        regular_prescription_count: stringValue(record.regular_prescription_count),
        regular_prescription_point_value: stringValue(record.regular_prescription_point_value),
        chronic_prescription_count: stringValue(record.chronic_prescription_count),
        chronic_prescription_point_value: stringValue(record.chronic_prescription_point_value),
        total_chronic_prescription_count: record.total_chronic_prescription_count === null
          ? null
          : Number(record.total_chronic_prescription_count),
        prescription_data_updated_at: record.prescription_data_updated_at,
      }));
      setRows(nextRows);
      setBaseline(Object.fromEntries(nextRows.map(row => [row.store_id, rowSignature(row)])));
    } catch (loadError: any) {
      if (requestId !== requestSequence.current) return;
      setRows([]);
      setBaseline({});
      setError(loadError.message || '讀取處方箋資料失敗');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => { void loadData(); }, [loadData]);

  const dirtyRows = useMemo(
    () => rows.filter(row => baseline[row.store_id] !== rowSignature(row)),
    [rows, baseline]
  );
  const completedCount = rows.filter(row =>
    FIELD_KEYS.every(key => row[key].trim() !== '')
      && validCount(row.regular_prescription_count)
      && validCount(row.chronic_prescription_count)
      && validPointValue(row.regular_prescription_point_value)
      && validPointValue(row.chronic_prescription_point_value)
  ).length;

  function updateField(storeId: string, field: typeof FIELD_KEYS[number], value: string) {
    setError('');
    setSuccess('');
    setRows(current => current.map(row => row.store_id === storeId ? { ...row, [field]: value } : row));
  }

  function changePeriod(nextYear: string, nextMonth: string) {
    if (nextYear === selectedYear && nextMonth === selectedMonth) return;
    if (dirtyRows.length > 0 && !window.confirm('目前有尚未儲存的處方箋資料，確定切換月份並放棄這些修改嗎？')) return;
    setSelectedYear(nextYear);
    setSelectedMonth(nextMonth);
  }

  async function cancelEditing() {
    if (dirtyRows.length > 0 && !window.confirm('放棄尚未儲存的處方箋修改？')) return;
    setIsEditing(false);
    if (dirtyRows.length > 0) await loadData();
  }

  async function saveChanges() {
    if (!canEdit || dirtyRows.length === 0 || saving) return;
    for (const row of dirtyRows) {
      if (row.regular_prescription_count && !validCount(row.regular_prescription_count)) {
        setError(`${row.store_code} ${row.store_name}：一般箋張數需為非負整數`);
        return;
      }
      if (row.chronic_prescription_count && !validCount(row.chronic_prescription_count)) {
        setError(`${row.store_code} ${row.store_name}：慢箋張數需為非負整數`);
        return;
      }
      if (row.regular_prescription_point_value && !validPointValue(row.regular_prescription_point_value)) {
        setError(`${row.store_code} ${row.store_name}：一般箋點值最多輸入小數四位`);
        return;
      }
      if (row.chronic_prescription_point_value && !validPointValue(row.chronic_prescription_point_value)) {
        setError(`${row.store_code} ${row.store_name}：慢箋點值最多輸入小數四位`);
        return;
      }
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/prescription-monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          records: dirtyRows.map(row => ({
            store_id: row.store_id,
            regular_prescription_count: row.regular_prescription_count || null,
            regular_prescription_point_value: row.regular_prescription_point_value || null,
            chronic_prescription_count: row.chronic_prescription_count || null,
            chronic_prescription_point_value: row.chronic_prescription_point_value || null,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || '儲存失敗');
      await loadData();
      setIsEditing(false);
      setSuccess(`已儲存 ${json.saved} 間門市`);
    } catch (saveError: any) {
      setError(saveError.message || '儲存處方箋資料失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">處方箋月報</h2>
          <p className="mt-1 text-sm text-slate-600">各門市處方箋張數與點值</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} />年</span>
              <select
                value={selectedYear}
                onChange={event => changePeriod(event.target.value, selectedMonth)}
                disabled={saving}
                className="h-10 min-w-[112px] rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                aria-label="選擇處方箋年份"
              >
                {years.map(year => <option key={year} value={year}>{year} 年</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-700">
              <span>月</span>
              <select
                value={selectedMonth}
                onChange={event => changePeriod(selectedYear, event.target.value)}
                disabled={saving}
                className="h-10 min-w-[92px] rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                aria-label="選擇處方箋月份"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(month => (
                  <option key={month} value={month}>{month} 月</option>
                ))}
              </select>
            </label>
          </div>
          {canEdit && !permissionLoading && (
            isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={loading || saving}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={16} />取消
                </button>
                <button
                  type="button"
                  onClick={saveChanges}
                  disabled={loading || saving || dirtyRows.length === 0}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save size={16} />
                  {saving ? '儲存中…' : dirtyRows.length ? `儲存變更（${dirtyRows.length}）` : '儲存變更'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Pencil size={16} />輸入／編輯處方資料
              </button>
            )
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          總慢箋張數 = 一般箋張數 ÷ 4（四捨五入至小數第 1 位）+ 慢箋張數
        </p>
        <p className="text-slate-600" aria-live="polite">
          {loading ? '讀取中…' : `已完成 ${completedCount} / ${rows.length} 間`}
          {permissionLoading ? ' · 正在確認編輯權限' : canEdit ? isEditing ? ' · 編輯中' : ' · 可編輯' : ' · 唯讀'}
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}
      {success && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <Check size={16} />{success}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-600">
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-[190px] border-b border-slate-200 bg-slate-50 px-4 py-3">門市</th>
                <th scope="col" className="min-w-[165px] border-b border-slate-200 px-3 py-3">一般箋張數</th>
                <th scope="col" className="min-w-[165px] border-b border-slate-200 px-3 py-3">一般箋點值</th>
                <th scope="col" className="min-w-[165px] border-b border-slate-200 px-3 py-3">慢箋張數</th>
                <th scope="col" className="min-w-[165px] border-b border-slate-200 px-3 py-3">慢箋點值</th>
                <th scope="col" className="min-w-[150px] border-b border-slate-200 px-3 py-3">總慢箋張數</th>
                <th scope="col" className="min-w-[105px] border-b border-slate-200 px-3 py-3">資料狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">正在載入門市資料…</td></tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">目前沒有可查看的門市，請確認帳號的門市指派</td></tr>
              )}
              {!loading && rows.map(row => {
                const isDirty = baseline[row.store_id] !== rowSignature(row);
                const total = isDirty ? calculatedTotal(row) : row.total_chronic_prescription_count;
                const hasValues = FIELD_KEYS.some(key => row[key].trim() !== '');
                const complete = FIELD_KEYS.every(key => row[key].trim() !== '')
                  && validCount(row.regular_prescription_count)
                  && validCount(row.chronic_prescription_count)
                  && validPointValue(row.regular_prescription_point_value)
                  && validPointValue(row.chronic_prescription_point_value);
                const invalid = (row.regular_prescription_count && !validCount(row.regular_prescription_count))
                  || (row.chronic_prescription_count && !validCount(row.chronic_prescription_count))
                  || (row.regular_prescription_point_value && !validPointValue(row.regular_prescription_point_value))
                  || (row.chronic_prescription_point_value && !validPointValue(row.chronic_prescription_point_value));

                return (
                  <tr key={row.store_id} className="hover:bg-slate-50/70">
                    <th scope="row" className="sticky left-0 z-[1] bg-white px-4 py-3 text-left font-medium text-slate-900">
                      <span className="block">{row.store_name}</span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">{row.store_code}</span>
                    </th>
                    {FIELD_KEYS.map((field, index) => (
                      <td key={field} className="px-3 py-2">
                        {isEditing && canEdit && !permissionLoading ? (
                          <input
                            type="text"
                            inputMode={index === 0 || index === 2 ? 'numeric' : 'decimal'}
                            value={row[field]}
                            onChange={event => updateField(row.store_id, field, event.target.value)}
                            disabled={saving}
                            aria-label={`${row.store_name} ${['一般箋張數', '一般箋點值', '慢箋張數', '慢箋點值'][index]}`}
                            placeholder="未填"
                            className="h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-right text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-wait disabled:bg-slate-50"
                          />
                        ) : (
                          <span className="block px-2.5 text-right tabular-nums text-slate-700">
                            {row[field] || <span className="text-slate-400">未填</span>}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {total === null ? '—' : total.toFixed(1)}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium ${invalid ? 'text-red-700' : complete ? 'text-emerald-700' : hasValues ? 'text-amber-700' : 'text-slate-500'}`}>
                        {invalid ? '格式錯誤' : complete ? '已完成' : hasValues ? '部分填寫' : '未填'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && rows.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          點值最多四位小數。{canEdit
            ? isEditing
              ? '在各門市列輸入四項資料，再按「儲存變更」；張數會同步至月度門市統計。'
              : '按「輸入／編輯處方資料」開始登錄；張數會同步至月度門市統計。'
            : permissionLoading
              ? '正在確認帳號的編輯權限。'
              : '目前是唯讀；需由管理者開啟「編輯業績資料」權限後才能輸入。'}
        </p>
      )}
    </main>
  );
}
