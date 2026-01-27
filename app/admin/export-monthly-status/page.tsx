'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Calendar, Store, CheckSquare, Square, ChevronLeft, FileSpreadsheet } from 'lucide-react';

interface StoreWithStatus {
  id: string;
  store_code: string;
  store_name: string;
  total_employees: number;
  submitted_count: number;
  confirmed_count: number;
  store_status: 'pending' | 'submitted' | 'confirmed';
}

export default function ExportMonthlyStatusPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  
  // 年月選擇
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  
  // 門市資料
  const [stores, setStores] = useState<StoreWithStatus[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    loadStores();
  }, [selectedYear, selectedMonth]);

  const loadStores = async () => {
    setLoading(true);
    const yearMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    
    try {
      const response = await fetch(`/api/export-monthly-status/stores?year_month=${yearMonth}`);
      const data = await response.json();
      
      if (data.success) {
        setStores(data.stores || []);
        // 預設選擇所有已提交或已確認的門市
        const submittedStores = (data.stores || [])
            .filter((s: StoreWithStatus) => s.store_status === 'submitted' || s.store_status === 'confirmed')
            .map((s: StoreWithStatus) => s.id as string);
        const submittedStoreIds = new Set<string>(submittedStores);
        setSelectedStoreIds(submittedStoreIds);
        setSelectAll(submittedStoreIds.size === data.stores.length);
      } else {
        alert(`載入失敗：${data.error}`);
      }
    } catch (error) {
      console.error('Error loading stores:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStore = (storeId: string) => {
    const newSelected = new Set(selectedStoreIds);
    if (newSelected.has(storeId)) {
      newSelected.delete(storeId);
    } else {
      newSelected.add(storeId);
    }
    setSelectedStoreIds(newSelected);
    setSelectAll(newSelected.size === stores.length);
  };

  const handleToggleAll = () => {
    if (selectAll) {
      setSelectedStoreIds(new Set());
    } else {
      setSelectedStoreIds(new Set(stores.map(s => s.id)));
    }
    setSelectAll(!selectAll);
  };

  const handleDownload = async () => {
    if (selectedStoreIds.size === 0) {
      alert('請至少選擇一間門市');
      return;
    }

    setDownloading(true);
    const yearMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    
    try {
      const response = await fetch('/api/export-monthly-status/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          store_ids: Array.from(selectedStoreIds)
        })
      });

      if (!response.ok) {
        throw new Error('下載失敗');
      }

      // 下載檔案
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `每月人員狀態_${yearMonth}_${selectedStoreIds.size}間門市.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading:', error);
      alert('下載失敗');
    } finally {
      setDownloading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      pending: { label: '未提交', className: 'bg-gray-100 text-gray-700' },
      submitted: { label: '已提交', className: 'bg-blue-100 text-blue-700' },
      confirmed: { label: '已確認', className: 'bg-green-100 text-green-700' }
    };
    const badge = badges[status as keyof typeof badges] || badges.pending;
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${badge.className}`}>
        {badge.label}
      </span>
    );
  };

  // 可下載的門市（已提交或已確認）
  const downloadableStores = stores.filter(s => 
    s.store_status === 'submitted' || s.store_status === 'confirmed'
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">每月人員資料匯出</h1>
            <p className="text-gray-600">選擇門市並下載整合的 Excel 檔案</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左側：年月選擇和統計 */}
          <div className="lg:col-span-1 space-y-6">
            {/* 年月選擇 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar size={20} />
                選擇年月
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    年份
                  </label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {[...Array(5)].map((_, i) => {
                      const year = now.getFullYear() - 2 + i;
                      return (
                        <option key={year} value={year}>
                          {year} 年
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    月份
                  </label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {[...Array(12)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1} 月
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 統計資訊 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                統計資訊
              </h2>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">總門市數</span>
                  <span className="font-semibold">{stores.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">可匯出門市</span>
                  <span className="font-semibold text-green-600">{downloadableStores.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">已選擇</span>
                  <span className="font-semibold text-blue-600">{selectedStoreIds.size}</span>
                </div>
                <div className="flex justify-between pt-3 border-t">
                  <span className="text-gray-600">總員工數</span>
                  <span className="font-semibold">
                    {stores
                      .filter(s => selectedStoreIds.has(s.id))
                      .reduce((sum, s) => sum + s.total_employees, 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* 下載按鈕 */}
            <button
              onClick={handleDownload}
              disabled={downloading || selectedStoreIds.size === 0}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <FileSpreadsheet size={20} />
              {downloading ? '下載中...' : `下載 Excel (${selectedStoreIds.size} 間門市)`}
            </button>
          </div>

          {/* 右側：門市列表 */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Store size={20} />
                門市列表
              </h2>
              
              <button
                onClick={handleToggleAll}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {selectAll ? (
                  <>
                    <CheckSquare size={16} className="text-blue-600" />
                    取消全選
                  </>
                ) : (
                  <>
                    <Square size={16} />
                    全選
                  </>
                )}
              </button>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500">
                載入中...
              </div>
            ) : stores.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Store size={48} className="mx-auto mb-4 text-gray-300" />
                <p>該月份尚無門市資料</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {stores.map((store) => {
                  const isSelected = selectedStoreIds.has(store.id);
                  const canDownload = store.store_status === 'submitted' || store.store_status === 'confirmed';
                  
                  return (
                    <div
                      key={store.id}
                      className={`p-4 border rounded-lg transition-all ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50' 
                          : canDownload 
                            ? 'border-gray-200 hover:border-blue-300' 
                            : 'border-gray-100 bg-gray-50'
                      } ${!canDownload ? 'opacity-60' : 'cursor-pointer'}`}
                      onClick={() => canDownload && handleToggleStore(store.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          {isSelected ? (
                            <CheckSquare size={20} className="text-blue-600" />
                          ) : (
                            <Square size={20} className={canDownload ? 'text-gray-400' : 'text-gray-300'} />
                          )}
                        </div>
                        
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <h3 className="font-semibold text-gray-900">
                                {store.store_code} - {store.store_name}
                              </h3>
                              <p className="text-sm text-gray-600 mt-1">
                                員工人數：{store.total_employees} 人
                              </p>
                            </div>
                            {getStatusBadge(store.store_status)}
                          </div>
                          
                          {!canDownload && (
                            <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded inline-block">
                              尚未提交，無法匯出
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
