'use client';

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import PharmacistAnnualFeeModal from './PharmacistAnnualFeeModal';

const SCHOOL_OPTIONS = [
  '國立臺灣大學',
  '臺北醫學大學',
  '國防醫學院',
  '中國醫藥大學',
  '國立成功大學',
  '高雄醫學大學',
  '嘉南藥理大學',
  '大仁科技大學',
  '國立陽明交通大學',
  '慈濟大學',
] as const;

const EDUCATION_LEVEL_OPTIONS = ['博士', '碩士', '學士'] as const;

const STATUS_LABELS: Record<string, string> = {
  active: '在職',
  resigned: '離職',
  suspended: '留停',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  resigned: 'bg-gray-100 text-gray-600',
  suspended: 'bg-amber-100 text-amber-700',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: '手動',
};

type ManualAddFormState = {
  employee_code: string;
  employee_name: string;
  join_date: string;
  current_position: string;
  notes: string;
};

export type PharmacistMasterRow = {
  employee_code: string;
  employee_name: string;
  current_position: string;
  start_date: string | null;
  resignation_date: string | null;
  is_active: boolean;
  status?: string;
  status_date?: string | null;
  school: string;
  education_level: string;
  is_responsible_pharmacist: boolean;
  license_renewal_date: string | null;
  annual_fee_is_blue: boolean;
  store_code?: string;
  store_name?: string;
  source?: string;
  notes?: string;
};

function calcSeniority(startDate: string | null, endDate?: string | null): string {
  if (!startDate) return '-';
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  if (end.getDate() < start.getDate()) {
    months -= 1;
  }
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return '-';
  if (years === 0) return `${months} 個月`;
  if (months === 0) return `${years} 年`;
  return `${years} 年 ${months} 個月`;
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  return d.slice(0, 10);
}

function isGeneratedManualCode(code: string, source?: string): boolean {
  return source === 'manual' && code.startsWith('MANUAL');
}

type LockInfo = {
  year: number;
  locked_at: string;
  locked_by: string;
} | null;

export default function PharmacistMasterList({
  rows: initialRows,
  canEdit,
  initialYear,
}: {
  rows: PharmacistMasterRow[];
  canEdit: boolean;
  initialYear?: number;
}) {
  const currentYear = new Date().getFullYear();
  
  // 年度選擇（預設當前年度）
  const [selectedYear, setSelectedYear] = useState(initialYear || currentYear);
  const [data, setData] = useState<PharmacistMasterRow[]>(initialRows);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockInfo, setLockInfo] = useState<LockInfo>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<PharmacistMasterRow>>({});
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive' | 'suspended'>('active');
  const [feeModalRow, setFeeModalRow] = useState<{ code: string; name: string } | null>(null);
  const [manualForm, setManualForm] = useState<ManualAddFormState>({
    employee_code: '',
    employee_name: '',
    join_date: '',
    current_position: '藥師',
    notes: '',
  });
  const [manualAddError, setManualAddError] = useState('');
  const [manualAddSuccess, setManualAddSuccess] = useState('');
  const [isManualAdding, setIsManualAdding] = useState(false);

  // 載入年度主檔資料
  const loadYearData = useCallback(async (year: number) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/pharmacist-annual-master/sync?year=${year}`);
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.error || '載入失敗');
        return;
      }
      setData(json.data || []);
      setIsLocked(json.isLocked || false);
      setLockInfo(json.lockInfo || null);
      setSyncedAt(json.syncedAt || null);
    } catch {
      setLoadError('網路錯誤，請重試');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初始載入與切換年度時載入資料
  useEffect(() => {
    loadYearData(selectedYear);
  }, [selectedYear, loadYearData]);

  // 關帳
  const handleLock = async () => {
    if (!confirm(`確定要關帳 ${selectedYear} 年度藥師主檔嗎？\n關帳後將不再自動同步人事異動。`)) {
      return;
    }
    setLockLoading(true);
    setLockError(null);
    try {
      const res = await fetch('/api/pharmacist-annual-master/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: selectedYear }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLockError(json.error || '關帳失敗');
      } else {
        await loadYearData(selectedYear);
      }
    } catch {
      setLockError('網路錯誤，請重試');
    } finally {
      setLockLoading(false);
    }
  };

  // 解除關帳
  const handleUnlock = async () => {
    if (!confirm(`確定要解除 ${selectedYear} 年度藥師主檔的關帳嗎？`)) {
      return;
    }
    setLockLoading(true);
    setLockError(null);
    try {
      const res = await fetch('/api/pharmacist-annual-master/lock', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: selectedYear }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLockError(json.error || '解除關帳失敗');
      } else {
        await loadYearData(selectedYear);
      }
    } catch {
      setLockError('網路錯誤，請重試');
    } finally {
      setLockLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const rows = data.filter((row) => {
      const status = row.status || (row.is_active ? 'active' : 'resigned');
      if (filterActive === 'active' && status !== 'active') return false;
      if (filterActive === 'inactive' && status !== 'resigned') return false;
      if (filterActive === 'suspended' && status !== 'suspended') return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return (
          row.employee_code.toLowerCase().includes(q) ||
          row.employee_name.toLowerCase().includes(q)
        );
      }
      return true;
    });

    rows.sort((a, b) => {
      const manualDiff = Number(b.source === 'manual') - Number(a.source === 'manual');
      if (manualDiff !== 0) return manualDiff;
      return a.employee_code.localeCompare(b.employee_code);
    });

    return rows;
  }, [data, searchText, filterActive]);

  function startEdit(row: PharmacistMasterRow) {
    setEditingCode(row.employee_code);
    setDraft({
      school: row.school,
      education_level: row.education_level,
      is_responsible_pharmacist: row.is_responsible_pharmacist,
      license_renewal_date: row.license_renewal_date || '',
    });
    setSaveError('');
  }

  function cancelEdit() {
    setEditingCode(null);
    setDraft({});
    setSaveError('');
  }

  function saveEdit(code: string) {
    startTransition(async () => {
      try {
        const res = await fetch('/api/pharmacist-profiles', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_code: code,
            school: draft.school ?? '',
            education_level: draft.education_level ?? '',
            is_responsible_pharmacist: draft.is_responsible_pharmacist ?? false,
            license_renewal_date: (draft.license_renewal_date as string) || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          const msg = err.error || '儲存失敗';
          setSaveError(msg);
          window.alert(msg);
          return;
        }
        setData((prev) =>
          prev.map((r) =>
            r.employee_code === code
              ? {
                  ...r,
                  school: (draft.school as string) ?? r.school,
                  education_level: (draft.education_level as string) ?? r.education_level,
                  is_responsible_pharmacist: draft.is_responsible_pharmacist ?? r.is_responsible_pharmacist,
                  license_renewal_date: (draft.license_renewal_date as string) || r.license_renewal_date,
                }
              : r
          )
        );
        setEditingCode(null);
        setDraft({});
      } catch {
        setSaveError('網路錯誤，請稍後再試');
      }
    });
  }

  async function handleManualAdd() {
    if (!manualForm.employee_name.trim() || !manualForm.join_date.trim()) {
      setManualAddError('姓名、到職日為必填');
      setManualAddSuccess('');
      return;
    }

    setIsManualAdding(true);
    setManualAddError('');
    setManualAddSuccess('');

    try {
      const res = await fetch('/api/pharmacist-annual-master/manual-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          employee_code: manualForm.employee_code.trim().toUpperCase(),
          employee_name: manualForm.employee_name.trim(),
          join_date: manualForm.join_date,
          current_position: manualForm.current_position.trim() || '藥師',
          notes: manualForm.notes.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setManualAddError(json.error || '新增失敗');
        return;
      }

      setManualForm({
        employee_code: '',
        employee_name: '',
        join_date: '',
        current_position: '藥師',
        notes: '',
      });
      setManualAddSuccess(`已加入 ${json.data?.employee_code || ''}`.trim());
      await loadYearData(selectedYear);
    } catch {
      setManualAddError('網路錯誤，請稍後再試');
    } finally {
      setIsManualAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 年度選擇 + 關帳控制 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">年度</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              disabled={isLoading}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
            >
              {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((y) => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            {canEdit && (
              isLocked ? (
                <button
                  type="button"
                  onClick={handleUnlock}
                  disabled={lockLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  <span>🔒</span>
                  <span>{lockLoading ? '處理中…' : '已關帳（點擊解除）'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLock}
                  disabled={lockLoading || selectedYear > currentYear}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  <span>🔓</span>
                  <span>{lockLoading ? '處理中…' : '關帳'}</span>
                </button>
              )
            )}
            {isLocked && lockInfo && (
              <p className="text-xs text-gray-500">
                由 {lockInfo.locked_by} 關帳於 {lockInfo.locked_at.slice(0, 10)}
              </p>
            )}
            {lockError && (
              <p className="text-xs text-red-600">{lockError}</p>
            )}
          </div>

          {syncedAt && !isLocked && (
            <p className="text-xs text-green-600">
              已自動同步人事異動（{syncedAt.slice(0, 10)}）
            </p>
          )}

          {isLoading && (
            <span className="text-sm text-gray-500">載入中...</span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {canEdit && !isLocked && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-blue-900">手動加入藥師主檔</h3>
              <p className="text-xs text-blue-700">適用於年度主檔未自動帶入的人員，新增後會標示為「手動」。</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <input
              type="text"
              placeholder="員編，可留空"
              value={manualForm.employee_code}
              onChange={(e) => setManualForm((prev) => ({ ...prev, employee_code: e.target.value.toUpperCase() }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="姓名"
              value={manualForm.employee_name}
              onChange={(e) => setManualForm((prev) => ({ ...prev, employee_name: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="date"
              value={manualForm.join_date}
              onChange={(e) => setManualForm((prev) => ({ ...prev, join_date: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="現職職級，預設藥師"
              value={manualForm.current_position}
              onChange={(e) => setManualForm((prev) => ({ ...prev, current_position: e.target.value }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleManualAdd}
              disabled={isManualAdding}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isManualAdding ? '新增中…' : `加入 ${selectedYear} 主檔`}
            </button>
          </div>
          <div className="mt-3">
            <input
              type="text"
              placeholder="備註，可留空"
              value={manualForm.notes}
              onChange={(e) => setManualForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          {manualAddError && (
            <p className="mt-2 text-sm text-rose-600">{manualAddError}</p>
          )}
          {manualAddSuccess && (
            <p className="mt-2 text-sm text-green-700">{manualAddSuccess}</p>
          )}
        </div>
      )}

      {/* 搜尋 + 篩選列 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <input
          type="text"
          placeholder="搜尋員編 / 姓名"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div className="flex gap-1">
          {(['active', 'suspended', 'inactive', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilterActive(v)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterActive === v
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v === 'active' ? '在職' : v === 'inactive' ? '已離職' : v === 'suspended' ? '留停' : '全部'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-500">共 {filtered.length} 筆</span>
      </div>

      {/* 主表格 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">員編</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">姓名</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">狀態</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">現職職級</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">到職日 / 年資</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">畢業學校</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">學歷</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">負責藥師</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">執照更新日</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">常年會費</th>
              {canEdit && !isLocked && <th className="px-3 py-3 text-center font-semibold">操作</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canEdit && !isLocked ? 11 : 10} className="px-3 py-10 text-center text-gray-500">
                  {isLoading ? '載入中...' : '查無資料'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const isEditing = editingCode === row.employee_code;
                const status = row.status || (row.is_active ? 'active' : 'resigned');
                const statusLabel = STATUS_LABELS[status] || status;
                const statusColor = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
                return (
                  <tr
                    key={row.employee_code}
                    className={`border-t border-gray-100 ${status !== 'active' ? 'opacity-60' : ''} ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-2 font-mono text-gray-800">{isGeneratedManualCode(row.employee_code, row.source) ? '-' : row.employee_code}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{row.employee_name || '-'}</div>
                      {row.source && SOURCE_LABELS[row.source] && (
                        <div className="mt-1">
                          <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                            {SOURCE_LABELS[row.source]}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.current_position}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-gray-800">{formatDate(row.start_date)}</div>
                      {row.resignation_date ? (
                        <div className="text-xs text-rose-700">
                          離職：{formatDate(row.resignation_date)}（年資 {calcSeniority(row.start_date, row.resignation_date)}）
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500">{calcSeniority(row.start_date)}</div>
                      )}
                    </td>

                    {/* 畢業學校 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={(draft.school as string) ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, school: e.target.value }))}
                          className="w-44 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">請選擇學校</option>
                          {SCHOOL_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-700">{row.school || '-'}</span>
                      )}
                    </td>

                    {/* 學歷 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select
                          value={(draft.education_level as string) ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, education_level: e.target.value }))}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">請選擇</option>
                          {EDUCATION_LEVEL_OPTIONS.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-700">{row.education_level || '-'}</span>
                      )}
                    </td>

                    {/* 負責藥師 */}
                    <td className="px-3 py-2 text-center">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={draft.is_responsible_pharmacist ?? false}
                          onChange={(e) => setDraft((d) => ({ ...d, is_responsible_pharmacist: e.target.checked }))}
                          className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                        />
                      ) : row.is_responsible_pharmacist ? (
                        <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">是</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    {/* 執照更新日 */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="date"
                          value={(draft.license_renewal_date as string) ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, license_renewal_date: e.target.value }))}
                          className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <span className={`${
                          row.license_renewal_date && new Date(row.license_renewal_date) < new Date()
                            ? 'text-rose-600 font-medium'
                            : 'text-gray-700'
                        }`}>
                          {formatDate(row.license_renewal_date)}
                        </span>
                      )}
                    </td>

                    {/* 常年會費 */}
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setFeeModalRow({ code: row.employee_code, name: row.employee_name || '' })}
                        className={`rounded border px-2 py-1 text-xs transition-colors ${
                          row.annual_fee_is_blue
                            ? 'border-blue-300 bg-blue-100 text-blue-700 hover:bg-blue-200'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        記錄
                      </button>
                    </td>

                    {/* 操作 */}
                    {canEdit && !isLocked && (
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => saveEdit(row.employee_code)}
                              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {isPending ? '儲存中…' : '儲存'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            編輯
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {saveError}
        </div>
      )}

      <p className="text-xs text-gray-500">
        執照更新日顯示紅色代表已逾期。畢業學校、學歷、負責藥師、執照更新日可點「編輯」修改後儲存。
        點「記錄」可查看或新增該藥師的常年會費申請記錄。常年會費按鈕藍底代表目前規則判定為已具備有效紀錄，白底代表尚未具備。手動新增的人員會在姓名下方顯示「手動」標籤。
      </p>

      {feeModalRow && (
        <PharmacistAnnualFeeModal
          employeeCode={feeModalRow.code}
          employeeName={feeModalRow.name}
          canEdit={canEdit}
          onClose={() => setFeeModalRow(null)}
        />
      )}
    </div>
  );
}
