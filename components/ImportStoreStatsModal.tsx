'use client';

import { useState, useRef } from 'react';
import { X, Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';

interface ImportStoreStatsModalProps {
  yearMonth: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportStoreStatsModal({
  yearMonth,
  onClose,
  onSuccess
}: ImportStoreStatsModalProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseErrorResponse = async (response: Response): Promise<{ error: string; details?: any }> => {
    const rawText = await response.text();

    if (!rawText) {
      return { error: `伺服器錯誤 (${response.status})` };
    }

    try {
      return JSON.parse(rawText);
    } catch {
      if (response.status === 504) {
        return {
          error: '匯入處理逾時，請稍後重試或拆小檔案分批匯入',
          details: rawText
        };
      }

      return {
        error: rawText
      };
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 檢查檔案類型
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError('請選擇 Excel 檔案 (.xlsx 或 .xls)');
      return;
    }

    setError('');
    setResult(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('yearMonth', yearMonth);

      const response = await fetch('/api/import-store-stats', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const data = await parseErrorResponse(response);
        
        // 特別處理權限錯誤
        if (response.status === 403) {
          const errorMsg = data.details 
            ? `${data.error}: ${data.details}` 
            : data.error;
          throw new Error(errorMsg);
        }
        
        // 特別處理資料庫欄位不存在的錯誤
        if (data.details?.errors?.some((e: string) => e.includes('migration'))) {
          throw new Error('資料庫欄位不存在，請聯繫管理員執行資料庫更新腳本');
        }
        
        throw new Error(data.error || `伺服器錯誤 (${response.status})`);
      }

      const data = await response.json();

      setResult(data);
      
      // 如果成功，3秒後自動關閉
      if (data.success && data.details.failed === 0) {
        setTimeout(() => {
          onSuccess();
        }, 3000);
      }
    } catch (err: any) {
      console.error('匯入錯誤:', err);
      setError(err.message || '匯入失敗，請稍後再試');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">匯入門市統計資料</h2>
            <p className="text-sm text-gray-600 mt-1">
              {yearMonth.replace('-', '/')} 月份
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
        <div className="p-6">
          {/* 說明 */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <FileSpreadsheet size={18} />
              Excel 檔案格式說明
            </h3>
            <div className="text-sm text-blue-800 space-y-1">
              <p>請確保 Excel 檔案包含以下欄位（第一列為標題）：</p>
              <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
                <li><strong>門市代號</strong>（必填，用於匹配門市）</li>
                <li><strong>門市人數</strong>（應有門市人數）</li>
                <li><strong>行政人數</strong>（應有行政人數）</li>
                <li><strong>新人人數</strong>（應有新人人數）</li>
                <li><strong>營業天數</strong></li>
                <li><strong>毛利</strong>（總毛利）</li>
                <li><strong>總來客數</strong></li>
                <li><strong>單純處方加購來客數</strong></li>
                <li><strong>一般箋張數</strong></li>
                <li><strong>慢箋張數</strong></li>
              </ul>
              <p className="mt-3 text-xs">
                💡 系統會根據門市代號自動匹配對應門市，若門市已有統計資料則更新，否則新增。
              </p>
            </div>
          </div>

          {/* 檔案選擇 */}
          <div className="mb-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full px-6 py-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload size={24} />
              {uploading ? '匯入中...' : '選擇 Excel 檔案'}
            </button>
          </div>

          {/* 錯誤訊息 */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-semibold text-red-900">匯入失敗</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* 結果顯示 */}
          {result && (
            <div className={`p-4 rounded-lg border ${
              result.details.failed === 0
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <p className={`font-semibold mb-2 ${
                result.details.failed === 0 ? 'text-green-900' : 'text-yellow-900'
              }`}>
                {result.message}
              </p>
              <div className="text-sm space-y-1">
                <p className="text-green-700">✓ 成功: {result.details.success} 筆</p>
                {result.details.failed > 0 && (
                  <p className="text-red-700">✗ 失敗: {result.details.failed} 筆</p>
                )}
              </div>
              {result.details.errors.length > 0 && (
                <div className="mt-3 p-3 bg-white rounded border border-gray-200 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-gray-700 mb-2">錯誤詳情：</p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    {result.details.errors.map((err: string, idx: number) => (
                      <li key={idx}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.details.failed === 0 && (
                <p className="text-xs text-green-700 mt-3">
                  🎉 頁面將在 3 秒後自動重新整理...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            關閉
          </button>
          {result && result.details.failed > 0 && (
            <button
              onClick={() => {
                setResult(null);
                setError('');
              }}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              重新匯入
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
