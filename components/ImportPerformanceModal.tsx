'use client';

import { useState, useRef } from 'react';
import { Upload, X } from 'lucide-react';

interface ImportPerformanceModalProps {
  yearMonth: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportPerformanceModal({
  yearMonth,
  onClose,
  onSuccess
}: ImportPerformanceModalProps) {
  const [uploading, setUploading] = useState(false);
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const fileInput1Ref = useRef<HTMLInputElement>(null);
  const fileInput2Ref = useRef<HTMLInputElement>(null);

  const handleFileChange1 = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile1(e.target.files[0]);
    }
  };

  const handleFileChange2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile2(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file1) {
      alert('請選擇檔案 1（業績毛利檔）');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file1', file1);
      if (file2) {
        formData.append('file2', file2);
      }
      formData.append('year_month', yearMonth);

      const response = await fetch('/api/import-performance', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        let message = `✅ 匯入成功！\n更新了 ${result.updated} 筆資料\n跳過 ${result.skipped} 筆資料`;
        if (result.errors && result.errors.length > 0) {
          message += `\n\n錯誤訊息：\n${result.errors.slice(0, 5).join('\n')}`;
          if (result.errors.length > 5) {
            message += `\n... 還有 ${result.errors.length - 5} 個錯誤`;
          }
        }
        alert(message);
        onSuccess();
      } else {
        alert(`❌ 匯入失敗：${result.error}\n\n請檢查瀏覽器控制台（F12）查看詳細錯誤訊息`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('匯入失敗');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Upload className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">匯入業績資料</h2>
              <p className="text-sm text-gray-600">從POS系統匯入人員業績毛利檔</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* 說明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">檔案格式說明</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• 支援 Excel (.xlsx, .xls) 格式</li>
              <li>• <strong>檔案 1（必填）</strong>：門市別、收銀代號、收銀員姓名、交易次數、銷售金額、毛利、毛利率</li>
              <li>• <strong>檔案 2（選填）</strong>：門市別、收銀員、商品、銷售毛利 合計（負值會自動轉正後加總）</li>
              <li>• 系統會自動合併同一員工在不同門市的業績</li>
              <li>• 帶有「合計」字樣的列會自動忽略</li>
            </ul>
          </div>

          {/* 檔案 1 選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              檔案 1：業績毛利檔 <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInput1Ref}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange1}
                className="hidden"
              />
              <button
                onClick={() => fileInput1Ref.current?.click()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <Upload size={18} />
                選擇檔案
              </button>
              {file1 && (
                <span className="text-sm text-gray-600">{file1.name}</span>
              )}
            </div>
          </div>

          {/* 檔案 2 選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              檔案 2：銷售毛利檔（選填）
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInput2Ref}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange2}
                className="hidden"
              />
              <button
                onClick={() => fileInput2Ref.current?.click()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
              >
                <Upload size={18} />
                選擇檔案
              </button>
              {file2 && (
                <span className="text-sm text-gray-600">{file2.name}</span>
              )}
            </div>
          </div>

          {/* 目標年月 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目標年月
            </label>
            <div className="text-lg font-semibold text-gray-900">
              {yearMonth.replace('-', ' 年 ')} 月
            </div>
          </div>
        </div>

        {/* 按鈕 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || !file1}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={18} />
            {uploading ? '匯入中...' : '開始匯入'}
          </button>
        </div>
      </div>
    </div>
  );
}
