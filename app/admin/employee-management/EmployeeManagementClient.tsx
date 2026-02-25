'use client';

import { useState, useEffect } from 'react';
import { UserCog, Plus, Search, TrendingUp, X, Save, Calendar, Edit2, Upload, Download } from 'lucide-react';
import { POSITION_OPTIONS } from '@/types/workflow';

interface Employee {
  id: string;
  employee_code: string;
  employee_name: string;
  current_position: string | null;
  start_date: string | null;
  birthday: string | null;
  is_active: boolean;
}

interface PromotionHistory {
  id: string;
  movement_type: string;
  movement_date: string;
  new_value: string;
  old_value: string | null;
  notes: string | null;
}

export default function EmployeeManagementClient({ 
  initialEmployees,
  totalCount,
  activeCount
}: { 
  initialEmployees: Employee[];
  totalCount: number;
  activeCount: number;
}) {
  // 先對初始員工資料按員編排序
  const sortedInitialEmployees = [...initialEmployees].sort((a, b) => 
    a.employee_code.localeCompare(b.employee_code)
  );

  const [employees, setEmployees] = useState<Employee[]>(sortedInitialEmployees);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>(sortedInitialEmployees);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [showBirthdayImportModal, setShowBirthdayImportModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [promotionHistory, setPromotionHistory] = useState<PromotionHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ successCount: number; errorCount: number; errors: string[] } | null>(null);
  const [importData, setImportData] = useState<{ employee_code: string; employee_name: string; birthday: string }[]>([]);
  const [importLoading, setImportLoading] = useState(false);

  // 新增員工表單
  const [newEmployee, setNewEmployee] = useState({
    employee_code: '',
    employee_name: '',
    current_position: '',
    start_date: '',
    birthday: ''
  });

  // 編輯員工表單
  const [editEmployee, setEditEmployee] = useState({
    employee_code: '',
    employee_name: '',
    current_position: '',
    start_date: '',
    birthday: ''
  });

  // 搜尋過濾
  useEffect(() => {
    let result: Employee[];
    if (!searchTerm.trim()) {
      result = employees;
    } else {
      const term = searchTerm.toLowerCase();
      result = employees.filter(emp => 
        emp.employee_code.toLowerCase().includes(term) ||
        emp.employee_name.toLowerCase().includes(term)
      );
    }
    // 按員編排序
    result.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
    setFilteredEmployees(result);
  }, [searchTerm, employees]);

  const handleAddEmployee = async () => {
    // 驗證
    if (!newEmployee.employee_code.trim() || !newEmployee.employee_name.trim()) {
      alert('請填寫員編和姓名');
      return;
    }

    // 員編格式驗證
    const code = newEmployee.employee_code.toUpperCase();
    const fkMatch = code.match(/^FK(\d{4})$/);
    const fkfMatch = code.match(/^FKF(\d{5})$/);
    const fkptMatch = code.match(/^FKPT(\d{3})$/);
    const fkiMatch = code.match(/^FKI(\d{3})$/);

    if (!fkMatch && !fkfMatch && !fkptMatch && !fkiMatch) {
      alert('員編格式錯誤！\n正確格式：FK+4碼數字 / FKF+5碼數字 / FKPT+3碼數字 / FKI+3碼數字');
      return;
    }

    if (fkiMatch) {
      if (!confirm('⚠️ 檢測到 FKI 開頭的員編，這通常是實習生代碼。\n確定要繼續新增嗎？')) {
        return;
      }
    }

    setLoading(true);
    try {
      const response = await fetch('/api/employees/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: code,
          employee_name: newEmployee.employee_name.trim(),
          current_position: newEmployee.current_position || null,
          start_date: newEmployee.start_date || null,
          birthday: newEmployee.birthday || null
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ 新增成功！');
        // 重新載入頁面
        window.location.reload();
      } else {
        alert(`❌ 新增失敗：${result.error}`);
      }
    } catch (error: any) {
      alert(`❌ 新增失敗：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadPromotionHistory = async (employeeCode: string) => {
    setLoading(true);
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      
      const { data } = await supabase
        .from('employee_movement_history')
        .select('*')
        .eq('employee_code', employeeCode)
        .order('movement_date', { ascending: false });

      setPromotionHistory(data || []);
    } catch (error) {
      console.error('Error loading promotion history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewPromotion = (employee: Employee) => {
    setSelectedEmployee(employee);
    loadPromotionHistory(employee.employee_code);
    setShowPromotionModal(true);
  };

  const handleEditEmployee = (employee: Employee) => {
    setEditEmployee({
      employee_code: employee.employee_code,
      employee_name: employee.employee_name,
      current_position: employee.current_position || '',
      start_date: employee.start_date || '',
      birthday: employee.birthday || ''
    });
    setSelectedEmployee(employee);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editEmployee.employee_name.trim()) {
      alert('請填寫姓名');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/employees/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_code: editEmployee.employee_code,
          employee_name: editEmployee.employee_name.trim(),
          current_position: editEmployee.current_position || null,
          start_date: editEmployee.start_date || null,
          birthday: editEmployee.birthday || null
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ 更新成功！');
        window.location.reload();
      } else {
        alert(`❌ 更新失敗：${result.error}`);
      }
    } catch (error: any) {
      alert(`❌ 更新失敗：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 匯出 CSV 範本
  const handleExportCSV = () => {
    const header = '員編,姓名,生日(YYYY-MM-DD)';
    const rows = employees.map(emp =>
      `${emp.employee_code},${emp.employee_name},${emp.birthday || ''}`
    );
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `員工生日範本_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 解析 CSV 檔案
  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const cleaned = text.replace(/^\uFEFF/, '');
      const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
      const dataLines = lines.slice(1);
      const parsed = dataLines.map(line => {
        const [employee_code, employee_name, birthday] = line.split(',');
        return {
          employee_code: (employee_code || '').trim(),
          employee_name: (employee_name || '').trim(),
          birthday: (birthday || '').trim()
        };
      }).filter(row => row.employee_code && row.birthday);
      setImportData(parsed);
      setImportResult(null);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // 執行批量更新
  const handleBulkImport = async () => {
    if (importData.length === 0) {
      alert('請先上傳 CSV 檔案');
      return;
    }
    setImportLoading(true);
    try {
      const response = await fetch('/api/employees/bulk-update-birthday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: importData })
      });
      const result = await response.json();
      if (result.success) {
        setImportResult(result);
        setImportData([]);
      } else {
        alert(`處理失敗：${result.error}`);
      }
    } catch (error: any) {
      alert(`處理失敗：${error.message}`);
    } finally {
      setImportLoading(false);
    }
  };

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
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-semibold"
            >
              <Download size={18} />
              匯出 CSV 範本
            </button>
            <button
              onClick={() => { setShowBirthdayImportModal(true); setImportData([]); setImportResult(null); }}
              className="flex items-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-semibold"
            >
              <Upload size={18} />
              批量匯入生日
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <Plus size={20} />
              新增員工
            </button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm font-medium mb-1">總員工數</p>
                <p className="text-3xl font-bold text-gray-900">{totalCount}</p>
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
                <p className="text-3xl font-bold text-green-600">{activeCount}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <UserCog className="text-green-600" size={24} />
              </div>
            </div>
          </div>
        </div>

        {/* 員工列表 */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* 搜尋列 */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">員工資料庫</h2>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜尋員編或姓名..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* 表格 */}
          {filteredEmployees.length === 0 ? (
            <div className="p-12 text-center">
              <UserCog className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {searchTerm ? '找不到符合的員工' : '尚無員工資料'}
              </h3>
              <p className="text-gray-600">
                {searchTerm ? '請嘗試其他搜尋關鍵字' : '點擊右上方「新增員工」開始建立資料'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">員編</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">姓名</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">當前職位</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">到職日</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">生日</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {emp.employee_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {emp.employee_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.current_position || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.start_date || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {emp.birthday || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEditEmployee(emp)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium"
                          >
                            <Edit2 size={14} />
                            編輯
                          </button>
                          <button
                            onClick={() => handleViewPromotion(emp)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors text-sm font-medium"
                          >
                            <TrendingUp size={14} />
                            升遷歷程
                          </button>
                        </div>
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
              {searchTerm ? (
                <>顯示 <span className="font-semibold text-gray-900">{filteredEmployees.length}</span> / {totalCount} 位員工</>
              ) : (
                <>共 <span className="font-semibold text-gray-900">{totalCount}</span> 位員工</>
              )}
            </div>
          </div>
        </div>

        {/* 說明 */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• 此頁面顯示所有員工資料庫（已自動去重）</li>
            <li>• 可手動新增員工，欄位包含：員編、姓名、當前職位、到職日、生日</li>
            <li>• 點擊「升遷歷程」可查看該員工的升遷記錄</li>
            <li>• 員工的升遷請使用「升遷管理」功能統一處理</li>
          </ul>
        </div>
      </div>

      {/* 批量匯入生日 Modal */}
      {showBirthdayImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">批量匯入生日</h3>
              <button onClick={() => setShowBirthdayImportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* 步驟 1 */}
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm font-semibold text-blue-900 mb-1">① 先下載 CSV 範本</p>
                <p className="text-xs text-blue-700 mb-3">範本已預充全部 285 位員工的員編和姓名，只需填寫第三欄「生日」即可。</p>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  <Download size={16} />
                  下載 CSV 範本
                </button>
              </div>

              {/* 步驟 2 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-semibold text-gray-900 mb-1">② 期等填寫完成後，上傳填好的 CSV</p>
                <p className="text-xs text-gray-600 mb-3">日期格式請用 <span className="font-mono font-semibold">YYYY-MM-DD</span>，例如 1990-05-20。未填寫生日的列會被跳過。</p>
                <label className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium cursor-pointer w-fit">
                  <Upload size={16} />
                  選擇 CSV 檔案
                  <input type="file" accept=".csv" className="hidden" onChange={handleCSVFile} />
                </label>
              </div>

              {/* 預覽與確認 */}
              {importData.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-emerald-900 mb-2">③ 確認並執行匯入</p>
                  <p className="text-sm text-emerald-800 mb-3">正準備更新 <span className="font-bold">{importData.length}</span> 位員工的生日</p>
                  <div className="max-h-40 overflow-y-auto mb-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-600">
                          <th className="text-left py-1">員編</th>
                          <th className="text-left py-1">姓名</th>
                          <th className="text-left py-1">生日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importData.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-t border-emerald-100">
                            <td className="py-1">{row.employee_code}</td>
                            <td className="py-1">{row.employee_name}</td>
                            <td className="py-1">{row.birthday}</td>
                          </tr>
                        ))}
                        {importData.length > 10 && (
                          <tr><td colSpan={3} className="py-1 text-gray-500">…還有 {importData.length - 10} 筆</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={handleBulkImport}
                    disabled={importLoading}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50"
                  >
                    {importLoading ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />匯入中...</>
                    ) : (
                      <><Save size={16} />確認匯入</>
                    )}
                  </button>
                </div>
              )}

              {/* 結果 */}
              {importResult && (
                <div className={`rounded-lg p-4 ${importResult.errorCount === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <p className="text-sm font-semibold mb-2">匯入完成</p>
                  <p className="text-sm">✅ 成功更新：<span className="font-bold">{importResult.successCount}</span> 位</p>
                  {importResult.errorCount > 0 && (
                    <>
                      <p className="text-sm">❌ 失敗：<span className="font-bold">{importResult.errorCount}</span> 位</p>
                      <ul className="text-xs text-red-700 mt-1 space-y-0.5">
                        {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </>
                  )}
                  <button
                    onClick={() => { setShowBirthdayImportModal(false); window.location.reload(); }}
                    className="mt-3 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-700"
                  >
                    關閉並重新輍入
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 新增員工 Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">新增員工</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  員編 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newEmployee.employee_code}
                  onChange={(e) => setNewEmployee({...newEmployee, employee_code: e.target.value.toUpperCase()})}
                  placeholder="FK1234"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">格式：FK+4碼 / FKF+5碼 / FKPT+3碼</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newEmployee.employee_name}
                  onChange={(e) => setNewEmployee({...newEmployee, employee_name: e.target.value})}
                  placeholder="王小明"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  當前職位
                </label>
                <select
                  value={newEmployee.current_position}
                  onChange={(e) => setNewEmployee({...newEmployee, current_position: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">請選擇（選填）</option>
                  {POSITION_OPTIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  到職日
                </label>
                <input
                  type="date"
                  value={newEmployee.start_date}
                  onChange={(e) => setNewEmployee({...newEmployee, start_date: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  生日
                </label>
                <input
                  type="date"
                  value={newEmployee.birthday}
                  onChange={(e) => setNewEmployee({...newEmployee, birthday: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddEmployee}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    儲存中...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    儲存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯員工 Modal */}
      {showEditModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">編輯員工</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  員編
                </label>
                <input
                  type="text"
                  value={editEmployee.employee_code}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">員編不可修改</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editEmployee.employee_name}
                  onChange={(e) => setEditEmployee({...editEmployee, employee_name: e.target.value})}
                  placeholder="王小明"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  當前職位
                </label>
                <select
                  value={editEmployee.current_position}
                  onChange={(e) => setEditEmployee({...editEmployee, current_position: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">請選擇（選填）</option>
                  {POSITION_OPTIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  到職日
                </label>
                <input
                  type="date"
                  value={editEmployee.start_date}
                  onChange={(e) => setEditEmployee({...editEmployee, start_date: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  生日
                </label>
                <input
                  type="date"
                  value={editEmployee.birthday}
                  onChange={(e) => setEditEmployee({...editEmployee, birthday: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    儲存中...
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    儲存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 升遷歷程 Modal */}
      {showPromotionModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp className="text-emerald-600" />
                升遷歷程 - {selectedEmployee.employee_name} ({selectedEmployee.employee_code})
              </h3>
              <button
                onClick={() => setShowPromotionModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 max-h-96 overflow-y-auto">
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-600 border-t-transparent mx-auto mb-2"></div>
                  <p className="text-gray-600">載入中...</p>
                </div>
              ) : promotionHistory.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">尚無升遷記錄</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {promotionHistory.map((record, index) => (
                    <div key={record.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="w-3 h-3 bg-emerald-600 rounded-full"></div>
                        {index < promotionHistory.length - 1 && (
                          <div className="w-0.5 h-full bg-emerald-200 mt-1"></div>
                        )}
                      </div>
                      <div className="flex-1 pb-6">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-emerald-600">
                              {record.movement_date}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500">{record.old_value || '無'}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-semibold text-gray-900">{record.new_value}</span>
                          </div>
                          {record.notes && (
                            <p className="text-sm text-gray-600 mt-2">備註：{record.notes}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end p-6 border-t border-gray-200">
              <button
                onClick={() => setShowPromotionModal(false)}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
