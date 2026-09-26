'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  PackageSearch,
  Pencil,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type ApiError = { code?: string; message?: string };

type LocationOption = {
  id: string;
  code: string | null;
  name: string;
  location_type: string;
  allow_negative_stock: boolean;
  store?: { store_code: string; store_name: string; short_name?: string | null } | null;
};

type PartOption = {
  id: string;
  name: string;
  part_code: string | null;
  brand: string | null;
  model: string | null;
  specification: string | null;
  base_unit: string;
  purchase_unit: string | null;
  purchase_to_base_rate: number | null;
  minimum_issue_qty: number;
  allow_fractional_issue: boolean;
  allow_unpacking: boolean;
};

type LocationPartOption = {
  id: string;
  location_id: string;
  part_id: string;
  currentBalance?: BalanceRow | null;
  part?: PartOption | null;
};

type BalanceRow = {
  id: string;
  location_id: string;
  part_id: string;
  quantity_base: number;
  quantity_on_hand: number;
  version: number;
  last_transaction_id: string | null;
  last_transaction_at: string | null;
  location?: LocationOption | null;
  part?: PartOption | null;
  base_unit?: string | null;
  holding?: {
    in_use_quantity: number;
    idle_quantity: number;
    unclassified_quantity: number;
    notes: string | null;
    updated_at: string | null;
  } | null;
};

type TransactionRow = {
  id: string;
  transaction_no: string;
  transaction_type: string;
  location_id: string;
  part_id: string;
  quantity_input: number;
  input_unit_type: string;
  unit_conversion_rate: number;
  quantity_base: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  notes: string | null;
  occurred_at: string;
  created_at: string;
  idempotency_key: string | null;
  location?: LocationOption | null;
  part?: PartOption | null;
  creator?: { full_name?: string | null; email?: string | null } | null;
};

type TransactionForm = {
  transactionType: 'RECEIPT' | 'ISSUE' | 'ADJUST_IN' | 'ADJUST_OUT';
  locationId: string;
  partId: string;
  quantity: string;
  inputUnitType: 'BASE' | 'PURCHASE';
  reason: string;
  notes: string;
  occurredAt: string;
  idempotencyKey: string;
};

type Message = { type: 'success' | 'error'; text: string } | null;
type ListMeta = { page: number; pageSize: number; total: number; totalPages: number };

const EMPTY_FORM: TransactionForm = {
  transactionType: 'RECEIPT',
  locationId: '',
  partId: '',
  quantity: '',
  inputUnitType: 'BASE',
  reason: '',
  notes: '',
  occurredAt: '',
  idempotencyKey: '',
};

const TYPE_LABELS: Record<string, string> = {
  RECEIPT: '入庫',
  ISSUE: '出庫',
  ADJUST_IN: '調增',
  ADJUST_OUT: '調減',
};

function newKey() {
  return crypto.randomUUID();
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const error = json.error as ApiError | string | undefined;
    if (typeof error === 'object' && error) throw new Error(`${error.code || 'ERROR'}｜${error.message || '操作失敗'}`);
    throw new Error(String(error || '操作失敗'));
  }
  return json;
}

function dateText(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function numberText(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return parsed.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

function locationLabel(location?: LocationOption | null) {
  if (!location) return '-';
  const store = location.store?.short_name || location.store?.store_name || '';
  return `${location.name}${store ? `｜${store}` : ''}`;
}

function partLabel(part?: PartOption | null) {
  if (!part) return '-';
  return [part.part_code, part.name, part.brand, part.model].filter(Boolean).join('｜');
}

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

export default function InventoryTransactionsClient() {
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [balanceMeta, setBalanceMeta] = useState<ListMeta | null>(null);
  const [transactionMeta, setTransactionMeta] = useState<ListMeta | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationParts, setLocationParts] = useState<LocationPartOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [canPost, setCanPost] = useState(false);
  const [partCatalogAccess, setPartCatalogAccess] = useState(true);
  const [balanceSearch, setBalanceSearch] = useState('');
  const [holdingFilter, setHoldingFilter] = useState('');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [transactionPartFilter, setTransactionPartFilter] = useState('');
  const [form, setForm] = useState<TransactionForm>({ ...EMPTY_FORM, idempotencyKey: newKey() });
  const [editingHolding, setEditingHolding] = useState<BalanceRow | null>(null);
  const [holdingDraft, setHoldingDraft] = useState({ inUse: '', idle: '', notes: '' });
  const [savingHolding, setSavingHolding] = useState(false);

  const selectedLocationParts = useMemo(
    () => locationParts.filter((item) => item.location_id === form.locationId),
    [form.locationId, locationParts],
  );
  const selectedLocationPart = useMemo(
    () => locationParts.find((item) => item.location_id === form.locationId && item.part_id === form.partId) || null,
    [form.locationId, form.partId, locationParts],
  );
  const selectedPart = selectedLocationPart?.part || null;
  const selectedLocation = locations.find((location) => location.id === form.locationId) || null;
  const canSubmit = canPost && partCatalogAccess && form.locationId && form.partId && form.quantity && form.reason.trim();
  const visibleTransactionParts = useMemo(() => {
    const source = locationFilter
      ? locationParts.filter((item) => item.location_id === locationFilter)
      : locationParts;
    const byPartId = new Map<string, LocationPartOption>();
    source.forEach((item) => {
      if (!byPartId.has(item.part_id)) byPartId.set(item.part_id, item);
    });
    return Array.from(byPartId.values());
  }, [locationFilter, locationParts]);
  const negativeBalanceCount = useMemo(
    () => balances.filter((row) => Number(row.quantity_base) < 0).length,
    [balances],
  );
  const latestTransaction = transactions[0] || null;
  const visiblePartCount = useMemo(
    () => new Set(locationParts.map((item) => item.part_id)).size,
    [locationParts],
  );
  const holdingSummary = useMemo(() => {
    const rows = balances.filter((row) => Number(row.quantity_base || 0) > 0);
    const sumHolding = (key: 'in_use_quantity' | 'idle_quantity' | 'unclassified_quantity') => rows.reduce((total, row) => total + Number(row.holding?.[key] || 0), 0);
    return {
      totalQuantity: rows.reduce((total, row) => total + Number(row.quantity_base || 0), 0),
      inUseQuantity: sumHolding('in_use_quantity'),
      idleQuantity: sumHolding('idle_quantity'),
      unclassifiedQuantity: sumHolding('unclassified_quantity'),
      topTransferable: rows.filter((row) => Number(row.holding?.idle_quantity || 0) > 0)
        .slice()
        .sort((a, b) => Number(b.holding?.idle_quantity || 0) - Number(a.holding?.idle_quantity || 0))
        .slice(0, 3),
    };
  }, [balances]);
  const visibleBalances = useMemo(() => {
    if (!holdingFilter) return balances;
    return balances.filter((row) => {
      const quantity = Number(row.quantity_base || 0);
      if (quantity <= 0) return false;
      if (holdingFilter === 'IN_USE') return Number(row.holding?.in_use_quantity || 0) > 0;
      if (holdingFilter === 'IDLE') return Number(row.holding?.idle_quantity || 0) > 0;
      if (holdingFilter === 'UNCLASSIFIED') return Number(row.holding?.unclassified_quantity || 0) > 0;
      return true;
    });
  }, [balances, holdingFilter]);
  const activeHoldingFilterLabel =
    holdingFilter === 'IN_USE'
      ? '使用中'
      : holdingFilter === 'IDLE'
        ? '閒置可調撥'
        : holdingFilter === 'UNCLASSIFIED'
          ? '待確認'
          : '';

  const loadOptions = useCallback(async () => {
    const response = await fetch('/api/general-affairs/inventory/options');
    const json = await parseResponse(response);
    setLocations(json.data.locations || []);
    setLocationParts(json.data.locationParts || []);
    setCanPost(json.data.canPostTransactions === true);
    setPartCatalogAccess(json.data.partCatalogAccess !== false);
  }, []);

  const loadBalances = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '50', includeZero: 'true', sort: 'last_transaction_at', sortOrder: 'desc' });
    if (balanceSearch.trim()) params.set('search', balanceSearch.trim());
    if (locationFilter) params.set('locationId', locationFilter);
    const response = await fetch(`/api/general-affairs/inventory/balances?${params.toString()}`);
    if (response.status === 403) setPermissionDenied(true);
    const json = await parseResponse(response);
    setBalances(json.data || []);
    setBalanceMeta(json.meta || null);
  }, [balanceSearch, locationFilter]);

  const loadTransactions = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '50', sort: 'occurred_at', sortOrder: 'desc' });
    if (transactionTypeFilter) params.set('transactionType', transactionTypeFilter);
    if (locationFilter) params.set('locationId', locationFilter);
    if (transactionPartFilter) params.set('partId', transactionPartFilter);
    const response = await fetch(`/api/general-affairs/inventory/transactions?${params.toString()}`);
    if (response.status === 403) {
      setTransactions([]);
      setTransactionMeta(null);
      return;
    }
    const json = await parseResponse(response);
    setTransactions(json.data || []);
    setTransactionMeta(json.meta || null);
  }, [locationFilter, transactionPartFilter, transactionTypeFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      await loadOptions();
      await Promise.all([loadBalances(), loadTransactions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入庫存資料失敗');
    } finally {
      setLoading(false);
    }
  }, [loadBalances, loadOptions, loadTransactions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!form.locationId) return;
    const stillValid = selectedLocationParts.some((item) => item.part_id === form.partId);
    if (!stillValid) setForm((prev) => ({ ...prev, partId: '' }));
  }, [form.locationId, form.partId, selectedLocationParts]);

  useEffect(() => {
    if (!transactionPartFilter) return;
    const stillVisible = visibleTransactionParts.some((item) => item.part_id === transactionPartFilter);
    if (!stillVisible) setTransactionPartFilter('');
  }, [transactionPartFilter, visibleTransactionParts]);

  async function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || posting) return;
    setPosting(true);
    setMessage(null);
    try {
      const response = await fetch('/api/general-affairs/inventory/transactions/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionType: form.transactionType,
          locationId: form.locationId,
          partId: form.partId,
          quantity: Number(form.quantity),
          inputUnitType: form.inputUnitType,
          reason: form.reason,
          notes: form.notes || null,
          occurredAt: form.occurredAt || null,
          idempotencyKey: form.idempotencyKey,
          metadata: {},
        }),
      });
      const json = await parseResponse(response);
      const row = json.data;
      setMessage({
        type: 'success',
        text: `${row.transaction_no} 已完成，庫存 ${numberText(row.balance_before)} → ${numberText(row.balance_after)}${row.idempotent_replay ? '（重送已處理）' : ''}`,
      });
      setForm({ ...EMPTY_FORM, idempotencyKey: newKey() });
      await Promise.all([loadOptions(), loadBalances(), loadTransactions()]);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '建立庫存交易失敗' });
    } finally {
      setPosting(false);
    }
  }

  function openHoldingEditor(row: BalanceRow) {
    setEditingHolding(row);
    setHoldingDraft({
      inUse: String(Number(row.holding?.in_use_quantity || 0)),
      idle: String(Number(row.holding?.idle_quantity || 0)),
      notes: row.holding?.notes || '',
    });
  }

  async function saveHolding() {
    if (!editingHolding || savingHolding) return;
    const inUse = Number(holdingDraft.inUse);
    const idle = Number(holdingDraft.idle);
    const total = Math.max(0, Number(editingHolding.quantity_base || 0));
    if (!Number.isFinite(inUse) || !Number.isFinite(idle) || inUse < 0 || idle < 0) {
      setMessage({ type: 'error', text: '使用中與閒置數量必須是 0 以上的數字。' });
      return;
    }
    if (inUse + idle > total) {
      setMessage({ type: 'error', text: `使用中與閒置合計不可超過持有量 ${numberText(total)}。` });
      return;
    }
    setSavingHolding(true);
    setMessage(null);
    try {
      await parseResponse(await fetch(`/api/general-affairs/inventory/balances/${editingHolding.id}/holding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_use_quantity: inUse, idle_quantity: idle, notes: holdingDraft.notes }),
      }));
      setEditingHolding(null);
      setMessage({ type: 'success', text: '料件使用狀態已更新。' });
      await loadBalances();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '更新料件使用狀態失敗' });
    } finally {
      setSavingHolding(false);
    }
  }

  return (
    <div className="text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <GeneralAffairsPageHeader
          eyebrow="庫存管理"
          breadcrumbs={[
            { label: '總務服務中心', href: '/general-affairs' },
            { label: '庫存管理' },
          ]}
          title="庫存管理"
          description="查看庫存餘額、流水與執行入庫、出庫、調增、調減"
          secondaryActions={[
            <button
              key="refresh"
              type="button"
              onClick={refresh}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw className="h-4 w-4" />
              重新整理
            </button>,
          ]}
        />

        <nav className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm sm:flex-row" aria-label="庫存管理子頁">
          <Link
            href="/general-affairs/inventory"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange-600 px-4 font-semibold text-white"
            aria-current="page"
          >
            <ClipboardList className="h-4 w-4" />
            庫存交易與餘額
          </Link>
          <Link
            href="/general-affairs/inventory/locations"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-semibold text-slate-700 hover:bg-slate-100"
          >
            <MapPin className="h-4 w-4" />
            位置與料件設定
          </Link>
        </nav>

        {message && (
          <div className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${messageClass(message.type)}`}>
            {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        {permissionDenied && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            目前帳號沒有庫存餘額查看權限，或只能查看所管理門市範圍內的資料。
          </section>
        )}

        {error && (
          <section className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</section>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">可見庫存位置</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{locations.length}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">可交易料件</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{visiblePartCount}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-500">目前餘額筆數</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{balanceMeta?.total ?? balances.length}</div>
          </div>
          <div className={`rounded-md border p-4 ${negativeBalanceCount > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <div className="text-xs font-semibold text-slate-500">負庫存筆數</div>
            <div className={`mt-2 text-2xl font-semibold ${negativeBalanceCount > 0 ? 'text-red-700' : 'text-slate-950'}`}>{negativeBalanceCount}</div>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">料件持有狀態</h2>
              <p className="mt-1 text-sm text-slate-500">先選擇門市，即可看到實際持有、使用中與可調撥數量。</p>
            </div>
            <Link
              href="/general-affairs/inventory/transfers"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              建立調撥
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-600">總持有</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{numberText(holdingSummary.totalQuantity)}</div>
            </div>
            <button
              type="button"
              onClick={() => setHoldingFilter((current) => (current === 'IN_USE' ? '' : 'IN_USE'))}
              className={`rounded-md border bg-blue-50 p-3 text-left transition hover:border-blue-400 hover:bg-blue-100 ${
                holdingFilter === 'IN_USE' ? 'border-blue-600 ring-2 ring-blue-200' : 'border-blue-200'
              }`}
            >
              <div className="text-xs font-bold text-blue-700">使用中</div>
              <div className="mt-1 text-2xl font-black text-blue-950">{numberText(holdingSummary.inUseQuantity)}</div>
            </button>
            <button
              type="button"
              onClick={() => setHoldingFilter((current) => (current === 'IDLE' ? '' : 'IDLE'))}
              className={`rounded-md border bg-emerald-50 p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-100 ${
                holdingFilter === 'IDLE' ? 'border-emerald-600 ring-2 ring-emerald-200' : 'border-emerald-200'
              }`}
            >
              <div className="text-xs font-bold text-emerald-700">閒置可調撥</div>
              <div className="mt-1 text-2xl font-black text-emerald-950">{numberText(holdingSummary.idleQuantity)}</div>
            </button>
            <button
              type="button"
              onClick={() => setHoldingFilter((current) => (current === 'UNCLASSIFIED' ? '' : 'UNCLASSIFIED'))}
              className={`rounded-md border bg-amber-50 p-3 text-left transition hover:border-amber-400 hover:bg-amber-100 ${
                holdingFilter === 'UNCLASSIFIED' ? 'border-amber-600 ring-2 ring-amber-200' : 'border-amber-200'
              }`}
            >
              <div className="text-xs font-bold text-amber-700">待確認</div>
              <div className="mt-1 text-2xl font-black text-amber-950">{numberText(holdingSummary.unclassifiedQuantity)}</div>
            </button>
          </div>
          {holdingFilter && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="font-semibold text-slate-700">庫存餘額目前只看：{activeHoldingFilterLabel}</span>
              <button type="button" onClick={() => setHoldingFilter('')} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50">
                清除持有篩選
              </button>
            </div>
          )}
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-black text-slate-700">優先可調撥料件</div>
            {holdingSummary.topTransferable.length === 0 ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">目前沒有總倉可調撥庫存。</div>
            ) : (
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {holdingSummary.topTransferable.map((row) => (
                  <div key={row.id} className="rounded-md bg-white px-3 py-2 text-xs shadow-sm">
                    <div className="truncate font-bold text-slate-900">{partLabel(row.part)}</div>
                    <div className="mt-1 text-slate-500">{locationLabel(row.location)}</div>
                    <div className="mt-1 font-black text-emerald-700">{numberText(row.holding?.idle_quantity)} {row.base_unit || row.part?.base_unit || ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold">庫存餘額</h2>
                <p className="text-sm text-slate-500">
                  {holdingFilter
                    ? `目前顯示 ${activeHoldingFilterLabel} ${visibleBalances.length} 筆，可清除篩選回到全部庫存。`
                    : `依 RLS 顯示可見位置與料件庫存，共 ${balanceMeta?.total ?? balances.length} 筆`}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={balanceSearch}
                    onChange={(event) => setBalanceSearch(event.target.value)}
                    className="h-10 rounded-md border border-slate-300 pl-9 pr-3 text-sm"
                    placeholder="搜尋位置或料件"
                  />
                </label>
                <select
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                >
                  <option value="">全部位置</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{locationLabel(location)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">位置</th>
                    <th className="px-4 py-3">料件</th>
                    <th className="px-4 py-3 text-right">總持有</th>
                    <th className="px-4 py-3 text-right">使用中</th>
                    <th className="px-4 py-3 text-right">閒置可調撥</th>
                    <th className="px-4 py-3 text-right">待確認</th>
                    <th className="px-4 py-3">最後交易</th>
                    {canPost && <th className="px-4 py-3 text-right">操作</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={canPost ? 8 : 7} className="px-4 py-8 text-center text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                  ) : visibleBalances.length === 0 ? (
                    <tr><td colSpan={canPost ? 8 : 7} className="px-4 py-8 text-center text-slate-500">目前沒有可顯示的庫存餘額</td></tr>
                  ) : visibleBalances.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">{locationLabel(row.location)}</td>
                        <td className="px-4 py-3">{partLabel(row.part)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${Number(row.quantity_base) < 0 ? 'text-red-600' : ''}`}>
                          {numberText(row.quantity_base)} {row.base_unit || row.part?.base_unit || ''}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-blue-700">{numberText(row.holding?.in_use_quantity)}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{numberText(row.holding?.idle_quantity)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${Number(row.holding?.unclassified_quantity || 0) > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                          {numberText(row.holding?.unclassified_quantity)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{dateText(row.last_transaction_at)}</td>
                        {canPost && (
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => openHoldingEditor(row)} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                              <Pencil className="h-3.5 w-3.5" />調整狀態
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <form onSubmit={submitTransaction} className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-4">
              <h2 className="font-semibold">新增庫存交易</h2>
              <p className="text-sm text-slate-500">交易會使用同一 idempotency key 安全送出</p>
            </div>
            <div className="grid gap-3 p-4">
              {!canPost && <div className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">目前帳號沒有庫存交易管理權限。</div>}
              {canPost && !partCatalogAccess && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">缺少 general_affairs.part.view，因此無法建立庫存交易。</div>}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, transactionType: 'RECEIPT' }))} className={`rounded-md border px-3 py-2 text-sm ${form.transactionType === 'RECEIPT' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}><ArrowDownCircle className="mr-1 inline h-4 w-4" />入庫</button>
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, transactionType: 'ISSUE' }))} className={`rounded-md border px-3 py-2 text-sm ${form.transactionType === 'ISSUE' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}><ArrowUpCircle className="mr-1 inline h-4 w-4" />出庫</button>
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, transactionType: 'ADJUST_IN' }))} className={`rounded-md border px-3 py-2 text-sm ${form.transactionType === 'ADJUST_IN' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>調增</button>
                <button type="button" onClick={() => setForm((prev) => ({ ...prev, transactionType: 'ADJUST_OUT' }))} className={`rounded-md border px-3 py-2 text-sm ${form.transactionType === 'ADJUST_OUT' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>調減</button>
              </div>

              <select value={form.locationId} onChange={(event) => setForm((prev) => ({ ...prev, locationId: event.target.value }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
                <option value="">選擇庫存位置</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
              </select>
              <select value={form.partId} onChange={(event) => setForm((prev) => ({ ...prev, partId: event.target.value }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm" disabled={!form.locationId || !partCatalogAccess}>
                <option value="">選擇料件</option>
                {selectedLocationParts.map((item) => <option key={item.id} value={item.part_id}>{partLabel(item.part)}</option>)}
              </select>

              {selectedLocationPart && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div>目前庫存：{numberText(selectedLocationPart.currentBalance?.quantity_base || 0)} {selectedPart?.base_unit}</div>
                  <div>採購單位：{selectedPart?.purchase_unit || '-'} / 換算率：{selectedPart?.purchase_to_base_rate || '-'}</div>
                  <div>最小領用：{selectedPart?.minimum_issue_qty}，拆包：{selectedPart?.allow_unpacking ? '允許' : '不允許'}，負庫存：{selectedLocation?.allow_negative_stock ? '允許' : '不允許'}</div>
                </div>
              )}

              <div className="grid grid-cols-[1fr_120px] gap-2">
                <input value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm" placeholder="數量" inputMode="decimal" />
                <select value={form.inputUnitType} onChange={(event) => setForm((prev) => ({ ...prev, inputUnitType: event.target.value as 'BASE' | 'PURCHASE' }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
                  <option value="BASE">基本</option>
                  <option value="PURCHASE" disabled={!selectedPart?.purchase_unit}>採購</option>
                </select>
              </div>
              <input value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm" placeholder="交易原因" />
              <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="備註" />
              <input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm((prev) => ({ ...prev, occurredAt: event.target.value }))} className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
              <button disabled={!canSubmit || posting} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                送出交易
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">庫存流水</h2>
              <p className="text-sm text-slate-500">
                依權限範圍顯示交易紀錄，共 {transactionMeta?.total ?? transactions.length} 筆
                {latestTransaction ? `，最新 ${latestTransaction.transaction_no} ${dateText(latestTransaction.occurred_at)}` : ''}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-[160px_220px]">
              <select value={transactionTypeFilter} onChange={(event) => setTransactionTypeFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
                <option value="">全部交易類型</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={transactionPartFilter} onChange={(event) => setTransactionPartFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
                <option value="">全部料件</option>
                {visibleTransactionParts.map((item) => <option key={`${item.location_id}-${item.part_id}`} value={item.part_id}>{partLabel(item.part)}</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">流水號</th>
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">位置 / 料件</th>
                  <th className="px-4 py-3 text-right">異動</th>
                  <th className="px-4 py-3 text-right">庫存</th>
                  <th className="px-4 py-3">原因</th>
                  <th className="px-4 py-3">時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500"><PackageSearch className="mx-auto mb-2 h-5 w-5" />目前沒有可顯示的庫存流水</td></tr>
                ) : transactions.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{row.transaction_no}</td>
                    <td className="px-4 py-3">{TYPE_LABELS[row.transaction_type] || row.transaction_type}</td>
                    <td className="px-4 py-3">
                      <div>{locationLabel(row.location)}</div>
                      <div className="text-xs text-slate-500">{partLabel(row.part)}</div>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${Number(row.quantity_base) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {numberText(row.quantity_base)} {row.part?.base_unit}
                    </td>
                    <td className="px-4 py-3 text-right">{numberText(row.balance_before)} → {numberText(row.balance_after)}</td>
                    <td className="px-4 py-3">{row.reason}</td>
                    <td className="px-4 py-3 text-slate-500">{dateText(row.occurred_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editingHolding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-slate-950">調整料件狀態</h2>
                <p className="mt-1 text-sm text-slate-500">{locationLabel(editingHolding.location)}｜{partLabel(editingHolding.part)}</p>
              </div>
              <button type="button" onClick={() => setEditingHolding(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="關閉"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                總持有 {numberText(editingHolding.quantity_base)} {editingHolding.base_unit || editingHolding.part?.base_unit || ''}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-semibold text-slate-700">
                  使用中
                  <input type="number" min="0" step="any" value={holdingDraft.inUse} onChange={(event) => setHoldingDraft((current) => ({ ...current, inUse: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  閒置可調撥
                  <input type="number" min="0" step="any" value={holdingDraft.idle} onChange={(event) => setHoldingDraft((current) => ({ ...current, idle: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
                </label>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                待確認：{numberText(Math.max(0, Number(editingHolding.quantity_base || 0) - Number(holdingDraft.inUse || 0) - Number(holdingDraft.idle || 0)))}
              </div>
              <label className="block text-sm font-semibold text-slate-700">
                備註
                <textarea value={holdingDraft.notes} onChange={(event) => setHoldingDraft((current) => ({ ...current, notes: event.target.value }))} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" placeholder="例如：安裝於 HH01 中島架" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setEditingHolding(null)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700">取消</button>
              <button type="button" onClick={() => void saveHolding()} disabled={savingHolding} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-bold text-white disabled:bg-slate-300">
                {savingHolding && <Loader2 className="h-4 w-4 animate-spin" />}儲存狀態
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
