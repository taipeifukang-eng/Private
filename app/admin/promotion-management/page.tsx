'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Plus, Upload, Download, Save, Trash2, AlertCircle, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';
import { POSITION_OPTIONS } from '@/types/workflow';

interface PromotionInput {
  employee_code: string;
  employee_name: string;
  position: string;
  effective_date: string;
  notes: string;
}

interface PromotionHistory {
  id: string;
  employee_code: string;
  employee_name: string;
  promotion_date: string;
  new_position: string;
  old_position: string | null;
  notes: string | null;
  created_at: string;
}

export default function PromotionManagementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promotions, setPromotions] = useState<PromotionInput[]>([
    { employee_code: '', employee_name: '', position: '', effective_date: '', notes: '' }
  ]);
  const [promotionHistory, setPromotionHistory] = useState<PromotionHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

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

    loadPromotionHistory();
    setLoading(false);
  };

  const loadPromotionHistory = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    const { data } = await supabase
      .from('employee_promotion_history')
      .select('*')
      .order('promotion_date', { ascending: false })
      .limit(100);

    if (data) {
      setPromotionHistory(data);
    }
  };

  const addRow = () => {
    setPromotions([...promotions, { employee_code: '', employee_name: '', position: '', effective_date: '', notes: '' }]);
  };

  const removeRow = (index: number) => {
    if (promotions.length === 1) {
      alert('至少需要保留一列');
      return;
    }
    setPromotions(promotions.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof PromotionInput, value: string) => {
    const updated = [...promotions];
    updated[index] = { ...updated[index], [field]: value };
    
    // 員編自動轉大寫
    if (field === 'employee_code') {
      updated[index].employee_code = value.toUpperCase();
    }
    
    setPromotions(updated);
  };

  const handleSave = async () => {
    // 驗證資料
    const emptyFields = promotions.filter(p => 
      !p.employee_code.trim() || !p.employee_name.trim() || !p.position || !p.effective_date
    );

    if (emptyFields.length > 0) {
      alert('請填寫所有必填欄位（員編、姓名、職位、生效日期）');
      return;
    }

    if (!confirm(`確定要建立 ${promotions.length} 筆升遷記錄嗎？\n\n升遷將自動更新該員工從生效日期起的所有月份職位。`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/promotions/batch-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotions })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ 成功建立 ${result.created} 筆升遷記錄！`);
        // 重置表單
        setPromotions([{ employee_code: '', employee_name: '', position: '', effective_date: '', notes: '' }]);
        // 重新載入歷史記錄
        loadPromotionHistory();
      } else {
        alert(`❌ 錯誤：${result.error}`);
      }
    } catch (error: any) {
      console.error('Error saving promotions:', error);
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
          position: (row['職位'] || row['position'] || '').toString(),
          effective_date: row['生效日期'] || row['effective_date'] || '',
          notes: (row['備註'] || row['notes'] || '').toString()
        }));

        setPromotions(imported);
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
    const exportData = promotions.map(p => ({
      '員編': p.employee_code,
      '姓名': p.employee_name,
      '職位': p.position,
      '生效日期': p.effective_date,
      '備註': p.notes
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '升遷資料');
    XLSX.writeFile(wb, `升遷管理_${new Date().toISOString().split('T')[0]}.xlsx`);
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
              升遷管理
            </h1>
            <p className="text-gray-600">批次管理員工升遷，自動更新每月人員狀態</p>
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

        {/* 升遷歷史記錄 */}
        {showHistory && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">近期升遷記錄</h2>
            {promotionHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">尚無升遷記錄</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">員編</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">姓名</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">舊職位</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">新職位</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">生效日期</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {promotionHistory.map((record) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.employee_code}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{record.employee_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{record.old_position || '-'}</td>
                        <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{record.new_position}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{record.promotion_date}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{record.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 批次輸入區 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">批次輸入升遷</h2>
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
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-32">
                    員編 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-32">
                    姓名 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-40">
                    職位 <span className="text-red-500">*</span>
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
                {promotions.map((promo, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={promo.employee_code}
                        onChange={(e) => updateRow(index, 'employee_code', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="FK1234"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={promo.employee_name}
                        onChange={(e) => updateRow(index, 'employee_name', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="王小明"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <select
                        value={promo.position}
                        onChange={(e) => updateRow(index, 'position', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      >
                        <option value="">請選擇</option>
                        {POSITION_OPTIONS.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="date"
                        value={promo.effective_date}
                        onChange={(e) => updateRow(index, 'effective_date', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={promo.notes}
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
              <span>共 {promotions.length} 筆升遷資料</span>
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
                  儲存升遷記錄
                </>
              )}
            </button>
          </div>
        </div>

        {/* 說明 */}
        <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-emerald-800 space-y-1">
            <li>• 輸入員編、姓名、新職位、生效日期即可建立升遷記錄</li>
            <li>• 系統會自動查詢並記錄該員工的舊職位</li>
            <li>• <strong>升遷記錄會自動更新該員工從生效日期起的所有月份職位</strong></li>
            <li>• 支援 Excel 匯入/匯出，方便批次處理</li>
            <li>• 員編會自動轉換為大寫</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
