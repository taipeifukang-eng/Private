'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings2,
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
  EQUIPMENT_CRITICALITIES,
  EQUIPMENT_ONBOARDING_STATUSES,
  EQUIPMENT_STATUSES,
  type EquipmentCriticality,
  type EquipmentOnboardingStatus,
  type EquipmentStatus,
} from '@/lib/general-affairs/equipment/types';

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

type EquipmentTemplateSummary = {
  id: string;
  category_id?: string | null;
  name: string;
  brand?: string | null;
  model?: string | null;
};

type Equipment = {
  id: string;
  store_id: string;
  category_id: string;
  template_id: string | null;
  name: string;
  asset_code: string | null;
  barcode: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  status: EquipmentStatus;
  criticality: EquipmentCriticality;
  onboarding_status: EquipmentOnboardingStatus;
  onboarding_review_note?: string | null;
  onboarding_reviewed_at?: string | null;
  onboarding_reviewed_by?: string | null;
  area: string | null;
  location_detail: string | null;
  purpose: string | null;
  installed_at: string | null;
  purchase_amount: number | null;
  tags: string[] | null;
  notes: string | null;
  has_warranty: boolean;
  warranty_end_date: string | null;
  image_path?: string | null;
  qr_token?: string | null;
  qr_scan_path?: string | null;
  updated_at: string;
  store?: StoreOption | null;
  category?: CategoryOption | null;
  template?: EquipmentTemplateSummary | null;
};

type EquipmentAttachmentSummary = {
  purpose: string;
  content_type: string;
  is_primary: boolean;
  signed_url: string | null;
};

type EquipmentForm = {
  template_id: string;
  store_id: string;
  category_id: string;
  name: string;
  asset_code: string;
  barcode: string;
  brand: string;
  model: string;
  serial_number: string;
  status: EquipmentStatus;
  criticality: EquipmentCriticality;
  onboarding_status: EquipmentOnboardingStatus;
  area: string;
  location_detail: string;
  purpose: string;
  installed_at: string;
  purchase_amount: string;
  tags: string;
  notes: string;
  has_warranty: boolean;
  warranty_end_date: string;
};

type Message = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM: EquipmentForm = {
  template_id: '',
  store_id: '',
  category_id: '',
  name: '',
  asset_code: '',
  barcode: '',
  brand: '',
  model: '',
  serial_number: '',
  status: 'ACTIVE',
  criticality: 'NORMAL',
  onboarding_status: 'NEEDS_EQUIPMENT_PHOTO',
  area: '',
  location_detail: '',
  purpose: '',
  installed_at: '',
  purchase_amount: '',
  tags: '',
  notes: '',
  has_warranty: false,
  warranty_end_date: '',
};

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  ACTIVE: '使用中',
  TEMPORARILY_STOPPED: '暫停使用',
  SPARE: '備品',
  RETIRED: '退役',
  SCRAPPED: '報廢',
};

const STATUS_TONES: Record<EquipmentStatus, 'green' | 'amber' | 'blue' | 'slate' | 'red'> = {
  ACTIVE: 'green',
  TEMPORARILY_STOPPED: 'amber',
  SPARE: 'blue',
  RETIRED: 'slate',
  SCRAPPED: 'red',
};

const CRITICALITY_LABELS: Record<EquipmentCriticality, string> = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  CRITICAL: '關鍵',
};

const ONBOARDING_STATUS_LABELS: Record<EquipmentOnboardingStatus, string> = {
  NEEDS_EQUIPMENT_PHOTO: '待上傳設備照片',
  NEEDS_LABEL_PHOTO: '待貼標照片',
  PENDING_GA_REVIEW: '待總務複核',
  COMPLETED: '已完成',
};

const ONBOARDING_STEPS: Array<{ status: EquipmentOnboardingStatus; label: string }> = [
  { status: 'NEEDS_EQUIPMENT_PHOTO', label: '設備照片' },
  { status: 'NEEDS_LABEL_PHOTO', label: '貼標照片' },
  { status: 'PENDING_GA_REVIEW', label: '總務複核' },
  { status: 'COMPLETED', label: '完成' },
];

const ONBOARDING_PROGRESS_PERCENT: Record<EquipmentOnboardingStatus, number> = {
  NEEDS_EQUIPMENT_PHOTO: 10,
  NEEDS_LABEL_PHOTO: 40,
  PENDING_GA_REVIEW: 75,
  COMPLETED: 100,
};

function getOnboardingStepIndex(status?: EquipmentOnboardingStatus | null) {
  const normalized = status || 'NEEDS_EQUIPMENT_PHOTO';
  return Math.max(0, ONBOARDING_STEPS.findIndex((step) => step.status === normalized));
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || '操作失敗');
  }
  return json;
}

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

function getWarrantyState(equipment: Equipment) {
  if (!equipment.has_warranty) return { label: '無保固', tone: 'slate' as const };
  if (!equipment.warranty_end_date) return { label: '保固日未填', tone: 'amber' as const };
  const end = new Date(equipment.warranty_end_date);
  const diffDays = Math.ceil((end.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return { label: '已過保', tone: 'red' as const };
  if (diffDays <= 30) return { label: `${diffDays} 天內到期`, tone: 'amber' as const };
  return { label: formatDate(equipment.warranty_end_date), tone: 'green' as const };
}

function formatLocation(item: Pick<Equipment, 'area' | 'location_detail'>) {
  return [item.area, item.location_detail].filter(Boolean).join(' / ') || '-';
}

function formatStore(store?: StoreOption | null) {
  return store ? `${store.store_code} ${store.short_name || store.store_name}` : '-';
}

function EquipmentThumbnail({ src, name }: { src?: string | null; name: string }) {
  if (!src) return <AssetPlaceholder label="設備圖片" />;
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} 圖片`} className="h-full w-full object-cover" />
    </div>
  );
}

function OnboardingProgress({
  status,
  compact = false,
}: {
  status?: EquipmentOnboardingStatus | null;
  compact?: boolean;
}) {
  const normalized = status || 'NEEDS_EQUIPMENT_PHOTO';
  const currentIndex = getOnboardingStepIndex(normalized);
  const progress = ONBOARDING_PROGRESS_PERCENT[normalized];

  return (
    <div className={compact ? 'min-w-[150px]' : 'w-full'}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-slate-700">
          {ONBOARDING_STATUS_LABELS[normalized]}
        </span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{progress}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-orange-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {ONBOARDING_STEPS.map((step, index) => {
            const done = index < currentIndex || normalized === 'COMPLETED';
            const current = index === currentIndex && normalized !== 'COMPLETED';
            return (
              <div key={step.status} className="min-w-0">
                <div
                  className={[
                    'mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold',
                    done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : current
                        ? 'border-orange-200 bg-orange-50 text-orange-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400',
                  ].join(' ')}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>
                <div className={[
                  'mt-1 truncate text-center text-xs',
                  current ? 'font-semibold text-orange-700' : done ? 'text-emerald-700' : 'text-slate-400',
                ].join(' ')}
                >
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EquipmentManagementClient() {
  const supabase = useMemo(() => createClient(), []);
  const icons = useMemo(() => buildDefaultAssetIcons(), []);
  const [items, setItems] = useState<Equipment[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [templates, setTemplates] = useState<EquipmentTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [onboardingStatusFilter, setOnboardingStatusFilter] = useState('');
  const [warrantyFilter, setWarrantyFilter] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [templateFilterName, setTemplateFilterName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [maintenanceRecords, setMaintenanceRecords] = useState<AssetMaintenanceRecord[]>([]);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string | null>>({});
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [reviewingId, setReviewingId] = useState('');

  const canSubmit = form.store_id && form.category_id && form.name.trim();

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '100', sortBy: 'updated_at', sortDir: 'desc' });
    if (search.trim()) params.set('search', search.trim());
    if (storeFilter) params.set('storeId', storeFilter);
    if (categoryFilter) params.set('categoryId', categoryFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (onboardingStatusFilter) params.set('onboardingStatus', onboardingStatusFilter);
    if (templateFilter) params.set('templateId', templateFilter);
    return params.toString();
  }, [categoryFilter, onboardingStatusFilter, search, statusFilter, storeFilter, templateFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTemplateFilter(params.get('templateId') || '');
    setTemplateFilterName(params.get('templateName') || '');
  }, []);

  const labelPrintHref = useMemo(() => `/general-affairs/equipment/labels?${queryString}`, [queryString]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const filteredItems = useMemo(() => {
    if (!warrantyFilter) return items;
    return items.filter((item) => {
      const state = getWarrantyState(item);
      if (warrantyFilter === 'active') return state.tone === 'green';
      if (warrantyFilter === 'expiring') return state.label.includes('天內到期');
      if (warrantyFilter === 'expired') return state.label === '已過保';
      if (warrantyFilter === 'missing') return state.label === '保固日未填';
      if (warrantyFilter === 'none') return state.label === '無保固';
      return true;
    });
  }, [items, warrantyFilter]);

  const kpis = useMemo(() => {
    const active = items.filter((item) => item.status === 'ACTIVE').length;
    const attention = items.filter((item) => ['TEMPORARILY_STOPPED', 'RETIRED', 'SCRAPPED'].includes(item.status)).length;
    const warrantyAttention = items.filter((item) => ['red', 'amber'].includes(getWarrantyState(item).tone)).length;
    const onboardingPending = items.filter((item) => item.onboarding_status !== 'COMPLETED').length;
    return [
      { id: 'total', label: '設備總數', value: items.length, description: '目前查詢範圍內未刪除設備', icon: icons.total },
      { id: 'active', label: '使用中', value: active, description: '狀態為使用中的據點設備', tone: 'green' as const, icon: icons.active },
      { id: 'attention', label: '需留意狀態', value: attention, description: '暫停、退役或報廢設備', tone: attention ? 'amber' as const : 'slate' as const, icon: icons.attention },
      { id: 'warranty', label: '保固需確認', value: warrantyAttention, description: '已過保、即將到期或保固日未填', tone: warrantyAttention ? 'amber' as const : 'green' as const, icon: icons.warranty },
      { id: 'onboarding', label: '建檔待補', value: onboardingPending, description: '待設備照片、待貼標照片或待複核', tone: onboardingPending ? 'amber' as const : 'green' as const, icon: icons.archive },
    ];
  }, [icons, items]);

  const loadOptions = useCallback(async () => {
    const [storesResult, categoryRes, templateRes] = await Promise.all([
      supabase
        .from('stores')
        .select('id, store_code, store_name, short_name')
        .eq('is_active', true)
        .order('store_code'),
      fetch('/api/general-affairs/categories?type=equipment'),
      fetch('/api/general-affairs/equipment/templates?pageSize=100&active=true&sortBy=name&sortDir=asc'),
    ]);

    if (!storesResult.error) setStores((storesResult.data || []) as StoreOption[]);
    if (categoryRes.ok) {
      const json = await categoryRes.json();
      setCategories(json.data || []);
    }
    if (templateRes.ok) {
      const json = await templateRes.json();
      setTemplates(json.data || []);
    }
  }, [supabase]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      const response = await fetch(`/api/general-affairs/equipment?${queryString}`);
      if (response.status === 403) setPermissionDenied(true);
      const json = await parseResponse(response);
      setItems(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入設備失敗');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadMaintenance = useCallback(async (item: Equipment | null) => {
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
      const records = (json.data || []).filter((record: any) => record.equipment_id === item.id);
      setMaintenanceRecords(records);
    } catch (err) {
      setMaintenanceError(err instanceof Error ? err.message : '維修紀錄載入失敗');
    }
  }, []);

  const loadThumbnails = useCallback(async (records: Equipment[]) => {
    if (!records.length) {
      setThumbnailUrls({});
      return;
    }

    const entries = await Promise.all(
      records.map(async (item): Promise<[string, string | null]> => {
        try {
          const query = new URLSearchParams({ resourceType: 'EQUIPMENT', resourceId: item.id });
          const response = await fetch(`/api/general-affairs/attachments?${query.toString()}`);
          if (!response.ok) return [item.id, null];
          const json = await response.json().catch(() => ({}));
          const attachments = (json.data || []) as EquipmentAttachmentSummary[];
          const image = attachments.find((attachment) => (
            attachment.signed_url
            && attachment.content_type?.startsWith('image/')
            && attachment.purpose === 'PRIMARY_IMAGE'
            && attachment.is_primary
          )) || attachments.find((attachment) => (
            attachment.signed_url
            && attachment.content_type?.startsWith('image/')
            && attachment.purpose === 'PRIMARY_IMAGE'
          )) || attachments.find((attachment) => (
            attachment.signed_url
            && attachment.content_type?.startsWith('image/')
          ));
          return [item.id, image?.signed_url || null];
        } catch {
          return [item.id, null];
        }
      }),
    );

    setThumbnailUrls(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadThumbnails(items).catch(() => setThumbnailUrls({}));
  }, [items, loadThumbnails]);

  useEffect(() => {
    if (selectedId && items.some((item) => item.id === selectedId)) return;
    setSelectedId(items[0]?.id || '');
  }, [items, selectedId]);

  useEffect(() => {
    loadMaintenance(selectedItem);
  }, [loadMaintenance, selectedItem]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function updateForm<K extends keyof EquipmentForm>(key: K, value: EquipmentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function openEdit(item: Equipment) {
    setEditing(item);
    setForm({
      template_id: item.template_id || '',
      store_id: item.store_id,
      category_id: item.category_id,
      name: item.name || '',
      asset_code: item.asset_code || '',
      barcode: item.barcode || '',
      brand: item.brand || '',
      model: item.model || '',
      serial_number: item.serial_number || '',
      status: item.status,
      criticality: item.criticality,
      onboarding_status: item.onboarding_status || 'NEEDS_EQUIPMENT_PHOTO',
      area: item.area || '',
      location_detail: item.location_detail || '',
      purpose: item.purpose || '',
      installed_at: item.installed_at || '',
      purchase_amount: item.purchase_amount?.toString() || '',
      tags: (item.tags || []).join(', '),
      notes: item.notes || '',
      has_warranty: item.has_warranty,
      warranty_end_date: item.warranty_end_date || '',
    });
    setDirty(false);
    setDialogOpen(true);
  }

  function selectTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    setForm((current) => ({
      ...current,
      template_id: templateId,
      ...(template ? {
        category_id: template.category_id || current.category_id,
        name: template.name || current.name,
        brand: template.brand || '',
        model: template.model || '',
      } : {}),
    }));
    setDirty(true);
  }

  function closeDialog() {
    if (dirty && !window.confirm('表單尚未儲存，確定要離開？')) return;
    setDialogOpen(false);
    setDirty(false);
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        store_id: form.store_id,
        category_id: form.category_id,
        template_id: form.template_id || null,
        name: form.name,
        asset_code: form.asset_code,
        barcode: form.barcode,
        brand: form.brand,
        model: form.model,
        serial_number: form.serial_number,
        status: form.status,
        criticality: form.criticality,
        onboarding_status: form.onboarding_status,
        area: form.area,
        location_detail: form.location_detail,
        purpose: form.purpose,
        installed_at: form.installed_at || null,
        purchase_amount: form.purchase_amount ? Number(form.purchase_amount) : null,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        notes: form.notes,
        has_warranty: form.has_warranty,
        warranty_end_date: form.has_warranty ? form.warranty_end_date || null : null,
        specs: {},
      };

      const response = await fetch(
        editing ? `/api/general-affairs/equipment/${editing.id}` : '/api/general-affairs/equipment',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await parseResponse(response);
      const warningText = json.warnings?.length ? `，提醒：${json.warnings.map((w: any) => w.message).join('、')}` : '';
      setMessage({ type: 'success', text: `${editing ? '設備已更新' : '設備已新增'}${warningText}` });
      setDialogOpen(false);
      setDirty(false);
      await loadItems();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '儲存失敗' });
    } finally {
      setSaving(false);
    }
  }

  async function submitOnboardingReview(item: Equipment, action: 'approve' | 'reject') {
    const note = action === 'reject'
      ? window.prompt(`請輸入退回「${item.name}」貼標照片重拍的原因`)
      : window.prompt(`可選填「${item.name}」完成建檔複核說明`, '照片正確，完成建檔。');

    if (note === null) return;
    if (action === 'reject' && !note.trim()) {
      setMessage({ type: 'error', text: '退回重拍時必須填寫原因' });
      return;
    }

    setReviewingId(item.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/equipment/${item.id}/onboarding-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      const json = await parseResponse(response);
      const updated = json.data as Equipment;
      setItems((current) => current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, ...updated } : currentItem)));
      setMessage({
        type: 'success',
        text: action === 'approve' ? '已完成設備建檔複核' : '已退回建檔人員重拍貼標照片',
      });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '設備建檔複核失敗' });
    } finally {
      setReviewingId('');
    }
  }

  async function softDelete(item: Equipment) {
    const reason = window.prompt(`請輸入刪除「${item.name}」的原因`);
    if (!reason) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/equipment/${item.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: '設備已 soft delete' });
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
        { label: '設備管理' },
      ]}
      title="據點設備清冊"
      description="集中管理各據點設備、搜尋篩選與詳情。分類、保固與維修紀錄已拆成左側子模組。"
      primaryAction={
        <Link
          href="/general-affairs/equipment/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
        >
          <Plus className="h-4 w-4" />
          新增設備
        </Link>
      }
      secondaryActions={[
        <Link
          key="labels"
          href={labelPrintHref}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" />
          列印 QR 標籤
        </Link>,
        <Link
          key="categories"
          href="/general-affairs/equipment/categories"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Settings2 className="h-4 w-4" />
          設備分類
        </Link>,
        <Link
          key="warranties"
          href="/general-affairs/equipment/warranties"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ShieldCheck className="h-4 w-4" />
          保固管理
        </Link>,
      ]}
      />
      <AssetScopeTabs assetType="equipment" current="instances" />
    </>
  );

  const filters = (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            placeholder="搜尋名稱、資產編號、品牌、型號、序號"
          />
        </label>
        <AssetSiteFilter options={stores} value={storeFilter} onChange={setStoreFilter} />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部分類</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部狀態</option>
          {EQUIPMENT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
        <select value={onboardingStatusFilter} onChange={(event) => setOnboardingStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部建檔進度</option>
          {EQUIPMENT_ONBOARDING_STATUSES.map((status) => <option key={status} value={status}>{ONBOARDING_STATUS_LABELS[status]}</option>)}
        </select>
        <select value={warrantyFilter} onChange={(event) => setWarrantyFilter(event.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="">全部保固</option>
          <option value="active">保固中</option>
          <option value="expiring">即將到期</option>
          <option value="expired">已過保</option>
          <option value="missing">保固日未填</option>
          <option value="none">無保固</option>
        </select>
    </div>
  );

  const detailDrawer = selectedItem ? (
    <AssetDetailPanel title="設備詳情" subtitle="依目前 API 可讀欄位呈現">
      <AssetDefinitionList
        rows={[
          { label: '設備名稱', value: selectedItem.name },
          { label: '據點', value: formatStore(selectedItem.store) },
          { label: '分類', value: selectedItem.category?.name || '-' },
          { label: '公司設備型號', value: selectedItem.template ? [selectedItem.template.brand, selectedItem.template.model || selectedItem.template.name].filter(Boolean).join(' / ') : '未連結' },
          { label: '品牌型號', value: [selectedItem.brand, selectedItem.model].filter(Boolean).join(' / ') || '-' },
          { label: '資產編號', value: selectedItem.asset_code || '-' },
          { label: 'QR 掃描入口', value: selectedItem.qr_scan_path ? '已建立' : '-' },
          { label: '條碼', value: selectedItem.barcode || '-' },
          { label: '序號', value: selectedItem.serial_number || '-' },
          { label: '位置', value: formatLocation(selectedItem) },
          { label: '安裝日期', value: formatDate(selectedItem.installed_at) },
          { label: '更新時間', value: formatDate(selectedItem.updated_at) },
          { label: '備註', value: selectedItem.notes || '-' },
        ]}
      />
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-900">建檔 / 貼標進度</h3>
        <OnboardingProgress status={selectedItem.onboarding_status} />
      </div>
      {selectedItem.onboarding_review_note && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          <div className="text-xs font-semibold text-slate-500">最近複核說明</div>
          <div className="mt-1 whitespace-pre-wrap">{selectedItem.onboarding_review_note}</div>
          {selectedItem.onboarding_reviewed_at && (
            <div className="mt-2 text-xs text-slate-400">{formatDate(selectedItem.onboarding_reviewed_at)}</div>
          )}
        </div>
      )}
      {selectedItem.onboarding_status === 'PENDING_GA_REVIEW' && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
            <div>
              <div className="text-sm font-bold text-orange-900">待總務複核貼標照片</div>
              <p className="mt-1 text-xs leading-5 text-orange-800">
                確認設備照片與 QR 標籤貼附位置清楚且對應正確後，才完成建檔；若照片不清楚或貼錯位置，請退回建檔人員重拍。
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void submitOnboardingReview(selectedItem, 'approve')}
              disabled={reviewingId === selectedItem.id}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {reviewingId === selectedItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              照片正確，完成建檔
            </button>
            <button
              type="button"
              onClick={() => void submitOnboardingReview(selectedItem, 'reject')}
              disabled={reviewingId === selectedItem.id}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {reviewingId === selectedItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              退回重拍
            </button>
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-900">保固摘要</h3>
        <AssetBadge tone={getWarrantyState(selectedItem).tone}>{getWarrantyState(selectedItem).label}</AssetBadge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/general-affairs/equipment/labels?ids=${encodeURIComponent(selectedItem.id)}`}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" />
          列印 QR 標籤
        </Link>
        {selectedItem.qr_scan_path && (
          <Link
            href={selectedItem.qr_scan_path}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            <QrCode className="h-4 w-4" />
            開啟掃描頁
          </Link>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-900">維修歷程</h3>
        <AssetMaintenanceTimeline records={maintenanceRecords} unavailableReason={maintenanceError} />
      </div>
      <ResourceAttachmentPanel
        resourceType="EQUIPMENT"
        resourceId={selectedItem.id}
        purpose="PRIMARY_IMAGE"
        canManage
        title="設備照片"
        emptyLabel="尚未上傳設備照片"
        uploadButtonLabel="上傳設備照片"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        helpText="支援 JPG、PNG、WebP、HEIC，單檔上限 20MB。"
      />
      <ResourceAttachmentPanel
        resourceType="EQUIPMENT"
        resourceId={selectedItem.id}
        purpose="LABEL_POSITION_IMAGE"
        canManage
        title="標籤貼附位置照片"
        emptyLabel="尚未上傳標籤貼附位置照片"
        uploadButtonLabel="上傳貼標照片"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        helpText="支援 JPG、PNG、WebP、HEIC，單檔上限 20MB。"
      />
      <ResourceAttachmentPanel
        resourceType="EQUIPMENT"
        resourceId={selectedItem.id}
        canManage
        title="其他附件"
        emptyLabel="尚未上傳其他附件"
      />
    </AssetDetailPanel>
  ) : undefined;

  function renderList() {
    if (loading) {
      return <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-orange-600" /></div>;
    }
    if (permissionDenied) {
      return <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-800">目前帳號沒有設備查看權限，若是店長或督導，請確認是否已建立門市管理範圍。</div>;
    }
    if (error) {
      return <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-sm text-red-800">{error}</div>;
    }
    if (filteredItems.length === 0) {
      return <div className="rounded-lg border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">目前沒有符合條件的設備。</div>;
    }

    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-[1180px] w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">設備</th>
                <th className="px-4 py-3">據點 / 位置</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-4 py-3">公司型號</th>
                <th className="px-4 py-3">資產資訊</th>
                <th className="px-4 py-3">狀態</th>
                <th className="px-4 py-3">建檔進度</th>
                <th className="px-4 py-3">重要度</th>
                <th className="px-4 py-3">保固</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => (
                <tr key={item.id} className={selectedItem?.id === item.id ? 'bg-orange-50/70' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelectedId(item.id)} className="flex min-w-0 items-center gap-3 text-left">
                      <EquipmentThumbnail src={thumbnailUrls[item.id]} name={item.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-900">{item.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{[item.brand, item.model].filter(Boolean).join(' / ') || '未填品牌型號'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{formatStore(item.store)}</div>
                    <div className="mt-1 text-xs text-slate-400">{formatLocation(item)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.category?.name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.template ? (
                      <div><div className="font-medium text-slate-800">{item.template.model || item.template.name}</div><div className="mt-1 text-xs text-slate-400">{item.template.brand || '-'}</div></div>
                    ) : <span className="text-xs text-amber-700">未連結</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{item.asset_code || '未編資產'}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.serial_number || '無序號'}</div>
                  </td>
                  <td className="px-4 py-3"><AssetBadge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</AssetBadge></td>
                  <td className="px-4 py-3"><OnboardingProgress status={item.onboarding_status} compact /></td>
                  <td className="px-4 py-3 text-slate-600">{CRITICALITY_LABELS[item.criticality]}</td>
                  <td className="px-4 py-3"><AssetBadge tone={getWarrantyState(item).tone}>{getWarrantyState(item).label}</AssetBadge></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => openEdit(item)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="編輯">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <Link href={`/general-affairs/equipment/labels?ids=${encodeURIComponent(item.id)}`} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="列印 QR 標籤">
                        <Printer className="h-4 w-4" />
                      </Link>
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
          {filteredItems.map((item) => (
            <div key={item.id} className="p-4">
              <button type="button" onClick={() => setSelectedId(item.id)} className="flex w-full items-start gap-3 text-left">
                <EquipmentThumbnail src={thumbnailUrls[item.id]} name={item.name} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{item.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{formatStore(item.store)} / {formatLocation(item)}</span>
                  <span className="mt-1 block text-xs text-slate-400">公司型號：{item.template?.model || item.template?.name || '未連結'}</span>
                </span>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <AssetBadge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</AssetBadge>
                <AssetBadge tone={getWarrantyState(item).tone}>{getWarrantyState(item).label}</AssetBadge>
              </div>
              <div className="mt-3">
                <OnboardingProgress status={item.onboarding_status} compact />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Link href={`/general-affairs/equipment/labels?ids=${encodeURIComponent(item.id)}`} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">列印 QR</Link>
                <button type="button" onClick={() => openEdit(item)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">編輯</button>
                <button type="button" onClick={() => softDelete(item)} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600">刪除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
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
            <span>目前查看：<strong>{templateFilterName || '指定公司設備型號'}</strong></span>
            <button type="button" onClick={() => { setTemplateFilter(''); setTemplateFilterName(''); window.history.replaceState({}, '', '/general-affairs/equipment'); }} className="shrink-0 font-bold underline underline-offset-2">清除</button>
          </div>
        )}
        {message && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${messageClass(message.type)}`}>
            {message.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}
        {renderList()}
      </GeneralAffairsListPage>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4">
          <form onSubmit={submitForm} className="w-full max-w-5xl rounded-lg bg-slate-50 shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing ? '編輯設備' : '新增設備'}</h2>
                <p className="mt-1 text-sm text-slate-500">依序填寫據點、資產識別、狀態位置與保固資訊。</p>
              </div>
              <button type="button" onClick={closeDialog} className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 p-5">
              <AssetFormSection title="基本資料" description="選擇據點與分類，建立可被維修回報連結的設備資料。" icon={<Settings2 className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <AssetCatalogPicker
                    label="公司設備型號"
                    emptyLabel="尚未連結公司設備型號"
                    options={templates.map((template) => ({
                      id: template.id,
                      title: template.name,
                      detail: [template.brand, template.model].filter(Boolean).join(' / '),
                    }))}
                    value={form.template_id}
                    onChange={selectTemplate}
                  />
                  <AssetSitePicker
                    options={stores}
                    value={form.store_id}
                    onChange={(value) => updateForm('store_id', value)}
                  />
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">分類 *</span>
                    <select value={form.category_id} onChange={(event) => updateForm('category_id', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      <option value="">請選擇分類</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">設備名稱 *</span>
                    <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">用途</span>
                    <input value={form.purpose} onChange={(event) => updateForm('purpose', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                </div>
              </AssetFormSection>

              <AssetFormSection title="資產識別" description="用於據點盤點、條碼查找與可能重複設備提示。" icon={<ClipboardList className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    ['asset_code', '資產編號'],
                    ['barcode', '條碼'],
                    ['brand', '品牌'],
                    ['model', '型號'],
                    ['serial_number', '序號'],
                  ].map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="text-sm font-semibold text-slate-700">{label}</span>
                      <input value={form[key as keyof EquipmentForm] as string} onChange={(event) => updateForm(key as keyof EquipmentForm, event.target.value as any)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                    </label>
                  ))}
                </div>
              </AssetFormSection>

              <AssetFormSection title="狀態與位置" description="狀態與重要程度只更新主檔，不代表 soft delete 或維修狀態。" icon={<Wrench className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">狀態</span>
                    <select value={form.status} onChange={(event) => updateForm('status', event.target.value as EquipmentStatus)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {EQUIPMENT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">重要程度</span>
                    <select value={form.criticality} onChange={(event) => updateForm('criticality', event.target.value as EquipmentCriticality)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {EQUIPMENT_CRITICALITIES.map((value) => <option key={value} value={value}>{CRITICALITY_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">建檔 / 貼標進度</span>
                    <select value={form.onboarding_status} onChange={(event) => updateForm('onboarding_status', event.target.value as EquipmentOnboardingStatus)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm">
                      {EQUIPMENT_ONBOARDING_STATUSES.map((status) => <option key={status} value={status}>{ONBOARDING_STATUS_LABELS[status]}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">安裝日期</span>
                    <input type="date" value={form.installed_at} onChange={(event) => updateForm('installed_at', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">區域</span>
                    <input value={form.area} onChange={(event) => updateForm('area', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">詳細位置</span>
                    <input value={form.location_detail} onChange={(event) => updateForm('location_detail', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">購買金額</span>
                    <input type="number" min="0" step="0.01" value={form.purchase_amount} onChange={(event) => updateForm('purchase_amount', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                </div>
              </AssetFormSection>

              <AssetFormSection title="保固與備註" description="目前只保存保固到期日；保固文件、供應商與採購流程尚未建置。" icon={<ShieldCheck className="h-4 w-4" />}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="flex items-center gap-2 pt-7">
                    <input type="checkbox" checked={form.has_warranty} onChange={(event) => updateForm('has_warranty', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                    <span className="text-sm font-semibold text-slate-700">有保固</span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">保固到期日</span>
                    <input type="date" value={form.warranty_end_date} disabled={!form.has_warranty} onChange={(event) => updateForm('warranty_end_date', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm disabled:bg-slate-100" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">標籤</span>
                    <input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} placeholder="以逗號分隔" className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block md:col-span-3">
                    <span className="text-sm font-semibold text-slate-700">備註</span>
                    <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              </AssetFormSection>

              {editing && (
                <AssetFormSection
                  title="設備圖片與附件"
                  description="重新編輯既有設備時，可在此補充圖片或 PDF；附件會寫入總務共用附件模組，不影響主檔儲存狀態。"
                  icon={<FileText className="h-4 w-4" />}
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ResourceAttachmentPanel
                      resourceType="EQUIPMENT"
                      resourceId={editing.id}
                      purpose="PRIMARY_IMAGE"
                      canManage
                      title="設備照片"
                      emptyLabel="尚未上傳設備照片"
                      uploadButtonLabel="上傳設備照片"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      helpText="支援 JPG、PNG、WebP、HEIC，單檔上限 20MB。"
                    />
                    <ResourceAttachmentPanel
                      resourceType="EQUIPMENT"
                      resourceId={editing.id}
                      purpose="LABEL_POSITION_IMAGE"
                      canManage
                      title="標籤貼附位置照片"
                      emptyLabel="尚未上傳標籤貼附位置照片"
                      uploadButtonLabel="上傳貼標照片"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      helpText="支援 JPG、PNG、WebP、HEIC，單檔上限 20MB。"
                    />
                    <div className="lg:col-span-2">
                      <ResourceAttachmentPanel
                        resourceType="EQUIPMENT"
                        resourceId={editing.id}
                        canManage
                        title="其他附件"
                        emptyLabel="尚未上傳其他附件"
                      />
                    </div>
                  </div>
                </AssetFormSection>
              )}
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
