'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as XLSX from 'xlsx';
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CheckCircle,
  ClipboardList,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  Package,
  RefreshCw,
  ScanLine,
  Search,
  Upload,
  X,
} from 'lucide-react';

type AcquisitionSubTab = 'dashboard' | 'import' | 'scan' | 'unmatched';

type DashboardStats = {
  productCount: number;
  barcodeCount: number;
  todayScanCount: number;
  unresolvedCount: number;
};

type ScanRow = {
  id: string;
  scan_date: string;
  barcode: string;
  product_code?: string | null;
  product_name?: string | null;
  unit?: string | null;
  is_matched: boolean;
  scanned_at?: string | null;
};

type UnmatchedRow = {
  id: string;
  scan_date: string;
  barcode?: string | null;
  ocr_product_name?: string | null;
  ocr_barcode?: string | null;
  ocr_supplier?: string | null;
  photos?: string[];
  notes?: string | null;
  is_resolved: boolean;
  created_at?: string | null;
};

type PreviewProduct = {
  product_code: string;
  product_name: string;
  unit: string;
  barcodes: string[];
};

const acquisitionTabs: Array<{ key: AcquisitionSubTab; label: string }> = [
  { key: 'dashboard', label: '系統總覽' },
  { key: 'import', label: '商品主檔匯入' },
  { key: 'scan', label: '併購藥局商品掃描' },
  { key: 'unmatched', label: '未建立商品管理' },
];

function normalizeBarcode(raw: string): string {
  let value = String(raw || '').trim();
  if (!value) return '';

  // Excel 常見文字欄位前綴單引號
  value = value.replace(/^'+/, '');
  // 去除空白與常見分隔符
  value = value.replace(/[\s\-‐‑‒–—―]+/g, '');

  // 13位條碼有時被轉成 4987170870977.0
  if (/^\d+\.0+$/.test(value)) {
    value = value.replace(/\.0+$/, '');
  }

  // 科學記號轉整數字串（目前條碼長度安全）
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      value = n.toFixed(0);
    }
  }

  return value;
}

function buildBarcodeCandidates(raw: string): string[] {
  const set = new Set<string>();
  const normalized = normalizeBarcode(raw);
  const trimmed = String(raw || '').trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (trimmed) set.add(trimmed);
  if (normalized) set.add(normalized);
  if (digitsOnly) set.add(digitsOnly);
  if (normalized) set.add(`'${normalized}`);
  if (normalized) set.add(`${normalized}.0`);

  return Array.from(set).filter(Boolean);
}

export default function AcquisitionProductsTab() {
  const [activeTab, setActiveTab] = useState<AcquisitionSubTab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDataChanged = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white">
          <Package className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">併購藥局商品主檔整理</h2>
          <p className="text-sm text-gray-500">依照參考系統流程整合總覽、匯入、掃描與未建立商品管理</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-2">
        <div className="flex flex-wrap gap-2">
          {acquisitionTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'dashboard' && <AcquisitionDashboard onNavigate={setActiveTab} refreshKey={refreshKey} />}
      {activeTab === 'import' && <AcquisitionImport onImported={handleDataChanged} />}
      {activeTab === 'scan' && <AcquisitionScan onSaved={handleDataChanged} refreshKey={refreshKey} />}
      {activeTab === 'unmatched' && <AcquisitionUnmatched onChanged={handleDataChanged} refreshKey={refreshKey} />}
    </div>
  );
}

function AcquisitionDashboard({
  onNavigate,
  refreshKey,
}: {
  onNavigate: (tab: AcquisitionSubTab) => void;
  refreshKey: number;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    productCount: 0,
    barcodeCount: 0,
    todayScanCount: 0,
    unresolvedCount: 0,
  });
  const [todayScans, setTodayScans] = useState<ScanRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const [productsRes, barcodesRes, unresolvedRes, scansRes] = await Promise.all([
        supabase.from('products_master').select('*', { count: 'exact', head: true }),
        supabase.from('product_barcodes').select('*', { count: 'exact', head: true }),
        supabase.from('acquisition_unmatched').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
        supabase.from('acquisition_scans').select('*').eq('scan_date', today).order('scanned_at', { ascending: false }),
      ]);

      const tableMissing = [productsRes.error, barcodesRes.error, unresolvedRes.error, scansRes.error].find(Boolean);
      if (tableMissing) throw tableMissing;

      setStats({
        productCount: productsRes.count || 0,
        barcodeCount: barcodesRes.count || 0,
        todayScanCount: scansRes.data?.length || 0,
        unresolvedCount: unresolvedRes.count || 0,
      });
      setTodayScans((scansRes.data as ScanRow[]) || []);
    } catch (err: any) {
      setError(err?.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) {
    return <TableMissingState message={error} />;
  }

  const statCards = [
    { label: '商品主檔總數', value: stats.productCount, tone: 'bg-teal-50 text-teal-700' },
    { label: '條碼對應筆數', value: stats.barcodeCount, tone: 'bg-amber-50 text-amber-700' },
    { label: '今日掃描次數', value: stats.todayScanCount, tone: 'bg-blue-50 text-blue-700' },
    { label: '待建立商品數', value: stats.unresolvedCount, tone: 'bg-red-50 text-red-700' },
  ];

  const entries = [
    { title: '商品主檔匯入', desc: '匯入 Excel 並建立多條碼對應', tab: 'import' as const, tone: 'from-teal-500 to-emerald-500' },
    { title: '併購藥局商品掃描', desc: '掃碼比對主檔，未匹配時留下待建立紀錄', tab: 'scan' as const, tone: 'from-amber-500 to-orange-500' },
    { title: '未建立商品管理', desc: '依掃描日期整理未匹配商品並後續處理', tab: 'unmatched' as const, tone: 'from-rose-500 to-red-500' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className={`inline-flex rounded-xl px-3 py-1.5 text-xs font-semibold ${card.tone}`}>{card.label}</div>
            <div className="mt-4 text-3xl font-bold text-gray-900">{loading ? '—' : card.value.toLocaleString('zh-TW')}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {entries.map((entry) => (
          <button
            key={entry.title}
            onClick={() => onNavigate(entry.tab)}
            className="text-left bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-teal-300 transition-all"
          >
            <div className={`inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br ${entry.tone} items-center justify-center text-white mb-4`}>
              <ArrowRight className="w-5 h-5" />
            </div>
            <div className="font-semibold text-gray-900">{entry.title}</div>
            <div className="text-sm text-gray-500 mt-1">{entry.desc}</div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="font-semibold text-gray-900">今日掃描紀錄</div>
          <div className="text-xs text-gray-400">{new Date().toLocaleDateString('zh-TW')}</div>
        </div>
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">載入中...</div>
        ) : todayScans.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">今日尚無掃描紀錄</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {todayScans.slice(0, 10).map((scan) => (
              <div key={scan.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${scan.is_matched ? 'bg-teal-500' : 'bg-red-400'}`} />
                <span className="font-mono text-gray-500 w-40 truncate">{scan.barcode}</span>
                <span className="flex-1 text-gray-900 truncate">{scan.product_name || '— 未建立商品 —'}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${scan.is_matched ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                  {scan.is_matched ? '已比對' : '未建立'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AcquisitionImport({ onImported }: { onImported: () => void }) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [previewData, setPreviewData] = useState<PreviewProduct[]>([]);
  const [totalBarcodes, setTotalBarcodes] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fieldMappings, setFieldMappings] = useState({
    product_code: '',
    product_name: '',
    unit: '',
    barcode: '',
  });

  const processFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      alert('請選擇 .xlsx 或 .xls 檔案');
      return;
    }

    setSelectedFile(file);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target?.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false });
      const headerRow = (rows[0] || []).map((value) => String(value || '').trim()).filter(Boolean);
      const bodyRows = rows.slice(1).map((row) => headerRow.map((_, index) => String(row[index] || '').trim()));
      setHeaders(headerRow);
      setRawRows(bodyRows.filter((row) => row.some(Boolean)));

      const autoPick = (keywords: string[]) => headerRow.find((header) => keywords.some((kw) => header.toLowerCase().includes(kw.toLowerCase()))) || '';
      setFieldMappings({
        product_code: autoPick(['品號', '商品編號', '編號', 'code']),
        product_name: autoPick(['品名', '商品名稱', '名稱', 'name']),
        unit: autoPick(['單位', 'unit']),
        barcode: autoPick(['條碼', 'barcode', '修碼', '健保碼']),
      });
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const parsePreview = useCallback(() => {
    const required = ['product_code', 'product_name', 'unit', 'barcode'].filter((key) => !fieldMappings[key as keyof typeof fieldMappings]);
    if (required.length > 0) {
      alert('請先完成欄位對應');
      return;
    }

    const headerIndex = (headerName: string) => headers.indexOf(headerName);
    const productMap = new Map<string, PreviewProduct & { barcodeSet: Set<string> }>();

    rawRows.forEach((row) => {
      const productCode = String(row[headerIndex(fieldMappings.product_code)] || '').trim();
      const productName = String(row[headerIndex(fieldMappings.product_name)] || '').trim();
      const unit = String(row[headerIndex(fieldMappings.unit)] || '').trim();
      const barcode = normalizeBarcode(String(row[headerIndex(fieldMappings.barcode)] || ''));
      if (!productCode) return;

      if (!productMap.has(productCode)) {
        productMap.set(productCode, {
          product_code: productCode,
          product_name: productName,
          unit,
          barcodes: [],
          barcodeSet: new Set<string>(),
        });
      }

      const current = productMap.get(productCode)!;
      if (barcode) current.barcodeSet.add(barcode);
      current.barcodeSet.add(productCode);
      current.product_name = current.product_name || productName;
      current.unit = current.unit || unit;
    });

    const preview = Array.from(productMap.values()).map((item) => ({
      product_code: item.product_code,
      product_name: item.product_name,
      unit: item.unit,
      barcodes: Array.from(item.barcodeSet),
    }));

    setTotalBarcodes(preview.reduce((sum, item) => sum + item.barcodes.length, 0));
    setPreviewData(preview);
  }, [fieldMappings, headers, rawRows]);

  const startImport = useCallback(async () => {
    if (previewData.length === 0) return;
    setImporting(true);
    setResult(null);
    setProgress(0);
    setStatus('準備匯入...');

    try {
      const products = previewData.map((item) => ({
        product_code: item.product_code,
        product_name: item.product_name,
        unit: item.unit,
      }));

      setStatus('比對商品主檔...');
      const allCodes = products.map((item) => item.product_code);
      const existingCodes = new Set<string>();

      for (let index = 0; index < allCodes.length; index += 500) {
        const { data, error } = await supabase
          .from('products_master')
          .select('product_code')
          .in('product_code', allCodes.slice(index, index + 500));
        if (error) throw error;
        (data || []).forEach((row) => existingCodes.add(row.product_code));
      }

      const insertedProducts = products.filter((item) => !existingCodes.has(item.product_code)).length;
      const skippedProducts = products.length - insertedProducts;

      setStatus('寫入新增商品...');
      for (let index = 0; index < products.length; index += 200) {
        const batch = products.slice(index, index + 200);
        const { error } = await supabase
          .from('products_master')
          .upsert(batch, { onConflict: 'product_code', ignoreDuplicates: true });
        if (error) throw error;
        setProgress(Math.round(((index + batch.length) / products.length) * 50));
      }

      // 去除同一 (barcode, product_code) pair 的重複（同批次不可重複衝突鍵）
      const pairSet = new Set<string>();
      const barcodes: { product_code: string; barcode: string }[] = [];
      previewData.forEach((item) => {
        item.barcodes.forEach((barcode) => {
          const key = `${barcode}__${item.product_code}`;
          if (!pairSet.has(key)) {
            pairSet.add(key);
            barcodes.push({ product_code: item.product_code, barcode });
          }
        });
      });

      setStatus('寫入條碼對應...');
      for (let index = 0; index < barcodes.length; index += 200) {
        const batch = barcodes.slice(index, index + 200);
        const { error } = await supabase.from('product_barcodes').upsert(batch, { onConflict: 'barcode,product_code' });
        if (error) throw error;
        setProgress(50 + Math.round(((index + batch.length) / Math.max(barcodes.length, 1)) * 50));
      }

      setProgress(100);
      setStatus('完成');
      setResult({
        success: true,
        message: `條碼對應寫入 ${barcodes.length} 筆 / 商品主檔新增 ${insertedProducts} 個，已存在跳過 ${skippedProducts} 個`,
      });
      onImported();
    } catch (err: any) {
      setResult({ success: false, message: `匯入失敗：${err?.message || '未知錯誤'}` });
    } finally {
      setImporting(false);
    }
  }, [onImported, previewData, supabase]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900">商品主檔匯入</h3>
        <p className="text-sm text-gray-500 mt-1">匯入 DPOS 商品主檔 Excel，支援多條碼對應</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            ['品號', '商品編號（主鍵）'],
            ['品名', '商品名稱'],
            ['單位', '計量單位'],
            ['條碼', '可對應多筆條碼'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-xl bg-gray-50 p-3">
              <div className="font-semibold text-teal-700">{title}</div>
              <div className="text-gray-500 mt-1">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${dragging ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-teal-300'}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) processFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <div className="text-sm font-medium text-gray-900">拖曳檔案或點擊選擇</div>
          <div className="text-xs text-gray-400 mt-1">支援 .xlsx、.xls</div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) processFile(file);
          }} />
        </div>

        {selectedFile && (
          <div className="mt-3 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
            已選擇：{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
          </div>
        )}
      </div>

      {headers.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-900 mb-4">欄位對應設定</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              ['product_code', '品號'],
              ['product_name', '品名'],
              ['unit', '單位'],
              ['barcode', '條碼'],
            ].map(([key, label]) => (
              <div key={key}>
                <div className="text-xs font-medium text-gray-500 mb-1.5">{label}</div>
                <select
                  value={fieldMappings[key as keyof typeof fieldMappings]}
                  onChange={(event) => setFieldMappings((current) => ({ ...current, [key]: event.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  <option value="">-- 選擇欄位 --</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button onClick={parsePreview} className="mt-4 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            預覽資料
          </button>
        </div>
      )}

      {previewData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-gray-900">資料預覽</div>
              <div className="text-xs text-gray-500 mt-1">共 {rawRows.length} 筆原始紀錄，合併後 {previewData.length} 個品號 / {totalBarcodes} 條條碼</div>
            </div>
            <button
              onClick={startImport}
              disabled={importing}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {importing ? '匯入中...' : '確認匯入'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-4 py-3 text-left">品號</th>
                  <th className="px-4 py-3 text-left">品名</th>
                  <th className="px-4 py-3 text-left">單位</th>
                  <th className="px-4 py-3 text-left">條碼</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewData.slice(0, 20).map((row) => (
                  <tr key={row.product_code}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.product_code}</td>
                    <td className="px-4 py-3 text-gray-900">{row.product_name}</td>
                    <td className="px-4 py-3 text-gray-500">{row.unit || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.barcodes.map((barcode) => (
                          <span key={barcode} className="inline-flex px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 text-xs font-mono">{barcode}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(importing || result) && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="font-semibold text-gray-900 mb-4">匯入進度</div>
          {importing && (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>{status}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${progress}%` }} />
              </div>
            </>
          )}
          {result && (
            <div className={`mt-4 flex items-start gap-3 px-4 py-3 rounded-xl ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {result.success ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <AlertCircle className="w-5 h-5 mt-0.5" />}
              <div className="text-sm">{result.message}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AcquisitionScan({ onSaved, refreshKey }: { onSaved: () => void; refreshKey: number }) {
  const supabase = createClient();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [scanDate, setScanDate] = useState(new Date().toISOString().split('T')[0]);
  const [barcodeValue, setBarcodeValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [scanList, setScanList] = useState<ScanRow[]>([]);
  const [lastResult, setLastResult] = useState<{ matched: boolean; message: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalBarcode, setModalBarcode] = useState('');
  // 多品號選擇視窗
  const [multiMatches, setMultiMatches] = useState<{ product_code: string; product_name: string; unit: string }[]>([]);
  const [pendingBarcode, setPendingBarcode] = useState('');
  const [showMultiSelect, setShowMultiSelect] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [savingUnmatched, setSavingUnmatched] = useState(false);
  const [draft, setDraft] = useState({ product_name: '', ocr_barcode: '', ocr_supplier: '', notes: '' });
  const matchedCount = useMemo(() => scanList.filter((item) => item.is_matched).length, [scanList]);
  const unmatchedCount = useMemo(() => scanList.filter((item) => !item.is_matched).length, [scanList]);

  const loadScans = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase.from('acquisition_scans').select('*').eq('scan_date', scanDate).order('scanned_at', { ascending: false });
    if (!error) setScanList((data as ScanRow[]) || []);
    setLoadingList(false);
  }, [scanDate, supabase]);

  useEffect(() => {
    loadScans();
  }, [loadScans, refreshKey]);

  useEffect(() => {
    barcodeInputRef.current?.focus();
    return () => stopCamera(streamRef, setCameraActive);
  }, []);

  const openModal = (barcode: string) => {
    setModalBarcode(barcode);
    setCapturedPhotos([]);
    setDraft({ product_name: '', ocr_barcode: barcode, ocr_supplier: '', notes: '' });
    setShowModal(true);
  };

  const closeModal = () => {
    stopCamera(streamRef, setCameraActive);
    setShowModal(false);
  };

  const handleScan = async () => {
    const barcode = normalizeBarcode(barcodeValue);
    if (!barcode || scanning) return;
    setScanning(true);
    setBarcodeValue('');
    setLastResult(null);

    const candidates = buildBarcodeCandidates(barcode);
    let matchedRows: { product_code: string; product_name: string; unit: string }[] = [];

    const { data: candidateRows } = await supabase
      .from('product_barcodes')
      .select('barcode, product_code, products_master!inner(product_name, unit)')
      .in('barcode', candidates)
      .limit(50);

    if (candidateRows && candidateRows.length > 0) {
      const exactRows = candidateRows.filter((row: any) => normalizeBarcode(row.barcode) === barcode);
      const source = exactRows.length > 0 ? exactRows : candidateRows;
      matchedRows = source.map((row: any) => {
        const joined = Array.isArray(row.products_master) ? row.products_master[0] : row.products_master;
        return { product_code: row.product_code, product_name: joined?.product_name || '', unit: joined?.unit || '' };
      });
    }

    // 相容舊資料：若 DB 曾存入帶符號或格式不一致條碼，做一次模糊抓取再本地正規化比對
    if (matchedRows.length === 0) {
      const digitsOnly = barcode.replace(/\D/g, '');
      if (digitsOnly) {
        const { data: fuzzyRows } = await supabase
          .from('product_barcodes')
          .select('barcode, product_code, products_master!inner(product_name, unit)')
          .ilike('barcode', `%${digitsOnly}%`)
          .limit(30);
        if (fuzzyRows && fuzzyRows.length > 0) {
          const exact = fuzzyRows.filter((row: any) => normalizeBarcode(row.barcode) === barcode);
          const source = exact.length > 0 ? exact : fuzzyRows;
          matchedRows = source.map((row: any) => {
            const joined = Array.isArray(row.products_master) ? row.products_master[0] : row.products_master;
            return { product_code: row.product_code, product_name: joined?.product_name || '', unit: joined?.unit || '' };
          });
        }
      }
    }

    // 命中多品號 → 顯示選擇視窗（模擬 POS 行為）
    if (matchedRows.length > 1) {
      setPendingBarcode(barcode);
      setMultiMatches(matchedRows);
      setShowMultiSelect(true);
      setScanning(false);
      barcodeInputRef.current?.focus();
      return;
    }

    let product: { product_code: string; product_name: string; unit: string | null } | null =
      matchedRows.length === 1 ? matchedRows[0] : null;

    if (!product) {
      const { data: direct } = await supabase
        .from('products_master')
        .select('product_code, product_name, unit')
        .eq('product_code', barcode)
        .maybeSingle();
      if (direct) {
        product = {
          product_code: (direct as any).product_code,
          product_name: (direct as any).product_name,
          unit: (direct as any).unit,
        };
      }
    }

    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    if (product) {
      const { data } = await supabase
        .from('acquisition_scans')
        .insert({
          scan_date: scanDate,
          barcode,
          product_code: product.product_code,
          product_name: product.product_name,
          unit: product.unit,
          is_matched: true,
          created_by: user?.id,
        })
        .select()
        .single();
      if (data) setScanList((current) => [data as ScanRow, ...current]);
      setLastResult({ matched: true, message: `${product.product_code} · ${product.product_name}` });
    } else {
      const { data } = await supabase
        .from('acquisition_scans')
        .insert({
          scan_date: scanDate,
          barcode,
          is_matched: false,
          created_by: user?.id,
        })
        .select()
        .single();
      if (data) setScanList((current) => [data as ScanRow, ...current]);
      setLastResult({ matched: false, message: `條碼 ${barcode} 在主檔中查無資料` });
      openModal(barcode);
    }

    setScanning(false);
    barcodeInputRef.current?.focus();
    onSaved();
  };

  const clearToday = async () => {
    if (!confirm(`確定要清除 ${scanDate} 的所有掃描紀錄嗎？`)) return;
    await supabase.from('acquisition_scans').delete().eq('scan_date', scanDate);
    setScanList([]);
    onSaved();
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;
    context.drawImage(videoRef.current, 0, 0);
    const photo = await compressImage(canvasRef.current.toDataURL('image/jpeg', 0.9));
    setCapturedPhotos((current) => [...current, photo]);
  };

  const saveUnmatched = async () => {
    setSavingUnmatched(true);
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    const { error } = await supabase.from('acquisition_unmatched').insert({
      scan_date: scanDate,
      barcode: modalBarcode,
      ocr_product_name: draft.product_name || null,
      ocr_barcode: draft.ocr_barcode || null,
      ocr_supplier: draft.ocr_supplier || null,
      photos: capturedPhotos,
      notes: draft.notes || null,
      created_by: user?.id,
    });

    setSavingUnmatched(false);
    if (error) {
      alert(`儲存失敗：${error.message}`);
      return;
    }

    closeModal();
    onSaved();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">併購藥局商品掃描</h3>
          <p className="text-sm text-gray-500 mt-1">掃描條碼比對主檔，未比對到可拍照後建立待處理資料</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={scanDate} onChange={(e) => setScanDate(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
          <span className="text-xs text-gray-400">掃描日期</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <label className="block text-sm font-semibold text-gray-900 mb-3">掃描條碼</label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              ref={barcodeInputRef}
              value={barcodeValue}
              onChange={(e) => setBarcodeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan();
                if (e.key === 'Escape') setBarcodeValue('');
              }}
              placeholder="請掃描或輸入條碼，按 Enter 查詢..."
              className="w-full px-4 pr-11 py-3 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            {scanning && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-teal-600 animate-spin" />}
          </div>
          <button onClick={handleScan} disabled={!barcodeValue.trim() || scanning} className="px-5 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
            查詢
          </button>
        </div>

        {lastResult && (
          <div className={`mt-3 flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${lastResult.matched ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {lastResult.matched ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span>{lastResult.message}</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold text-gray-900">今日掃描清單</div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{scanList.length} 筆</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>比對成功 {matchedCount} 筆 · 未建立 {unmatchedCount} 筆</span>
            {scanList.length > 0 && <button onClick={clearToday} className="hover:text-red-500">清除今日紀錄</button>}
          </div>
        </div>

        {loadingList ? (
          <div className="p-10 text-center text-gray-400">載入中...</div>
        ) : scanList.length === 0 ? (
          <div className="p-10 text-center text-gray-400">尚無掃描紀錄</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {scanList.map((item, index) => (
              <div key={item.id} className="px-5 py-3 flex items-center gap-4 text-sm hover:bg-gray-50">
                <span className="text-xs text-gray-400 w-6 text-right">{index + 1}</span>
                <span className={`w-2.5 h-2.5 rounded-full ${item.is_matched ? 'bg-teal-500' : 'bg-red-400'}`} />
                <span className="font-mono text-xs text-gray-500 w-40 truncate">{item.barcode}</span>
                <span className="flex-1 text-gray-900 truncate">{item.product_name || '— 未建立商品 —'}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${item.is_matched ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                  {item.is_matched ? '已比對' : '未建立'}
                </span>
                <span className="hidden md:inline text-xs text-gray-400">{formatTime(item.scanned_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 多品號選擇視窗（模擬 POS 行為） */}
      {showMultiSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="font-semibold text-gray-900">請選擇正確品號</div>
              <div className="text-xs text-gray-500 mt-1">
                條碼 <span className="font-mono text-teal-700">{pendingBarcode}</span> 對應到多個品號
              </div>
            </div>
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {multiMatches.map((item) => (
                <button
                  key={item.product_code}
                  onClick={async () => {
                    setShowMultiSelect(false);
                    setScanning(true);
                    const { data: authData } = await supabase.auth.getUser();
                    const user = authData.user;
                    const { data } = await supabase
                      .from('acquisition_scans')
                      .insert({
                        scan_date: scanDate,
                        barcode: pendingBarcode,
                        product_code: item.product_code,
                        product_name: item.product_name,
                        unit: item.unit,
                        is_matched: true,
                        created_by: user?.id,
                      })
                      .select()
                      .single();
                    if (data) setScanList((current) => [data as ScanRow, ...current]);
                    setLastResult({ matched: true, message: `${item.product_code} · ${item.product_name}` });
                    setScanning(false);
                    barcodeInputRef.current?.focus();
                    onSaved();
                  }}
                  className="w-full px-5 py-3 text-left hover:bg-teal-50 transition-colors"
                >
                  <div className="font-mono text-xs text-gray-500">{item.product_code}</div>
                  <div className="text-sm font-medium text-gray-900 mt-0.5">{item.product_name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{item.unit}</div>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <button
                onClick={() => setShowMultiSelect(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}>
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">未找到商品</div>
                <div className="text-xs text-gray-500 mt-1">條碼：<span className="font-mono">{modalBarcode}</span></div>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-900">商品拍照</div>
                  <div className="flex gap-2">
                    <button onClick={() => startCamera(videoRef, streamRef, setCameraActive)} disabled={cameraActive} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" />啟動相機
                    </button>
                    <label className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 cursor-pointer">
                      <ImageIcon className="w-3.5 h-3.5" />上傳圖片
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImageUpload(e, setCapturedPhotos)} />
                    </label>
                  </div>
                </div>

                {cameraActive && (
                  <div className="relative rounded-xl overflow-hidden bg-black mb-3">
                    <video ref={videoRef} autoPlay playsInline className="w-full max-h-56 object-cover" />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 flex justify-center gap-3">
                      <button onClick={capturePhoto} className="px-5 py-2 rounded-xl bg-white text-gray-900 text-sm font-semibold">拍照</button>
                      <button onClick={() => stopCamera(streamRef, setCameraActive)} className="px-5 py-2 rounded-xl bg-black/60 text-white text-sm">關閉相機</button>
                    </div>
                  </div>
                )}

                {capturedPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {capturedPhotos.map((photo, index) => (
                      <div key={`${photo.slice(0, 24)}-${index}`} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200">
                        <img src={photo} className="w-full h-full object-cover" />
                        <button onClick={() => setCapturedPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="font-semibold text-gray-900">商品資訊</div>
                <Field label="商品名稱">
                  <input value={draft.product_name} onChange={(e) => setDraft((current) => ({ ...current, product_name: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" />
                </Field>
                <Field label="商品條碼">
                  <input value={draft.ocr_barcode} onChange={(e) => setDraft((current) => ({ ...current, ocr_barcode: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono" />
                </Field>
                <Field label="供應商資訊">
                  <input value={draft.ocr_supplier} onChange={(e) => setDraft((current) => ({ ...current, ocr_supplier: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" />
                </Field>
                <Field label="備註">
                  <textarea value={draft.notes} onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))} rows={3} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none" />
                </Field>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">取消</button>
              <button onClick={saveUnmatched} disabled={savingUnmatched} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                {savingUnmatched ? '儲存中...' : '儲存待建立商品'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AcquisitionUnmatched({ onChanged, refreshKey }: { onChanged: () => void; refreshKey: number }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [items, setItems] = useState<UnmatchedRow[]>([]);
  const [photoModal, setPhotoModal] = useState<{ open: boolean; photos: string[] }>({ open: false, photos: [] });
  const [editing, setEditing] = useState<UnmatchedRow | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('acquisition_unmatched')
      .select('*')
      .order('scan_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (queryError) {
      setError(queryError.message);
    } else {
      setItems(((data || []) as any[]).map((item) => ({ ...item, photos: Array.isArray(item.photos) ? item.photos : [] })));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filteredItems = useMemo(() => showResolved ? items : items.filter((item) => !item.is_resolved), [items, showResolved]);
  const totalUnresolved = useMemo(() => items.filter((item) => !item.is_resolved).length, [items]);
  const totalResolved = useMemo(() => items.filter((item) => item.is_resolved).length, [items]);

  const groups = useMemo(() => {
    const map = new Map<string, UnmatchedRow[]>();
    filteredItems.forEach((item) => {
      const list = map.get(item.scan_date) || [];
      list.push(item);
      map.set(item.scan_date, list);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, rows]) => ({
        date,
        rows,
        unresolvedCount: rows.filter((item) => !item.is_resolved).length,
      }));
  }, [filteredItems]);

  const toggleResolved = async (item: UnmatchedRow) => {
    const { error } = await supabase.from('acquisition_unmatched').update({ is_resolved: !item.is_resolved }).eq('id', item.id);
    if (!error) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_resolved: !row.is_resolved } : row));
      onChanged();
    }
  };

  const deleteItem = async (item: UnmatchedRow) => {
    if (!confirm('確定要刪除這筆紀錄嗎？')) return;
    const { error } = await supabase.from('acquisition_unmatched').delete().eq('id', item.id);
    if (!error) {
      setItems((current) => current.filter((row) => row.id !== item.id));
      onChanged();
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    const payload = {
      ocr_product_name: editing.ocr_product_name || null,
      ocr_barcode: editing.ocr_barcode || null,
      ocr_supplier: editing.ocr_supplier || null,
      notes: editing.notes || null,
    };
    const { error } = await supabase.from('acquisition_unmatched').update(payload).eq('id', editing.id);
    setSavingEdit(false);
    if (!error) {
      setItems((current) => current.map((row) => row.id === editing.id ? { ...row, ...payload } : row));
      setEditing(null);
      onChanged();
    }
  };

  const exportRows = (rows: UnmatchedRow[], filename: string) => {
    if (rows.length === 0) {
      alert('沒有資料可以匯出');
      return;
    }
    const sheet = XLSX.utils.json_to_sheet(rows.map((item) => ({
      掃描日期: item.scan_date,
      掃描條碼: item.barcode || '',
      商品名稱_OCR: item.ocr_product_name || '',
      商品條碼_OCR: item.ocr_barcode || '',
      供應商資訊: item.ocr_supplier || '',
      備註: item.notes || '',
      照片數量: (item.photos || []).length,
      狀態: item.is_resolved ? '已建立' : '未建立',
      建立時間: item.created_at ? new Date(item.created_at).toLocaleString('zh-TW') : '',
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '未建立商品');
    XLSX.writeFile(workbook, filename);
  };

  if (error) {
    return <TableMissingState message={error} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">未建立商品管理</h3>
          <p className="text-sm text-gray-500 mt-1">依掃描日期整理未比對商品，支援查看、編輯、標記與匯出</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 flex items-center gap-2">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            顯示已建立
          </label>
          <button onClick={() => exportRows(filteredItems, `未建立商品_全部_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')}.xlsx`)} className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold inline-flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />匯出全部 Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SimpleStatCard label="待建立商品" value={totalUnresolved} tone="text-red-600" />
        <SimpleStatCard label="已建立商品" value={totalResolved} tone="text-teal-600" />
        <SimpleStatCard label="掃描日期數" value={groups.length} tone="text-amber-600" />
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">載入中...</div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400">尚無未建立商品紀錄</div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <details key={group.date} open className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <summary className="px-5 py-4 border-b border-gray-100 flex items-center justify-between cursor-pointer list-none">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900">{group.date}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{group.rows.length} 筆</span>
                  {group.unresolvedCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">{group.unresolvedCount} 筆待建立</span>}
                </div>
                <button onClick={(e) => {
                  e.preventDefault();
                  exportRows(group.rows, `未建立商品_${group.date}.xlsx`);
                }} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5" />匯出 Excel
                </button>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="px-4 py-3 text-left">掃描條碼</th>
                      <th className="px-4 py-3 text-left">商品名稱(OCR)</th>
                      <th className="px-4 py-3 text-left">商品條碼(OCR)</th>
                      <th className="px-4 py-3 text-left">供應商</th>
                      <th className="px-4 py-3 text-left">照片</th>
                      <th className="px-4 py-3 text-left">狀態</th>
                      <th className="px-4 py-3 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {group.rows.map((item) => (
                      <tr key={item.id} className={item.is_resolved ? 'opacity-60' : ''}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.barcode || '—'}</td>
                        <td className="px-4 py-3 text-gray-900">{item.ocr_product_name || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.ocr_barcode || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{item.ocr_supplier || '—'}</td>
                        <td className="px-4 py-3">
                          {(item.photos || []).length > 0 ? (
                            <button onClick={() => setPhotoModal({ open: true, photos: item.photos || [] })} className="text-xs text-teal-600 hover:underline inline-flex items-center gap-1">
                              <ImageIcon className="w-3.5 h-3.5" />{(item.photos || []).length} 張
                            </button>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${item.is_resolved ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'}`}>
                            {item.is_resolved ? '已建立' : '未建立'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 text-xs">
                            <button onClick={() => setEditing({ ...item })} className="text-gray-500 hover:text-teal-600">編輯</button>
                            <button onClick={() => toggleResolved(item)} className="text-gray-500 hover:text-teal-600">{item.is_resolved ? '改未建立' : '標記已建立'}</button>
                            <button onClick={() => deleteItem(item)} className="text-gray-500 hover:text-red-600">刪除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}

      {photoModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setPhotoModal({ open: false, photos: [] });
        }}>
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-semibold text-gray-900">商品照片 ({photoModal.photos.length} 張)</div>
              <button onClick={() => setPhotoModal({ open: false, photos: [] })} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[70vh] overflow-y-auto">
              {photoModal.photos.map((photo, index) => <img key={`${photo.slice(0, 32)}-${index}`} src={photo} className="w-full aspect-square object-cover rounded-xl border border-gray-200" />)}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setEditing(null);
        }}>
          <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="font-semibold text-gray-900">編輯商品資訊</div>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <Field label="商品名稱">
                <input value={editing.ocr_product_name || ''} onChange={(e) => setEditing((current) => current ? { ...current, ocr_product_name: e.target.value } : current)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" />
              </Field>
              <Field label="商品條碼(OCR)">
                <input value={editing.ocr_barcode || ''} onChange={(e) => setEditing((current) => current ? { ...current, ocr_barcode: e.target.value } : current)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono" />
              </Field>
              <Field label="供應商資訊">
                <input value={editing.ocr_supplier || ''} onChange={(e) => setEditing((current) => current ? { ...current, ocr_supplier: e.target.value } : current)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm" />
              </Field>
              <Field label="備註">
                <textarea value={editing.notes || ''} onChange={(e) => setEditing((current) => current ? { ...current, notes: e.target.value } : current)} rows={3} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none" />
              </Field>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600">取消</button>
              <button onClick={saveEdit} disabled={savingEdit} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-semibold disabled:opacity-50">{savingEdit ? '儲存中...' : '儲存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableMissingState({ message }: { message: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
      <div className="font-semibold mb-2">併購藥局商品主檔整理資料表尚未可用</div>
      <div>{message}</div>
      <div className="mt-2 text-xs text-amber-700">請先執行主專案新增的 migration：`supabase/migration_acquisition_products_system.sql`</div>
    </div>
  );
}

function SimpleStatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 text-center">
      <div className={`text-3xl font-bold ${tone}`}>{value.toLocaleString('zh-TW')}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

async function compressImage(dataUrl: string, maxWidth = 900): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = dataUrl;
    image.onload = () => {
      const ratio = Math.min(maxWidth / image.width, 1);
      const canvas = document.createElement('canvas');
      canvas.width = image.width * ratio;
      canvas.height = image.height * ratio;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
  });
}

async function startCamera(
  videoRef: React.RefObject<HTMLVideoElement>,
  streamRef: React.MutableRefObject<MediaStream | null>,
  setCameraActive: (active: boolean) => void,
) {
  try {
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      setCameraActive(true);
    }
  } catch {
    alert('無法啟動相機，請確認瀏覽器權限，或改用圖片上傳');
  }
}

function stopCamera(
  streamRef: React.MutableRefObject<MediaStream | null>,
  setCameraActive: (active: boolean) => void,
) {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  setCameraActive(false);
}

function handleImageUpload(
  event: React.ChangeEvent<HTMLInputElement>,
  setCapturedPhotos: React.Dispatch<React.SetStateAction<string[]>>,
) {
  const files = Array.from(event.target.files || []);
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const image = await compressImage(String(loadEvent.target?.result || ''));
      setCapturedPhotos((current) => [...current, image]);
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function formatTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}