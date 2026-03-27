'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Upload, Search, Trash2, Loader2, AlertCircle,
  Package, RefreshCw, FileSpreadsheet, CheckCircle, X,
} from 'lucide-react';

interface Product {
  product_code: string;
  product_name: string;
  unit: string;
}

export default function ProductsMasterPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [canManage, setCanManage] = useState(false);
  const [permLoading, setPermLoading] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);

  // 權限檢查
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPermLoading(false); return; }
      const res = await fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionCode: 'cross_dept.products_master.manage' }),
      });
      const d = await res.json();
      setCanManage(d.allowed || false);
      setPermLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 載入商品清單
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/products-master?all=1${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [searchQ]);

  useEffect(() => {
    if (!permLoading) loadProducts();
  }, [permLoading, loadProducts]);

  // 匯入 xlsx
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setUploadResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/products-master', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setUploadResult({ success: true, message: `成功匯入 ${data.count} 筆商品` });
      await loadProducts();
    } catch (err: any) {
      setUploadResult({ success: false, message: err.message });
    } finally {
      setUploading(false);
    }
  };

  // 停用商品
  const handleDelete = async (code: string) => {
    if (!confirm(`確定停用商品「${code}」？`)) return;
    await fetch(`/api/products-master?product_code=${encodeURIComponent(code)}`, { method: 'DELETE' });
    await loadProducts();
  };

  if (permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        <div className="text-center space-y-2">
          <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
          <p className="text-lg font-medium">沒有存取此頁面的權限</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
            <Package className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">商品資料主檔</h1>
            <p className="text-sm text-gray-500">匯入 Excel 維護商品編號 / 品名 / 單位</p>
          </div>
        </div>

        {/* 匯入區 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">匯入商品主檔 (.xlsx)</p>
          <div className="text-xs text-gray-400 mb-3 space-y-0.5">
            <p>Excel 欄位名稱：<span className="font-mono bg-gray-100 px-1 rounded">商品編號</span>、<span className="font-mono bg-gray-100 px-1 rounded">商品名稱</span>、<span className="font-mono bg-gray-100 px-1 rounded">單位</span></p>
            <p>重複商品編號會自動覆蓋更新，不會刪除資料庫內的其他商品。</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {uploading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Upload className="w-4 h-4" />
              }
              {uploading ? '匯入中...' : '選擇 Excel 檔案'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {uploadResult && (
              <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${
                uploadResult.success
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {uploadResult.success
                  ? <CheckCircle className="w-4 h-4 shrink-0" />
                  : <AlertCircle className="w-4 h-4 shrink-0" />
                }
                {uploadResult.message}
                <button onClick={() => setUploadResult(null)}><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>

          {/* 下載範本 */}
          <button
            onClick={() => {
              // 產生簡單範本 CSV 讓使用者下載
              const csv = '\uFEFF商品編號,商品名稱,單位\nA001,感冒糖漿100ml,瓶\nA002,維他命C發泡錠,條';
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = '商品主檔範本.csv';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="mt-3 flex items-center gap-1.5 text-xs text-orange-600 hover:underline"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            下載 CSV 範本
          </button>
        </div>

        {/* 搜尋 & 清單 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="搜尋商品編號或品名..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <button
              onClick={loadProducts}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              重新整理
            </button>
            <span className="text-xs text-gray-400 shrink-0">共 {products.length} 筆</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />載入中...
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>{searchQ ? '找不到符合的商品' : '尚未匯入任何商品資料'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {/* 表頭 */}
              <div className="grid grid-cols-12 px-5 py-2 text-xs font-medium text-gray-400 bg-gray-50">
                <div className="col-span-3">商品編號</div>
                <div className="col-span-6">商品名稱</div>
                <div className="col-span-2">單位</div>
                <div className="col-span-1"></div>
              </div>
              {products.map(p => (
                <div key={p.product_code} className="grid grid-cols-12 px-5 py-3 text-sm items-center hover:bg-gray-50">
                  <div className="col-span-3 font-mono text-gray-700">{p.product_code}</div>
                  <div className="col-span-6 text-gray-900">{p.product_name}</div>
                  <div className="col-span-2 text-gray-500">{p.unit || '—'}</div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => handleDelete(p.product_code)}
                      className="p-1.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                      title="停用"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
