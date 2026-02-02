'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Upload, Download, Save, Trash2, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { BatchPromotionInput } from '@/types/workflow';
import { POSITION_OPTIONS } from '@/types/workflow';

export default function PromotionManagementPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [promotions, setPromotions] = useState<BatchPromotionInput[]>([
    { employee_code: '', employee_name: '', position: '', effective_date: '', notes: '' }
  ]);

  useEffect(() => {
    loadStoreInfo();
  }, [storeId]);

  const loadStoreInfo = async () => {
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();

      const { data: storeData } = await supabase
        .from('stores')
        .select('store_name')
        .eq('id', storeId)
        .single();

      if (storeData) {
        setStoreName(storeData.store_name);
      }
    } catch (error) {
      console.error('Error loading store info:', error);
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

  const updateRow = (index: number, field: keyof BatchPromotionInput, value: string) => {
    const updated = [...promotions];
    updated[index] = { ...updated[index], [field]: value };
    setPromotions(updated);
  };

  const validatePromotions = () => {
    const errors: string[] = [];

    promotions.forEach((promo, index) => {
      if (!promo.employee_code.trim()) {
        errors.push(`第 ${index + 1} 列：缺少員編`);
      }
      if (!promo.employee_name.trim()) {
        errors.push(`第 ${index + 1} 列：缺少姓名`);
      }
      if (!promo.position) {
        errors.push(`第 ${index + 1} 列：缺少職位`);
      }
      if (!promo.effective_date) {
        errors.push(`第 ${index + 1} 列：缺少生效日`);
      }
    });

    return errors;
  };

  const handleSave = async () => {
    const errors = validatePromotions();
    
    if (errors.length > 0) {
      alert('請修正以下錯誤：\n\n' + errors.join('\n'));
      return;
    }

    if (!confirm(`確定要儲存 ${promotions.length} 筆升遷記錄嗎？\n\n系統會自動更新對應月份的職位資料。`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/promotions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          promotions
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ 成功儲存 ${result.created} 筆升遷記錄\n已自動更新對應月份的職位資料`);
        // 重置表單
        setPromotions([{ employee_code: '', employee_name: '', position: '', effective_date: '', notes: '' }]);
      } else {
        alert(`❌ 儲存失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving promotions:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: 'binary' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<any>(firstSheet);

        const imported: BatchPromotionInput[] = data.map((row: any) => ({
          employee_code: (row['員編'] || '').toString().toUpperCase(),
          employee_name: (row['姓名'] || '').toString(),
          position: (row['職位'] || '').toString(),
          effective_date: row['生效日'] || '',
          notes: (row['備註'] || '').toString()
        })).filter(p => p.employee_code || p.employee_name);

        if (imported.length > 0) {
          setPromotions(imported);
          alert(`✅ 已匯入 ${imported.length} 筆資料`);
        } else {
          alert('Excel 檔案沒有有效資料');
        }
      } catch (error) {
        console.error('Error importing file:', error);
        alert('匯入失敗，請確認檔案格式');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleExportTemplate = () => {
    const template = [
      {
        '員編': 'FK0001',
        '姓名': '王小明',
        '職位': '店長',
        '生效日': '2026/02/01',
        '備註': '升任店長'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '升遷範本');
    XLSX.writeFile(workbook, `升遷匯入範本.xlsx`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁首 */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">升遷管理</h1>
              <p className="text-gray-600 mt-1">{storeName}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleExportTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Download size={18} />
                下載範本
              </button>
              <label className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors cursor-pointer">
                <Upload size={18} />
                匯入 Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* 說明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">功能說明</p>
              <ul className="list-disc list-inside space-y-1">
                <li>批次輸入員工升遷資料，系統會自動更新對應月份及之後所有月份的職位</li>
                <li>生效日格式：YYYY/MM/DD 或 YYYY-MM-DD</li>
                <li>可使用「匯入 Excel」功能批次上傳資料</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 批次輸入表格 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">升遷資料</h2>
            <div className="flex gap-2">
              <button
                onClick={addRow}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm"
              >
                <Plus size={16} />
                新增列
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">
                    員編 *
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">
                    姓名 *
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">
                    職位 *
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">
                    生效日 *
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    備註
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-20">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {promotions.map((promo, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={promo.employee_code}
                        onChange={(e) => updateRow(index, 'employee_code', e.target.value.toUpperCase())}
                        placeholder="FK0001"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={promo.employee_name}
                        onChange={(e) => updateRow(index, 'employee_name', e.target.value)}
                        placeholder="王小明"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={promo.position}
                        onChange={(e) => updateRow(index, 'position', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">請選擇</option>
                        {POSITION_OPTIONS.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="date"
                        value={promo.effective_date}
                        onChange={(e) => updateRow(index, 'effective_date', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={promo.notes || ''}
                        onChange={(e) => updateRow(index, 'notes', e.target.value)}
                        placeholder="升遷說明"
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => removeRow(index)}
                        className="text-red-600 hover:text-red-800"
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

          <div className="p-4 border-t border-gray-200 flex justify-between items-center bg-gray-50">
            <div className="text-sm text-gray-600">
              共 {promotions.length} 筆資料
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              {saving ? '儲存中...' : '儲存升遷記錄'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
