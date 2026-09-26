'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Archive, Building2, FileText, Loader2, ShieldCheck } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { AssetBadge, AssetKpiGrid, formatDate } from '@/components/general-affairs/assets/AssetManagementUI';

type StoreOption = { id: string; store_code: string; store_name: string; short_name?: string | null };
type CategoryOption = { id: string; name: string; code: string };

type FacilityWarrantyRow = {
  id: string;
  name: string;
  facility_code: string | null;
  area: string | null;
  location_detail: string | null;
  specs?: Record<string, unknown> | null;
  store?: StoreOption | null;
  category?: CategoryOption | null;
};

type WarrantyAttachment = {
  id: string;
  purpose: string;
  file_name: string;
  content_type: string;
  signed_url: string | null;
};

const WARRANTY_CLAIM_METHOD_LABELS: Record<string, string> = {
  INVOICE_OR_RECEIPT: '保留購買方發票／收據',
  ONLINE_REGISTRATION: '上網登錄保固',
  SERIAL_NUMBER_REGISTRATION: '序號登錄保固',
  VENDOR_WARRANTY_CARD: '供應商／原廠保固卡',
  CONTRACT_OR_QUOTATION: '合約／報價單約定',
  NO_DOCUMENT_REQUIRED: '免單據，依序號或購買紀錄',
  OTHER: '其他方式，請於備註補充',
};

async function parseResponse(response: Response, fallback = '設施保固資料載入失敗') {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || fallback);
  return json;
}

function formatStore(store?: StoreOption | null) {
  return store ? `${store.store_code} ${store.short_name || store.store_name}` : '-';
}

function formatLocation(row: FacilityWarrantyRow) {
  return [row.area, row.location_detail].filter(Boolean).join(' / ') || '-';
}

function hasWarranty(row: FacilityWarrantyRow) {
  return row.specs?.facility_has_warranty === true;
}

function getWarrantyEndDate(row: FacilityWarrantyRow) {
  const value = row.specs?.facility_warranty_end_date;
  return typeof value === 'string' ? value : null;
}

function getWarrantyClaimMethod(row: FacilityWarrantyRow) {
  const value = row.specs?.facility_warranty_claim_method;
  return typeof value === 'string' ? value : '';
}

function getWarrantyClaimNotes(row: FacilityWarrantyRow) {
  const value = row.specs?.facility_warranty_claim_notes;
  return typeof value === 'string' ? value : '';
}

function getWarrantyState(row: FacilityWarrantyRow) {
  if (!hasWarranty(row)) return { label: '無保固', tone: 'slate' as const, bucket: 'none' };
  const endDate = getWarrantyEndDate(row);
  if (!endDate) return { label: '保固日未填', tone: 'amber' as const, bucket: 'missing' };
  const end = new Date(endDate);
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: '已過保', tone: 'red' as const, bucket: 'expired' };
  if (days <= 30) return { label: `${days} 天內到期`, tone: 'amber' as const, bucket: 'expiring' };
  return { label: formatDate(endDate), tone: 'green' as const, bucket: 'active' };
}

function AttachmentLinks({ attachments }: { attachments: WarrantyAttachment[] }) {
  if (!attachments.length) return <span className="text-xs text-slate-400">尚未上傳</span>;
  return (
    <div className="flex flex-col gap-1">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.signed_url || '#'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-800"
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">{attachment.file_name}</span>
        </a>
      ))}
    </div>
  );
}

export default function FacilityWarrantyClient() {
  const [items, setItems] = useState<FacilityWarrantyRow[]>([]);
  const [attachments, setAttachments] = useState<Record<string, WarrantyAttachment[]>>({});
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/general-affairs/facilities?pageSize=100&sortBy=updated_at&sortOrder=desc');
      const json = await parseResponse(response);
      setItems(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '設施保固資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!items.length) {
      setAttachments({});
      return;
    }
    let cancelled = false;
    async function loadAttachments() {
      const entries = await Promise.all(items.map(async (item) => {
        try {
          const query = new URLSearchParams({ resourceType: 'FACILITY', resourceId: item.id });
          const response = await fetch(`/api/general-affairs/attachments?${query.toString()}`);
          const json = await parseResponse(response, '設施附件載入失敗');
          return [item.id, (json.data || []) as WarrantyAttachment[]] as const;
        } catch {
          return [item.id, []] as const;
        }
      }));
      if (!cancelled) setAttachments(Object.fromEntries(entries));
    }
    loadAttachments();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const state = getWarrantyState(item);
      if (statusFilter && state.bucket !== statusFilter) return false;
      if (!keyword) return true;
      return [
        item.name,
        item.facility_code,
        item.store?.store_code,
        item.store?.store_name,
        item.category?.name,
        item.area,
        item.location_detail,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [items, search, statusFilter]);

  const kpis = useMemo(() => {
    const count = (bucket: string) => items.filter((item) => getWarrantyState(item).bucket === bucket).length;
    const attention = count('missing') + count('expiring') + count('expired');
    return [
      { id: 'total', label: '設施保固資料', value: items.length, description: '目前可讀設施主檔', icon: <Building2 className="h-4 w-4" /> },
      { id: 'active', label: '保固中', value: count('active'), description: '保固日期有效且超過 30 天', tone: 'green' as const, icon: <ShieldCheck className="h-4 w-4" /> },
      { id: 'attention', label: '保固需確認', value: attention, description: '已過保、即將到期或保固日未填', tone: attention ? 'amber' as const : 'slate' as const, icon: <AlertCircle className="h-4 w-4" /> },
      { id: 'none', label: '無保固', value: count('none'), description: '未標記設施保固', tone: 'slate' as const, icon: <Archive className="h-4 w-4" /> },
    ];
  }, [items]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '設施管理', href: '/general-affairs/facilities' },
          { label: '保固管理' },
        ]}
        title="設施保固管理"
        description="彙整設施主檔保固狀態、申請保固方式，以及設施附件中的單據、圖片與文件。"
      />

      <div className="mt-5 space-y-4">
        <AssetKpiGrid items={kpis} />

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋設施、編號、據點、分類或位置"
              className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="">全部保固狀態</option>
              <option value="active">保固中</option>
              <option value="expiring">30 天內到期</option>
              <option value="expired">已過保</option>
              <option value="missing">保固日未填</option>
              <option value="none">無保固</option>
            </select>
          </div>
        </section>

        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />載入設施保固資料</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">{error}</div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">目前沒有符合條件的設施保固資料。</div>
        ) : (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[1080px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">設施</th>
                    <th className="px-4 py-3">據點 / 位置</th>
                    <th className="px-4 py-3">申請保固方式</th>
                    <th className="px-4 py-3">文件 / 單據</th>
                    <th className="px-4 py-3">保固到期</th>
                    <th className="px-4 py-3">保固狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.map((item) => {
                    const method = getWarrantyClaimMethod(item);
                    const notes = getWarrantyClaimNotes(item);
                    const state = getWarrantyState(item);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.facility_code || '未編號'} · {item.category?.name || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{formatStore(item.store)}</div>
                          <div className="mt-1 text-xs text-slate-400">{formatLocation(item)}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{WARRANTY_CLAIM_METHOD_LABELS[method] || '-'}</div>
                          {notes && <div className="mt-1 text-xs text-slate-400">{notes}</div>}
                        </td>
                        <td className="px-4 py-3"><AttachmentLinks attachments={attachments[item.id] || []} /></td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(getWarrantyEndDate(item))}</td>
                        <td className="px-4 py-3"><AssetBadge tone={state.tone}>{state.label}</AssetBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 lg:hidden">
              {filteredItems.map((item) => {
                const method = getWarrantyClaimMethod(item);
                const state = getWarrantyState(item);
                return (
                  <div key={item.id} className="space-y-3 p-4">
                    <div>
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatStore(item.store)} / {formatLocation(item)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2"><AssetBadge tone={state.tone}>{state.label}</AssetBadge></div>
                    <div className="text-sm text-slate-600">保固到期：{formatDate(getWarrantyEndDate(item))}</div>
                    <div className="text-sm text-slate-600">申請方式：{WARRANTY_CLAIM_METHOD_LABELS[method] || '-'}</div>
                    <AttachmentLinks attachments={attachments[item.id] || []} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
