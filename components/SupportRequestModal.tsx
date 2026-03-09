'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Users, Store, Search, Loader2, Plus, Trash2, Save, RotateCcw, ChevronDown, AlertCircle } from 'lucide-react';

interface SupportRequest {
  id: string;
  campaign_id: string;
  requesting_store_id: string;
  requesting_store_code: string;
  requesting_store_name: string;
  supporting_store_id: string;
  supporting_store_code: string;
  supporting_store_name: string;
  requested_count: number;
  notes: string;
}

interface StaffAssignment {
  id?: string;
  support_request_id: string;
  employee_code: string;
  employee_name: string;
  position: string;
}

interface EmployeeSearchResult {
  employee_code: string;
  employee_name: string;
  position: string;
  year_month?: string;
}

interface ManagedStore {
  id: string;
  store_code: string;
  store_name: string;
}

interface SupportRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  managedStores: ManagedStore[];  // 使用者管理的門市（即支援方門市）
  canAssign: boolean;             // 是否有指派支援人員的權限
}

export default function SupportRequestModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  managedStores,
  canAssign,
}: SupportRequestModalProps) {
  const [loading, setLoading] = useState(false);
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  // 每個請求的已指派人員 map: requestId -> StaffAssignment[]
  const [assignmentsMap, setAssignmentsMap] = useState<Record<string, StaffAssignment[]>>({});
  // 每個請求是否在編輯中
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  // 每個請求的暫存人員（編輯中）
  const [editingStaff, setEditingStaff] = useState<StaffAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  // 員工搜尋
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<EmployeeSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSearchRequestId, setActiveSearchRequestId] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    if (!campaignId || managedStores.length === 0) return;
    setLoading(true);
    try {
      // 查找所有我管理門市被請求支援的需求（supporting_store_id 在 managedStores 中）
      const allRequests: SupportRequest[] = [];
      for (const store of managedStores) {
        const res = await fetch(
          `/api/campaign-support-requests?campaign_id=${campaignId}&supporting_store_id=${store.id}`
        );
        const data = await res.json();
        if (data.success) {
          allRequests.push(
            ...(data.data || []).map((req: any) => ({
              id: req.id,
              campaign_id: req.campaign_id,
              requesting_store_id: req.requesting_store_id,
              requesting_store_code: req.requesting_store?.store_code || '',
              requesting_store_name: req.requesting_store?.store_name || '',
              supporting_store_id: req.supporting_store_id,
              supporting_store_code: store.store_code,
              supporting_store_name: store.store_name,
              requested_count: req.requested_count,
              notes: req.notes || '',
            }))
          );
        }
      }
      setSupportRequests(allRequests);

      // 載入每個請求的已指派人員
      const newAssignmentsMap: Record<string, StaffAssignment[]> = {};
      for (const req of allRequests) {
        const staffRes = await fetch(
          `/api/campaign-support-staff?campaign_id=${campaignId}&support_request_id=${req.id}`
        );
        const staffData = await staffRes.json();
        if (staffData.success) {
          newAssignmentsMap[req.id] = (staffData.data || []).map((s: any) => ({
            id: s.id,
            support_request_id: req.id,
            employee_code: s.employee_code,
            employee_name: s.employee_name,
            position: s.position || '',
          }));
        }
      }
      setAssignmentsMap(newAssignmentsMap);
    } catch (err) {
      console.error('Error loading support requests:', err);
    } finally {
      setLoading(false);
    }
  }, [campaignId, managedStores]);

  useEffect(() => {
    if (isOpen) {
      loadData();
      setEditingRequestId(null);
    }
  }, [isOpen, loadData]);

  // 點擊外部關閉搜尋下拉
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setActiveSearchRequestId(null);
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // 員工搜尋
  const handleSearchInput = async (requestId: string, value: string, supportingStoreId: string) => {
    setSearchInputs(prev => ({ ...prev, [requestId]: value }));
    setActiveSearchRequestId(requestId);

    if (!value || value.length < 1) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const res = await fetch(
        `/api/monthly-staff-by-store/search?q=${encodeURIComponent(value)}&store_id=${supportingStoreId}`
      );
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.data || []);
      }
    } catch {}
    setSearchLoading(false);
  };

  const handleAddStaff = (emp: EmployeeSearchResult, requestId: string) => {
    if (editingStaff.some(s => s.employee_code === emp.employee_code)) {
      setSearchInputs(prev => ({ ...prev, [requestId]: '' }));
      setSearchResults([]);
      setActiveSearchRequestId(null);
      return;
    }
    setEditingStaff(prev => [...prev, {
      support_request_id: requestId,
      employee_code: emp.employee_code,
      employee_name: emp.employee_name,
      position: emp.position || '',
    }]);
    setSearchInputs(prev => ({ ...prev, [requestId]: '' }));
    setSearchResults([]);
    setActiveSearchRequestId(null);
  };

  const handleRemoveStaff = (code: string) => {
    setEditingStaff(prev => prev.filter(s => s.employee_code !== code));
  };

  const handleStartEdit = (req: SupportRequest) => {
    setEditingRequestId(req.id);
    setEditingStaff([...(assignmentsMap[req.id] || [])]);
  };

  const handleCancelEdit = (requestId: string) => {
    setEditingRequestId(null);
    setEditingStaff([]);
    setSearchInputs(prev => ({ ...prev, [requestId]: '' }));
  };

  const handleSaveStaff = async (req: SupportRequest) => {
    setSaving(true);
    try {
      const res = await fetch('/api/campaign-support-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          support_request_id: req.id,
          campaign_id: campaignId,
          supporting_store_id: req.supporting_store_id,
          requesting_store_id: req.requesting_store_id,
          staff: editingStaff.map(s => ({
            employee_code: s.employee_code,
            employee_name: s.employee_name,
            position: s.position,
          })),
          replace: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssignmentsMap(prev => ({ ...prev, [req.id]: editingStaff }));
        setEditingRequestId(null);
        setEditingStaff([]);
      } else {
        alert(`儲存失敗：${data.error}`);
      }
    } catch {
      alert('網路錯誤，請重試');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const getAssignmentStatus = (req: SupportRequest) => {
    const assigned = (assignmentsMap[req.id] || []).length;
    if (assigned === 0) return { label: '未指派', color: 'bg-red-100 text-red-700' };
    if (assigned < req.requested_count) return { label: `${assigned}/${req.requested_count} 人`, color: 'bg-amber-100 text-amber-700' };
    return { label: `${assigned}/${req.requested_count} 已滿`, color: 'bg-green-100 text-green-700' };
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-xl">
          <div>
            <div className="flex items-center gap-2">
              <Users size={20} />
              <h2 className="text-xl font-bold">支援請求管理</h2>
            </div>
            <p className="text-sm text-white/70 mt-0.5">{campaignName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12 text-gray-400">
              <Loader2 size={28} className="animate-spin" />
            </div>
          ) : supportRequests.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-base">目前沒有支援請求</p>
              <p className="text-sm mt-1">您管理的門市尚未被其他門市請求支援</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">以下是 <span className="font-medium text-gray-700">您管理門市</span> 被請求支援的清單，請為每筆請求指派支援人員：</p>

              {supportRequests.map(req => {
                const status = getAssignmentStatus(req);
                const isEditing = editingRequestId === req.id;
                const currentStaff = isEditing ? editingStaff : (assignmentsMap[req.id] || []);
                const overCount = currentStaff.length > req.requested_count;

                return (
                  <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                    {/* Request header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">
                          <span className="font-medium text-gray-700">{req.supporting_store_name}</span>
                          <span className="mx-2 text-gray-300">→</span>
                          支援
                          <span className="mx-2 text-gray-300">→</span>
                          <span className="font-medium text-blue-700">{req.requesting_store_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                          <span className="text-sm text-gray-600">需求 {req.requested_count} 人</span>
                          {req.notes && <span className="text-xs text-gray-400">｜{req.notes}</span>}
                        </div>
                      </div>
                      {canAssign && !isEditing && (
                        <button
                          onClick={() => handleStartEdit(req)}
                          className="shrink-0 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                        >
                          指派人員
                        </button>
                      )}
                    </div>

                    {/* Staff list */}
                    {currentStaff.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 mb-1.5 font-medium">指派人員：</div>
                        <div className={`flex flex-wrap gap-1.5 p-2 rounded-lg ${isEditing ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                          {currentStaff.map(s => (
                            <span
                              key={s.employee_code}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                                isEditing
                                  ? 'bg-white border border-blue-200 text-blue-900'
                                  : 'bg-white border border-gray-200 text-gray-800'
                              }`}
                            >
                              <span className="font-medium">{s.employee_name}</span>
                              {s.position && <span className="text-gray-500">({s.position})</span>}
                              <span className="text-gray-400 font-mono text-[10px]">{s.employee_code}</span>
                              {isEditing && (
                                <button
                                  onClick={() => handleRemoveStaff(s.employee_code)}
                                  className="ml-0.5 text-red-400 hover:text-red-600"
                                >
                                  <X size={11} />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                        {overCount && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                            <AlertCircle size={12} />
                            已超過需求人數 ({currentStaff.length}/{req.requested_count})
                          </div>
                        )}
                      </div>
                    )}

                    {/* 編輯模式：搜尋員工 */}
                    {isEditing && canAssign && (
                      <div ref={activeSearchRequestId === req.id ? searchRef : null} className="relative">
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <input
                            type="text"
                            value={searchInputs[req.id] || ''}
                            onChange={e => handleSearchInput(req.id, e.target.value, req.supporting_store_id)}
                            onFocus={() => {
                              setActiveSearchRequestId(req.id);
                            }}
                            placeholder={`搜尋 ${req.supporting_store_name} 的員工員編或姓名（從每月人員狀態）...`}
                            className="w-full pl-8 pr-4 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                          />
                          {searchLoading && activeSearchRequestId === req.id && (
                            <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                          )}
                        </div>

                        {activeSearchRequestId === req.id && searchResults.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                            {searchResults.map(emp => {
                              const alreadyAdded = editingStaff.some(s => s.employee_code === emp.employee_code);
                              return (
                                <button
                                  key={emp.employee_code}
                                  onClick={() => handleAddStaff(emp, req.id)}
                                  disabled={alreadyAdded}
                                  className={`w-full text-left px-4 py-2.5 transition-colors border-b border-gray-100 last:border-0 ${
                                    alreadyAdded
                                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                      : 'hover:bg-blue-50'
                                  }`}
                                >
                                  <span className="font-medium text-gray-900">{emp.employee_name}</span>
                                  <span className="ml-2 text-xs text-gray-500 font-mono">{emp.employee_code}</span>
                                  {emp.position && <span className="ml-2 text-xs text-gray-500">{emp.position}</span>}
                                  {alreadyAdded && <span className="ml-2 text-xs text-blue-500">（已加入）</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 編輯操作按鈕 */}
                    {isEditing && (
                      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                        <button
                          onClick={() => handleCancelEdit(req.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
                        >
                          <RotateCcw size={13} />
                          取消
                        </button>
                        <button
                          onClick={() => handleSaveStaff(req)}
                          disabled={saving}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          {saving ? '儲存中...' : '儲存指派'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
