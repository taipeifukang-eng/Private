'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import ResourceAttachmentPanel from '@/components/general-affairs/attachments/ResourceAttachmentPanel';
import AssetSitePicker from '@/components/general-affairs/assets/AssetSitePicker';
import AssetSiteFilter from '@/components/general-affairs/assets/AssetSiteFilter';
import AssetScopeTabs from '@/components/general-affairs/assets/AssetScopeTabs';
import AssetCatalogPicker from '@/components/general-affairs/assets/AssetCatalogPicker';
import {
  AssetBadge,
  AssetDefinitionList,
  AssetDetailPanel,
  AssetFilterPanel,
  AssetFormSection,
  AssetKpiGrid,
  AssetMaintenanceTimeline,
  AssetPlaceholder,
  buildDefaultAssetIcons,
  formatDate,
  type AssetMaintenanceRecord,
} from '@/components/general-affairs/assets/AssetManagementUI';
import { createClient } from '@/lib/supabase/client';
import {
  FACILITY_CRITICALITIES,
  FACILITY_STATUSES,
  type FacilityCriticality,
  type FacilityStatus,
} from '@/lib/general-affairs/facilities/types';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
  short_name?: string | null;
};

type CategoryOption = {
  id: string;
  name: string;
  code: string;
};

type FacilityTemplateSummary = {
  id: string;
  category_id?: string | null;
  code: string;
  name: string;
  brand?: string | null;
  model?: string | null;
};

type Facility = {
  id: string;
  facility_template_id: string | null;
  store_id: string;
  category_id: string;
  name: string;
  facility_code: string | null;
  status: FacilityStatus;
  criticality: FacilityCriticality;
  area: string | null;
  location_detail: string | null;
  quantity: number | null;
  unit: string | null;
  is_fixed_asset: boolean;
  installed_at: string | null;
  last_renovated_at: string | null;
  description: string | null;
  specs?: Record<string, unknown> | null;
  tags: string[] | null;
  notes: string | null;
  image_path?: string | null;
  updated_at: string;
  store?: StoreOption | null;
  category?: CategoryOption | null;
  template?: FacilityTemplateSummary | null;
};

type FacilityForm = {
  facility_template_id: string;
  store_id: string;
  category_id: string;
  name: string;
  facility_code: string;
  status: FacilityStatus;
  criticality: FacilityCriticality;
  area: string;
  location_detail: string;
  quantity: string;
  unit: string;
  is_fixed_asset: boolean;
  installed_at: string;
  last_renovated_at: string;
  has_warranty: boolean;
  warranty_end_date: string;
  warranty_claim_method: string;
  warranty_claim_notes: string;
  description: string;
  tags: string;
  notes: string;
};

type Message = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM: FacilityForm = {
  facility_template_id: '',
  store_id: '',
  category_id: '',
  name: '',
  facility_code: '',
  status: 'ACTIVE',
  criticality: 'NORMAL',
  area: '',
  location_detail: '',
  quantity: '',
  unit: '',
  is_fixed_asset: true,
  installed_at: '',
  last_renovated_at: '',
  has_warranty: false,
  warranty_end_date: '',
  warranty_claim_method: '',
  warranty_claim_notes: '',
  description: '',
  tags: '',
  notes: '',
};

const STATUS_LABELS: Record<FacilityStatus, string> = {
  ACTIVE: '使用中',
  PARTIALLY_DAMAGED: '部分損壞',
  OUT_OF_SERVICE: '停用中',
  UNDER_RENOVATION: '整修中',
  RETIRED: '退役',
};

const STATUS_TONES: Record<FacilityStatus, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  ACTIVE: 'green',
  PARTIALLY_DAMAGED: 'amber',
  OUT_OF_SERVICE: 'red',
  UNDER_RENOVATION: 'blue',
  RETIRED: 'slate',
};

const CRITICALITY_LABELS: Record<FacilityCriticality, string> = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  CRITICAL: '關鍵',
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

const WARRANTY_CLAIM_METHODS = [
  { value: '', label: '未設定' },
  ...Object.entries(WARRANTY_CLAIM_METHOD_LABELS).map(([value, label]) => ({ value, label })),
] as const;

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || '操作失敗');
  }
  return json;
}

function formatStore(store?: StoreOption | null) {
  return store ? `${store.store_code} ${store.short_name || store.store_name}` : '-';
}

function formatLocation(item: Pick<Facility, 'area' | 'location_detail'>) {
  return [item.area, item.location_detail].filter(Boolean).join(' / ') || '-';
}

function formatQuantity(item: Pick<Facility, 'quantity' | 'unit'>) {
  if (item.quantity === null || item.quantity === undefined) return '-';
  return `${item.quantity} ${item.unit || ''}`.trim();
}

function getFacilityHasWarranty(item: Pick<Facility, 'specs'>) {
  return item.specs?.facility_has_warranty === true;
}

function getFacilityWarrantyEndDate(item: Pick<Facility, 'specs'>) {
  const value = item.specs?.facility_warranty_end_date;
  return typeof value === 'string' ? value : null;
}

function getFacilityWarrantyClaimMethod(item: Pick<Facility, 'specs'>) {
  const value = item.specs?.facility_warranty_claim_method;
  return typeof value === 'string' ? value : '';
}

function getFacilityWarrantyClaimNotes(item: Pick<Facility, 'specs'>) {
  const value = item.specs?.facility_warranty_claim_notes;
  return typeof value === 'string' ? value : '';
}

function getWarrantyState(item: Pick<Facility, 'specs'>) {
  if (!getFacilityHasWarranty(item)) return { label: '無保固', tone: 'slate' as const };
  const endDate = getFacilityWarrantyEndDate(item);
  if (!endDate) return { label: '保固日未填', tone: 'amber' as const };
  const end = new Date(endDate);
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: '已過保', tone: 'red' as const };
  if (days <= 30) return { label: `${days} 天內到期`, tone: 'amber' as const };
  return { label: formatDate(endDate), tone: 'green' as const };
}

function buildFacilitySpecs(baseSpecs: Record<string, unknown> | null | undefined, form: FacilityForm) {
  return {
    ...(baseSpecs || {}),
    facility_has_warranty: form.has_warranty,
    facility_warranty_end_date: form.has_warranty ? form.warranty_end_date || null : null,
    facility_warranty_claim_method: form.warranty_claim_method || null,
    facility_warranty_claim_notes: form.warranty_claim_method === 'OTHER' ? form.warranty_claim_notes.trim() || null : null,
  };
}

export default function FacilitiesClient() {
  const supabase = useMemo(() => createClient(), []);
  const icons = useMemo(() => buildDefaultAssetIcons(), []);
  const [items, setItems] = useState<Facility[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [templates, setTemplates] = useState<FacilityTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [templateFilterName, setTemplateFilterName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [maintenanceRecords, setMaintenanceRecords] = useState<AssetMaintenanceRecord[]>([]);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [form, setForm] = useState<FacilityForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);

  const canSubmit = form.store_id && form.category_id && form.name.trim();

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '100', sortBy: 'updated_at', sortOrder: 'desc' });
    if (search.trim()) params.set('search', search.trim());
    if (storeFilter) params.set('storeId', storeFilter);
    if (categoryFilter) params.set('categoryId', categoryFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (areaFilter.trim()) params.set('area', areaFilter.trim());
    if (templateFilter) params.set('templateId', templateFilter);
    return params.toString();
  }, [areaFilter, categoryFilter, search, statusFilter, storeFilter, templateFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTemplateFilter(params.get('templateId') || '');
    setTemplateFilterName(params.get('templateName') || '');
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const kpis = useMemo(() => {
    const active = items.filter((item) => item.status === 'ACTIVE').length;
    const attention = items.filter((item) => ['PARTIALLY_DAMAGED', 'OUT_OF_SERVICE', 'UNDER_RENOVATION'].includes(item.status)).length;
    const fixedAssets = items.filter((item) => item.is_fixed_asset).length;
    const critical = items.filter((item) => ['HIGH', 'CRITICAL'].includes(item.criticality)).length;
    return [
      { id: 'total', label: '設施總數', value: items.length, description: '目前查詢範圍內未刪除設施', icon: icons.total },
      { id: 'active', label: '使用中', value: active, description: '可正常使用的據點設施', tone: 'green' as const, icon: icons.active },
      { id: 'attention', label: '需處理', value: attention, description: '損壞、停用或整修中的設施', tone: attention ? 'amber' as const : 'slate' as const, icon: icons.attention },
      { id: 'fixed', label: '固定資產', value: fixedAssets, description: '已標記為固定資產的設施', tone: 'blue' as const, icon: icons.archive },
      { id: 'critical', label: '高重要度', value: critical, description: '重要度為高或關鍵', tone: critical ? 'red' as const : 'slate' as const, icon: icons.maintenance },
    ];
  }, [icons, items]);

  const loadOptions = useCallback(async () => {
    const [storesResult, categoryRes, templateRes] = await Promise.all([
      supabase
        .from('stores')
        .select('id, store_code, store_name, short_name')
        .eq('is_active', true)
        .order('store_code'),
      fetch('/api/general-affairs/categories?type=facility'),
      fetch('/api/general-affairs/facility-templates'),
    ]);

    if (!storesResult.error) setStores((storesResult.data || []) as StoreOption[]);
    if (categoryRes.ok) {
      const json = await categoryRes.json();
      setCategories(json.data || []);
    }
    if (templateRes.ok) {
      const json = await templateRes.json();
      setTemplates((json.data || []).filter((template: { is_active?: boolean }) => template.is_active !== false));
    }
  }, [supabase]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      const response = await fetch(`/api/general-affairs/facilities?${queryString}`);
      if (response.status === 403) setPermissionDenied(true);
      const json = await parseResponse(response);
      setItems(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入設施失敗');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadMaintenance = useCallback(async (item: Facility | null) => {
    setMaintenanceRecords([]);
    setMaintenanceError('');
    if (!item) return;
    try {
      const response = await fetch(`/api/maintenance-requests?source=general_affairs&store_id=${encodeURIComponent(item.store_id)}&pageSize=100`);
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.success === false) {
        setMaintenanceError(json.error || '維修紀錄 API 暫不可讀');
        return;
      }
      const records = (json.data || []).filter((record: any) => record.facility_id === item.id);
      setMaintenanceRecords(records);
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : '維修紀錄載入失敗');
    }
  }, []);

  useEffect(() => {
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (selectedId && items.some((item) => item.id === selectedId)) return;
    setSelectedId(items[0]?.id || '');
  }, [items, selectedId]);

  useEffect(() => {
    loadMaintenance(selectedItem);
  }, [loadMaintenance, selectedItem]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function openEdit(item: Facility) {
    setEditing(item);
    setForm({
      facility_template_id: item.facility_template_id || '',
      store_id: item.store_id,
      category_id: item.category_id,
      name: item.name || '',
      facility_code: item.facility_code || '',
      status: item.status,
      criticality: item.criticality,
      area: item.area || '',
      location_detail: item.location_detail || '',
      quantity: item.quantity?.toString() || '',
      unit: item.unit || '',
      is_fixed_asset: item.is_fixed_asset,
      installed_at: item.installed_at || '',
      last_renovated_at: item.last_renovated_at || '',
      has_warranty: getFacilityHasWarranty(item),
      warranty_end_date: getFacilityWarrantyEndDate(item) || '',
      warranty_claim_method: getFacilityWarrantyClaimMethod(item),
      warranty_claim_notes: getFacilityWarrantyClaimNotes(item),
      description: item.description || '',
      tags: (item.tags || []).join(', '),
      notes: item.notes || '',
    });
    setDirty(false);
    setDialogOpen(true);
  }

  function selectTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setForm((current) => ({
      ...current,
      facility_template_id: templateId,
      ...(template ? {
        category_id: template.category_id || current.category_id,
        name: template.name || current.name,
      } : {}),
    }));
    setDirty(true);
  }

  function updateForm<K extends keyof FacilityForm>(key: K, value: FacilityForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function closeDialog() {
    if (dirty && !window.confirm('尚有未儲存變更，確定要離開嗎？')) return;
    setDialogOpen(false);
    setDirty(false);
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);

    const quantity = form.quantity ? Number(form.quantity) : null;
    const payload = {
      facility_template_id: form.facility_template_id || null,
      store_id: form.store_id,
      category_id: form.category_id,
      name: form.name,
      facility_code: form.facility_code || null,
      status: form.status,
      criticality: form.criticality,
      area: form.area || null,
      location_detail: form.location_detail || null,
      quantity,
      unit: quantity === null ? null : form.unit,
      is_fixed_asset: form.is_fixed_asset,
      installed_at: form.installed_at || null,
      last_renovated_at: form.last_renovated_at || null,
      description: form.description || null,
      specs: buildFacilitySpecs(editing?.specs, form),
      tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: form.notes || null,
    };

    try {
      const response = await fetch(editing ? `/api/general-affairs/facilities/${editing.id}` : '/api/general-affairs/facilities', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await parseResponse(response);
      const warningText = json.warnings?.length ? `（${json.warnings[0].message}）` : '';
      setMessage({ type: 'success', text: `${editing ? '設施已更新' : '設施已新增'}${warningText}` });
      setDialogOpen(false);
      setDirty(false);
      await loadItems();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '儲存失敗' });
    } finally {
      setSaving(false);
    }
  }

  async function softDelete(item: Facility) {
    const reason = window.prompt(`請輸入刪除「${item.name}」的原因`);
    if (!reason) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/facilities/${item.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: '設施已 soft delete' });
      await loadItems();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '刪除失敗' });
    }
  }

  const header = (
    <>
      <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: '設施管理' },
      ]}
      title="據點設施清冊"
      description="管理各據點的空間、固定設施與可量化設施。分類與維修紀錄已拆成左側子模組，未建置的巡檢、保養排程與廠商流程不會顯示為可操作功能。"
      primaryAction={
        <Link
          href="/general-affairs/facilities/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
        >
          <Plus className="h-4 w-4" />
          新增設施
        </Link>
      }
      secondaryActions={[
        <Link
          key="categories"
          href="/general-affairs/facilities/categories"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Building2 className="h-4 w-4" />
          設施分類
        </Link>,
        <Link
          key="warranties"
          href="/general-affairs/facilities/warranties"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ShieldCheck className="h-4 w-4" />
          保固管理
        </Link>,
        <Link
          key="maintenance"
          href="/general-affairs/facilities/maintenance-history"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Wrench className="h-4 w-4" />
          維修紀錄
        </Link>,
      ]}
      />
      <AssetScopeTabs assetType="facility" current="instances" />
    </>
  );

  const filters = (
    <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋名稱、編號、區域、位置" className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
        </label>
        <AssetSiteFilter options={stores} value={storeFilter} onChange={setStoreFilter} />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部分類</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部狀態</option>
          {FACILITY_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
        <input value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} placeholder="區域" className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
    </div>
  );

  const detailDrawer = selectedItem ? (
    <AssetDetailPanel title="設施詳情" subtitle="依目前 API 可讀欄位呈現">
      <AssetDefinitionList
        rows={[
          { label: '設施名稱', value: selectedItem.name },
          { label: '據點', value: formatStore(selectedItem.store) },
          { label: '分類', value: selectedItem.category?.name || '-' },
          { label: '公司設施架型', value: selectedItem.template ? `${selectedItem.template.code} / ${selectedItem.template.name}` : '未連結' },
          { label: '設施編號', value: selectedItem.facility_code || '-' },
          { label: '位置', value: formatLocation(selectedItem) },
          { label: '數量', value: formatQuantity(selectedItem) },
          { label: '固定資產', value: selectedItem.is_fixed_asset ? '是' : '否' },
          { label: '安裝日期', value: formatDate(selectedItem.installed_at) },
          { label: '整修日期', value: formatDate(selectedItem.last_renovated_at) },
          { label: '保固狀態', value: getWarrantyState(selectedItem).label },
          { label: '保固到期日', value: formatDate(getFacilityWarrantyEndDate(selectedItem)) },
          { label: '申請保固方式', value: WARRANTY_CLAIM_METHOD_LABELS[getFacilityWarrantyClaimMethod(selectedItem)] || '-' },
          { label: '保固備註', value: getFacilityWarrantyClaimNotes(selectedItem) || '-' },
          { label: '描述', value: selectedItem.description || '-' },
          { label: '備註', value: selectedItem.notes || '-' },
        ]}
      />
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-900">狀態摘要</h3>
        <div className="flex flex-wrap gap-2">
          <AssetBadge tone={STATUS_TONES[selectedItem.status]}>{STATUS_LABELS[selectedItem.status]}</AssetBadge>
          <AssetBadge tone={['HIGH', 'CRITICAL'].includes(selectedItem.criticality) ? 'red' : 'slate'}>{CRITICALITY_LABELS[selectedItem.criticality]}</AssetBadge>
          <AssetBadge tone={getWarrantyState(selectedItem).tone}>{getWarrantyState(selectedItem).label}</AssetBadge>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-900">維修歷程</h3>
        <AssetMaintenanceTimeline records={maintenanceRecords} unavailableReason={maintenanceError} />
      </div>
      <ResourceAttachmentPanel
        resourceType="FACILITY"
        resourceId={selectedItem.id}
        canManage
        title="設施圖片與附件"
        emptyLabel="尚未上傳設施圖片或附件"
      />
    </AssetDetailPanel>
  ) : undefined;

  function renderList() {
    if (loading) {
      return <div className="flex h-56 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />載入設施資料</div>;
    }
    if (permissionDenied) {
      return <div className="rounded-lg border border-orange-100 bg-white p-8 text-center shadow-sm"><AlertCircle className="mx-auto mb-3 h-8 w-8 text-orange-500" /><h1 className="text-lg font-bold text-slate-900">沒有設施資料權限</h1><p className="mt-2 text-sm text-slate-500">請確認是否具備設施查看權限，或是否為該門市管理者。</p></div>;
    }
    if (error) {
      return <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 text-red-600"><AlertCircle className="h-6 w-6" />{error}</div>;
    }
    if (items.length === 0) {
      return <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-slate-500"><AlertCircle className="h-6 w-6 text-slate-400" />目前沒有符合條件的設施</div>;
    }

    return (
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">設施</th>
                <th className="px-4 py-3">據點 / 位置</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-4 py-3">公司架型</th>
                <th className="px-4 py-3">數量</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">重要度</th>
                <th className="px-4 py-3">日期</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className={selectedItem?.id === item.id ? 'bg-orange-50/70' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelectedId(item.id)} className="flex min-w-0 items-center gap-3 text-left">
                      <AssetPlaceholder label="設施圖片" tone="blue" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{item.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{item.facility_code || '未編號'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{formatStore(item.store)}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatLocation(item)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{item.category?.name || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {item.template ? (
                      <div><div className="font-medium text-slate-800">{item.template.code}</div><div className="mt-1 text-xs text-slate-400">{item.template.name}</div></div>
                    ) : <span className="text-xs text-amber-700">未連結</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatQuantity(item)}</td>
                  <td className="px-4 py-3"><AssetBadge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</AssetBadge></td>
                  <td className="px-4 py-3"><AssetBadge tone={['HIGH', 'CRITICAL'].includes(item.criticality) ? 'red' : 'slate'}>{CRITICALITY_LABELS[item.criticality]}</AssetBadge></td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>安裝 {formatDate(item.installed_at)}</div>
                    <div className="mt-1 text-xs text-slate-400">整修 {formatDate(item.last_renovated_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => openEdit(item)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="編輯">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => softDelete(item)} className="rounded-md p-2 text-red-500 hover:bg-red-50" title="soft delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-slate-100 lg:hidden">
          {items.map((item) => (
            <div key={item.id} className="p-4">
              <button type="button" onClick={() => setSelectedId(item.id)} className="flex w-full items-start gap-3 text-left">
                <AssetPlaceholder label="設施圖片" tone="blue" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{item.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{formatStore(item.store)} / {formatLocation(item)}</span>
                  <span className="mt-1 block text-xs text-slate-400">公司架型：{item.template ? `${item.template.code} ${item.template.name}` : '未連結'}</span>
                </span>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <AssetBadge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</AssetBadge>
                <AssetBadge tone={['HIGH', 'CRITICAL'].includes(item.criticality) ? 'red' : 'slate'}>{CRITICALITY_LABELS[item.criticality]}</AssetBadge>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => openEdit(item)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">編輯</button>
                <button type="button" onClick={() => softDelete(item)} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600">刪除</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsListPage
        header={header}
        kpi={<AssetKpiGrid items={kpis} />}
        filters={<AssetFilterPanel>{filters}</AssetFilterPanel>}
        detailDrawer={detailDrawer}
      >
        {templateFilter && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <span>目前查看：<strong>{templateFilterName || '指定公司設施架型'}</strong></span>
            <button type="button" onClick={() => { setTemplateFilter(''); setTemplateFilterName(''); window.history.replaceState({}, '', '/general-affairs/facilities'); }} className="shrink-0 font-bold underline underline-offset-2">清除</button>
          </div>
        )}
        {message && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${messageClass(message.type)}`}>
            {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {message.text}
          </div>
        )}
        {renderList()}
      </GeneralAffairsListPage>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/35 px-4 py-6">
          <form onSubmit={submitForm} className="w-full max-w-5xl rounded-lg bg-slate-50 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing ? '編輯設施' : '新增設施'}</h2>
                <p className="text-sm text-slate-500">建立據點空間、裝修、固定設施或可量化設施資料。</p>
              </div>
              <button type="button" onClick={closeDialog} className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 p-5">
              <AssetFormSection title="基本資料" description="選擇據點、分類與設施名稱；此資料可供維修回報連結。" icon={<Building2 className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <AssetCatalogPicker
                    label="公司設施架型"
                    emptyLabel="尚未連結公司設施架型"
                    options={templates.map((template) => ({
                      id: template.id,
                      title: `${template.code} / ${template.name}`,
                      detail: [template.brand, template.model].filter(Boolean).join(' / '),
                    }))}
                    value={form.facility_template_id}
                    onChange={selectTemplate}
                  />
                  <AssetSitePicker
                    options={stores}
                    value={form.store_id}
                    onChange={(value) => updateForm('store_id', value)}
                  />
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">設施分類 *</span>
                    <select value={form.category_id} onChange={(event) => updateForm('category_id', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      <option value="">請選擇分類</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">設施名稱 *</span>
                    <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">設施編號</span>
                    <input value={form.facility_code} onChange={(event) => updateForm('facility_code', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">狀態</span>
                    <select value={form.status} onChange={(event) => updateForm('status', event.target.value as FacilityStatus)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {FACILITY_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">重要程度</span>
                    <select value={form.criticality} onChange={(event) => updateForm('criticality', event.target.value as FacilityCriticality)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {FACILITY_CRITICALITIES.map((value) => <option key={value} value={value}>{CRITICALITY_LABELS[value]}</option>)}
                    </select>
                  </label>
                </div>
              </AssetFormSection>

              <AssetFormSection title="位置與數量" description="依設施主檔實際欄位保存位置、數量、單位與固定資產標示。" icon={<MapPin className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">區域</span>
                    <input value={form.area} onChange={(event) => updateForm('area', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">詳細位置</span>
                    <input value={form.location_detail} onChange={(event) => updateForm('location_detail', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="flex items-center gap-2 pt-7">
                    <input type="checkbox" checked={form.is_fixed_asset} onChange={(event) => updateForm('is_fixed_asset', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                    <span className="text-sm font-semibold text-slate-700">固定資產</span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">數量</span>
                    <input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">單位</span>
                    <input value={form.unit} onChange={(event) => updateForm('unit', event.target.value)} placeholder="座、面、公尺、平方公尺" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                </div>
              </AssetFormSection>

              <AssetFormSection title="日期、描述與備註" description="目前只保存主檔描述；巡檢、保養排程、廠商與費用流程尚未建置。" icon={<Ruler className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">安裝日期</span>
                    <input type="date" value={form.installed_at} onChange={(event) => updateForm('installed_at', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">最近整修日期</span>
                    <input type="date" value={form.last_renovated_at} onChange={(event) => updateForm('last_renovated_at', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">標籤</span>
                    <input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} placeholder="以逗號分隔" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block md:col-span-3">
                    <span className="text-sm font-semibold text-slate-700">描述</span>
                    <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                  <label className="block md:col-span-3">
                    <span className="text-sm font-semibold text-slate-700">備註</span>
                    <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              </AssetFormSection>

              <AssetFormSection title="保固資訊" description="部分設施更換、裝修或維修後會有保固；此處先保存於設施 specs，供設施保固管理彙整。" icon={<ShieldCheck className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="flex items-center gap-2 pt-7">
                    <input type="checkbox" checked={form.has_warranty} onChange={(event) => updateForm('has_warranty', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                    <span className="text-sm font-semibold text-slate-700">有保固</span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">保固到期日</span>
                    <input type="date" disabled={!form.has_warranty} value={form.warranty_end_date} onChange={(event) => updateForm('warranty_end_date', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm disabled:bg-slate-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">申請保固方式</span>
                    <select value={form.warranty_claim_method} onChange={(event) => updateForm('warranty_claim_method', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {WARRANTY_CLAIM_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                    </select>
                  </label>
                  {form.warranty_claim_method === 'OTHER' && (
                    <label className="block md:col-span-3">
                      <span className="text-sm font-semibold text-slate-700">其他保固方式備註</span>
                      <textarea value={form.warranty_claim_notes} onChange={(event) => updateForm('warranty_claim_notes', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="請補充申請保固時需要準備的資料、聯絡方式或供應商要求。" />
                    </label>
                  )}
                  <p className="text-xs leading-5 text-slate-500 md:col-span-3">保固單據、圖片或文件可在設施詳情「設施圖片與附件」上傳，保固管理頁會集中檢視。</p>
                </div>
              </AssetFormSection>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={closeDialog} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
              <button type="submit" disabled={!canSubmit || saving} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-orange-300">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                儲存
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
