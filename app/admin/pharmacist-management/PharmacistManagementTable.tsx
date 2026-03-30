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
  prev_store_name: string;
  prev_position: string;
};

export default function PharmacistManagementTable({
  initialRows,
  yearMonth,
  canEdit,
}: {
  initialRows: PharmacistRow[];
  yearMonth: string;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<PharmacistRow[]>(initialRows);
  const [savingId, setSavingId] = useState<string | null>(null);

  const updatePosition = async (row: PharmacistRow) => {
    if (!canEdit) return;
    setSavingId(row.id);

    try {
      const response = await fetch('/api/pharmacist-management/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          year_month: yearMonth,
          position: row.position,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '儲存失敗');
      }
    } catch (error: any) {
      alert(`儲存失敗：${error?.message || '未知錯誤'}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">督導區</th>
              <th className="px-4 py-3 text-left font-semibold">門市</th>
              <th className="px-4 py-3 text-left font-semibold">員編</th>
              <th className="px-4 py-3 text-left font-semibold">姓名</th>
              <th className="px-4 py-3 text-left font-semibold">該月職級</th>
              <th className="px-4 py-3 text-left font-semibold">上月門市</th>
              <th className="px-4 py-3 text-left font-semibold">上月職級</th>
              <th className="px-4 py-3 text-left font-semibold">變化</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  查無資料
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.store_id}-${row.employee_code}`} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">{row.supervisor_zone}</td>
                  <td className="px-4 py-3">{row.store_code} {row.store_name}</td>
                  <td className="px-4 py-3 font-mono">{row.employee_code}</td>
                  <td className="px-4 py-3">{row.employee_name}</td>
                  <td className="px-4 py-3">
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.position}
                          onChange={(e) => {
                            const next = e.target.value;
                            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, position: next } : r)));
                          }}
                          className="w-36 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => updatePosition(row)}
                          disabled={savingId === row.id}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
                        >
                          {savingId === row.id ? '儲存中' : '儲存'}
                        </button>
                      </div>
                    ) : (
                      row.position
                    )}
                  </td>
                  <td className="px-4 py-3">{row.prev_store_name}</td>
                  <td className="px-4 py-3">{row.prev_position}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.change_type === '無變更'
                          ? 'bg-gray-100 text-gray-700'
                          : row.change_type === '新增任職'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.change_type}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
