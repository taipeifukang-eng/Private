'use client';

import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ImageIcon,
  Loader2,
  MapPin,
  QrCode,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsFormPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import CategoryCascadePicker from '@/components/general-affairs/assets/AssetCategoryPicker';
import AssetSitePicker from '@/components/general-affairs/assets/AssetSitePicker';
import { AssetBadge, AssetFormSection } from '@/components/general-affairs/assets/AssetManagementUI';
import { createClient } from '@/lib/supabase/client';
import {
  FACILITY_CRITICALITIES,
  FACILITY_STATUSES,
  type FacilityCriticality,
  type FacilityStatus,
} from '@/lib/general-affairs/facilities/types';

type StoreOption = { id: string; store_code: string; store_name: string; short_name?: string | null };
type CategoryOption = { id: string; parent_id: string | null; name: string; code: string };
type TemplateOption = { id: string; code: string; name: string; category_id?: string | null; brand?: string | null; model?: string | null; width_cm?: number | null; height_cm?: number | null; depth_cm?: number | null; description?: string | null };
type CompatiblePart = { id: string; part_id: string; part?: { name?: string | null; part_code?: string | null; specification?: string | null } | null };

type FacilityForm = {
  entry_mode: '' | 'EXISTING_ASSET' | 'NEW_PURCHASE';
  facility_template_id: string;
  name: string;
  category_id: string;
  status: FacilityStatus;
  criticality: FacilityCriticality;
  description: string;
  tags: string;
  brand: string;
  model: string;
  store_id: string;
  area: string;
  location_detail: string;
  floor_area_description: string;
  installed_at: string;
  purchased_at: string;
  quantity: string;
  unit: string;
  purchase_unit_amount: string;
  last_renovated_at: string;
  has_warranty: boolean;
  warranty_start_date: string;
  warranty_end_date: string;
  warranty_claim_method: string;
  warranty_description: string;
  warranty_claim_notes: string;
  notes: string;
};

type StepId = 'basic' | 'location' | 'maintenanceWarranty' | 'confirm';

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  purpose: 'PRIMARY_IMAGE' | 'WARRANTY_DOCUMENT';
};

const EMPTY_FORM: FacilityForm = {
  entry_mode: '',
  facility_template_id: '',
  name: '',
  category_id: '',
  status: 'ACTIVE',
  criticality: 'NORMAL',
  description: '',
  tags: '',
  brand: '',
  model: '',
  store_id: '',
  area: '',
  location_detail: '',
  floor_area_description: '',
  installed_at: '',
  purchased_at: '',
  quantity: '1',
  unit: '座',
  purchase_unit_amount: '',
  last_renovated_at: '',
  has_warranty: false,
  warranty_start_date: '',
  warranty_end_date: '',
  warranty_claim_method: '',
  warranty_description: '',
  warranty_claim_notes: '',
  notes: '',
};

const FACILITY_DRAFT_KEY = 'ga:facility-store-create-draft';

const STEPS: Array<{ id: StepId; label: string; description: string }> = [
  { id: 'basic', label: '基本資訊', description: '名稱、分類、狀態與辨識資訊' },
  { id: 'location', label: '位置資訊', description: '門市、區域與詳細位置' },
  { id: 'maintenanceWarranty', label: '維護與保固資訊', description: '啟用日期、圖片與保固條件' },
  { id: 'confirm', label: '確認建立', description: '送出前檢查所有資料' },
];

const STATUS_LABELS: Record<FacilityStatus, string> = {
  ACTIVE: '使用中',
  PARTIALLY_DAMAGED: '部分損壞',
  OUT_OF_SERVICE: '停用中',
  UNDER_RENOVATION: '整修中',
  RETIRED: '退役',
};

const CRITICALITY_LABELS: Record<FacilityCriticality, string> = {
  LOW: '一般',
  NORMAL: '一般',
  HIGH: '重要',
  CRITICAL: '關鍵',
};

const STORE_AREA_OPTIONS = [
  '前場營業區',
  '收銀區',
  '調劑區',
  '處方作業區',
  '藥品儲存區',
  '倉庫／後倉',
  '辦公區',
  '員工休息區',
  '廁所',
  '戶外／騎樓',
  '機房／設備區',
  '其他',
];

const WARRANTY_CLAIM_METHODS = [
  { value: '', label: '未設定' },
  { value: 'INVOICE_OR_RECEIPT', label: '保留購買方發票／收據' },
  { value: 'ONLINE_REGISTRATION', label: '上網登錄保固' },
  { value: 'SERIAL_NUMBER_REGISTRATION', label: '序號登錄保固' },
  { value: 'VENDOR_WARRANTY_CARD', label: '供應商／原廠保固卡' },
  { value: 'CONTRACT_OR_QUOTATION', label: '合約／報價單約定' },
  { value: 'NO_DOCUMENT_REQUIRED', label: '免單據，依序號或購買紀錄' },
  { value: 'OTHER', label: '其他方式，請於備註補充' },
] as const;

const ATTACHMENT_PURPOSE_LABELS: Record<PendingAttachment['purpose'], string> = {
  PRIMARY_IMAGE: '設施圖片',
  WARRANTY_DOCUMENT: '保固文件',
};

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function normalizeTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function safeErrorMessage(error: unknown, fallback = '操作失敗') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'details', 'hint', 'code']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function parseResponse(response: Response, fallback = '操作失敗') {
  const text = await response.text();
  let json: Record<string, any> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 300) };
  }
  if (!response.ok || json.success === false) throw new Error(safeErrorMessage(json.error, fallback));
  return json;
}

function getCategoryPath(categoryId: string, byId: Map<string, CategoryOption>) {
  const path: CategoryOption[] = [];
  let current = byId.get(categoryId) || null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) || null : null;
  }
  return path;
}

function getWarrantyMonths(startDate: string, endDate: string) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
}

function formatDate(value: string) {
  return value || '未填';
}

function formatCurrency(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || value === '') return '未填';
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount);
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null;
}

function FacilityCategoryPicker({
  categories,
  byId,
  value,
  onChange,
  error,
  containerRef,
}: {
  categories: CategoryOption[];
  byId: Map<string, CategoryOption>;
  value: string;
  onChange: (categoryId: string) => void;
  error: ReactNode;
  containerRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <CategoryCascadePicker
      categories={categories}
      byId={byId}
      value={value}
      onChange={onChange}
      error={error}
      containerRef={containerRef}
      label="設施分類 *"
      emptyLabel="尚未選擇設施分類"
      guidance="先選第 1 層，再依序選擇下層；也可用關鍵字搜尋分類名稱或代碼。"
      pathLabel="目前分類路徑"
      required={false}
      mdColSpanClassName="md:col-span-2"
    />
  );
}

function Stepper({ currentStep, highestStep, onSelect }: { currentStep: StepId; highestStep: number; onSelect: (step: StepId) => void }) {
  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
  return (
    <nav className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="hidden grid-cols-4 gap-2 md:grid">
        {STEPS.map((step, index) => {
          const active = step.id === currentStep;
          const complete = index < currentIndex;
          const reachable = index <= highestStep;
          return (
            <button
              type="button"
              key={step.id}
              disabled={!reachable}
              onClick={() => onSelect(step.id)}
              className={[
                'rounded-md px-3 py-2 text-left transition',
                active ? 'bg-orange-600 text-white' : complete ? 'bg-orange-50 text-orange-800' : 'bg-slate-50 text-slate-600',
                !reachable ? 'cursor-not-allowed opacity-50' : 'hover:bg-orange-50 hover:text-orange-800',
              ].join(' ')}
            >
              <div className="text-xs font-semibold">Step {index + 1}</div>
              <div className="mt-1 text-sm font-bold">{step.label}</div>
              <div className={active ? 'mt-1 text-xs text-orange-50' : 'mt-1 text-xs text-slate-500'}>{step.description}</div>
            </button>
          );
        })}
      </div>
      <div className="md:hidden">
        <div className="text-xs font-semibold text-orange-700">{currentIndex + 1} / {STEPS.length}</div>
        <div className="mt-1 text-base font-bold text-slate-900">{STEPS[currentIndex]?.label}</div>
        <div className="mt-2 h-2 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-orange-600 transition-all" style={{ width: `${((currentIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
    </nav>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}

export default function FacilityCreatePageClient() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [compatibleParts, setCompatibleParts] = useState<CompatiblePart[]>([]);
  const [loadingCompatibleParts, setLoadingCompatibleParts] = useState(false);
  const [form, setForm] = useState<FacilityForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [createdQrScanPath, setCreatedQrScanPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId>('basic');
  const [highestStep, setHighestStep] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const selectedStore = stores.find((store) => store.id === form.store_id);
  const selectedCategoryPath = form.category_id ? getCategoryPath(form.category_id, categoryById) : [];
  const selectedCategoryLabel = selectedCategoryPath.length
    ? selectedCategoryPath.map((category) => category.name).join(' > ')
    : '未選';
  const warrantyMonths = getWarrantyMonths(form.warranty_start_date, form.warranty_end_date);
  const purchaseTotal = Number(form.quantity || 0) * Number(form.purchase_unit_amount || 0);
  const selectedTemplate = templates.find((template) => template.id === form.facility_template_id) || null;
  const filteredTemplates = useMemo(() => {
    const keyword = templateSearch.trim().toLowerCase();
    const matches = keyword ? templates.filter((template) => [template.code, template.name, template.model, template.width_cm, template.height_cm, template.depth_cm].filter(Boolean).join(' ').toLowerCase().includes(keyword)) : templates;
    return matches.slice(0, 8);
  }, [templateSearch, templates]);

  const loadOptions = useCallback(async () => {
    const [storesResult, categoryRes, templatesRes] = await Promise.all([
      supabase.from('stores').select('id, store_code, store_name, short_name').eq('is_active', true).order('store_code'),
      fetch('/api/general-affairs/categories?type=facility'),
      fetch('/api/general-affairs/facility-templates'),
    ]);
    if (!storesResult.error) setStores((storesResult.data || []) as StoreOption[]);
    if (categoryRes.ok) setCategories(((await categoryRes.json()).data || []) as CategoryOption[]);
    if (templatesRes.ok) setTemplates(((await templatesRes.json()).data || []) as TemplateOption[]);
  }, [supabase]);

  useEffect(() => {
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(FACILITY_DRAFT_KEY);
      if (raw) {
        setForm({ ...EMPTY_FORM, ...JSON.parse(raw), facility_template_id: '' });
        setDirty(true);
      }
    } catch {
      window.sessionStorage.removeItem(FACILITY_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (!templates.length) return;
    const templateId = new URLSearchParams(window.location.search).get('templateId');
    if (!templateId) return;
    const template = templates.find((item) => item.id === templateId);
    if (template) {
      selectTemplate(template);
      window.sessionStorage.removeItem(FACILITY_DRAFT_KEY);
      window.history.replaceState({}, '', '/general-affairs/facilities/new');
    }
  }, [templates]);

  useEffect(() => {
    if (!form.facility_template_id) { setCompatibleParts([]); return; }
    let active = true;
    setLoadingCompatibleParts(true);
    fetch(`/api/general-affairs/parts/target-compatibilities?targetType=FACILITY_TEMPLATE&targetId=${encodeURIComponent(form.facility_template_id)}`, { cache: 'no-store' })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || '相容料件載入失敗'); return body; })
      .then((body) => { if (active) setCompatibleParts(body.data || []); })
      .catch(() => { if (active) setCompatibleParts([]); })
      .finally(() => { if (active) setLoadingCompatibleParts(false); });
    return () => { active = false; };
  }, [form.facility_template_id]);

  function selectTemplate(template: TemplateOption) {
    setForm((current) => ({ ...current, facility_template_id: template.id, category_id: template.category_id || current.category_id, brand: template.brand || current.brand, model: template.model || template.code, description: template.description || `${template.name}｜寬 ${template.width_cm || '-'} × 高 ${template.height_cm || '-'} × 深 ${template.depth_cm || '-'} cm` }));
    setTemplateSearch(`${template.code} ${template.name}`);
    setDirty(true);
  }

  function preserveDraftBeforeCatalog() {
    window.sessionStorage.setItem(FACILITY_DRAFT_KEY, JSON.stringify(form));
    setDirty(false);
    if (pendingAttachments.length) window.alert('文字資料已暫存；返回後請重新選擇照片與附件。');
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => () => {
    pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
  }, [pendingAttachments]);

  function updateForm<K extends keyof FacilityForm>(key: K, value: FacilityForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'has_warranty' && value === false) {
        next.warranty_start_date = '';
        next.warranty_end_date = '';
        next.warranty_claim_method = '';
        next.warranty_description = '';
        next.warranty_claim_notes = '';
      }
      if (key === 'warranty_claim_method' && value !== 'OTHER') {
        next.warranty_claim_notes = '';
      }
      return next;
    });
    setDirty(true);
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  function addPendingAttachments(files: FileList | null, purpose: PendingAttachment['purpose']) {
    if (!files?.length) return;
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(file.type)) {
        setMessage(`${file.name} 檔案格式不支援`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setMessage(`${file.name} 超過 20MB 限制`);
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        purpose,
      });
    }
    if (next.length) {
      setPendingAttachments((current) => [...current, ...next].slice(0, 10));
      setDirty(true);
      setMessage('');
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
    setDirty(true);
  }

  function validateStep(step: StepId, source = form) {
    const next: Record<string, string> = {};

    if (step === 'basic') {
      if (!source.entry_mode) next.entry_mode = '請先選擇這次是既有設施補登或新購設施';
      if (!source.facility_template_id) next.facility_template_id = '請先選擇公司設施架型；若公司尚未建立此架型，請先新增公司設施架型';
      if (!source.name.trim()) next.name = '請輸入設施名稱';
      if (!source.category_id) next.category_id = '請選擇設施分類';
      if (!source.status) next.status = '請選擇狀態';
    }

    if (step === 'location') {
      if (!source.store_id) next.store_id = '請選擇所在據點';
      if (!source.area.trim()) next.area = '請選擇或輸入據點區域';
      if (!source.location_detail.trim()) next.location_detail = '請輸入詳細位置';
    }

    if (step === 'maintenanceWarranty') {
      if (!Number.isFinite(Number(source.quantity)) || Number(source.quantity) <= 0) next.quantity = '數量必須大於 0';
      if (!source.unit.trim()) next.unit = '請輸入設施單位';
      if (source.entry_mode === 'NEW_PURCHASE' && !source.purchased_at) next.purchased_at = '新購設施請填寫購買日期';
      if (source.entry_mode === 'NEW_PURCHASE' && (!source.purchase_unit_amount || Number(source.purchase_unit_amount) <= 0)) next.purchase_unit_amount = '新購設施請填寫大於 0 的每單位金額';
      if (source.has_warranty) {
        if (!source.warranty_start_date) next.warranty_start_date = '有保固時請填寫保固開始日期';
        if (!source.warranty_end_date) next.warranty_end_date = '有保固時請填寫保固到期日期';
        if (source.warranty_start_date && source.warranty_end_date && source.warranty_start_date > source.warranty_end_date) {
          next.warranty_start_date = '保固開始日期不可晚於保固到期日期';
          next.warranty_end_date = '保固到期日期不可早於保固開始日期';
        }
      }
    }

    return next;
  }

  function stepForField(field: string): StepId {
    if (['entry_mode', 'name', 'category_id', 'status'].includes(field)) return 'basic';
    if (['store_id', 'area', 'location_detail'].includes(field)) return 'location';
    return 'maintenanceWarranty';
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const firstKey = Object.keys(nextErrors)[0];
    if (!firstKey) return;
    const nextStep = stepForField(firstKey);
    setCurrentStep(nextStep);
    window.setTimeout(() => {
      fieldRefs.current[firstKey]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      fieldRefs.current[firstKey]?.focus();
    }, 80);
  }

  function validateSteps(steps: StepId[]) {
    const nextErrors = steps.reduce<Record<string, string>>((acc, step) => ({ ...acc, ...validateStep(step) }), {});
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) focusFirstError(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function goNext() {
    if (!validateSteps([currentStep])) return;
    const index = STEPS.findIndex((step) => step.id === currentStep);
    const nextStep = STEPS[Math.min(STEPS.length - 1, index + 1)]?.id;
    if (nextStep) {
      setCurrentStep(nextStep);
      setHighestStep((current) => Math.max(current, index + 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function goPrevious() {
    const index = STEPS.findIndex((step) => step.id === currentStep);
    const previousStep = STEPS[Math.max(0, index - 1)]?.id;
    if (previousStep) {
      setCurrentStep(previousStep);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function uploadPendingAttachments(resourceId: string) {
    if (!pendingAttachments.length) return;
    const grouped = pendingAttachments.reduce<Record<PendingAttachment['purpose'], PendingAttachment[]>>((acc, attachment) => {
      acc[attachment.purpose] = [...(acc[attachment.purpose] || []), attachment];
      return acc;
    }, { PRIMARY_IMAGE: [], WARRANTY_DOCUMENT: [] });

    for (const [purpose, attachments] of Object.entries(grouped) as Array<[PendingAttachment['purpose'], PendingAttachment[]]>) {
      if (!attachments.length) continue;
      const formData = new FormData();
      formData.set('resource_type', 'FACILITY');
      formData.set('resource_id', resourceId);
      formData.set('purpose', purpose);
      formData.set('is_primary', purpose === 'PRIMARY_IMAGE' ? 'true' : 'false');
      attachments.forEach((attachment) => formData.append('files', attachment.file));
      await parseResponse(await fetch('/api/general-affairs/attachments', { method: 'POST', body: formData }), '附件上傳失敗');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!validateSteps(['basic', 'location', 'maintenanceWarranty'])) return;

    setSaving(true);
    setMessage('');
    setCreatedQrScanPath('');
    try {
      const response = await parseResponse(await fetch('/api/general-affairs/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: form.store_id,
          category_id: form.category_id,
          facility_template_id: form.facility_template_id || null,
          name: form.name,
          status: form.status,
          criticality: form.criticality,
          area: form.area || null,
          location_detail: form.location_detail || null,
          quantity: Number(form.quantity),
          unit: form.unit,
          is_fixed_asset: true,
          installed_at: form.installed_at || null,
          purchased_at: form.purchased_at || null,
          purchase_unit_amount: form.purchase_unit_amount ? Number(form.purchase_unit_amount) : null,
          purchase_amount: form.purchase_unit_amount ? purchaseTotal : null,
          last_renovated_at: form.last_renovated_at || null,
          description: form.description || null,
          specs: {
            entry_mode: form.entry_mode,
            facility_brand: form.brand.trim() || null,
            facility_model: form.model.trim() || null,
            facility_floor_area_description: form.floor_area_description.trim() || null,
            facility_has_warranty: form.has_warranty,
            facility_warranty_start_date: form.has_warranty ? form.warranty_start_date || null : null,
            facility_warranty_end_date: form.has_warranty ? form.warranty_end_date || null : null,
            facility_warranty_claim_method: form.has_warranty ? form.warranty_claim_method || null : null,
            facility_warranty_description: form.has_warranty ? form.warranty_description.trim() || null : null,
            facility_warranty_claim_notes: form.has_warranty && form.warranty_claim_method === 'OTHER' ? form.warranty_claim_notes.trim() || null : null,
          },
          tags: normalizeTags(form.tags),
          notes: form.notes || null,
        }),
      }), '設施建立失敗');

      const facilityId = response?.data?.id;
      if (facilityId) {
        try {
          await uploadPendingAttachments(facilityId);
        } catch (uploadError) {
          setDirty(false);
          setMessage(`設施已新增，但附件上傳失敗：${safeErrorMessage(uploadError, '請稍後在設施詳情重新上傳附件')}`);
          return;
        }
      }

      setDirty(false);
      setCreatedQrScanPath(response?.data?.qr_scan_path || '');
      setMessage(`設施已新增：${response?.data?.name || form.name}（${facilityId || '已建立'}）。QR 掃描入口已由後端建立。`);
      window.setTimeout(() => {
        if (!response?.data?.qr_scan_path) router.push(facilityId ? `/general-affairs/facilities?createdFacilityId=${facilityId}` : '/general-affairs/facilities');
      }, 500);
    } catch (error) {
      setMessage(safeErrorMessage(error, '設施建立失敗'));
    } finally {
      setSaving(false);
    }
  }

  function renderValidationSummary() {
    const activeErrors = Object.entries(errors).filter(([, value]) => Boolean(value));
    if (!activeErrors.length) return null;
    return (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="h-4 w-4" />
          請先修正以下欄位
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {activeErrors.map(([key, value]) => (
            <li key={key}>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => focusFirstError({ [key]: value })}>
                {value}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const inputClass = 'mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100';
  const textareaClass = 'mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <form onSubmit={submit}>
        <GeneralAffairsFormPage
          header={(
            <GeneralAffairsPageHeader
              breadcrumbs={[
                { label: '總務服務中心', href: '/general-affairs' },
                { label: '設施管理', href: '/general-affairs/facilities' },
                { label: '新增設施' },
              ]}
              title="新增設施"
              description="從公司既有架型建立據點設施，並記錄位置、數量、購買金額與保固。"
            />
          )}
          stepper={<Stepper currentStep={currentStep} highestStep={highestStep} onSelect={setCurrentStep} />}
          contextPanel={(
            <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-bold text-slate-900">建立摘要</h2>
              <div className="text-slate-600">方式：{form.entry_mode === 'NEW_PURCHASE' ? '新購／新開店設施' : form.entry_mode === 'EXISTING_ASSET' ? '既有設施補登' : '未選'}</div>
              <div className="text-slate-600">設施：{form.name || '未填'}</div>
              <div className="text-slate-600">分類：{selectedCategoryLabel}</div>
              <div className="text-slate-600">門市：{selectedStore ? `${selectedStore.store_code} ${selectedStore.short_name || selectedStore.store_name}` : '未選'}</div>
              <div className="text-slate-600">位置：{form.area || '未選'}{form.location_detail ? ` / ${form.location_detail}` : ''}</div>
              <div className="text-slate-600">保固：{form.has_warranty ? '有保固' : '無保固'}</div>
              <div className="text-slate-600">數量：{form.quantity || '0'} {form.unit}</div>
              <div className="text-slate-600">購買總額：{form.purchase_unit_amount ? formatCurrency(purchaseTotal) : '未填'}</div>
            </aside>
          )}
          actionFooter={(
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/general-affairs/facilities" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                <ArrowLeft className="h-4 w-4" />
                回設施列表
              </Link>
              <div className="flex flex-wrap gap-2">
                {currentStep !== 'basic' && (
                  <button type="button" onClick={goPrevious} disabled={saving} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                    上一步
                  </button>
                )}
                {currentStep !== 'confirm' ? (
                  <button type="button" onClick={goNext} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-orange-300">
                    下一步
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-orange-300">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    確認建立
                  </button>
                )}
              </div>
            </div>
          )}
        >
          {message && (
            <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${message.startsWith('設施已新增') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {message.startsWith('設施已新增') ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
              <span>
                {message}
                {createdQrScanPath && (
                  <Link href={createdQrScanPath} className="ml-2 font-semibold underline underline-offset-2">
                    開啟 QR 掃描入口
                  </Link>
                )}
              </span>
            </div>
          )}

          {renderValidationSummary()}

          {currentStep === 'basic' && (
            <AssetFormSection title="基本資訊" description="建立設施的名稱、分類、狀態與辨識資訊。品牌與型號為非必填，適合鐵捲門、自動門、招牌、門禁設備等設施。">
              <div className="grid gap-4 md:grid-cols-2">
                <section ref={(node) => { fieldRefs.current.entry_mode = node; }} tabIndex={-1} className="md:col-span-2">
                  <div className="text-sm font-black text-slate-950">這次為什麼要登錄設施？</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => updateForm('entry_mode', 'EXISTING_ASSET')} className={`rounded-md border p-4 text-left ${form.entry_mode === 'EXISTING_ASSET' ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}><span className="block text-sm font-bold text-slate-950">既有設施補登</span><span className="mt-1 block text-xs text-slate-500">門市原本就有，歷史購買日期或金額不知道可以留白。</span></button>
                    <button type="button" onClick={() => updateForm('entry_mode', 'NEW_PURCHASE')} className={`rounded-md border p-4 text-left ${form.entry_mode === 'NEW_PURCHASE' ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}><span className="block text-sm font-bold text-slate-950">新購／新開店設施</span><span className="mt-1 block text-xs text-slate-500">這次新購買，需留下購買日期、數量與每單位金額。</span></button>
                  </div>
                  <FieldError message={errors.entry_mode} />
                </section>
                <section ref={(node) => { fieldRefs.current.facility_template_id = node; }} tabIndex={-1} className="rounded-md border border-orange-200 bg-orange-50 p-4 outline-none md:col-span-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-slate-950">這個據點要新增哪一種設施？</div><div className="mt-1 text-xs text-slate-600">從公司設施架型選取後，自動套用尺寸與適用料件。</div></div><Link onClick={preserveDraftBeforeCatalog} href="/general-affairs/facilities/templates?returnTo=/general-affairs/facilities/new" className="text-xs font-bold text-orange-700 underline underline-offset-2">找不到？先新增公司設施架型</Link></div>
                  <input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} className={`${inputClass} mt-3`} placeholder="搜尋 HH01、中島架或尺寸 120" />
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                    {filteredTemplates.map((template) => <button key={template.id} type="button" onClick={() => selectTemplate(template)} className={`flex w-full items-center justify-between rounded-md border px-3 py-3 text-left ${form.facility_template_id === template.id ? 'border-orange-500 bg-white' : 'border-orange-100 bg-white hover:border-orange-300'}`}><span><span className="font-mono text-xs font-bold text-orange-700">{template.code}</span><span className="ml-2 text-sm font-bold text-slate-900">{template.name}</span></span><span className="text-xs text-slate-500">{template.width_cm || '-'} × {template.height_cm || '-'} × {template.depth_cm || '-'} cm</span></button>)}
                    {!filteredTemplates.length && <div className="rounded-md bg-white p-3 text-sm text-slate-500">找不到相符架型，請先確認名稱、型號或尺寸。</div>}
                  </div>
                  {selectedTemplate && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3"><div className="text-sm font-bold text-emerald-900">已套用 {selectedTemplate.code}｜{selectedTemplate.name}</div><div className="mt-1 text-xs text-emerald-800">尺寸：{selectedTemplate.width_cm || '-'} × {selectedTemplate.height_cm || '-'} × {selectedTemplate.depth_cm || '-'} cm</div><div className="mt-2 text-xs font-bold text-emerald-900">適用料件：{loadingCompatibleParts ? '載入中' : compatibleParts.length ? compatibleParts.map((row) => row.part?.name || row.part?.part_code).filter(Boolean).join('、') : '尚未設定'}</div></div>}
                  <FieldError message={errors.facility_template_id} />
                </section>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">設施名稱 *</span>
                  <input ref={(node) => { fieldRefs.current.name = node; }} value={form.name} onChange={(event) => updateForm('name', event.target.value)} className={inputClass} placeholder="例如：門市正門鐵捲門" />
                  <FieldError message={errors.name} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">狀態 *</span>
                  <select ref={(node) => { fieldRefs.current.status = node; }} value={form.status} onChange={(event) => updateForm('status', event.target.value as FacilityStatus)} className={inputClass}>
                    {FACILITY_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                  <FieldError message={errors.status} />
                </label>
                <FacilityCategoryPicker
                  categories={categories}
                  byId={categoryById}
                  value={form.category_id}
                  onChange={(categoryId) => updateForm('category_id', categoryId)}
                  error={<FieldError message={errors.category_id} />}
                  containerRef={(node) => { fieldRefs.current.category_id = node; }}
                />
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">重要程度</span>
                  <select value={form.criticality} onChange={(event) => updateForm('criticality', event.target.value as FacilityCriticality)} className={inputClass}>
                    {FACILITY_CRITICALITIES.map((value) => <option key={value} value={value}>{CRITICALITY_LABELS[value]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">品牌</span>
                  <input ref={(node) => { fieldRefs.current.brand = node; }} value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} className={inputClass} placeholder="非必填" />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">型號</span>
                  <input ref={(node) => { fieldRefs.current.model = node; }} value={form.model} onChange={(event) => updateForm('model', event.target.value)} className={inputClass} placeholder="非必填" />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">設施描述</span>
                  <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className={textareaClass} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">標籤</span>
                  <input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} className={inputClass} placeholder="以逗號分隔，例如：門面,安全,大型設施" />
                </label>
              </div>
            </AssetFormSection>
          )}

          {currentStep === 'location' && (
            <AssetFormSection title="位置資訊" description="位置資料會影響店長、督導與總務的可見範圍；據點選項只取目前 API / RLS 允許的資料。">
              <div className="grid gap-4 md:grid-cols-2">
                <AssetSitePicker
                  ref={(node) => { fieldRefs.current.store_id = node; }}
                  options={stores}
                  value={form.store_id}
                  onChange={(value) => updateForm('store_id', value)}
                  error={errors.store_id}
                />
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">據點區域 *</span>
                  <input
                    ref={(node) => { fieldRefs.current.area = node; }}
                    list="facility-store-area-options"
                    value={form.area}
                    onChange={(event) => updateForm('area', event.target.value)}
                    className={inputClass}
                    placeholder="例如：調劑區"
                  />
                  <datalist id="facility-store-area-options">
                    {STORE_AREA_OPTIONS.map((area) => <option key={area} value={area} />)}
                  </datalist>
                  <FieldError message={errors.area} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">詳細位置 *</span>
                  <input ref={(node) => { fieldRefs.current.location_detail = node; }} value={form.location_detail} onChange={(event) => updateForm('location_detail', event.target.value)} className={inputClass} placeholder="例如：調劑台上方天花板、門市正門入口" />
                  <FieldError message={errors.location_detail} />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">所在樓層／區域描述</span>
                  <input value={form.floor_area_description} onChange={(event) => updateForm('floor_area_description', event.target.value)} className={inputClass} placeholder="例如：一樓前場、二樓倉庫右側牆面" />
                </label>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 md:col-span-2">
                  `是否全店共用設施` 目前沒有正式 DB 欄位，本輪不顯示 checkbox、也不送 API；若要納入正式流程，需另行設計欄位與 RLS / API 影響。
                </div>
              </div>
            </AssetFormSection>
          )}

          {currentStep === 'maintenanceWarranty' && (
            <div className="space-y-4">
              <AssetFormSection title="購買與維護資訊" description={form.entry_mode === 'NEW_PURCHASE' ? '新購設施請留下購買日期、數量與每單位金額。' : '既有設施以可取得的資料補登，歷史金額可留白。'}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">數量 *</span>
                    <input ref={(node) => { fieldRefs.current.quantity = node; }} type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => updateForm('quantity', event.target.value)} className={inputClass} />
                    <FieldError message={errors.quantity} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">單位 *</span>
                    <input ref={(node) => { fieldRefs.current.unit = node; }} value={form.unit} onChange={(event) => updateForm('unit', event.target.value)} className={inputClass} placeholder="座、組、面" />
                    <FieldError message={errors.unit} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">購買日期 {form.entry_mode === 'NEW_PURCHASE' ? '*' : ''}</span>
                    <input ref={(node) => { fieldRefs.current.purchased_at = node; }} type="date" value={form.purchased_at} onChange={(event) => updateForm('purchased_at', event.target.value)} className={inputClass} />
                    <FieldError message={errors.purchased_at} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">每單位購買金額 {form.entry_mode === 'NEW_PURCHASE' ? '*' : ''}</span>
                    <input ref={(node) => { fieldRefs.current.purchase_unit_amount = node; }} type="number" min="0" step="0.01" value={form.purchase_unit_amount} onChange={(event) => updateForm('purchase_unit_amount', event.target.value)} className={inputClass} />
                    <div className="mt-1 text-xs text-slate-500">購買總額：{form.purchase_unit_amount ? formatCurrency(purchaseTotal) : '未填'}</div>
                    <FieldError message={errors.purchase_unit_amount} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">建置／啟用日期</span>
                    <input type="date" value={form.installed_at} onChange={(event) => updateForm('installed_at', event.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">最近整修日期</span>
                    <input type="date" value={form.last_renovated_at} onChange={(event) => updateForm('last_renovated_at', event.target.value)} className={inputClass} />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">備註</span>
                    <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} className={textareaClass} />
                  </label>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <ImageIcon className="h-4 w-4 text-orange-600" />
                      設施圖片
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">支援 JPG、PNG、WebP、HEIC 與 PDF，單檔上限 20MB。建立設施成功後才會上傳到正式附件 API，不顯示假上傳成功。</p>
                    <input
                      type="file"
                      accept={FILE_ACCEPT}
                      multiple
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        addPendingAttachments(event.target.files, 'PRIMARY_IMAGE');
                        event.target.value = '';
                      }}
                      className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-orange-700"
                    />
                  </div>
                </div>
              </AssetFormSection>

              <AssetFormSection title="保固資訊" description="設施可能具有保固；有保固時必須填寫保固開始與到期日期。">
                <div className="space-y-4">
                  <div ref={(node) => { fieldRefs.current.has_warranty = node; }} tabIndex={-1} className="grid gap-3 outline-none md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => updateForm('has_warranty', false)}
                      className={`rounded-lg border p-4 text-left ${!form.has_warranty ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700'}`}
                    >
                      <div className="text-sm font-bold">無保固</div>
                      <p className="mt-1 text-xs leading-5">不要求保固日期，送出時不保留隱藏保固欄位。</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateForm('has_warranty', true)}
                      className={`rounded-lg border p-4 text-left ${form.has_warranty ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700'}`}
                    >
                      <div className="text-sm font-bold">有保固</div>
                      <p className="mt-1 text-xs leading-5">需填寫保固開始與到期日期，可附保固文件。</p>
                    </button>
                  </div>
                  {form.has_warranty && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">保固開始日期 *</span>
                        <input ref={(node) => { fieldRefs.current.warranty_start_date = node; }} type="date" value={form.warranty_start_date} onChange={(event) => updateForm('warranty_start_date', event.target.value)} className={inputClass} />
                        <FieldError message={errors.warranty_start_date} />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">保固到期日期 *</span>
                        <input ref={(node) => { fieldRefs.current.warranty_end_date = node; }} type="date" value={form.warranty_end_date} onChange={(event) => updateForm('warranty_end_date', event.target.value)} className={inputClass} />
                        <FieldError message={errors.warranty_end_date} />
                      </label>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 md:col-span-2">
                        保固年限／剩餘時間：{warrantyMonths === null ? '填寫起訖日期後自動計算' : `約 ${warrantyMonths} 個月`}
                      </div>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">申請保固方式</span>
                        <select value={form.warranty_claim_method} onChange={(event) => updateForm('warranty_claim_method', event.target.value)} className={inputClass}>
                          {WARRANTY_CLAIM_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">保固說明</span>
                        <input value={form.warranty_description} onChange={(event) => updateForm('warranty_description', event.target.value)} className={inputClass} placeholder="例如：依供應商施工保固一年" />
                      </label>
                      {form.warranty_claim_method === 'OTHER' && (
                        <label className="block md:col-span-2">
                          <span className="text-sm font-semibold text-slate-700">其他保固方式備註</span>
                          <textarea value={form.warranty_claim_notes} onChange={(event) => updateForm('warranty_claim_notes', event.target.value)} rows={3} className={textareaClass} placeholder="請補充申請保固時需要準備的資料、聯絡方式或供應商要求。" />
                        </label>
                      )}
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <ShieldCheck className="h-4 w-4 text-orange-600" />
                          保固文件
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">可先選擇發票、單據、保固卡、施工合約或 PDF；建立設施成功後再上傳。</p>
                        <input
                          type="file"
                          accept={FILE_ACCEPT}
                          multiple
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            addPendingAttachments(event.target.files, 'WARRANTY_DOCUMENT');
                            event.target.value = '';
                          }}
                          className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-orange-700"
                        />
                      </div>
                    </div>
                  )}
                  {pendingAttachments.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {pendingAttachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                          {attachment.previewUrl ? (
                            <img src={attachment.previewUrl} alt="" className="h-14 w-14 rounded-md object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">PDF</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-800">{attachment.file.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{ATTACHMENT_PURPOSE_LABELS[attachment.purpose]} / {(attachment.file.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                          <button type="button" onClick={() => removePendingAttachment(attachment.id)} className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-red-600" aria-label="移除附件">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </AssetFormSection>
            </div>
          )}

          {currentStep === 'confirm' && (
            <AssetFormSection title="確認建立" description="送出前請確認設施、位置與保固資訊。確認建立後才會送出 API。">
              <dl className="rounded-lg border border-slate-200 bg-white px-4">
                <SummaryRow label="公司設施" value={selectedTemplate ? `${selectedTemplate.code}｜${selectedTemplate.name}` : '未選'} />
                {selectedTemplate && <SummaryRow label="繼承適用料件" value={compatibleParts.length ? compatibleParts.map((row) => row.part?.name || row.part?.part_code).filter(Boolean).join('、') : '架型尚未設定相容料件'} />}
                <SummaryRow label="設施名稱" value={form.name} />
                <SummaryRow label="建檔方式" value={form.entry_mode === 'NEW_PURCHASE' ? '新購／新開店設施' : '既有設施補登'} />
                <SummaryRow label="設施分類" value={selectedCategoryLabel} />
                <SummaryRow label="狀態" value={STATUS_LABELS[form.status]} />
                <SummaryRow label="重要程度" value={CRITICALITY_LABELS[form.criticality]} />
                <SummaryRow label="品牌" value={form.brand || '—'} />
                <SummaryRow label="型號" value={form.model || '—'} />
                <SummaryRow label="所在據點" value={selectedStore ? `${selectedStore.store_code} ${selectedStore.short_name || selectedStore.store_name}` : '未選'} />
                <SummaryRow label="據點區域" value={form.area} />
                <SummaryRow label="詳細位置" value={form.location_detail} />
                <SummaryRow label="樓層／區域描述" value={form.floor_area_description || '—'} />
                <SummaryRow label="建置／啟用日期" value={formatDate(form.installed_at)} />
                <SummaryRow label="數量" value={`${form.quantity} ${form.unit}`} />
                <SummaryRow label="購買日期" value={formatDate(form.purchased_at)} />
                <SummaryRow label="每單位購買金額" value={form.purchase_unit_amount ? formatCurrency(form.purchase_unit_amount) : '—'} />
                <SummaryRow label="購買總額" value={form.purchase_unit_amount ? formatCurrency(purchaseTotal) : '—'} />
                <SummaryRow label="最近整修日期" value={formatDate(form.last_renovated_at)} />
                <SummaryRow label="保固" value={form.has_warranty ? <AssetBadge tone="green">有保固</AssetBadge> : <AssetBadge tone="slate">無保固</AssetBadge>} />
                {form.has_warranty && (
                  <>
                    <SummaryRow label="保固期間" value={`${formatDate(form.warranty_start_date)} ～ ${formatDate(form.warranty_end_date)}`} />
                    <SummaryRow label="申請保固方式" value={WARRANTY_CLAIM_METHODS.find((method) => method.value === form.warranty_claim_method)?.label || '未設定'} />
                    <SummaryRow label="保固說明" value={form.warranty_description || '—'} />
                    <SummaryRow label="保固備註" value={form.warranty_claim_notes || '—'} />
                  </>
                )}
                <SummaryRow label="附件" value={`${pendingAttachments.length} 個待上傳檔案`} />
                <SummaryRow label="備註" value={form.notes || '—'} />
              </dl>
              <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                <div className="flex items-center gap-2 font-semibold">
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code 掃描入口
                </div>
                <p className="mt-1">
                  儲存後系統會自動建立長期有效的 QR token 與掃描入口。QR Code 只綁定設施識別，不直接綁定維修表單路由、門市、位置或狀態；未來掃描頁顯示內容或維修流程調整時，不需要重印既有貼紙。
                </p>
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                <Building2 className="mr-1 inline h-3.5 w-3.5 text-orange-600" />
                本頁不送出設備專屬欄位，例如資產編號、序號、購買金額或條碼。
              </div>
            </AssetFormSection>
          )}
        </GeneralAffairsFormPage>
      </form>
    </main>
  );
}


