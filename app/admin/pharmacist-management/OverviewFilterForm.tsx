'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

type LockRecord = {
  year_month: string;
  locked_at: string;
  locked_by: string;
};

type Props = {
  selectedYearMonth: string;
  selectedZone: string;
  zoneOptions: string[];
  lockedMonths: LockRecord[];
  canEdit: boolean;
};

export default function OverviewFilterForm({
  selectedYearMonth,
  selectedZone,
  zoneOptions,
  lockedMonths,
  canEdit,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [yearMonth, setYearMonth] = useState(selectedYearMonth);
  const [zone, setZone] = useState(selectedZone);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const isLocked = lockedMonths.some((r) => r.year_month === yearMonth);
  const lockRecord = lockedMonths.find((r) => r.year_month === yearMonth);

  const submit = (nextYearMonth: string, nextZone: string) => {
    const params = new URLSearchParams();
    params.set('tab', 'overview');
    params.set('year_month', nextYearMonth);
    params.set('zone', nextZone || 'all');
    router.push(`${pathname}?${params.toString()}`);
  };

  const onYearMonthChange = (value: string) => {
    setYearMonth(value);
    setLockError(null);
    submit(value, zone);
  };

  const onZoneChange = (value: string) => {
    setZone(value);
    submit(yearMonth, value);
  };

  const handleLock = async () => {
    setLockLoading(true);
    setLockError(null);
    try {
      const res = await fetch('/api/pharmacist-snapshot-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: yearMonth }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLockError(json.error || '關帳失敗');
      } else {
        router.refresh();
      }
    } catch {
      setLockError('網路錯誤，請重試');
    } finally {
      setLockLoading(false);
    }
  };

  const handleUnlock = async () => {
    setLockLoading(true);
    setLockError(null);
    try {
      const res = await fetch('/api/pharmacist-snapshot-lock', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: yearMonth }),
      });
      const json = await res.json();
      if (!res.ok) {
        setLockError(json.error || '解除關帳失敗');
      } else {
        router.refresh();
      }
    } catch {
      setLockError('網路錯誤，請重試');
    } finally {
      setLockLoading(false);
    }
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
        <div className="flex flex-col justify-end gap-1">
          {canEdit && (
            isLocked ? (
              <button
                type="button"
                onClick={handleUnlock}
                disabled={lockLoading}
                className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                <span>🔒</span>
                <span>{lockLoading ? '處理中…' : `已關帳（點擊解除）`}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLock}
                disabled={lockLoading}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <span>🔓</span>
                <span>{lockLoading ? '處理中…' : '關帳'}</span>
              </button>
            )
          )}
          {isLocked && lockRecord && (
            <p className="text-xs text-gray-500">
              由 {lockRecord.locked_by} 關帳於 {lockRecord.locked_at.slice(0, 10)}
            </p>
          )}
          {lockError && (
            <p className="text-xs text-red-600">{lockError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

