'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, ChevronLeft, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{
    row: number;
    employee_code: string;
    employee_name: string;
    error: string;
  }>;
}

export default function ImportEmployeesPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 檢查檔案類型
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('請上傳 Excel 檔案（.xlsx 或 .xls）');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/import-employees', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        alert(`匯入失敗：${data.error}`);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('上傳失敗，請稍後再試');
    } finally {
      setUploading(false);
      // 清除檔案選擇
      event.target.value = '';
    }
  };

  const downloadTemplate = () => {
    // 創建範本資料
    const templateData = [
      {
        '門市代號': 'A001',
        '員編': 'E001',
        '姓名': '王小明',
        '職位': '藥師',
        '到職日期': '2024-01-15'
      },
      {
        '門市代號': 'A001',
        '員編': 'E002',
        '姓名': '李小華',
        '職位': '店長',
        '到職日期': '2023-06-01'
      },
      {
        '門市代號': 'A002',
        '員編': 'E003',
        '姓名': '張三',
        '職位': '藥師',
        '到職日期': '2024-02-20'
      }
    ];

    // 創建工作簿
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // 設置列寬
    worksheet['!cols'] = [
      { wch: 12 }, // 門市代號
      { wch: 12 }, // 員編
      { wch: 12 }, // 姓名
      { wch: 15 }, // 職位
      { wch: 15 }  // 到職日期
    ];

    // 添加工作表
    XLSX.utils.book_append_sheet(workbook, worksheet, '員工資料');

    // 生成並下載 Excel 檔案
    XLSX.writeFile(workbook, '員工匯入範本.xlsx');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">批次匯入員工</h1>
            <p className="text-gray-600">上傳 Excel 或 CSV 檔案快速新增員工</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左側：上傳區域 */}
          <div className="space-y-6">
            {/* 說明卡片 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
                <AlertCircle size={20} />
                使用說明
              </h2>
              <ol className="space-y-2 text-sm text-blue-800">
                <li className="flex gap-2">
                  <span className="font-semibold">1.</span>
                  <span>下載範本檔案，並按照格式填寫員工資料</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">2.</span>
                  <span>必填欄位：門市代號、員編、姓名、職位、到職日期</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">3.</span>
                  <span>日期格式：YYYY-MM-DD（例如：2024-01-15）</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">4.</span>
                  <span>門市代號必須已存在於系統中</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">5.</span>
                  <span>員編不可重複</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">6.</span>
                  <span>匯入後可至員工管理編輯雇用類型等詳細資料</span>
                </li>
              </ol>
            </div>

            {/* 下載範本 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                下載範本
              </h2>
              <button
                onClick={downloadTemplate}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Download size={20} />
                下載 Excel 範本
              </button>
              <p className="text-xs text-gray-500 mt-3 text-center">
                支援 Excel (.xlsx, .xls) 格式
              </p>
            </div>

            {/* 上傳檔案 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                上傳檔案
              </h2>
              
              <label className="block">
                <div className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  uploading 
                    ? 'border-gray-300 bg-gray-50' 
                    : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50'
                }`}>
                  <Upload size={48} className={`mx-auto mb-4 ${uploading ? 'text-gray-400' : 'text-blue-600'}`} />
                  <p className="text-lg font-medium text-gray-900 mb-2">
                    {uploading ? '上傳中...' : '點擊選擇檔案'}
                  </p>
                  <p className="text-sm text-gray-500">
                    支援 .xlsx, .xls 格式
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* 右側：匯入結果 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileSpreadsheet size={20} />
              匯入結果
            </h2>

            {!result ? (
              <div className="text-center py-12 text-gray-400">
                <FileSpreadsheet size={64} className="mx-auto mb-4 opacity-50" />
                <p>上傳檔案後將顯示匯入結果</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 統計摘要 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 size={20} className="text-green-600" />
                      <span className="text-sm font-medium text-green-900">成功匯入</span>
                    </div>
                    <p className="text-2xl font-bold text-green-600">{result.imported}</p>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle size={20} className="text-red-600" />
                      <span className="text-sm font-medium text-red-900">匯入失敗</span>
                    </div>
                    <p className="text-2xl font-bold text-red-600">{result.failed}</p>
                  </div>
                </div>

                {/* 錯誤列表 */}
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-6">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <XCircle size={18} className="text-red-600" />
                      錯誤明細
                    </h3>
                    <div className="max-h-96 overflow-y-auto space-y-2">
                      {result.errors.map((error, index) => (
                        <div
                          key={index}
                          className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm"
                        >
                          <div className="font-medium text-red-900 mb-1">
                            第 {error.row} 列 - {error.employee_code} {error.employee_name}
                          </div>
                          <div className="text-red-700">{error.error}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 成功提示 */}
                {result.imported > 0 && (
                  <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 mb-3">
                      ✓ 已成功匯入 {result.imported} 位員工
                    </p>
                    <button
                      onClick={() => router.push('/admin/employees')}
                      className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                    >
                      前往員工管理
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
