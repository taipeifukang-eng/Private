'use client';

import { useState, useEffect, useMemo } from 'react';
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
  employee_code: string;
  employee_name: string;
  position: string;
}

interface MealRow {
  id: string;
  date: string;
  workHours: string;
  mealPeriod: string;
}

interface PersonEntry {
  id: string;
  employeeCode: string;
  employeeName: string;
  employeeType: string;
  rows: MealRow[];
}

interface MealAllowanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearMonth: string;
  storeId: string;
  storeName: string;
}

const newMealRow = (): MealRow => ({
  id: `${Date.now()}-${Math.random()}`,
  date: '',
  workHours: '',
  mealPeriod: '',
});

const newPersonEntry = (): PersonEntry => ({
  id: `${Date.now()}-${Math.random()}`,
  employeeCode: '',
  employeeName: '',
  employeeType: '',
  rows: [newMealRow()],
});

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
  const [persons, setPersons] = useState<PersonEntry[]>(() => [newPersonEntry()]);
  const [activePersonIndex, setActivePersonIndex] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

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
      // 載入所有在職員工（跨門市搜尋）
      const response = await fetch('/api/employees/list');
      const data = await response.json();
      
      if (data.success) {
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const isPharmacist = (position: string) => position.includes('藥師');

  const filteredEmployees = useMemo(() => {
    if (!searchText) return employees.slice(0, 50);
    const search = searchText.toLowerCase();
    const exactMatches: EmployeeOption[] = [];
    const prefixMatches: EmployeeOption[] = [];
    const containsMatches: EmployeeOption[] = [];
    employees.forEach(emp => {
      const code = emp.employee_code.toLowerCase();
      const name = emp.employee_name.toLowerCase();
      if (code === search || name === search) exactMatches.push(emp);
      else if (code.startsWith(search) || name.startsWith(search)) prefixMatches.push(emp);
      else if (code.includes(search) || name.includes(search)) containsMatches.push(emp);
    });
    return [...exactMatches, ...prefixMatches, ...containsMatches].slice(0, 50);
  }, [employees, searchText]);

  const handleEmployeeSelect = (personIndex: number, employee: EmployeeOption) => {
    setPersons(prev => prev.map((p, i) => i !== personIndex ? p : {
      ...p,
      employeeCode: employee.employee_code,
      employeeName: employee.employee_name,
      employeeType: isPharmacist(employee.position) ? '藥師' : '非藥師',
    }));
    setShowDropdown(false);
    setActivePersonIndex(null);
    setSearchText('');
  };

  const updatePerson = (personIndex: number, field: 'employeeCode' | 'employeeName' | 'employeeType', value: string) => {
    setPersons(prev => prev.map((p, i) => i !== personIndex ? p : { ...p, [field]: value }));
  };

  const updateRow = (personIndex: number, rowIndex: number, field: keyof MealRow, value: string) => {
    setPersons(prev => prev.map((p, pi) => {
      if (pi !== personIndex) return p;
      return { ...p, rows: p.rows.map((r, ri) => ri !== rowIndex ? r : { ...r, [field]: value }) };
    }));
  };

  const addPerson = () => setPersons(prev => [...prev, newPersonEntry()]);

  const removePerson = (personIndex: number) => {
    if (persons.length === 1) { alert('至少需要保留一個人員'); return; }
    setPersons(prev => prev.filter((_, i) => i !== personIndex));
  };

  const addRow = (personIndex: number) => {
    setPersons(prev => prev.map((p, i) => i !== personIndex ? p : { ...p, rows: [...p.rows, newMealRow()] }));
  };

  const removeRow = (personIndex: number, rowIndex: number) => {
    if (persons[personIndex].rows.length === 1) { alert('至少需要保留一筆記錄'); return; }
    setPersons(prev => prev.map((p, pi) => pi !== personIndex ? p : {
      ...p, rows: p.rows.filter((_, ri) => ri !== rowIndex)
    }));
  };

  const validCount = persons.reduce((acc, p) => {
    if (!p.employeeName) return acc;
    return acc + p.rows.filter(r => r.date && r.workHours && r.mealPeriod).length;
  }, 0);

  const handleBatchAdd = async () => {
    const allRecords: Array<{
      employeeCode: string; employeeName: string; employeeType: string;
      date: string; workHours: string; mealPeriod: string;
    }> = [];

    for (const person of persons) {
      if (!person.employeeName) continue;
      if (!person.employeeType) {
        alert(`請填寫「${person.employeeName || person.employeeCode}」的身分`);
        return;
      }
      for (const row of person.rows) {
        if (!row.date && !row.workHours && !row.mealPeriod) continue;
        if (!row.date || !row.workHours || !row.mealPeriod) {
          alert(`「${person.employeeName}」有未填完整的記錄，請確認日期、上班區間、誤餐時段都已填寫`);
          return;
        }
        allRecords.push({
          employeeCode: person.employeeCode,
          employeeName: person.employeeName,
          employeeType: person.employeeType,
          date: row.date,
          workHours: row.workHours,
          mealPeriod: row.mealPeriod,
        });
      }
    }

    if (allRecords.length === 0) {
      alert('請至少填寫一筆完整的記錄');
      return;
    }

    const timePattern = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    const invalid = allRecords.find(r => !timePattern.test(r.workHours));
    if (invalid) {
      alert(`上班區間格式錯誤 (${invalid.workHours})，請使用 HH:MM-HH:MM 格式`);
      return;
    }

    setSaving(true);
    try {
      const responses = await Promise.all(
        allRecords.map(record =>
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
              employee_type: record.employeeType,
            })
          })
        )
      );
      const results = await Promise.all(responses.map(r => r.json()));
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      if (failCount === 0) {
        alert(`✅ 成功新增 ${successCount} 筆記錄`);
        setPersons([newPersonEntry()]);
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
    if (!confirm('確定要刪除此記錄嗎？')) return;

    try {
      const response = await fetch(`/api/meal-allowance?id=${recordId}`, { method: 'DELETE' });
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
          {/* 新增表單 */}
          <div className="bg-blue-50 rounded-lg p-6 mb-6 border border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                <Plus size={20} />
                新增誤餐費記錄
              </h3>
              <button
                onClick={addPerson}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1"
              >
                <Plus size={16} />
                新增人員
              </button>
            </div>

            <div className="space-y-5">
              {persons.map((person, personIndex) => (
                <div key={person.id} className="bg-white rounded-lg border border-gray-200 overflow-visible">
                  {/* Person header */}
                  <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between border-b border-gray-200">
                    <span className="text-sm font-semibold text-gray-700">人員 #{personIndex + 1}</span>
                    {persons.length > 1 && (
                      <button
                        onClick={() => removePerson(personIndex)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="移除此人員"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  <div className="p-4">
                    {/* Fixed employee fields */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 pb-4 border-b border-gray-100">
                      {/* 員編 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">員編（搜尋後自動帶入姓名與身分）</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={activePersonIndex === personIndex ? searchText : person.employeeCode}
                            onChange={(e) => {
                              const value = e.target.value;
                              setSearchText(value);
                              setActivePersonIndex(personIndex);
                              setShowDropdown(value.length > 0);
                              setPersons(prev => prev.map((p, i) => i !== personIndex ? p : {
                                ...p, employeeCode: value, employeeName: '', employeeType: ''
                              }));
                            }}
                            onFocus={() => {
                              setActivePersonIndex(personIndex);
                              setSearchText(person.employeeCode);
                              if (person.employeeCode) setShowDropdown(true);
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setShowDropdown(false);
                                setActivePersonIndex(null);
                                setSearchText('');
                              }, 200);
                            }}
                            placeholder="輸入員編或姓名搜尋"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          {showDropdown && activePersonIndex === personIndex && filteredEmployees.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                              {filteredEmployees.map((emp) => (
                                <button
                                  key={emp.employee_code}
                                  onClick={() => handleEmployeeSelect(personIndex, emp)}
                                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-b-0"
                                >
                                  <span className="font-medium text-gray-900">{emp.employee_code}</span>
                                  <span className="text-gray-600">{emp.employee_name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 姓名 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">姓名</label>
                        <input
                          type="text"
                          value={person.employeeName}
                          onChange={(e) => updatePerson(personIndex, 'employeeName', e.target.value)}
                          placeholder="選擇員編後自動帶入"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* 身分 */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          身分 <span className="text-red-500">*</span>
                          {person.employeeType && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-semibold ${
                              person.employeeType === '藥師' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                            }`}>{person.employeeType}</span>
                          )}
                        </label>
                        <select
                          value={person.employeeType}
                          onChange={(e) => updatePerson(personIndex, 'employeeType', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          <option value="">請選擇身分</option>
                          <option value="藥師">藥師</option>
                          <option value="非藥師">非藥師</option>
                        </select>
                      </div>
                    </div>

                    {/* Batch date rows */}
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_1.2fr_1.4fr_32px] gap-2 text-xs font-medium text-gray-500 px-1">
                        <span>日期 (MM/DD)</span>
                        <span>上班區間 (HH:MM-HH:MM)</span>
                        <span>誤餐時段</span>
                        <span></span>
                      </div>
                      {person.rows.map((row, rowIndex) => (
                        <div key={row.id} className="grid grid-cols-[1fr_1.2fr_1.4fr_32px] gap-2 items-center">
                          <input
                            type="text"
                            value={row.date}
                            onChange={(e) => updateRow(personIndex, rowIndex, 'date', e.target.value)}
                            placeholder="MM/DD"
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <input
                            type="text"
                            value={row.workHours}
                            onChange={(e) => updateRow(personIndex, rowIndex, 'workHours', e.target.value)}
                            placeholder="09:00-18:00"
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <select
                            value={row.mealPeriod}
                            onChange={(e) => updateRow(personIndex, rowIndex, 'mealPeriod', e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          >
                            <option value="">請選擇</option>
                            {MEAL_PERIODS.map((period) => (
                              <option key={period.value} value={period.value}>{period.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeRow(personIndex, rowIndex)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="移除此列"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addRow(personIndex)}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 mt-1"
                      >
                        <Plus size={14} />
                        新增日期列
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setPersons([newPersonEntry()])}
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
                {saving ? '新增中...' : `批次新增 (${validCount} 筆)`}
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
