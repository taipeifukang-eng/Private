'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Lock,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
  X,
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
  item_count: number;
  total_qty: number;
  total_billing_amount: number;
  total_gross_profit_amount: number;
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

type MappingRow = {
  health_insurance_code: string;
  drug_name: string;
  product_code: string;
  product_name: string;
  latest_year_month: string;
};

type MappingMeta = {
  yearMonth: string;
  isClosed: boolean;
};

type PriceHistoryRow = {
  year_month: string;
  health_insurance_code: string;
  product_code: string;
  product_name: string;
  member_price: number;
  cost_price: number;
  source_file_name: string | null;
  updated_at: string;
};

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function money(v: number) {
  return Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ClinicSelfpayMarginPage() {
  const [activeTab, setActiveTab] = useState<'calculator' | 'mapping'>('calculator');
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

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [mappingMessage, setMappingMessage] = useState('');
  const [mappingMeta, setMappingMeta] = useState<MappingMeta>({ yearMonth: '', isClosed: false });
  const [closingMappings, setClosingMappings] = useState(false);

  const [historyTarget, setHistoryTarget] = useState<MappingRow | null>(null);
  const [historyRows, setHistoryRows] = useState<PriceHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
  }, [selectedStoreId]);

  useEffect(() => {
    if (selectedStoreId && yearMonth) {
      loadMappings();
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
      const url = `/api/clinic-selfpay/batches?store_id=${encodeURIComponent(selectedStoreId)}`;
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

  async function loadMappings() {
    if (!selectedStoreId) return;
    setLoadingMappings(true);
    setMappingMessage('');
    try {
      const res = await fetch(`/api/clinic-selfpay/mappings?store_id=${encodeURIComponent(selectedStoreId)}&year_month=${encodeURIComponent(yearMonth)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入對應主檔失敗');
      setMappings((json.data || []) as MappingRow[]);
      setMappingMeta({
        yearMonth: String(json.meta?.yearMonth || yearMonth),
        isClosed: Boolean(json.meta?.isClosed),
      });
    } catch (error: any) {
      setMappingMessage(`載入對應主檔失敗：${error.message}`);
      setMappingMeta({ yearMonth, isClosed: false });
    } finally {
      setLoadingMappings(false);
    }
  }

  async function closeMappingsForMonth() {
    if (!selectedStoreId || !yearMonth) return;
    const confirmed = window.confirm(
      mappingMeta.isClosed
        ? `確認將 ${yearMonth} 的 DPOS 對應主檔開帳？開帳後可再次匯入同年月分頁覆蓋資料。`
        : `確認將 ${yearMonth} 的 DPOS 對應主檔關帳？關帳後再次匯入同年月分頁將不會覆蓋。`
    );
    if (!confirmed) return;

    setClosingMappings(true);
    setMappingMessage('');
    try {
      const res = await fetch('/api/clinic-selfpay/mappings/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: selectedStoreId, year_month: yearMonth }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '關帳失敗');
      setMappingMessage(
        json.action === 'reopened'
          ? `✅ ${yearMonth} 主檔已開帳`
          : `✅ ${yearMonth} 主檔已關帳`
      );
      await loadMappings();
    } catch (error: any) {
      setMappingMessage(`❌ 主檔狀態更新失敗：${error.message}`);
    } finally {
      setClosingMappings(false);
    }
  }

  async function openHistory(row: MappingRow) {
    setHistoryTarget(row);
    setLoadingHistory(true);
    setHistoryRows([]);
    try {
      const url = `/api/clinic-selfpay/mappings/history?store_id=${encodeURIComponent(selectedStoreId)}&health_insurance_code=${encodeURIComponent(row.health_insurance_code)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入歷史價格失敗');
      setHistoryRows((json.data || []) as PriceHistoryRow[]);
    } catch (error: any) {
      setMappingMessage(`載入歷史價格失敗：${error.message}`);
    } finally {
      setLoadingHistory(false);
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

      const importedMonths = Array.isArray(json.importedMonths) ? json.importedMonths.join('、') : yearMonth;
      const skippedClosedMonths = Array.isArray(json.skippedClosedMonths) && json.skippedClosedMonths.length > 0
        ? `；已略過關帳月份：${json.skippedClosedMonths.join('、')}`
        : '';
      setPriceMessage(`✅ 月價匯入成功：${json.imported} 筆，匯入月份：${importedMonths}${skippedClosedMonths}`);
      await loadMappings();
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
              <p className="text-sm text-gray-600">毛利計算頁僅匯入診所自費藥檔；DPOS 月價格檔請至「DPOS 對應主檔」TAB 匯入</p>
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
              <label className="mb-1 block text-xs font-semibold text-gray-600">年月（DPOS 月價格版本）</label>
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
                  loadMappings();
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

          <div className="mt-4 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              onClick={() => setActiveTab('calculator')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'calculator' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              毛利計算
            </button>
            <button
              onClick={() => setActiveTab('mapping')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'mapping' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              DPOS 對應主檔
            </button>
          </div>
        </div>

        {activeTab === 'calculator' && (
          <>

        <div className="grid grid-cols-1 gap-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-gray-900">步驟 1：匯入診所自費藥檔</h2>
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
              disabled={batchUploading || !claimFile || !selectedStoreId}
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
            <h3 className="mb-3 text-sm font-bold text-gray-900">歷史匯入紀錄（依門市）</h3>
            {loadingBatches ? (
              <p className="text-sm text-gray-500">載入中...</p>
            ) : recentBatches.length === 0 ? (
              <p className="text-sm text-gray-500">目前門市尚無匯入紀錄</p>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-2 py-2 text-left">診所機構代碼</th>
                      <th className="px-2 py-2 text-left">月份</th>
                      <th className="px-2 py-2 text-right">自費藥總額</th>
                      <th className="px-2 py-2 text-right">毛利總額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBatches.map((batch) => (
                      <tr
                        key={batch.id}
                        onClick={() => loadReport(batch.id)}
                        className="cursor-pointer odd:bg-white even:bg-gray-50 hover:bg-blue-50"
                      >
                        <td className="px-2 py-1.5 font-mono">{batch.clinic_code || '-'}</td>
                        <td className="px-2 py-1.5">{batch.year_month}</td>
                        <td className="px-2 py-1.5 text-right">{money(batch.total_billing_amount || 0)}</td>
                        <td className="px-2 py-1.5 text-right">{money(batch.total_gross_profit_amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

          </>
        )}

        {activeTab === 'mapping' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">診所自費藥與 DPOS 商品對應主檔</h3>
              {loadingMappings && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
            </div>

            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <h4 className="text-sm font-bold text-indigo-900">匯入月價格檔（DPOS）</h4>
              <p className="mt-1 text-xs text-indigo-800">
                欄位格式：健保碼｜自費藥名稱｜品號｜品名｜會員價｜成本。系統會讀取分頁名稱 YYYY-MM 作為匯入月份，並使用品號/品名/會員價/成本做計算。
              </p>

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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  disabled={priceUploading || !selectedStoreId || !yearMonth}
                  onClick={() => priceInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {priceUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {priceUploading ? '匯入中...' : '選擇月價格 Excel'}
                </button>
                <span className="text-xs text-indigo-800">目前檢視月份：{yearMonth}</span>
              </div>

              {priceMessage && (
                <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-gray-700">{priceMessage}</p>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-600">欄位：DPOS 品號、DPOS 品名、診所藥品健保碼、診所開立藥品名稱。點擊列可看歷史會員價/成本。</p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mappingMeta.isClosed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {mappingMeta.isClosed ? `${yearMonth} 已關帳` : `${yearMonth} 未關帳`}
                </span>
                <button
                  onClick={closeMappingsForMonth}
                  disabled={closingMappings || !selectedStoreId || !yearMonth || mappings.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closingMappings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                  {closingMappings ? '處理中...' : mappingMeta.isClosed ? '開帳主檔' : '關帳主檔'}
                </button>
              </div>
            </div>

            {mappingMessage && (
              <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{mappingMessage}</p>
            )}

            {loadingMappings ? (
              <p className="text-sm text-gray-500">載入中...</p>
            ) : mappings.length === 0 ? (
              <p className="text-sm text-gray-500">目前門市尚無對應主檔資料，請先匯入月價格檔。</p>
            ) : (
              <div className="max-h-[620px] overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-2 py-2 text-left">DPOS品號</th>
                      <th className="px-2 py-2 text-left">DPOS品名</th>
                      <th className="px-2 py-2 text-left">診所藥品健保碼</th>
                      <th className="px-2 py-2 text-left">診所開立藥品名稱</th>
                      <th className="px-2 py-2 text-left">主檔月份</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((row) => (
                      <tr
                        key={`${row.health_insurance_code}-${row.product_code}`}
                        onClick={() => openHistory(row)}
                        className="cursor-pointer odd:bg-white even:bg-gray-50 hover:bg-blue-50"
                      >
                        <td className="px-2 py-1.5 font-mono">{row.product_code || '-'}</td>
                        <td className="px-2 py-1.5">{row.product_name || '-'}</td>
                        <td className="px-2 py-1.5 font-mono">{row.health_insurance_code}</td>
                        <td className="px-2 py-1.5">{row.drug_name || '-'}</td>
                        <td className="px-2 py-1.5">{row.latest_year_month || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {historyTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                <div>
                  <h4 className="text-base font-bold text-gray-900">歷史會員價與成本</h4>
                  <p className="text-xs text-gray-600">
                    診所藥品健保碼：{historyTarget.health_insurance_code}｜診所開立藥品名稱：{historyTarget.drug_name || '-'}
                  </p>
                </div>
                <button
                  onClick={() => setHistoryTarget(null)}
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5">
                {loadingHistory ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />載入中...
                  </div>
                ) : historyRows.length === 0 ? (
                  <p className="text-sm text-gray-500">尚無歷史資料。</p>
                ) : (
                  <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-gray-100 text-gray-700">
                        <tr>
                          <th className="px-2 py-2 text-left">月份</th>
                          <th className="px-2 py-2 text-left">DPOS品號</th>
                          <th className="px-2 py-2 text-left">DPOS品名</th>
                          <th className="px-2 py-2 text-right">會員價</th>
                          <th className="px-2 py-2 text-right">成本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historyRows.map((row, idx) => (
                          <tr key={`${row.year_month}-${idx}`} className="odd:bg-white even:bg-gray-50">
                            <td className="px-2 py-1.5">{row.year_month}</td>
                            <td className="px-2 py-1.5 font-mono">{row.product_code || '-'}</td>
                            <td className="px-2 py-1.5">{row.product_name || '-'}</td>
                            <td className="px-2 py-1.5 text-right">{money(row.member_price)}</td>
                            <td className="px-2 py-1.5 text-right">{money(row.cost_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
