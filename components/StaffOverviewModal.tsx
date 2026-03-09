'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Users, ChevronDown, ChevronRight, Loader2, UserCheck, BarChart3 } from 'lucide-react';

interface ManagedStore {
  id: string;
  store_code: string;
  store_name: string;
}

interface HeadcountEntry {
  own_staff_count: number;
  supervisor_count: number;
  extra_support_count: number;
  total: number;
}

interface StaffMember {
  employee_code: string;
  employee_name: string;
  position: string;
  is_manually_added?: boolean;
}

interface StaffOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  managedStores: ManagedStore[];
  headcountMap: Record<string, HeadcountEntry>;
}

export default function StaffOverviewModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  managedStores,
  headcountMap,
}: StaffOverviewModalProps) {
  // 哪些 store 已展開的 own_staff 清單
  const [expandedOwn, setExpandedOwn] = useState<Set<string>>(new Set());
  // 哪些 store 已展開的 extra_support 清單（未來功能）
  const [expandedExtra, setExpandedExtra] = useState<Set<string>>(new Set());
  // 各 store 的本店人員清單
  const [ownStaffMap, setOwnStaffMap] = useState<Record<string, StaffMember[]>>({});
  const [loadingOwn, setLoadingOwn] = useState<Set<string>>(new Set());

  // 關閉時重置展開狀態
  useEffect(() => {
    if (!isOpen) {
      setExpandedOwn(new Set());
      setExpandedExtra(new Set());
    }
  }, [isOpen]);

  const fetchOwnStaff = useCallback(async (storeId: string) => {
    if (ownStaffMap[storeId] !== undefined) return; // 已載入過
    setLoadingOwn(prev => new Set(prev).add(storeId));
    try {
      const res = await fetch(`/api/campaign-store-own-staff?campaign_id=${campaignId}&store_id=${storeId}`);
      const data = await res.json();
      if (data.success) {
        setOwnStaffMap(prev => ({ ...prev, [storeId]: data.data || [] }));
      } else {
        setOwnStaffMap(prev => ({ ...prev, [storeId]: [] }));
      }
    } catch {
      setOwnStaffMap(prev => ({ ...prev, [storeId]: [] }));
    } finally {
      setLoadingOwn(prev => { const s = new Set(prev); s.delete(storeId); return s; });
    }
  }, [campaignId, ownStaffMap]);

  const toggleOwnStaff = (storeId: string) => {
    setExpandedOwn(prev => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
        fetchOwnStaff(storeId);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  const sortedStores = [...managedStores].sort((a, b) => a.store_code.localeCompare(b.store_code));
  const totalOwn = sortedStores.reduce((s, st) => s + (headcountMap[st.id]?.own_staff_count ?? 0), 0);
  const totalSup = sortedStores.reduce((s, st) => s + (headcountMap[st.id]?.supervisor_count ?? 0), 0);
  const totalExtra = sortedStores.reduce((s, st) => s + (headcountMap[st.id]?.extra_support_count ?? 0), 0);
  const grandTotal = totalOwn + totalSup + totalExtra;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col mx-4">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Users size={20} className="text-teal-600" />
              活動人力查看
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{campaignName}・我管理的門市</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* 合計列 */}
        <div className="px-6 py-3 bg-teal-50 border-b border-teal-100 shrink-0">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-teal-700 font-semibold">總計：</span>
            <span className="text-gray-700">本店人員 <span className="font-bold text-gray-900">{totalOwn}</span> 人</span>
            <span className="text-gray-700">督導 <span className="font-bold text-purple-700">{totalSup}</span> 人</span>
            <span className="text-gray-700">額外支援 <span className="font-bold text-indigo-700">+{totalExtra}</span> 人</span>
            <span className="ml-auto text-base font-bold text-teal-700">合計 {grandTotal} 人</span>
          </div>
        </div>

        {/* 門市列表 */}
        <div className="flex-1 overflow-y-auto">
          {/* 欄位標題 */}
          <div className="grid grid-cols-[1fr_100px_80px_100px_80px] gap-0 px-6 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 sticky top-0">
            <div>門市</div>
            <div className="text-center">本店人員</div>
            <div className="text-center text-purple-700">督導</div>
            <div className="text-center text-indigo-700">額外支援</div>
            <div className="text-center">合計</div>
          </div>

          {sortedStores.map(store => {
            const hc = headcountMap[store.id];
            const ownCount = hc?.own_staff_count ?? 0;
            const supCount = hc?.supervisor_count ?? 0;
            const extraCount = hc?.extra_support_count ?? 0;
            const total = ownCount + supCount + extraCount;
            const hasData = !!hc;
            const isOwnExpanded = expandedOwn.has(store.id);
            const isOwnLoading = loadingOwn.has(store.id);
            const ownStaff = ownStaffMap[store.id];

            return (
              <div key={store.id} className="border-b border-gray-100 last:border-0">
                {/* 門市主列 */}
                <div className="grid grid-cols-[1fr_100px_80px_100px_80px] gap-0 px-6 py-3 hover:bg-gray-50 items-center">
                  {/* 門市名稱 */}
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{store.store_name}</div>
                    <div className="text-xs text-gray-400 font-mono">{store.store_code}</div>
                  </div>

                  {/* 本店人員（可點擊展開） */}
                  <div className="text-center">
                    {hasData && ownCount > 0 ? (
                      <button
                        onClick={() => toggleOwnStaff(store.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-sm transition-colors"
                      >
                        {isOwnLoading ? <Loader2 size={12} className="animate-spin" /> : (isOwnExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                        {ownCount} 人
                      </button>
                    ) : (
                      <span className={`text-sm ${hasData ? 'text-gray-400' : 'text-gray-300'}`}>{ownCount} 人</span>
                    )}
                  </div>

                  {/* 督導 */}
                  <div className="text-center">
                    <span className={`text-sm font-semibold ${supCount > 0 ? 'text-purple-600' : 'text-gray-300'}`}>{supCount} 人</span>
                  </div>

                  {/* 額外支援（未來可展開） */}
                  <div className="text-center">
                    <span className={`text-sm font-semibold ${extraCount > 0 ? 'text-indigo-600' : 'text-gray-300'}`}>+{extraCount} 人</span>
                  </div>

                  {/* 合計 */}
                  <div className="text-center">
                    {hasData ? (
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-teal-100 text-teal-800 text-base font-bold">
                        {total}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">未設定</span>
                    )}
                  </div>
                </div>

                {/* 本店人員展開列 */}
                {isOwnExpanded && (
                  <div className="bg-teal-50/50 border-t border-teal-100 px-8 py-3">
                    {isOwnLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                        <Loader2 size={14} className="animate-spin" /> 載入中...
                      </div>
                    ) : ownStaff && ownStaff.length > 0 ? (
                      <div>
                        <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-teal-700 uppercase tracking-wide">
                          <UserCheck size={13} />
                          本店人員名單（{ownStaff.length} 人）
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {ownStaff.map(emp => (
                            <div key={emp.employee_code} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-teal-100 shadow-sm">
                              <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold shrink-0">
                                {emp.employee_name?.charAt(0) || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">{emp.employee_name}</div>
                                <div className="text-xs text-gray-400">{emp.position} · {emp.employee_code}</div>
                              </div>
                              {emp.is_manually_added && (
                                <span className="ml-auto shrink-0 text-xs bg-amber-100 text-amber-700 rounded px-1">手動</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 py-1">尚無本店人員資料</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl shrink-0 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-100">
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
