'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Search, Wrench } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import {
  AssetBadge,
  AssetFilterPanel,
  AssetKpiGrid,
  AssetMaintenanceTimeline,
  buildDefaultAssetIcons,
  formatDate,
  type AssetMaintenanceRecord,
} from '@/components/general-affairs/assets/AssetManagementUI';

type AssetKind = 'equipment' | 'facility';

type MaintenanceRecord = AssetMaintenanceRecord & {
  equipment_id?: string | null;
  facility_id?: string | null;
  store_id?: string | null;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
};

type StoreOption = { id: string; store_code: string; store_name: string; short_name?: string | null };

const COPY = {
  equipment: {
    title: '設備維修紀錄',
    parentLabel: '設備管理',
    parentHref: '/general-affairs/equipment',
    description: '只讀取已連結 equipment_id 的既有 maintenance_requests，不建立第二套設備維修資料。',
    empty: '目前沒有已連結設備的維修紀錄。',
  },
  facility: {
    title: '設施維修紀錄',
    parentLabel: '設施管理',
    parentHref: '/general-affairs/facilities',
    description: '只讀取已連結 facility_id 的既有 maintenance_requests，不建立第二套設施維修資料。',
    empty: '目前沒有已連結設施的維修紀錄。',
  },
} satisfies Record<AssetKind, Record<string, string>>;

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || '維修紀錄載入失敗');
  return json;
}

function formatStore(store?: MaintenanceRecord['store']) {
  if (!store) return '-';
  return `${store.store_code || ''} ${store.short_name || store.store_name || ''}`.trim() || '-';
}

function statusTone(status?: string | null): 'green' | 'amber' | 'blue' | 'slate' {
  if (!status) return 'slate';
  if (['completed', 'done', 'closed', 'RESOLVED', 'COMPLETED'].includes(status)) return 'green';
  if (['processing', 'in_progress', 'IN_PROGRESS'].includes(status)) return 'blue';
  if (['pending', 'new', 'OPEN'].includes(status)) return 'amber';
  return 'slate';
}

export default function AssetMaintenanceHistoryClient({ kind }: { kind: AssetKind }) {
  const copy = COPY[kind];
  const icons = useMemo(() => buildDefaultAssetIcons(), []);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/maintenance-requests?source=general_affairs&pageSize=100');
      const json = await parseResponse(response);
      const rows = ((json.data || []) as MaintenanceRecord[])
        .filter((record) => kind === 'equipment' ? Boolean(record.equipment_id) : Boolean(record.facility_id));
      setRecords(rows);
      const storeMap = new Map<string, StoreOption>();
      rows.forEach((record) => {
        if (!record.store_id) return;
        storeMap.set(record.store_id, {
          id: record.store_id,
          store_code: record.store?.store_code || record.store_id.slice(0, 8),
          store_name: record.store?.store_name || record.store_id,
          short_name: record.store?.short_name || null,
        });
      });
      setStores(Array.from(storeMap.values()).sort((a, b) => a.store_code.localeCompare(b.store_code)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '維修紀錄載入失敗');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records.filter((record) => {
      if (storeFilter && record.store_id !== storeFilter) return false;
      if (statusFilter && record.status !== statusFilter) return false;
      if (!needle) return true;
      return [record.title, record.description, record.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [records, search, statusFilter, storeFilter]);

  const statuses = useMemo(() => Array.from(new Set(records.map((record) => record.status).filter(Boolean))) as string[], [records]);
  const kpis = useMemo(() => {
    const active = records.filter((record) => statusTone(record.status) !== 'green').length;
    const completed = records.length - active;
    return [
      { id: 'total', label: '維修紀錄', value: records.length, description: '目前可讀且已連結資產的紀錄', icon: icons.maintenance },
      { id: 'active', label: '未完成', value: active, description: '狀態尚未完成或結案', tone: active ? 'amber' as const : 'green' as const, icon: icons.attention },
      { id: 'completed', label: '已完成', value: completed, description: '已完成或已結案紀錄', tone: 'green' as const, icon: icons.active },
      { id: 'stores', label: '涉及門市', value: stores.length, description: '依目前 API / RLS 可讀範圍統計', tone: 'blue' as const, icon: icons.category },
    ];
  }, [icons, records, stores.length]);

  const header = (
    <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: copy.parentLabel, href: copy.parentHref },
        { label: copy.title },
      ]}
      title={copy.title}
      description={copy.description}
    />
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsListPage
        header={header}
        kpi={<AssetKpiGrid items={kpis} />}
        filters={(
          <AssetFilterPanel>
            <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                  placeholder="搜尋工單、標題或問題描述"
                />
              </label>
              <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
                <option value="">全部門市</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} {store.short_name || store.store_name}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
                <option value="">全部狀態</option>
                {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          </AssetFilterPanel>
        )}
      >
        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            載入維修紀錄
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />維修紀錄暫不可讀</div>
            <p className="mt-2">{error}</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">{copy.empty}</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">工單</th>
                    <th className="px-4 py-3">門市</th>
                    <th className="px-4 py-3">問題描述</th>
                    <th className="px-4 py-3">狀態</th>
                    <th className="px-4 py-3">建立時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{record.title || '未命名工單'}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.id}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatStore(record.store)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <p className="line-clamp-2">{record.description || '-'}</p>
                      </td>
                      <td className="px-4 py-3"><AssetBadge tone={statusTone(record.status)}>{record.status || '未標示'}</AssetBadge></td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(record.reported_at || record.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 lg:hidden">
              {filteredRecords.map((record) => (
                <div key={record.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-orange-50 p-2 text-orange-700"><Wrench className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">{record.title || '未命名工單'}</div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">{record.description || '-'}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <AssetBadge tone={statusTone(record.status)}>{record.status || '未標示'}</AssetBadge>
                        <span className="text-xs text-slate-400">{formatDate(record.reported_at || record.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GeneralAffairsListPage>
    </main>
  );
}
