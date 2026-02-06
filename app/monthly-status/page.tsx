'use client';

import { useState, useEffect, useRef, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ImportPerformanceModal from '@/components/ImportPerformanceModal';
import ImportStoreStatsModal from '@/components/ImportStoreStatsModal';
import MealAllowanceModal from '@/components/MealAllowanceModal';
import SupportBonusModal from '@/components/SupportBonusModal';
import TransportExpenseModal from '@/components/TransportExpenseModal';
import TalentCultivationModal from '@/components/TalentCultivationModal';
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
  ChevronDown,
  FileText,
  Calendar
} from 'lucide-react';
import type { Store, MonthlyStoreSummary, MonthlyStatusType, NewbieLevel, PartialMonthReason, ExtraTask, EmployeeMovementHistory } from '@/types/workflow';
import { 
  MONTHLY_STATUS_OPTIONS, 
  POSITION_OPTIONS,
  NEWBIE_LEVEL_OPTIONS,
  PARTIAL_MONTH_REASON_OPTIONS,
  EXTRA_TASK_OPTIONS,
  SPECIAL_ROLE_OPTIONS
} from '@/types/workflow';
import { generateSingleItemBonusPDF } from '@/components/SingleItemBonusPDF';

function MonthlyStatusContent() {
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
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{code: string; name: string} | null>(null);
  const [movementHistory, setMovementHistory] = useState<EmployeeMovementHistory[]>([]);
  const [loadingMovement, setLoadingMovement] = useState(false);
  const storeTabsRef = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  // 初始化當前年月（使用當前月份或 URL 參數）
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
        
        // 檢查 URL 參數中是否有指定門市
        const urlStoreId = searchParams.get('store_id');
        if (urlStoreId && result.data?.some(s => s.id === urlStoreId)) {
          // 如果 URL 中有指定門市且該門市在管理列表中，則選擇該門市
          setSelectedStoreId(urlStoreId);
        } else if (result.data?.length === 1) {
          // 否則，如果只有一間門市，自動選擇
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

  // 載入員工異動歷程
  const loadMovementHistory = async (employeeCode: string, employeeName: string) => {
    setSelectedEmployee({ code: employeeCode, name: employeeName });
    setShowMovementModal(true);
    setLoadingMovement(true);
    
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      
      const { data, error } = await supabase
        .from('employee_movement_history')
        .select(`
          *,
          stores:store_id (
            store_name
          )
        `)
        .eq('employee_code', employeeCode)
        .not('store_id', 'is', null)
        .order('movement_date', { ascending: false });

      if (error) {
        console.error('Error loading movement history:', error);
        throw error;
      }
      setMovementHistory(data || []);
    } catch (error) {
      console.error('Error loading movement history:', error);
      setMovementHistory([]);
    } finally {
      setLoadingMovement(false);
    }
  };

  // 獲取異動類型顯示文字
  const getMovementTypeLabel = (type: string) => {
    switch (type) {
      case 'promotion': return '升職';
      case 'leave_without_pay': return '留職停薪';
      case 'return_to_work': return '復職';
      case 'pass_probation': return '過試用期';
      case 'resignation': return '離職';
      default: return type;
    }
  };

  // 獲取異動類型顏色
  const getMovementTypeColor = (type: string) => {
    switch (type) {
      case 'promotion': return 'bg-emerald-100 text-emerald-700';
      case 'leave_without_pay': return 'bg-yellow-100 text-yellow-700';
      case 'return_to_work': return 'bg-blue-100 text-blue-700';
      case 'pass_probation': return 'bg-purple-100 text-purple-700';
      case 'resignation': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
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
            managedStores={managedStores}
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
                    managedStores={managedStores}
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

      {/* 員工異動歷程 Modal */}
      {showMovementModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="text-emerald-600" />
                  人員異動歷程
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedEmployee.name} ({selectedEmployee.code})
                </p>
              </div>
              <button
                onClick={() => setShowMovementModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              {loadingMovement ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-600 border-t-transparent mx-auto mb-2"></div>
                  <p className="text-gray-600">載入中...</p>
                </div>
              ) : movementHistory.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">尚無異動記錄</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 時間軸線 */}
                  <div className="relative">
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                    
                    {movementHistory.map((record, index) => (
                      <div key={record.id} className="relative flex gap-4 mb-6">
                        {/* 時間點 */}
                        <div className="relative z-10 w-12 flex-shrink-0 flex items-start justify-center pt-1">
                          <div className="w-3 h-3 rounded-full bg-emerald-600 ring-4 ring-white"></div>
                        </div>

                        {/* 內容 */}
                        <div className="flex-1 bg-gray-50 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-900">
                                {record.movement_date}
                              </span>
                              <span className={`px-2 py-1 text-xs rounded-full ${getMovementTypeColor(record.movement_type)}`}>
                                {getMovementTypeLabel(record.movement_type)}
                              </span>
                              {record.stores && (
                                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                                  {record.stores.name}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {record.movement_type === 'promotion' && record.new_value && (
                            <div className="flex items-center gap-2 mb-2">
                              {record.old_value && (
                                <>
                                  <span className="text-gray-600">{record.old_value}</span>
                                  <span className="text-gray-400">→</span>
                                </>
                              )}
                              <span className="font-semibold text-emerald-600">{record.new_value}</span>
                            </div>
                          )}

                          {record.notes && (
                            <p className="text-sm text-gray-600 mt-2">
                              備註：{record.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                onClick={() => setShowMovementModal(false)}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
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
  managedStores,
  onRefresh
}: {
  store: Store;
  yearMonth: string;
  userRole: string;
  userDepartment: string;
  userJobTitle: string;
  managedStores: Store[];
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
  const [showMealAllowanceModal, setShowMealAllowanceModal] = useState(false);
  const [showSupportBonusModal, setShowSupportBonusModal] = useState(false);
  const [showTransportExpenseModal, setShowTransportExpenseModal] = useState(false);
  const [showTalentCultivationModal, setShowTalentCultivationModal] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{code: string; name: string} | null>(null);
  const [movementHistory, setMovementHistory] = useState<any[]>([]);
  const [loadingMovement, setLoadingMovement] = useState(false);

  // 判斷是否可以查看門市統計資料
  const canViewStoreStats = () => {
    // 1. admin, supervisor, area_manager 可以看
    if (['admin', 'supervisor', 'area_manager'].includes(userRole)) {
      return true;
    }
    // 2. 營業部人員（member 或 manager 角色），但不包括需要指派的職位
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(userJobTitle);
    if (userDepartment?.startsWith('營業') && (userRole === 'member' || userRole === 'manager') && !needsAssignment) {
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

  // 載入員工異動歷程
  const loadMovementHistory = async (employeeCode: string, employeeName: string) => {
    setSelectedEmployee({ code: employeeCode, name: employeeName });
    setShowMovementModal(true);
    setLoadingMovement(true);
    
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      
      const { data, error } = await supabase
        .from('employee_movement_history')
        .select(`
          *,
          stores:store_id (
            store_name
          )
        `)
        .eq('employee_code', employeeCode)
        .not('store_id', 'is', null)
        .order('movement_date', { ascending: false });

      if (error) {
        console.error('Error loading movement history:', error);
        throw error;
      }
      setMovementHistory(data || []);
    } catch (error) {
      console.error('Error loading movement history:', error);
      setMovementHistory([]);
    } finally {
      setLoadingMovement(false);
    }
  };

  // 獲取異動類型顯示文字
  const getMovementTypeLabel = (type: string) => {
    switch (type) {
      case 'promotion': return '升職';
      case 'leave_without_pay': return '留職停薪';
      case 'return_to_work': return '復職';
      case 'pass_probation': return '過試用期';
      case 'resignation': return '離職';
      default: return type;
    }
  };

  // 獲取異動類型顏色
  const getMovementTypeColor = (type: string) => {
    switch (type) {
      case 'promotion': return 'bg-emerald-100 text-emerald-700';
      case 'leave_without_pay': return 'bg-yellow-100 text-yellow-700';
      case 'return_to_work': return 'bg-blue-100 text-blue-700';
      case 'pass_probation': return 'bg-purple-100 text-purple-700';
      case 'resignation': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
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

  const handleRevert = async () => {
    if (!confirm('確定要恢復此門市的人員狀態？恢復後將回到待填寫狀態，店長可重新編輯。')) {
      return;
    }

    setIsConfirming(true);
    try {
      const { revertSubmitStatus } = await import('@/app/store/actions');
      const result = await revertSubmitStatus(yearMonth, store.id);
      
      if (result.success) {
        alert('✅ 已恢復至待填寫狀態');
        loadStaffStatus();
        onRefresh();
      } else {
        alert(`❌ 恢復失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error reverting:', error);
      alert('恢復失敗');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleExportBonusPDF = async () => {
    try {
      // 從 API 獲取獎金資料
      const response = await fetch('/api/export-single-item-bonus-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          store_id: store.id
        })
      });

      if (!response.ok) {
        throw new Error('取得資料失敗');
      }

      const result = await response.json();
      
      // 在客戶端生成 PDF
      await generateSingleItemBonusPDF(
        result.staff,
        result.store_code,
        result.store_name,
        yearMonth
      );
      
    } catch (error) {
      console.error('Export error:', error);
      alert('❌ 匯出失敗: ' + (error instanceof Error ? error.message : '未知錯誤'));
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
          
          {/* 檢查是否為該門市的店長（包括被指派為店長的督導） */}
          {(() => {
            const isStoreManager = managedStores.some(s => s.id === store.id) && 
              ['店長', '代理店長', '督導', '督導(代理店長)'].includes(userJobTitle);
            const canEditSupportHours = ['admin', 'supervisor', 'area_manager'].includes(userRole) || isStoreManager;
            const shouldViewStats = canViewStoreStats();
            
            // 如果可以查看統計資料，顯示統計資料表單（如果同時有編輯權限，則隱藏其中的支援時數區塊）
            if (shouldViewStats) {
              return (
                <div className="flex-1 flex flex-col gap-4">
                  <StoreMonthlyStatsForm
                    storeId={store.id}
                    yearMonth={yearMonth}
                    isReadOnly={false}
                    hideSupportHours={canEditSupportHours}
                  />
                  {/* 如果有編輯支援時數的權限，額外顯示支援時數表單 */}
                  {canEditSupportHours && (
                    <StoreSupportHoursForm
                      storeId={store.id}
                      yearMonth={yearMonth}
                      isReadOnly={storeStatus === 'confirmed'}
                    />
                  )}
                </div>
              );
            }
            
            // 否則如果只有編輯支援時數的權限（不能查看統計資料），只顯示支援時數表單
            if (canEditSupportHours) {
              return (
                <div className="flex-1">
                  <StoreSupportHoursForm
                    storeId={store.id}
                    yearMonth={yearMonth}
                    isReadOnly={storeStatus === 'confirmed'}
                  />
                </div>
              );
            }
            
            return null;
          })()}

          <div className="flex flex-col gap-2 flex-shrink-0">
            {/* 第一行：基本操作按鈕 */}
            <div className="flex gap-2 flex-wrap">
              {storeStatus !== 'confirmed' && (
                <>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                  >
                    <Plus size={16} />
                    手動新增員工
                  </button>
                  <button
                    onClick={() => setShowMealAllowanceModal(true)}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center gap-2"
                  >
                    <CalendarCheck size={16} />
                    誤餐費登記
                  </button>
                </>
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

            {/* 第二行：獎金與費用按鈕（店長以上） */}
            {storeStatus !== 'confirmed' && 
              (['admin', 'manager', 'supervisor', 'area_manager'].includes(userRole) || 
               ['店長', '代理店長', '督導', '督導(代理店長)'].includes(userJobTitle)) && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowSupportBonusModal(true)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  上個月單品獎金
                </button>
                <button
                  onClick={() => setShowTransportExpenseModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  交通費用
                </button>
                <button
                  onClick={() => setShowTalentCultivationModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  育才獎金
                </button>
              </div>
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

      {/* 誤餐費登記 Modal */}
      {showMealAllowanceModal && (
        <MealAllowanceModal
          isOpen={showMealAllowanceModal}
          onClose={() => setShowMealAllowanceModal(false)}
          yearMonth={yearMonth}
          storeId={store.id}
          storeName={store.store_name}
        />
      )}

      {/* 上個月單品獎金 Modal */}
      {showSupportBonusModal && (
        <SupportBonusModal
          isOpen={showSupportBonusModal}
          onClose={() => {
            setShowSupportBonusModal(false);
            loadStaffStatus(); // 關閉時重新載入資料
          }}
          yearMonth={yearMonth}
          storeId={store.id}
          currentStaffList={staffList}
        />
      )}

      {/* 交通費用 Modal */}
      {showTransportExpenseModal && (
        <TransportExpenseModal
          isOpen={showTransportExpenseModal}
          onClose={() => {
            setShowTransportExpenseModal(false);
            loadStaffStatus(); // 關閉時重新載入資料
          }}
          yearMonth={yearMonth}
          storeId={store.id}
          currentStaffList={staffList}
        />
      )}

      {/* 育才獎金 Modal */}
      {showTalentCultivationModal && (
        <TalentCultivationModal
          isOpen={showTalentCultivationModal}
          onClose={() => {
            setShowTalentCultivationModal(false);
            loadStaffStatus(); // 關閉時重新載入資料
          }}
          yearMonth={yearMonth}
          storeId={store.id}
          currentStaffList={staffList}
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
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">上月單品獎金</th>
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
                    <div 
                      className="font-medium text-gray-900 flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors"
                      onClick={() => loadMovementHistory(staff.employee_code, staff.employee_name)}
                      title="點擊查看異動歷程"
                    >
                      {staff.employee_name}
                      {staff.is_manually_added && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">手動新增</span>
                      )}
                      <TrendingUp className="w-4 h-4 text-gray-400" />
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
                    : staff.extra_task_planned_hours && staff.extra_task_planned_hours > 0
                      ? `${staff.extra_task_planned_hours} 小時`
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
                        {(staff.extra_tasks.includes('長照外務') || staff.extra_tasks.includes('診所業務')) && 
                         staff.extra_task_external_hours && staff.extra_task_external_hours > 0 && (
                          <span className="ml-1 font-semibold">({staff.extra_task_external_hours}h)</span>
                        )}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {staff.last_month_single_item_bonus ? (
                    <span className="font-medium text-purple-600">${staff.last_month_single_item_bonus.toLocaleString()}</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
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
                              <tr key={idx} className={detail.is_from_file2 ? 'hover:bg-purple-50 bg-purple-25' : 'hover:bg-gray-50'}>
                                <td className="px-3 py-2 text-gray-900">
                                  {detail.store_code}
                                  {detail.is_from_file2 && (
                                    <span className="ml-2 text-xs text-purple-600 font-medium">(處方加購回補)</span>
                                  )}
                                </td>
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
        {/* 匯出單品獎金 PDF 按鈕（店長以上可見） */}
        {(userRole === 'store_manager' || userRole === 'admin' || userRole === 'supervisor' || userRole === 'area_manager' || 
          ['店長', '代理店長', '督導', '督導(代理店長)'].includes(userJobTitle)) && (
          <button
            onClick={handleExportBonusPDF}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold flex items-center gap-2"
          >
            <FileText size={18} />
            匯出單品獎金 PDF
          </button>
        )}
        {storeStatus === 'in_progress' && ((['admin', 'supervisor', 'area_manager'].includes(userRole)) || managedStores.some(s => s.id === store.id)) && (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={18} />
            {isSubmitting ? '提交中...' : '送出審核'}
          </button>
        )}
        {storeStatus === 'submitted' && (
          <>
            {(userRole === 'admin' || userRole === 'area_manager' || userRole === 'store_manager' || userRole === 'supervisor') && (
              <button
                onClick={handleRevert}
                disabled={isConfirming}
                className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={18} />
                {isConfirming ? '處理中...' : '恢復至待填寫'}
              </button>
            )}
            {(userRole === 'admin' || userRole === 'supervisor' || userRole === 'area_manager') && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleConfirm}
                  disabled={isConfirming}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
                >
                  <Check size={18} />
                  {isConfirming ? '確認中...' : '確認審核'}
                </button>
                <p className="text-sm text-gray-600 text-center">
                  ⚠️ 按完確認審核後，如需變更請聯繫營業部-李玹瑩
                </p>
              </div>
            )}
          </>
        )}
        {storeStatus === 'confirmed' && (
          <>
            {(userRole === 'admin' || userRole === 'area_manager' || (userDepartment === '營業部' && userJobTitle === '助理' && userRole === 'manager')) && (
              <button
                onClick={handleUnconfirm}
                disabled={isConfirming}
                className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={18} />
                {isConfirming ? '處理中...' : '取消確認'}
              </button>
            )}
            {userRole === 'supervisor' && (
              <div className="px-6 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700 text-center">
                  ℹ️ 此資料已確認審核，如需變更請聯繫營業部-李玹瑩
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 員工異動歷程 Modal */}
      {showMovementModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <TrendingUp className="text-emerald-600" />
                  人員異動歷程
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedEmployee.name} ({selectedEmployee.code})
                </p>
              </div>
              <button
                onClick={() => setShowMovementModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              {loadingMovement ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-600 border-t-transparent mx-auto mb-2"></div>
                  <p className="text-gray-600">載入中...</p>
                </div>
              ) : movementHistory.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">尚無異動記錄</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 時間軸線 */}
                  <div className="relative">
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                    
                    {movementHistory.map((record: any, index: number) => (
                      <div key={record.id} className="relative flex gap-4 mb-6">
                        {/* 時間點 */}
                        <div className="relative z-10 w-12 flex-shrink-0 flex items-start justify-center pt-1">
                          <div className="w-3 h-3 rounded-full bg-emerald-600 ring-4 ring-white"></div>
                        </div>

                        {/* 內容 */}
                        <div className="flex-1 bg-gray-50 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-900">
                                {record.movement_date}
                              </span>
                              <span className={`px-2 py-1 text-xs rounded-full ${getMovementTypeColor(record.movement_type)}`}>
                                {getMovementTypeLabel(record.movement_type)}
                              </span>
                              {record.stores && (
                                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                                  {record.stores.name}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {record.movement_type === 'promotion' && record.new_value && (
                            <div className="flex items-center gap-2 mb-2">
                              {record.old_value && (
                                <>
                                  <span className="text-gray-600">{record.old_value}</span>
                                  <span className="text-gray-400">→</span>
                                </>
                              )}
                              <span className="font-semibold text-emerald-600">{record.new_value}</span>
                            </div>
                          )}

                          {record.notes && (
                            <p className="text-sm text-gray-600 mt-2">
                              備註：{record.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                onClick={() => setShowMovementModal(false)}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
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
  
  // 員工搜尋相關
  const [employees, setEmployees] = useState<Array<{employee_code: string; employee_name: string; position: string; start_date: string | null}>>([]);
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  
  // 基本資料
  const [employeeCode, setEmployeeCode] = useState('');
  const [employeeCodeError, setEmployeeCodeError] = useState('');
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
  const [partialMonthNotes, setPartialMonthNotes] = useState('');
  const [extraTasks, setExtraTasks] = useState<ExtraTask[]>([]);
  
  // 外務時數（長照外務/診所業務）
  const [extraTaskPlannedHours, setExtraTaskPlannedHours] = useState<number>(0);
  const [extraTaskExternalHours, setExtraTaskExternalHours] = useState<number>(0);
  
  // 獎金費用
  const [lastMonthSingleItemBonus, setLastMonthSingleItemBonus] = useState<number>(0);
  const [talentCultivationBonus, setTalentCultivationBonus] = useState<number>(0);
  const [talentCultivationTarget, setTalentCultivationTarget] = useState('');
  
  // 店長/代理店長支援時數
  const [supportToOtherStoresHours, setSupportToOtherStoresHours] = useState<number>(0);
  const [supportFromOtherStoresHours, setSupportFromOtherStoresHours] = useState<number>(0);

  // 計算當月天數
  const [year, month] = yearMonth.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();

  // 載入員工列表
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const response = await fetch('/api/employees/list');
        const data = await response.json();
        if (data.success) {
          setEmployees(data.employees || []);
        }
      } catch (error) {
        console.error('Error loading employees:', error);
      }
    };
    loadEmployees();
  }, []);

  useEffect(() => {
    // 當狀態為整月在職時，自動設定工作天數
    if (monthlyStatus === 'full_month') {
      setWorkDays(totalDays);
    }
  }, [monthlyStatus, totalDays]);

  // 自動計算「該店規劃實上時數」當選擇額外任務時
  useEffect(() => {
    if (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) {
      let calculatedHours = 0;
      
      // 1. 如果選擇督導(代理店長)職位，使用本月上班時數
      // 注意：在新增頁面中，position 欄位可能包含 "-雙" 後綴
      if (position === '督導(代理店長)' || position.includes('督導(代理店長)')) {
        calculatedHours = workHours || 0;
      }
      // 2. 如果是正職整月任職則就算160小時
      else if (employmentType === 'full_time' && monthlyStatus === 'full_month') {
        calculatedHours = 160;
      }
      // 3. 如果有填入本月工作天數不滿(則代表有其他狀況)則要用天數計算上班時數→時數計算方式為:上班天數/5*32
      else if (employmentType === 'full_time' && monthlyStatus !== 'full_month' && workDays > 0) {
        calculatedHours = Math.round((workDays / 5 * 32) * 10) / 10; // 保留一位小數
      }
      
      setExtraTaskPlannedHours(calculatedHours);
    }
  }, [extraTasks, employmentType, monthlyStatus, workDays, workHours, position]);

  const handleExtraTaskToggle = (task: ExtraTask) => {
    if (extraTasks.includes(task)) {
      setExtraTasks(extraTasks.filter(t => t !== task));
    } else {
      setExtraTasks([...extraTasks, task]);
    }
  };

  // 驗證員編格式
  const validateEmployeeCode = (code: string) => {
    if (!code.trim()) {
      setEmployeeCodeError('');
      return true;
    }

    const upperCode = code.toUpperCase().trim();

    // 檢查是否為實習生代碼
    if (/^FKI\d{3}$/.test(upperCode)) {
      setEmployeeCodeError('💡 實習生不需要填寫員編');
      return false;
    }

    // 檢查有效格式
    const validFormats = [
      /^FK\d{4}$/,      // FK + 4碼數字
      /^FKF\d{5}$/,     // FKF + 5碼數字
      /^FKPT\d{3}$/     // FKPT + 3碼數字
    ];

    const isValid = validFormats.some(format => format.test(upperCode));

    if (!isValid) {
      setEmployeeCodeError('❌ 員編格式錯誤。正確格式：FK+4碼數字、FKF+5碼數字、FKPT+3碼數字');
      return false;
    }

    setEmployeeCodeError('');
    return true;
  };

  // 選擇員工時自動填入資料
  const handleEmployeeSelect = (employee: {employee_code: string; employee_name: string; position: string; start_date: string | null}) => {
    setEmployeeCode(employee.employee_code);
    setEmployeeName(employee.employee_name);
    setPosition(employee.position);
    setStartDate(employee.start_date || '');
    setShowEmployeeDropdown(false);
    setIsSearching(false);
    validateEmployeeCode(employee.employee_code);
  };

  // 過濾員工列表（精確匹配優先）
  const filteredEmployees = useMemo(() => {
    if (!isSearching || !employeeCode) return [];
    
    const search = employeeCode.toLowerCase();
    const exactMatches: typeof employees = [];
    const prefixMatches: typeof employees = [];
    const containsMatches: typeof employees = [];
    
    employees.forEach(emp => {
      const code = emp.employee_code.toLowerCase();
      const name = emp.employee_name.toLowerCase();
      
      if (code === search || name === search) {
        exactMatches.push(emp);
      } else if (code.startsWith(search) || name.startsWith(search)) {
        prefixMatches.push(emp);
      } else if (code.includes(search) || name.includes(search)) {
        containsMatches.push(emp);
      }
    });
    
    return [...exactMatches, ...prefixMatches, ...containsMatches].slice(0, 50);
  }, [employees, employeeCode, isSearching]);

  // 處理員編輸入
  const handleEmployeeCodeChange = (value: string) => {
    const upperValue = value.toUpperCase();
    setEmployeeCode(upperValue);
    setIsSearching(true);
    setShowEmployeeDropdown(true);
    validateEmployeeCode(upperValue);
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

    // 驗證員編
    if (employeeCode.trim() && !validateEmployeeCode(employeeCode)) {
      alert('員編格式不正確，請修正後再儲存');
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
        partial_month_days: (employmentType === 'full_time' && workDays > 0) ? workDays : undefined,
        partial_month_notes: partialMonthNotes || undefined,
        extra_tasks: extraTasks.length > 0 ? extraTasks : undefined,
        extra_task_planned_hours: (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) ? extraTaskPlannedHours : undefined,
        extra_task_external_hours: (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) ? extraTaskExternalHours : undefined,
        last_month_single_item_bonus: lastMonthSingleItemBonus || undefined,
        talent_cultivation_bonus: talentCultivationBonus || undefined,
        talent_cultivation_target: talentCultivationTarget || undefined,
        support_to_other_stores_hours: supportToOtherStoresHours || undefined,
        support_from_other_stores_hours: supportFromOtherStoresHours || undefined
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
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                員工代號（選填）
              </label>
              <input
                type="text"
                value={employeeCode}
                onChange={(e) => handleEmployeeCodeChange(e.target.value)}
                onFocus={() => {
                  setIsSearching(true);
                  setShowEmployeeDropdown(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setShowEmployeeDropdown(false);
                    setIsSearching(false);
                  }, 200);
                }}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  employeeCodeError ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                placeholder="FK0001 或搜尋員工"
              />
              {/* 員工下拉選單 */}
              {showEmployeeDropdown && filteredEmployees.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                  {filteredEmployees.map((emp) => (
                    <button
                      key={emp.employee_code}
                      onClick={() => handleEmployeeSelect(emp)}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-b-0"
                    >
                      <div>
                        <span className="font-medium text-gray-900">{emp.employee_code}</span>
                        <span className="mx-2 text-gray-400">-</span>
                        <span className="text-gray-600">{emp.employee_name}</span>
                      </div>
                      <span className="text-xs text-gray-500">{emp.position}</span>
                    </button>
                  ))}
                </div>
              )}
              {employeeCodeError && (
                <p className="text-xs text-red-600 mt-1">{employeeCodeError}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                格式：FK+4碼、FKF+5碼、FKPT+3碼
              </p>
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

          {/* 到職日顯示（只讀） */}
          {startDate && (
            <div className="bg-blue-50 rounded-lg p-3">
              <label className="block text-sm font-medium text-blue-700 mb-1">
                到職日
              </label>
              <div className="text-sm text-blue-900">
                {new Date(startDate).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
              </div>
            </div>
          )}

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
            
            {/* 當選擇長照外務或診所業務時顯示時數輸入框 */}
            {(extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) && (
              <div className="mt-3 bg-green-50 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-green-700 mb-1">
                      該店規劃實上時數（自動計算）
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={extraTaskPlannedHours}
                      readOnly
                      className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                      placeholder="自動計算"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-green-700 mb-1">
                      外務時數
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={extraTaskExternalHours}
                      onChange={(e) => setExtraTaskExternalHours(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-green-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                      placeholder="外務時數"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 店長/代理店長支援時數 */}
          {(position === '店長' || position === '代理店長' || position === '督導(代理店長)') && (
            <div className="bg-purple-50 rounded-lg p-4 space-y-3">
              <label className="block text-sm font-medium text-purple-700 mb-2">
                本月支援時數
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-purple-600 mb-1">
                    支援分店時數
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={supportToOtherStoresHours}
                      onChange={(e) => setSupportToOtherStoresHours(parseFloat(e.target.value) || 0)}
                      className="w-24 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <span className="text-purple-600 text-sm">小時</span>
                  </div>
                  <p className="text-xs text-purple-500 mt-1">去其他分店支援的時數</p>
                </div>
                <div>
                  <label className="block text-xs text-purple-600 mb-1">
                    分店支援時數
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={supportFromOtherStoresHours}
                      onChange={(e) => setSupportFromOtherStoresHours(parseFloat(e.target.value) || 0)}
                      className="w-24 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <span className="text-purple-600 text-sm">小時</span>
                  </div>
                  <p className="text-xs text-purple-500 mt-1">其他分店來支援的時數</p>
                </div>
              </div>
            </div>
          )}

          {/* 上個月個人單品獎金 */}
          <div className="bg-purple-50 rounded-lg p-4">
            <label className="block text-sm font-medium text-purple-700 mb-2">
              上個月個人單品獎金
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={lastMonthSingleItemBonus}
                onChange={(e) => setLastMonthSingleItemBonus(parseInt(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-purple-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                placeholder="0"
              />
              <span className="text-purple-600 text-sm">元</span>
            </div>
          </div>

          {/* 本月育才獎金 */}
          <div className="bg-indigo-50 rounded-lg p-4">
            <label className="block text-sm font-medium text-indigo-700 mb-2">
              本月育才獎金
            </label>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={talentCultivationBonus}
                  onChange={(e) => setTalentCultivationBonus(parseInt(e.target.value) || 0)}
                  className="w-32 px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="0"
                />
                <span className="text-indigo-600 text-sm">元</span>
              </div>
              <div>
                <label className="block text-xs text-indigo-600 mb-1">
                  育才對象
                </label>
                <input
                  type="text"
                  value={talentCultivationTarget}
                  onChange={(e) => setTalentCultivationTarget(e.target.value)}
                  className="w-full px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="請輸入育才對象姓名"
                />
              </div>
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
  isReadOnly,
  hideSupportHours = false
}: {
  storeId: string;
  yearMonth: string;
  isReadOnly: boolean;
  hideSupportHours?: boolean;
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
    chronic_prescription_count: 0,
    support_to_other_stores_hours: 0,
    support_from_other_stores_hours: 0
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
          chronic_prescription_count: result.data.chronic_prescription_count || 0,
          support_to_other_stores_hours: result.data.support_to_other_stores_hours || 0,
          support_from_other_stores_hours: result.data.support_from_other_stores_hours || 0
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

      {/* 支援時數資訊（唯讀顯示，由店長透過另一表單填寫） */}
      {!hideSupportHours && (
        <div className="mt-3 pt-3 border-t border-blue-300">
          <h4 className="text-xs font-semibold text-purple-700 mb-2">本月支援時數（由店長填寫）</h4>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-600">支援分店時數</label>
              <div className="w-20 px-2 py-1 border border-purple-200 bg-purple-50 rounded text-xs text-purple-900 text-center">
                {stats.support_to_other_stores_hours || 0}
              </div>
              <span className="text-xs text-purple-600">小時</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-600">分店支援時數</label>
              <div className="w-20 px-2 py-1 border border-purple-200 bg-purple-50 rounded text-xs text-purple-900 text-center">
                {stats.support_from_other_stores_hours || 0}
              </div>
              <span className="text-xs text-purple-600">小時</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">此資料由店長透過「本月支援時數」表單填寫</p>
        </div>
      )}
    </div>
  );
}

// 門市支援時數表單（獨立組件，供店長/代理店長/督導使用）
function StoreSupportHoursForm({
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
  const [existingData, setExistingData] = useState<any>(null);
  const [supportHours, setSupportHours] = useState({
    support_to_other_stores_hours: 0,
    support_from_other_stores_hours: 0
  });

  useEffect(() => {
    loadSupportHours();
  }, [storeId, yearMonth]);

  const loadSupportHours = async () => {
    setLoading(true);
    try {
      const { getStoreMonthlySummary } = await import('@/app/store/actions');
      const result = await getStoreMonthlySummary(yearMonth, storeId);
      
      if (result.success && result.data) {
        setExistingData(result.data);
        setSupportHours({
          support_to_other_stores_hours: result.data.support_to_other_stores_hours || 0,
          support_from_other_stores_hours: result.data.support_from_other_stores_hours || 0
        });
      }
    } catch (error) {
      console.error('Error loading support hours:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { updateStoreMonthlySummary } = await import('@/app/store/actions');
      
      // 如果沒有現有資料，則創建初始資料（全部為 0，只填寫支援時數）
      const updateData = {
        total_staff_count: existingData?.total_staff_count ?? 0,
        admin_staff_count: existingData?.admin_staff_count ?? 0,
        newbie_count: existingData?.newbie_count ?? 0,
        business_days: existingData?.business_days ?? 0,
        total_gross_profit: existingData?.total_gross_profit ?? 0,
        total_customer_count: existingData?.total_customer_count ?? 0,
        prescription_addon_only_count: existingData?.prescription_addon_only_count ?? 0,
        regular_prescription_count: existingData?.regular_prescription_count ?? 0,
        chronic_prescription_count: existingData?.chronic_prescription_count ?? 0,
        support_to_other_stores_hours: supportHours.support_to_other_stores_hours,
        support_from_other_stores_hours: supportHours.support_from_other_stores_hours
      };
      
      console.log('📝 開始儲存支援時數:', { 
        yearMonth, 
        storeId,
        updateData 
      });
      
      const result = await updateStoreMonthlySummary(yearMonth, storeId, updateData);
      
      console.log('📬 收到儲存結果:', result);
      
      if (result.success) {
        console.log('✅ 儲存成功！');
        alert('✅ 已儲存');
        // 重新載入以確認資料已儲存
        await loadSupportHours();
      } else {
        console.error('❌ 儲存失敗 - 錯誤詳情:', {
          error: result.error,
          debug: (result as any).debug,
          result: result
        });
        
        // 顯示詳細的診斷資訊
        let errorMsg = `❌ 儲存失敗\n\n錯誤訊息: ${result.error}`;
        
        if ((result as any).debug) {
          const debug = (result as any).debug;
          errorMsg += `\n\n診斷資訊:`;
          errorMsg += `\n• 用戶ID: ${debug.userId}`;
          errorMsg += `\n• 角色: ${debug.role}`;
          errorMsg += `\n• 職稱: ${debug.job_title}`;
          errorMsg += `\n• 是否管理員: ${debug.isAdmin ? '是' : '否'}`;
          errorMsg += `\n• 是否有店長記錄: ${debug.hasStoreManagerRecord ? '是' : '否'}`;
          errorMsg += `\n• 門市ID: ${debug.storeId}`;
          errorMsg += `\n• 年月: ${debug.yearMonth}`;
          
          if (debug.storeManagerData) {
            errorMsg += `\n• 店長記錄: ${JSON.stringify(debug.storeManagerData)}`;
          }
        }
        
        errorMsg += `\n\n請聯繫系統管理員並提供以上資訊`;
        
        alert(errorMsg);
      }
    } catch (error) {
      console.error('💥 發生例外錯誤:', error);
      alert(`❌ 儲存失敗\n\n例外錯誤:\n${error instanceof Error ? error.message : '未知錯誤'}\n\n請按 F12 開啟開發者工具查看更多詳情`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-purple-50 rounded-lg p-4 flex items-center justify-center">
        <div className="text-purple-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="bg-purple-50 rounded-lg p-4 space-y-3 border-2 border-purple-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-purple-800">
          📊 本月門市支援時數
        </h3>
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs font-medium disabled:opacity-50"
          >
            {saving ? '儲存中...' : '💾 儲存'}
          </button>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-3 border border-purple-200">
          <label className="block text-xs font-medium text-purple-700 mb-2">
            支援分店時數
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.5"
              value={supportHours.support_to_other_stores_hours}
              onChange={(e) => setSupportHours({ 
                ...supportHours, 
                support_to_other_stores_hours: parseFloat(e.target.value) || 0 
              })}
              disabled={isReadOnly}
              className="w-24 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm disabled:bg-gray-100"
            />
            <span className="text-purple-600 text-sm font-medium">小時</span>
          </div>
          <p className="text-xs text-purple-500 mt-1">本店去其他分店支援</p>
        </div>

        <div className="bg-white rounded-lg p-3 border border-purple-200">
          <label className="block text-xs font-medium text-purple-700 mb-2">
            分店支援時數
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.5"
              value={supportHours.support_from_other_stores_hours}
              onChange={(e) => setSupportHours({ 
                ...supportHours, 
                support_from_other_stores_hours: parseFloat(e.target.value) || 0 
              })}
              disabled={isReadOnly}
              className="w-24 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm disabled:bg-gray-100"
            />
            <span className="text-purple-600 text-sm font-medium">小時</span>
          </div>
          <p className="text-xs text-purple-500 mt-1">其他分店來本店支援</p>
        </div>
      </div>
    </div>
  );
}

export default function MonthlyStatusPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    }>
      <MonthlyStatusContent />
    </Suspense>
  );
}
