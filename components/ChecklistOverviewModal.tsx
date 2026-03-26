'use client';

import React, { useEffect, useState, useRef } from 'react';
import { X, CheckSquare, Square, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { CampaignChecklistItem, CampaignChecklistCompletion } from '@/types/workflow';

interface ManagedStore {
  id: string;
  store_code: string;
  store_name: string;
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
  const [items, setItems] = useState<CampaignChecklistItem[]>([]);
  // completions: Map<store_id, Map<item_id, CampaignChecklistCompletion>>
  const [completions, setCompletions] = useState<Map<string, Map<string, CampaignChecklistCompletion>>>(new Map());
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const noteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 過濾出「管轄 + 已排程」的門市，按代碼排序
  const relevantStores = managedStores
    .filter((s) => scheduledStoreIds.includes(s.id))
    .sort((a, b) => a.store_code.localeCompare(b.store_code));

  useEffect(() => {
    if (!isOpen || !campaignId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [itemsRes, completionsRes] = await Promise.all([
          fetch(`/api/campaign-checklist-items?campaign_id=${campaignId}`),
          fetch(`/api/campaign-checklist-completions?campaign_id=${campaignId}`),
        ]);
        const [itemsData, completionsData] = await Promise.all([itemsRes.json(), completionsRes.json()]);
        if (cancelled) return;

        const fetchedItems: CampaignChecklistItem[] = itemsData.success ? itemsData.data : [];
        const allCompletions: CampaignChecklistCompletion[] = completionsData.success ? completionsData.data : [];

        const map = new Map<string, Map<string, CampaignChecklistCompletion>>();
        for (const c of allCompletions) {
          if (!map.has(c.store_id)) map.set(c.store_id, new Map());
          map.get(c.store_id)!.set(c.checklist_item_id, c);
        }

        // 未完成的門市展開，已全部完成的收合
        const stores = managedStores.filter((s) => scheduledStoreIds.includes(s.id));
        const incompleteStoreIds = stores
          .filter((s) => {
            const sm = map.get(s.id);
            let done = 0;
            sm?.forEach((c) => { if (c.is_completed) done++; });
            return done < fetchedItems.length;
          })
          .map((s) => s.id);

        setItems(fetchedItems);
        setCompletions(map);
        setExpandedStores(new Set(incompleteStoreIds));
      } catch {
        // 忽略
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isOpen, campaignId, managedStores, scheduledStoreIds]);

  // 打勾 / 取消打勾
  const handleToggle = async (storeId: string, itemId: string) => {
    const storeMap = completions.get(storeId);
    const existing = storeMap?.get(itemId);
    const newVal = !(existing?.is_completed ?? false);

    // 立即更新本地 state（樂觀更新）
    setCompletions((prev) => {
      const updated = new Map(prev);
      if (!updated.has(storeId)) updated.set(storeId, new Map());
      const sm = new Map(updated.get(storeId)!);
      sm.set(itemId, {
        id: existing?.id || '',
        checklist_item_id: itemId,
        store_id: storeId,
        is_completed: newVal,
        completed_by: existing?.completed_by || null,
        completed_at: newVal ? new Date().toISOString() : null,
        manager_note: existing?.manager_note || null,
        created_at: existing?.created_at || '',
        updated_at: new Date().toISOString(),
      });
      updated.set(storeId, sm);

      // 若該門市已全部完成，自動收合
      let doneCount = 0;
      sm.forEach((c) => { if (c.is_completed) doneCount++; });
      if (doneCount >= items.length && items.length > 0) {
        setExpandedStores((prev) => { const next = new Set(prev); next.delete(storeId); return next; });
      }

      return updated;
    });

    try {
      const res = await fetch('/api/campaign-checklist-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist_item_id: itemId, store_id: storeId, is_completed: newVal }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setCompletions((prev) => {
          const updated = new Map(prev);
          if (!updated.has(storeId)) updated.set(storeId, new Map());
          const sm = new Map(updated.get(storeId)!);
          sm.set(itemId, data.data);
          updated.set(storeId, sm);
          return updated;
        });
      }
    } catch {
      // 保留樂觀更新
    }
  };

  // 備註更新（debounce 800ms）
  const handleNoteChange = (storeId: string, itemId: string, note: string) => {
    setCompletions((prev) => {
      const updated = new Map(prev);
      if (!updated.has(storeId)) updated.set(storeId, new Map());
      const sm = new Map(updated.get(storeId)!);
      const existing = sm.get(itemId);
      sm.set(itemId, {
        id: existing?.id || '',
        checklist_item_id: itemId,
        store_id: storeId,
        is_completed: existing?.is_completed || false,
        completed_by: existing?.completed_by || null,
        completed_at: existing?.completed_at || null,
        manager_note: note,
        created_at: existing?.created_at || '',
        updated_at: new Date().toISOString(),
      });
      updated.set(storeId, sm);
      return updated;
    });

    const key = `${storeId}__${itemId}`;
    const prev = noteTimers.current.get(key);
    if (prev) clearTimeout(prev);
    noteTimers.current.set(
      key,
      setTimeout(async () => {
        try {
          await fetch('/api/campaign-checklist-completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checklist_item_id: itemId, store_id: storeId, manager_note: note }),
          });
        } catch {
          // 忽略
        }
      }, 800)
    );
  };

  const toggleExpand = (storeId: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      next.has(storeId) ? next.delete(storeId) : next.add(storeId);
      return next;
    });
  };

  const getStoreCompletedCount = (storeId: string) => {
    const sm = completions.get(storeId);
    if (!sm) return 0;
    let count = 0;
    sm.forEach((c) => { if (c.is_completed) count++; });
    return count;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">前置 Check List 管理</h2>
            <p className="text-sm text-gray-500 mt-0.5">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              載入中...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p>此活動尚未設定前置 Check List 項目</p>
            </div>
          ) : relevantStores.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p>無管轄門市參與此活動</p>
            </div>
          ) : (
            relevantStores.map((store) => {
              const completedCount = getStoreCompletedCount(store.id);
              const isExpanded = expandedStores.has(store.id);
              const isAllDone = completedCount >= items.length;

              return (
                <div
                  key={store.id}
                  className={`border-2 rounded-xl overflow-hidden transition-colors ${
                    isAllDone ? 'border-green-200' : 'border-gray-200'
                  }`}
                >
                  {/* 門市標題列（點擊展開/收合） */}
                  <button
                    onClick={() => toggleExpand(store.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                      isAllDone ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      )}
                      <span className="font-semibold text-gray-900">{store.store_name}</span>
                      <span className="text-xs text-gray-400">{store.store_code}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${
                          isAllDone
                            ? 'bg-green-200 text-green-800'
                            : completedCount > 0
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {completedCount}/{items.length}
                      </span>
                      {isAllDone && <span className="text-xs text-green-600 font-medium">✓ 完成</span>}
                    </div>
                  </button>

                  {/* 展開的項目列表 */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100">
                      {/* 進度條 */}
                      <div className="px-4 py-2 bg-white">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isAllDone ? 'bg-green-500' : 'bg-purple-500'
                            }`}
                            style={{ width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%` }}
                          />
                        </div>
                      </div>

                      {items.map((item, idx) => {
                        const completion = completions.get(store.id)?.get(item.id);
                        const isDone = completion?.is_completed ?? false;
                        const note = completion?.manager_note ?? '';

                        return (
                          <div
                            key={item.id}
                            className={`px-4 py-3 transition-colors ${isDone ? 'bg-green-50' : 'bg-white'}`}
                          >
                            <div className="flex items-start gap-3">
                              {/* Checkbox */}
                              <button
                                onClick={() => handleToggle(store.id, item.id)}
                                className="flex-shrink-0 mt-0.5"
                                title={isDone ? '點擊取消完成' : '點擊標記完成'}
                              >
                                {isDone ? (
                                  <CheckSquare className="w-5 h-5 text-green-600" />
                                ) : (
                                  <Square className="w-5 h-5 text-gray-400 hover:text-purple-600" />
                                )}
                              </button>

                              {/* 項目內容 */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                      isDone ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                                    }`}
                                  >
                                    {idx + 1}
                                  </span>
                                  <span
                                    className={`text-sm font-medium ${
                                      isDone ? 'text-gray-400 line-through' : 'text-gray-900'
                                    }`}
                                  >
                                    {item.task_name}
                                  </span>
                                </div>

                                {/* 項目備註 & meta */}
                                {(item.notes || item.assigned_person || item.deadline) && (
                                  <div className="mt-1 ml-7 space-y-0.5">
                                    {item.notes && (
                                      <p className="text-xs text-gray-500 whitespace-pre-wrap">{item.notes}</p>
                                    )}
                                    <div className="flex flex-wrap gap-3 text-xs">
                                      {item.assigned_person && (
                                        <span className="text-purple-600">👤 {item.assigned_person}</span>
                                      )}
                                      {item.deadline && (
                                        <span className="text-orange-600">⏰ {item.deadline}</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* 完成時間 */}
                                {isDone && completion?.completed_at && (
                                  <p className="ml-7 text-xs text-green-600 mt-1">
                                    ✓ {new Date(completion.completed_at).toLocaleString('zh-TW', {
                                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                                    })}
                                  </p>
                                )}

                                {/* 店長備註 */}
                                <div className="mt-2 ml-7">
                                  <textarea
                                    value={note}
                                    onChange={(e) => handleNoteChange(store.id, item.id, e.target.value)}
                                    placeholder="店長備註（選填）"
                                    rows={1}
                                    className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent placeholder-gray-300 bg-white"
                                    style={{ minHeight: '2.5rem' }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex-shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
