'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  INVENTORY_LOCATION_TYPES,
  PREFERRED_ISSUE_UNIT_TYPES,
  type InventoryLocationType,
  type PreferredIssueUnitType,
} from '@/lib/general-affairs/inventory/locations/types';
import { createClient } from '@/lib/supabase/client';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
  short_name?: string | null;
};

type PartOption = {
  id: string;
  category_id: string;
  name: string;
  part_code: string | null;
  brand: string | null;
  model: string | null;
  base_unit: string;
  purchase_unit: string | null;
  purchase_to_base_rate: number | null;
};

type InventoryLocation = {
  id: string;
  code: string | null;
  name: string;
  location_type: InventoryLocationType;
  store_id: string | null;
  description: string | null;
  is_active: boolean;
  allow_negative_stock: boolean;
  is_default: boolean;
  updated_at: string;
  store?: StoreOption | null;
};

type LocationPart = {
  id: string;
  location_id: string;
  part_id: string;
  is_active: boolean;
  safety_stock_qty: number | null;
  reorder_point_qty: number | null;
  maximum_stock_qty: number | null;
  preferred_issue_unit_type: PreferredIssueUnitType | null;
  resolvedPreferredIssueUnit: string | null;
  notes: string | null;
  part?: PartOption & { category?: { id: string; name: string; code: string } | null };
};

type LocationForm = {
  code: string;
  name: string;
  location_type: InventoryLocationType;
  store_id: string;
  description: string;
  is_active: boolean;
  allow_negative_stock: boolean;
  is_default: boolean;
};

type LocationPartForm = {
  part_id: string;
  is_active: boolean;
  safety_stock_qty: string;
  reorder_point_qty: string;
  maximum_stock_qty: string;
  preferred_issue_unit_type: '' | PreferredIssueUnitType;
  notes: string;
};

type Message = { type: 'success' | 'error'; text: string } | null;

const EMPTY_LOCATION_FORM: LocationForm = {
  code: '',
  name: '',
  location_type: 'STORE',
  store_id: '',
  description: '',
  is_active: true,
  allow_negative_stock: false,
  is_default: false,
};

const EMPTY_LOCATION_PART_FORM: LocationPartForm = {
  part_id: '',
  is_active: true,
  safety_stock_qty: '',
  reorder_point_qty: '',
  maximum_stock_qty: '',
  preferred_issue_unit_type: '',
  notes: '',
};

const LOCATION_TYPE_LABELS: Record<InventoryLocationType, string> = {
  CENTRAL_WAREHOUSE: '中央總倉',
  STORE: '門市',
  OFFICE: '辦公室',
  TEMPORARY: '暫存',
  OTHER: '其他',
};

const UNIT_TYPE_LABELS: Record<PreferredIssueUnitType, string> = {
  BASE: '基本單位',
  PURCHASE: '採購單位',
};

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || '操作失敗');
  return json;
}

function nullableNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

export default function InventoryLocationsClient() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<InventoryLocation[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [parts, setParts] = useState<PartOption[]>([]);
  const [locationParts, setLocationParts] = useState<LocationPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partSaving, setPartSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [partCatalogDenied, setPartCatalogDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryLocation | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_LOCATION_FORM);
  const [partForm, setPartForm] = useState<LocationPartForm>(EMPTY_LOCATION_PART_FORM);
  const [dirty, setDirty] = useState(false);

  const canSubmit = form.name.trim() && (form.location_type !== 'STORE' || form.store_id);
  const activeLocationCount = useMemo(() => items.filter((item) => item.is_active).length, [items]);
  const defaultLocationCount = useMemo(() => items.filter((item) => item.is_default).length, [items]);
  const storeLocationCount = useMemo(() => items.filter((item) => item.location_type === 'STORE').length, [items]);
  const centralLocationCount = useMemo(() => items.filter((item) => item.location_type === 'CENTRAL_WAREHOUSE').length, [items]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '50', sortBy: 'updated_at', sortOrder: 'desc' });
    if (search.trim()) params.set('search', search.trim());
    if (typeFilter) params.set('locationType', typeFilter);
    if (storeFilter) params.set('storeId', storeFilter);
    if (activeFilter) params.set('isActive', activeFilter);
    return params.toString();
  }, [activeFilter, search, storeFilter, typeFilter]);

  const loadOptions = useCallback(async () => {
    const [storesRes, partsRes, permissionRes] = await Promise.all([
      supabase
        .from('stores')
        .select('id, store_code, store_name, short_name')
        .eq('is_active', true)
        .order('store_code'),
      fetch('/api/general-affairs/parts?pageSize=200&isActive=true'),
      fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionCode: 'general_affairs.inventory_location.manage' }),
      }),
    ]);

    if (!storesRes.error) setStores((storesRes.data || []) as StoreOption[]);

    if (partsRes.ok) {
      const json = await partsRes.json();
      setParts(json.data || []);
      setPartCatalogDenied(false);
    } else if (partsRes.status === 403) {
      setParts([]);
      setPartCatalogDenied(true);
    }

    if (permissionRes.ok) {
      const json = await permissionRes.json();
      setCanManage(json.allowed === true);
    }
  }, [supabase]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      const response = await fetch(`/api/general-affairs/inventory/locations?${queryString}`);
      if (response.status === 403) setPermissionDenied(true);
      const json = await parseResponse(response);
      setItems(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入庫存位置失敗');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadLocationParts = useCallback(async (locationId: string) => {
    try {
      const response = await fetch(`/api/general-affairs/inventory/locations/${locationId}/parts?pageSize=100`);
      const json = await parseResponse(response);
      setLocationParts(json.data || []);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '載入位置料件失敗' });
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_LOCATION_FORM);
    setLocationParts([]);
    setPartForm(EMPTY_LOCATION_PART_FORM);
    setDirty(false);
    setDialogOpen(true);
  }

  async function openEdit(item: InventoryLocation) {
    setEditing(item);
    setForm({
      code: item.code || '',
      name: item.name || '',
      location_type: item.location_type,
      store_id: item.store_id || '',
      description: item.description || '',
      is_active: item.is_active,
      allow_negative_stock: item.allow_negative_stock,
      is_default: item.is_default,
    });
    setPartForm(EMPTY_LOCATION_PART_FORM);
    setDirty(false);
    setDialogOpen(true);
    await loadLocationParts(item.id);
  }

  function updateForm<K extends keyof LocationForm>(key: K, value: LocationForm[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'location_type' && value !== 'STORE') next.store_id = '';
      if (key === 'is_active' && value === false) next.is_default = false;
      return next;
    });
    setDirty(true);
  }

  function updatePartForm<K extends keyof LocationPartForm>(key: K, value: LocationPartForm[K]) {
    setPartForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function closeDialog() {
    if (dirty && !window.confirm('尚有未儲存變更，確定要離開嗎？')) return;
    setDialogOpen(false);
    setDirty(false);
  }

  function buildLocationPayload() {
    return {
      code: form.code || null,
      name: form.name,
      location_type: form.location_type,
      store_id: form.location_type === 'STORE' ? form.store_id : null,
      description: form.description || null,
      is_active: form.is_active,
      allow_negative_stock: form.allow_negative_stock,
      is_default: form.is_default,
    };
  }

  async function submitLocation(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(editing ? `/api/general-affairs/inventory/locations/${editing.id}` : '/api/general-affairs/inventory/locations', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildLocationPayload()),
      });
      const json = await parseResponse(response);
      setMessage({ type: 'success', text: editing ? '庫存位置已更新' : '庫存位置已新增' });
      setDirty(false);
      if (!editing) {
        await openEdit(json.data as InventoryLocation);
      } else {
        await loadItems();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '儲存失敗' });
    } finally {
      setSaving(false);
    }
  }

  async function softDeleteLocation(item: InventoryLocation) {
    const reason = window.prompt(`請輸入刪除「${item.name}」的原因`);
    if (!reason) return;
    try {
      const response = await fetch(`/api/general-affairs/inventory/locations/${item.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: '庫存位置已 soft delete，位置料件設定也已一併處理' });
      await loadItems();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '刪除失敗' });
    }
  }

  async function addLocationPart() {
    if (!editing || !partForm.part_id) return;
    setPartSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/inventory/locations/${editing.id}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          part_id: partForm.part_id,
          is_active: partForm.is_active,
          safety_stock_qty: nullableNumber(partForm.safety_stock_qty),
          reorder_point_qty: nullableNumber(partForm.reorder_point_qty),
          maximum_stock_qty: nullableNumber(partForm.maximum_stock_qty),
          preferred_issue_unit_type: partForm.preferred_issue_unit_type || null,
          notes: partForm.notes || null,
        }),
      });
      await parseResponse(response);
      setPartForm(EMPTY_LOCATION_PART_FORM);
      setDirty(false);
      setMessage({ type: 'success', text: '位置料件設定已新增' });
      await loadLocationParts(editing.id);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '新增位置料件失敗' });
    } finally {
      setPartSaving(false);
    }
  }

  async function deleteLocationPart(item: LocationPart) {
    if (!editing) return;
    const reason = window.prompt('請輸入刪除此位置料件設定的原因');
    if (!reason) return;
    try {
      const response = await fetch(`/api/general-affairs/inventory/locations/${editing.id}/parts/${item.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: '位置料件設定已 soft delete' });
      await loadLocationParts(editing.id);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '刪除位置料件失敗' });
    }
  }

  if (permissionDenied) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 md:px-8">
        <div className="rounded-lg border border-orange-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-orange-500" />
          <h1 className="text-lg font-bold text-slate-900">沒有庫存位置權限</h1>
          <p className="mt-2 text-sm text-slate-500">請確認是否具備庫存位置查看權限，或是否為該門市管理者。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
            首頁 / 總務服務中心 / 庫存管理 / 位置與料件設定
          </nav>
          <div className="mt-2 text-sm font-semibold text-orange-700">總務服務中心</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">庫存位置與料件設定</h1>
          <p className="mt-1 text-sm text-slate-500">設定庫存位置、門市範圍與位置可管理料件</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700">
            <Plus className="h-4 w-4" />
            新增位置
          </button>
        )}
      </div>

      <nav className="mb-4 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm sm:flex-row" aria-label="庫存管理子頁">
        <Link
          href="/general-affairs/inventory"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ClipboardList className="h-4 w-4" />
          庫存交易與餘額
        </Link>
        <Link
          href="/general-affairs/inventory/locations"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange-600 px-4 font-semibold text-white"
          aria-current="page"
        >
          <MapPin className="h-4 w-4" />
          位置與料件設定
        </Link>
      </nav>

      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${messageClass(message.type)}`}>
          {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {canManage && partCatalogDenied && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          缺少 general_affairs.part.view，因此無法新增位置料件設定。
        </div>
      )}

      <section className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">可見位置</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{items.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">啟用位置</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{activeLocationCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">門市 / 總倉</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{storeLocationCount} / {centralLocationCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">預設位置</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{defaultLocationCount}</div>
        </div>
      </section>

      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋位置名稱、代碼、描述" className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="">全部類型</option>
            {INVENTORY_LOCATION_TYPES.map((type) => <option key={type} value={type}>{LOCATION_TYPE_LABELS[type]}</option>)}
          </select>
          <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="">全部門市</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} {store.short_name || store.store_name}</option>)}
          </select>
          <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <option value="">全部狀態</option>
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-56 items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            載入庫存位置
          </div>
        ) : error ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-red-600">
            <AlertCircle className="h-6 w-6" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-slate-500">
            <MapPin className="h-6 w-6 text-slate-400" />
            目前沒有符合條件的庫存位置
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">位置</th>
                  <th className="px-4 py-3">類型</th>
                  <th className="px-4 py-3">門市</th>
                  <th className="px-4 py-3">政策</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-orange-50/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.code || '未編代碼'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{LOCATION_TYPE_LABELS[item.location_type]}</td>
                    <td className="px-4 py-3 text-slate-700">{item.store?.short_name || item.store?.store_name || '-'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {[item.is_default ? '預設' : null, item.allow_negative_stock ? '允許負庫存' : null].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {item.is_active ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openEdit(item)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="檢視 / 編輯">
                          <Pencil className="h-4 w-4" />
                        </button>
                        {canManage && (
                          <button type="button" onClick={() => softDeleteLocation(item)} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="soft delete">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/35 px-4 py-6">
          <form onSubmit={submitLocation} className="w-full max-w-6xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing ? '編輯庫存位置' : '新增庫存位置'}</h2>
                <p className="text-sm text-slate-500">設定位置與可管理料件</p>
              </div>
              <button type="button" onClick={closeDialog} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5 md:grid-cols-3">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">位置類型 *</span>
                <select disabled={!canManage} value={form.location_type} onChange={(event) => updateForm('location_type', event.target.value as InventoryLocationType)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                  {INVENTORY_LOCATION_TYPES.map((type) => <option key={type} value={type}>{LOCATION_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">位置名稱 *</span>
                <input disabled={!canManage} value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">位置代碼</span>
                <input disabled={!canManage} value={form.code} onChange={(event) => updateForm('code', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">門市</span>
                <select disabled={!canManage || form.location_type !== 'STORE'} value={form.store_id} onChange={(event) => updateForm('store_id', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">請選擇門市</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} {store.short_name || store.store_name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 pt-7">
                <input disabled={!canManage} type="checkbox" checked={form.is_active} onChange={(event) => updateForm('is_active', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                <span className="text-sm font-semibold text-slate-700">啟用</span>
              </label>
              <label className="flex items-center gap-2 pt-7">
                <input disabled={!canManage || !form.is_active || !['STORE', 'CENTRAL_WAREHOUSE'].includes(form.location_type)} type="checkbox" checked={form.is_default} onChange={(event) => updateForm('is_default', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                <span className="text-sm font-semibold text-slate-700">預設位置</span>
              </label>
              <label className="flex items-center gap-2">
                <input disabled={!canManage} type="checkbox" checked={form.allow_negative_stock} onChange={(event) => updateForm('allow_negative_stock', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                <span className="text-sm font-semibold text-slate-700">允許負庫存政策</span>
              </label>
              <label className="block md:col-span-3">
                <span className="text-sm font-semibold text-slate-700">描述</span>
                <textarea disabled={!canManage} value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>

            {editing && (
              <div className="border-t border-slate-200 px-5 py-5">
                <div className="mb-3">
                  <div className="text-sm font-bold text-slate-900">位置料件設定</div>
                  <div className="text-xs text-slate-500">設定安全庫存、補貨點、最高庫存與偏好領用單位</div>
                </div>

                <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
                  {locationParts.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">尚未設定此位置管理的料件</div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-4 py-3">料件</th>
                          <th className="px-4 py-3">安全 / 補貨 / 最高</th>
                          <th className="px-4 py-3">偏好單位</th>
                          <th className="px-4 py-3">狀態</th>
                          {canManage && <th className="px-4 py-3 text-right">操作</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {locationParts.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-900">{item.part?.name || item.part_id}</div>
                              <div className="text-xs text-slate-500">{item.part?.part_code || '未編料號'}</div>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{[item.safety_stock_qty, item.reorder_point_qty, item.maximum_stock_qty].map((v) => v ?? '-').join(' / ')}</td>
                            <td className="px-4 py-3 text-slate-700">{item.preferred_issue_unit_type ? `${UNIT_TYPE_LABELS[item.preferred_issue_unit_type]} (${item.resolvedPreferredIssueUnit || '-'})` : '-'}</td>
                            <td className="px-4 py-3 text-slate-700">{item.is_active ? '啟用' : '停用'}</td>
                            {canManage && (
                              <td className="px-4 py-3 text-right">
                                <button type="button" onClick={() => deleteLocationPart(item)} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="soft delete">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {canManage && partCatalogDenied && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    缺少 general_affairs.part.view，因此無法新增位置料件設定。
                  </div>
                )}

                {canManage && !partCatalogDenied && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-800">新增位置料件</div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <select value={partForm.part_id} onChange={(event) => updatePartForm('part_id', event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm md:col-span-2">
                        <option value="">選擇料件</option>
                        {parts.map((part) => <option key={part.id} value={part.id}>{part.part_code || '未編料號'} {part.name}</option>)}
                      </select>
                      <select value={partForm.preferred_issue_unit_type} onChange={(event) => updatePartForm('preferred_issue_unit_type', event.target.value as any)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
                        <option value="">不指定單位</option>
                        {PREFERRED_ISSUE_UNIT_TYPES.map((type) => <option key={type} value={type}>{UNIT_TYPE_LABELS[type]}</option>)}
                      </select>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={partForm.is_active} onChange={(event) => updatePartForm('is_active', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                        <span className="text-sm font-semibold text-slate-700">啟用</span>
                      </label>
                      <input type="number" min="0" step="0.0001" value={partForm.safety_stock_qty} onChange={(event) => updatePartForm('safety_stock_qty', event.target.value)} placeholder="安全庫存" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
                      <input type="number" min="0" step="0.0001" value={partForm.reorder_point_qty} onChange={(event) => updatePartForm('reorder_point_qty', event.target.value)} placeholder="補貨點" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
                      <input type="number" min="0" step="0.0001" value={partForm.maximum_stock_qty} onChange={(event) => updatePartForm('maximum_stock_qty', event.target.value)} placeholder="最高庫存" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
                      <input value={partForm.notes} onChange={(event) => updatePartForm('notes', event.target.value)} placeholder="備註" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
                      <button type="button" onClick={addLocationPart} disabled={partSaving || !partForm.part_id} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-orange-200 bg-white px-4 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-60">
                        {partSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        新增
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={closeDialog} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
              {canManage && (
                <button type="submit" disabled={!canSubmit || saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing ? '儲存變更' : '新增位置'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
