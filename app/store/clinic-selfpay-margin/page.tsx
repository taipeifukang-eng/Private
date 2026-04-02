'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
};

type BatchSummary = {
  id: string;
  store_id: string;
  store_code: string;
  store_name: string;
  year_month: string;
  clinic_code: string | null;
  clinic_name: string | null;
  period_start: string | null;
  period_end: string | null;
  imported_at: string;
};

type ReportItem = {
  id: string;
  line_no: number | null;
  health_insurance_code: string;
  drug_name: string | null;
  qty: number;
  matched_product_code: string | null;
  matched_member_price: number | null;
  matched_cost_price: number | null;
  billing_amount: number;
  gross_profit_amount: number;
  match_status: 'matched' | 'unmatched';
};

type ReportPayload = {
  batch: any;
  items: ReportItem[];
  summary: {
    itemCount: number;
    matchedCount: number;
    unmatchedCount: number;
    totalQty: number;
    totalBilling: number;
    totalGrossProfit: number;
  };
};

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function money(v: number) {
  return Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ClinicSelfpayMarginPage() {
  const [loadingStores, setLoadingStores] = useState(true);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());

  const [priceUploading, setPriceUploading] = useState(false);
  const [priceMessage, setPriceMessage] = useState<string>('');

  const [batchUploading, setBatchUploading] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string>('');

  const [recentBatches, setRecentBatches] = useState<BatchSummary[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const priceInputRef = useRef<HTMLInputElement>(null);
  const claimInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  const [claimFile, setClaimFile] = useState<File | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);

  const selectedStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) || null,
    [stores, selectedStoreId]
  );

  useEffect(() => {
    loadStores();
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      loadRecentBatches();
    }
  }, [selectedStoreId, yearMonth]);

  async function loadStores() {
    setLoadingStores(true);
    try {
      const res = await fetch('/api/clinic-selfpay/stores');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入門市失敗');
      const data = (json.data || []) as StoreOption[];
      setStores(data);
      if (data.length > 0) {
        setSelectedStoreId((prev) => prev || data[0].id);
      }
    } catch (error: any) {
      setPriceMessage(`載入門市失敗：${error.message}`);
    } finally {
      setLoadingStores(false);
    }
  }

  async function loadRecentBatches() {
    if (!selectedStoreId) return;
    setLoadingBatches(true);
    try {
      const url = `/api/clinic-selfpay/batches?store_id=${encodeURIComponent(selectedStoreId)}&year_month=${encodeURIComponent(yearMonth)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入批次失敗');
      setRecentBatches((json.data || []) as BatchSummary[]);
    } catch (error: any) {
      setBatchMessage(`載入最近批次失敗：${error.message}`);
    } finally {
      setLoadingBatches(false);
    }
  }

  async function handleImportPriceFile(file: File) {
    if (!selectedStoreId) return;
    setPriceUploading(true);
    setPriceMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('store_id', selectedStoreId);
      form.append('year_month', yearMonth);

      const res = await fetch('/api/clinic-selfpay/prices/import', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '匯入失敗');

      setPriceMessage(`✅ 月價匯入成功：${json.imported} 筆`);
    } catch (error: any) {
      setPriceMessage(`❌ 月價匯入失敗：${error.message}`);
    } finally {
      setPriceUploading(false);
      if (priceInputRef.current) priceInputRef.current.value = '';
    }
  }

  async function handleImportClaimBatch() {
    if (!selectedStoreId || !claimFile) {
      setBatchMessage('請先選擇診所自費藥檔案');
      return;
    }

    setBatchUploading(true);
    setBatchMessage('');
    try {
      const form = new FormData();
      form.append('file', claimFile);
      form.append('store_id', selectedStoreId);
      form.append('year_month', yearMonth);
      if (screenshotFile) form.append('screenshot', screenshotFile);

      const res = await fetch('/api/clinic-selfpay/batches/import', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '匯入失敗');

      setBatchMessage(
        `✅ 匯入成功：共 ${json.summary.itemCount} 筆，匹配 ${json.summary.matchedCount} 筆，未匹配 ${json.summary.unmatchedCount} 筆`
      );

      await loadRecentBatches();
      await loadReport(json.batchId);
      setClaimFile(null);
      setScreenshotFile(null);
      if (claimInputRef.current) claimInputRef.current.value = '';
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    } catch (error: any) {
      setBatchMessage(`❌ 匯入失敗：${error.message}`);
    } finally {
      setBatchUploading(false);
    }
  }

  async function loadReport(batchId: string) {
    setLoadingReport(true);
    try {
      const res = await fetch(`/api/clinic-selfpay/batches/${batchId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入報表失敗');
      setReport(json as ReportPayload);
    } catch (error: any) {
      setBatchMessage(`載入明細失敗：${error.message}`);
    } finally {
      setLoadingReport(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Calculator className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">診所自費藥毛利計算</h1>
              <p className="text-sm text-gray-600">匯入每月 DPOS 成本/會員價與診所自費藥檔，自動計算總額與毛利</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">門市</label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                disabled={loadingStores}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_code} {s.store_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">年月（價格版本）</label>
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  loadStores();
                  loadRecentBatches();
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4" />
                重新整理
              </button>
            </div>
          </div>
          {selectedStore && (
            <p className="mt-2 text-xs text-gray-500">目前門市：{selectedStore.store_code} {selectedStore.store_name}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-gray-900">步驟 1：匯入月價格檔（DPOS）</h2>
            <p className="mb-3 text-xs text-gray-600">Excel 欄位至少包含：健保代號、品號、會員價、成本（可加品名）。</p>

            <input
              ref={priceInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportPriceFile(file);
              }}
            />

            <button
              disabled={priceUploading || !selectedStoreId}
              onClick={() => priceInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {priceUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {priceUploading ? '匯入中...' : '選擇月價格 Excel'}
            </button>

            {priceMessage && (
              <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{priceMessage}</p>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-gray-900">步驟 2：匯入診所自費藥檔</h2>
            <p className="mb-3 text-xs text-gray-600">支援健保系統 .xls 匯出，系統會讀取 A 欄健保代碼與 K 欄數量計算毛利。</p>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600">診所自費藥檔</label>
              <input
                ref={claimInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setClaimFile(e.target.files?.[0] || null)}
              />
              <button
                onClick={() => claimInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {claimFile ? claimFile.name : '選擇診所檔案'}
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-gray-600">健保系統截圖（選填）</label>
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => setScreenshotFile(e.target.files?.[0] || null)}
              />
              <button
                onClick={() => screenshotInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                {screenshotFile ? screenshotFile.name : '上傳截圖'}
              </button>
            </div>

            <button
              disabled={batchUploading || !claimFile || !selectedStoreId || !yearMonth}
              onClick={handleImportClaimBatch}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {batchUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              {batchUploading ? '計算中...' : '匯入並計算毛利'}
            </button>

            {batchMessage && (
              <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{batchMessage}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-1">
            <h3 className="mb-3 text-sm font-bold text-gray-900">最近匯入批次</h3>
            {loadingBatches ? (
              <p className="text-sm text-gray-500">載入中...</p>
            ) : recentBatches.length === 0 ? (
              <p className="text-sm text-gray-500">本月尚無批次</p>
            ) : (
              <div className="space-y-2">
                {recentBatches.map((batch) => (
                  <button
                    key={batch.id}
                    onClick={() => loadReport(batch.id)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <div className="font-semibold text-gray-800">{batch.clinic_name || '未命名診所'}</div>
                    <div className="text-xs text-gray-500">{batch.clinic_code || '-'} ・ {batch.year_month}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">計算結果</h3>
              {loadingReport && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
            </div>

            {!report ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                匯入完成後，會在這裡顯示會員價總額、毛利總額與未匹配清單。
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-lg bg-blue-50 p-3">
                    <div className="text-xs text-blue-700">品項數</div>
                    <div className="text-lg font-bold text-blue-900">{report.summary.itemCount}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <div className="text-xs text-emerald-700">匹配成功</div>
                    <div className="text-lg font-bold text-emerald-900">{report.summary.matchedCount}</div>
                  </div>
                  <div className="rounded-lg bg-rose-50 p-3">
                    <div className="text-xs text-rose-700">未匹配</div>
                    <div className="text-lg font-bold text-rose-900">{report.summary.unmatchedCount}</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-3">
                    <div className="text-xs text-amber-700">總毛利</div>
                    <div className="text-lg font-bold text-amber-900">{money(report.summary.totalGrossProfit)}</div>
                  </div>
                </div>

                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <div>診所：{report.batch?.clinic_name || '-'}（{report.batch?.clinic_code || '-'}）</div>
                  <div>期間：{report.batch?.period_start || '-'} ~ {report.batch?.period_end || '-'}</div>
                  <div>會員價總額：{money(report.summary.totalBilling)}　/　總數量：{money(report.summary.totalQty)}</div>
                </div>

                <div className="max-h-[520px] overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-100 text-gray-700">
                      <tr>
                        <th className="px-2 py-2 text-left">健保代碼</th>
                        <th className="px-2 py-2 text-left">藥品名稱</th>
                        <th className="px-2 py-2 text-right">數量</th>
                        <th className="px-2 py-2 text-left">品號</th>
                        <th className="px-2 py-2 text-right">會員價</th>
                        <th className="px-2 py-2 text-right">成本</th>
                        <th className="px-2 py-2 text-right">總額</th>
                        <th className="px-2 py-2 text-right">毛利</th>
                        <th className="px-2 py-2 text-center">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((item) => (
                        <tr key={item.id} className={item.match_status === 'unmatched' ? 'bg-rose-50' : 'odd:bg-white even:bg-gray-50'}>
                          <td className="px-2 py-1.5 font-mono">{item.health_insurance_code}</td>
                          <td className="px-2 py-1.5">{item.drug_name || '-'}</td>
                          <td className="px-2 py-1.5 text-right">{money(Number(item.qty || 0))}</td>
                          <td className="px-2 py-1.5 font-mono">{item.matched_product_code || '-'}</td>
                          <td className="px-2 py-1.5 text-right">{item.matched_member_price == null ? '-' : money(item.matched_member_price)}</td>
                          <td className="px-2 py-1.5 text-right">{item.matched_cost_price == null ? '-' : money(item.matched_cost_price)}</td>
                          <td className="px-2 py-1.5 text-right">{money(item.billing_amount)}</td>
                          <td className="px-2 py-1.5 text-right">{money(item.gross_profit_amount)}</td>
                          <td className="px-2 py-1.5 text-center">
                            {item.match_status === 'matched' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />匹配
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">
                                <AlertCircle className="h-3 w-3" />未匹配
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
