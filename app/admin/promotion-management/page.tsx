'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Plus, Upload, Download, Save, Trash2, AlertCircle, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';
import { POSITION_OPTIONS } from '@/types/workflow';

// 異動類型定義
const MOVEMENT_TYPES = [
  { value: 'promotion', label: '升職' },
  { value: 'leave_without_pay', label: '留職停薪' },
  { value: 'return_to_work', label: '復職' },
  { value: 'pass_probation', label: '過試用期' },
  { value: 'resignation', label: '離職' }
] as const;

type MovementType = typeof MOVEMENT_TYPES[number]['value'];

interface MovementInput {
  employee_code: string;
  employee_name: string;
  movement_type: MovementType | '';
  position: string; // 僅升職時需要
  effective_date: string;
  notes: string;
}

interface MovementHistory {
  id: string;
  employee_code: string;
  employee_name: string;
  movement_type: MovementType;
  movement_date: string;
  new_value: string | null;
  old_value: string | null;
  notes: string | null;
  created_at: string;
}

interface Employee {
  employee_code: string;
  employee_name: string;
  position: string;
  current_position: string | null;
  store_id: string;
}

export default function EmployeeMovementManagementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState<MovementInput[]>([
    { employee_code: '', employee_name: '', movement_type: '', position: '', effective_date: '', notes: '' }
  ]);
  const [movementHistory, setMovementHistory] = useState<MovementHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState<{[key: number]: string}>({});
  const [showDropdown, setShowDropdown] = useState<{[key: number]: boolean}>({});

  useEffect(() => {
    checkPermissionAndLoadData();
  }, []);

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

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    
    if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
      alert('權限不足');
      router.push('/dashboard');
      return;
    }

    loadMovementHistory();
    loadEmployees();
    setLoading(false);
  };

  const loadEmployees = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    const { data } = await supabase
      .from('store_employees')
      .select('employee_code, employee_name, position, current_position, store_id')
      .eq('is_active', true)
      .order('employee_code');

    if (data) {
      setEmployees(data);
    }
  };

  const loadMovementHistory = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    const { data } = await supabase
      .from('employee_movement_history')
      .select('*')
      .order('movement_date', { ascending: false })
      .limit(100);

    if (data) {
      setMovementHistory(data);
    }
  };

  const addRow = () => {
    setMovements([...movements, { employee_code: '', employee_name: '', movement_type: '', position: '', effective_date: '', notes: '' }]);
  };

  const removeRow = (index: number) => {
    if (movements.length === 1) {
      alert('至少需要保留一列');
      return;
    }
    setMovements(movements.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof MovementInput, value: string) => {
    const updated = [...movements];
    updated[index] = { ...updated[index], [field]: value };
    
    // 員編自動轉大寫
    if (field === 'employee_code') {
      updated[index].employee_code = value.toUpperCase();
      setSearchTerm({ ...searchTerm, [index]: value.toUpperCase() });
      setShowDropdown({ ...showDropdown, [index]: true });
    }
    
    setMovements(updated);
  };

  const selectEmployee = (index: number, employee: Employee) => {
    const updated = [...movements];
    updated[index].employee_code = employee.employee_code;
    updated[index].employee_name = employee.employee_name;
    setMovements(updated);
    setShowDropdown({ ...showDropdown, [index]: false });
    setSearchTerm({ ...searchTerm, [index]: '' });
  };

  const getFilteredEmployees = (index: number) => {
    const term = searchTerm[index] || movements[index].employee_code;
    if (!term) return [];
    
    return employees.filter(emp => 
      emp.employee_code.toUpperCase().includes(term.toUpperCase()) ||
      emp.employee_name.includes(term)
    ).slice(0, 10);
  };

  const handleSave = async () => {
    // 驗證資料
    const emptyFields = movements.filter(m => {
      if (!m.employee_code.trim() || !m.employee_name.trim() || !m.movement_type || !m.effective_date) {
        return true;
      }
      // 如果是升職，必須填寫職位
      if (m.movement_type === 'promotion' && !m.position) {
        return true;
      }
      return false;
    });

    if (emptyFields.length > 0) {
      alert('請填寫所有必填欄位（員編、姓名、異動類型、生效日期，升職時需填寫職位）');
      return;
    }

    if (!confirm(`確定要建立 ${movements.length} 筆異動記錄嗎？\n\n異動將自動更新員工狀態。`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/employee-movements/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movements })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ 成功建立 ${result.created} 筆異動記錄！`);
        // 重置表單
        setMovements([{ employee_code: '', employee_name: '', movement_type: '', position: '', effective_date: '', notes: '' }]);
        // 重新載入歷史記錄
        loadMovementHistory();
      } else {
        alert(`❌ 錯誤：${result.error}`);
      }
    } catch (error: any) {
      console.error('Error saving movements:', error);
      alert(`❌ 儲存失敗：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

        const imported = jsonData.map((row: any) => ({
          employee_code: (row['員編'] || row['employee_code'] || '').toString().toUpperCase(),
          employee_name: (row['姓名'] || row['employee_name'] || '').toString(),
          movement_type: (row['異動類型'] || row['movement_type'] || '') as MovementType | '',
          position: (row['職位'] || row['position'] || '').toString(),
          effective_date: row['生效日期'] || row['effective_date'] || '',
          notes: (row['備註'] || row['notes'] || '').toString()
        }));

        setMovements(imported);
        alert(`✅ 成功匯入 ${imported.length} 筆資料`);
      } catch (error) {
        console.error('Error importing Excel:', error);
        alert('❌ 匯入失敗，請確認檔案格式正確');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleExcelExport = () => {
    const exportData = movements.map(m => {
      const movementTypeLabel = MOVEMENT_TYPES.find(t => t.value === m.movement_type)?.label || m.movement_type;
      return {
        '員編': m.employee_code,
        '姓名': m.employee_name,
        '異動類型': movementTypeLabel,
        '職位': m.position,
        '生效日期': m.effective_date,
        '備註': m.notes
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '人員異動資料');
    XLSX.writeFile(wb, `人員異動管理_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <TrendingUp className="text-emerald-600" size={40} />
              人員異動管理
            </h1>
            <p className="text-gray-600">批次管理員工異動，自動更新員工狀態</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Calendar size={18} className="inline mr-2" />
              {showHistory ? '隱藏歷史' : '查看歷史'}
            </button>
          </div>
        </div>

        {/* 異動歷史記錄 */}
        {showHistory && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">近期異動記錄</h2>
            {movementHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">尚無異動記錄</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">員編</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">姓名</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">異動類型</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">舊值</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">新值</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">生效日期</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {movementHistory.map((record) => {
                      const typeLabel = MOVEMENT_TYPES.find(t => t.value === record.movement_type)?.label || record.movement_type;
                      return (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.employee_code}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{record.employee_name}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              record.movement_type === 'promotion' ? 'bg-emerald-100 text-emerald-700' :
                              record.movement_type === 'leave_without_pay' ? 'bg-amber-100 text-amber-700' :
                              record.movement_type === 'return_to_work' ? 'bg-blue-100 text-blue-700' :
                              record.movement_type === 'pass_probation' ? 'bg-purple-100 text-purple-700' :
                              record.movement_type === 'resignation' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {typeLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{record.old_value || '-'}</td>
                          <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{record.new_value || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{record.movement_date}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{record.notes || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 批次輸入區 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">批次輸入異動</h2>
            <div className="flex items-center gap-2">
              <label className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors cursor-pointer text-sm font-medium">
                <Upload size={16} className="inline mr-1" />
                匯入 Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleExcelImport}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleExcelExport}
                className="px-3 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
              >
                <Download size={16} className="inline mr-1" />
                匯出 Excel
              </button>
              <button
                onClick={addRow}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Plus size={16} className="inline mr-1" />
                新增列
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-28">
                    員編 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-28">
                    姓名 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    異動類型 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    職位
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    生效日期 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700">
                    備註
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold text-gray-700 w-20">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1 relative">
                      <input
                        type="text"
                        value={movement.employee_code}
                        onChange={(e) => updateRow(index, 'employee_code', e.target.value)}
                        onFocus={() => setShowDropdown({ ...showDropdown, [index]: true })}
                        onBlur={() => setTimeout(() => setShowDropdown({ ...showDropdown, [index]: false }), 200)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="FK1234"
                      />
                      {showDropdown[index] && getFilteredEmployees(index).length > 0 && (
                        <div className="absolute z-50 min-w-[320px] mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-60 overflow-y-auto left-0">
                          {getFilteredEmployees(index).map((emp) => (
                            <div
                              key={emp.employee_code}
                              onMouseDown={() => selectEmployee(index, emp)}
                              className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-sm text-blue-600">{emp.employee_code}</span>
                                <span className="text-sm text-gray-900 font-medium">{emp.employee_name}</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1.5 flex items-center">
                                <span className="bg-gray-100 px-2 py-0.5 rounded">
                                  {emp.current_position || emp.position}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={movement.employee_name}
                        onChange={(e) => updateRow(index, 'employee_name', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="王小明"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <select
                        value={movement.movement_type}
                        onChange={(e) => updateRow(index, 'movement_type', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      >
                        <option value="">請選擇</option>
                        {MOVEMENT_TYPES.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      {movement.movement_type === 'promotion' ? (
                        <select
                          value={movement.position}
                          onChange={(e) => updateRow(index, 'position', e.target.value)}
                          className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        >
                          <option value="">請選擇職位</option>
                          {POSITION_OPTIONS.map(pos => (
                            <option key={pos} value={pos}>{pos}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-gray-400 text-sm px-2 py-1">-</div>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="date"
                        value={movement.effective_date}
                        onChange={(e) => updateRow(index, 'effective_date', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={movement.notes}
                        onChange={(e) => updateRow(index, 'notes', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="選填"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      <button
                        onClick={() => removeRow(index)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="刪除此列"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <AlertCircle size={16} />
              <span>共 {movements.length} 筆異動資料</span>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  儲存中...
                </>
              ) : (
                <>
                  <Save size={18} />
                  儲存異動記錄
                </>
              )}
            </button>
          </div>
        </div>

        {/* 說明 */}
        <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-emerald-800 space-y-1">
            <li>• <strong>升職：</strong>需填寫新職位，系統會自動更新該員工從生效日期起的所有月份職位</li>
            <li>• <strong>留職停薪：</strong>將員工狀態設為留職停薪，不影響職位資料</li>
            <li>• <strong>復職：</strong>將留職停薪的員工狀態恢復為在職</li>
            <li>• <strong>過試用期：</strong>記錄員工通過試用期的日期</li>
            <li>• <strong>離職：</strong>將員工狀態設為已離職，並設定為不在職</li>
            <li>• 支援 Excel 匯入/匯出，方便批次處理</li>
            <li>• 員編會自動轉換為大寫</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
