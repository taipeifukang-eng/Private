'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import InspectionCalendar from '@/components/InspectionCalendar';
import InspectionStoreStatus from '@/components/InspectionStoreStatus';

type StoreItem = {
  id: string;
  store_name: string;
  store_code: string;
  short_name?: string | null;
};

type InspectionRecord = {
  id: string;
  store_id: string;
  inspection_date: string;
  store: {
    store_name: string;
    store_code: string;
    short_name?: string | null;
  };
  grade: string;
};

type Props = {
  inspections: InspectionRecord[];
  assignedStores: StoreItem[];
  initialMonth: string;
};

function parseMonthToDate(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  if (!matched) return new Date();
  const year = Number(matched[1]);
  const monthNumber = Number(matched[2]);
  return new Date(year, monthNumber - 1, 1);
}

export default function InspectionOverview({ inspections, assignedStores, initialMonth }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentDate, setCurrentDate] = useState(parseMonthToDate(initialMonth));
  const monthLabel = `${currentDate.getFullYear()} 年 ${currentDate.getMonth() + 1} 月`;

  const handleMonthChange = (nextDate: Date) => {
    setCurrentDate(nextDate);

    const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', nextMonth);

    router.replace(`/inspection?${params.toString()}`, { scroll: false });
  };

  const { inspectedStores, notInspectedStores } = useMemo(() => {
    const inspectedStoreIds = new Set(
      inspections
        .filter((inspection) => {
          const inspectionDate = new Date(inspection.inspection_date);
          return (
            inspectionDate.getFullYear() === currentDate.getFullYear() &&
            inspectionDate.getMonth() === currentDate.getMonth()
          );
        })
        .map((inspection) => inspection.store_id)
    );

    return {
      inspectedStores: assignedStores.filter((store) => inspectedStoreIds.has(store.id)),
      notInspectedStores: assignedStores.filter((store) => !inspectedStoreIds.has(store.id)),
    };
  }, [assignedStores, currentDate, inspections]);

  return (
    <>
      {assignedStores.length > 0 && (
        <InspectionStoreStatus
          inspectedStores={inspectedStores}
          notInspectedStores={notInspectedStores}
          monthLabel={monthLabel}
        />
      )}

      <div className="mb-8">
        <InspectionCalendar
          inspections={inspections}
          currentDate={currentDate}
          onMonthChange={handleMonthChange}
        />
      </div>
    </>
  );
}