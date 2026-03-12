'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Users, ChevronDown, ChevronRight, Loader2, UserCheck,
  Pencil, Trash2, Search, Save, RotateCcw, Check, ArrowRightLeft,
} from 'lucide-react';
import SupportRequestModal from '@/components/SupportRequestModal';

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

  // 掛載時抓取最新數字（不依賴父層 headcountMap）
  const [freshOwnCount, setFreshOwnCount] = useState<number | null>(null);
  const [freshExtraCount, setFreshExtraCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const [ownRes, hcRes] = await Promise.all([
          fetch(`/api/campaign-store-own-staff?campaign_id=${campaignId}&store_id=${store.id}`),
          fetch(`/api/campaign-store-headcount?campaign_id=${campaignId}&store_id=${store.id}`),
        ]);
        const [ownData, hcData] = await Promise.all([ownRes.json(), hcRes.json()]);
        if (cancelled) return;
        if (ownData.success) {
          const count = (ownData.data || []).length;
          setFreshOwnCount(count);
          setHasLoaded(true);
          setStaff(ownData.data || []);
        }
        if (hcData.success && hcData.data?.length > 0) {
          setFreshExtraCount(hcData.data[0].extra_support_count ?? 0);
        } else if (hcData.success) {
          setFreshExtraCount(extraSupportCount);
        }
      } catch {}
    };
    fetchCounts();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, store.id]);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<StaffMember[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // 額外支援人數 inline 編輯
  const [editingExtra, setEditingExtra] = useState(false);
  const [localExtraCount, setLocalExtraCount] = useState(extraSupportCount);
  const [extraInput, setExtraInput] = useState(String(extraSupportCount));
  const [savingExtra, setSavingExtra] = useState(false);
  const extraInputRef = useRef<HTMLInputElement>(null);

  // freshExtraCount 一旦抓到就同步到 localExtraCount（若不在編輯中）
  useEffect(() => {
    if (freshExtraCount !== null && !editingExtra) {
      setLocalExtraCount(freshExtraCount);
      setExtraInput(String(freshExtraCount));
    }
  }, [freshExtraCount, editingExtra]);

  // 支援來源資訊（從哪間門市被指派過來的人員）
  const [incomingSupport, setIncomingSupport] = useState<{
    requestId: string;
    supportingStoreName: string;
    supportingStoreCode: string;
    activityDate: string;
    requestedCount: number;
    assignedStaff: { employee_code: string; employee_name: string; position: string }[];
  }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadSupport = async () => {
      try {
        const [reqRes, staffRes, schRes] = await Promise.all([
          fetch(`/api/campaign-support-requests?campaign_id=${campaignId}&requesting_store_id=${store.id}`),
          fetch(`/api/campaign-support-staff?campaign_id=${campaignId}`),
          fetch(`/api/campaign-schedules?campaign_id=${campaignId}`),
        ]);
        const [reqData, staffData, schData] = await Promise.all([
          reqRes.json(), staffRes.json(), schRes.json(),
        ]);
        if (cancelled) return;
        const allStaff: any[] = staffData.success ? (staffData.data || []) : [];
        const schedules: any[] = schData.success ? (schData.data || schData.schedules || []) : [];
        const dateByStore: Record<string, string> = {};
        for (const s of schedules) { if (s.store_id && s.activity_date) dateByStore[s.store_id] = s.activity_date; }
        const requests: any[] = reqData.success ? (reqData.data || []) : [];
        setIncomingSupport(requests.map((req: any) => ({
          requestId: req.id,
          supportingStoreName: req.supporting_store?.store_name || '未知',
          supportingStoreCode: req.supporting_store?.store_code || '',
          activityDate: dateByStore[store.id] || '',
          requestedCount: req.requested_count ?? 1,
          assignedStaff: allStaff
            .filter((s: any) => s.support_request_id === req.id)
            .map((s: any) => ({ employee_code: s.employee_code, employee_name: s.employee_name, position: s.position || '' })),
        })));
      } catch {}
    };
    loadSupport();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, store.id]);

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
        setFreshOwnCount((data.data || []).length);
        setHasLoaded(true);
      }
    } catch {}
    setLoading(false);
  }, [campaignId, store.id]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    // hasLoaded 已在 mount 時設好，無需重複 fetch
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setSearch('');
    setShowDropdown(false);
    fetchStaff(); // 重新載入最新名單
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

  const handleStartEditExtra = () => {
    setExtraInput(String(localExtraCount));
    setEditingExtra(true);
    setTimeout(() => extraInputRef.current?.select(), 50);
  };

  const handleSaveExtra = async () => {
    const newCount = Math.max(0, parseInt(extraInput, 10) || 0);
    setSavingExtra(true);
    try {
      const res = await fetch('/api/campaign-store-headcount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          store_id: store.id,
          extra_support_count: newCount,
          supervisor_count: supervisorCount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLocalExtraCount(newCount);
        setFreshExtraCount(newCount);
        setEditingExtra(false);
      } else {
        alert(`儲存失敗：${data.error}`);
      }
    } catch {
      alert('網路錯誤，請重試');
    } finally {
      setSavingExtra(false);
    }
  };

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
        setFreshOwnCount(staff.length);
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

  // freshOwnCount 優先；尚未抓到時用 initialCount（parent 的舊值）作 placeholder
  const displayCount = freshOwnCount !== null ? freshOwnCount : initialCount;
  // 若正在編輯中（staff 陣列已被本地修改），顯示即時 staff.length
  const liveCount = editing ? staff.length : displayCount;

  const rowTotal = liveCount + supervisorCount + localExtraCount;

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
            {(loading || freshOwnCount === null) ? <Loader2 size={11} className="animate-spin" /> : (expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)}
            {freshOwnCount !== null ? liveCount : <span className="w-4 inline-block" />}
          </button>
          <span className="text-gray-300">+</span>
          <span className="px-2 py-1 rounded-lg bg-purple-50 text-purple-700">{supervisorCount}</span>
          <span className="text-gray-300">+</span>
          {/* 額外支援：可 inline 編輯數字 */}
          {editingExtra ? (
            <div className="flex items-center gap-1">
              <input
                ref={extraInputRef}
                type="number"
                min={0}
                value={extraInput}
                onChange={e => setExtraInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveExtra(); if (e.key === 'Escape') setEditingExtra(false); }}
                className="w-14 px-1.5 py-0.5 text-sm font-semibold text-indigo-700 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-center"
              />
              <button onClick={handleSaveExtra} disabled={savingExtra} className="p-1 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 disabled:opacity-50" title="確認">
                {savingExtra ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              </button>
              <button onClick={() => setEditingExtra(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400" title="取消">
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartEditExtra}
              title="點擊變更支援人數"
              className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors cursor-pointer"
            >
              {localExtraCount}
            </button>
          )}
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

              {/* ── 支援來源清單 ── */}
              {incomingSupport.length > 0 && (
                <div className="mt-4 pt-3 border-t border-indigo-100">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
                    <Users size={13} />
                    支援來源（{incomingSupport.reduce((n, r) => n + r.assignedStaff.length, 0)} 人已指派）
                  </div>
                  <div className="space-y-1.5">
                    {incomingSupport.map(req => (
                      <div key={req.requestId} className="rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-indigo-800">{req.supportingStoreName}</span>
                          <span className="text-xs text-indigo-400 font-mono">{req.supportingStoreCode}</span>
                          {req.activityDate && (
                            <span className="text-xs text-purple-700 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded font-semibold">
                              {new Date(req.activityDate).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })}
                            </span>
                          )}
                          {req.assignedStaff.length === 0 ? (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">應派 {req.requestedCount} 人，尚未指派</span>
                          ) : (
                            <span className="text-xs text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">✓ {req.assignedStaff.length} 人</span>
                          )}
                        </div>
                        {req.assignedStaff.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {req.assignedStaff.map(s => (
                              <div key={s.employee_code} className="flex items-center gap-1 bg-white border border-indigo-100 rounded px-1.5 py-0.5 text-xs">
                                <span className="font-mono text-gray-400">{s.employee_code}</span>
                                <span className="text-gray-800 font-medium">{s.employee_name}</span>
                                {s.position && <span className="text-gray-400">· {s.position}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- 支援分配 Tab ---
// 視角：每間「支援門市」要去支援哪些地方
function SupportAssignmentTab({
  campaignId,
  campaignName,
  managedStores,
}: { campaignId: string; campaignName: string; managedStores: ManagedStore[] }) {
  const managedStoreIds = managedStores.map(s => s.id);
  const [loading, setLoading] = useState(true);
  const [assigningStore, setAssigningStore] = useState<ManagedStore | null>(null);

  // 以 supporting_store_id 分組的資料
  type SupportGroup = {
    supportingStoreId: string;
    supportingStoreName: string;
    supportingStoreCode: string;
    assignments: {
      requestId: string;
      requestingStore: { id: string; store_code: string; store_name: string } | null;
      requestedCount: number;
      activityDate: string;
      assignedStaff: { employee_code: string; employee_name: string; position: string }[];
    }[];
  };
  const [groups, setGroups] = useState<SupportGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [reqRes, staffRes, schRes] = await Promise.all([
          fetch(`/api/campaign-support-requests?campaign_id=${campaignId}`),
          fetch(`/api/campaign-support-staff?campaign_id=${campaignId}`),
          fetch(`/api/campaign-schedules?campaign_id=${campaignId}`),
        ]);
        const [reqData, staffData, schData] = await Promise.all([
          reqRes.json(), staffRes.json(), schRes.json(),
        ]);
        if (cancelled) return;

        const allStaff: any[] = staffData.success ? (staffData.data || []) : [];
        const schedules: any[] = schData.success ? (schData.data || schData.schedules || []) : [];
        const requests: any[] = reqData.success ? (reqData.data || []) : [];

        // 日期以需求門市 store_id 為鍵
        const dateByStore: Record<string, string> = {};
        for (const s of schedules) {
          if (s.store_id && s.activity_date) dateByStore[s.store_id] = s.activity_date;
        }

        // 依 supporting_store_id 分組
        const groupMap = new Map<string, SupportGroup>();
        for (const req of requests) {
          const supStore = req.supporting_store ?? null;
          if (!supStore) continue;
          const supId: string = supStore.id;

          // 权限過濾：若 managedStoreIds 非空，只保留該管轄的支援門市
          if (managedStoreIds.length > 0 && !managedStoreIds.includes(supId)) continue;

          if (!groupMap.has(supId)) {
            groupMap.set(supId, {
              supportingStoreId: supId,
              supportingStoreName: supStore.store_name,
              supportingStoreCode: supStore.store_code,
              assignments: [],
            });
          }

          const assigned = allStaff
            .filter((s: any) => s.support_request_id === req.id)
            .map((s: any) => ({
              employee_code: s.employee_code,
              employee_name: s.employee_name,
              position: s.position || '',
            }));

          groupMap.get(supId)!.assignments.push({
            requestId: req.id,
            requestingStore: req.requesting_store ?? null,
            requestedCount: req.requested_count ?? 1,
            activityDate: req.requesting_store_id ? (dateByStore[req.requesting_store_id] || '') : '',
            assignedStaff: assigned,
          });
        }

        // 依門市代碼排序，內部依日期排序
        const sorted = Array.from(groupMap.values()).sort((a, b) =>
          a.supportingStoreCode.localeCompare(b.supportingStoreCode)
        );
        for (const g of sorted) {
          g.assignments.sort((a, b) => (a.activityDate || '').localeCompare(b.activityDate || ''));
        }
        setGroups(sorted);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [campaignId, managedStoreIds.join(',')]);

  const formatDate = (d: string) => {
    if (!d) return '未排期';
    try { return new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }); } catch { return d; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> 載入支援分配資訊...
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
        <ArrowRightLeft size={32} className="text-gray-300" />
        <p className="text-sm">{managedStoreIds.length > 0 ? '管轄門市無外出支援安排' : '本活動尚未設定任何跨店支援請求'}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {groups.map((group) => (
        <div key={group.supportingStoreId} className="px-6 py-4">
          {/* 支援門市標題 */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="font-semibold text-gray-900">{group.supportingStoreName}</span>
            <span className="text-xs text-gray-400 font-mono">{group.supportingStoreCode}</span>
            <span className="ml-auto text-xs text-gray-400">共 {group.assignments.length} 項支援安排</span>
          </div>

          {/* 該門市要去支援的地方 */}
          <div className="space-y-2 pl-4">
            {group.assignments.map((a) => (
              <div key={a.requestId} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* 去支援哪間店 */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800">前往支援「{a.requestingStore?.store_name ?? '未知'}」</span>
                    <span className="ml-1 text-xs text-gray-400 font-mono">{a.requestingStore?.store_code}</span>
                  </div>
                  {/* 日期 */}
                  <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded whitespace-nowrap">
                    {formatDate(a.activityDate)}
                  </span>
                  {/* 需要多少人 */}
                  {a.assignedStaff.length === 0 ? (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded whitespace-nowrap">
                      應活派 {a.requestedCount} 人，尚未指派
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded whitespace-nowrap">
                      ✓ 已指派 {a.assignedStaff.length} 人
                    </span>
                  )}
                  {/* 指派人員按鈕 */}
                  <button
                    onClick={() => {
                      const store = managedStores.find(s => s.id === group.supportingStoreId);
                      if (store) setAssigningStore(store);
                    }}
                    className="shrink-0 text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium whitespace-nowrap"
                  >
                    指派人員
                  </button>
                </div>
                {/* 已指派人員 */}
                {a.assignedStaff.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.assignedStaff.map((s) => (
                      <div key={s.employee_code} className="flex items-center gap-1 bg-white border border-teal-100 rounded px-2 py-0.5 text-xs">
                        <span className="font-mono text-gray-400">{s.employee_code}</span>
                        <span className="text-gray-800 font-medium">{s.employee_name}</span>
                        {s.position && <span className="text-gray-400">· {s.position}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {assigningStore && (
        <SupportRequestModal
          isOpen={true}
          onClose={() => setAssigningStore(null)}
          campaignId={campaignId}
          campaignName={campaignName}
          managedStores={[managedStores.find(s => s.id === assigningStore.id)!]}
          canAssign={true}
        />
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
  const [activeTab, setActiveTab] = useState<'overview' | 'support'>('overview');

  // Modal 開啟時重取最新資料
  useEffect(() => {
    if (isOpen) {
      setLocalCounts({});
      onHeadcountUpdated?.();
    }
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
    <>
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

        {/* Tab 列 */}
        <div className="px-6 border-b border-gray-200 shrink-0 flex gap-0">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users size={14} />
            人力總覽
          </button>
          <button
            onClick={() => setActiveTab('support')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'support'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ArrowRightLeft size={14} />
            支援分配
          </button>
        </div>

        {/* 合計列（僅人力總覽 tab 顯示） */}
        {activeTab === 'overview' && (
          <div className="px-6 py-3 bg-teal-50 border-b border-teal-100 shrink-0">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-teal-700 font-semibold">總計：</span>
              <span className="text-gray-700">本店人員 <span className="font-bold text-gray-900">{totalOwn}</span> 人</span>
              <span className="text-gray-700">督導 <span className="font-bold text-purple-700">{totalSup}</span> 人</span>
              <span className="text-gray-700">額外支援 <span className="font-bold text-indigo-700">+{totalExtra}</span> 人</span>
              <span className="ml-auto text-base font-bold text-teal-700">合計 {grandTotal} 人</span>
            </div>
          </div>
        )}

        {/* 欄位說明（僅人力總覽 tab 顯示） */}
        {activeTab === 'overview' && (
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-400 shrink-0 flex items-center gap-4">
            <span>點擊</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 text-teal-700 font-semibold">青綠 = 本店</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold">紫色 = 督導</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">靛色 = 支援</span>
            <span className="ml-auto">青綠展開本店人員 ・ 靛色管理支援指派</span>
          </div>
        )}

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto relative">
          {activeTab === 'overview' ? (
            <>
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
            </>
          ) : (
            <>
              <SupportAssignmentTab
                campaignId={campaignId}
                campaignName={campaignName}
                managedStores={managedStores}
              />
            </>
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

  </>
  );
}
