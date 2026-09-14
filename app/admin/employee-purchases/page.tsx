'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Filter,
  RefreshCw,
  ShoppingCart,
  Upload,
  Users,
} from 'lucide-react';

type PositionSummary = {
  position: string;
  sales_count: number;
  employee_count: number;
  total_quantity: number;
  total_amount: number;
  gross_profit: number;
};

type PurchaseRow = {
  id: string;
  recognized_store_code: string;
  recognized_store_name: string;
  employee_code: string;
  employee_name: string;
  employee_position: string;
  purchase_count: number;
  total_amount: number;
};

type EmployeeSummarySortKey =
  | 'recognized_store'
  | 'employee_code'
  | 'employee_name'
  | 'employee_position'
  | 'purchase_count'
  | 'total_amount';

type EmployeeSummarySortDirection = 'desc' | 'asc' | null;

type EmployeePurchaseDetail = {
  purchase_store_code: string;
  purchase_store_name: string;
  product_code: string;
  product_name: string;
  purchase_count: number;
  quantity: number;
  gross_profit: number;
  total_amount: number;
};

type LatestBatch = {
  file_name: string;
  imported_at: string;
  row_count: number;
  matched_count: number;
  unmatched_count: number;
  total_amount: number;
} | null;

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMoney(value: number | null | undefined) {
  return Math.round(Number(value || 0)).toLocaleString('zh-TW');
}

function formatDecimal(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

export default function EmployeePurchasesPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailSectionRef = useRef<HTMLElement>(null);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [selectedPosition, setSelectedPosition] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [positions, setPositions] = useState<string[]>([]);
  const [summary, setSummary] = useState<PositionSummary[]>([]);
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [latestBatch, setLatestBatch] = useState<LatestBatch>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<PurchaseRow | null>(null);
  const [employeeDetails, setEmployeeDetails] = useState<EmployeePurchaseDetail[]>([]);
  const [loadingEmployeeDetails, setLoadingEmployeeDetails] = useState(false);
  const [isEmployeeSummaryCollapsed, setIsEmployeeSummaryCollapsed] = useState(false);
  const [employeeSummarySort, setEmployeeSummarySort] = useState<{
    key: EmployeeSummarySortKey | null;
    direction: EmployeeSummarySortDirection;
  }>({ key: null, direction: null });

  const selectedPositionAmount = useMemo(() => {
    if (!selectedPosition) return totalAmount;
    return summary.find((item) => item.position === selectedPosition)?.total_amount || 0;
  }, [selectedPosition, summary, totalAmount]);

  const employeeDetailTotals = useMemo(() => ({
    purchaseCount: employeeDetails.reduce((sum, row) => sum + row.purchase_count, 0),
    quantity: employeeDetails.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    grossProfit: employeeDetails.reduce((sum, row) => sum + Number(row.gross_profit || 0), 0),
    totalAmount: employeeDetails.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
  }), [employeeDetails]);

  const sortedRows = useMemo(() => {
    if (!employeeSummarySort.key || !employeeSummarySort.direction) return rows;
    const sortKey = employeeSummarySort.key;
    const sortDirection = employeeSummarySort.direction;

    const getValue = (row: PurchaseRow) => {
      if (sortKey === 'recognized_store') {
        return `${row.recognized_store_code || ''} ${row.recognized_store_name || ''}`.trim();
      }
      return row[sortKey];
    };

    return [...rows].sort((left, right) => {
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      let compare = 0;

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        compare = leftValue - rightValue;
      } else {
        compare = String(leftValue || '').localeCompare(String(rightValue || ''), 'zh-Hant-TW', { numeric: true });
      }

      return sortDirection === 'desc' ? -compare : compare;
    });
  }, [employeeSummarySort, rows]);

  function toggleEmployeeSummarySort(key: EmployeeSummarySortKey) {
    setEmployeeSummarySort((current) => {
      if (current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return { key: null, direction: null };
    });
  }

  function renderSortHeader(label: string, key: EmployeeSummarySortKey, align: 'left' | 'right' = 'left') {
    const active = employeeSummarySort.key === key && employeeSummarySort.direction;
    const Icon = active === 'desc' ? ArrowDown : active === 'asc' ? ArrowUp : ArrowDownUp;

    return (
      <button
        type="button"
        onClick={() => toggleEmployeeSummarySort(key)}
        className={`inline-flex w-full items-center gap-1 text-xs font-medium text-gray-600 hover:text-blue-700 ${
          align === 'right' ? 'justify-end' : 'justify-start'
        }`}
      >
        <span>{label}</span>
        <Icon size={14} className={active ? 'text-blue-700' : 'text-gray-400'} />
      </button>
    );
  }

  async function loadData(targetYearMonth = yearMonth) {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ year_month: targetYearMonth });
      if (selectedPosition) params.set('position', selectedPosition);
      const response = await fetch(`/api/employee-purchases?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '載入失敗');
      }

      setPositions(data.positions || []);
      setSummary(data.summary_by_position || []);
      setRows(data.rows || []);
      setSelectedEmployee(null);
      setEmployeeDetails([]);
      setIsEmployeeSummaryCollapsed(false);
      setTotalCount(data.total_count || 0);
      setTotalAmount(data.total_amount || 0);
      setMatchedCount(data.matched_count || 0);
      setUnmatchedCount(data.unmatched_count || 0);
      setLatestBatch(data.latest_batch || null);
    } catch (error) {
      const text = error instanceof Error ? error.message : '載入失敗';
      setMessage({ type: 'error', text });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearMonth, selectedPosition]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] || null);
  }

  async function loadEmployeeDetails(row: PurchaseRow) {
    setSelectedEmployee(row);
    setEmployeeDetails([]);
    setIsEmployeeSummaryCollapsed(true);
    setLoadingEmployeeDetails(true);
    setMessage(null);
    window.requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    try {
      const params = new URLSearchParams({
        year_month: yearMonth,
        employee_code: row.employee_code || '',
        employee_name: row.employee_name || '',
      });
      const response = await fetch(`/api/employee-purchases/employee-details?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '載入員工購買明細失敗');
      }
      setEmployeeDetails(data.details || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '載入員工購買明細失敗' });
    } finally {
      setLoadingEmployeeDetails(false);
    }
  }

  async function handleImport() {
    if (!file) {
      setMessage({ type: 'error', text: '請先選擇 POS 匯出的 Excel 檔案' });
      return;
    }

    setImporting(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set('file', file);

      const response = await fetch('/api/employee-purchases/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '匯入失敗');
      }

      const warningText = data.errors?.length ? `，另有 ${data.errors.length} 筆提醒` : '';
      const importedYearMonth = data.year_month || yearMonth;
      setMessage({
        type: 'success',
        text: `匯入完成：歸屬月份 ${importedYearMonth}，${data.imported} 筆，已比對 ${data.matched} 筆，未比對 ${data.unmatched} 筆，總金額 ${formatMoney(data.total_amount)}${warningText}`,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (importedYearMonth !== yearMonth) {
        setYearMonth(importedYearMonth);
      } else {
        await loadData(importedYearMonth);
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '匯入失敗' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700">
              <ShoppingCart size={16} />
              組織管理
            </div>
            <h1 className="text-2xl font-bold text-gray-900">員工購物管理</h1>
            <p className="mt-1 text-sm text-gray-600">
              匯入 POS 每月員工購物銷售資料，依當月人員快照統計不同職稱的購物金額。
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadData()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            重新整理
          </button>
        </div>

        {message && (
          <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Upload size={20} />
              匯入 POS Excel
            </h2>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">查詢月份</span>
                <input
                  type="month"
                  value={yearMonth}
                  onChange={(event) => setYearMonth(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">POS 銷售資料檔</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm"
                />
              </label>

              <button
                type="button"
                onClick={handleImport}
                disabled={importing || !file}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <Upload size={18} />
                {importing ? '匯入中...' : '匯入並覆蓋銷售月份資料'}
              </button>

              <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                POS 檔第一列會視為無效列，第二列需包含門市代號、銷售日期、銷售序號、會員編號、會員名稱、品號、品名、數量、總金額等欄位。系統會依銷售日期自動判定匯入月份。
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-500"><Calendar size={16} />月份</div>
              <div className="mt-2 text-2xl font-bold text-gray-900">{yearMonth}</div>
              <div className="mt-2 text-xs text-gray-500">{latestBatch ? `最後匯入：${new Date(latestBatch.imported_at).toLocaleString('zh-TW')}` : '尚無匯入紀錄'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-500"><ShoppingCart size={16} />購物總金額</div>
              <div className="mt-2 text-2xl font-bold text-emerald-700">{formatMoney(selectedPositionAmount)}</div>
              <div className="mt-2 text-xs text-gray-500">{selectedPosition ? `已篩選：${selectedPosition}` : '全部職稱'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-500"><Users size={16} />明細筆數</div>
              <div className="mt-2 text-2xl font-bold text-gray-900">{totalCount.toLocaleString('zh-TW')}</div>
              <div className="mt-2 text-xs text-gray-500">下方以員工彙總顯示</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-500"><CheckCircle2 size={16} />人員比對</div>
              <div className="mt-2 text-2xl font-bold text-blue-700">{matchedCount.toLocaleString('zh-TW')}</div>
              <div className="mt-2 text-xs text-gray-500">未比對 {unmatchedCount.toLocaleString('zh-TW')} 筆</div>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">職稱金額彙總</h2>
              <p className="mt-1 text-sm text-gray-600">點選職稱或使用篩選器，可只看該職稱的員購金額。</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Filter size={16} className="text-gray-500" />
              <select
                value={selectedPosition}
                onChange={(event) => setSelectedPosition(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">全部職稱</option>
                {positions.map((position) => (
                  <option key={position} value={position}>{position}</option>
                ))}
              </select>
            </label>
          </div>

          {summary.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-gray-500">
              {loading ? '載入中...' : '尚無此月份員工購物資料'}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {summary.map((item) => (
                <button
                  key={item.position}
                  type="button"
                  onClick={() => setSelectedPosition(item.position === selectedPosition ? '' : item.position)}
                  className={`rounded-lg border p-4 text-left transition ${
                    selectedPosition === item.position
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold text-gray-900">{item.position}</div>
                    <div className="text-lg font-bold text-emerald-700">{formatMoney(item.total_amount)}</div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-600">
                    <div>
                      <div className="text-gray-400">同仁數</div>
                      <div className="font-semibold text-gray-800">{item.employee_count}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">筆數</div>
                      <div className="font-semibold text-gray-800">{item.sales_count}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">毛利</div>
                      <div className="font-semibold text-gray-800">{formatMoney(item.gross_profit)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">員工消費彙總</h2>
              <p className="mt-1 text-sm text-gray-600">
                {selectedPosition ? `目前篩選職稱：${selectedPosition}` : '目前顯示全部職稱'}，依認列門市與員工彙總消費總額。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsEmployeeSummaryCollapsed((value) => !value)}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {isEmployeeSummaryCollapsed ? '展開彙總' : '收合彙總'}
            </button>
          </div>
          {isEmployeeSummaryCollapsed && selectedEmployee ? (
            <div className="flex flex-col gap-2 p-5 text-sm text-gray-600 md:flex-row md:items-center md:justify-between">
              <div>
                已選取 <span className="font-semibold text-gray-900">{selectedEmployee.employee_code || '-'} / {selectedEmployee.employee_name || '-'}</span>
                ，彙總表已收合。
              </div>
              <button
                type="button"
                onClick={() => setIsEmployeeSummaryCollapsed(false)}
                className="text-left font-medium text-blue-700 hover:text-blue-800"
              >
                回到員工列表選擇其他人
              </button>
            </div>
          ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">{renderSortHeader('認列門市', 'recognized_store')}</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">{renderSortHeader('員編', 'employee_code')}</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">{renderSortHeader('姓名', 'employee_name')}</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">{renderSortHeader('職稱', 'employee_position')}</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">{renderSortHeader('消費筆數', 'purchase_count', 'right')}</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">{renderSortHeader('消費總額', 'total_amount', 'right')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                      {loading ? '載入中...' : '沒有員工消費彙總資料'}
                    </td>
                  </tr>
                ) : sortedRows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => loadEmployeeDetails(row)}
                    className={`cursor-pointer hover:bg-blue-50 ${selectedEmployee?.id === row.id ? 'bg-blue-50' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.recognized_store_code} {row.recognized_store_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">{row.employee_code || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-900">{row.employee_name || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.employee_position || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{row.purchase_count.toLocaleString('zh-TW')}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-gray-900">{formatMoney(row.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>

        {selectedEmployee && (
          <section ref={detailSectionRef} className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-gray-200 p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">購買商品明細</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {selectedEmployee.employee_code || '-'} / {selectedEmployee.employee_name || '-'}，
                  認列門市 {selectedEmployee.recognized_store_code} {selectedEmployee.recognized_store_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEmployee(null);
                  setEmployeeDetails([]);
                  setIsEmployeeSummaryCollapsed(false);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                關閉明細
              </button>
            </div>

            <div className="grid gap-3 border-b border-gray-100 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">購買筆數</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{employeeDetailTotals.purchaseCount.toLocaleString('zh-TW')}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="text-xs text-gray-500">數量加總</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{formatDecimal(employeeDetailTotals.quantity)}</div>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="text-xs text-emerald-700">金額加總</div>
                <div className="mt-1 text-lg font-semibold text-emerald-800">{formatMoney(employeeDetailTotals.totalAmount)}</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3">
                <div className="text-xs text-blue-700">毛利加總</div>
                <div className="mt-1 text-lg font-semibold text-blue-800">{formatMoney(employeeDetailTotals.grossProfit)}</div>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">購買門市</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">品號</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">品名</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">購買筆數</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">數量</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">毛利</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loadingEmployeeDetails ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-gray-500">載入中...</td>
                    </tr>
                  ) : employeeDetails.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-gray-500">沒有購買商品明細</td>
                    </tr>
                  ) : employeeDetails.map((detail, index) => (
                    <tr key={`${detail.purchase_store_code}-${detail.product_code}-${index}`} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{detail.purchase_store_code} {detail.purchase_store_name}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">{detail.product_code || '-'}</td>
                      <td className="min-w-[260px] px-3 py-2 text-gray-900">{detail.product_name || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{detail.purchase_count.toLocaleString('zh-TW')}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">{formatDecimal(detail.quantity)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-blue-700">{formatMoney(detail.gross_profit)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-gray-900">{formatMoney(detail.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
