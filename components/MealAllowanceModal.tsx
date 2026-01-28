'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, AlertCircle } from 'lucide-react';

interface MealAllowanceRecord {
  id: string;
  record_date: string;
  employee_code: string | null;
  employee_name: string;
  work_hours: string;
  meal_period: string;
  employee_type: string;
}

interface EmployeeOption {
  employee_code: string | null;
  employee_name: string;
  is_pharmacist: boolean;
}

interface MealAllowanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearMonth: string;
  storeId: string;
  storeName: string;
}

const MEAL_PERIODS = [
  { value: '中餐', label: '中餐 (11:00-13:30)' },
  { value: '晚餐', label: '晚餐 (16:30-19:00)' },
  { value: '晚晚餐', label: '晚晚餐 (21:00-21:30) (S班)' }
];

export default function MealAllowanceModal({ 
  isOpen, 
  onClose, 
  yearMonth, 
  storeId,
  storeName 
}: MealAllowanceModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<MealAllowanceRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  
  // 新增記錄的表單
  const [formDate, setFormDate] = useState('');
  const [formEmployeeCode, setFormEmployeeCode] = useState('');
  const [formEmployeeName, setFormEmployeeName] = useState('');
  const [formWorkHours, setFormWorkHours] = useState('');
  const [formMealPeriod, setFormMealPeriod] = useState('');
  const [formEmployeeType, setFormEmployeeType] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, yearMonth, storeId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadRecords(),
        loadEmployees()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecords = async () => {
    try {
      const response = await fetch(
        `/api/meal-allowance?year_month=${yearMonth}&store_id=${storeId}`
      );
      const data = await response.json();
      
      if (data.success) {
        setRecords(data.records || []);
      }
    } catch (error) {
      console.error('Error loading records:', error);
    }
  };

  const loadEmployees = async () => {
    try {
      // 從 monthly_staff_status 查詢當月員工
      const response = await fetch(
        `/api/meal-allowance/employees?year_month=${yearMonth}&store_id=${storeId}`
      );
      const data = await response.json();
      
      if (data.success) {
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const handleEmployeeChange = (employeeCode: string) => {
    setFormEmployeeCode(employeeCode);
    
    const employee = employees.find(e => e.employee_code === employeeCode);
    if (employee) {
      setFormEmployeeName(employee.employee_name);
      setFormEmployeeType(employee.is_pharmacist ? '藥師' : '非藥師');
    } else {
      setFormEmployeeName('');
      setFormEmployeeType('');
    }
  };

  const handleAddRecord = async () => {
    if (!formDate || !formEmployeeName || !formWorkHours || !formMealPeriod || !formEmployeeType) {
      alert('請填寫所有必填欄位');
      return;
    }

    // 驗證上班區間格式
    const timePattern = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    if (!timePattern.test(formWorkHours)) {
      alert('上班區間格式錯誤，請使用 HH:MM-HH:MM 格式');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/meal-allowance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          store_id: storeId,
          record_date: formDate,
          employee_code: formEmployeeCode || null,
          employee_name: formEmployeeName,
          work_hours: formWorkHours,
          meal_period: formMealPeriod,
          employee_type: formEmployeeType
        })
      });

      const data = await response.json();
      
      if (data.success) {
        alert('✅ 新增成功');
        // 清空表單
        setFormDate('');
        setFormEmployeeCode('');
        setFormEmployeeName('');
        setFormWorkHours('');
        setFormMealPeriod('');
        setFormEmployeeType('');
        // 重新載入
        loadRecords();
      } else {
        alert(`❌ 新增失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error adding record:', error);
      alert('新增失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm('確定要刪除此記錄嗎？')) {
      return;
    }

    try {
      const response = await fetch(`/api/meal-allowance?id=${recordId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      
      if (data.success) {
        alert('✅ 刪除成功');
        loadRecords();
      } else {
        alert(`❌ 刪除失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error deleting record:', error);
      alert('刪除失敗');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">誤餐費登記</h2>
            <p className="text-sm text-gray-600 mt-1">
              {storeName} - {yearMonth}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 新增記錄表單 */}
          <div className="bg-blue-50 rounded-lg p-6 mb-6 border border-blue-200">
            <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
              <Plus size={20} />
              新增誤餐費記錄
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 日期 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  日期 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  placeholder="MM/DD"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">格式: MM/DD (例: 01/28)</p>
              </div>

              {/* 員編 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  員編 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formEmployeeCode}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">請選擇員編</option>
                  {employees.map((emp) => (
                    <option key={emp.employee_code || emp.employee_name} value={emp.employee_code || ''}>
                      {emp.employee_code ? `${emp.employee_code} - ${emp.employee_name}` : emp.employee_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 姓名 (自動帶入) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  姓名
                </label>
                <input
                  type="text"
                  value={formEmployeeName}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
                />
              </div>

              {/* 上班區間 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  上班區間 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formWorkHours}
                  onChange={(e) => setFormWorkHours(e.target.value)}
                  placeholder="HH:MM-HH:MM"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">格式: HH:MM-HH:MM (例: 09:00-18:00)</p>
              </div>

              {/* 誤餐時段 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  誤餐時段 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formMealPeriod}
                  onChange={(e) => setFormMealPeriod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">請選擇時段</option>
                  {MEAL_PERIODS.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 身分 (自動帶入) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  身分
                </label>
                <input
                  type="text"
                  value={formEmployeeType}
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleAddRecord}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                {saving ? '新增中...' : '新增記錄'}
              </button>
            </div>
          </div>

          {/* 記錄列表 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              已登記記錄 ({records.length})
            </h3>

            {loading ? (
              <div className="text-center py-12 text-gray-500">
                載入中...
              </div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg">
                <AlertCircle size={48} className="mx-auto mb-4 text-gray-300" />
                <p>尚無誤餐費記錄</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">日期</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">員編</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">姓名</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">上班區間</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">誤餐時段</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">身分</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 border-b">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">{record.record_date}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">{record.employee_code || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">{record.employee_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">{record.work_hours}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">{record.meal_period}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 border-b">
                          <span className={`px-2 py-1 rounded text-xs ${
                            record.employee_type === '藥師' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {record.employee_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center border-b">
                          <button
                            onClick={() => handleDeleteRecord(record.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="刪除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
