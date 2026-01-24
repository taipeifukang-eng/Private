'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  CalendarCheck, 
  Building2, 
  Users, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Send,
  Check,
  RefreshCw
} from 'lucide-react';
import type { Store, MonthlyStoreSummary } from '@/types/workflow';

export default function MonthlyStatusPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('member');
  const [managedStores, setManagedStores] = useState<Store[]>([]);
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>('');
  const [storeSummaries, setStoreSummaries] = useState<MonthlyStoreSummary[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');

  // 初始化當前年月
  useEffect(() => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedYearMonth(yearMonth);
  }, []);

  // 載入用戶管理的門市
  useEffect(() => {
    loadManagedStores();
  }, []);

  // 當年月或門市列表變更時，載入摘要
  useEffect(() => {
    if (selectedYearMonth && managedStores.length > 0) {
      loadStoreSummaries();
    }
  }, [selectedYearMonth, managedStores]);

  const loadManagedStores = async () => {
    try {
      const { getUserManagedStores } = await import('@/app/store/actions');
      const result = await getUserManagedStores();
      
      if (result.success) {
        setManagedStores(result.data || []);
        setUserRole(result.role || 'member');
        
        // 如果只有一間門市，自動選擇
        if (result.data?.length === 1) {
          setSelectedStoreId(result.data[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading managed stores:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStoreSummaries = async () => {
    try {
      const { getMonthlyStoreSummaries } = await import('@/app/store/actions');
      const result = await getMonthlyStoreSummaries(selectedYearMonth);
      
      if (result.success) {
        setStoreSummaries(result.data || []);
      }
    } catch (error) {
      console.error('Error loading store summaries:', error);
    }
  };

  // 年月導航
  const navigateMonth = (direction: 'prev' | 'next') => {
    const [year, month] = selectedYearMonth.split('-').map(Number);
    let newYear = year;
    let newMonth = month + (direction === 'next' ? 1 : -1);
    
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    
    setSelectedYearMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  // 獲取狀態顏色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 獲取狀態標籤
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed': return '已確認';
      case 'submitted': return '已提交';
      case 'in_progress': return '填寫中';
      default: return '待填寫';
    }
  };

  // 獲取狀態圖標
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'submitted': return <Send className="w-5 h-5 text-blue-600" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-yellow-600" />;
      default: return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  // 計算統計資料
  const totalStores = managedStores.length;
  const confirmedStores = storeSummaries.filter(s => s.store_status === 'confirmed').length;
  const submittedStores = storeSummaries.filter(s => s.store_status === 'submitted').length;
  const pendingStores = totalStores - confirmedStores - submittedStores;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
            <CalendarCheck className="text-blue-600" size={40} />
            每月人員狀態確認
          </h1>
          <p className="text-gray-600">
            確認並管理每月人員的工作狀態，用於獎金計算
          </p>
        </div>

        {/* 年月選擇器 */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} />
            </button>
            
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {selectedYearMonth.replace('-', ' 年 ')} 月
              </div>
              <div className="text-sm text-gray-500">
                點擊左右箭頭切換月份
              </div>
            </div>
            
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight size={24} />
            </button>
          </div>
        </div>

        {/* 統計卡片 - 只有督導/經理看得到 */}
        {(userRole === 'admin' || userRole === 'supervisor' || userRole === 'area_manager') && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <StatCard
              title="總門市數"
              value={totalStores}
              icon={<Building2 className="w-6 h-6" />}
              color="blue"
            />
            <StatCard
              title="已確認"
              value={confirmedStores}
              icon={<CheckCircle2 className="w-6 h-6" />}
              color="green"
            />
            <StatCard
              title="已提交"
              value={submittedStores}
              icon={<Send className="w-6 h-6" />}
              color="yellow"
            />
            <StatCard
              title="待填寫"
              value={pendingStores}
              icon={<AlertCircle className="w-6 h-6" />}
              color="gray"
            />
          </div>
        )}

        {/* 門市列表 / 門市切換器 */}
        {managedStores.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <Building2 className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              尚未指派門市
            </h3>
            <p className="text-gray-600">
              請聯繫管理員將您指派到門市
            </p>
          </div>
        ) : managedStores.length === 1 ? (
          // 店長視圖 - 直接顯示門市詳情
          <StoreStatusDetail
            store={managedStores[0]}
            yearMonth={selectedYearMonth}
            userRole={userRole}
            onRefresh={loadStoreSummaries}
          />
        ) : (
          // 督導/經理視圖 - 門市選擇器 + 詳情
          <div className="space-y-6">
            {/* 門市選擇標籤 */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="border-b border-gray-200">
                <div className="flex overflow-x-auto">
                  {managedStores.map((store) => {
                    const summary = storeSummaries.find(s => s.store_id === store.id);
                    const isSelected = selectedStoreId === store.id;
                    
                    return (
                      <button
                        key={store.id}
                        onClick={() => setSelectedStoreId(store.id)}
                        className={`px-6 py-4 font-medium text-sm whitespace-nowrap border-b-2 transition-colors flex items-center gap-2 ${
                          isSelected
                            ? 'border-blue-600 text-blue-600 bg-blue-50'
                            : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                        }`}
                      >
                        {getStatusIcon(summary?.store_status || 'pending')}
                        <span>{store.store_name}</span>
                        <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                          getStatusColor(summary?.store_status || 'pending')
                        }`}>
                          {getStatusLabel(summary?.store_status || 'pending')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 選中門市的詳情 */}
              {selectedStoreId ? (
                <div className="p-6">
                  <StoreStatusDetail
                    store={managedStores.find(s => s.id === selectedStoreId)!}
                    yearMonth={selectedYearMonth}
                    userRole={userRole}
                    onRefresh={loadStoreSummaries}
                  />
                </div>
              ) : (
                <div className="p-12 text-center text-gray-500">
                  請選擇一間門市查看詳情
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 統計卡片元件
function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'yellow' | 'gray';
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    gray: 'bg-gray-500',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`${colorClasses[color]} text-white p-3 rounded-lg`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// 門市狀態詳情元件
function StoreStatusDetail({
  store,
  yearMonth,
  userRole,
  onRefresh
}: {
  store: Store;
  yearMonth: string;
  userRole: string;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [storeStatus, setStoreStatus] = useState<string>('pending');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    loadStaffStatus();
  }, [store.id, yearMonth]);

  const loadStaffStatus = async () => {
    setLoading(true);
    try {
      const { getMonthlyStaffStatus } = await import('@/app/store/actions');
      const result = await getMonthlyStaffStatus(yearMonth, store.id);
      
      if (result.success) {
        setStaffList(result.data || []);
        // 判斷整體狀態
        if (result.data?.length > 0) {
          const allConfirmed = result.data.every((s: any) => s.status === 'confirmed');
          const allSubmitted = result.data.every((s: any) => s.status === 'submitted' || s.status === 'confirmed');
          
          if (allConfirmed) {
            setStoreStatus('confirmed');
          } else if (allSubmitted) {
            setStoreStatus('submitted');
          } else {
            setStoreStatus('in_progress');
          }
        } else {
          setStoreStatus('pending');
        }
      }
    } catch (error) {
      console.error('Error loading staff status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInitialize = async () => {
    setIsInitializing(true);
    try {
      const { initializeMonthlyStatus } = await import('@/app/store/actions');
      const result = await initializeMonthlyStatus(yearMonth, store.id);
      
      if (result.success) {
        if (result.initialized) {
          alert(`✅ 成功初始化 ${result.count} 位員工的狀態資料`);
        }
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 初始化失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error initializing:', error);
      alert('初始化失敗');
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSubmit = async () => {
    if (!confirm('確定要提交此門市的人員狀態？提交後店長將無法再修改。')) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { submitStoreStatus } = await import('@/app/store/actions');
      const result = await submitStoreStatus(yearMonth, store.id);
      
      if (result.success) {
        alert('✅ 成功提交');
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 提交失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error submitting:', error);
      alert('提交失敗');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirm('確定要確認此門市的人員狀態？確認後資料將用於獎金計算。')) {
      return;
    }

    setIsConfirming(true);
    try {
      const { confirmStoreStatus } = await import('@/app/store/actions');
      const result = await confirmStoreStatus(yearMonth, store.id);
      
      if (result.success) {
        alert('✅ 確認成功');
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 確認失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error confirming:', error);
      alert('確認失敗');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleExport = async () => {
    try {
      const { exportMonthlyStatusForBonus } = await import('@/app/store/actions');
      const result = await exportMonthlyStatusForBonus(yearMonth, store.id);
      
      if (result.success && result.data.length > 0) {
        // 轉換為 CSV
        const headers = Object.keys(result.data[0]);
        const csvContent = [
          headers.join(','),
          ...result.data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
        ].join('\n');
        
        // 下載
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `人員狀態_${store.store_name}_${yearMonth}.csv`;
        link.click();
      } else {
        alert('沒有可匯出的資料（需要已確認的狀態）');
      }
    } catch (error) {
      console.error('Error exporting:', error);
      alert('匯出失敗');
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-gray-500">
        載入中...
      </div>
    );
  }

  // 尚未初始化
  if (staffList.length === 0) {
    return (
      <div className="py-12 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-xl font-semibold text-gray-900 mb-2">
          尚未建立 {yearMonth.replace('-', '/')} 的人員狀態資料
        </h3>
        <p className="text-gray-600 mb-6">
          點擊下方按鈕從員工名單初始化本月資料
        </p>
        <button
          onClick={handleInitialize}
          disabled={isInitializing}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:opacity-50"
        >
          {isInitializing ? '初始化中...' : '初始化本月資料'}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* 門市標題和操作按鈕 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {store.store_name}
          </h2>
          <p className="text-gray-600">
            {store.store_code} · {staffList.length} 位員工
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadStaffStatus}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} />
            重新整理
          </button>
          {storeStatus === 'confirmed' && (
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Download size={16} />
              匯出 Excel
            </button>
          )}
        </div>
      </div>

      {/* 人員列表 */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">員工</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">職位</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">雇用類型</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">本月狀態</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">天數/時數</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">特殊標記</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">計算區塊</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {staffList.map((staff) => (
              <tr key={staff.id} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div>
                    <div className="font-medium text-gray-900">{staff.employee_name}</div>
                    <div className="text-sm text-gray-500">{staff.employee_code}</div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {staff.position || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    staff.employment_type === 'full_time' 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-purple-100 text-purple-800'
                  }`}>
                    {staff.employment_type === 'full_time' ? '正職' : '兼職'}
                  </span>
                  {staff.is_pharmacist && (
                    <span className="ml-1 px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                      藥師
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {getMonthlyStatusLabel(staff.monthly_status)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {staff.employment_type === 'full_time' 
                    ? `${staff.work_days || 0}/${staff.total_days_in_month} 天`
                    : `${staff.work_hours || 0} 時數`
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {staff.is_dual_position && (
                      <span className="px-2 py-0.5 text-xs rounded bg-orange-100 text-orange-800">雙</span>
                    )}
                    {staff.has_manager_bonus && (
                      <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">店長加成</span>
                    )}
                    {staff.is_supervisor_rotation && (
                      <span className="px-2 py-0.5 text-xs rounded bg-red-100 text-red-800">督導卡班</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${getBlockColor(staff.calculated_block)}`}>
                    區塊 {staff.calculated_block || '?'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {storeStatus !== 'confirmed' && (
                    <button
                      onClick={() => router.push(`/monthly-status/edit/${staff.id}`)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      編輯
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 底部操作按鈕 */}
      <div className="mt-6 flex justify-end gap-4">
        {storeStatus === 'in_progress' && (userRole === 'store_manager' || userRole === 'admin') && (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={18} />
            {isSubmitting ? '提交中...' : '送出審核'}
          </button>
        )}
        {storeStatus === 'submitted' && (userRole === 'admin' || userRole === 'supervisor' || userRole === 'area_manager') && (
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <Check size={18} />
            {isConfirming ? '確認中...' : '確認審核'}
          </button>
        )}
      </div>
    </div>
  );
}

// 輔助函數
function getMonthlyStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    'full_month': '整月在職',
    'new_hire': '到職',
    'resigned': '離職',
    'leave_of_absence': '留停',
    'transferred_in': '調入',
    'transferred_out': '調出',
    'promoted': '升職',
    'support_rotation': '支援卡班'
  };
  return labels[status] || status;
}

function getBlockColor(block: number | null): string {
  const colors: Record<number, string> = {
    1: 'bg-green-100 text-green-800',
    2: 'bg-gray-100 text-gray-800',
    3: 'bg-blue-100 text-blue-800',
    4: 'bg-purple-100 text-purple-800',
    5: 'bg-yellow-100 text-yellow-800',
    6: 'bg-red-100 text-red-800'
  };
  return colors[block || 0] || 'bg-gray-100 text-gray-500';
}
