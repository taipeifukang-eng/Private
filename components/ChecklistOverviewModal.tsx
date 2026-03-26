'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';

interface ManagedStore {
  id: string;
  store_code: string;
  store_name: string;
}

interface StoreCompletion {
  storeId: string;
  storeName: string;
  storeCode: string;
  completedCount: number;
  totalCount: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  managedStores: ManagedStore[];
  scheduledStoreIds: string[];
}

export default function ChecklistOverviewModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  managedStores,
  scheduledStoreIds,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [totalItems, setTotalItems] = useState(0);
  const [storeCompletions, setStoreCompletions] = useState<StoreCompletion[]>([]);

  useEffect(() => {
    if (isOpen && campaignId) {
      loadData();
    }
  }, [isOpen, campaignId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsRes, completionsRes] = await Promise.all([
        fetch(`/api/campaign-checklist-items?campaign_id=${campaignId}`),
        fetch(`/api/campaign-checklist-completions?campaign_id=${campaignId}`),
      ]);
      const [itemsData, completionsData] = await Promise.all([
        itemsRes.json(),
        completionsRes.json(),
      ]);

      const items: { id: string }[] = itemsData.success ? itemsData.data : [];
      const completions: { checklist_item_id: string; store_id: string; is_completed: boolean }[] =
        completionsData.success ? completionsData.data : [];

      setTotalItems(items.length);

      // 過濾出「管理中 + 已排程」的門市
      const scheduledSet = new Set(scheduledStoreIds);
      const relevantStores = managedStores.filter((s) => scheduledSet.has(s.id));

      // 計算每間門市的完成數
      const result: StoreCompletion[] = relevantStores.map((store) => {
        const completedCount = completions.filter(
          (c) => c.store_id === store.id && c.is_completed
        ).length;
        return {
          storeId: store.id,
          storeName: store.store_name,
          storeCode: store.store_code,
          completedCount,
          totalCount: items.length,
        };
      });

      // 未完成的排前面，同狀態按門市代碼排序
      result.sort((a, b) => {
        const aComplete = a.completedCount >= a.totalCount;
        const bComplete = b.completedCount >= b.totalCount;
        if (aComplete !== bComplete) return aComplete ? 1 : -1;
        return a.storeCode.localeCompare(b.storeCode);
      });

      setStoreCompletions(result);
    } catch {
      // 忽略錯誤
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const incompleteCount = storeCompletions.filter((s) => s.completedCount < s.totalCount).length;
  const completeCount = storeCompletions.length - incompleteCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-900">前置 Check List 總覽</h2>
            <p className="text-sm text-gray-500 mt-0.5">{campaignName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 摘要列 */}
        {!loading && storeCompletions.length > 0 && (
          <div className="px-5 py-3 bg-gray-50 border-b flex flex-wrap items-center gap-4 text-sm">
            <span className="text-gray-600">共 {storeCompletions.length} 間門市</span>
            {totalItems > 0 && (
              <span className="text-gray-500">（{totalItems} 個項目）</span>
            )}
            <span className="text-red-600 font-medium">{incompleteCount} 間未完成</span>
            <span className="text-green-600 font-medium">{completeCount} 間已完成</span>
          </div>
        )}

        {/* 清單 */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-10 text-gray-400">載入中...</div>
          ) : totalItems === 0 ? (
            <div className="text-center py-10 text-gray-400">
              此活動尚未設定前置 Check List
            </div>
          ) : storeCompletions.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              無管轄門市參與此活動
            </div>
          ) : (
            <div className="space-y-3">
              {storeCompletions.map((store) => {
                const isComplete = store.completedCount >= store.totalCount;
                const progress =
                  store.totalCount > 0
                    ? (store.completedCount / store.totalCount) * 100
                    : 0;

                return (
                  <div
                    key={store.storeId}
                    className={`border rounded-lg p-4 ${
                      isComplete
                        ? 'border-green-200 bg-green-50'
                        : 'border-orange-200 bg-orange-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isComplete ? (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                        )}
                        <div>
                          <div className="font-medium text-gray-900">{store.storeName}</div>
                          <div className="text-xs text-gray-500">{store.storeCode}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold ${
                            isComplete ? 'text-green-700' : 'text-orange-600'
                          }`}
                        >
                          {store.completedCount}/{store.totalCount} 完成
                        </div>
                        <div
                          className={`text-xs ${
                            isComplete ? 'text-green-600' : 'text-orange-500'
                          }`}
                        >
                          {isComplete
                            ? '✓ 全部完成'
                            : `還差 ${store.totalCount - store.completedCount} 項`}
                        </div>
                      </div>
                    </div>
                    {/* 進度條 */}
                    <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isComplete ? 'bg-green-500' : 'bg-orange-400'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
