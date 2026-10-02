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
  source_store_id?: string | null;
};

type StoreLineageItem = {
  id: string;
  store_name?: string | null;
  short_name?: string | null;
  source_store_id?: string | null;
};

type InspectionRecord = {
  id: string;
  store_id: string;
  inspection_date: string;
  store: {
    id?: string;
    store_name: string;
    store_code: string;
    short_name?: string | null;
    source_store_id?: string | null;
  };
  grade: string;
};

type Props = {
  inspections: InspectionRecord[];
  assignedStores: StoreItem[];
  storeLineage: StoreLineageItem[];
  initialMonth: string;
};

function parseMonthToDate(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  if (!matched) return new Date();
  const year = Number(matched[1]);
  const monthNumber = Number(matched[2]);
  return new Date(year, monthNumber - 1, 1);
}

function normalizeStoreName(value?: string | null) {
  return value?.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-TW') || '';
}

export default function InspectionOverview({ inspections, assignedStores, storeLineage, initialMonth }: Props) {
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
    const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const inspectedStoreIds = new Set(
      inspections
        .filter((inspection) => inspection.inspection_date.slice(0, 7) === monthKey)
        .map((inspection) => inspection.store_id)
    );

    // 搬移門市會建立新 stores.id，歷史巡店仍會保留舊 id。
    // 以 source_store_id 往前追溯，讓同一門市沿革中的巡店紀錄可認列到目前門市。
    const sourceStoreById = new Map<string, string | null>();
    storeLineage.forEach((store) => sourceStoreById.set(store.id, store.source_store_id || null));
    assignedStores.forEach((store) => sourceStoreById.set(store.id, store.source_store_id || null));
    inspections.forEach((inspection) => {
      if (inspection.store?.id) {
        sourceStoreById.set(inspection.store.id, inspection.store.source_store_id || null);
      }
    });

    const getLineageRoot = (storeId: string) => {
      const visited = new Set<string>();
      let currentStoreId = storeId;

      while (currentStoreId && !visited.has(currentStoreId)) {
        visited.add(currentStoreId);
        const sourceStoreId = sourceStoreById.get(currentStoreId);
        if (!sourceStoreId) break;
        currentStoreId = sourceStoreId;
      }

      return currentStoreId;
    };

    const inspectedStoreRoots = new Set(
      Array.from(inspectedStoreIds, (storeId) => getLineageRoot(storeId))
    );
    const assignedStoreNameCounts = assignedStores.reduce((counts, store) => {
      const storeName = normalizeStoreName(store.store_name);
      if (storeName) counts.set(storeName, (counts.get(storeName) || 0) + 1);
      return counts;
    }, new Map<string, number>());
    const inspectedStoreNames = new Set(
      inspections
        .filter((inspection) => inspection.inspection_date.slice(0, 7) === monthKey)
        .map((inspection) => normalizeStoreName(inspection.store?.store_name))
        .filter(Boolean)
    );
    const isInspected = (store: StoreItem) => {
      if (inspectedStoreRoots.has(getLineageRoot(store.id))) return true;

      // 早期搬店資料尚未回填 source_store_id。僅在目前清單中名稱唯一時備援認列，
      // 避免同名門市被錯誤合併。
      const storeName = normalizeStoreName(store.store_name);
      return Boolean(
        storeName &&
        assignedStoreNameCounts.get(storeName) === 1 &&
        inspectedStoreNames.has(storeName)
      );
    };

    return {
      inspectedStores: assignedStores.filter(isInspected),
      notInspectedStores: assignedStores.filter((store) => !isInspected(store)),
    };
  }, [assignedStores, currentDate, inspections, storeLineage]);

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
