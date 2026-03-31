'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  selectedYearMonth: string;
  selectedZone: string;
  zoneOptions: string[];
};

export default function OverviewFilterForm({ selectedYearMonth, selectedZone, zoneOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [yearMonth, setYearMonth] = useState(selectedYearMonth);
  const [zone, setZone] = useState(selectedZone);

  const submit = (nextYearMonth: string, nextZone: string) => {
    const params = new URLSearchParams();
    params.set('tab', 'overview');
    params.set('year_month', nextYearMonth);
    params.set('zone', nextZone || 'all');
    router.push(`${pathname}?${params.toString()}`);
  };

  const onYearMonthChange = (value: string) => {
    setYearMonth(value);
    submit(value, zone);
  };

  const onZoneChange = (value: string) => {
    setZone(value);
    submit(yearMonth, value);
  };

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">月份</label>
          <input
            type="month"
            name="year_month"
            value={yearMonth}
            onChange={(e) => onYearMonthChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">督導區</label>
          <select
            name="zone"
            value={zone}
            onChange={(e) => onZoneChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="all">全部督導區</option>
            {zoneOptions.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-60 cursor-default"
            disabled
          >
            已自動查詢
          </button>
        </div>
      </div>
    </div>
  );
}
