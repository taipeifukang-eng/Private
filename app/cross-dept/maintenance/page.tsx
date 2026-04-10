'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Wrench, Plus, Loader2, AlertCircle, X, Send, Calendar, MapPin,
  Upload, Camera, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2,
  CheckCircle, Clock, Pause
} from 'lucide-react';

// ── 型別 ──────────────────────────────────────────────────────
interface MaintenanceRequest {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  reported_by: string;
  reporter_name: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  reported_at: string;
  store?: { id: string; store_code: string; store_name: string } | null;
}

interface MaintenanceUpdate {
  id: string;
  request_id: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes: string;
  progress_date: string;
  updated_by: string;
  updated_by_name: string;
  created_at: string;
  photos?: Array<{
    id: string;
    signed_url?: string | null;
    file_name: string;
  }>;
}

interface MaintenancePhoto {
  id: string;
  request_id: string;
  storage_path: string;
  signed_url?: string | null;
  file_name: string;
  uploaded_by: string;
  photo_type: 'before' | 'progress' | 'after' | 'other';
  created_at: string;
}

interface UserManagedStore {
  id: string;
  store_code: string;
  store_name: string;
}

interface StoreStatusSummary {
  store_id: string;
  store_code: string;
  store_name: string;
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
}

// ── 主元件 ──────────────────────────────────────────────────────
export default function MaintenancePage() {
  const supabase = createClient();
  const getDateInTaipei = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  };

  // 權限與使用者狀態
  const [userId, setUserId] = useState<string | null>(null);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [userManagedStores, setUserManagedStores] = useState<UserManagedStore[]>([]);
  const [userStoreId, setUserStoreId] = useState<string | null>(null);
  const [permLoading, setPermLoading] = useState(true);

  // 資料與 UI 狀態
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [allStores, setAllStores] = useState<UserManagedStore[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [filterYearMonth, setFilterYearMonth] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).slice(0, 7)
  );
  const [searchInput, setSearchInput] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 新增回報表單
  const [newRequestForm, setNewRequestForm] = useState({
    title: '',
    description: '',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  });
  const [newRequestPhotos, setNewRequestPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const addRequestPhotoInputRef = useRef<HTMLInputElement>(null);
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // 進度更新表單
  const [updateTarget, setUpdateTarget] = useState<MaintenanceRequest | null>(null);
  const [updateForm, setUpdateForm] = useState({ status: 'pending', notes: '', progressDate: getDateInTaipei() });
  const [updateFormPhotos, setUpdateFormPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const updatePhotoInputRef = useRef<HTMLInputElement>(null);
  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updatesMap, setUpdatesMap] = useState<Map<string, MaintenanceUpdate[]>>(new Map());
  const [updatesLoading, setUpdatesLoading] = useState<Set<string>>(new Set());
  const [storeSummary, setStoreSummary] = useState<StoreStatusSummary[]>([]);

  // 照片上傳
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadPhotoTarget, setUploadPhotoTarget] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Map<string, MaintenancePhoto[]>>(new Map());
  const [photoLoading, setPhotoLoading] = useState<Set<string>>(new Set());
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // ── 初始化：載入權限與門市 ──
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPermLoading(false);
        return;
      }
      setUserId(user.id);

      // 檢查權限
      const [viewAllRes, submitRes, updateRes] = await Promise.all([
        fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'cross_dept.maintenance.view_all' }),
        }),
        fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'cross_dept.maintenance.submit' }),
        }),
        fetch('/api/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'cross_dept.maintenance.update' }),
        }),
      ]);

      const [vaD, sD, uD] = await Promise.all([viewAllRes.json(), submitRes.json(), updateRes.json()]);
      const hasViewAll = vaD.allowed || false;
      const hasSubmit = sD.allowed || false;
      const hasUpdate = uD.allowed || false;

      setCanViewAll(hasViewAll);
      setCanSubmit(hasSubmit);
      setCanUpdate(hasUpdate);

      // 取得使用者所管轄門市
      if (hasSubmit || hasViewAll) {
        const { data: storeManagerRows } = await supabase
          .from('store_managers')
          .select('store_id, stores(id, store_code, store_name)')
          .eq('user_id', user.id);

        const managed = (storeManagerRows ?? [])
          .map((sm: any) => sm.stores)
          .filter(Boolean)
          .map((s: any) => ({ id: s.id, store_code: s.store_code, store_name: s.store_name }))
          .sort((a: any, b: any) => a.store_code.localeCompare(b.store_code));

        setUserManagedStores(managed);
        if (hasViewAll) {
          setSelectedStoreId(null);
        } else if (managed.length > 0) {
          setUserStoreId(managed[0].id);
          setSelectedStoreId(managed[0].id);
        }
      }

      if (hasViewAll) {
        const { data: stores } = await supabase
          .from('stores')
          .select('id, store_code, store_name')
          .order('store_code');
        setAllStores((stores ?? []) as UserManagedStore[]);
      }

      setPermLoading(false);
    })();
  }, []);

  // ── 載入資料 ──
  const loadData = useCallback(async () => {
    if (permLoading) return;
    setLoading(true);

    try {
      let url = `/api/maintenance-requests?page=${page}&pageSize=30`;
      url += `&year_month=${filterYearMonth}`;
      if (selectedStoreId) url += `&store_id=${selectedStoreId}`;
      if (filterStatus !== 'all') url += `&status=${filterStatus}`;
      if (searchInput.trim()) url += `&q=${encodeURIComponent(searchInput.trim())}`;

      const res = await fetch(url);
      const result = await res.json();

      if (result.success) {
        setRequests(result.data);
        setTotalPages(result.pagination?.totalPages ?? 1);
      } else {
        setRequests([]);
        setTotalPages(1);
        alert(`載入維修回報失敗: ${result.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('載入維修回報失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [page, selectedStoreId, filterStatus, filterYearMonth, searchInput, permLoading]);

  const loadStoreSummary = useCallback(async () => {
    if (permLoading || !canViewAll) return;
    try {
      const res = await fetch(`/api/maintenance-requests/summary?year_month=${filterYearMonth}`);
      const result = await res.json();
      if (result.success) {
        setStoreSummary(result.data || []);
      }
    } catch {
      // ignore
    }
  }, [permLoading, canViewAll, filterYearMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadStoreSummary();
  }, [loadStoreSummary]);

  const clearNewRequestPhotos = useCallback(() => {
    setNewRequestPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.preview));
      return [];
    });
  }, []);

  const handleAddRequestPhoto = (file: File) => {
    setNewRequestPhotos((prev) => {
      if (prev.length >= 5) return prev;
      const preview = URL.createObjectURL(file);
      return [...prev, { file, preview }];
    });
  };

  const removeRequestPhoto = (index: number) => {
    setNewRequestPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, idx) => idx !== index);
    });
  };

  // ── 提交新維修回報 ──
  const handleSubmitRequest = async () => {
    if (!newRequestForm.title || !selectedStoreId) {
      alert('請填入維修項目和選擇門市');
      return;
    }

    setSubmittingRequest(true);
    try {
      const res = await fetch('/api/maintenance-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStoreId,
          title: newRequestForm.title,
          description: newRequestForm.description || null,
          priority: newRequestForm.priority,
        }),
      });

      const result = await res.json();
      if (result.success) {
        const requestId: string | undefined = result?.data?.id;
        if (requestId && newRequestPhotos.length > 0) {
          const formData = new FormData();
          formData.append('request_id', requestId);
          formData.append('photo_type', 'before');
          newRequestPhotos.forEach((p) => formData.append('files', p.file));

          const photoRes = await fetch('/api/maintenance-photos', {
            method: 'POST',
            body: formData,
          });
          const photoResult = await photoRes.json();
          if (!photoResult.success) {
            alert(`維修回報已建立，但照片上傳失敗: ${photoResult.error}`);
          }
        }

        setNewRequestForm({ title: '', description: '', priority: 'normal' });
        setFilterStatus('all');
        setSearchInput('');
        setPage(1);
        clearNewRequestPhotos();
        setShowAddModal(false);
        loadData();
      } else {
        alert(`提交失敗: ${result.error}`);
      }
    } catch (error) {
      alert(`提交失敗: ${error}`);
    } finally {
      setSubmittingRequest(false);
    }
  };

  // ── 上傳照片 ──
  const handlePhotoUpload = async (requestId: string, files: FileList) => {
    if (!files.length) return;

    setUploadingPhotos(true);
    setUploadPhotoTarget(requestId);

    try {
      const formData = new FormData();
      formData.append('request_id', requestId);
      formData.append('photo_type', 'other');
      for (const file of Array.from(files)) {
        formData.append('files', file);
      }

      const res = await fetch('/api/maintenance-photos', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (result.success) {
        // 上傳後重新抓取一次，取得可顯示的簽名 URL
        await loadRequestPhotos(requestId);

        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        alert(`上傳失敗: ${result.error}`);
      }
    } catch (error) {
      alert(`上傳失敗: ${error}`);
    } finally {
      setUploadingPhotos(false);
      setUploadPhotoTarget(null);
    }
  };

  const loadRequestPhotos = async (requestId: string) => {
    setPhotoLoading((prev) => new Set(prev).add(requestId));
    try {
      const res = await fetch(`/api/maintenance-photos?request_id=${requestId}`);
      const result = await res.json();
      if (!result.success) return;
      setPhotos((prev) => {
        const next = new Map(prev);
        next.set(requestId, result.data || []);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setPhotoLoading((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const loadRequestUpdates = async (requestId: string) => {
    setUpdatesLoading((prev) => new Set(prev).add(requestId));
    try {
      const res = await fetch(`/api/maintenance-updates?request_id=${requestId}`);
      const result = await res.json();
      if (!result.success) return;
      setUpdatesMap((prev) => {
        const next = new Map(prev);
        next.set(requestId, result.data || []);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setUpdatesLoading((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const clearUpdateFormPhotos = useCallback(() => {
    setUpdateFormPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.preview));
      return [];
    });
  }, []);

  const handleAddUpdatePhoto = (file: File) => {
    setUpdateFormPhotos((prev) => {
      if (prev.length >= 5) return prev;
      const preview = URL.createObjectURL(file);
      return [...prev, { file, preview }];
    });
  };

  const removeUpdatePhoto = (index: number) => {
    setUpdateFormPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const openLightbox = (urls: string[], index: number) => {
    setLightboxPhotos(urls);
    setLightboxIndex(index);
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
    setLightboxPhotos([]);
  };

  const prevLightbox = () => {
    setLightboxIndex((i) => (i !== null ? (i - 1 + lightboxPhotos.length) % lightboxPhotos.length : null));
  };

  const nextLightbox = () => {
    setLightboxIndex((i) => (i !== null ? (i + 1) % lightboxPhotos.length : null));
  };

  // ── 更新維修進度 ──
  const handleSubmitUpdate = async () => {
    if (!updateTarget || !updateForm.notes) {
      alert('請填入更新說明');
      return;
    }

    setSubmittingUpdate(true);
    try {
      const res = await fetch('/api/maintenance-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: updateTarget.id,
          status: updateForm.status,
          notes: updateForm.notes,
          progress_date: updateForm.progressDate,
        }),
      });

      const result = await res.json();
      if (result.success) {
        const updateId: string | undefined = result?.data?.id;
        if (updateId && updateFormPhotos.length > 0) {
          const formData = new FormData();
          formData.append('update_id', updateId);
          updateFormPhotos.forEach((p) => formData.append('files', p.file));

          const photoRes = await fetch('/api/maintenance-update-photos', {
            method: 'POST',
            body: formData,
          });
          const photoResult = await photoRes.json();
          if (!photoResult.success) {
            alert(`進度已建立，但照片上傳失敗: ${photoResult.error}`);
          }
        }

        await loadRequestUpdates(updateTarget.id);
        setUpdateTarget(null);
        setUpdateForm({ status: 'pending', notes: '', progressDate: getDateInTaipei() });
        clearUpdateFormPhotos();
        loadData();
        loadStoreSummary();
      } else {
        alert(`更新失敗: ${result.error}`);
      }
    } catch (error) {
      alert(`更新失敗: ${error}`);
    } finally {
      setSubmittingUpdate(false);
    }
  };

  const handleDeleteRequest = async (requestId: string) => {
    if (!confirm('確定要刪除這筆維修回報嗎？')) return;
    try {
      const res = await fetch(`/api/maintenance-requests?id=${requestId}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (!result.success) {
        alert(`刪除失敗: ${result.error || '未知錯誤'}`);
        return;
      }
      if (expandedRequestId === requestId) {
        setExpandedRequestId(null);
      }
      loadData();
      loadStoreSummary();
    } catch (error) {
      alert(`刪除失敗: ${error}`);
    }
  };

  // ── 權限檢查 ──
  if (permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!canViewAll && !canSubmit && !canUpdate) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        <div className="text-center space-y-2">
          <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
          <p className="text-lg font-medium">沒有存取此頁面的權限</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center">
              <Wrench className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">總務組管理</h1>
              <p className="text-sm text-gray-500">門市維修回報與進度追蹤</p>
            </div>
          </div>
        </div>

        {/* Filters & Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-4">
          {/* 門市選擇 + 年月篩選 */}
          {(canSubmit || canViewAll) && (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-600">門市：</label>
                <select
                  value={selectedStoreId || 'all'}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedStoreId(value === 'all' ? null : value);
                    setPage(1);
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  {canViewAll && <option value="all">全部門市</option>}
                  {(canViewAll ? allStores : userManagedStores).map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.store_code} - {store.store_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-600">年月：</label>
                <input
                  type="month"
                  value={filterYearMonth}
                  onChange={(e) => {
                    setFilterYearMonth(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
            </div>
          )}

          {/* 狀態篩選 & 搜尋 */}
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
              {(['all', 'pending', 'in_progress', 'completed'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setFilterStatus(s);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 transition-colors ${
                    filterStatus === s
                      ? 'bg-orange-500 text-white font-medium'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {{
                    all: '全部',
                    pending: '待處理',
                    in_progress: '處理中',
                    completed: '已完成',
                  }[s]}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="搜尋維修項目..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 flex-1 min-w-[200px] border border-gray-200 rounded-lg text-sm"
            />

            {canSubmit && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                新增回報
              </button>
            )}
          </div>
        </div>

        {/* 總務快速總覽 */}
        {canViewAll && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">門市維修狀態總覽</p>
            {storeSummary.length === 0 ? (
              <p className="text-xs text-gray-500">目前無資料</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-2">門市</th>
                      <th className="py-2 pr-2">待處理</th>
                      <th className="py-2 pr-2">處理中</th>
                      <th className="py-2 pr-2">已完成</th>
                      <th className="py-2">總數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storeSummary.map((s) => (
                      <tr key={s.store_id} className="border-b border-gray-100">
                        <td className="py-2 pr-2 text-gray-700">{s.store_code} - {s.store_name}</td>
                        <td className="py-2 pr-2 text-orange-600 font-medium">{s.pending}</td>
                        <td className="py-2 pr-2 text-blue-600 font-medium">{s.in_progress}</td>
                        <td className="py-2 pr-2 text-emerald-600 font-medium">{s.completed}</td>
                        <td className="py-2 text-gray-700">{s.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 回報列表 */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Wrench className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>目前沒有任何維修回報</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div
                key={req.id}
                className="bg-white rounded-xl border-2 overflow-hidden transition-colors border-amber-200"
              >
                <div className="p-4">
                  {/* 標題行 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-gray-900">{req.title}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          req.priority === 'urgent'
                            ? 'bg-red-100 text-red-700'
                            : req.priority === 'high'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}>
                          {
                            {
                              low: '低',
                              normal: '普通',
                              high: '高',
                              urgent: '緊急',
                            }[req.priority]
                          }
                        </span>
                      </div>
                      <div className="flex gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {req.store?.store_code} - {req.store?.store_name}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {new Date(req.reported_at).toLocaleDateString('zh-TW')}
                        </div>
                        <div>回報者：{req.reporter_name}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {(req.reported_by === userId || canViewAll || canUpdate) && (
                        <button
                          onClick={() => handleDeleteRequest(req.id)}
                          className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                          title="刪除回報"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const willExpand = expandedRequestId !== req.id;
                          setExpandedRequestId(willExpand ? req.id : null);
                          if (willExpand && !photos.has(req.id)) {
                            void loadRequestPhotos(req.id);
                          }
                          if (willExpand && !updatesMap.has(req.id)) {
                            void loadRequestUpdates(req.id);
                          }
                        }}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {expandedRequestId === req.id ? (
                          <ChevronUp className="w-5 h-5" />
                        ) : (
                          <ChevronDown className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {expandedRequestId === req.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                      {/* 詳細描述 */}
                      {req.description && (
                        <div>
                          <p className="text-sm font-medium text-gray-600 mb-1">詳細說明</p>
                          <p className="text-sm text-gray-700">{req.description}</p>
                        </div>
                      )}

                      {/* 照片上傳 */}
                      {canSubmit && (
                        <div>
                          <p className="text-sm font-medium text-gray-600 mb-2">上傳照片</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploadingPhotos && uploadPhotoTarget === req.id}
                              className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Upload className="w-4 h-4" />
                              {uploadingPhotos && uploadPhotoTarget === req.id
                                ? '上傳中...'
                                : '上傳照片'}
                            </button>
                            <input
                              ref={fileInputRef}
                              type="file"
                              multiple
                              accept="image/*"
                              hidden
                              onChange={(e) => {
                                if (e.target.files) {
                                  handlePhotoUpload(req.id, e.target.files);
                                }
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 照片縮圖 */}
                      <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">維修照片</p>
                        {photoLoading.has(req.id) ? (
                          <div className="text-xs text-gray-500">照片載入中...</div>
                        ) : (photos.get(req.id)?.length ?? 0) > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {((photos.get(req.id) ?? []).filter((p) => !!p.signed_url)).map((p, idx, arr) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  const urls = arr.map((x) => x.signed_url!).filter(Boolean);
                                  openLightbox(urls, idx);
                                }}
                                className="block"
                              >
                                <img
                                  src={p.signed_url || ''}
                                  alt={p.file_name}
                                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 hover:border-blue-400 transition-colors"
                                />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">目前沒有照片</div>
                        )}
                      </div>

                      {/* 進度更新 */}
                      {canUpdate && (
                        <div>
                          <p className="text-sm font-medium text-gray-600 mb-2">進度更新</p>
                          <div className="space-y-2 mb-3">
                            {updatesLoading.has(req.id) ? (
                              <div className="text-xs text-gray-500">更新歷程載入中...</div>
                            ) : (
                              (updatesMap.get(req.id) ?? []).map((u) => (
                                <div key={u.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className="text-xs text-gray-500">
                                      紀錄日期：{u.progress_date}
                                      {' · '}登錄時間：
                                      {new Date(u.created_at).toLocaleString('zh-TW', {
                                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                                      })}
                                      {' · '}更新者：{u.updated_by_name}
                                    </div>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-700">
                                      {{ pending: '待處理', in_progress: '處理中', completed: '已完成' }[u.status as 'pending' | 'in_progress' | 'completed'] ?? u.status}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{u.notes}</p>
                                  {(u.photos?.length ?? 0) > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {(u.photos ?? []).filter((p) => !!p.signed_url).map((p, idx, arr) => (
                                        <button
                                          key={p.id}
                                          type="button"
                                          onClick={() => {
                                            const urls = arr.map((x) => x.signed_url!).filter(Boolean);
                                            openLightbox(urls, idx);
                                          }}
                                        >
                                          <img
                                            src={p.signed_url || ''}
                                            alt={p.file_name}
                                            className="w-16 h-16 object-cover rounded border border-gray-200 hover:border-blue-400"
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}

                            {!updatesLoading.has(req.id) && (updatesMap.get(req.id)?.length ?? 0) === 0 && (
                              <div className="text-xs text-gray-500">目前尚無更新歷程</div>
                            )}
                          </div>

                          {updateTarget?.id === req.id ? (
                            <div className="space-y-2">
                              <select
                                value={updateForm.status}
                                onChange={(e) =>
                                  setUpdateForm({
                                    ...updateForm,
                                    status: e.target.value as any,
                                  })
                                }
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              >
                                <option value="pending">待處理</option>
                                <option value="in_progress">處理中</option>
                                <option value="completed">已完成</option>
                              </select>
                              <textarea
                                placeholder="輸入更新說明..."
                                value={updateForm.notes}
                                onChange={(e) =>
                                  setUpdateForm({
                                    ...updateForm,
                                    notes: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                rows={3}
                              />

                              <input
                                type="date"
                                value={updateForm.progressDate}
                                onChange={(e) =>
                                  setUpdateForm({
                                    ...updateForm,
                                    progressDate: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />

                              <div>
                                <label className="block text-xs text-gray-600 mb-1">進度照片（最多 5 張）</label>
                                <div className="flex flex-wrap gap-2">
                                  {updateFormPhotos.map((photo, idx) => (
                                    <div key={`${photo.file.name}-${idx}`} className="relative group">
                                      <img
                                        src={photo.preview}
                                        alt={`進度照片 ${idx + 1}`}
                                        className="w-16 h-16 object-cover rounded border border-gray-200"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeUpdatePhoto(idx)}
                                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ))}

                                  {updateFormPhotos.length < 5 && (
                                    <label className="w-16 h-16 border-2 border-dashed border-blue-300 rounded flex items-center justify-center cursor-pointer hover:bg-blue-50">
                                      <Camera className="w-4 h-4 text-blue-500" />
                                      <input
                                        ref={updatePhotoInputRef}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            handleAddUpdatePhoto(file);
                                            e.target.value = '';
                                          }
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={handleSubmitUpdate}
                                  disabled={submittingUpdate}
                                  className="flex-1 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50"
                                >
                                  {submittingUpdate ? '提交中...' : '提交'}
                                </button>
                                <button
                                  onClick={() => {
                                    setUpdateTarget(null);
                                    clearUpdateFormPhotos();
                                  }}
                                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setUpdateTarget(req);
                                setUpdateForm({ status: req.status, notes: '', progressDate: getDateInTaipei() });
                                clearUpdateFormPhotos();
                              }}
                              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
                            >
                              新增更新
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分頁 */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              上一頁
            </button>
            <span className="px-3 py-2 text-sm text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              下一頁
            </button>
          </div>
        )}
      </div>

      {/* 照片燈箱 */}
      {lightboxIndex !== null && lightboxPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
            aria-label="關閉"
          >
            <X size={28} />
          </button>

          {lightboxPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prevLightbox(); }}
              className="absolute left-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
              aria-label="上一張"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          <img
            src={lightboxPhotos[lightboxIndex]}
            alt={`維修照片 ${lightboxIndex + 1}`}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); nextLightbox(); }}
              className="absolute right-4 text-white hover:text-gray-300 transition-colors bg-black/40 rounded-full p-2"
              aria-label="下一張"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {lightboxPhotos.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 px-3 py-1 rounded-full">
              {lightboxIndex + 1} / {lightboxPhotos.length}
            </div>
          )}
        </div>
      )}

      {/* 新增回報 Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">新增維修回報</h2>
              <button
                onClick={() => {
                  clearNewRequestPhotos();
                  setShowAddModal(false);
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  維修項目 *
                </label>
                <input
                  type="text"
                  value={newRequestForm.title}
                  onChange={(e) =>
                    setNewRequestForm({ ...newRequestForm, title: e.target.value })
                  }
                  placeholder="例：冷氣故障"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  詳細說明
                </label>
                <textarea
                  value={newRequestForm.description}
                  onChange={(e) =>
                    setNewRequestForm({ ...newRequestForm, description: e.target.value })
                  }
                  placeholder="輸入維修詳細說明..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  優先度
                </label>
                <select
                  value={newRequestForm.priority}
                  onChange={(e) =>
                    setNewRequestForm({
                      ...newRequestForm,
                      priority: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                  <option value="urgent">緊急</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Camera className="inline w-4 h-4 mr-1" />
                  維修照片（最多 5 張）
                </label>
                <div className="flex flex-wrap gap-3">
                  {newRequestPhotos.map((photo, idx) => (
                    <div key={`${photo.file.name}-${idx}`} className="relative group">
                      <img
                        src={photo.preview}
                        alt={`維修照片 ${idx + 1}`}
                        className="w-20 h-20 object-cover rounded-lg border-2 border-gray-300 shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeRequestPhoto(idx)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        aria-label="刪除照片"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {newRequestPhotos.length < 5 && (
                    <label className="w-20 h-20 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50 hover:border-blue-500 transition-all shadow-sm">
                      <Camera className="w-6 h-6 text-blue-500 mb-1" />
                      <span className="text-xs text-blue-600 font-medium">拍照</span>
                      <input
                        ref={addRequestPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleAddRequestPhoto(file);
                            e.target.value = '';
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {newRequestPhotos.length >= 5 && (
                  <p className="text-xs text-amber-600 mt-2 font-medium">✓ 已達上傳上限（5張）</p>
                )}
                {newRequestPhotos.length === 0 && (
                  <p className="text-xs text-gray-500 mt-2">點擊拍照按鈕可直接開啟相機</p>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <button
                onClick={() => {
                  clearNewRequestPhotos();
                  setShowAddModal(false);
                }}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmitRequest}
                disabled={submittingRequest}
                className="flex-1 px-3 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50"
              >
                {submittingRequest ? '提交中...' : '提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
