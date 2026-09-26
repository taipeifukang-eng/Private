'use client';

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Send,
  TrendingDown,
  Wrench,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import {
  GeneralAffairsDashboardPage,
} from '@/components/general-affairs/GeneralAffairsPageTemplates';
import {
  GeneralAffairsEmptyState,
  GeneralAffairsErrorState,
  GeneralAffairsLoadingState,
} from '@/components/general-affairs/GeneralAffairsPageState';

type DashboardProps = {
  profileName: string;
  canAccessMaintenanceModule: boolean;
  canAccessInventory: boolean;
  canAccessInventoryLocations: boolean;
  canAccessEquipment: boolean;
  canAccessFacilities: boolean;
  canAccessParts: boolean;
  canAccessVendors: boolean;
};

type ApiMeta = {
  total?: number;
};

type BalanceRow = {
  id: string;
  quantity_base: number;
  quantity_on_hand?: number;
  last_transaction_at: string | null;
  location?: {
    name?: string | null;
    code?: string | null;
    location_type?: string | null;
    store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  } | null;
  part?: {
    id?: string;
    name?: string | null;
    part_code?: string | null;
    base_unit?: string | null;
  } | null;
};

type TransactionRow = {
  id: string;
  transaction_no: string;
  transaction_type: string;
  quantity_base: number;
  occurred_at: string;
  reason: string;
  location?: { name?: string | null; store?: { short_name?: string | null; store_name?: string | null } | null } | null;
  part?: { name?: string | null; part_code?: string | null; base_unit?: string | null } | null;
  creator?: { full_name?: string | null; email?: string | null } | null;
};

type InventoryOptionsData = {
  canPostTransactions?: boolean;
  partCatalogAccess?: boolean;
  locationParts?: Array<{
    id: string;
    location_id: string;
    part_id: string;
    safety_stock_qty: number | null;
    reorder_point_qty: number | null;
    currentBalance?: { quantity_base: number } | null;
    part?: {
      id: string;
      name?: string | null;
      part_code?: string | null;
      base_unit?: string | null;
    } | null;
  }>;
};

type InventoryDashboardState = {
  loading: boolean;
  balances: BalanceRow[];
  balanceMeta: ApiMeta | null;
  transactions: TransactionRow[];
  transactionMeta: ApiMeta | null;
  options: InventoryOptionsData | null;
  error: string;
  partialErrors: string[];
};

type ServiceRequestDashboardRow = {
  id: string;
  request_no?: string | null;
  title?: string | null;
  main_status: string;
  updated_at?: string | null;
};

type StoreTodoDashboardState = {
  loading: boolean;
  confirmation: number;
  supplement: number;
  total: number;
  actionItems: ServiceRequestDashboardRow[];
  error: string;
};

const EMPTY_INVENTORY_STATE: InventoryDashboardState = {
  loading: false,
  balances: [],
  balanceMeta: null,
  transactions: [],
  transactionMeta: null,
  options: null,
  error: '',
  partialErrors: [],
};

const EMPTY_STORE_TODO_STATE: StoreTodoDashboardState = {
  loading: false,
  confirmation: 0,
  supplement: 0,
  total: 0,
  actionItems: [],
  error: '',
};

const TYPE_LABELS: Record<string, string> = {
  RECEIPT: '入庫',
  ISSUE: '出庫',
  ADJUST_IN: '調增',
  ADJUST_OUT: '調減',
};

function safeMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '資料載入失敗');
  return raw
    .replace(/schema cache/gi, '系統資料狀態')
    .replace(/public\.[a-z0-9_]+/gi, '受保護資料表')
    .replace(/postgres|SQLSTATE|stack trace/gi, '系統診斷資訊')
    .replace(/migration_[a-z0-9_]+\.sql/gi, '系統版本資訊');
}

async function readJson(response: Response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok || json.success === false) {
    const error = json.error;
    if (typeof error === 'string') throw new Error(error);
    if (error && typeof error === 'object') throw new Error(error.message || error.code || '資料載入失敗');
    throw new Error('資料載入失敗');
  }
  return json;
}

function dateText(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function numberText(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

function getSevenDaysAgoIso() {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString();
}

function partLabel(part?: { part_code?: string | null; name?: string | null } | null) {
  return [part?.part_code, part?.name].filter(Boolean).join('｜') || '-';
}

function locationLabel(location?: BalanceRow['location'] | TransactionRow['location']) {
  if (!location) return '-';
  const store = location.store?.short_name || location.store?.store_name || '';
  return [location.name, store].filter(Boolean).join('｜') || '-';
}

type LowStockItem = {
  id: string;
  location_id: string;
  part_id: string;
  currentQty: number;
  threshold: number;
  part?: {
    id: string;
    name?: string | null;
    part_code?: string | null;
    base_unit?: string | null;
  } | null;
};

function CardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-bold text-slate-950">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  helper,
  href,
  tone = 'slate',
}: {
  label: string;
  value: number;
  helper: string;
  href?: string;
  tone?: 'slate' | 'orange' | 'red' | 'emerald';
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-white text-slate-950',
    orange: 'border-orange-200 bg-orange-50 text-orange-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];

  const content = (
    <div className={`min-h-[118px] rounded-lg border p-4 ${toneClass}`}>
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-normal">{numberText(value)}</div>
      <div className="mt-2 text-xs font-medium leading-5 text-slate-500">{helper}</div>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {content}
    </Link>
  );
}

function ActionLink({
  href,
  icon: Icon,
  label,
  highlighted = false,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  highlighted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex h-12 items-center gap-3 rounded-md border px-3 text-left transition-colors ${
        highlighted
          ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100'
          : 'border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/50'
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${highlighted ? 'bg-white text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 truncate text-sm font-bold text-slate-950">{label}</span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

export default function GeneralAffairsDashboardClient({
  profileName,
  canAccessMaintenanceModule,
  canAccessInventory,
  canAccessInventoryLocations,
  canAccessEquipment,
  canAccessFacilities,
  canAccessParts,
  canAccessVendors,
}: DashboardProps) {
  const [inventory, setInventory] = useState<InventoryDashboardState>(EMPTY_INVENTORY_STATE);
  const [storeTodos, setStoreTodos] = useState<StoreTodoDashboardState>(EMPTY_STORE_TODO_STATE);

  const loadInventoryDashboard = useCallback(async () => {
    if (!canAccessInventory) {
      setInventory(EMPTY_INVENTORY_STATE);
      return;
    }

    setInventory((current) => ({ ...current, loading: true, error: '', partialErrors: [] }));
    const transactionParams = new URLSearchParams({
      pageSize: '8',
      sort: 'occurred_at',
      sortOrder: 'desc',
      dateFrom: getSevenDaysAgoIso(),
    });

    const [balancesResult, transactionsResult, optionsResult] = await Promise.allSettled([
      fetch('/api/general-affairs/inventory/balances?pageSize=100&includeZero=true&sort=last_transaction_at&sortOrder=desc').then(readJson),
      fetch(`/api/general-affairs/inventory/transactions?${transactionParams.toString()}`).then(readJson),
      fetch('/api/general-affairs/inventory/options').then(readJson),
    ]);

    const partialErrors: string[] = [];
    const nextState: InventoryDashboardState = {
      loading: false,
      balances: [],
      balanceMeta: null,
      transactions: [],
      transactionMeta: null,
      options: null,
      error: '',
      partialErrors,
    };

    if (balancesResult.status === 'fulfilled') {
      nextState.balances = balancesResult.value.data || [];
      nextState.balanceMeta = balancesResult.value.meta || null;
    } else {
      partialErrors.push(`庫存餘額：${safeMessage(balancesResult.reason)}`);
    }

    if (transactionsResult.status === 'fulfilled') {
      nextState.transactions = transactionsResult.value.data || [];
      nextState.transactionMeta = transactionsResult.value.meta || null;
    } else {
      partialErrors.push(`庫存流水：${safeMessage(transactionsResult.reason)}`);
    }

    if (optionsResult.status === 'fulfilled') {
      nextState.options = optionsResult.value.data || null;
    } else {
      partialErrors.push(`庫存選項：${safeMessage(optionsResult.reason)}`);
    }

    if (!nextState.balances.length && !nextState.transactions.length && !nextState.options && partialErrors.length > 0) {
      nextState.error = '庫存工作台資料暫時無法載入。';
    }

    setInventory(nextState);
  }, [canAccessInventory]);

  const loadStoreTodos = useCallback(async () => {
    setStoreTodos((current) => ({ ...current, loading: true, error: '' }));
    try {
      const params = new URLSearchParams({ pageSize: '200', sort: 'updated_at', sortOrder: 'desc' });
      const json = await fetch(`/api/general-affairs/requests?${params.toString()}`).then(readJson);
      const rows = (json.data || []) as ServiceRequestDashboardRow[];
      const confirmation = rows.filter((row) => row.main_status === 'WAITING_STORE_CONFIRMATION').length;
      const supplement = rows.filter((row) => row.main_status === 'WAITING_STORE_SUPPLEMENT').length;
      const actionItems = rows
        .filter((row) => ['WAITING_STORE_CONFIRMATION', 'WAITING_STORE_SUPPLEMENT'].includes(row.main_status))
        .slice(0, 5);
      setStoreTodos({
        loading: false,
        confirmation,
        supplement,
        total: rows.length,
        actionItems,
        error: '',
      });
    } catch (error) {
      setStoreTodos({
        ...EMPTY_STORE_TODO_STATE,
        loading: false,
        error: safeMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    void loadInventoryDashboard();
  }, [loadInventoryDashboard]);

  useEffect(() => {
    void loadStoreTodos();
  }, [loadStoreTodos]);

  const lowStockItems = useMemo(() => {
    return (inventory.options?.locationParts || [])
      .map((item) => {
        const threshold = item.reorder_point_qty ?? item.safety_stock_qty;
        if (threshold === null || threshold === undefined) return null;
        const currentQty = Number(item.currentBalance?.quantity_base || 0);
        return currentQty <= Number(threshold)
          ? { ...item, currentQty, threshold: Number(threshold) }
          : null;
      })
      .filter(Boolean) as LowStockItem[];
  }, [inventory.options]);

  const negativeBalances = useMemo(
    () => inventory.balances.filter((balance) => Number(balance.quantity_base) < 0),
    [inventory.balances],
  );

  const visiblePartCount = useMemo(() => {
    const ids = new Set<string>();
    (inventory.options?.locationParts || []).forEach((item) => ids.add(item.part_id));
    return ids.size;
  }, [inventory.options]);
  const storeTodoHref = storeTodos.confirmation > 0
    ? '/general-affairs/reports/mine?status=WAITING_STORE_CONFIRMATION'
    : storeTodos.supplement > 0
      ? '/general-affairs/reports/mine?status=WAITING_STORE_SUPPLEMENT'
      : '/general-affairs/reports/mine';
  const quickActions = [
    {
      href: '/general-affairs/reports/new',
      icon: Send,
      label: '新增需求',
    },
    {
      href: storeTodoHref,
      icon: ClipboardList,
      label: '我的追蹤',
      highlighted: storeTodos.confirmation > 0 || storeTodos.supplement > 0,
    },
    canAccessMaintenanceModule && {
      href: '/general-affairs/requests',
      icon: ClipboardList,
      label: '總務需求工作台',
    },
    canAccessInventory && {
      href: '/general-affairs/inventory',
      icon: Package,
      label: '庫存管理',
    },
    canAccessInventoryLocations && {
      href: '/general-affairs/inventory/locations',
      icon: MapPin,
      label: '庫存位置',
    },
    canAccessEquipment && {
      href: '/general-affairs/equipment',
      icon: Wrench,
      label: '設備管理',
    },
    canAccessFacilities && {
      href: '/general-affairs/facilities',
      icon: Building2,
      label: '設施管理',
    },
    canAccessParts && {
      href: '/general-affairs/parts',
      icon: Boxes,
      label: '料件管理',
    },
    canAccessVendors && {
      href: '/general-affairs?section=vendors',
      icon: Briefcase,
      label: '廠商資料',
    },
    canAccessMaintenanceModule && {
      href: '/general-affairs/work-orders',
      icon: Wrench,
      label: '工單中心',
    },
  ].filter(Boolean) as Array<{ href: string; icon: ComponentType<{ className?: string }>; label: string; highlighted?: boolean }>;

  const kpiCards = [
    canAccessInventory && inventory.balanceMeta && {
      label: '庫存餘額項目',
      value: inventory.balanceMeta.total || 0,
      helper: '來自庫存餘額 API，依 RLS 範圍顯示。',
      href: '/general-affairs/inventory',
      tone: 'slate' as const,
    },
    canAccessInventory && inventory.transactionMeta && {
      label: '近 7 日庫存異動',
      value: inventory.transactionMeta.total || 0,
      helper: '來自庫存流水 API，不含無權限資料。',
      href: '/general-affairs/inventory',
      tone: 'emerald' as const,
    },
    canAccessInventory && inventory.options?.partCatalogAccess !== false && {
      label: '可用位置料件',
      value: visiblePartCount,
      helper: '來自庫存選項 API 的位置料件設定。',
      href: canAccessInventoryLocations ? '/general-affairs/inventory/locations' : undefined,
      tone: 'orange' as const,
    },
    canAccessInventory && inventory.balances.length > 0 && {
      label: '負庫存項目',
      value: negativeBalances.length,
      helper: '由目前可見餘額即時計算。',
      href: '/general-affairs/inventory',
      tone: negativeBalances.length > 0 ? 'red' as const : 'slate' as const,
    },
  ].filter(Boolean) as Array<{ label: string; value: number; helper: string; href?: string; tone?: 'slate' | 'orange' | 'red' | 'emerald' }>;

  const primaryAction = canAccessInventory ? (
    <Link
      href="/general-affairs/inventory"
      className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
    >
      前往庫存管理
      <ArrowRight className="h-4 w-4" />
    </Link>
  ) : undefined;
  return (
    <GeneralAffairsDashboardPage
      header={(
        <GeneralAffairsPageHeader
          eyebrow="GENERAL AFFAIRS"
          breadcrumbs={[{ label: '首頁', href: '/' }, { label: '總務服務中心' }]}
          title="總務服務中心"
          description={profileName ? `${profileName}，以下是你目前可處理的工作。` : '以下是你目前可處理的工作。'}
          primaryAction={primaryAction}
          statusBadge={<span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-bold text-orange-700">工作台</span>}
        />
      )}
      kpi={(
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-950">庫存摘要</h2>
            {canAccessInventory && (
              <button
                type="button"
                onClick={loadInventoryDashboard}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {inventory.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                重新整理
              </button>
            )}
          </div>

          {canAccessInventory && inventory.loading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-[118px] animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
              ))}
            </div>
          )}

          {!inventory.loading && kpiCards.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpiCards.map((card) => (
                <KpiCard key={card.label} {...card} />
              ))}
            </div>
          )}

          {!inventory.loading && kpiCards.length === 0 && (
            <GeneralAffairsEmptyState
              title="目前沒有可顯示的 KPI"
              description="本頁只顯示已有真實資料來源且你具備權限的 KPI；未完成的待審、待收貨、盤點與調撥不顯示假數字。"
            />
          )}
        </section>
      )}
      alerts={inventory.partialErrors.length > 0 ? (
        <GeneralAffairsErrorState
          title="部分資料暫時無法載入"
          description={inventory.partialErrors.join('；')}
        />
      ) : undefined}
      quickActions={(
        <CardShell title="可用功能">
          {quickActions.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {quickActions.map((action) => (
                <ActionLink key={action.href} {...action} />
              ))}
            </div>
          ) : (
            <GeneralAffairsEmptyState
              title="目前沒有可用入口"
              description="入口會依 effective permissions 與模組可用狀態顯示。"
            />
          )}
        </CardShell>
      )}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <CardShell title="我的待辦">
          {storeTodos.loading ? (
            <GeneralAffairsLoadingState title="載入門市待辦" />
          ) : storeTodos.actionItems.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {storeTodos.actionItems.map((item) => {
                const isConfirmation = item.main_status === 'WAITING_STORE_CONFIRMATION';
                const targetStatus = isConfirmation ? 'WAITING_STORE_CONFIRMATION' : 'WAITING_STORE_SUPPLEMENT';
                return (
                  <Link
                    key={item.id}
                    href={`/general-affairs/reports/mine?status=${targetStatus}&requestId=${encodeURIComponent(item.id)}`}
                    className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-emerald-50/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-950">{item.title || item.request_no || '總務事項'}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {item.request_no || '未編號'}｜{isConfirmation ? '請確認現場結果或收貨狀況' : '請補充照片、數量或現場說明'}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${isConfirmation ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                      {isConfirmation ? '待確認' : '待補資料'}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : storeTodos.error ? (
            <GeneralAffairsErrorState title="門市待辦載入失敗" description={storeTodos.error} />
          ) : canAccessInventory && inventory.loading ? (
            <GeneralAffairsLoadingState title="載入庫存待辦" />
          ) : inventory.error ? (
            <GeneralAffairsErrorState title="待辦載入失敗" description={inventory.error} />
          ) : lowStockItems.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {lowStockItems.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href="/general-affairs/inventory"
                  className="flex items-center justify-between gap-3 py-3 text-sm hover:bg-orange-50/50"
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-950">{partLabel(item.part)}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      目前 {numberText(item.currentQty)}，門檻 {numberText(item.threshold)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">低庫存</span>
                </Link>
              ))}
            </div>
          ) : canAccessInventory && inventory.options ? (
            <GeneralAffairsEmptyState
              title="目前沒有可處理庫存待辦"
              description="已成功讀取庫存資料，沒有低庫存或需立即處理的項目。"
            />
          ) : (
            <GeneralAffairsEmptyState
              title="目前沒有可處理項目"
              description="待辦只會顯示目前已完成後端且你具備權限的資料來源。"
            />
          )}
        </CardShell>

        <CardShell title="異常提醒">
          {canAccessInventory && inventory.loading ? (
            <GeneralAffairsLoadingState title="載入異常提醒" />
          ) : negativeBalances.length > 0 || lowStockItems.length > 0 ? (
            <div className="space-y-3">
              {negativeBalances.slice(0, 4).map((balance) => (
                <Link
                  key={balance.id}
                  href="/general-affairs/inventory"
                  className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-3"
                >
                  <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-bold text-red-900">{partLabel(balance.part)}</span>
                    <span className="mt-1 block text-xs text-red-700">
                      {locationLabel(balance.location)}｜目前 {numberText(balance.quantity_base)} {balance.part?.base_unit || ''}
                    </span>
                  </span>
                </Link>
              ))}
              {negativeBalances.length === 0 && lowStockItems.slice(0, 4).map((item) => (
                <Link
                  key={item.id}
                  href="/general-affairs/inventory"
                  className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 p-3"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-bold text-amber-900">{partLabel(item.part)}</span>
                    <span className="mt-1 block text-xs text-amber-700">
                      低於補貨或安全庫存門檻
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : canAccessInventory && inventory.options ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 className="mb-2 h-5 w-5" />
              目前可見庫存沒有低庫存或負庫存提醒。
            </div>
          ) : (
            <GeneralAffairsEmptyState
              title="目前沒有可顯示提醒"
              description="提醒只會顯示可由現有 API 安全判定的異常。"
            />
          )}
        </CardShell>
      </div>

      {canAccessInventory && (
        <CardShell title="最近庫存活動">
          {inventory.loading ? (
            <GeneralAffairsLoadingState title="載入最近活動" />
          ) : inventory.transactions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="hidden grid-cols-[150px_110px_minmax(0,1fr)_160px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500 md:grid">
                <span>時間</span>
                <span>類型</span>
                <span>料件 / 位置</span>
                <span>原因</span>
                <span className="text-right">數量</span>
              </div>
              <div className="divide-y divide-slate-100">
                {inventory.transactions.map((row) => (
                  <Link
                    key={row.id}
                    href="/general-affairs/inventory"
                    className="grid gap-2 px-4 py-3 text-sm hover:bg-slate-50 md:grid-cols-[150px_110px_minmax(0,1fr)_160px_110px] md:gap-3"
                  >
                    <span className="font-semibold text-slate-500">{dateText(row.occurred_at)}</span>
                    <span className="font-bold text-slate-900">{TYPE_LABELS[row.transaction_type] || row.transaction_type}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-950">{partLabel(row.part)}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{locationLabel(row.location)}</span>
                    </span>
                    <span className="truncate text-slate-600">{row.reason}</span>
                    <span className="font-black text-slate-950 md:text-right">
                      {numberText(row.quantity_base)} {row.part?.base_unit || ''}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <GeneralAffairsEmptyState
              title="目前沒有最近庫存活動"
              description="已成功查詢近 7 日庫存流水，沒有符合條件的資料。"
            />
          )}
        </CardShell>
      )}
    </GeneralAffairsDashboardPage>
  );
}
