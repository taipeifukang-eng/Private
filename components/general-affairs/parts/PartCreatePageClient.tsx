'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Loader2,
  Package,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Warehouse,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsFormPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import CategoryCascadePicker from '@/components/general-affairs/assets/AssetCategoryPicker';
import { AssetBadge, AssetFormSection } from '@/components/general-affairs/assets/AssetManagementUI';

type CategoryOption = { id: string; parent_id: string | null; name: string; code: string };

type UsageType = 'REPAIR_PART' | 'CONSUMABLE' | 'SPARE_PART' | 'GENERAL_SUPPLY';
type StepId = 'basic' | 'units' | 'inventoryNotes' | 'confirm';

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type PartForm = {
  name: string;
  category_id: string;
  is_active: boolean;
  part_code: string;
  brand: string;
  model: string;
  specification: string;
  barcode: string;
  description: string;
  usage_type: UsageType;
  base_unit: string;
  purchase_unit: string;
  purchase_to_base_rate: string;
  minimum_issue_qty: string;
  allow_unpacking: boolean;
  allow_fractional_issue: boolean;
  notes: string;
  tags: string;
};

const STEPS: Array<{ id: StepId; label: string; description: string }> = [
  { id: 'basic', label: '先填料件', description: '名稱、分類、照片' },
  { id: 'units', label: '領用方式', description: '預設 1 個即可' },
  { id: 'inventoryNotes', label: '補充資料', description: '標籤、備註' },
  { id: 'confirm', label: '確認建立', description: '最後檢查' },
];

const EMPTY_FORM: PartForm = {
  name: '',
  category_id: '',
  is_active: true,
  part_code: '',
  brand: '',
  model: '',
  specification: '',
  barcode: '',
  description: '',
  usage_type: 'REPAIR_PART',
  base_unit: '個',
  purchase_unit: '',
  purchase_to_base_rate: '',
  minimum_issue_qty: '1',
  allow_unpacking: false,
  allow_fractional_issue: false,
  notes: '',
  tags: '',
};

const USAGE_TYPE_OPTIONS: Array<{ value: UsageType; label: string; description: string }> = [
  { value: 'REPAIR_PART', label: '維修零件', description: '維修更換' },
  { value: 'CONSUMABLE', label: '消耗品', description: '日常耗用' },
  { value: 'SPARE_PART', label: '備品', description: '預先備料' },
  { value: 'GENERAL_SUPPLY', label: '通用耗材', description: '總務用品' },
];

const PART_QUICK_PRESETS: Array<{
  id: string;
  label: string;
  hint: string;
  patch: Pick<PartForm, 'usage_type' | 'base_unit' | 'minimum_issue_qty' | 'allow_unpacking' | 'allow_fractional_issue'>;
}> = [
  {
    id: 'supply',
    label: '一般用品',
    hint: '掛勾、標籤、清潔用品',
    patch: {
      usage_type: 'GENERAL_SUPPLY',
      base_unit: '個',
      minimum_issue_qty: '1',
      allow_unpacking: false,
      allow_fractional_issue: false,
    },
  },
  {
    id: 'consumable',
    label: '消耗補充',
    hint: '紙卷、碳粉、濾網',
    patch: {
      usage_type: 'CONSUMABLE',
      base_unit: '個',
      minimum_issue_qty: '1',
      allow_unpacking: true,
      allow_fractional_issue: false,
    },
  },
  {
    id: 'repair',
    label: '維修零件',
    hint: '設備更換用零件',
    patch: {
      usage_type: 'REPAIR_PART',
      base_unit: '個',
      minimum_issue_qty: '1',
      allow_unpacking: false,
      allow_fractional_issue: false,
    },
  },
  {
    id: 'spare',
    label: '備品',
    hint: '先備著、故障時可替換',
    patch: {
      usage_type: 'SPARE_PART',
      base_unit: '個',
      minimum_issue_qty: '1',
      allow_unpacking: false,
      allow_fractional_issue: false,
    },
  },
];

const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const ALLOWED_FILE_TYPES = new Set(FILE_ACCEPT.split(','));
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
  if (!response.ok || json.success === false) throw new Error(safeErrorMessage(json.error || json, fallback));
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

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null;
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{value || '-'}</dd>
    </div>
  );
}

function PartCategoryPicker({
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
      label="料件分類"
      emptyLabel="尚未選擇料件分類"
      guidance="先選第 1 層，再依序選擇下層；也可用關鍵字搜尋分類名稱或代碼。"
      mdColSpanClassName="md:col-span-2"
    />
  );
}

function Stepper({ currentStep, highestStep, onSelect }: { currentStep: StepId; highestStep: number; onSelect: (step: StepId) => void }) {
  const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
  return (
    <nav className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="hidden grid-cols-4 gap-2 lg:grid">
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
      <div className="lg:hidden">
        <div className="text-xs font-semibold text-orange-700">{currentIndex + 1} / {STEPS.length}</div>
        <div className="mt-1 text-base font-bold text-slate-900">{STEPS[currentIndex]?.label}</div>
        <div className="mt-2 h-2 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-orange-600 transition-all" style={{ width: `${((currentIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
    </nav>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-sm font-semibold text-slate-700">
      {label}{required && <span className="text-red-600"> *</span>}
    </span>
  );
}

export default function PartCreatePageClient() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [form, setForm] = useState<PartForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId>('basic');
  const [highestStep, setHighestStep] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const selectedCategoryPath = form.category_id ? getCategoryPath(form.category_id, categoryById) : [];
  const selectedCategoryLabel = selectedCategoryPath.length ? selectedCategoryPath.map((category) => category.name).join(' > ') : '未選';
  const selectedUsage = USAGE_TYPE_OPTIONS.find((option) => option.value === form.usage_type);
  const normalizedTags = normalizeTags(form.tags);
  const pendingAttachmentCountLabel = pendingAttachments.length ? `${pendingAttachments.length} 個待上傳檔案` : '未選擇圖片';
  const hasPurchaseUnit = Boolean(form.purchase_unit.trim());
  const purchaseRate = Number(form.purchase_to_base_rate);
  const minimumIssueQty = Number(form.minimum_issue_qty);

  const loadOptions = useCallback(async () => {
    const categoryRes = await fetch('/api/general-affairs/categories?type=part');

    if (categoryRes.ok) setCategories(((await categoryRes.json()).data || []) as CategoryOption[]);
  }, []);

  useEffect(() => {
    loadOptions().catch(() => undefined);
  }, [loadOptions]);

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

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function setFieldRef(key: string) {
    return (node: HTMLElement | null) => {
      fieldRefs.current[key] = node;
    };
  }

  function updateForm<K extends keyof PartForm>(key: K, value: PartForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'purchase_unit' && !String(value || '').trim()) {
        next.purchase_to_base_rate = '';
      }
      return next;
    });
    setDirty(true);
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  function applyQuickPreset(preset: (typeof PART_QUICK_PRESETS)[number]) {
    setForm((current) => ({ ...current, ...preset.patch }));
    setDirty(true);
    setErrors((current) => ({
      ...current,
      base_unit: '',
      minimum_issue_qty: '',
      purchase_to_base_rate: '',
    }));
  }

  function addPendingAttachments(files: FileList | null) {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) => {
      if (!ALLOWED_FILE_TYPES.has(file.type)) {
        setMessage(`${file.name} 檔案格式不支援`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
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

  async function uploadPartAttachments(partId: string) {
    if (!pendingAttachments.length) return;
    const formData = new FormData();
    formData.set('resource_type', 'PART');
    formData.set('resource_id', partId);
    formData.set('purpose', 'PRIMARY_IMAGE');
    formData.set('is_primary', 'true');
    pendingAttachments.forEach((attachment) => formData.append('files', attachment.file));
    await parseResponse(await fetch('/api/general-affairs/attachments', {
      method: 'POST',
      body: formData,
    }), '料件圖片上傳失敗');
  }

  function validateStep(step: StepId) {
    const nextErrors: Record<string, string> = {};

    if (step === 'basic') {
      if (!form.name.trim()) nextErrors.name = '請輸入料件名稱';
      if (!form.category_id) nextErrors.category_id = '請選擇料件分類';
    }

    if (step === 'units') {
      if (!form.base_unit.trim()) nextErrors.base_unit = '請輸入基本庫存單位';
      if (!form.minimum_issue_qty.trim() || !Number.isFinite(minimumIssueQty) || minimumIssueQty <= 0) {
        nextErrors.minimum_issue_qty = '最小領用量必須大於 0';
      }
      if (!form.allow_fractional_issue && Number.isFinite(minimumIssueQty) && !Number.isInteger(minimumIssueQty)) {
        nextErrors.minimum_issue_qty = '不允許小數領用時，最小領用量必須為整數';
      }
      if (hasPurchaseUnit && (!form.purchase_to_base_rate.trim() || !Number.isFinite(purchaseRate) || purchaseRate <= 0)) {
        nextErrors.purchase_to_base_rate = '填寫採購單位時，換算率必須大於 0';
      }
      if (!hasPurchaseUnit && form.purchase_to_base_rate.trim()) {
        nextErrors.purchase_to_base_rate = '未填採購單位時，換算率必須留空';
      }
    }

    return nextErrors;
  }

  function validateAll() {
    const allErrors = {
      ...validateStep('basic'),
      ...validateStep('units'),
    };
    setErrors(allErrors);
    return allErrors;
  }

  function stepForField(field: string): StepId {
    if (['name', 'category_id'].includes(field)) return 'basic';
    if (['base_unit', 'minimum_issue_qty', 'purchase_to_base_rate'].includes(field)) return 'units';
    return currentStep;
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const firstKey = Object.keys(nextErrors)[0];
    if (!firstKey) return;
    const targetStep = stepForField(firstKey);
    setCurrentStep(targetStep);
    setHighestStep((current) => Math.max(current, STEPS.findIndex((step) => step.id === targetStep)));
    window.setTimeout(() => {
      const node = fieldRefs.current[firstKey];
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.focus?.();
    }, 80);
  }

  function goNext() {
    const nextErrors = validateStep(currentStep);
    setErrors((current) => ({ ...current, ...nextErrors }));
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
    const nextStep = STEPS[Math.min(STEPS.length - 1, currentIndex + 1)];
    if (nextStep) {
      setCurrentStep(nextStep.id);
      setHighestStep((current) => Math.max(current, currentIndex + 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function goBack() {
    const currentIndex = STEPS.findIndex((step) => step.id === currentStep);
    const previous = STEPS[Math.max(0, currentIndex - 1)];
    if (previous) {
      setCurrentStep(previous.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function goConfirmFast() {
    const nextErrors = {
      ...validateStep('basic'),
      ...validateStep('units'),
    };
    setErrors((current) => ({ ...current, ...nextErrors }));
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    const confirmIndex = STEPS.findIndex((step) => step.id === 'confirm');
    setHighestStep((current) => Math.max(current, confirmIndex));
    setCurrentStep('confirm');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildSpecs() {
    return {
      part_usage_type: form.usage_type,
      part_compatibility_scope: 'UNDECIDED',
      part_schema_note: 'usage_type is currently stored in specs. Compatibility is intentionally managed outside part creation until the compatibility management module is available.',
    };
  }

  function buildPartPayload() {
    const purchaseUnit = form.purchase_unit.trim();
    return {
      category_id: form.category_id,
      name: form.name.trim(),
      part_code: form.part_code.trim() || null,
      barcode: form.barcode.trim() || null,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      specification: form.specification.trim() || null,
      description: form.description.trim() || null,
      base_unit: form.base_unit.trim(),
      purchase_unit: purchaseUnit || null,
      purchase_to_base_rate: purchaseUnit ? Number(form.purchase_to_base_rate || 1) : null,
      minimum_issue_qty: Number(form.minimum_issue_qty || 1),
      allow_fractional_issue: form.allow_fractional_issue,
      allow_unpacking: form.allow_unpacking,
      specs: buildSpecs(),
      tags: normalizedTags,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    };
  }

  async function submit() {
    if (saving) return;
    const nextErrors = validateAll();
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const created = await parseResponse(await fetch('/api/general-affairs/parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPartPayload()),
      }), '建立料件失敗');

      const partId = created.data?.id;
      if (!partId) throw new Error('建立料件後未取得 id');

      try {
        await uploadPartAttachments(partId);
      } catch (uploadError) {
        pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
        setPendingAttachments([]);
        setDirty(false);
        setMessage(`料件已新增，但圖片上傳失敗：${safeErrorMessage(uploadError, '請稍後在料件詳情重新上傳圖片')}`);
        setSaving(false);
        return;
      }

      pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
      setPendingAttachments([]);
      setDirty(false);
      router.push(`/general-affairs/parts?createdPartId=${encodeURIComponent(partId)}`);
    } catch (error) {
      setMessage(safeErrorMessage(error, '建立料件失敗'));
      setSaving(false);
    }
  }

  const contextPanel = (
    <aside className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Package className="h-4 w-4 text-orange-600" />
          即時摘要
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <SummaryRow label="料件名稱" value={form.name || '未填'} />
          <SummaryRow label="分類" value={selectedCategoryLabel} />
          <SummaryRow label="用途" value={selectedUsage?.label || '-'} />
          <SummaryRow label="單位換算" value={hasPurchaseUnit ? `1 ${form.purchase_unit} = ${form.purchase_to_base_rate || '?'} ${form.base_unit || '基準單位'}` : `僅使用 ${form.base_unit || '基準單位'}`} />
          <SummaryRow label="領用規則" value={`${form.minimum_issue_qty || 1} ${form.base_unit || ''}，${form.allow_fractional_issue ? '可小數' : '限整數'}，${form.allow_unpacking ? '可拆包' : '不可拆包'}`} />
        </dl>
      </section>

      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <summary className="flex cursor-pointer items-center gap-2 font-bold text-slate-800">
          <ShieldAlert className="h-4 w-4 text-slate-500" />
          系統欄位說明
        </summary>
        <p className="mt-3 leading-6">`ga_parts` 目前沒有獨立 `usage_type` 欄位，本頁暫存在 `specs`。相容性不在新增料件時決定，後續交由相容性管理模組維護。</p>
      </details>

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <div className="flex items-start gap-2">
          <Warehouse className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold">庫存不在主檔建立</div>
            <p className="mt-1 leading-6">新增料件只建立「這是什麼料件」。實際數量、位置與流水需在庫存位置與庫存交易流程處理。</p>
          </div>
        </div>
      </section>
    </aside>
  );

  const validationSummary = Object.values(errors).filter(Boolean);

  return (
    <GeneralAffairsFormPage
      header={(
        <GeneralAffairsPageHeader
          breadcrumbs={[
            { label: '首頁', href: '/' },
            { label: '總務服務中心', href: '/general-affairs' },
            { label: '料件管理', href: '/general-affairs/parts' },
            { label: '新增料件' },
          ]}
          title="新增料件"
          description="建立料件主檔，定義料件是什麼、如何領用與適用哪些設備。庫存數量與位置不在此頁輸入。"
          statusBadge={<AssetBadge tone="orange">主檔建立</AssetBadge>}
          secondaryActions={[
            <Link key="back" href="/general-affairs/parts" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" />
              回料件列表
            </Link>,
          ]}
        />
      )}
      stepper={<Stepper currentStep={currentStep} highestStep={highestStep} onSelect={setCurrentStep} />}
      contextPanel={contextPanel}
      actionFooter={(
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            {dirty ? '尚未儲存的料件資料會在離開頁面時提醒。' : '目前沒有未儲存變更。'}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button type="button" onClick={goBack} disabled={currentStep === STEPS[0].id || saving} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
              <ArrowLeft className="h-4 w-4" />
              上一步
            </button>
            {currentStep === 'confirm' ? (
              <button type="button" onClick={submit} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                建立料件
              </button>
            ) : (
              <>
                {currentStep === 'basic' && (
                  <button type="button" onClick={goConfirmFast} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                    直接確認
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={goNext} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    >
      {message && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        </div>
      )}

      {validationSummary.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="font-bold">請先修正以下欄位</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {validationSummary.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {currentStep === 'basic' && (
        <AssetFormSection
          title="基本資訊"
          description="料件主檔是全公司共用資料，不依門市重複建檔。"
          icon={<Package className="h-4 w-4 text-orange-600" />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label ref={setFieldRef('name')} tabIndex={-1} className="outline-none md:col-span-2">
              <FieldLabel label="料件名稱" required />
              <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="例如：冷氣濾網、門把、掛勾" />
              <FieldError message={errors.name} />
            </label>

            <PartCategoryPicker
              categories={categories}
              byId={categoryById}
              value={form.category_id}
              onChange={(categoryId) => updateForm('category_id', categoryId)}
              error={<FieldError message={errors.category_id} />}
              containerRef={setFieldRef('category_id') as (node: HTMLDivElement | null) => void}
            />

            <section className="md:col-span-2">
              <FieldLabel label="快速類型" />
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                {PART_QUICK_PRESETS.map((preset) => {
                  const active =
                    form.usage_type === preset.patch.usage_type &&
                    form.base_unit === preset.patch.base_unit &&
                    form.minimum_issue_qty === preset.patch.minimum_issue_qty &&
                    form.allow_unpacking === preset.patch.allow_unpacking &&
                    form.allow_fractional_issue === preset.patch.allow_fractional_issue;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyQuickPreset(preset)}
                      className={`rounded-lg border p-3 text-left transition ${active ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                    >
                      <div className="text-sm font-bold">{preset.label}</div>
                      <div className="mt-1 text-xs opacity-70">{preset.hint}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <details className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
              <summary className="cursor-pointer text-sm font-bold text-slate-800">進階辨識資料</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label>
                  <FieldLabel label="狀態" required />
                  <select value={form.is_active ? 'true' : 'false'} onChange={(event) => updateForm('is_active', event.target.value === 'true')} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100">
                    <option value="true">啟用</option>
                    <option value="false">停用</option>
                  </select>
                </label>
                <label>
                  <FieldLabel label="料號" />
                  <input value={form.part_code} onChange={(event) => updateForm('part_code', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="可留空" />
                </label>
                <label>
                  <FieldLabel label="廠牌 / 品牌" />
                  <input value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
                </label>
                <label>
                  <FieldLabel label="型號" />
                  <input value={form.model} onChange={(event) => updateForm('model', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
                </label>
                <label>
                  <FieldLabel label="規格" />
                  <input value={form.specification} onChange={(event) => updateForm('specification', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="尺寸、顏色、材質" />
                </label>
                <label>
                  <FieldLabel label="條碼" />
                  <input value={form.barcode} onChange={(event) => updateForm('barcode', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
                </label>
                <label className="md:col-span-2">
                  <FieldLabel label="描述" />
                  <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="補充辨識方式或注意事項" />
                </label>
              </div>
            </details>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-slate-900"><ImageIcon className="h-4 w-4 text-orange-600" />料件圖片</div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">支援 JPG、PNG、WebP、HEIC 與 PDF，單檔 20MB 以內；料件建立成功後才會正式上傳並關聯。</p>
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                  選擇圖片
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      addPendingAttachments(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>

              {pendingAttachments.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {pendingAttachments.map((attachment) => (
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
                  尚未選擇圖片。可先建立料件，也可在此先選檔並隨料件一起上傳。
                </div>
              )}
            </div>
          </div>
        </AssetFormSection>
      )}

      {currentStep === 'units' && (
        <AssetFormSection title="領用方式" description="不確定時維持「1 個、限整數」即可，之後仍可編輯。" icon={<SlidersHorizontal className="h-4 w-4 text-orange-600" />}>
          <div className="grid gap-4 md:grid-cols-2">
            <label ref={setFieldRef('base_unit')} tabIndex={-1} className="outline-none">
              <FieldLabel label="基本庫存單位" required />
              <input value={form.base_unit} onChange={(event) => updateForm('base_unit', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="個、片、組、包" />
              <FieldError message={errors.base_unit} />
            </label>
            <label ref={setFieldRef('minimum_issue_qty')} tabIndex={-1} className="outline-none">
              <FieldLabel label="最小領用量" required />
              <input value={form.minimum_issue_qty} onChange={(event) => updateForm('minimum_issue_qty', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" />
              <FieldError message={errors.minimum_issue_qty} />
            </label>
            <details className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
              <summary className="cursor-pointer text-sm font-bold text-slate-800">進階領用設定</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label>
                  <FieldLabel label="採購單位" />
                  <input value={form.purchase_unit} onChange={(event) => updateForm('purchase_unit', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="箱、盒、包，可留空" />
                </label>
                <label ref={setFieldRef('purchase_to_base_rate')} tabIndex={-1} className="outline-none">
                  <FieldLabel label="採購換算率" required={hasPurchaseUnit} />
                  <input value={form.purchase_to_base_rate} onChange={(event) => updateForm('purchase_to_base_rate', event.target.value)} disabled={!hasPurchaseUnit} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none disabled:bg-slate-100 focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder={hasPurchaseUnit ? '例如 1 箱 = 100 個，填 100' : '未填採購單位時留空'} />
                  <FieldError message={errors.purchase_to_base_rate} />
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <input type="checkbox" checked={form.allow_unpacking} onChange={(event) => updateForm('allow_unpacking', event.target.checked)} />
                  <span className="text-sm font-semibold text-slate-800">允許拆包</span>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <input type="checkbox" checked={form.allow_fractional_issue} onChange={(event) => updateForm('allow_fractional_issue', event.target.checked)} />
                  <span className="text-sm font-semibold text-slate-800">允許小數領用</span>
                </label>
              </div>
            </details>
          </div>
        </AssetFormSection>
      )}

      {currentStep === 'inventoryNotes' && (
        <div className="space-y-4">
          <AssetFormSection title="補充資料" description="庫存位置與數量建立後再處理。" icon={<Warehouse className="h-4 w-4 text-orange-600" />}>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <div className="font-bold">本頁不輸入初始庫存</div>
              <p className="mt-1 leading-6">初始數量、入庫、出庫、調增與調減都必須透過庫存交易建立流水，避免主檔直接改庫存造成對帳落差。</p>
              <Link href="/general-affairs/inventory/locations" className="mt-3 inline-flex rounded-md bg-white px-3 py-2 text-sm font-semibold text-sky-800 shadow-sm hover:bg-sky-100">
                建立後前往庫存位置設定
              </Link>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <FieldLabel label="標籤" />
                <input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="以逗號分隔，例如：冷氣,耗材,常備" />
              </label>
              <label className="md:col-span-2">
                <FieldLabel label="備註" />
                <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100" placeholder="補充採購、存放或使用注意事項" />
              </label>
            </div>
          </AssetFormSection>
        </div>
      )}

      {currentStep === 'confirm' && (
        <AssetFormSection title="確認建立" description="確認主檔內容正確後建立料件。建立後仍須透過庫存位置與庫存交易處理數量。" icon={<CheckCircle2 className="h-4 w-4 text-orange-600" />}>
          <dl>
            <SummaryRow label="料件名稱" value={form.name} />
            <SummaryRow label="分類" value={selectedCategoryLabel} />
            <SummaryRow label="狀態" value={form.is_active ? '啟用' : '停用'} />
            <SummaryRow label="料號 / 條碼" value={[form.part_code || '未填料號', form.barcode || '未填條碼'].join(' / ')} />
            <SummaryRow label="品牌 / 型號" value={[form.brand || '未填品牌', form.model || '未填型號'].join(' / ')} />
            <SummaryRow label="規格" value={form.specification || '未填'} />
            <SummaryRow label="用途" value={selectedUsage?.label} />
            <SummaryRow label="單位換算" value={hasPurchaseUnit ? `1 ${form.purchase_unit} = ${form.purchase_to_base_rate} ${form.base_unit}` : `僅使用 ${form.base_unit}`} />
            <SummaryRow label="領用規則" value={`最小 ${form.minimum_issue_qty} ${form.base_unit}；${form.allow_fractional_issue ? '可小數' : '限整數'}；${form.allow_unpacking ? '可拆包' : '不可拆包'}`} />
            <SummaryRow label="標籤" value={normalizedTags.length ? normalizedTags.join('、') : '未填'} />
            <SummaryRow label="圖片" value={pendingAttachmentCountLabel} />
            <SummaryRow label="庫存" value="不建立初始庫存；請至庫存位置與庫存交易處理。" />
          </dl>
        </AssetFormSection>
      )}
    </GeneralAffairsFormPage>
  );
}







