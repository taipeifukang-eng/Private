'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ChevronLeft, 
  UserPlus, 
  Users, 
  Loader2,
  Trash2,
  Save,
  X,
  Plus,
  AlertCircle,
  Edit2
} from 'lucide-react';

interface Employee {
  id: string;
  employee_name: string | null;
  employee_code: string | null;
  position: string | null;
  employment_type: 'full_time' | 'part_time';
  is_pharmacist: boolean;
  is_active: boolean;
  start_date: string | null;
}

interface StoreInfo {
  id: string;
  store_code: string;
  store_name: string;
}

// 新員工表單資料結構
interface NewEmployeeForm {
  id: string;
  employee_name: string;
  employee_code: string;
  position: string;
  employment_type: 'full_time' | 'part_time';
  is_pharmacist: boolean;
  start_date: string;
}

const POSITION_OPTIONS = [
  { value: '督導', label: '督導' },
  { value: '店長', label: '店長' },
  { value: '代理店長', label: '代理店長' },
  { value: '督導(代理店長)', label: '督導(代理店長)' },
  { value: '副店長', label: '副店長' },
  { value: '主任', label: '主任' },
  { value: '組長', label: '組長' },
  { value: '專員', label: '專員' },
  { value: '新人', label: '新人' },
  { value: '行政', label: '行政' },
  { value: '兼職專員', label: '兼職專員' },
  { value: '兼職藥師', label: '兼職藥師' },
  { value: '兼職助理', label: '兼職助理' },
];

// 職位排序優先順序
const POSITION_ORDER: { [key: string]: number } = {
  '督導': 1,
  '督導(代理店長)': 2,
  '店長': 3,
  '代理店長': 4,
  '副店長': 5,
  '主任': 6,
  '組長': 7,
  '專員': 8,
  '新人': 9,
  '行政': 10,
  '兼職藥師': 11,
  '兼職專員': 12,
  '兼職助理': 13,
};

export default function StoreEmployeesPage() {
  const router = useRouter();
  const params = useParams();
  const storeId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    loadData();
  }, [storeId]);

  const loadData = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      // 載入門市資訊
      const { data: storeData } = await supabase
        .from('stores')
        .select('id, store_code, store_name')
        .eq('id', storeId)
        .single();

      if (!storeData) {
        alert('找不到該門市');
        router.push('/admin/stores');
        return;
      }
      setStore(storeData);

      // 載入門市員工
      const { data: empData } = await supabase
        .from('store_employees')
        .select('*')
        .eq('store_id', storeId);

      // 按職位排序
      const sortedEmployees = (empData || []).sort((a, b) => {
        const orderA = POSITION_ORDER[a.position || ''] || 999;
        const orderB = POSITION_ORDER[b.position || ''] || 999;
        
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        
        // 如果職位相同，按姓名排序
        return (a.employee_name || '').localeCompare(b.employee_name || '', 'zh-TW');
      });

      setEmployees(sortedEmployees);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmployee = async (employeeId: string, employeeName: string) => {
    if (!confirm(`確定要移除員工「${employeeName}」？\n\n⚠️ 此操作將同時刪除該員工的所有月度狀態記錄`)) return;

    try {
      const { deleteStoreEmployee } = await import('@/app/store/actions');
      const result = await deleteStoreEmployee(employeeId);

      if (result.success) {
        setEmployees(employees.filter(e => e.id !== employeeId));
        alert('✅ 員工及相關記錄已移除');
      } else {
        alert(`❌ 刪除失敗: ${result.error}`);
      }
    } catch (error: any) {
      console.error('刪除員工錯誤:', error);
      alert(`❌ 刪除失敗: ${error.message || '未知錯誤'}`);
    }
  };

  const handleToggleStatus = async (employeeId: string, currentStatus: boolean) => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const { error } = await supabase
        .from('store_employees')
        .update({ is_active: !currentStatus })
        .eq('id', employeeId);

      if (error) throw error;
      
      setEmployees(employees.map(e => 
        e.id === employeeId ? { ...e, is_active: !currentStatus } : e
      ));
    } catch (error) {
      console.error('Error:', error);
      alert('更新失敗');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  const activeEmployees = employees.filter(e => e.is_active);
  const inactiveEmployees = employees.filter(e => !e.is_active);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/stores"
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Users className="text-blue-600" />
                員工管理
              </h1>
              <p className="text-gray-600">
                {store?.store_code} - {store?.store_name}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <UserPlus size={18} />
            批量新增員工
          </button>
        </div>

        {/* 員工列表 */}
        {employees.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">尚未建立任何員工</h3>
            <p className="text-gray-600 mb-6">點擊上方按鈕開始批量新增員工</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 在職員工 */}
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="bg-green-50 px-6 py-3 border-b border-green-200">
                <h3 className="font-semibold text-green-800 flex items-center gap-2">
                  <Users size={18} />
                  在職員工 ({activeEmployees.length})
                </h3>
              </div>
              
              {activeEmployees.length > 0 ? (
                <>
                  {/* 表頭 */}
                  <div className="bg-gray-50 border-b border-gray-200">
                    <div className="grid grid-cols-12 gap-4 px-6 py-3 text-sm font-semibold text-gray-700">
                      <div className="col-span-2">姓名</div>
                      <div className="col-span-1">員工代號</div>
                      <div className="col-span-2">職位</div>
                      <div className="col-span-2">僱用類型</div>
                      <div className="col-span-1">藥師</div>
                      <div className="col-span-2">到職日</div>
                      <div className="col-span-2 text-center">操作</div>
                    </div>
                  </div>
                  
                  {/* 表內容 */}
                  <div className="divide-y divide-gray-200">
                    {activeEmployees.map((emp) => (
                      <div
                        key={emp.id}
                        className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 transition-colors"
                      >
                        <div className="col-span-2 font-medium text-gray-900">
                          {emp.employee_name || '-'}
                        </div>
                        <div className="col-span-1 font-mono text-sm text-gray-600">
                          {emp.employee_code || '-'}
                        </div>
                        <div className="col-span-2 text-sm text-gray-600">
                          {emp.position || '-'}
                        </div>
                        <div className="col-span-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            emp.employment_type === 'full_time'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {emp.employment_type === 'full_time' ? '正職' : '兼職'}
                          </span>
                        </div>
                        <div className="col-span-1">
                          {emp.is_pharmacist ? (
                            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">是</span>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </div>
                        <div className="col-span-2 text-sm text-gray-600">
                          {emp.start_date || '-'}
                        </div>
                        <div className="col-span-2 flex justify-center gap-2">
                          <button
                            onClick={() => setEditingEmployee(emp)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="編輯"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(emp.id, emp.is_active)}
                            className="px-2 py-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors"
                            title="設為離職"
                          >
                            設離職
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp.id, emp.employee_name || '')}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="刪除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-6 text-center text-gray-500">目前沒有在職員工</div>
              )}
            </div>

            {/* 離職員工 */}
            {inactiveEmployees.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <div className="bg-gray-100 px-6 py-3 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-600 flex items-center gap-2">
                    <Users size={18} />
                    離職員工 ({inactiveEmployees.length})
                  </h3>
                </div>
                
                {/* 表頭 */}
                <div className="bg-gray-50 border-b border-gray-200">
                  <div className="grid grid-cols-12 gap-4 px-6 py-3 text-sm font-semibold text-gray-700">
                    <div className="col-span-2">姓名</div>
                    <div className="col-span-1">員工代號</div>
                    <div className="col-span-2">職位</div>
                    <div className="col-span-2">僱用類型</div>
                    <div className="col-span-1">藥師</div>
                    <div className="col-span-2">到職日</div>
                    <div className="col-span-2 text-center">操作</div>
                  </div>
                </div>
                
                {/* 表內容 */}
                <div className="divide-y divide-gray-200">
                  {inactiveEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 transition-colors opacity-60"
                    >
                      <div className="col-span-2 font-medium text-gray-700">
                        {emp.employee_name || '-'}
                      </div>
                      <div className="col-span-1 font-mono text-sm text-gray-500">
                        {emp.employee_code || '-'}
                      </div>
                      <div className="col-span-2 text-sm text-gray-500">
                        {emp.position || '-'}
                      </div>
                      <div className="col-span-2">
                        <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600">
                          {emp.employment_type === 'full_time' ? '正職' : '兼職'}
                        </span>
                      </div>
                      <div className="col-span-1">
                        {emp.is_pharmacist ? (
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">是</span>
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                      </div>
                      <div className="col-span-2 text-sm text-gray-500">
                        {emp.start_date || '-'}
                      </div>
                      <div className="col-span-2 flex justify-center gap-2">
                        <button
                          onClick={() => setEditingEmployee(emp)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="編輯"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(emp.id, emp.is_active)}
                          className="px-2 py-1 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors"
                          title="恢復在職"
                        >
                          恢復在職
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp.id, emp.employee_name || '')}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="刪除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 批量新增員工面板 */}
        {showAddPanel && (
          <BatchAddEmployeePanel
            storeId={storeId}
            storeName={store?.store_name || ''}
            onClose={() => setShowAddPanel(false)}
            onSuccess={() => {
              setShowAddPanel(false);
              loadData();
            }}
          />
        )}

        {/* 編輯員工 Modal */}
        {editingEmployee && (
          <EditEmployeeModal
            employee={editingEmployee}
            onClose={() => setEditingEmployee(null)}
            onSuccess={(updatedEmployee) => {
              setEmployees(employees.map(e => 
                e.id === updatedEmployee.id ? updatedEmployee : e
              ));
              setEditingEmployee(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// 批量新增員工面板
function BatchAddEmployeePanel({
  storeId,
  storeName,
  onClose,
  onSuccess
}: {
  storeId: string;
  storeName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [newEmployees, setNewEmployees] = useState<NewEmployeeForm[]>([
    createEmptyEmployee()
  ]);

  function createEmptyEmployee(): NewEmployeeForm {
    return {
      id: crypto.randomUUID(),
      employee_name: '',
      employee_code: '',
      position: '',
      employment_type: 'full_time',
      is_pharmacist: false,
      start_date: ''
    };
  }

  const addRow = () => {
    setNewEmployees([...newEmployees, createEmptyEmployee()]);
  };

  const removeRow = (id: string) => {
    if (newEmployees.length === 1) return;
    setNewEmployees(newEmployees.filter(e => e.id !== id));
  };

  const updateEmployee = (id: string, field: keyof NewEmployeeForm, value: any) => {
    setNewEmployees(newEmployees.map(e => 
      e.id === id ? { ...e, [field]: value } : e
    ));
  };

  // 根據職位自動設定類型和藥師
  const handlePositionChange = (id: string, position: string) => {
    const updates: Partial<NewEmployeeForm> = { position };
    
    // 兼職職位
    if (position.includes('兼職')) {
      updates.employment_type = 'part_time';
    } else {
      // 其他都是正職
      updates.employment_type = 'full_time';
    }
    
    // 藥師職位
    if (position.includes('藥師')) {
      updates.is_pharmacist = true;
    } else {
      updates.is_pharmacist = false;
    }
    
    setNewEmployees(newEmployees.map(e => 
      e.id === id ? { ...e, ...updates } : e
    ));
  };

  const handleSave = async () => {
    const validEmployees = newEmployees.filter(e => e.employee_name.trim());
    
    if (validEmployees.length === 0) {
      alert('請至少填寫一位員工姓名');
      return;
    }

    setSaving(true);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const insertData = validEmployees.map(emp => ({
        store_id: storeId,
        employee_name: emp.employee_name.trim(),
        employee_code: emp.employee_code.trim() || null,
        position: emp.position || null,
        employment_type: emp.employment_type,
        is_pharmacist: emp.is_pharmacist,
        start_date: emp.start_date || null,
        is_active: true
      }));

      const { error } = await supabase
        .from('store_employees')
        .insert(insertData);

      if (error) {
        console.error('Error:', error);
        alert(`新增失敗: ${error.message}`);
        return;
      }

      alert(`✅ 成功新增 ${validEmployees.length} 位員工`);
      
      // 詢問是否前往每月人員狀態
      if (confirm('是否前往每月人員狀態進行確認審核？')) {
        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        window.location.href = `/monthly-status?year_month=${yearMonth}&store_id=${storeId}`;
      } else {
        onSuccess();
      }
    } catch (error) {
      console.error('Error:', error);
      alert('新增失敗');
    } finally {
      setSaving(false);
    }
  };

  const validCount = newEmployees.filter(e => e.employee_name.trim()).length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <UserPlus className="text-blue-600" />
              批量新增員工
            </h3>
            <p className="text-sm text-gray-500">門市：{storeName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 表格區域 */}
        <div className="flex-1 overflow-auto p-4">
          <div className="min-w-[900px]">
            {/* 表頭 */}
            <div className="grid grid-cols-12 gap-3 px-2 py-2 bg-gray-100 rounded-t-lg text-sm font-semibold text-gray-700">
              <div className="col-span-3">姓名 *</div>
              <div className="col-span-1">員工代號</div>
              <div className="col-span-2">職位</div>
              <div className="col-span-2">僱用類型</div>
              <div className="col-span-1">藥師</div>
              <div className="col-span-2">到職日</div>
              <div className="col-span-1"></div>
            </div>
            
            {/* 表內容 */}
            <div className="divide-y divide-gray-200 border border-gray-200 rounded-b-lg">
              {newEmployees.map((emp) => (
                <div 
                  key={emp.id} 
                  className="grid grid-cols-12 gap-3 px-2 py-3 items-center hover:bg-gray-50"
                >
                  {/* 姓名 */}
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={emp.employee_name}
                      onChange={(e) => updateEmployee(emp.id, 'employee_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="員工姓名"
                    />
                  </div>
                  
                  {/* 員工代號 */}
                  <div className="col-span-1">
                    <input
                      type="text"
                      value={emp.employee_code}
                      onChange={(e) => updateEmployee(emp.id, 'employee_code', e.target.value)}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      placeholder="選填"
                    />
                  </div>
                  
                  {/* 職位 */}
                  <div className="col-span-2">
                    <select
                      value={emp.position}
                      onChange={(e) => handlePositionChange(emp.id, e.target.value)}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="">選擇職位</option>
                      {POSITION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* 僱用類型 */}
                  <div className="col-span-2">
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1 cursor-pointer text-sm">
                        <input
                          type="radio"
                          checked={emp.employment_type === 'full_time'}
                          onChange={() => updateEmployee(emp.id, 'employment_type', 'full_time')}
                          className="w-4 h-4 text-blue-600"
                        />
                        正職
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer text-sm">
                        <input
                          type="radio"
                          checked={emp.employment_type === 'part_time'}
                          onChange={() => updateEmployee(emp.id, 'employment_type', 'part_time')}
                          className="w-4 h-4 text-blue-600"
                        />
                        兼職
                      </label>
                    </div>
                  </div>
                  
                  {/* 藥師 */}
                  <div className="col-span-1">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={emp.is_pharmacist}
                        onChange={(e) => updateEmployee(emp.id, 'is_pharmacist', e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                    </label>
                  </div>
                  
                  {/* 到職日 */}
                  <div className="col-span-2">
                    <input
                      type="date"
                      value={emp.start_date}
                      onChange={(e) => updateEmployee(emp.id, 'start_date', e.target.value)}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  
                  {/* 刪除按鈕 */}
                  <div className="col-span-1 flex justify-center">
                    <button
                      onClick={() => removeRow(emp.id)}
                      disabled={newEmployees.length === 1}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="移除此列"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            {/* 新增一列按鈕 */}
            <button
              onClick={addRow}
              className="w-full mt-3 py-3 border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              新增一列
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50 flex-shrink-0">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <AlertCircle size={16} className="text-blue-500" />
            已填寫 <span className="font-semibold text-blue-600">{validCount}</span> 位員工
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving || validCount === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              <Save size={16} />
              {saving ? '儲存中...' : `儲存 ${validCount} 位員工`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 編輯員工 Modal
function EditEmployeeModal({
  employee,
  onClose,
  onSuccess
}: {
  employee: Employee;
  onClose: () => void;
  onSuccess: (updated: Employee) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    employee_name: employee.employee_name || '',
    employee_code: employee.employee_code || '',
    position: employee.position || '',
    employment_type: employee.employment_type,
    is_pharmacist: employee.is_pharmacist,
    start_date: employee.start_date || ''
  });

  const handlePositionChange = (position: string) => {
    const updates: Partial<typeof formData> = { position };
    
    if (position.includes('兼職')) {
      updates.employment_type = 'part_time';
    } else {
      updates.employment_type = 'full_time';
    }
    
    if (position.includes('藥師')) {
      updates.is_pharmacist = true;
    } else {
      updates.is_pharmacist = false;
    }
    
    setFormData({ ...formData, ...updates });
  };

  const handleSave = async () => {
    if (!formData.employee_name.trim()) {
      alert('請填寫員工姓名');
      return;
    }

    setSaving(true);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const updateData = {
        employee_name: formData.employee_name.trim(),
        employee_code: formData.employee_code.trim() || null,
        position: formData.position || null,
        employment_type: formData.employment_type,
        is_pharmacist: formData.is_pharmacist,
        start_date: formData.start_date || null
      };

      const { error } = await supabase
        .from('store_employees')
        .update(updateData)
        .eq('id', employee.id);

      if (error) {
        console.error('Error:', error);
        alert(`更新失敗: ${error.message}`);
        return;
      }

      onSuccess({
        ...employee,
        ...updateData
      });
    } catch (error) {
      console.error('Error:', error);
      alert('更新失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Edit2 className="text-blue-600" size={20} />
            編輯員工資料
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 姓名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              姓名 *
            </label>
            <input
              type="text"
              value={formData.employee_name}
              onChange={(e) => setFormData({ ...formData, employee_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="員工姓名"
            />
          </div>

          {/* 員工代號 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              員工代號
            </label>
            <input
              type="text"
              value={formData.employee_code}
              onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="選填"
            />
          </div>

          {/* 職位 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              職位
            </label>
            <select
              value={formData.position}
              onChange={(e) => handlePositionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">選擇職位</option>
              {POSITION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 僱用類型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              僱用類型 *
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={formData.employment_type === 'full_time'}
                  onChange={() => setFormData({ ...formData, employment_type: 'full_time' })}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm">正職</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={formData.employment_type === 'part_time'}
                  onChange={() => setFormData({ ...formData, employment_type: 'part_time' })}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm">兼職</span>
              </label>
            </div>
          </div>

          {/* 是否為藥師 */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_pharmacist}
                onChange={(e) => setFormData({ ...formData, is_pharmacist: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-gray-700">是藥師</span>
            </label>
          </div>

          {/* 到職日 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              到職日
            </label>
            <input
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Save size={16} />
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}