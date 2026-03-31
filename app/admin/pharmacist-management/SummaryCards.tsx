'use client';

import { useState } from 'react';

type PharmacistRow = {
  id: string;
  store_id: string;
  store_code: string;
  store_name: string;
  employee_code: string;
  employee_name: string;
  position: string;
  supervisor_zone: string;
  change_type: string;
  change_note: string;
  prev_store_name: string;
  prev_position: string;
};

type SummaryData = {
  total: number;
  newJoin: number;
  changed: number;
};

type Props = {
  summary: SummaryData;
  filteredRows: PharmacistRow[];
};

export default function SummaryCards({ summary, filteredRows }: Props) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'newJoin' | 'changed' | null>(null);

  const handleCardClick = (filter: 'all' | 'newJoin' | 'changed') => {
    setActiveFilter(activeFilter === filter ? null : filter);
  };

  const getFilteredData = () => {
    if (!activeFilter) return [];
    
    switch (activeFilter) {
      case 'all':
        return filteredRows;
      case 'newJoin':
        return filteredRows.filter((r) => r.change_type === '新增任職');
      case 'changed':
        return filteredRows.filter((r) => r.change_type !== '無變更' && r.change_type !== '新增任職');
      default:
        return [];
    }
  };

  const displayData = getFilteredData();

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => handleCardClick('all')}
          className={`rounded-xl border p-4 text-left transition-all ${
            activeFilter === 'all'
              ? 'border-blue-400 bg-blue-100 shadow-lg'
              : 'border-blue-100 bg-blue-50 hover:bg-blue-100 hover:shadow-md'
          }`}
        >
          <div className="text-sm text-blue-700">當月藥師總數</div>
          <div className="mt-1 text-2xl font-bold text-blue-900">{summary.total}</div>
          {activeFilter === 'all' && (
            <div className="mt-2 text-xs text-blue-600">點擊收起</div>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleCardClick('newJoin')}
          className={`rounded-xl border p-4 text-left transition-all ${
            activeFilter === 'newJoin'
              ? 'border-green-400 bg-green-100 shadow-lg'
              : 'border-green-100 bg-green-50 hover:bg-green-100 hover:shadow-md'
          }`}
        >
          <div className="text-sm text-green-700">新增任職</div>
          <div className="mt-1 text-2xl font-bold text-green-900">{summary.newJoin}</div>
          {activeFilter === 'newJoin' && (
            <div className="mt-2 text-xs text-green-600">點擊收起</div>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleCardClick('changed')}
          className={`rounded-xl border p-4 text-left transition-all ${
            activeFilter === 'changed'
              ? 'border-amber-400 bg-amber-100 shadow-lg'
              : 'border-amber-100 bg-amber-50 hover:bg-amber-100 hover:shadow-md'
          }`}
        >
          <div className="text-sm text-amber-700">門市/職級異動</div>
          <div className="mt-1 text-2xl font-bold text-amber-900">{summary.changed}</div>
          {activeFilter === 'changed' && (
            <div className="mt-2 text-xs text-amber-600">點擊收起</div>
          )}
        </button>
      </div>

      {activeFilter && displayData.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {activeFilter === 'all' && `當月所有藥師（${displayData.length} 人）`}
              {activeFilter === 'newJoin' && `新增任職藥師（${displayData.length} 人）`}
              {activeFilter === 'changed' && `門市/職級異動藥師（${displayData.length} 人）`}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">督導區</th>
                  <th className="px-4 py-3 text-left font-semibold">門市</th>
                  <th className="px-4 py-3 text-left font-semibold">員編</th>
                  <th className="px-4 py-3 text-left font-semibold">姓名</th>
                  <th className="px-4 py-3 text-left font-semibold">職級</th>
                  <th className="px-4 py-3 text-left font-semibold">變化類型</th>
                  <th className="px-4 py-3 text-left font-semibold">備註</th>
                </tr>
              </thead>
              <tbody>
                {displayData.map((row, idx) => (
                  <tr
                    key={`${row.store_id}-${row.employee_code}-${idx}`}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-gray-700">{row.supervisor_zone}</td>
                    <td className="px-4 py-3 text-gray-900">
                      {row.store_code} {row.store_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-800">{row.employee_code}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{row.employee_name}</td>
                    <td className="px-4 py-3 text-gray-700">{row.position}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.change_type === '無變更'
                            ? 'bg-gray-100 text-gray-700'
                            : row.change_type === '新增任職'
                              ? 'bg-green-100 text-green-700'
                              : row.change_type === '離職'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {row.change_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.change_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
