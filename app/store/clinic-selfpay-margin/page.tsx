'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  FileText,
  Lock,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Trash2,
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
  screenshotUrls?: string[];
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

type ClinicSelfpayAccess = {
  canUseCalculator: boolean;
  canManageMapping: boolean;
  canDeleteBatch: boolean;
};

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function money(v: number) {
  return Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function money1(v: number) {
  return Math.round(Number(v || 0)).toLocaleString('zh-TW');
}

export default function ClinicSelfpayMarginPage() {
  const [activeTab, setActiveTab] = useState<'calculator' | 'mapping'>('calculator');
  const [accessLoading, setAccessLoading] = useState(true);
  const [access, setAccess] = useState<ClinicSelfpayAccess>({
    canUseCalculator: false,
    canManageMapping: false,
    canDeleteBatch: false,
  });
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
  const [exportingClaimPdf, setExportingClaimPdf] = useState(false);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState(0);

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
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [screenshotPreviewUrls, setScreenshotPreviewUrls] = useState<string[]>([]);

  const selectedStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId) || null,
    [stores, selectedStoreId]
  );

  useEffect(() => {
    loadAccess();
  }, []);

  useEffect(() => {
    loadStores();
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      loadRecentBatches();
    }
  }, [selectedStoreId]);

  useEffect(() => {
    if (selectedStoreId && yearMonth && access.canManageMapping) {
      loadMappings();
    }
  }, [selectedStoreId, yearMonth, access.canManageMapping]);

  useEffect(() => {
    if (activeTab === 'mapping' && !access.canManageMapping) {
      setActiveTab('calculator');
    }
  }, [activeTab, access.canManageMapping]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;

      const images: File[] = [];
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) {
          const ext = (file.type.split('/')[1] || 'png').toLowerCase();
          const pasted = new File([file], `clipboard_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`, { type: file.type });
          images.push(pasted);
        }
      }

      if (images.length === 0) return;
      event.preventDefault();
      setScreenshotFiles((prev) => [...prev, ...images]);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const urls = screenshotFiles.map((file) => URL.createObjectURL(file));
    setScreenshotPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [screenshotFiles]);

  async function loadAccess() {
    setAccessLoading(true);
    try {
      const res = await fetch('/api/clinic-selfpay/permissions');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入權限失敗');
      setAccess(json.data as ClinicSelfpayAccess);
    } catch (error: any) {
      setBatchMessage(`載入權限失敗：${error.message}`);
    } finally {
      setAccessLoading(false);
    }
  }

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
    if (!selectedStoreId || !access.canManageMapping) return;
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
    if (!selectedStoreId || !access.canManageMapping) return;
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
    if (!access.canUseCalculator) {
      setBatchMessage('目前帳號無毛利計算操作權限');
      return;
    }

    if (!selectedStoreId || !claimFile) {
      setBatchMessage('請先選擇診所自費藥檔案');
      return;
    }
    if (screenshotFiles.length === 0) {
      setBatchMessage('請至少上傳 1 張健保系統截圖（可多檔或 Ctrl+V 貼上）');
      return;
    }

    setBatchUploading(true);
    setBatchMessage('');
    try {
      const form = new FormData();
      form.append('file', claimFile);
      form.append('store_id', selectedStoreId);
      form.append('year_month', yearMonth);
      screenshotFiles.forEach((f) => form.append('screenshots', f));

      const res = await fetch('/api/clinic-selfpay/batches/import', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!json.success) {
        console.error('[clinic-selfpay] 診所檔匯入失敗', {
          status: res.status,
          response: json,
        });
        throw new Error(json.error || '匯入失敗');
      }

      setBatchMessage(
        `✅ 匯入成功：共 ${json.summary.itemCount} 筆，匹配 ${json.summary.matchedCount} 筆，未匹配 ${json.summary.unmatchedCount} 筆`
      );

      await loadRecentBatches();
      await loadReport(json.batchId);
      setClaimFile(null);
      setScreenshotFiles([]);
      if (claimInputRef.current) claimInputRef.current.value = '';
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    } catch (error: any) {
      console.error('[clinic-selfpay] 匯入請求例外', error);
      setBatchMessage(`❌ 匯入失敗：${error.message}`);
    } finally {
      setBatchUploading(false);
    }
  }

  async function loadReport(batchId: string) {
    if (!access.canUseCalculator) return;
    setLoadingReport(true);
    try {
      const res = await fetch(`/api/clinic-selfpay/batches/${batchId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '載入報表失敗');
      setReport(json as ReportPayload);
      setShowScreenshotModal(false);
      setActiveScreenshotIndex(0);
    } catch (error: any) {
      setBatchMessage(`載入明細失敗：${error.message}`);
    } finally {
      setLoadingReport(false);
    }
  }

  async function handleExportClaimPdf() {
    if (!report) return;

    const escapeHtml = (value: string) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    setExportingClaimPdf(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const storeName = selectedStore?.store_name || '';
      const clinicName = String(report.batch?.clinic_name || '-');
      const clinicCode = String(report.batch?.clinic_code || '-');
      const periodStart = String(report.batch?.period_start || '-');
      const periodEnd = String(report.batch?.period_end || '-');
      const totalBilling = fmt(report.summary.totalBilling);
      const ym = String(report.batch?.year_month || yearMonth || 'unknown');

      const BASE_STYLE = `font-family:'Microsoft JhengHei','Noto Sans TC',Arial,sans-serif;color:#111827;`;

      const TABLE_HEADER_HTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:left;width:110px;">健保代碼</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:left;">藥品名稱</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:56px;">數量</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:72px;">藥費</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:96px;">藥費總額</th>
            </tr>
          </thead>
      `;

      const makeRowsHtml = (rows: typeof report.items) =>
        `<tbody>${rows.map((item) => `
          <tr>
            <td style="border:1px solid #d1d5db;padding:7px 6px;vertical-align:top;">${escapeHtml(item.health_insurance_code || '-')}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;vertical-align:top;">${escapeHtml(item.drug_name || '-')}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${fmt(Number(item.qty || 0))}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${item.matched_member_price == null ? '-' : fmt(item.matched_member_price)}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${fmt(item.billing_amount)}</td>
          </tr>
        `).join('')}</tbody></table>`;

      const INFO_BLOCK_HTML = `
        <div style="border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:14px;line-height:1.9;">
          <div>診所：${escapeHtml(clinicName)}（${escapeHtml(clinicCode)}）</div>
          <div>期間：${escapeHtml(periodStart)} ~ ${escapeHtml(periodEnd)}</div>
          <div style="margin-top:6px;font-size:22px;font-weight:700;color:#111827;letter-spacing:0.01em;">藥費總額：${totalBilling}</div>
        </div>
      `;

      const SIGNATURE_HTML = `
        <div style="display:flex;gap:24px;margin-top:44px;padding-top:16px;border-top:2px solid #e5e7eb;">
          <div style="flex:1;border:1px solid #6b7280;border-radius:4px;padding:12px 16px;min-height:90px;">
            <div style="font-size:13px;font-weight:600;color:#374151;">分店蓋章 / 簽名處</div>
          </div>
          <div style="flex:1;border:1px solid #6b7280;border-radius:4px;padding:12px 16px;min-height:90px;">
            <div style="font-size:13px;font-weight:600;color:#374151;">診所蓋章 / 簽名處</div>
          </div>
        </div>
      `;

      const buildPageHtml = (rows: typeof report.items, options: { isFirst: boolean; isLast: boolean; pageNo: number; totalPages: number }) => {
        const { isFirst, isLast, pageNo, totalPages } = options;
        return `
          ${isFirst
            ? `<h1 style="text-align:center;font-size:22px;font-weight:700;margin:0 0 12px 0;">${escapeHtml(storeName)}診所請款明細</h1>${INFO_BLOCK_HTML}`
            : `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${escapeHtml(storeName)}診所請款明細（續）</div>`
          }
          ${TABLE_HEADER_HTML}${makeRowsHtml(rows)}
          <div style="margin-top:8px;text-align:right;font-size:11px;color:#6b7280;">第 ${pageNo} 頁 / 共 ${totalPages} 頁</div>
          ${isLast ? SIGNATURE_HTML : ''}
          ${isLast ? `<div style="margin-top:10px;text-align:right;font-size:11px;color:#9ca3af;">列印日期：${new Date().toLocaleDateString('zh-TW')}</div>` : ''}
        `;
      };

      // Measure page height before rendering to canvas, so last page signature area never gets cut.
      const measurePageHeight = async (innerHtml: string): Promise<number> => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:-9999px;top:0;width:980px;background:white;padding:24px 28px;box-sizing:border-box;';
        el.innerHTML = `<div style="${BASE_STYLE}">${innerHtml}</div>`;
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 30));
        const height = el.scrollHeight;
        document.body.removeChild(el);
        return height;
      };

      // Render a single page's HTML to a canvas
      const renderPage = async (innerHtml: string): Promise<HTMLCanvasElement> => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:-9999px;top:0;width:980px;background:white;padding:24px 28px;box-sizing:border-box;';
        el.innerHTML = `<div style="${BASE_STYLE}">${innerHtml}</div>`;
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 100));
        const cv = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
        document.body.removeChild(el);
        return cv;
      };

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfImgWidth = pdf.internal.pageSize.getWidth() - 16;
      const pageUsableHeightMm = pdf.internal.pageSize.getHeight() - 16;
      const pageUsableHeightPx = (pageUsableHeightMm * 980) / pdfImgWidth;
      const SAFETY_MARGIN_PX = 28;
      const maxContentHeightPx = pageUsableHeightPx - SAFETY_MARGIN_PX;

      const canFitPage = async (rows: typeof report.items, options: { isFirst: boolean; isLast: boolean }) => {
        const html = buildPageHtml(rows, {
          isFirst: options.isFirst,
          isLast: options.isLast,
          pageNo: 1,
          totalPages: 1,
        });
        const h = await measurePageHeight(html);
        return h <= maxContentHeightPx;
      };

      const allItems = [...report.items];
      const chunks: (typeof report.items)[] = [];
      const remaining = [...allItems];

      // Fill pages in order: if remaining rows can fit as the final page (with signature), end here;
      // otherwise fill a non-final page to maximum height and continue.
      while (remaining.length > 0) {
        const isFirst = chunks.length === 0;

        const canUseAsLastPage = await canFitPage(remaining, { isFirst, isLast: true });
        if (canUseAsLastPage) {
          chunks.push([...remaining]);
          remaining.length = 0;
          break;
        }

        const pageRows: typeof report.items = [];
        while (remaining.length > 0) {
          const candidate = [...pageRows, remaining[0]];
          const fits = await canFitPage(candidate, { isFirst, isLast: false });
          if (!fits) break;
          pageRows.push(remaining.shift()!);
        }

        // Always progress at least one row to avoid dead loop with exceptionally tall row content.
        if (pageRows.length === 0) {
          pageRows.push(remaining.shift()!);
        }

        chunks.push(pageRows);
      }

      const totalPages = chunks.length;

      for (let i = 0; i < chunks.length; i++) {
        const isFirst = i === 0;
        const isLast = i === chunks.length - 1;
        const pageNo = i + 1;

        const pageHtml = buildPageHtml(chunks[i], { isFirst, isLast, pageNo, totalPages });

        const canvas = await renderPage(pageHtml);
        const imgData = canvas.toDataURL('image/png');
        const imgH = (canvas.height * pdfImgWidth) / canvas.width;

        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 8, 8, pdfImgWidth, imgH);
      }

      const safeClinicCode = clinicCode === '-' ? 'clinic' : clinicCode;
      pdf.save(`${storeName}診所請款明細_${safeClinicCode}_${ym}.pdf`);
    } catch (error) {
      console.error('[clinic-selfpay] 診所請款明細PDF匯出失敗', error);
      setBatchMessage('❌ 診所請款明細PDF匯出失敗，請稍後再試');
    } finally {
      setExportingClaimPdf(false);
    }
  }

  async function handleDeleteBatch(batchId: string) {
    if (!access.canDeleteBatch) return;
    const confirmed = window.confirm('確認刪除此批次匯入結果？刪除後不可復原，店長需重新上傳。');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/clinic-selfpay/batches/${batchId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '刪除失敗');
      setBatchMessage('✅ 匯入批次已刪除');
      if (report?.batch?.id === batchId) {
        setReport(null);
      }
      await loadRecentBatches();
    } catch (error: any) {
      setBatchMessage(`❌ 刪除匯入批次失敗：${error.message}`);
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">門市</label>
              {stores.length <= 1 ? (
                <div className="flex min-h-[42px] items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {selectedStore ? `${selectedStore.store_code} ${selectedStore.store_name}` : loadingStores ? '載入中...' : '尚無可用門市'}
                </div>
              ) : (
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
              )}
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  loadStores();
                  loadRecentBatches();
                  if (access.canManageMapping) loadMappings();
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
            {access.canManageMapping && (
              <button
                onClick={() => setActiveTab('mapping')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'mapping' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                DPOS 對應主檔
              </button>
            )}
          </div>

          {accessLoading ? (
            <p className="mt-2 text-xs text-gray-500">載入權限中...</p>
          ) : !access.canUseCalculator ? (
            <p className="mt-2 text-xs text-rose-600">目前帳號未開放診所自費藥毛利計算功能。</p>
          ) : null}
        </div>

        {activeTab === 'calculator' && access.canUseCalculator && (
          <>

        <div className="grid grid-cols-1 gap-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-gray-900">步驟 1：匯入診所自費藥檔</h2>
            <p className="mb-3 text-xs text-gray-600">支援健保系統 .xls 匯出，系統會讀取 A 欄藥品資訊，並優先使用 M 欄總量計算毛利；舊格式仍可回退讀取 K 欄數量。</p>

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
              <label className="block text-xs font-semibold text-gray-600">健保系統截圖（必填）</label>
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  setScreenshotFiles((prev) => [...prev, ...files]);
                }}
              />
              <button
                onClick={() => screenshotInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                {screenshotFiles.length > 0 ? `已選擇 ${screenshotFiles.length} 張截圖` : '上傳截圖'}
              </button>
              <p className="text-xs text-gray-500">可一次選多張，或先用螢幕截圖後直接按 Ctrl+V 貼上。</p>
              {screenshotFiles.length > 0 && (
                <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {screenshotFiles.map((f, idx) => (
                      <div key={`${f.name}_${idx}`} className="relative overflow-hidden rounded border border-gray-200 bg-white">
                        {screenshotPreviewUrls[idx] && (
                          <img src={screenshotPreviewUrls[idx]} alt={`截圖預覽 ${idx + 1}`} className="h-16 w-full object-cover" />
                        )}
                        <button
                          type="button"
                          onClick={() => setScreenshotFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute right-1 top-1 rounded-full bg-black/65 p-0.5 text-white hover:bg-black/80"
                          title="刪除此截圖"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="truncate px-1 py-1 text-[10px]" title={f.name}>{idx + 1}. {f.name}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshotFiles([]);
                        if (screenshotInputRef.current) screenshotInputRef.current.value = '';
                      }}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
                    >
                      清空截圖
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              disabled={batchUploading || !claimFile || !selectedStoreId || screenshotFiles.length === 0}
              onClick={handleImportClaimBatch}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {batchUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              {batchUploading ? '計算中...' : '匯入並計算毛利'}
            </button>

            {batchMessage && (
              <p className="mt-3 whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{batchMessage}</p>
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
                      {access.canDeleteBatch && <th className="px-2 py-2 text-center">操作</th>}
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
                        <td className="px-2 py-1.5 text-right">{money1(batch.total_billing_amount || 0)}</td>
                        <td className="px-2 py-1.5 text-right">{money1(batch.total_gross_profit_amount || 0)}</td>
                        {access.canDeleteBatch && (
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBatch(batch.id);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3 w-3" />刪除
                            </button>
                          </td>
                        )}
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
              <div className="flex items-center gap-2">
                {report && (
                  <button
                    onClick={() => {
                      setActiveScreenshotIndex(0);
                      setShowScreenshotModal(true);
                    }}
                    disabled={!report.screenshotUrls || report.screenshotUrls.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    回看截圖{report.screenshotUrls && report.screenshotUrls.length > 0 ? `（${report.screenshotUrls.length}）` : ''}
                  </button>
                )}
                {report && (
                  <button
                    onClick={handleExportClaimPdf}
                    disabled={exportingClaimPdf}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {exportingClaimPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    {exportingClaimPdf ? '匯出中...' : '診所請款明細PDF'}
                  </button>
                )}
                {loadingReport && <Loader2 className="h-4 w-4 animate-spin text-gray-500" />}
              </div>
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
                    <div className="text-lg font-bold text-amber-900">{money1(report.summary.totalGrossProfit)}</div>
                  </div>
                </div>

                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <div>診所：{report.batch?.clinic_name || '-'}（{report.batch?.clinic_code || '-'}）</div>
                  <div>期間：{report.batch?.period_start || '-'} ~ {report.batch?.period_end || '-'}</div>
                  <div>會員價總額：{money1(report.summary.totalBilling)}　/　總數量：{money(report.summary.totalQty)}</div>
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

        {activeTab === 'calculator' && !accessLoading && !access.canUseCalculator && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            目前帳號無毛利計算操作權限，請聯繫管理者開通。
          </div>
        )}

        {activeTab === 'mapping' && access.canManageMapping && (
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

              <div className="mt-3 w-full max-w-xs">
                <label className="mb-1 block text-xs font-semibold text-indigo-900">年月（DPOS 月價格版本）</label>
                <input
                  type="month"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className="w-full rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm"
                />
              </div>

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

      {showScreenshotModal && report?.screenshotUrls && report.screenshotUrls.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowScreenshotModal(false)}>
          <div
            className="w-full max-w-5xl rounded-xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900">健保系統截圖回看</h4>
              <button
                onClick={() => setShowScreenshotModal(false)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
              <button
                onClick={() => setActiveScreenshotIndex((prev) => Math.max(prev - 1, 0))}
                disabled={activeScreenshotIndex === 0}
                className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
              >
                上一張
              </button>
              <span>第 {activeScreenshotIndex + 1} 張 / 共 {report.screenshotUrls.length} 張</span>
              <button
                onClick={() => setActiveScreenshotIndex((prev) => Math.min(prev + 1, report.screenshotUrls!.length - 1))}
                disabled={activeScreenshotIndex >= report.screenshotUrls.length - 1}
                className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
              >
                下一張
              </button>
            </div>

            <div className="flex max-h-[72vh] items-center justify-center overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
              <img
                src={report.screenshotUrls[activeScreenshotIndex]}
                alt={`健保系統截圖 ${activeScreenshotIndex + 1}`}
                className="max-h-[68vh] w-auto max-w-full rounded"
              />
            </div>

            <div className="mt-2 flex gap-2 overflow-auto pb-1">
              {report.screenshotUrls.map((url, idx) => (
                <button
                  key={url}
                  onClick={() => setActiveScreenshotIndex(idx)}
                  className={`shrink-0 overflow-hidden rounded border ${idx === activeScreenshotIndex ? 'border-blue-500' : 'border-gray-200'}`}
                >
                  <img src={url} alt={`縮圖 ${idx + 1}`} className="h-14 w-20 object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
