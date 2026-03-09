'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Loader2, Users, Store, Search, RotateCcw, Save, ChevronDown } from 'lucide-react';

interface OwnStaff {
  id?: string;
  employee_code: string;
  employee_name: string;
  position: string;
  is_manually_added?: boolean;
}

interface SupportRequest {
  id?: string;
  supporting_store_id: string;
  supporting_store_code: string;
  supporting_store_name: string;
  requested_count: number;
  notes: string;
  // 已指派人員（由支援方填入，只讀顯示）
  assigned_staff?: { employee_code: string; employee_name: string; position: string }[];
}

interface StoreOption {
  id: string;
  store_code: string;
  store_name: string;
}

interface StoreSupportEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  storeId: string;
  storeName: string;
  activityName: string;
  activityDate?: string;  // 活動日期（用來推算要抓哪個月的人員）
  canEditOwnStaff: boolean;      // Permission 1：可編輯本店人員
  canEditSupportRequest: boolean; // Permission 2：可設定支援需求
  allStores: StoreOption[];       // 所有門市（用於下拉選單）
}

export default function StoreSupportEditModal({
  isOpen,
  onClose,
  campaignId,
  storeId,
  storeName,
  activityName,
  activityDate,
  canEditOwnStaff,
  canEditSupportRequest,
  allStores,
}: StoreSupportEditModalProps) {
  // ======== Tab ========
  const [activeTab, setActiveTab] = useState<'own_staff' | 'support_request'>('own_staff');

  // ======== 本店人員 ========
  const [ownStaff, setOwnStaff] = useState<OwnStaff[]>([]);
  const [ownStaffLoading, setOwnStaffLoading] = useState(false);
  const [ownStaffSaving, setOwnStaffSaving] = useState(false);
  const [ownStaffEditing, setOwnStaffEditing] = useState(false);
  const [sourceYearMonth, setSourceYearMonth] = useState<string | null>(null);

  // 新增人員搜尋
  const [addSearch, setAddSearch] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<OwnStaff[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const addSearchRef = useRef<HTMLDivElement>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);

  // ======== 支援需求 ========
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [supportRequestsLoading, setSupportRequestsLoading] = useState(false);
  const [supportRequestsSaving, setSupportRequestsSaving] = useState(false);
  const [supportEditing, setSupportEditing] = useState(false);

  // 新增支援需求的門市搜尋
  const [storeSearch, setStoreSearch] = useState('');
  const [showStoreDropdown, setShowStoreDropdown] = useState(false);
  const storeSearchRef = useRef<HTMLDivElement>(null);

  // ======== 載入資料 ========
  const loadOwnStaff = useCallback(async () => {
    if (!campaignId || !storeId) return;
    setOwnStaffLoading(true);
    try {
      const res = await fetch(`/api/campaign-store-own-staff?campaign_id=${campaignId}&store_id=${storeId}`);
      const data = await res.json();
      if (data.success) {
        setOwnStaff(data.data || []);
      }
    } catch (err) {
      console.error('Error loading own staff:', err);
    } finally {
      setOwnStaffLoading(false);
    }
  }, [campaignId, storeId]);

  // 從每月人員狀態預先載入本店人員（用於初始填入）
  const loadFromMonthlyStatus = useCallback(async () => {
    if (!storeId) return;
    setOwnStaffLoading(true);
    try {
      // 不傳 year_month，讓 API 自動找最近有資料的月份（活動通常處於策畫中，尚無未來月份資料）
      const url = `/api/monthly-staff-by-store?store_id=${storeId}`;

      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        const staff: OwnStaff[] = (data.data || []).map((e: any) => ({
          employee_code: e.employee_code || '',
          employee_name: e.employee_name || '',
          position: e.position || '',
          is_manually_added: false,
        }));
        setOwnStaff(staff);
        setSourceYearMonth(data.year_month);
      }
    } catch (err) {
      console.error('Error loading from monthly status:', err);
    } finally {
      setOwnStaffLoading(false);
    }
  }, [storeId, activityDate]);

  const loadSupportRequests = useCallback(async () => {
    if (!campaignId || !storeId) return;
    setSupportRequestsLoading(true);
    try {
      const res = await fetch(`/api/campaign-support-requests?campaign_id=${campaignId}&requesting_store_id=${storeId}`);
      const data = await res.json();
      if (data.success) {
        // 同時取得每個支援需求的已指派人員
        const requests: SupportRequest[] = await Promise.all(
          (data.data || []).map(async (req: any) => {
            let assignedStaff: any[] = [];
            try {
              const staffRes = await fetch(`/api/campaign-support-staff?campaign_id=${campaignId}&support_request_id=${req.id}`);
              const staffData = await staffRes.json();
              if (staffData.success) assignedStaff = staffData.data || [];
            } catch {}
            return {
              id: req.id,
              supporting_store_id: req.supporting_store_id,
              supporting_store_code: req.supporting_store?.store_code || '',
              supporting_store_name: req.supporting_store?.store_name || '',
              requested_count: req.requested_count,
              notes: req.notes || '',
              assigned_staff: assignedStaff.map((s: any) => ({
                employee_code: s.employee_code,
                employee_name: s.employee_name,
                position: s.position || '',
              })),
            };
          })
        );
        setSupportRequests(requests);
      }
    } catch (err) {
      console.error('Error loading support requests:', err);
    } finally {
      setSupportRequestsLoading(false);
    }
  }, [campaignId, storeId]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('own_staff');
      setOwnStaffEditing(false);
      setSupportEditing(false);
      setAddSearch('');
      setStoreSearch('');
      loadOwnStaff();
      loadSupportRequests();
    }
  }, [isOpen, loadOwnStaff, loadSupportRequests]);

  // 點擊外部關閉下拉
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (addSearchRef.current && !addSearchRef.current.contains(e.target as Node)) {
        setShowAddDropdown(false);
      }
      if (storeSearchRef.current && !storeSearchRef.current.contains(e.target as Node)) {
        setShowStoreDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // ======== 員工搜尋（新增人員） ========
  useEffect(() => {
    if (!addSearch || addSearch.length < 1) {
      setAddSearchResults([]);
      setShowAddDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setAddSearchLoading(true);
      try {
        const res = await fetch(`/api/monthly-staff-by-store/search?q=${encodeURIComponent(addSearch)}&store_id=${storeId}`);
        const data = await res.json();
        if (data.success) {
          setAddSearchResults(data.data || []);
          setShowAddDropdown(true);
        }
      } catch {}
      setAddSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [addSearch, storeId]);

  // ======== 本店人員操作 ========
  const handleAddEmployee = (emp: OwnStaff) => {
    if (ownStaff.some(s => s.employee_code === emp.employee_code)) {
      setAddSearch('');
      setShowAddDropdown(false);
      return;
    }
    setOwnStaff(prev => [...prev, { ...emp, is_manually_added: true }]);
    setAddSearch('');
    setShowAddDropdown(false);
  };

  const handleRemoveEmployee = (code: string) => {
    setOwnStaff(prev => prev.filter(s => s.employee_code !== code));
  };

  const handleOwnStaffSave = async () => {
    setOwnStaffSaving(true);
    try {
      const res = await fetch('/api/campaign-store-own-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          store_id: storeId,
          staff: ownStaff,
          replace: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOwnStaffEditing(false);
      } else {
        alert(`儲存失敗：${data.error}`);
      }
    } catch (err) {
      alert('網路錯誤，請重試');
    } finally {
      setOwnStaffSaving(false);
    }
  };

  // 從每月狀態重新載入（覆蓋當前編輯）
  const handleReloadFromMonthly = async () => {
    if (!confirm('將從每月人員狀態重新載入本店人員，覆蓋目前的變更，確定嗎？')) return;
    await loadFromMonthlyStatus();
  };

  // ======== 支援需求操作 ========
  const filteredStores = allStores.filter(s => {
    if (s.id === storeId) return false; // 不顯示本店
    if (!storeSearch) return true;
    const q = storeSearch.toLowerCase();
    return s.store_code.toLowerCase().includes(q) || s.store_name.toLowerCase().includes(q);
  }).slice(0, 10);

  const handleAddSupportRequest = (store: StoreOption) => {
    if (supportRequests.some(r => r.supporting_store_id === store.id)) {
      setStoreSearch('');
      setShowStoreDropdown(false);
      return;
    }
    setSupportRequests(prev => [...prev, {
      supporting_store_id: store.id,
      supporting_store_code: store.store_code,
      supporting_store_name: store.store_name,
      requested_count: 1,
      notes: '',
      assigned_staff: [],
    }]);
    setStoreSearch('');
    setShowStoreDropdown(false);
  };

  const handleRemoveSupportRequest = (storeId: string, requestId?: string) => {
    setSupportRequests(prev => prev.filter(r => r.supporting_store_id !== storeId));
  };

  const handleSupportRequestCountChange = (supportingStoreId: string, count: number) => {
    setSupportRequests(prev => prev.map(r =>
      r.supporting_store_id === supportingStoreId ? { ...r, requested_count: count } : r
    ));
  };

  const handleSupportRequestNotesChange = (supportingStoreId: string, notes: string) => {
    setSupportRequests(prev => prev.map(r =>
      r.supporting_store_id === supportingStoreId ? { ...r, notes } : r
    ));
  };

  const handleSupportRequestsSave = async () => {
    setSupportRequestsSaving(true);
    try {
      // 先取得現有的支援需求（以便刪除已移除的）
      const existingRes = await fetch(`/api/campaign-support-requests?campaign_id=${campaignId}&requesting_store_id=${storeId}`);
      const existingData = await existingRes.json();
      const existing: any[] = existingData.success ? existingData.data : [];

      // 找出需要刪除的（在 existing 中但不在 supportRequests 中）
      const currentIds = new Set(supportRequests.map(r => r.supporting_store_id));
      const toDelete = existing.filter((e: any) => !currentIds.has(e.supporting_store_id));

      // 刪除移除的
      for (const del of toDelete) {
        await fetch('/api/campaign-support-requests', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: del.id }),
        });
      }

      // upsert 現有的
      for (const req of supportRequests) {
        await fetch('/api/campaign-support-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignId,
            requesting_store_id: storeId,
            supporting_store_id: req.supporting_store_id,
            requested_count: req.requested_count,
            notes: req.notes,
          }),
        });
      }

      setSupportEditing(false);
      // 重新載入以取得 id
      await loadSupportRequests();
    } catch (err) {
      alert('儲存失敗，請重試');
    } finally {
      setSupportRequestsSaving(false);
    }
  };

  if (!isOpen) return null;

  const dateLabel = activityDate
    ? new Date(activityDate).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';

  const canViewAtAll = canEditOwnStaff || canEditSupportRequest;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl min-h-[60vh] max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-t-xl">
          <div>
            <div className="flex items-center gap-2">
              <Users size={20} />
              <h2 className="text-xl font-bold">分店支援設定</h2>
            </div>
            <p className="text-sm text-white/70 mt-0.5">{storeName} · {activityName}{dateLabel && ` · ${dateLabel}`}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tab 切換 */}
        {canViewAtAll && (
          <div className="flex gap-1 px-6 pt-4 border-b border-gray-200">
            {canEditOwnStaff && (
              <button
                onClick={() => setActiveTab('own_staff')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                  activeTab === 'own_staff'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Users size={15} />
                本店人員
                {ownStaff.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs">
                    {ownStaff.length}
                  </span>
                )}
              </button>
            )}
            {canEditSupportRequest && (
              <button
                onClick={() => setActiveTab('support_request')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                  activeTab === 'support_request'
                    ? 'border-teal-600 text-teal-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Store size={15} />
                支援需求
                {supportRequests.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs">
                    {supportRequests.length}
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ===== Tab 1: 本店人員 ===== */}
          {activeTab === 'own_staff' && canEditOwnStaff && (
            <div>
              {ownStaffLoading ? (
                <div className="flex justify-center py-10 text-gray-400">
                  <Loader2 size={28} className="animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 資料來源說明 */}
                  {sourceYearMonth && (
                    <div className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      📋 已從每月人員狀態（{sourceYearMonth.replace('-', ' 年 ')} 月）預先載入本店人員
                    </div>
                  )}

                  {/* 人員列表 */}
                  {ownStaff.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                      <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>尚無本店人員資料</p>
                      {ownStaffEditing && (
                        <button
                          onClick={handleReloadFromMonthly}
                          className="mt-3 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          從每月人員狀態載入
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-teal-50 border-b border-teal-100">
                          <tr>
                            <th className="text-left px-4 py-2.5 font-semibold text-teal-800">員編</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-teal-800">姓名</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-teal-800">職位</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-teal-800">來源</th>
                            {ownStaffEditing && (
                              <th className="text-center px-4 py-2.5 font-semibold text-teal-800">操作</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {ownStaff.map((emp) => (
                            <tr key={emp.employee_code} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{emp.employee_code}</td>
                              <td className="px-4 py-2.5 font-medium text-gray-900">{emp.employee_name}</td>
                              <td className="px-4 py-2.5 text-gray-600">{emp.position || '—'}</td>
                              <td className="px-4 py-2.5">
                                {emp.is_manually_added ? (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">手動</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">系統</span>
                                )}
                              </td>
                              {ownStaffEditing && (
                                <td className="px-4 py-2.5 text-center">
                                  <button
                                    onClick={() => handleRemoveEmployee(emp.employee_code)}
                                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                    title="移除"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* 編輯模式：新增人員搜尋 */}
                  {ownStaffEditing && (
                    <div>
                      <div ref={addSearchRef} className="relative">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={addSearch}
                              onChange={e => setAddSearch(e.target.value)}
                              onFocus={() => addSearchResults.length > 0 && setShowAddDropdown(true)}
                              placeholder="輸入員編或姓名搜尋員工..."
                              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                            {addSearchLoading && (
                              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                            )}
                          </div>
                        </div>
                        {showAddDropdown && addSearchResults.length > 0 && (
                          <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            {addSearchResults.map(emp => (
                              <button
                                key={emp.employee_code}
                                onClick={() => handleAddEmployee(emp)}
                                className="w-full text-left px-4 py-2.5 hover:bg-teal-50 transition-colors border-b border-gray-100 last:border-0"
                              >
                                <span className="font-medium text-gray-900">{emp.employee_name}</span>
                                <span className="ml-2 text-xs text-gray-500 font-mono">{emp.employee_code}</span>
                                {emp.position && <span className="ml-2 text-xs text-gray-500">{emp.position}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleReloadFromMonthly}
                        className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <RotateCcw size={11} />
                        從每月人員狀態重新載入
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== Tab 2: 支援需求 ===== */}
          {activeTab === 'support_request' && canEditSupportRequest && (
            <div className="space-y-4">
              {supportRequestsLoading ? (
                <div className="flex justify-center py-10 text-gray-400">
                  <Loader2 size={28} className="animate-spin" />
                </div>
              ) : (
                <>
                  {supportRequests.length === 0 && !supportEditing && (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                      <Store className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>尚無支援需求設定</p>
                    </div>
                  )}

                  {/* 支援需求列表 */}
                  {supportRequests.map((req) => (
                    <div key={req.supporting_store_id} className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Store size={16} className="text-teal-600" />
                            <span className="font-medium text-gray-900">{req.supporting_store_name}</span>
                            <span className="text-xs text-gray-500 font-mono">{req.supporting_store_code}</span>
                          </div>

                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <label className="text-gray-600 shrink-0">需求人數：</label>
                              {supportEditing ? (
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={req.requested_count}
                                  onChange={e => handleSupportRequestCountChange(req.supporting_store_id, parseInt(e.target.value) || 1)}
                                  className="w-16 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent text-center"
                                />
                              ) : (
                                <span className="font-bold text-teal-700 text-base">{req.requested_count} 人</span>
                              )}
                            </div>
                          </div>

                          {supportEditing ? (
                            <div className="mt-2">
                              <label className="text-xs text-gray-500">備註</label>
                              <input
                                type="text"
                                value={req.notes}
                                onChange={e => handleSupportRequestNotesChange(req.supporting_store_id, e.target.value)}
                                placeholder="備註（選填）"
                                className="w-full mt-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                            </div>
                          ) : req.notes ? (
                            <p className="text-xs text-gray-500 mt-1">{req.notes}</p>
                          ) : null}

                          {/* 已指派人員（只讀） */}
                          {req.assigned_staff && req.assigned_staff.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <p className="text-xs text-gray-500 mb-1.5">已指派支援人員（{req.assigned_staff.length}/{req.requested_count}）：</p>
                              <div className="flex flex-wrap gap-1.5">
                                {req.assigned_staff.map(s => (
                                  <span key={s.employee_code} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 border border-green-200 text-green-800 rounded text-xs">
                                    {s.employee_name}
                                    {s.position && <span className="text-green-600">({s.position})</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {supportEditing && (
                          <button
                            onClick={() => handleRemoveSupportRequest(req.supporting_store_id, req.id)}
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg flex-shrink-0"
                            title="移除此支援需求"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* 編輯模式：新增支援門市 */}
                  {supportEditing && (
                    <div ref={storeSearchRef} className="relative">
                      <div className="flex items-center gap-2">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          value={storeSearch}
                          onChange={e => {
                            setStoreSearch(e.target.value);
                            setShowStoreDropdown(true);
                          }}
                          onFocus={() => setShowStoreDropdown(true)}
                          placeholder="輸入門市代號或名稱搜尋支援門市..."
                          className="w-full pl-8 pr-4 py-2 border border-dashed border-teal-400 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-teal-50"
                        />
                      </div>
                      {showStoreDropdown && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                          {filteredStores.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-400">找不到符合的門市</div>
                          ) : (
                            filteredStores.map(store => (
                              <button
                                key={store.id}
                                onClick={() => handleAddSupportRequest(store)}
                                className="w-full text-left px-4 py-2.5 hover:bg-teal-50 transition-colors border-b border-gray-100 last:border-0"
                                disabled={supportRequests.some(r => r.supporting_store_id === store.id)}
                              >
                                <span className="font-medium text-gray-900">{store.store_name}</span>
                                <span className="ml-2 text-xs text-gray-500 font-mono">{store.store_code}</span>
                                {supportRequests.some(r => r.supporting_store_id === store.id) && (
                                  <span className="ml-2 text-xs text-teal-600">（已加入）</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 無任何權限提示 */}
          {!canViewAtAll && (
            <div className="text-center py-12 text-gray-400">
              <p>您沒有查看此功能的權限</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-between items-center">
          <div className="flex gap-2">
            {/* 本店人員按鈕 */}
            {activeTab === 'own_staff' && canEditOwnStaff && (
              <>
                {!ownStaffEditing ? (
                  <button
                    onClick={() => setOwnStaffEditing(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                  >
                    編輯本店人員
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { setOwnStaffEditing(false); loadOwnStaff(); }}
                      className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
                    >
                      <RotateCcw size={14} />
                      取消
                    </button>
                    <button
                      onClick={handleOwnStaffSave}
                      disabled={ownStaffSaving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {ownStaffSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {ownStaffSaving ? '儲存中...' : '儲存'}
                    </button>
                  </>
                )}
              </>
            )}

            {/* 支援需求按鈕 */}
            {activeTab === 'support_request' && canEditSupportRequest && (
              <>
                {!supportEditing ? (
                  <button
                    onClick={() => setSupportEditing(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
                  >
                    編輯支援需求
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { setSupportEditing(false); loadSupportRequests(); }}
                      className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
                    >
                      <RotateCcw size={14} />
                      取消
                    </button>
                    <button
                      onClick={handleSupportRequestsSave}
                      disabled={supportRequestsSaving}
                      className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {supportRequestsSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {supportRequestsSaving ? '儲存中...' : '儲存'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
