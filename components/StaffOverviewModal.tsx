'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Users, ChevronDown, ChevronRight, Loader2, UserCheck,
  Pencil, Trash2, Search, Save, RotateCcw,
} from 'lucide-react';

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
  id?: string;
  employee_code: string;
  employee_name: string;
  position: string;
  is_manually_added?: boolean;
  from_store_name?: string;
  source?: 'monthly_status' | 'movement_history';
}

interface StaffOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  managedStores: ManagedStore[];
  headcountMap: Record<string, HeadcountEntry>;
  onHeadcountUpdated?: () => void;
}

// --- 單一門市的本店人員編輯區塊 ---
function StoreOwnStaffPanel({
  campaignId,
  store,
  initialCount,
  supervisorCount,
  extraSupportCount,
  onCountChanged,
}: {
  campaignId: string;
  store: ManagedStore;
  initialCount: number;
  supervisorCount: number;
  extraSupportCount: number;
  onCountChanged: (storeId: string, count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<StaffMember[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!search) {
      setSearchResults([]);
      setSearchNotFound(false);
      setShowDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      setSearchNotFound(false);
      try {
        const res = await fetch(`/api/monthly-staff-by-store/search?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        if (data.success) {
          setSearchResults(data.data || []);
          setSearchNotFound(data.not_found === true);
          setShowDropdown(true);
        }
      } catch {}
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaign-store-own-staff?campaign_id=${campaignId}&store_id=${store.id}`);
      const data = await res.json();
      if (data.success) {
        setStaff(data.data || []);
        setHasLoaded(true);
      }
    } catch {}
    setLoading(false);
  }, [campaignId, store.id]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !hasLoaded) fetchStaff();
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSearch('');
    setShowDropdown(false);
    setHasLoaded(false);
    fetchStaff();
  };

  const handleAddEmployee = (emp: StaffMember) => {
    if (staff.some(s => s.employee_code === emp.employee_code)) {
      setSearch('');
      setShowDropdown(false);
      return;
    }
    setStaff(prev => [...prev, { ...emp, is_manually_added: true }]);
    setSearch('');
    setShowDropdown(false);
  };

  const handleRemove = (code: string) => setStaff(prev => prev.filter(s => s.employee_code !== code));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/campaign-store-own-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, store_id: store.id, staff, replace: true }),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(false);
        setSearch('');
        onCountChanged(store.id, staff.length);
      } else {
        alert(`儲存失敗：${data.error}`);
      }
    } catch {
      alert('網路錯誤，請重試');
    } finally {
      setSaving(false);
    }
  };

  const displayCount = hasLoaded ? staff.length : initialCount;

  const rowTotal = displayCount + supervisorCount + extraSupportCount;

  return (
    <div className="border-b border-gray-100 last:border-0">
      {/* 門市主列 */}
      <div className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50">
        {/* 門市名稱 */}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 text-sm">{store.store_name}</div>
          <div className="text-xs text-gray-400 font-mono">{store.store_code}</div>
        </div>

        {/* 分解數字：本店 + 督導 + 支援 */}
        <div className="flex items-center gap-1 text-sm font-semibold shrink-0">
          <button
            onClick={handleExpand}
            title="展開本店人員"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 transition-colors"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : (expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)}
            {displayCount}
          </button>
          <span className="text-gray-300">+</span>
          <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-700">{supervisorCount}</span>
          <span className="text-gray-300">+</span>
          <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700">{extraSupportCount}</span>
          {/* 合計圓形 */}
          <div className="ml-1 w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
            {rowTotal}
          </div>
        </div>
      </div>

      {/* 展開：人員清單 + 編輯 + 額外支援預留 */}
      {expanded && (
        <div className="bg-teal-50/40 border-t border-teal-100 px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 size={14} className="animate-spin" /> 載入中...
            </div>
          ) : (
            <>
              {/* 標題列 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-700 uppercase tracking-wide">
                  <UserCheck size={13} />
                  本店人員名單（{staff.length} 人）
                </div>
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-teal-300 text-teal-700 rounded-lg hover:bg-teal-50 font-medium"
                  >
                    <Pencil size={12} />
                    編輯人員
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancelEdit}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100"
                    >
                      <RotateCcw size={11} /> 取消
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 font-medium"
                    >
                      {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      {saving ? '儲存中...' : '儲存'}
                    </button>
                  </div>
                )}
              </div>

              {/* 編輯模式：搜尋新增列 */}
              {editing && (
                <div className="mb-3 relative" ref={searchRef}>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="輸入員編或姓名搜尋員工來新增..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
                    />
                    {searchLoading && (
                      <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                    )}
                  </div>
                  {showDropdown && (
                    <div className="absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-52 overflow-y-auto">
                      {searchNotFound ? (
                        <div className="px-4 py-3 text-sm text-amber-600 bg-amber-50 rounded-xl">
                          查無此人員，若為未來入職請洽營業部新增人員異動
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-400">無符合結果</div>
                      ) : (
                        searchResults.map(emp => {
                          const alreadyAdded = staff.some(s => s.employee_code === emp.employee_code);
                          return (
                            <button
                              key={emp.employee_code}
                              onClick={() => !alreadyAdded && handleAddEmployee(emp)}
                              disabled={alreadyAdded}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${alreadyAdded ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-teal-50'}`}
                            >
                              <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold shrink-0">
                                {emp.employee_name?.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900">{emp.employee_name}</div>
                                <div className="text-xs text-gray-400">{emp.position} · {emp.employee_code}</div>
                              </div>
                              {emp.from_store_name && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded shrink-0">{emp.from_store_name}</span>
                              )}
                              {emp.source === 'movement_history' && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">人員異動</span>
                              )}
                              {alreadyAdded && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded shrink-0">已加入</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 人員卡片列表 */}
              {staff.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {staff.map(emp => (
                    <div
                      key={emp.employee_code}
                      className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-teal-100 shadow-sm group"
                    >
                      <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xs font-bold shrink-0">
                        {emp.employee_name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{emp.employee_name}</div>
                        <div className="text-xs text-gray-400">{emp.position} · {emp.employee_code}</div>
                        {emp.is_manually_added && (
                          <span className="text-xs bg-amber-100 text-amber-700 rounded px-1">手動</span>
                        )}
                      </div>
                      {editing && (
                        <button
                          onClick={() => handleRemove(emp.employee_code)}
                          className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 py-1">尚無本店人員資料</p>
              )}

              {/* ── 額外支援區（預留，未來可在此新增/刪除支援人員）── */}
              {extraSupportCount > 0 && (
                <div className="mt-4 pt-3 border-t border-indigo-100">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
                    <Users size={13} />
                    額外支援（{extraSupportCount} 人）
                  </div>
                  <p className="text-xs text-indigo-500 bg-indigo-50 rounded-lg px-3 py-2">
                    已有 {extraSupportCount} 位額外支援人員，支援人員詳細管理功能即將推出。
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- 主 Modal ---
export default function StaffOverviewModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  managedStores,
  headcountMap,
  onHeadcountUpdated,
}: StaffOverviewModalProps) {
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (isOpen) setLocalCounts({});
  }, [isOpen]);

  const handleCountChanged = (storeId: string, count: number) => {
    setLocalCounts(prev => ({ ...prev, [storeId]: count }));
    onHeadcountUpdated?.();
  };

  if (!isOpen) return null;

  const sortedStores = [...managedStores].sort((a, b) => a.store_code.localeCompare(b.store_code));
  const totalOwn = sortedStores.reduce((s, st) => s + (localCounts[st.id] ?? headcountMap[st.id]?.own_staff_count ?? 0), 0);
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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-teal-700 font-semibold">總計：</span>
            <span className="text-gray-700">本店人員 <span className="font-bold text-gray-900">{totalOwn}</span> 人</span>
            <span className="text-gray-700">督導 <span className="font-bold text-purple-700">{totalSup}</span> 人</span>
            <span className="text-gray-700">額外支援 <span className="font-bold text-indigo-700">+{totalExtra}</span> 人</span>
            <span className="ml-auto text-base font-bold text-teal-700">合計 {grandTotal} 人</span>
          </div>
        </div>

        {/* 欄位說明 */}
        <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-400 shrink-0 flex items-center gap-4">
          <span>點擊</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-700 font-semibold">青綠 = 本店</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold">紫色 = 督導</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">靛色 = 支援</span>
          <span className="ml-auto">點擊青綠數字可展開編輯本店人員</span>
        </div>

        {/* 門市列表 */}
        <div className="flex-1 overflow-y-auto relative">
          {sortedStores.map(store => (
            <StoreOwnStaffPanel
              key={store.id}
              campaignId={campaignId}
              store={store}
              initialCount={localCounts[store.id] ?? headcountMap[store.id]?.own_staff_count ?? 0}
              supervisorCount={headcountMap[store.id]?.supervisor_count ?? 0}
              extraSupportCount={headcountMap[store.id]?.extra_support_count ?? 0}
              onCountChanged={handleCountChanged}
            />
          ))}
          {sortedStores.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">無管理門市資料</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
