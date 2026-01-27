'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ImportPerformanceModal from '@/components/ImportPerformanceModal';

export const dynamic = 'force-dynamic';
import ImportStoreStatsModal from '@/components/ImportStoreStatsModal';
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
  RefreshCw,
  Plus,
  X,
  Trash2,
  Upload,
  TrendingUp,
  ChevronDown
} from 'lucide-react';
import type { Store, MonthlyStoreSummary, MonthlyStatusType, NewbieLevel, PartialMonthReason, ExtraTask } from '@/types/workflow';
import { 
  MONTHLY_STATUS_OPTIONS, 
  POSITION_OPTIONS,
  NEWBIE_LEVEL_OPTIONS,
  PARTIAL_MONTH_REASON_OPTIONS,
  EXTRA_TASK_OPTIONS,
  SPECIAL_ROLE_OPTIONS
} from '@/types/workflow';

export default function MonthlyStatusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('member');
  const [userDepartment, setUserDepartment] = useState<string>('');
  const [userJobTitle, setUserJobTitle] = useState<string>('');
  const [managedStores, setManagedStores] = useState<Store[]>([]);
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>('');
  const [storeSummaries, setStoreSummaries] = useState<MonthlyStoreSummary[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showImportStatsModal, setShowImportStatsModal] = useState(false);
  const storeTabsRef = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  // 初始化當前年月（從 URL 參數或使用當前月份）
  useEffect(() => {
    const urlYearMonth = searchParams.get('year_month');
    if (urlYearMonth) {
      setSelectedYearMonth(urlYearMonth);
    } else {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setSelectedYearMonth(yearMonth);
    }
  }, [searchParams]);

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

  // 當選中的門市變更時，滾動到該門市的標籤
  useEffect(() => {
    if (selectedStoreId && storeTabsRef.current[selectedStoreId]) {
      storeTabsRef.current[selectedStoreId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [selectedStoreId]);

  const loadManagedStores = async () => {
    try {
      const { getUserManagedStores } = await import('@/app/store/actions');
      const result = await getUserManagedStores();
      
      if (result.success) {
        setManagedStores(result.data || []);
        setUserRole(result.role || 'member');
        setUserDepartment(result.department || '');
        setUserJobTitle(result.job_title || '');
        
        // 從 URL 參數讀取 store_id，若無則自動選擇第一間門市
        const urlStoreId = searchParams.get('store_id');
        if (urlStoreId && result.data?.some(s => s.id === urlStoreId)) {
          setSelectedStoreId(urlStoreId);
        } else if (result.data?.length === 1) {
          setSelectedStoreId(result.data[0].id);
        }
      }
    } catch (error) {
      console.error('Error loading managed stores:', error);
    } finally {
      setLoading(false);
    }
  };

  // 判斷是否可以查看門市統計資料
  const canViewStoreStats = () => {
    // 1. admin, supervisor, area_manager 可以看
    if (['admin', 'supervisor', 'area_manager'].includes(userRole)) {
      return true;
    }
    // 2. 營業部（營業1部、營業2部等）的助理可以看
    if (userDepartment?.startsWith('營業') && userJobTitle === '助理') {
      return true;
    }
    return false;
  };

  const loadStoreSummaries = async (moveToNext: boolean = false) => {
    try {
      const { getMonthlyStoreSummaries } = await import('@/app/store/actions');
      const result = await getMonthlyStoreSummaries(selectedYearMonth);
      
      if (result.success) {
        setStoreSummaries(result.data || []);
        
        // 如果 moveToNext 為 true，自動跳到下一間未確認的門市
        if (moveToNext && selectedStoreId) {
          const currentIndex = managedStores.findIndex(s => s.id === selectedStoreId);
          if (currentIndex >= 0 && currentIndex < managedStores.length - 1) {
            // 尋找下一間未確認的門市
            const remainingStores = managedStores.slice(currentIndex + 1);
            const nextUnconfirmed = remainingStores.find(store => {
              const summary = result.data?.find(s => s.store_id === store.id);
              return summary?.store_status !== 'confirmed';
            });
            
            // 如果找到未確認的門市就跳過去，否則保持在當前門市
            if (nextUnconfirmed) {
              setSelectedStoreId(nextUnconfirmed.id);
            }
          }
        }
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
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header with Year/Month Selector */}
        <div className="mb-8 bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <CalendarCheck className="text-blue-600" size={40} />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">每月人員狀態確認</h1>
                <p className="text-sm text-gray-600">確認並管理每月人員的工作狀態，用於獎金計算</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* 年份選擇器 */}
              <div className="flex flex-col">
                <label className="text-xs text-gray-600 mb-1">年份</label>
                <select
                  value={selectedYearMonth.split('-')[0]}
                  onChange={(e) => {
                    const month = selectedYearMonth.split('-')[1];
                    setSelectedYearMonth(`${e.target.value}-${month}`);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - 2 + i;
                    return (
                      <option key={year} value={year}>
                        {year} 年
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 月份選擇器 */}
              <div className="flex flex-col">
                <label className="text-xs text-gray-600 mb-1">月份</label>
                <select
                  value={selectedYearMonth.split('-')[1]}
                  onChange={(e) => {
                    const year = selectedYearMonth.split('-')[0];
                    setSelectedYearMonth(`${year}-${e.target.value}`);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const month = String(i + 1).padStart(2, '0');
                    return (
                      <option key={month} value={month}>
                        {i + 1} 月
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* 匯入按鈕 */}
              {canViewStoreStats() && (
                <div className="flex gap-2">
                  <div className="flex flex-col">
                    <label className="text-xs text-transparent mb-1">操作</label>
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 font-medium shadow-sm"
                    >
                      <Upload size={18} />
                      匯入業績資料
                    </button>
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs text-transparent mb-1">操作</label>
                    <button
                      onClick={() => setShowImportStatsModal(true)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium shadow-sm"
                    >
                      <Upload size={18} />
                      匯入門市統計
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 統計卡片 - 只有督導/經理/營業部助理看得到 */}
        {canViewStoreStats() && (
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
            userDepartment={userDepartment}
            userJobTitle={userJobTitle}
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
                        ref={(el) => { storeTabsRef.current[store.id] = el; }}
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
                    userDepartment={userDepartment}
                    userJobTitle={userJobTitle}
                    onRefresh={(moveToNext?: boolean) => loadStoreSummaries(moveToNext || false)}
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

      {/* 匯入業績 Modal - 主頁面層級 */}
      {showImportModal && (
        <ImportPerformanceModal
          yearMonth={selectedYearMonth}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false);
            loadStoreSummaries();
          }}
        />
      )}

      {/* 匯入門市統計 Modal */}
      {showImportStatsModal && (
        <ImportStoreStatsModal
          yearMonth={selectedYearMonth}
          onClose={() => setShowImportStatsModal(false)}
          onSuccess={() => {
            setShowImportStatsModal(false);
            loadStoreSummaries();
          }}
        />
      )}
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
  userDepartment,
  userJobTitle,
  onRefresh
}: {
  store: Store;
  yearMonth: string;
  userRole: string;
  userDepartment: string;
  userJobTitle: string;
  onRefresh: (moveToNext?: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [storeStatus, setStoreStatus] = useState<string>('pending');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // 判斷是否可以查看門市統計資料
  const canViewStoreStats = () => {
    // 1. admin, supervisor, area_manager 可以看
    if (['admin', 'supervisor', 'area_manager'].includes(userRole)) {
      return true;
    }
    // 2. 營業部人員（member 或 manager 角色）可以看
    if (userDepartment?.startsWith('營業') && (userRole === 'member' || userRole === 'manager')) {
      return true;
    }
    return false;
  };
  const [expandedStaffIds, setExpandedStaffIds] = useState<Set<string>>(new Set());
  const [staffDetails, setStaffDetails] = useState<{ [key: string]: any[] }>({});

  // 職位排序優先順序
  const getPositionOrder = (position: string): number => {
    // 一般職位
    const positionMap: { [key: string]: number } = {
      '督導': 1,
      '督導(代理店長)': 2,
      '店長': 3,
      '代理店長': 4,
      '副店長': 5,
      '主任': 6,
      '組長': 7,
      '專員': 8,
      '新人': 9,
      '行政': 9,
      '兼職': 10,
      '實習生': 11
    };
    
    return positionMap[position] || 999;
  };

  useEffect(() => {
    loadStaffStatus();
  }, [store.id, yearMonth]);

  const loadStaffStatus = async () => {
    setLoading(true);
    try {
      const { getMonthlyStaffStatus } = await import('@/app/store/actions');
      const result = await getMonthlyStaffStatus(yearMonth, store.id);
      
      if (result.success) {
        // 按職位排序
        const sortedData = (result.data || []).sort((a: any, b: any) => {
          const orderA = getPositionOrder(a.position || '');
          const orderB = getPositionOrder(b.position || '');
          return orderA - orderB;
        });
        setStaffList(sortedData);
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

  // 切換展開/收合員工業績明細
  const toggleStaffDetails = async (staffId: string) => {
    const newExpanded = new Set(expandedStaffIds);
    
    if (newExpanded.has(staffId)) {
      // 收合
      newExpanded.delete(staffId);
      setExpandedStaffIds(newExpanded);
    } else {
      // 展開 - 如果還沒載入過，先獲取數據
      if (!staffDetails[staffId]) {
        try {
          const response = await fetch(`/api/staff-performance-details?staff_status_id=${staffId}`);
          const result = await response.json();
          
          if (result.success && result.data && result.data.length > 0) {
            setStaffDetails(prev => ({
              ...prev,
              [staffId]: result.data
            }));
          }
        } catch (error) {
          console.error('Error loading staff details:', error);
        }
      }
      newExpanded.add(staffId);
      setExpandedStaffIds(newExpanded);
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
      const result = await submitStoreStatus(yearMonth, store.id, false);
      
      if (result.success) {
        alert('✅ 成功提交');
        loadStaffStatus();
        onRefresh();
      } else if (result.needNewbieCheck && result.newbiesNeedCheck) {
        // 有新人需要檢查階段
        setIsSubmitting(false);
        
        for (const newbie of result.newbiesNeedCheck) {
          const message = `${newbie.employee_code} ${newbie.employee_name}\n到職日：${newbie.start_date}\n目前系統登記為：${newbie.current_level}\n建議：${newbie.suggested_action}\n\n是否需進行該人員職位階段編輯？`;
          
          if (confirm(message)) {
            // 使用者選擇編輯，跳轉到編輯頁面
            router.push(`/monthly-status/edit/${newbie.id}?year_month=${yearMonth}&store_id=${store.id}`);
            return; // 跳轉後結束流程
          }
        }
        
        // 所有新人都選擇「否」，代表店長確認過，繼續提交（跳過檢查）
        if (confirm('確認所有新人階段無誤，繼續提交？')) {
          setIsSubmitting(true);
          const finalResult = await submitStoreStatus(yearMonth, store.id, true);
          
          if (finalResult.success) {
            alert('✅ 成功提交');
            loadStaffStatus();
            onRefresh();
          } else {
            alert(`❌ 提交失敗: ${finalResult.error}`);
          }
          setIsSubmitting(false);
        }
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
        // 傳入 true 表示自動跳到下一間未確認的門市
        onRefresh(true);
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

  const handleUnconfirm = async () => {
    if (!confirm('確定要取消確認此門市的人員狀態？取消後將回到已提交狀態。')) {
      return;
    }

    setIsConfirming(true);
    try {
      const { unconfirmStoreStatus } = await import('@/app/store/actions');
      const result = await unconfirmStoreStatus(yearMonth, store.id);
      
      if (result.success) {
        alert('✅ 已取消確認');
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 取消失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error unconfirming:', error);
      alert('取消失敗');
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
          ...result.data.map(row => headers.map(h => `"${(row as Record<string, any>)[h] || ''}"`).join(','))
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

  const handleDeleteManual = async (staffId: string, staffName: string, isManuallyAdded: boolean) => {
    const message = isManuallyAdded 
      ? `確定要刪除手動新增的員工 "${staffName}"？此操作無法復原。`
      : `確定要從本月狀態中移除員工 "${staffName}"？此操作無法復原。`;
    
    if (!confirm(message)) {
      return;
    }

    try {
      const { deleteMonthlyStatusRecord } = await import('@/app/store/actions');
      const result = await deleteMonthlyStatusRecord(staffId);
      
      if (result.success) {
        alert('✅ 已刪除');
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 刪除失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deleting:', error);
      alert('刪除失敗');
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
      {/* 門市標題、統計資料和操作按鈕 */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-shrink-0">
            <h2 className="text-2xl font-bold text-gray-900">
              {store.store_name}
            </h2>
            <p className="text-gray-600">
              {store.store_code} · {staffList.length} 位員工
            </p>
          </div>
          
          {/* 門市每月統計資料 - 只有督導以上/營業部助理可見，始終可編輯 */}
          {canViewStoreStats() && (
            <div className="flex-1">
              <StoreMonthlyStatsForm
                storeId={store.id}
                yearMonth={yearMonth}
                isReadOnly={false}
              />
            </div>
          )}

          <div className="flex gap-2 flex-shrink-0">
            {storeStatus !== 'confirmed' && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <Plus size={16} />
                手動新增員工
              </button>
            )}
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
      </div>

      {/* 手動新增員工 Modal */}
      {showAddModal && (
        <AddManualEmployeeModal
          yearMonth={yearMonth}
          storeId={store.id}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadStaffStatus();
            onRefresh();
          }}
        />
      )}

      {/* 人員列表 */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">員工</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">職位</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">雇用類型</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">到職日</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">本月狀態</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">天數/時數</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">特殊標記</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">計算區塊</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">交易次數</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">銷售金額</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">毛利</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">毛利率</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {staffList.map((staff) => (
              <>
                <tr key={staff.id} className={`hover:bg-gray-50 ${staff.is_manually_added ? 'bg-orange-50' : 'bg-white'}`}>
                <td className="px-4 py-3">
                  <div>
                    <div className="font-medium text-gray-900 flex items-center gap-2">
                      {staff.employee_name}
                      {staff.is_manually_added && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">手動新增</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">{staff.employee_code || '-'}</div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {staff.position || '-'}
                  {staff.newbie_level && (staff.position === '新人' || staff.position === '行政') && (
                    <span className="ml-1 text-xs text-blue-600">
                      ({staff.newbie_level.replace('新人', '').replace('行政', '')})
                    </span>
                  )}
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
                  {staff.start_date ? new Date(staff.start_date).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {getMonthlyStatusLabel(staff.monthly_status)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {staff.supervisor_shift_hours && staff.supervisor_shift_hours > 0
                    ? `${staff.supervisor_shift_hours} 小時`
                    : staff.employment_type === 'full_time' 
                      ? `${staff.work_days || 0}/${staff.total_days_in_month} 天`
                      : `${staff.work_hours || 0} 小時`
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {staff.is_dual_position && (
                      <span className="px-2 py-0.5 text-xs rounded bg-orange-100 text-orange-800">雙職務</span>
                    )}
                    {staff.has_manager_bonus && (
                      <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">店長加成</span>
                    )}
                    {staff.is_supervisor_rotation && (
                      <span className="px-2 py-0.5 text-xs rounded bg-red-100 text-red-800">督導卡班</span>
                    )}
                    {staff.special_role && (
                      <span className="px-2 py-0.5 text-xs rounded bg-teal-100 text-teal-800">{staff.special_role}</span>
                    )}
                    {staff.extra_tasks && staff.extra_tasks.length > 0 && (
                      <span className="px-2 py-0.5 text-xs rounded bg-indigo-100 text-indigo-800">
                        {staff.extra_tasks.join(', ')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${getBlockColor(staff.calculated_block)}`}>
                    區塊 {staff.calculated_block || '?'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {staff.transaction_count ? (
                    <span className="font-medium text-gray-900">{staff.transaction_count.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {staff.sales_amount ? (
                    <span className="font-medium text-gray-900">${staff.sales_amount.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {staff.gross_profit ? (
                    <span className={`font-medium ${staff.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${Math.round(staff.gross_profit).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    {staff.gross_profit_rate ? (
                      <span className="font-medium text-blue-600">{staff.gross_profit_rate}%</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                    {/* 如果有業績數據，顯示展開按鈕 */}
                    {staff.transaction_count && staff.transaction_count > 0 && (
                      <button
                        onClick={() => toggleStaffDetails(staff.id)}
                        className="text-gray-500 hover:text-blue-600 transition-colors"
                        title={expandedStaffIds.has(staff.id) ? "收合明細" : "展開明細"}
                      >
                        <ChevronDown 
                          size={18} 
                          className={`transform transition-transform ${expandedStaffIds.has(staff.id) ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {storeStatus !== 'confirmed' && (
                      <button
                        onClick={() => router.push(`/monthly-status/edit/${staff.id}?year_month=${yearMonth}&store_id=${store.id}`)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        編輯
                      </button>
                    )}
                    {storeStatus !== 'confirmed' && (
                      <button
                        onClick={() => handleDeleteManual(staff.id, staff.employee_name, staff.is_manually_added)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center gap-1"
                      >
                        <Trash2 size={14} />
                        刪除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              
              {/* 展開的業績明細行 */}
              {expandedStaffIds.has(staff.id) && staffDetails[staff.id] && staffDetails[staff.id].length > 0 && (
                <tr key={`${staff.id}-details`} className="bg-blue-50">
                  <td colSpan={13} className="px-4 py-3">
                    <div className="ml-8">
                      <div className="text-xs font-semibold text-gray-600 mb-2">各門市業績明細</div>
                      <div className="bg-white rounded border border-blue-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-blue-100">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">門市</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">交易次數</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">銷售金額</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">毛利</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">毛利率</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {staffDetails[staff.id].map((detail: any, idx: number) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-900">{detail.store_code}</td>
                                <td className="px-3 py-2 text-right text-gray-700">{detail.transaction_count?.toLocaleString() || '-'}</td>
                                <td className="px-3 py-2 text-right text-gray-700">${detail.sales_amount?.toLocaleString() || '0'}</td>
                                <td className="px-3 py-2 text-right">
                                  <span className={detail.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                                    ${Math.round(detail.gross_profit || 0).toLocaleString()}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right text-blue-600">{detail.gross_profit_rate || '0'}%</td>
                              </tr>
                            ))}
                            <tr className="bg-blue-50 font-semibold">
                              <td className="px-3 py-2 text-gray-900">合計</td>
                              <td className="px-3 py-2 text-right text-gray-900">{staff.transaction_count?.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-gray-900">${staff.sales_amount?.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={staff.gross_profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  ${Math.round(staff.gross_profit || 0).toLocaleString()}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right text-blue-600">{staff.gross_profit_rate}%</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
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
        {storeStatus === 'confirmed' && (userRole === 'admin' || userRole === 'supervisor' || userRole === 'area_manager') && (
          <button
            onClick={handleUnconfirm}
            disabled={isConfirming}
            className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={18} />
            {isConfirming ? '處理中...' : '取消確認'}
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

// 手動新增員工 Modal 元件
function AddManualEmployeeModal({
  yearMonth,
  storeId,
  onClose,
  onSuccess
}: {
  yearMonth: string;
  storeId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  
  // 基本資料
  const [employeeCode, setEmployeeCode] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [employmentType, setEmploymentType] = useState<'full_time' | 'part_time'>('full_time');
  const [isPharmacist, setIsPharmacist] = useState(false);
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyStatusType>('full_month');
  const [workDays, setWorkDays] = useState<number>(0);
  const [workHours, setWorkHours] = useState<number>(0);
  const [notes, setNotes] = useState('');
  
  // 新增欄位
  const [newbieLevel, setNewbieLevel] = useState<NewbieLevel | ''>('');
  const [partialMonthReason, setPartialMonthReason] = useState<PartialMonthReason | ''>('');
  const [partialMonthDays, setPartialMonthDays] = useState<number>(0);
  const [partialMonthNotes, setPartialMonthNotes] = useState('');
  const [extraTasks, setExtraTasks] = useState<ExtraTask[]>([]);

  // 計算當月天數
  const [year, month] = yearMonth.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();

  useEffect(() => {
    // 當狀態為整月在職時，自動設定工作天數
    if (monthlyStatus === 'full_month') {
      setWorkDays(totalDays);
    }
  }, [monthlyStatus, totalDays]);

  const handleExtraTaskToggle = (task: ExtraTask) => {
    if (extraTasks.includes(task)) {
      setExtraTasks(extraTasks.filter(t => t !== task));
    } else {
      setExtraTasks([...extraTasks, task]);
    }
  };

  const handleSave = async () => {
    if (!employeeName.trim()) {
      alert('請填寫員工姓名');
      return;
    }
    if (!position) {
      alert('請選擇職位');
      return;
    }

    setSaving(true);
    try {
      const { addManualEmployee } = await import('@/app/store/actions');
      
      const result = await addManualEmployee(yearMonth, storeId, {
        employee_code: employeeCode || undefined,
        employee_name: employeeName,
        position,
        employment_type: employmentType,
        is_pharmacist: isPharmacist,
        monthly_status: monthlyStatus,
        work_days: employmentType === 'full_time' ? workDays : undefined,
        work_hours: employmentType === 'part_time' ? workHours : undefined,
        notes: notes || undefined,
        newbie_level: newbieLevel || undefined,
        partial_month_reason: partialMonthReason || undefined,
        partial_month_days: partialMonthDays || undefined,
        partial_month_notes: partialMonthNotes || undefined,
        extra_tasks: extraTasks.length > 0 ? extraTasks : undefined
      });

      if (result.success) {
        alert('✅ 員工已新增');
        onSuccess();
      } else {
        alert(`❌ 新增失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error adding manual employee:', error);
      alert('新增失敗');
    } finally {
      setSaving(false);
    }
  };

  const showNewbieLevel = position === '新人' || monthlyStatus === 'new_hire';
  const isPartialMonth = monthlyStatus !== 'full_month';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">手動新增員工</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 基本資料 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                員工代號（選填）
              </label>
              <input
                type="text"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="如：A001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                員工姓名 *
              </label>
              <input
                type="text"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="請輸入姓名"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              職位 *
            </label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">請選擇職位</option>
              {POSITION_OPTIONS.map(pos => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>

          {/* 新人等級 */}
          {showNewbieLevel && (
            <div className="bg-blue-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-blue-700 mb-2">
                新人等級
              </label>
              <div className="flex flex-wrap gap-2">
                {NEWBIE_LEVEL_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`px-3 py-1 rounded-lg cursor-pointer text-sm ${
                      newbieLevel === opt.value 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-white text-gray-700 hover:bg-blue-100'
                    }`}
                  >
                    <input
                      type="radio"
                      value={opt.value}
                      checked={newbieLevel === opt.value}
                      onChange={(e) => setNewbieLevel(e.target.value as NewbieLevel)}
                      className="hidden"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                雇用類型 *
              </label>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as 'full_time' | 'part_time')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="full_time">正職</option>
                <option value="part_time">兼職</option>
              </select>
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPharmacist}
                  onChange={(e) => setIsPharmacist(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm font-medium text-gray-700">是藥師</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              本月狀態 *
            </label>
            <select
              value={monthlyStatus}
              onChange={(e) => setMonthlyStatus(e.target.value as MonthlyStatusType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {MONTHLY_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 非整月詳細 */}
          {isPartialMonth && (
            <div className="bg-yellow-50 rounded-lg p-4 space-y-3">
              <label className="block text-sm font-medium text-yellow-700">非整月原因</label>
              <select
                value={partialMonthReason}
                onChange={(e) => setPartialMonthReason(e.target.value as PartialMonthReason)}
                className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
              >
                <option value="">請選擇原因</option>
                {PARTIAL_MONTH_REASON_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={totalDays}
                  value={partialMonthDays}
                  onChange={(e) => setPartialMonthDays(parseInt(e.target.value) || 0)}
                  className="w-24 px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                />
                <span className="text-yellow-700 text-sm">/ {totalDays} 天</span>
              </div>
              <input
                type="text"
                value={partialMonthNotes}
                onChange={(e) => setPartialMonthNotes(e.target.value)}
                className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                placeholder="說明（如：5/15 到職）"
              />
            </div>
          )}

          {/* 天數/時數 */}
          {employmentType === 'full_time' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                本月工作天數
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={totalDays}
                  value={workDays}
                  onChange={(e) => setWorkDays(parseInt(e.target.value) || 0)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-600 text-sm">/ {totalDays} 天</span>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                本月工作時數
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={workHours}
                onChange={(e) => setWorkHours(parseFloat(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* 額外任務 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">額外任務</label>
            <div className="flex flex-wrap gap-2">
              {EXTRA_TASK_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`px-3 py-1 rounded-lg cursor-pointer text-sm ${
                    extraTasks.includes(opt.value)
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={extraTasks.includes(opt.value)}
                    onChange={() => handleExtraTaskToggle(opt.value)}
                    className="hidden"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 備註 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="如有特殊情況請說明..."
            />
          </div>
        </div>

        {/* 按鈕 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !employeeName.trim() || !position}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={18} />
            {saving ? '新增中...' : '新增員工'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 門市每月統計資料表單
function StoreMonthlyStatsForm({
  storeId,
  yearMonth,
  isReadOnly
}: {
  storeId: string;
  yearMonth: string;
  isReadOnly: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({
    total_staff_count: 0,
    admin_staff_count: 0,
    newbie_count: 0,
    business_days: 0,
    total_gross_profit: 0,
    total_customer_count: 0,
    prescription_addon_only_count: 0,
    regular_prescription_count: 0,
    chronic_prescription_count: 0
  });

  useEffect(() => {
    loadStats();
  }, [storeId, yearMonth]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const { getStoreMonthlySummary } = await import('@/app/store/actions');
      const result = await getStoreMonthlySummary(yearMonth, storeId);
      
      if (result.success && result.data) {
        setStats({
          total_staff_count: result.data.total_staff_count || 0,
          admin_staff_count: result.data.admin_staff_count || 0,
          newbie_count: result.data.newbie_count || 0,
          business_days: result.data.business_days || 0,
          total_gross_profit: result.data.total_gross_profit || 0,
          total_customer_count: result.data.total_customer_count || 0,
          prescription_addon_only_count: result.data.prescription_addon_only_count || 0,
          regular_prescription_count: result.data.regular_prescription_count || 0,
          chronic_prescription_count: result.data.chronic_prescription_count || 0
        });
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { updateStoreMonthlySummary } = await import('@/app/store/actions');
      const result = await updateStoreMonthlySummary(yearMonth, storeId, stats);
      
      if (result.success) {
        alert('✅ 已儲存');
      } else {
        alert(`❌ 儲存失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving stats:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  // 計算客毛利
  const customerGrossProfit = stats.total_customer_count > stats.prescription_addon_only_count
    ? Math.round(stats.total_gross_profit / (stats.total_customer_count - stats.prescription_addon_only_count))
    : 0;

  if (loading) {
    return <div className="text-sm text-gray-500">載入統計資料中...</div>;
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-900">門市每月統計資料</h3>
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? '儲存中...' : '儲存'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 左側：應有人員 */}
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-2">應有人員</h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">門市人數</label>
                <input
                  type="number"
                  value={stats.total_staff_count}
                  onChange={(e) => setStats({ ...stats, total_staff_count: parseInt(e.target.value) || 0 })}
                  disabled={isReadOnly}
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">行政人數</label>
                <input
                  type="number"
                  value={stats.admin_staff_count}
                  onChange={(e) => setStats({ ...stats, admin_staff_count: parseInt(e.target.value) || 0 })}
                  disabled={isReadOnly}
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">新人人數</label>
                <input
                  type="number"
                  value={stats.newbie_count}
                  onChange={(e) => setStats({ ...stats, newbie_count: parseInt(e.target.value) || 0 })}
                  disabled={isReadOnly}
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-600 font-semibold text-purple-600">人力點值</label>
              <div className="w-20 px-2 py-1 bg-purple-100 text-purple-900 rounded text-xs font-semibold text-center">
                {((stats.total_staff_count * 1) + (stats.admin_staff_count * 0.5) + (stats.newbie_count * 0.3)).toFixed(1)}
              </div>
              <span className="text-xs text-gray-500">
                (門市×1 + 行政×0.5 + 新人×0.3)
              </span>
            </div>
          </div>
        </div>

        {/* 右側：該月營業狀態 */}
        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-2">該月營業狀態</h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">營業天數</label>
                <input
                  type="number"
                  value={stats.business_days}
                  onChange={(e) => setStats({ ...stats, business_days: parseInt(e.target.value) || 0 })}
                  disabled={isReadOnly}
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">毛利</label>
                <input
                  type="text"
                  value={stats.total_gross_profit.toLocaleString()}
                  onChange={(e) => {
                    const value = e.target.value.replace(/,/g, '');
                    setStats({ ...stats, total_gross_profit: parseFloat(value) || 0 });
                  }}
                  disabled={isReadOnly}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 text-right"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">日毛利</label>
                <div className="w-24 px-2 py-1 border border-gray-300 rounded text-xs bg-gray-50 text-gray-700 text-right">
                  {(stats.business_days > 0 ? Math.round(stats.total_gross_profit / stats.business_days) : 0).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">總來客數</label>
                <input
                  type="text"
                  value={stats.total_customer_count.toLocaleString()}
                  onChange={(e) => {
                    const value = e.target.value.replace(/,/g, '');
                    setStats({ ...stats, total_customer_count: parseInt(value) || 0 });
                  }}
                  disabled={isReadOnly}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 text-right"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">單純處方加購</label>
                <input
                  type="text"
                  value={stats.prescription_addon_only_count.toLocaleString()}
                  onChange={(e) => {
                    const value = e.target.value.replace(/,/g, '');
                    setStats({ ...stats, prescription_addon_only_count: parseInt(value) || 0 });
                  }}
                  disabled={isReadOnly}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 text-right"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600 font-semibold text-blue-600">客毛利</label>
                <div className="w-16 px-2 py-1 bg-blue-100 text-blue-900 rounded text-xs font-semibold text-center">
                  {customerGrossProfit.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">一般箋張數</label>
                <input
                  type="text"
                  value={stats.regular_prescription_count.toLocaleString()}
                  onChange={(e) => {
                    const value = e.target.value.replace(/,/g, '');
                    setStats({ ...stats, regular_prescription_count: parseInt(value) || 0 });
                  }}
                  disabled={isReadOnly}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 text-right"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-600">慢箋張數</label>
                <input
                  type="text"
                  value={stats.chronic_prescription_count.toLocaleString()}
                  onChange={(e) => {
                    const value = e.target.value.replace(/,/g, '');
                    setStats({ ...stats, chronic_prescription_count: parseInt(value) || 0 });
                  }}
                  disabled={isReadOnly}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 text-right"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
