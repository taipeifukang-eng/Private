'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Edit2, Trash2, TrendingUp, Calendar, User, Briefcase } from 'lucide-react';
import type { EmployeePromotionHistory } from '@/types/workflow';

interface StoreEmployee {
  id: string;
  employee_code: string;
  employee_name: string;
  position: string;
  start_date: string | null;
  current_position: string | null;
  last_promotion_date: string | null;
}

export default function EmployeeManagementPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [employees, setEmployees] = useState<StoreEmployee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<StoreEmployee | null>(null);
  const [promotionHistory, setPromotionHistory] = useState<EmployeePromotionHistory[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  useEffect(() => {
    checkPermissionAndLoadData();
  }, [storeId]);

  const checkPermissionAndLoadData = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    // 判斷是否為需要指派的職位
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    
    // 判斷是否為營業部助理或主管
    const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    
    // 檢查權限：只有 admin、營業部助理和營業部主管可以訪問
    if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
      alert('權限不足');
      router.push('/admin/stores');
      return;
    }

    loadData();
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();

      // 載入門市資訊
      const { data: storeData } = await supabase
        .from('stores')
        .select('store_name')
        .eq('id', storeId)
        .single();

      if (storeData) {
        setStoreName(storeData.store_name);
      }

      // 載入員工列表
      const { data: employeeData } = await supabase
        .from('store_employees')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('employee_code');

      if (employeeData) {
        setEmployees(employeeData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadPromotionHistory = async (employeeCode: string) => {
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();

      const { data, error } = await supabase
        .from('employee_promotion_history')
        .select('*')
        .eq('employee_code', employeeCode)
        .eq('store_id', storeId)
        .order('promotion_date', { ascending: false });

      if (error) throw error;

      setPromotionHistory(data || []);
    } catch (error) {
      console.error('Error loading promotion history:', error);
      alert('載入升遷歷程失敗');
    }
  };

  const handleViewHistory = async (employee: StoreEmployee) => {
    setSelectedEmployee(employee);
    await loadPromotionHistory(employee.employee_code);
    setShowHistoryModal(true);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁首 */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">員工管理</h1>
              <p className="text-gray-600 mt-1">{storeName}</p>
            </div>
          </div>
        </div>

        {/* 員工列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員編
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    姓名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    職位
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    到職日期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    最後升遷日期
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      目前沒有員工資料
                    </td>
                  </tr>
                ) : (
                  employees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {employee.employee_code || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.employee_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.current_position || employee.position || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDate(employee.start_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDate(employee.last_promotion_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                        <button
                          onClick={() => handleViewHistory(employee)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                        >
                          <TrendingUp size={16} />
                          升遷歷程
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 升遷歷程 Modal */}
      {showHistoryModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">升遷歷程</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedEmployee.employee_code} - {selectedEmployee.employee_name}
                  </p>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* 當前狀態 */}
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <Briefcase className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm text-blue-600 font-medium">當前職位</div>
                    <div className="text-lg font-bold text-blue-900">
                      {selectedEmployee.current_position || selectedEmployee.position || '-'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 升遷時間軸 */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">歷史記錄</h3>
                {promotionHistory.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暫無升遷記錄
                  </div>
                ) : (
                  <div className="relative">
                    {/* 時間軸線 */}
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                    
                    {promotionHistory.map((record, index) => (
                      <div key={record.id} className="relative flex gap-4 mb-6">
                        {/* 時間點 */}
                        <div className="relative z-10 w-12 flex-shrink-0 flex items-start justify-center pt-1">
                          <div className="w-3 h-3 rounded-full bg-blue-600 ring-4 ring-white"></div>
                        </div>

                        {/* 內容 */}
                        <div className="flex-1 bg-gray-50 rounded-lg p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-900">
                                {formatDate(record.promotion_date)}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 mb-2">
                            {record.old_position && (
                              <>
                                <span className="text-gray-600">{record.old_position}</span>
                                <span className="text-gray-400">→</span>
                              </>
                            )}
                            <span className="font-semibold text-blue-600">{record.new_position}</span>
                          </div>

                          {record.notes && (
                            <p className="text-sm text-gray-600 mt-2">
                              {record.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
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
