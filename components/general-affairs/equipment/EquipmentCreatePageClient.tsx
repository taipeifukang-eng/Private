'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ImageIcon, Loader2, Printer, QrCode, Save, X } from 'lucide-react';
import Link from 'next/link';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsFormPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import CategoryCascadePicker from '@/components/general-affairs/assets/AssetCategoryPicker';
import AssetSitePicker from '@/components/general-affairs/assets/AssetSitePicker';
import { AssetBadge, AssetFormSection } from '@/components/general-affairs/assets/AssetManagementUI';
import { createClient } from '@/lib/supabase/client';
import {
  EQUIPMENT_CRITICALITIES,
  EQUIPMENT_STATUSES,
  type EquipmentCriticality,
  type EquipmentOnboardingStatus,
  type EquipmentStatus,
} from '@/lib/general-affairs/equipment/types';

type StoreOption = { id: string; store_code: string; store_name: string; short_name?: string | null };
type CategoryOption = { id: string; parent_id: string | null; name: string; code: string };
type EquipmentTemplateOption = { id: string; category_id: string; name: string; brand: string | null; model: string | null; description: string | null; default_warranty_months: number | null };
type EquipmentForm = {
  entry_mode: '' | 'EXISTING_ASSET' | 'NEW_PURCHASE';
  template_id: string;
  name: string;
  status: EquipmentStatus;
  category_id: string;
  criticality: EquipmentCriticality;
  brand: string;
  purchase_source_supplier: string;
  model: string;
  purpose: string;
  serial_number: string;
  barcode: string;
  store_id: string;
  location_detail: string;
  area: string;
  installed_at: string;
  purchased_at: string;
  purchase_amount: string;
  quantity: string;
  has_warranty: boolean;
  warranty_claim_method: string;
  warranty_claim_notes: string;
  warranty_end_date: string;
  tags: string;
  notes: string;
};

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  purpose: 'PRIMARY_IMAGE' | 'LABEL_POSITION_IMAGE' | 'WARRANTY_DOCUMENT';
};

const EMPTY_FORM: EquipmentForm = {
  entry_mode: '',
  template_id: '',
  name: '',
  status: 'ACTIVE',
  category_id: '',
  criticality: 'NORMAL',
  brand: '',
  purchase_source_supplier: '',
  model: '',
  purpose: '',
  serial_number: '',
  barcode: '',
  store_id: '',
  location_detail: '',
  area: '',
  installed_at: '',
  purchased_at: '',
  purchase_amount: '',
  quantity: '1',
  has_warranty: false,
  warranty_claim_method: '',
  warranty_claim_notes: '',
  warranty_end_date: '',
  tags: '',
  notes: '',
};

const EQUIPMENT_DRAFT_KEY = 'ga:equipment-store-create-draft';

const STEPS = [
  { id: 'basic', label: '基本資訊' },
  { id: 'installation', label: '安裝資訊' },
  { id: 'warranty', label: '保固資訊' },
  { id: 'other', label: '其他資訊' },
  { id: 'confirm', label: '完成確認' },
] as const;

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  ACTIVE: '使用中',
  TEMPORARILY_STOPPED: '暫停使用',
  SPARE: '備品',
  RETIRED: '退役',
  SCRAPPED: '報廢',
};

const CRITICALITY_LABELS: Record<EquipmentCriticality, string> = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  CRITICAL: '關鍵',
};

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
  PRIMARY_IMAGE: '設備圖片',
  LABEL_POSITION_IMAGE: '標籤貼附位置照片',
  WARRANTY_DOCUMENT: '保固文件',
};

const ONBOARDING_STATUS_LABELS: Record<EquipmentOnboardingStatus, string> = {
  NEEDS_EQUIPMENT_PHOTO: '待上傳設備照片',
  NEEDS_LABEL_PHOTO: '待貼標照片',
  PENDING_GA_REVIEW: '待總務複核',
  COMPLETED: '已完成',
};

function formatCurrency(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || value.trim() === '') return '未填';
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount);
}

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

function getLevel2Category(category: CategoryOption, byId: Map<string, CategoryOption>) {
  const path: CategoryOption[] = [];
  let current: CategoryOption | null = category;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) || null : null;
  }
  return path[1] || null;
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

function EquipmentCategoryPicker({
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
      label="設備分類"
      emptyLabel="尚未選擇設備分類"
      guidance="先選第一層，再依序選擇下層；也可用關鍵字搜尋分類名稱或代碼。"
      mdColSpanClassName="md:col-span-3"
    />
  );
}

export default function EquipmentCreatePageClient() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [templates, setTemplates] = useState<EquipmentTemplateOption[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [createdQrScanPath, setCreatedQrScanPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  const selectedCategory = categories.find((category) => category.id === form.category_id) || null;
  const selectedTemplate = templates.find((template) => template.id === form.template_id) || null;
  const selectedStore = stores.find((store) => store.id === form.store_id) || null;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const primaryImageAttachments = pendingAttachments.filter((attachment) => attachment.purpose === 'PRIMARY_IMAGE');
  const labelPositionAttachments = pendingAttachments.filter((attachment) => attachment.purpose === 'LABEL_POSITION_IMAGE');
  const warrantyDocumentAttachments = pendingAttachments.filter((attachment) => attachment.purpose === 'WARRANTY_DOCUMENT');
  const createQuantity = Number(form.quantity) || 1;
  const filteredTemplates = useMemo(() => {
    const keyword = templateSearch.trim().toLowerCase();
    const list = keyword
      ? templates.filter((template) => [template.name, template.brand, template.model].filter(Boolean).join(' ').toLowerCase().includes(keyword))
      : templates;
    return list.slice(0, 8);
  }, [templateSearch, templates]);
  const onboardingStatus = useMemo<EquipmentOnboardingStatus>(() => {
    if (createQuantity > 1) return 'NEEDS_EQUIPMENT_PHOTO';
    const hasEquipmentPhoto = primaryImageAttachments.length > 0;
    const hasLabelPhoto = labelPositionAttachments.length > 0;
    if (!hasEquipmentPhoto) return 'NEEDS_EQUIPMENT_PHOTO';
    if (!hasLabelPhoto) return 'NEEDS_LABEL_PHOTO';
    return 'PENDING_GA_REVIEW';
  }, [createQuantity, labelPositionAttachments.length, primaryImageAttachments.length]);

  const generatedAssetCodePreview = useMemo(() => {
    if (!selectedCategory || !form.purchased_at) return '待分類與購置日期完整後，由 DB helper 產生';
    const level2Category = getLevel2Category(selectedCategory, categoryById);
    if (!level2Category) return '請選擇第二層分類或其下層分類，資產編號需使用第二層分類 4 碼代碼';
    const normalizedCode = level2Category.code.trim().toUpperCase();
    if (!/^[A-Z]{2}\d{2}$/.test(normalizedCode)) return '第二層分類代碼尚未符合 4 碼格式，例如 IC01 或 AS01';
    return `${normalizedCode}${form.purchased_at.replaceAll('-', '')}###`;
  }, [categoryById, form.purchased_at, selectedCategory]);

  const loadOptions = useCallback(async () => {
    const [storesResult, categoryRes, templateRes] = await Promise.all([
      supabase.from('stores').select('id, store_code, store_name, short_name').eq('is_active', true).order('store_code'),
      fetch('/api/general-affairs/categories?type=equipment'),
      fetch('/api/general-affairs/equipment/templates?pageSize=100&active=true&sortBy=name&sortDir=asc'),
    ]);
    if (!storesResult.error) setStores((storesResult.data || []) as StoreOption[]);
    if (categoryRes.ok) setCategories(((await categoryRes.json()).data || []) as CategoryOption[]);
    if (templateRes.ok) setTemplates(((await templateRes.json()).data || []) as EquipmentTemplateOption[]);
  }, [supabase]);

  useEffect(() => {
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(EQUIPMENT_DRAFT_KEY);
      if (raw) {
        setForm({ ...EMPTY_FORM, ...JSON.parse(raw), template_id: '' });
        setDirty(true);
      }
    } catch {
      window.sessionStorage.removeItem(EQUIPMENT_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (!templates.length) return;
    const templateId = new URLSearchParams(window.location.search).get('templateId');
    if (!templateId) return;
    const template = templates.find((item) => item.id === templateId);
    if (template) {
      selectTemplate(template);
      window.sessionStorage.removeItem(EQUIPMENT_DRAFT_KEY);
      window.history.replaceState({}, '', '/general-affairs/equipment/new');
    }
  }, [templates]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    };
  }, []);

  function updateForm<K extends keyof EquipmentForm>(key: K, value: EquipmentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  function updateQuantity(value: string) {
    updateForm('quantity', value);
    if (Number(value) > 1) {
      setForm((current) => ({ ...current, quantity: value, serial_number: '', barcode: '' }));
      setPendingAttachments((current) => {
        current.forEach((attachment) => { if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl); });
        return [];
      });
    }
  }

  function selectTemplate(template: EquipmentTemplateOption) {
    setForm((current) => ({
      ...current,
      template_id: template.id,
      category_id: template.category_id,
      name: template.name,
      brand: template.brand || '',
      model: template.model || '',
      purpose: template.description || current.purpose,
    }));
    setDirty(true);
    setErrors((current) => ({ ...current, template_id: '', category_id: '', name: '', brand: '' }));
  }

  function preserveDraftBeforeCatalog() {
    window.sessionStorage.setItem(EQUIPMENT_DRAFT_KEY, JSON.stringify(form));
    setDirty(false);
    if (pendingAttachments.length) window.alert('文字資料已暫存；返回後請重新選擇照片與附件。');
  }

  function validate(targetStep = step) {
    const next: Record<string, string> = {};
    if (targetStep === 0) {
      if (!form.entry_mode) next.entry_mode = '請先選擇這次是既有資產補登或新購設備';
      if (!form.template_id) next.template_id = '請先選擇公司設備型號；若公司尚未建立此型號，請先新增公司設備型號';
      if (!form.name.trim()) next.name = '請輸入設備名稱';
      if (!form.category_id) next.category_id = '請選擇設備分類';
      if (!form.brand.trim()) next.brand = '請輸入品牌';
    }
    if (targetStep === 1) {
      if (!form.store_id) next.store_id = '請選擇所在據點';
      if (!form.location_detail.trim()) next.location_detail = '請輸入安裝位置';
      if (form.purchase_amount && Number(form.purchase_amount) < 0) next.purchase_amount = '購買金額不可為負數';
      if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1 || Number(form.quantity) > 100) next.quantity = '新增數量必須是 1 至 100 的整數';
      if (form.entry_mode === 'NEW_PURCHASE' && !form.purchased_at) next.purchased_at = '新購設備請填寫購買日期';
      if (form.entry_mode === 'NEW_PURCHASE' && (!form.purchase_amount || Number(form.purchase_amount) <= 0)) next.purchase_amount = '新購設備請填寫大於 0 的每台購買金額';
    }
    if (targetStep === 2 && form.has_warranty && !form.warranty_end_date) {
      next.warranty_end_date = '有保固時請填寫保固到期日';
    }
    setErrors(next);
    const firstKey = Object.keys(next)[0];
    if (firstKey) {
      fieldRefs.current[firstKey]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      fieldRefs.current[firstKey]?.focus();
    }
    return Object.keys(next).length === 0;
  }

  function nextStep() {
    if (!validate(step)) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function previousStep() {
    setStep((current) => Math.max(current - 1, 0));
  }

  function addPendingAttachments(files: FileList | null, purpose: PendingAttachment['purpose'] = 'PRIMARY_IMAGE') {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) => {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(file.type)) {
        setMessage(`${file.name} 檔案格式不支援`);
        return false;
      }
      if (file.size > 20 * 1024 * 1024) {
        setMessage(`${file.name} 超過 20MB 限制`);
        return false;
      }
      return true;
    });
    if (!nextFiles.length) return;
    setPendingAttachments((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        purpose,
      })),
    ].slice(0, 10));
    setDirty(true);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
    setDirty(true);
  }

  async function uploadEquipmentAttachments(equipmentId: string) {
    if (!pendingAttachments.length) return;
    const groups = new Map<PendingAttachment['purpose'], PendingAttachment[]>();
    pendingAttachments.forEach((attachment) => {
      const list = groups.get(attachment.purpose) || [];
      list.push(attachment);
      groups.set(attachment.purpose, list);
    });

    for (const [purpose, attachments] of Array.from(groups.entries())) {
      const formData = new FormData();
      formData.set('resource_type', 'EQUIPMENT');
      formData.set('resource_id', equipmentId);
      formData.set('purpose', purpose);
      formData.set('is_primary', purpose === 'PRIMARY_IMAGE' ? 'true' : 'false');
      attachments.forEach((attachment: PendingAttachment) => formData.append('files', attachment.file));
      const response = await fetch('/api/general-affairs/attachments', {
        method: 'POST',
        body: formData,
      });
      await parseResponse(response, `${ATTACHMENT_PURPOSE_LABELS[purpose]}上傳失敗`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    for (let index = 0; index < STEPS.length - 1; index += 1) {
      if (!validate(index)) {
        setStep(index);
        return;
      }
    }
    setSaving(true);
    setMessage('');
    setCreatedQrScanPath('');
    try {
      const payload = {
        store_id: form.store_id,
        category_id: form.category_id,
        template_id: form.template_id || null,
        quantity: createQuantity,
        name: form.name,
        asset_code: null,
        barcode: form.barcode || null,
        brand: form.brand,
        model: form.model || null,
        serial_number: form.serial_number || null,
        status: form.status,
        criticality: form.criticality,
        onboarding_status: onboardingStatus,
        area: form.area || null,
        location_detail: form.location_detail,
        purpose: form.purpose || null,
        installed_at: form.installed_at || null,
        purchased_at: form.purchased_at || null,
        purchase_amount: form.purchase_amount ? Number(form.purchase_amount) : null,
        tags: normalizeTags(form.tags),
        notes: form.notes || null,
        has_warranty: form.has_warranty,
        warranty_end_date: form.has_warranty ? form.warranty_end_date || null : null,
        specs: {
          entry_mode: form.entry_mode,
          purchase_source_supplier: form.purchase_source_supplier.trim() || null,
          warranty_claim_method: form.warranty_claim_method || null,
          warranty_claim_notes: form.warranty_claim_method === 'OTHER' ? form.warranty_claim_notes.trim() || null : null,
        },
      };
      const response = await fetch('/api/general-affairs/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await parseResponse(response, '設備建立失敗');
      const equipmentId = json.data?.id;
      if (equipmentId && createQuantity === 1) {
        try {
          await uploadEquipmentAttachments(equipmentId);
        } catch (uploadError) {
          pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
          setPendingAttachments([]);
          setDirty(false);
          setForm(EMPTY_FORM);
          setStep(4);
          setMessage(`設備已新增，但附件上傳失敗：${safeErrorMessage(uploadError, '請稍後在設備詳情重新上傳附件')}`);
          return;
        }
      }
      setDirty(false);
      pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      setPendingAttachments([]);
      setCreatedQrScanPath(json.data?.qr_scan_path || '');
      const createdCount = Number(json.createdCount || createQuantity);
      setMessage(createdCount > 1 ? `已新增 ${createdCount} 台據點設備，每台資產編號與 QR 均已獨立建立。` : pendingAttachments.length ? '設備已新增，附件已上傳。資產編號與 QR 掃描入口已由後端建立。' : '設備已新增。資產編號與 QR 掃描入口已由後端建立。');
      setForm(EMPTY_FORM);
      setTemplateSearch('');
      setStep(4);
    } catch (err) {
      setMessage(safeErrorMessage(err, '設備建立失敗'));
    } finally {
      setSaving(false);
    }
  }

  function errorFor(key: keyof EquipmentForm) {
    return errors[key] ? <p className="mt-1 text-xs text-red-600">{errors[key]}</p> : null;
  }

  const header = (
    <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: '設備管理', href: '/general-affairs/equipment' },
        { label: '新增設備' },
      ]}
      title="新增設備"
      description="將公司已建立的設備型號登錄到指定門市，並補上位置、購買資訊與實體識別資料。"
    />
  );

  const stepper = (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-5">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => index <= step && setStep(index)}
            className={[
              'rounded-md border px-3 py-2 text-left text-sm font-semibold',
              index === step
                ? 'border-orange-300 bg-orange-50 text-orange-800'
                : index < step
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-500',
            ].join(' ')}
          >
            <span className="block text-xs">Step {index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  const inputClass = 'mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <form onSubmit={submit}>
        <GeneralAffairsFormPage
          header={header}
          stepper={stepper}
          contextPanel={(
            <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <h2 className="font-bold text-slate-900">建立摘要</h2>
              <dl className="space-y-2 text-slate-600">
                <div><dt className="text-xs font-semibold text-slate-500">建檔方式</dt><dd>{form.entry_mode === 'NEW_PURCHASE' ? '新購／新開店設備' : form.entry_mode === 'EXISTING_ASSET' ? '既有資產補登' : '未選'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">公司設備</dt><dd>{selectedTemplate ? [selectedTemplate.brand, selectedTemplate.model || selectedTemplate.name].filter(Boolean).join(' / ') : '未選'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">設備</dt><dd>{form.name || '未填'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">門市</dt><dd>{selectedStore ? `${selectedStore.store_code} ${selectedStore.short_name || selectedStore.store_name}` : '未選'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">分類</dt><dd>{selectedCategory?.name || '未選'}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">資產編號</dt><dd>{generatedAssetCodePreview}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">每台購買金額</dt><dd>{formatCurrency(form.purchase_amount)}</dd></div>
                <div><dt className="text-xs font-semibold text-slate-500">新增數量</dt><dd>{createQuantity} 台</dd></div>
              </dl>
            </aside>
          )}
          actionFooter={(
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/general-affairs/equipment" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                <ArrowLeft className="h-4 w-4" />
                回設備列表
              </Link>
              <div className="flex gap-2">
                {step > 0 && <button type="button" onClick={previousStep} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">上一步</button>}
                {step < STEPS.length - 1 ? (
                  <button type="button" onClick={nextStep} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white">
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
            <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${message.includes('已新增') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {message.includes('已新增') ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
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

          {step === 0 && (
            <AssetFormSection title="基本資訊" description="建立設備主檔最小必要資料；品牌用於設備辨識，購買途徑／供應商先暫存於規格資料，後續可串接廠商主檔。">
              <div className="grid gap-4 md:grid-cols-3">
                <section ref={(node) => { fieldRefs.current.entry_mode = node; }} tabIndex={-1} className="md:col-span-3">
                  <div className="text-sm font-black text-slate-950">這次為什麼要登錄設備？</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => updateForm('entry_mode', 'EXISTING_ASSET')} className={`rounded-md border p-4 text-left ${form.entry_mode === 'EXISTING_ASSET' ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}>
                      <span className="block text-sm font-bold text-slate-950">既有資產補登</span>
                      <span className="mt-1 block text-xs text-slate-500">公司原本就有，現在補進系統；不知道歷史金額可以留白。</span>
                    </button>
                    <button type="button" onClick={() => updateForm('entry_mode', 'NEW_PURCHASE')} className={`rounded-md border p-4 text-left ${form.entry_mode === 'NEW_PURCHASE' ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}>
                      <span className="block text-sm font-bold text-slate-950">新購／新開店設備</span>
                      <span className="mt-1 block text-xs text-slate-500">這次新購買，需留下購買日期與每台金額。</span>
                    </button>
                  </div>
                  {errors.entry_mode && <p className="mt-2 text-xs text-red-600">{errors.entry_mode}</p>}
                </section>
                <section ref={(node) => { fieldRefs.current.template_id = node; }} tabIndex={-1} className="rounded-md border border-orange-200 bg-orange-50 p-4 outline-none md:col-span-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-black text-slate-950">這個據點要新增哪一種設備？</div>
                      <div className="mt-1 text-xs text-slate-600">選到型號後會自動帶入分類、名稱、品牌與型號，並沿用該型號的適用料件。</div>
                    </div>
                    <Link onClick={preserveDraftBeforeCatalog} href="/general-affairs/equipment/templates?returnTo=/general-affairs/equipment/new" className="text-xs font-bold text-orange-700 underline underline-offset-2">找不到？先新增公司設備型號</Link>
                  </div>
                  <input value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} className="mt-3 h-10 w-full rounded-md border border-orange-200 bg-white px-3 text-sm outline-none focus:border-orange-400" placeholder="搜尋品牌、型號或設備名稱" />
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {filteredTemplates.map((template) => (
                      <button key={template.id} type="button" onClick={() => selectTemplate(template)} className={`rounded-md border px-3 py-3 text-left ${form.template_id === template.id ? 'border-orange-500 bg-white' : 'border-orange-100 bg-white hover:border-orange-300'}`}>
                        <span className="block text-sm font-bold text-slate-900">{template.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{[template.brand, template.model].filter(Boolean).join(' / ') || '未填品牌型號'}</span>
                      </button>
                    ))}
                  </div>
                  {filteredTemplates.length === 0 && <div className="mt-2 rounded-md border border-dashed border-orange-200 bg-white px-3 py-4 text-center text-sm text-slate-500">找不到既有設備型號</div>}
                  {errors.template_id && <p className="mt-2 text-xs text-red-600">{errors.template_id}</p>}
                </section>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">設備名稱 *</span>
                  <input ref={(node) => { fieldRefs.current.name = node; }} value={form.name} onChange={(event) => updateForm('name', event.target.value)} className={inputClass} />
                  {errorFor('name')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">狀態 *</span>
                  <select value={form.status} onChange={(event) => updateForm('status', event.target.value as EquipmentStatus)} className={inputClass}>
                    {EQUIPMENT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </label>
                <EquipmentCategoryPicker
                  categories={categories}
                  byId={categoryById}
                  value={form.category_id}
                  onChange={(categoryId) => updateForm('category_id', categoryId)}
                  error={errorFor('category_id')}
                  containerRef={(node) => { fieldRefs.current.category_id = node; }}
                />
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">重要程度</span>
                  <select value={form.criticality} onChange={(event) => updateForm('criticality', event.target.value as EquipmentCriticality)} className={inputClass}>
                    {EQUIPMENT_CRITICALITIES.map((value) => <option key={value} value={value}>{CRITICALITY_LABELS[value]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">品牌 *</span>
                  <input ref={(node) => { fieldRefs.current.brand = node; }} value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} className={inputClass} />
                  {errorFor('brand')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">購買途徑／供應商</span>
                  <input value={form.purchase_source_supplier} onChange={(event) => updateForm('purchase_source_supplier', event.target.value)} className={inputClass} placeholder="例：原廠、經銷商、網購平台、某供應商" />
                  <p className="mt-1 text-xs text-slate-500">目前先保存為文字；後續廠商主檔流程完成後可改為選擇供應商。</p>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">型號</span>
                  <input value={form.model} onChange={(event) => updateForm('model', event.target.value)} className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">序號</span>
                  <input disabled={createQuantity > 1} value={form.serial_number} onChange={(event) => updateForm('serial_number', event.target.value)} className={`${inputClass} disabled:bg-slate-100`} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">條碼</span>
                  <input disabled={createQuantity > 1} value={form.barcode} onChange={(event) => updateForm('barcode', event.target.value)} className={`${inputClass} disabled:bg-slate-100`} />
                </label>
                {createQuantity > 1 && <p className="text-xs text-slate-500 md:col-span-3">批次新增時，每台序號、條碼與實機照片請在建立後逐台補登。</p>}
                <label className="block md:col-span-3">
                  <span className="text-sm font-semibold text-slate-700">設備用途／功能</span>
                  <textarea value={form.purpose} onChange={(event) => updateForm('purpose', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-slate-900"><ImageIcon className="h-4 w-4 text-orange-600" />設備照片</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">支援 JPG、PNG、WebP、HEIC，單檔 20MB 以內；設備建立成功後才會正式上傳並關聯。</p>
                    </div>
                    <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                      選擇設備照片
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          addPendingAttachments(event.target.files, 'PRIMARY_IMAGE');
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {primaryImageAttachments.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {primaryImageAttachments.map((attachment) => (
                        <div key={attachment.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="relative flex aspect-video items-center justify-center bg-slate-100">
                            {attachment.previewUrl ? (
                              <img src={attachment.previewUrl} alt={attachment.file.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="px-3 text-center text-xs font-semibold text-slate-500">PDF</div>
                            )}
                            <button
                              type="button"
                              onClick={() => removePendingAttachment(attachment.id)}
                              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-500 shadow-sm hover:text-red-600"
                              aria-label={`移除 ${attachment.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-1 p-3">
                            <div className="truncate text-sm font-semibold text-slate-800">{attachment.file.name}</div>
                            <div className="text-xs text-slate-500">{(attachment.file.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      尚未選擇設備照片。可先建立設備，後續再由門市補傳。
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-slate-900"><ImageIcon className="h-4 w-4 text-orange-600" />標籤貼附位置照片</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">貼上 QR 標籤後，上傳能看出標籤貼在哪裡的照片，方便之後維修與盤點核對。</p>
                    </div>
                    <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                      選擇貼標照片
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          addPendingAttachments(event.target.files, 'LABEL_POSITION_IMAGE');
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {labelPositionAttachments.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {labelPositionAttachments.map((attachment) => (
                        <div key={attachment.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="relative flex aspect-video items-center justify-center bg-slate-100">
                            {attachment.previewUrl ? (
                              <img src={attachment.previewUrl} alt={attachment.file.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="px-3 text-center text-xs font-semibold text-slate-500">圖片</div>
                            )}
                            <button
                              type="button"
                              onClick={() => removePendingAttachment(attachment.id)}
                              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-500 shadow-sm hover:text-red-600"
                              aria-label={`移除 ${attachment.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-1 p-3">
                            <div className="truncate text-sm font-semibold text-slate-800">{attachment.file.name}</div>
                            <div className="text-xs text-slate-500">{(attachment.file.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      尚未選擇標籤貼附位置照片。若尚未貼標，設備會先停在待貼標照片進度。
                    </div>
                  )}
                </div>
              </div>
            </AssetFormSection>
          )}

          {step === 1 && (
            <AssetFormSection title="安裝資訊" description="據點與安裝位置為必填。資產編號將由後端 helper/RPC 控制，前端不自行產生流水號。">
              <div className="grid gap-4 md:grid-cols-3">
                <AssetSitePicker
                  ref={(node) => { fieldRefs.current.store_id = node; }}
                  options={stores}
                  value={form.store_id}
                  onChange={(value) => updateForm('store_id', value)}
                  error={errors.store_id}
                />
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">安裝位置 *</span>
                  <input ref={(node) => { fieldRefs.current.location_detail = node; }} value={form.location_detail} onChange={(event) => updateForm('location_detail', event.target.value)} className={inputClass} />
                  {errorFor('location_detail')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">所在區域</span>
                  <input value={form.area} onChange={(event) => updateForm('area', event.target.value)} className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">新增數量 *</span>
                  <input ref={(node) => { fieldRefs.current.quantity = node; }} type="number" min="1" max="100" step="1" value={form.quantity} onChange={(event) => updateQuantity(event.target.value)} className={inputClass} />
                  {errorFor('quantity')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">安裝日期</span>
                  <input type="date" value={form.installed_at} onChange={(event) => updateForm('installed_at', event.target.value)} className={inputClass} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">購買日期 {form.entry_mode === 'NEW_PURCHASE' ? '*' : ''}</span>
                  <input ref={(node) => { fieldRefs.current.purchased_at = node; }} type="date" value={form.purchased_at} onChange={(event) => updateForm('purchased_at', event.target.value)} className={inputClass} />
                  {errorFor('purchased_at')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">每台購買金額 {form.entry_mode === 'NEW_PURCHASE' ? '*' : ''}</span>
                  <input ref={(node) => { fieldRefs.current.purchase_amount = node; }} type="number" min="0" step="0.01" value={form.purchase_amount} onChange={(event) => updateForm('purchase_amount', event.target.value)} className={inputClass} />
                  <p className="mt-1 text-xs text-slate-500">{formatCurrency(form.purchase_amount)}</p>
                  {errorFor('purchase_amount')}
                </label>
                {form.entry_mode === 'EXISTING_ASSET' && <p className="text-xs text-slate-500 md:col-span-3">既有資產若無法確認購買日期或金額，可直接留白，不影響建檔。</p>}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                  <div className="text-sm font-semibold text-slate-700">資產編號（只讀）</div>
                  <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700">{generatedAssetCodePreview}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">正式格式為 第二層分類代碼 4 碼 + 購買日期 YYYYMMDD + 3 碼流水號；流水以同一第二層分類與同一購買日期分組，儲存時由後端安全產生。</p>
                </div>
                <button type="button" disabled className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border border-slate-200 bg-slate-100 px-4 text-sm font-semibold text-slate-400">
                  <Printer className="h-4 w-4" />
                  標籤列印待資產編號產生後啟用
                </button>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800 md:col-span-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <QrCode className="h-4 w-4" />
                    QR Code 掃描入口
                  </div>
                  <p className="mt-1 text-xs leading-5">
                    儲存後系統會自動建立長期有效的 QR token 與掃描入口。QR Code 只綁定資產識別，不直接綁定維修表單路由、門市、位置或狀態；未來掃描頁顯示內容或維修流程調整時，不需要重印既有貼紙。
                  </p>
                </div>
              </div>
            </AssetFormSection>
          )}

          {step === 2 && (
            <AssetFormSection title="保固資訊" description="保存保固狀態、到期日、申請保固方式與保固文件；供應商關聯後續會串接廠商主檔。">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex items-center gap-2 pt-7">
                  <input type="checkbox" checked={form.has_warranty} onChange={(event) => updateForm('has_warranty', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                  <span className="text-sm font-semibold text-slate-700">有保固</span>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">保固到期日</span>
                  <input ref={(node) => { fieldRefs.current.warranty_end_date = node; }} type="date" disabled={!form.has_warranty} value={form.warranty_end_date} onChange={(event) => updateForm('warranty_end_date', event.target.value)} className={`${inputClass} disabled:bg-slate-100`} />
                  {errorFor('warranty_end_date')}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">申請保固方式</span>
                  <select value={form.warranty_claim_method} onChange={(event) => updateForm('warranty_claim_method', event.target.value)} className={inputClass}>
                    {WARRANTY_CLAIM_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>{method.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">依常見保固方式記錄，實際規則仍以供應商或原廠條款為準。</p>
                </label>
                {form.warranty_claim_method === 'OTHER' && (
                  <label className="block md:col-span-3">
                    <span className="text-sm font-semibold text-slate-700">其他保固方式備註</span>
                    <textarea
                      value={form.warranty_claim_notes}
                      onChange={(event) => updateForm('warranty_claim_notes', event.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                      placeholder="請補充申請保固時需要準備的資料、聯絡方式或供應商要求。"
                    />
                  </label>
                )}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-slate-900"><ImageIcon className="h-4 w-4 text-orange-600" />保固文件附件</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">可上傳發票、收據、保固卡、合約、上網登錄截圖或 PDF。設備建立成功後才會正式上傳並關聯。</p>
                    </div>
                    <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                      選擇保固文件
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          addPendingAttachments(event.target.files, 'WARRANTY_DOCUMENT');
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {warrantyDocumentAttachments.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {warrantyDocumentAttachments.map((attachment) => (
                        <div key={attachment.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="relative flex aspect-video items-center justify-center bg-slate-100">
                            {attachment.previewUrl ? (
                              <img src={attachment.previewUrl} alt={attachment.file.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="px-3 text-center text-xs font-semibold text-slate-500">PDF</div>
                            )}
                            <button
                              type="button"
                              onClick={() => removePendingAttachment(attachment.id)}
                              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-500 shadow-sm hover:text-red-600"
                              aria-label={`移除 ${attachment.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-1 p-3">
                            <div className="truncate text-sm font-semibold text-slate-800">{attachment.file.name}</div>
                            <div className="text-xs text-slate-500">{(attachment.file.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      尚未選擇保固文件。可上傳發票、保固卡、登錄截圖或 PDF。
                    </div>
                  )}
                </div>
              </div>
            </AssetFormSection>
          )}

          {step === 3 && (
            <AssetFormSection title="其他資訊" description="標籤以逗號分隔；備註用於內部補充，不取代維修紀錄。">
              <div className="grid gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">標籤</span>
                  <input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} className={inputClass} placeholder="例：DEV, 門市設備" />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">備註</span>
                  <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={5} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>
            </AssetFormSection>
          )}

          {step === 4 && (
            <AssetFormSection title="完成確認" description="送出前確認主檔內容。">
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <Summary label="設備名稱" value={form.name} />
                <Summary label="建檔方式" value={form.entry_mode === 'NEW_PURCHASE' ? '新購／新開店設備' : '既有資產補登'} />
                <Summary label="狀態" value={STATUS_LABELS[form.status]} />
                <Summary label="分類" value={selectedCategory?.name} />
                <Summary label="品牌 / 型號" value={[form.brand, form.model].filter(Boolean).join(' / ')} />
                <Summary label="購買途徑／供應商" value={form.purchase_source_supplier} />
                <Summary label="門市" value={selectedStore ? `${selectedStore.store_code} ${selectedStore.short_name || selectedStore.store_name}` : ''} />
                <Summary label="新增數量" value={`${createQuantity} 台`} />
                <Summary label="位置" value={[form.area, form.location_detail].filter(Boolean).join(' / ')} />
                <Summary label="建檔 / 貼標進度" value={ONBOARDING_STATUS_LABELS[onboardingStatus]} />
                <Summary label="每台購買金額" value={formatCurrency(form.purchase_amount)} />
                <Summary label="本次購買總額" value={form.purchase_amount ? formatCurrency(String(Number(form.purchase_amount) * createQuantity)) : ''} />
                <Summary label="申請保固方式" value={WARRANTY_CLAIM_METHODS.find((method) => method.value === form.warranty_claim_method)?.label} />
                {form.warranty_claim_method === 'OTHER' && <Summary label="其他保固方式備註" value={form.warranty_claim_notes} />}
                <Summary label="資產編號" value={generatedAssetCodePreview} />
                <div className="md:col-span-2">
                  <AssetBadge tone="amber">資產編號與 QR 掃描入口會在儲存時由後端產生；標籤列印待後續列印流程接入</AssetBadge>
                </div>
                <div className="md:col-span-2">
                  <AssetBadge tone="blue">QR Code 將指向穩定資產掃描頁，未來維修回報入口由掃描頁動態導向</AssetBadge>
                </div>
              </div>
            </AssetFormSection>
          )}
        </GeneralAffairsFormPage>
      </form>
    </main>
  );
}

function Summary({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value || '未填'}</div>
    </div>
  );
}

