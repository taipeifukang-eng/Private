'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Archive,
  Boxes,
  CheckCircle2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type PartCategory = {
  id: string;
  code?: string | null;
  name?: string | null;
};

type Part = {
  id: string;
  category_id: string;
  name: string;
  part_code?: string | null;
  barcode?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
  description?: string | null;
  base_unit: string;
  purchase_unit?: string | null;
  purchase_to_base_rate?: number | null;
  minimum_issue_qty: number;
  allow_fractional_issue: boolean;
  allow_unpacking: boolean;
  image_path?: string | null;
  specs?: Record<string, unknown> | null;
  is_active: boolean;
  notes?: string | null;
  tags?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  category?: PartCategory | null;
};

type PartsResponse = {
  success?: boolean;
  data?: Part[];
  error?: string;
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type Message = {
  type: 'error' | 'success' | 'info';
  text: string;
};

const PAGE_SIZE = 50;

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatUnit(part: Part) {
  if (!part.purchase_unit) return part.base_unit || '-';
  const rate = part.purchase_to_base_rate ? `1 ${part.purchase_unit} = ${part.purchase_to_base_rate} ${part.base_unit}` : `${part.purchase_unit} / ${part.base_unit}`;
  return rate;
}

function usageLabel(part: Part) {
  const usage = typeof part.specs?.part_usage_type === 'string' ? part.specs.part_usage_type : '';
  if (usage === 'REPAIR_PART') return '維修零件';
  if (usage === 'CONSUMABLE') return '消耗品';
  if (usage === 'SPARE_PART') return '備品';
  if (usage === 'GENERAL_SUPPLY') return '通用耗材';
  return '未分類用途';
}

function compatibilityLabel(part: Part) {
  const scope = typeof part.specs?.part_compatibility_scope === 'string' ? part.specs.part_compatibility_scope : '';
  if (scope === 'UNIVERSAL') return '通用';
  if (scope === 'RESTRICTED') return '限制相容';
  return '未設定';
}

function partReadiness(part: Part) {
  const items = [
    { label: '料號', ok: Boolean(part.part_code), hint: '建議補料號，方便門市和總務搜尋。' },
    { label: '辨識資料', ok: Boolean(part.brand || part.model || part.specification || part.barcode), hint: '建議至少填品牌、型號、規格或條碼其中一項。' },
    { label: '領用規則', ok: Boolean(part.base_unit && part.minimum_issue_qty > 0), hint: '基本單位與最小領用量需正確。' },
    { label: '用途', ok: usageLabel(part) !== '未分類用途', hint: '建議標明維修零件、消耗品、備品或通用耗材。' },
    { label: '採購換算', ok: Boolean(!part.purchase_unit || part.purchase_to_base_rate), hint: '有採購單位時，需設定換算率。' },
  ];
  const ready = items.filter((item) => item.ok).length;
  return {
    items,
    ready,
    total: items.length,
    percent: Math.round((ready / items.length) * 100),
  };
}

function parseErrorBody(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error?: unknown }).error || fallback);
  }
  return fallback;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(parseErrorBody(body, `HTTP ${response.status}`));
  }

  return body as T;
}

export default function PartsClient() {
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: 'updated_at',
      sortOrder: 'desc',
    });

    const keyword = search.trim();
    if (keyword) params.set('search', keyword);
    if (activeFilter !== 'all') params.set('isActive', activeFilter);

    return params.toString();
  }, [activeFilter, page, search]);

  const selectedPart = useMemo(() => {
    if (parts.length === 0) return null;
    return parts.find((part) => part.id === selectedPartId) || parts[0];
  }, [parts, selectedPartId]);

  const selectedReadiness = selectedPart ? partReadiness(selectedPart) : null;

  async function loadParts() {
    setLoading(true);
    setMessage(null);

    try {
      const json = await fetchJson<PartsResponse>(`/api/general-affairs/parts?${query}`);
      if (json.success === false) {
        throw new Error(json.error || '載入料件失敗');
      }

      setParts(json.data || []);
      setTotal(json.meta?.total || 0);
      setTotalPages(json.meta?.totalPages || 1);
    } catch (error) {
      setParts([]);
      setTotal(0);
      setTotalPages(1);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '載入料件失敗',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    loadParts();
  }

  function clearFilters() {
    setSearch('');
    setActiveFilter('all');
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '首頁', href: '/' },
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '料件管理' },
          { label: '料件列表' },
        ]}
        title="料件列表"
        description="管理總務料件主檔、庫存單位、採購換算與料件狀態。庫存異動與位置設定已拆到料件管理底下的獨立頁面。"
        primaryAction={
          <Link
            href="/general-affairs/parts/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700"
          >
            <Package className="h-4 w-4" />
            新增料件
          </Link>
        }
        secondaryActions={[
          <Link
            key="inventory"
            href="/general-affairs/inventory"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Warehouse className="h-4 w-4" />
            庫存管理
          </Link>,
          <Link
            key="locations"
            href="/general-affairs/inventory/locations"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Boxes className="h-4 w-4" />
            庫存位置
          </Link>,
        ]}
      />

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {message.text}
          </div>
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">目前列表</p>
            <Package className="h-4 w-4 text-orange-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{total}</div>
          <p className="mt-1 text-xs text-slate-500">依目前篩選與 RLS 可見範圍</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">本頁啟用</p>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{parts.filter((part) => part.is_active).length}</div>
          <p className="mt-1 text-xs text-slate-500">本頁資料計算，不假造全站數字</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">本頁停用</p>
            <Archive className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{parts.filter((part) => !part.is_active).length}</div>
          <p className="mt-1 text-xs text-slate-500">停用不等於 soft delete</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">採購換算</p>
            <SlidersHorizontal className="h-4 w-4 text-sky-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-950">{parts.filter((part) => part.purchase_unit).length}</div>
          <p className="mt-1 text-xs text-slate-500">本頁有採購單位設定的料件</p>
        </div>
      </section>

      <form onSubmit={submitSearch} className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋料件名稱、料號、條碼、品牌、型號或規格"
              className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <select
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value as 'all' | 'true' | 'false');
              setPage(1);
            }}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
          >
            <option value="all">全部狀態</option>
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
          <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
            <Search className="h-4 w-4" />
            查詢
          </button>
          <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
            清除
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="flex h-56 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            載入料件資料
          </div>
        ) : parts.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center px-6 text-center">
            <Package className="h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-900">目前沒有符合條件的料件</h2>
            <p className="mt-1 text-sm text-slate-500">請調整搜尋條件，或確認帳號是否具備料件查看權限。</p>
            <p className="mt-1 text-xs text-slate-400">沒有料件資料權限（沒有料件查看權限）時，系統會由 API 回傳明確權限提示。</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 lg:border-r lg:border-slate-100">
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">料件</th>
                      <th className="px-4 py-3">分類</th>
                      <th className="px-4 py-3">品牌 / 型號</th>
                      <th className="px-4 py-3">用途</th>
                      <th className="px-4 py-3">領用規則</th>
                      <th className="px-4 py-3">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parts.map((part) => {
                      const selected = selectedPart?.id === part.id;
                      const readiness = partReadiness(part);
                      return (
                        <tr
                          key={part.id}
                          onClick={() => setSelectedPartId(part.id)}
                          className={`cursor-pointer hover:bg-orange-50/40 ${selected ? 'bg-orange-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-950">{part.name}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">{part.part_code || '未填料號'}</span>
                              {part.barcode && <span>條碼：{part.barcode}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{part.category?.name || '-'}</div>
                            {part.category?.code && <div className="mt-1 font-mono text-xs text-slate-400">{part.category.code}</div>}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{[part.brand, part.model].filter(Boolean).join(' / ') || '-'}</div>
                            {part.specification && <div className="mt-1 line-clamp-1 text-xs text-slate-500">{part.specification}</div>}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{usageLabel(part)}</div>
                            <div className="mt-1 text-xs text-slate-500">完整度 {readiness.percent}%</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>最小 {part.minimum_issue_qty} {part.base_unit}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {part.allow_fractional_issue ? '可小數' : '限整數'} / {part.allow_unpacking ? '可拆包' : '不可拆包'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${part.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                              {part.is_active ? '啟用' : '停用'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 lg:hidden">
                {parts.map((part) => {
                  const selected = selectedPart?.id === part.id;
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => setSelectedPartId(part.id)}
                      className={`block w-full p-4 text-left ${selected ? 'bg-orange-50' : 'bg-white'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-950">{part.name}</h3>
                          <p className="mt-1 text-xs font-mono text-slate-500">{part.part_code || '未填料號'}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${part.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                          {part.is_active ? '啟用' : '停用'}
                        </span>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                        <div><dt className="font-semibold text-slate-700">分類</dt><dd>{part.category?.name || '-'}</dd></div>
                        <div><dt className="font-semibold text-slate-700">用途</dt><dd>{usageLabel(part)}</dd></div>
                        <div><dt className="font-semibold text-slate-700">品牌型號</dt><dd>{[part.brand, part.model].filter(Boolean).join(' / ') || '-'}</dd></div>
                        <div><dt className="font-semibold text-slate-700">更新</dt><dd>{formatDateTime(part.updated_at)}</dd></div>
                      </dl>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedPart && selectedReadiness && (
              <aside className="space-y-4 bg-slate-50/70 p-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-orange-700">目前選取</p>
                      <h2 className="mt-1 text-lg font-bold text-slate-950">{selectedPart.name}</h2>
                      <p className="mt-1 text-xs font-mono text-slate-500">{selectedPart.part_code || '未填料號'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${selectedPart.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                      {selectedPart.is_active ? '啟用' : '停用'}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm text-slate-600">{selectedPart.description || selectedPart.specification || '尚未填寫料件說明。'}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">資料完整度</h3>
                    <span className="text-sm font-bold text-orange-700">{selectedReadiness.percent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${selectedReadiness.percent}%` }} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedReadiness.items.map((item) => (
                      <div key={item.label} className="flex gap-2 text-xs">
                        {item.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />}
                        <div>
                          <div className="font-semibold text-slate-800">{item.label}</div>
                          {!item.ok && <div className="mt-0.5 text-slate-500">{item.hint}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="font-semibold text-slate-500">用途</div>
                    <div className="mt-1 text-sm font-bold text-slate-950">{usageLabel(selectedPart)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="font-semibold text-slate-500">相容性</div>
                    <div className="mt-1 text-sm font-bold text-slate-950">{compatibilityLabel(selectedPart)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="font-semibold text-slate-500">庫存單位</div>
                    <div className="mt-1 text-sm font-bold text-slate-950">{selectedPart.base_unit || '-'}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="font-semibold text-slate-500">採購換算</div>
                    <div className="mt-1 text-sm font-bold text-slate-950">{formatUnit(selectedPart)}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <h3 className="text-sm font-bold text-slate-900">下一步</h3>
                  <div className="mt-3 grid gap-2">
                    <Link href="/general-affairs/inventory" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800">
                      <Warehouse className="h-4 w-4" />
                      查看庫存
                    </Link>
                    <Link href="/general-affairs/inventory/locations" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      <Boxes className="h-4 w-4" />
                      設定位置
                    </Link>
                    <Link href="/general-affairs/parts/new" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 hover:bg-orange-100">
                      <Package className="h-4 w-4" />
                      新增料件
                    </Link>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                  <div className="font-semibold text-slate-700">管理提醒</div>
                  <p className="mt-1">
                    {selectedReadiness.ready === selectedReadiness.total
                      ? '這個料件主檔已具備基本管理資訊，可以接庫存、調撥、出庫與採購流程。'
                      : '先把缺漏資料補齊，後續需求單、出庫與採購判斷會更穩定。'}
                  </p>
                  <p className="mt-2">最後更新：{formatDateTime(selectedPart.updated_at)}</p>
                </div>
              </aside>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>共 {total} 筆，第 {page} / {totalPages} 頁</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="h-9 rounded-md border border-slate-200 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一頁
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="h-9 rounded-md border border-slate-200 px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一頁
          </button>
        </div>
      </div>
    </div>
  );
}
