'use client';

import { useMemo, useState } from 'react';
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
};

type Props = {
  inspections: InspectionRecord[];
  assignedStores: StoreItem[];
};

export default function InspectionOverview({ inspections, assignedStores }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthLabel = `${currentDate.getFullYear()} 年 ${currentDate.getMonth() + 1} 月`;

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
          onMonthChange={setCurrentDate}
        />
      </div>
    </>
  );
}