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

interface BatchRecord {
  id: string;
  date: string;
  employeeCode: string;
  employeeName: string;
  workHours: string;
  mealPeriod: string;
  employeeType: string;
}

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
  
  // 批次新增的記錄列表
  const [batchRecords, setBatchRecords] = useState<BatchRecord[]>([
    {
      id: Date.now().toString(),
      date: '',
      employeeCode: '',
      employeeName: '',
      workHours: '',
      mealPeriod: '',
      employeeType: ''
    }
  ]);

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

  const handleEmployeeChange = (index: number, employeeCode: string) => {
    const employee = employees.find(e => e.employee_code === employeeCode);
    const updatedRecords = [...batchRecords];
    updatedRecords[index] = {
      ...updatedRecords[index],
      employeeCode,
      employeeName: employee?.employee_name || '',
      employeeType: employee ? (employee.is_pharmacist ? '藥師' : '非藥師') : ''
    };
    setBatchRecords(updatedRecords);
  };

  const updateBatchRecord = (index: number, field: keyof BatchRecord, value: string) => {
    const updatedRecords = [...batchRecords];
    updatedRecords[index] = {
      ...updatedRecords[index],
      [field]: value
    };
    setBatchRecords(updatedRecords);
  };

  const addNewBatchRecord = () => {
    setBatchRecords([
      ...batchRecords,
      {
        id: Date.now().toString(),
        date: '',
        employeeCode: '',
        employeeName: '',
        workHours: '',
        mealPeriod: '',
        employeeType: ''
      }
    ]);
  };

  const removeBatchRecord = (index: number) => {
    if (batchRecords.length === 1) {
      alert('至少需要保留一筆記錄');
      return;
    }
    const updatedRecords = batchRecords.filter((_, i) => i !== index);
    setBatchRecords(updatedRecords);
  };

  const handleBatchAdd = async () => {
    // 驗證所有記錄
    const validRecords = batchRecords.filter(record => 
      record.date && record.employeeName && record.workHours && record.mealPeriod && record.employeeType
    );

    if (validRecords.length === 0) {
      alert('請至少填寫一筆完整的記錄');
      return;
    }

    // 驗證時間格式
    const timePattern = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    const invalidTimeRecords = validRecords.filter(record => !timePattern.test(record.workHours));
    if (invalidTimeRecords.length > 0) {
      alert('部分記錄的上班區間格式錯誤，請使用 HH:MM-HH:MM 格式');
      return;
    }

    setSaving(true);
    try {
      const requests = validRecords.map(record =>
        fetch('/api/meal-allowance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year_month: yearMonth,
            store_id: storeId,
            record_date: record.date,
            employee_code: record.employeeCode || null,
            employee_name: record.employeeName,
            work_hours: record.workHours,
            meal_period: record.mealPeriod,
            employee_type: record.employeeType
          })
        })
      );

      const responses = await Promise.all(requests);
      const results = await Promise.all(responses.map(r => r.json()));
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      if (failCount === 0) {
        alert(`✅ 成功新增 ${successCount} 筆記錄`);
        // 重置表單
        setBatchRecords([{
          id: Date.now().toString(),
          date: '',
          employeeCode: '',
          employeeName: '',
          workHours: '',
          mealPeriod: '',
          employeeType: ''
        }]);
        loadRecords();
      } else {
        alert(`⚠️ 新增完成：成功 ${successCount} 筆，失敗 ${failCount} 筆`);
        loadRecords();
      }
    } catch (error) {
      console.error('Error batch adding records:', error);
      alert('批次新增失敗');
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
          {/* 批次新增記錄表單 */}
          <div className="bg-blue-50 rounded-lg p-6 mb-6 border border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                <Plus size={20} />
                批次新增誤餐費記錄
              </h3>
              <button
                onClick={addNewBatchRecord}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                <Plus size={16} />
                新增一筆
              </button>
            </div>
            
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {batchRecords.map((record, index) => (
                <div key={record.id} className="bg-white rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-sm font-medium text-gray-600">記錄 #{index + 1}</span>
                    {batchRecords.length > 1 && (
                      <button
                        onClick={() => removeBatchRecord(index)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="移除此記錄"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* 日期 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        日期 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={record.date}
                        onChange={(e) => updateBatchRecord(index, 'date', e.target.value)}
                        placeholder="MM/DD"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-0.5">格式: MM/DD (例: 01/28)</p>
                    </div>

                    {/* 員編 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        員編 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={record.employeeCode}
                        onChange={(e) => handleEmployeeChange(index, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
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
                        value={record.employeeName}
                        readOnly
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-sm"
                      />
                    </div>

                    {/* 上班區間 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        上班區間 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={record.workHours}
                        onChange={(e) => updateBatchRecord(index, 'workHours', e.target.value)}
                        placeholder="HH:MM-HH:MM"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-0.5">格式: HH:MM-HH:MM (例: 09:00-18:00)</p>
                    </div>

                    {/* 誤餐時段 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        誤餐時段 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={record.mealPeriod}
                        onChange={(e) => updateBatchRecord(index, 'mealPeriod', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
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
                        value={record.employeeType}
                        readOnly
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setBatchRecords([{
                  id: Date.now().toString(),
                  date: '',
                  employeeCode: '',
                  employeeName: '',
                  workHours: '',
                  mealPeriod: '',
                  employeeType: ''
                }])}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
              >
                清空全部
              </button>
              <button
                onClick={handleBatchAdd}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                {saving ? '新增中...' : `批次新增 (${batchRecords.filter(r => r.date && r.employeeName && r.workHours && r.mealPeriod).length} 筆)`}
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
