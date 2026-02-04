'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface TalentCultivationRecord {
  id: string;
  employee_code: string;
  employee_name: string;
  cultivation_bonus: number;
  cultivation_target: string;
}

interface EmployeeOption {
  employee_code: string;
  employee_name: string;
}

interface TalentCultivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearMonth: string;
  storeId: string;
  currentStaffList?: any[]; // 當前門市的人員列表
}

export default function TalentCultivationModal({ 
  isOpen, 
  onClose, 
  yearMonth,
  storeId,
  currentStaffList = []
}: TalentCultivationModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<TalentCultivationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, yearMonth]);

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
        `/api/talent-cultivation?year_month=${yearMonth}&store_id=${storeId}`
      );
      const data = await response.json();
      
      if (data.success && data.records && data.records.length > 0) {
        // 如果有現有記錄，載入現有記錄
        setRecords(data.records.map((r: any) => ({
          id: r.id || Date.now().toString() + Math.random(),
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          cultivation_bonus: r.cultivation_bonus || 0,
          cultivation_target: r.cultivation_target || ''
        })));
      } else {
        // 如果沒有記錄，預填入當前門市的人員
        if (currentStaffList && currentStaffList.length > 0) {
          const prefilledRecords = currentStaffList
            .filter((staff: any) => staff.employee_code && staff.employee_name)
            .map((staff: any) => ({
              id: Date.now().toString() + Math.random() + staff.employee_code,
              employee_code: staff.employee_code,
              employee_name: staff.employee_name,
              cultivation_bonus: 0,
              cultivation_target: ''
            }));
          setRecords(prefilledRecords);
        }
      }
    } catch (error) {
      console.error('Error loading records:', error);
    }
  };

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

  const addRow = () => {
    setRecords([...records, {
      id: Date.now().toString() + Math.random(),
      employee_code: '',
      employee_name: '',
      cultivation_bonus: 0,
      cultivation_target: ''
    }]);
  };

  const removeRow = (id: string) => {
    setRecords(records.filter(r => r.id !== id));
  };

  const updateRecord = (id: string, field: keyof TalentCultivationRecord, value: any) => {
    setRecords(records.map(r => 
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const handleEmployeeSelect = (index: number, employee: EmployeeOption) => {
    const record = records[index];
    const updatedRecords = records.map((r, i) => 
      i === index ? { 
        ...r, 
        employee_code: employee.employee_code,
        employee_name: employee.employee_name
      } : r
    );
    setRecords(updatedRecords);
    setShowDropdown(false);
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleSave = async () => {
    // 驗證資料
    const validRecords = records.filter(r => 
      r.employee_code && 
      r.employee_name && 
      r.cultivation_bonus > 0 &&
      r.cultivation_target.trim() !== ''
    );

    if (validRecords.length === 0) {
      alert('請至少新增一筆有效的育才獎金資料（需包含獎金金額和育才對象）');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/talent-cultivation/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          store_id: storeId,
          bonuses: validRecords.map(r => ({
            employee_code: r.employee_code,
            employee_name: r.employee_name,
            cultivation_bonus: r.cultivation_bonus,
            cultivation_target: r.cultivation_target
          }))
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ 成功儲存 ${data.count} 筆育才獎金`);
        onClose();
      } else {
        alert('❌ ' + (data.error || '儲存失敗'));
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('❌ 儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  // 過濾員工清單（使用 useMemo 優化性能）
  const filteredEmployees = useMemo(() => {
    if (!editingValue) return employees.slice(0, 50);
    
    const search = editingValue.toLowerCase();
    
    // 精確匹配優先，然後是前綴匹配，最後是包含匹配
    const exactMatches: EmployeeOption[] = [];
    const prefixMatches: EmployeeOption[] = [];
    const containsMatches: EmployeeOption[] = [];
    
    employees.forEach(emp => {
      const code = emp.employee_code.toLowerCase();
      const name = emp.employee_name.toLowerCase();
      
      // 精確匹配（完全相同）
      if (code === search || name === search) {
        exactMatches.push(emp);
      }
      // 前綴匹配（以搜尋詞開頭）
      else if (code.startsWith(search) || name.startsWith(search)) {
        prefixMatches.push(emp);
      }
      // 包含匹配（任意位置包含）
      else if (code.includes(search) || name.includes(search)) {
        containsMatches.push(emp);
      }
    });
    
    // 合併結果：精確匹配 -> 前綴匹配 -> 包含匹配，取前 50 筆
    return [...exactMatches, ...prefixMatches, ...containsMatches].slice(0, 50);
  }, [employees, editingValue]);

  const totalBonus = records.reduce((sum, r) => sum + (r.cultivation_bonus || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[98vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-indigo-500 to-indigo-600 text-white flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">育才獎金登記</h2>
            <p className="text-sm text-indigo-100 mt-1">月份：{yearMonth}</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4 min-h-0 flex flex-col">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="mt-2 text-gray-600">載入中...</p>
            </div>
          ) : (
            <div className="space-y-2 h-full flex flex-col">
              {/* 操作按鈕 */}
              <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                <button
                  onClick={addRow}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  新增一列
                </button>
                <div className="text-sm text-gray-600">
                  共 {records.length} 筆，總計 ${totalBonus.toLocaleString()}
                </div>
              </div>

              {/* 表格容器 */}
              <div className="flex-1 overflow-auto border border-gray-200 rounded-lg min-h-0">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-indigo-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-32">
                        員編
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-32">
                        姓名
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-32">
                        育才獎金
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                        育才對象 *
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-20">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {records.map((record, index) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="relative">
                            <input
                              type="text"
                              value={record.employee_code}
                              onChange={(e) => {
                                updateRecord(record.id, 'employee_code', e.target.value);
                                setEditingIndex(index);
                                setEditingValue(e.target.value);
                                setShowDropdown(true);
                              }}
                              onFocus={() => {
                                setEditingIndex(index);
                                setEditingValue(record.employee_code);
                                setShowDropdown(true);
                              }}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              placeholder="員編"
                            />
                            {showDropdown && editingIndex === index && filteredEmployees.length > 0 && (
                              <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                {filteredEmployees.map((emp) => (
                                  <button
                                    key={emp.employee_code}
                                    onClick={() => handleEmployeeSelect(index, emp)}
                                    className="w-full px-3 py-2 text-left hover:bg-indigo-50 text-sm border-b border-gray-100 last:border-b-0"
                                  >
                                    <div className="font-medium text-gray-900">{emp.employee_code}</div>
                                    <div className="text-xs text-gray-600">{emp.employee_name}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={record.employee_name}
                            onChange={(e) => updateRecord(record.id, 'employee_name', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="姓名"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={record.cultivation_bonus || ''}
                            onChange={(e) => updateRecord(record.id, 'cultivation_bonus', parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="金額"
                            min="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={record.cultivation_target}
                            onChange={(e) => updateRecord(record.id, 'cultivation_target', e.target.value)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            placeholder="必填：育才對象"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => removeRow(record.id)}
                            className="text-red-600 hover:text-red-800 transition-colors"
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 font-medium"
            disabled={saving}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || records.length === 0}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
      
      {/* 點擊外部關閉下拉選單 */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setShowDropdown(false);
            setEditingIndex(null);
          }}
        />
      )}
    </div>
  );
}
