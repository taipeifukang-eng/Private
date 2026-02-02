'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

interface SupportBonusRecord {
  id: string;
  employee_code: string;
  employee_name: string;
  bonus_amount: number;
}

interface EmployeeOption {
  employee_code: string;
  employee_name: string;
}

interface SupportBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearMonth: string;
}

export default function SupportBonusModal({ 
  isOpen, 
  onClose, 
  yearMonth
}: SupportBonusModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<SupportBonusRecord[]>([]);
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
        `/api/support-bonus?year_month=${yearMonth}`
      );
      const data = await response.json();
      
      if (data.success && data.records) {
        setRecords(data.records.map((r: any) => ({
          id: r.id || Date.now().toString() + Math.random(),
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          bonus_amount: r.bonus_amount || 0
        })));
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
      bonus_amount: 0
    }]);
  };

  const removeRow = (id: string) => {
    setRecords(records.filter(r => r.id !== id));
  };

  const updateRecord = (id: string, field: keyof SupportBonusRecord, value: any) => {
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
      r.bonus_amount > 0
    );

    if (validRecords.length === 0) {
      alert('請至少新增一筆有效的獎金資料');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/support-bonus/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          bonuses: validRecords.map(r => ({
            employee_code: r.employee_code,
            employee_name: r.employee_name,
            bonus_amount: r.bonus_amount
          }))
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ 成功儲存 ${data.count} 筆支援人員獎金`);
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
    return employees
      .filter(emp => 
        emp.employee_code.toLowerCase().includes(search) ||
        emp.employee_name.toLowerCase().includes(search)
      )
      .slice(0, 50);
  }, [employees, editingValue]);

  const totalBonus = records.reduce((sum, r) => sum + (r.bonus_amount || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[98vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-purple-500 to-purple-600 text-white flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">支援人員單品獎金</h2>
            <p className="text-sm text-purple-100 mt-1">月份：{yearMonth}</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4 min-h-0 flex flex-col">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="mt-2 text-gray-600">載入中...</p>
            </div>
          ) : (
            <div className="space-y-2 h-full flex flex-col">
              {/* 操作按鈕 */}
              <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                <button
                  onClick={addRow}
                  className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium flex items-center gap-2"
                >
                  <Plus size={16} />
                  新增一列
                </button>
                <div className="ml-auto text-lg font-semibold text-purple-600">
                  總計：NT$ {totalBonus.toLocaleString()}
                </div>
              </div>

              {/* 資料表格 - 佔用所有剩餘空間 */}
              {records.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <p className="text-gray-500">尚無獎金資料，請點擊「新增一列」開始輸入</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto min-h-0 border border-gray-200 rounded-lg">
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 bg-gray-100 z-10">
                      <tr className="border-b border-gray-300">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-16">#</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-64">員編</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-48">姓名</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-48">單品獎金</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record, index) => (
                        <tr key={record.id} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-600">{index + 1}</td>
                          <td className="px-4 py-3">
                            <div className="relative">
                              <input
                                type="text"
                                value={editingIndex === index ? editingValue : record.employee_code}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEditingValue(value);
                                  setEditingIndex(index);
                                  setShowDropdown(true);
                                }}
                                onFocus={() => {
                                  setEditingIndex(index);
                                  setEditingValue(record.employee_code);
                                  setShowDropdown(true);
                                }}
                                onBlur={() => {
                                  setTimeout(() => {
                                    setShowDropdown(false);
                                    setEditingIndex(null);
                                    setEditingValue('');
                                  }, 200);
                                }}
                                placeholder="輸入員編或姓名搜尋"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                              {/* 下拉選單 */}
                              {showDropdown && editingIndex === index && filteredEmployees.length > 0 && (
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                                  {filteredEmployees.map((emp) => (
                                    <button
                                      key={emp.employee_code}
                                      onClick={() => handleEmployeeSelect(index, emp)}
                                      className="w-full px-4 py-3 text-left text-sm hover:bg-purple-50 flex items-center justify-between border-b border-gray-100 last:border-b-0"
                                    >
                                      <span className="font-medium text-gray-900">{emp.employee_code}</span>
                                      <span className="text-gray-600">{emp.employee_name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={record.employee_name}
                              onChange={(e) => updateRecord(record.id, 'employee_name', e.target.value)}
                              placeholder="姓名"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={record.bonus_amount || ''}
                              onChange={(e) => updateRecord(record.id, 'bonus_amount', parseFloat(e.target.value) || 0)}
                              placeholder="獎金金額"
                              min="0"
                              step="0.01"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => removeRow(record.id)}
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
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-end gap-3 bg-gray-50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || records.length === 0}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {saving ? '儲存中...' : '儲存獎金資料'}
          </button>
        </div>
      </div>
    </div>
  );
}
