'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Upload, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';

interface SupportBonusRecord {
  id: string;
  employee_code: string;
  employee_name: string;
  bonus_amount: number;
}

interface EmployeeOption {
  employee_code: string | null;
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
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeInputIndex, setActiveInputIndex] = useState<number | null>(null);

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
    updateRecord(record.id, 'employee_code', employee.employee_code || '');
    updateRecord(record.id, 'employee_name', employee.employee_name);
    setSearchTerm('');
    setShowDropdown(false);
    setActiveInputIndex(null);
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

    // 檢查是否有重複的員編
    const codes = validRecords.map(r => r.employee_code);
    const uniqueCodes = new Set(codes);
    if (codes.length !== uniqueCodes.size) {
      alert('存在重複的員工編號，請檢查');
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

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const imported = jsonData.map((row: any) => ({
          id: Date.now().toString() + Math.random(),
          employee_code: (row['員編'] || row['employee_code'] || '').toString().toUpperCase(),
          employee_name: (row['姓名'] || row['employee_name'] || '').toString(),
          bonus_amount: parseFloat(row['單品獎金'] || row['bonus_amount'] || 0)
        }));

        setRecords(imported);
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
    const exportData = records
      .filter(r => r.employee_code && r.employee_name)
      .map(r => ({
        '員編': r.employee_code,
        '姓名': r.employee_name,
        '單品獎金': r.bonus_amount
      }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '支援人員獎金');
    XLSX.writeFile(workbook, `支援人員獎金_${yearMonth}.xlsx`);
  };

  // 過濾員工清單
  const filteredEmployees = employees.filter(emp => {
    const search = searchTerm.toLowerCase();
    return (
      (emp.employee_code || '').toLowerCase().includes(search) ||
      emp.employee_name.toLowerCase().includes(search)
    );
  }).slice(0, 50);

  const totalBonus = records.reduce((sum, r) => sum + (r.bonus_amount || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-purple-500 to-purple-600 text-white">
          <div>
            <h2 className="text-xl font-bold">支援人員單品獎金</h2>
            <p className="text-sm text-purple-100 mt-1">月份：{yearMonth}</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="mt-2 text-gray-600">載入中...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 操作按鈕 */}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors cursor-pointer text-sm font-medium flex items-center gap-2">
                  <Upload size={16} />
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
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium flex items-center gap-2"
                  disabled={records.length === 0}
                >
                  <Download size={16} />
                  匯出 Excel
                </button>
                <button
                  onClick={addRow}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium flex items-center gap-2"
                >
                  <Plus size={16} />
                  新增一列
                </button>
                <div className="ml-auto text-lg font-semibold text-purple-600">
                  總計：NT$ {totalBonus.toLocaleString()}
                </div>
              </div>

              {/* 說明 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">使用說明</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• 從員工管理中搜尋員工，點擊選擇後會自動帶入姓名</li>
                  <li>• 支援 Excel 匯入，格式：員編 | 姓名 | 單品獎金</li>
                  <li>• 儲存時會覆蓋該月份的所有資料</li>
                  <li>• 同一員工在同一月份只能有一筆獎金記錄</li>
                </ul>
              </div>

              {/* 資料表格 */}
              {records.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <p className="text-gray-500">尚無獎金資料，請點擊「新增一列」開始輸入</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-300">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 w-12">#</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">員編</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">姓名</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">單品獎金</th>
                        <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 w-20">操作</th>
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
                                value={activeInputIndex === index ? searchTerm : record.employee_code}
                                onChange={(e) => {
                                  setSearchTerm(e.target.value);
                                  setActiveInputIndex(index);
                                  setShowDropdown(true);
                                }}
                                onFocus={() => {
                                  setActiveInputIndex(index);
                                  setSearchTerm('');
                                  setShowDropdown(true);
                                }}
                                placeholder="搜尋員編或姓名..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                              {showDropdown && activeInputIndex === index && filteredEmployees.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {filteredEmployees.map((emp) => (
                                    <button
                                      key={emp.employee_code}
                                      onClick={() => handleEmployeeSelect(index, emp)}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 flex items-center justify-between"
                                    >
                                      <span className="font-medium">{emp.employee_code}</span>
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
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 bg-gray-50">
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
