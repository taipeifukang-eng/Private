'use client';

import { useState, useTransition, useMemo } from 'react';

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

export type PharmacistMasterRow = {
  employee_code: string;
  employee_name: string;
  current_position: string;
  start_date: string | null;
  resignation_date: string | null;
  is_active: boolean;
  school: string;
  education_level: string;
  is_responsible_pharmacist: boolean;
  license_renewal_date: string | null;
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

export default function PharmacistMasterList({
  rows,
  canEdit,
}: {
  rows: PharmacistMasterRow[];
  canEdit: boolean;
}) {
  const [data, setData] = useState<PharmacistMasterRow[]>(rows);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<PharmacistMasterRow>>({});
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active');

  const filtered = useMemo(() => {
    return data.filter((row) => {
      if (filterActive === 'active' && !row.is_active) return false;
      if (filterActive === 'inactive' && row.is_active) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return (
          row.employee_code.toLowerCase().includes(q) ||
          row.employee_name.toLowerCase().includes(q)
        );
      }
      return true;
    });
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

  return (
    <div className="space-y-4">
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
          {(['active', 'inactive', 'all'] as const).map((v) => (
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
              {v === 'active' ? '在職' : v === 'inactive' ? '已離職' : '全部'}
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
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">現職職級</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">到職日 / 年資</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">畢業學校</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">學歷</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">負責藥師</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">執照更新日</th>
              {canEdit && <th className="px-3 py-3 text-center font-semibold">操作</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="px-3 py-10 text-center text-gray-500">
                  查無資料
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const isEditing = editingCode === row.employee_code;
                return (
                  <tr
                    key={row.employee_code}
                    className={`border-t border-gray-100 ${!row.is_active ? 'opacity-50' : ''} ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-2 font-mono text-gray-800">{row.employee_code}</td>
                    <td className="px-3 py-2 font-medium">{row.employee_name || '-'}</td>
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

                    {/* 操作 */}
                    {canEdit && (
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
      </p>
    </div>
  );
}
