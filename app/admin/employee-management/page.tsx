import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { UserCog, Plus, Search, Edit, Trash2, Building2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function EmployeeManagementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, job_title')
    .eq('id', user.id)
    .single();

  // 檢查是否為需要指派的職位
  const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');

  // 檢查權限：admin、營業部助理和營業部主管
  const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
  const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
  
  if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
    redirect('/dashboard');
  }

  // 獲取所有員工資料（從 store_employees 表）
  const { data: employees } = await supabase
    .from('store_employees')
    .select(`
      id,
      employee_code,
      employee_name,
      position,
      current_position,
      is_active,
      start_date,
      store_id,
      stores:store_id (
        store_code,
        store_name
      )
    `)
    .order('employee_code');

  // 統計資訊
  const totalEmployees = employees?.length || 0;
  const activeEmployees = employees?.filter(e => e.is_active).length || 0;

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <UserCog className="text-blue-600" size={40} />
              員工管理
            </h1>
            <p className="text-gray-600">管理所有員工資料庫，提供每月人員狀態使用</p>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium mb-1">總員工數</p>
                <p className="text-3xl font-bold text-gray-900">{totalEmployees}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <UserCog className="text-blue-600" size={24} />
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium mb-1">在職員工</p>
                <p className="text-3xl font-bold text-green-600">{activeEmployees}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <UserCog className="text-green-600" size={24} />
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium mb-1">離職員工</p>
                <p className="text-3xl font-bold text-gray-600">{totalEmployees - activeEmployees}</p>
              </div>
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                <UserCog className="text-gray-600" size={24} />
              </div>
            </div>
          </div>
        </div>

        {/* 員工列表 */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* 表頭 */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">員工資料庫</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    placeholder="搜尋員編或姓名..."
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 表格 */}
          {!employees || employees.length === 0 ? (
            <div className="p-12 text-center">
              <UserCog className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">尚無員工資料</h3>
              <p className="text-gray-600">請先在門市管理中新增員工</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">員編</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">姓名</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">職位</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">當前職位</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">所屬門市</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">到職日</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">狀態</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {emp.employee_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {emp.employee_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.position || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.current_position || emp.position || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <Building2 size={14} className="text-gray-400" />
                          {emp.stores?.store_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.start_date || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          emp.is_active 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {emp.is_active ? '在職' : '離職'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 表尾統計 */}
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-3">
            <div className="text-sm text-gray-600">
              共 <span className="font-semibold text-gray-900">{totalEmployees}</span> 位員工
              （在職 <span className="text-green-600 font-semibold">{activeEmployees}</span> 位）
            </div>
          </div>
        </div>

        {/* 說明 */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• 此頁面顯示所有員工資料庫，來源為各門市的員工資料</li>
            <li>• 在每月人員狀態手動新增員工時，可從此資料庫選擇，避免輸入錯誤</li>
            <li>• 員工的新增和編輯請至各門市的「員工管理」功能進行</li>
            <li>• 員工的升遷記錄請使用「升遷管理」功能統一管理</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
