'use client';

import { useMemo, useState } from 'react';
import { Calendar, Download } from 'lucide-react';

type InspectionExportControlsProps = {
  months: string[];
  initialMonth: string;
};

const monthLabelFormatter = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'long',
});

function getMonthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split('-').map(Number);
  return monthLabelFormatter.format(new Date(year, monthNumber - 1, 1));
}

export default function InspectionExportControls({
  months,
  initialMonth,
}: InspectionExportControlsProps) {
  const safeInitialMonth = useMemo(() => {
    if (months.includes(initialMonth)) return initialMonth;
    return months[0] || initialMonth;
  }, [months, initialMonth]);

  const [selectedMonth, setSelectedMonth] = useState(safeInitialMonth);

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedMonth}
        onChange={(event) => setSelectedMonth(event.target.value)}
        className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        aria-label="選擇匯出月份"
      >
        {months.map((month) => (
          <option key={month} value={month}>
            {getMonthLabel(month)}
          </option>
        ))}
      </select>

      <a
        href={`/api/inspection/export-monthly-score?month=${encodeURIComponent(selectedMonth)}`}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-medium text-emerald-700 transition-all hover:bg-emerald-50"
      >
        <Download size={16} />
        匯出當月巡店得分
      </a>

      <div className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-200 bg-gradient-to-r from-cyan-50 to-emerald-50 px-3 shadow-sm">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-cyan-600">
          <Calendar size={14} />
        </div>
        <span className="text-sm font-medium text-slate-700">顯示中的月份</span>
        <span className="text-sm font-semibold text-emerald-700">{getMonthLabel(selectedMonth)}</span>
      </div>
    </div>
  );
}
