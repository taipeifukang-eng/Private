'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, ImageIcon, Loader2, Search, ShieldCheck } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import {
  AssetBadge,
  AssetFilterPanel,
  AssetKpiGrid,
  buildDefaultAssetIcons,
  formatDate,
} from '@/components/general-affairs/assets/AssetManagementUI';

type EquipmentWarrantyRow = {
  id: string;
  name: string;
  asset_code: string | null;
  brand: string | null;
  model: string | null;
  has_warranty: boolean;
  warranty_end_date: string | null;
  specs?: Record<string, unknown> | null;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  category?: { name?: string | null } | null;
};

type WarrantyAttachment = {
  id: string;
  file_name: string;
  content_type: string;
  purpose: string;
  signed_url: string | null;
};

const WARRANTY_CLAIM_METHOD_LABELS: Record<string, string> = {
  INVOICE_OR_RECEIPT: '保留購買方發票／收據',
  ONLINE_REGISTRATION: '上網登錄保固',
  SERIAL_NUMBER_REGISTRATION: '序號登錄保固',
  VENDOR_WARRANTY_CARD: '供應商／原廠保固卡',
  CONTRACT_OR_QUOTATION: '合約／報價單約定',
  NO_DOCUMENT_REQUIRED: '免單據，依序號或購買紀錄',
  OTHER: '其他方式',
};

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || '保固資料載入失敗');
  return json;
}

function getWarrantyState(row: EquipmentWarrantyRow) {
  if (!row.has_warranty) return { label: '無保固', tone: 'slate' as const, bucket: 'none' };
  if (!row.warranty_end_date) return { label: '保固日未填', tone: 'amber' as const, bucket: 'missing' };
  const end = new Date(row.warranty_end_date);
  const diffDays = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return { label: '已過保', tone: 'red' as const, bucket: 'expired' };
  if (diffDays <= 30) return { label: `${diffDays} 天內到期`, tone: 'amber' as const, bucket: 'expiring' };
  return { label: formatDate(row.warranty_end_date), tone: 'green' as const, bucket: 'active' };
}

function formatStore(row: EquipmentWarrantyRow) {
  const store = row.store;
  if (!store) return '-';
  return `${store.store_code || ''} ${store.short_name || store.store_name || ''}`.trim() || '-';
}

function getWarrantyClaimMethod(row: EquipmentWarrantyRow) {
  const value = typeof row.specs?.warranty_claim_method === 'string' ? row.specs.warranty_claim_method : '';
  return WARRANTY_CLAIM_METHOD_LABELS[value] || '未設定';
}

function getWarrantyClaimNotes(row: EquipmentWarrantyRow) {
  return typeof row.specs?.warranty_claim_notes === 'string' ? row.specs.warranty_claim_notes : '';
}

function WarrantyDocumentLinks({ attachments }: { attachments: WarrantyAttachment[] }) {
  if (!attachments.length) return <span className="text-xs text-slate-400">尚無文件</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const isImage = attachment.content_type.startsWith('image/');
        return (
          <a
            key={attachment.id}
            href={attachment.signed_url || '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:border-orange-200 hover:text-orange-700"
          >
            {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            {attachment.file_name}
          </a>
        );
      })}
    </div>
  );
}

export default function EquipmentWarrantyClient() {
  const icons = useMemo(() => buildDefaultAssetIcons(), []);
  const [items, setItems] = useState<EquipmentWarrantyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState('');
  const [warrantyAttachments, setWarrantyAttachments] = useState<Record<string, WarrantyAttachment[]>>({});

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/general-affairs/equipment?pageSize=100&sortBy=warranty_end_date&sortDir=asc');
      const json = await parseResponse(response);
      setItems((json.data || []) as EquipmentWarrantyRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保固資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWarrantyAttachments = useCallback(async (records: EquipmentWarrantyRow[]) => {
    if (!records.length) {
      setWarrantyAttachments({});
      return;
    }

    const entries = await Promise.all(records.map(async (item): Promise<[string, WarrantyAttachment[]]> => {
      try {
        const query = new URLSearchParams({ resourceType: 'EQUIPMENT', resourceId: item.id });
        const response = await fetch(`/api/general-affairs/attachments?${query.toString()}`);
        if (!response.ok) return [item.id, []];
        const json = await response.json().catch(() => ({}));
        const attachments = ((json.data || []) as WarrantyAttachment[])
          .filter((attachment) => attachment.purpose === 'WARRANTY_DOCUMENT');
        return [item.id, attachments];
      } catch {
        return [item.id, []];
      }
    }));

    setWarrantyAttachments(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadWarrantyAttachments(items).catch(() => setWarrantyAttachments({}));
  }, [items, loadWarrantyAttachments]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const state = getWarrantyState(item);
      if (bucket && state.bucket !== bucket) return false;
      if (!needle) return true;
      return [item.name, item.asset_code, item.brand, item.model, item.category?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [bucket, items, search]);

  const kpis = useMemo(() => {
    const states = items.map(getWarrantyState);
    const count = (target: string) => states.filter((state) => state.bucket === target).length;
    return [
      { id: 'total', label: '設備總數', value: items.length, description: '目前查詢範圍內設備', icon: icons.total },
      { id: 'active', label: '保固中', value: count('active'), description: '保固日期有效且超過 30 天', tone: 'green' as const, icon: icons.warranty },
      { id: 'expiring', label: '即將到期', value: count('expiring'), description: '30 天內到期', tone: count('expiring') ? 'amber' as const : 'slate' as const, icon: icons.attention },
      { id: 'expired', label: '已過保', value: count('expired'), description: '保固日期已過', tone: count('expired') ? 'red' as const : 'slate' as const, icon: icons.archive },
    ];
  }, [icons, items]);

  const header = (
    <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: '設備管理', href: '/general-affairs/equipment' },
        { label: '保固管理' },
      ]}
      title="保固管理"
      description="彙整設備主檔保固狀態、申請保固方式，以及已上傳的發票、單據、圖片與 PDF 文件。"
    />
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsListPage
        header={header}
        kpi={<AssetKpiGrid items={kpis} />}
        filters={(
          <AssetFilterPanel>
            <div className="grid gap-3 md:grid-cols-[1.5fr_1fr]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="搜尋設備、品牌、型號、資產編號" />
              </label>
              <select value={bucket} onChange={(event) => setBucket(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
                <option value="">全部保固狀態</option>
                <option value="active">保固中</option>
                <option value="expiring">即將到期</option>
                <option value="expired">已過保</option>
                <option value="missing">保固日未填</option>
                <option value="none">無保固</option>
              </select>
            </div>
          </AssetFilterPanel>
        )}
      >
        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />載入保固資料</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800"><AlertCircle className="mb-2 h-4 w-4" />{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">目前沒有符合條件的保固資料。</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="hidden min-w-[1180px] w-full text-left text-sm lg:table">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">設備</th>
                  <th className="px-4 py-3">門市</th>
                  <th className="px-4 py-3">分類</th>
                  <th className="px-4 py-3">申請保固方式</th>
                  <th className="px-4 py-3">文件 / 單據</th>
                  <th className="px-4 py-3">保固到期</th>
                  <th className="px-4 py-3">保固狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{[item.asset_code, item.brand, item.model].filter(Boolean).join(' / ') || '未填資產資訊'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatStore(item)}</td>
                    <td className="px-4 py-3 text-slate-600">{item.category?.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-semibold text-slate-700">{getWarrantyClaimMethod(item)}</div>
                      {getWarrantyClaimNotes(item) && <div className="mt-1 max-w-[220px] truncate text-xs text-slate-400">{getWarrantyClaimNotes(item)}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <WarrantyDocumentLinks attachments={warrantyAttachments[item.id] || []} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.warranty_end_date)}</td>
                    <td className="px-4 py-3"><AssetBadge tone={getWarrantyState(item).tone}>{getWarrantyState(item).label}</AssetBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="divide-y divide-slate-100 lg:hidden">
              {filtered.map((item) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-orange-50 p-2 text-orange-700"><ShieldCheck className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatStore(item)} / {formatDate(item.warranty_end_date)}</div>
                      <div className="mt-2 text-xs text-slate-600">申請方式：{getWarrantyClaimMethod(item)}</div>
                      {getWarrantyClaimNotes(item) && <div className="mt-1 text-xs text-slate-500">{getWarrantyClaimNotes(item)}</div>}
                      <div className="mt-2"><WarrantyDocumentLinks attachments={warrantyAttachments[item.id] || []} /></div>
                      <div className="mt-2"><AssetBadge tone={getWarrantyState(item).tone}>{getWarrantyState(item).label}</AssetBadge></div>
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
