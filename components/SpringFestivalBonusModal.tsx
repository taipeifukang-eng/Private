'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Calendar } from 'lucide-react';

interface SpringFestivalRecord {
  id: string;
  employee_code: string;
  employee_name: string;
  attendance_date: string;
  category: '藥師' | '主管' | '專員';
  bonus_amount: number;
}

interface EmployeeOption {
  employee_code: string;
  employee_name: string;
}

interface StaffInfo {
  employee_code: string;
  employee_name: string;
  position: string;
  is_pharmacist: boolean;
}

interface SpringFestivalBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearMonth: string;
  storeId: string;
  currentStaffList?: any[];
}

// 員工分類邏輯
function classifyEmployee(staff: { position?: string; is_pharmacist?: boolean }): { category: '藥師' | '主管' | '專員'; amount: number } {
  // 1. 藥師優先：is_pharmacist = true → 藥師 2500
  if (staff.is_pharmacist) {
    return { category: '藥師', amount: 2500 };
  }
  // 2. 主管：主任、副店長、店長、督導、代理店長
  const managerPositions = ['主任', '副店長', '店長', '督導', '代理店長', '督導(代理店長)'];
  if (managerPositions.includes(staff.position || '')) {
    return { category: '主管', amount: 2000 };
  }
  // 3. 專員以上：專員、組長 → 1500
  // 其他未分類也歸為專員
  return { category: '專員', amount: 1500 };
}

const CATEGORY_COLORS: Record<string, string> = {
  '藥師': 'bg-green-100 text-green-800',
  '主管': 'bg-blue-100 text-blue-800',
  '專員': 'bg-orange-100 text-orange-800',
};

const CATEGORY_AMOUNTS: Record<string, number> = {
  '藥師': 2500,
  '主管': 2000,
  '專員': 1500,
};

export default function SpringFestivalBonusModal({ 
  isOpen, 
  onClose, 
  yearMonth,
  storeId,
  currentStaffList = []
}: SpringFestivalBonusModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<SpringFestivalRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [staffInfoMap, setStaffInfoMap] = useState<Map<string, StaffInfo>>(new Map());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // 從 currentStaffList 建立員工資訊 map（用於自動分類）
  useEffect(() => {
    if (currentStaffList && currentStaffList.length > 0) {
      const map = new Map<string, StaffInfo>();
      currentStaffList.forEach((staff: any) => {
        if (staff.employee_code) {
          map.set(staff.employee_code, {
            employee_code: staff.employee_code,
            employee_name: staff.employee_name || '',
            position: staff.position || '',
            is_pharmacist: staff.is_pharmacist || false,
          });
        }
      });
      setStaffInfoMap(map);
    }
  }, [currentStaffList]);

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
        `/api/spring-festival-bonus?year_month=${yearMonth}&store_id=${storeId}`
      );
      const data = await response.json();
      
      if (data.success && data.records && data.records.length > 0) {
        setRecords(data.records.map((r: any) => ({
          id: r.id || generateId(),
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          attendance_date: r.attendance_date,
          category: r.category,
          bonus_amount: r.bonus_amount
        })));
      } else {
        // 沒有記錄時不預填（春節出勤需手動選擇日期和人員）
        setRecords([]);
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

  const generateId = () => Date.now().toString() + Math.random().toString(36).substring(2);

  // 為某一天快速新增所有當前門市員工
  const addAllStaffForDate = (date: string) => {
    if (!date) {
      alert('請先選擇日期');
      return;
    }
    
    const validStaff = currentStaffList.filter(
      (staff: any) => staff.employee_code && staff.employee_name
    );

    if (validStaff.length === 0) {
      alert('目前門市無人員資料');
      return;
    }

    // 過濾掉該日期已存在的員工
    const existingCodes = new Set(
      records
        .filter(r => r.attendance_date === date)
        .map(r => r.employee_code)
    );

    const newRecords = validStaff
      .filter((staff: any) => !existingCodes.has(staff.employee_code))
      .map((staff: any) => {
        const { category, amount } = classifyEmployee({
          position: staff.position,
          is_pharmacist: staff.is_pharmacist
        });
        return {
          id: generateId(),
          employee_code: staff.employee_code,
          employee_name: staff.employee_name,
          attendance_date: date,
          category,
          bonus_amount: amount,
        } as SpringFestivalRecord;
      });

    if (newRecords.length === 0) {
      alert('該日期所有員工已新增');
      return;
    }

    setRecords([...records, ...newRecords]);
  };

  const addRow = () => {
    setRecords([...records, {
      id: generateId(),
      employee_code: '',
      employee_name: '',
      attendance_date: '',
      category: '專員',
      bonus_amount: 1500,
    }]);
  };

  const removeRow = (id: string) => {
    setRecords(records.filter(r => r.id !== id));
  };

  const updateRecord = (id: string, field: keyof SpringFestivalRecord, value: any) => {
    setRecords(records.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // 如果修改了 category，自動更新 bonus_amount
      if (field === 'category') {
        updated.bonus_amount = CATEGORY_AMOUNTS[value as string] || 1500;
      }
      return updated;
    }));
  };

  const handleEmployeeSelect = (index: number, employee: EmployeeOption) => {
    // 自動根據員工資訊分類
    const staffInfo = staffInfoMap.get(employee.employee_code);
    const { category, amount } = classifyEmployee({
      position: staffInfo?.position || '',
      is_pharmacist: staffInfo?.is_pharmacist || false,
    });

    const updatedRecords = records.map((r, i) => 
      i === index ? { 
        ...r, 
        employee_code: employee.employee_code,
        employee_name: employee.employee_name,
        category,
        bonus_amount: amount,
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
      r.attendance_date &&
      r.category &&
      r.bonus_amount >= 0
    );

    if (validRecords.length === 0 && records.length > 0) {
      alert('請確認所有記錄都已填寫完整（員工、日期、對象分類）');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/spring-festival-bonus/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_month: yearMonth,
          store_id: storeId,
          records: validRecords.map(r => ({
            employee_code: r.employee_code,
            employee_name: r.employee_name,
            attendance_date: r.attendance_date,
            category: r.category,
            bonus_amount: r.bonus_amount
          }))
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ ${data.message}`);
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

  // 過濾員工搜尋
  const filteredEmployees = useMemo(() => {
    if (!editingValue) return employees.slice(0, 50);
    
    const search = editingValue.toLowerCase();
    const exactMatches: EmployeeOption[] = [];
    const prefixMatches: EmployeeOption[] = [];
    const containsMatches: EmployeeOption[] = [];
    
    employees.forEach(emp => {
      const code = emp.employee_code.toLowerCase();
      const name = emp.employee_name.toLowerCase();
      
      if (code === search || name === search) {
        exactMatches.push(emp);
      } else if (code.startsWith(search) || name.startsWith(search)) {
        prefixMatches.push(emp);
      } else if (code.includes(search) || name.includes(search)) {
        containsMatches.push(emp);
      }
    });
    
    return [...exactMatches, ...prefixMatches, ...containsMatches].slice(0, 50);
  }, [employees, editingValue]);

  // 各分類統計
  const stats = useMemo(() => {
    const validRecords = records.filter(r => r.employee_code && r.attendance_date);
    const pharmacist = validRecords.filter(r => r.category === '藥師');
    const manager = validRecords.filter(r => r.category === '主管');
    const staff = validRecords.filter(r => r.category === '專員');
    const total = validRecords.reduce((sum, r) => sum + (r.bonus_amount || 0), 0);
    return { pharmacist: pharmacist.length, manager: manager.length, staff: staff.length, total };
  }, [records]);

  // 按日期分組顯示
  const groupedByDate = useMemo(() => {
    const groups: Record<string, SpringFestivalRecord[]> = {};
    records.forEach(r => {
      const date = r.attendance_date || '未選擇日期';
      if (!groups[date]) groups[date] = [];
      groups[date].push(r);
    });
    // 按日期排序
    const sortedKeys = Object.keys(groups).sort();
    const sorted: Record<string, SpringFestivalRecord[]> = {};
    sortedKeys.forEach(k => { sorted[k] = groups[k]; });
    return sorted;
  }, [records]);

  // 快速新增日期功能
  const [quickDate, setQuickDate] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[98vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-red-500 to-red-600 text-white flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">🧧 春節出勤獎金</h2>
            <p className="text-sm text-red-100 mt-1">
              月份：{yearMonth} ｜ 週年(初一~初三)上班獎金
            </p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4 min-h-0 flex flex-col">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
              <p className="mt-2 text-gray-600">載入中...</p>
            </div>
          ) : (
            <div className="space-y-3 h-full flex flex-col">
              {/* 獎金說明 */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex-shrink-0">
                <div className="text-sm text-red-800 font-medium mb-1">獎金標準</div>
                <div className="flex gap-4 text-sm">
                  <span className="inline-flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS['藥師']}`}>藥師</span>
                    $2,500/日
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS['主管']}`}>主管</span>
                    $2,000/日
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS['專員']}`}>專員</span>
                    $1,500/日
                  </span>
                </div>
              </div>

              {/* 操作列 */}
              <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                <button
                  onClick={addRow}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={16} />
                  新增一列
                </button>
                
                {/* 快速新增：選擇日期後一次加入所有門市員工 */}
                <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
                  <Calendar size={16} className="text-gray-500" />
                  <input
                    type="date"
                    value={quickDate}
                    onChange={(e) => setQuickDate(e.target.value)}
                    className="text-sm border-none focus:ring-0 p-0"
                  />
                  <button
                    onClick={() => addAllStaffForDate(quickDate)}
                    disabled={!quickDate}
                    className="px-3 py-1 bg-amber-500 text-white rounded text-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    整批新增該日
                  </button>
                </div>

                {/* 統計 */}
                <div className="text-sm text-gray-600 ml-auto">
                  共 {records.length} 筆 
                  （藥師 {stats.pharmacist}、主管 {stats.manager}、專員 {stats.staff}）
                  ，總計 <span className="font-bold text-red-600">${stats.total.toLocaleString()}</span>
                </div>
              </div>

              {/* 表格容器 */}
              <div className="flex-1 overflow-auto border border-gray-200 rounded-lg min-h-0">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-red-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-36">
                        出勤日期
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-32">
                        員編
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-28">
                        姓名
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-28">
                        對象
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-28">
                        獎金
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-20">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                          尚無記錄。請使用「新增一列」或「整批新增該日」新增春節出勤記錄。
                        </td>
                      </tr>
                    ) : (
                      records.map((record, index) => (
                        <tr key={record.id} className="hover:bg-gray-50">
                          {/* 出勤日期 */}
                          <td className="px-3 py-2">
                            <input
                              type="date"
                              value={record.attendance_date}
                              onChange={(e) => updateRecord(record.id, 'attendance_date', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            />
                          </td>
                          {/* 員編 */}
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
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                placeholder="員編"
                              />
                              {showDropdown && editingIndex === index && filteredEmployees.length > 0 && (
                                <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {filteredEmployees.map((emp) => (
                                    <button
                                      key={emp.employee_code}
                                      onClick={() => handleEmployeeSelect(index, emp)}
                                      className="w-full px-3 py-2 text-left hover:bg-red-50 text-sm border-b border-gray-100 last:border-b-0"
                                    >
                                      <div className="font-medium text-gray-900">{emp.employee_code}</div>
                                      <div className="text-xs text-gray-600">{emp.employee_name}</div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          {/* 姓名 */}
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={record.employee_name}
                              readOnly
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm bg-gray-50 text-gray-700"
                              placeholder="姓名"
                            />
                          </td>
                          {/* 對象 */}
                          <td className="px-3 py-2">
                            <select
                              value={record.category}
                              onChange={(e) => updateRecord(record.id, 'category', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            >
                              <option value="藥師">藥師 ($2,500)</option>
                              <option value="主管">主管 ($2,000)</option>
                              <option value="專員">專員 ($1,500)</option>
                            </select>
                          </td>
                          {/* 獎金 */}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[record.category] || ''}`}>
                                {record.category}
                              </span>
                              <span className="text-sm font-medium text-gray-700">
                                ${record.bonus_amount.toLocaleString()}
                              </span>
                            </div>
                          </td>
                          {/* 操作 */}
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
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center flex-shrink-0 bg-gray-50">
          <div className="text-sm text-gray-500">
            主管＝主任/副店長/店長/督導 ｜ 專員＝專員/組長
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-gray-700 font-medium"
              disabled={saving}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
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
