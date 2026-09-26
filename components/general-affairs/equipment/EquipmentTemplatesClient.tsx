'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AssetScopeTabs from '@/components/general-affairs/assets/AssetScopeTabs';
import CategoryCascadePicker from '@/components/general-affairs/assets/AssetCategoryPicker';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  X,
} from 'lucide-react';

type CategoryOption = {
  id: string;
  parent_id: string | null;
  name: string;
  code: string;
};
type PartOption = { id: string; name: string; part_code?: string | null; specification?: string | null };
type UnlinkedEquipment = {
  id: string;
  name: string;
  asset_code: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
};

type EquipmentTemplate = {
  id: string;
  category_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  specs: Record<string, unknown>;
  default_fields: Record<string, unknown>;
  default_warranty_months: number | null;
  is_active: boolean;
  updated_at: string;
  asset_count?: number;
  site_count?: number;
  category?: CategoryOption | null;
};

type Message = { type: 'success' | 'error'; text: string } | null;

type TemplateForm = {
  category_id: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  default_warranty_months: string;
  is_active: boolean;
};

const EMPTY_FORM: TemplateForm = {
  category_id: '',
  name: '',
  brand: '',
  model: '',
  description: '',
  default_warranty_months: '',
  is_active: true,
};

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

function normalizeIdentity(value?: string | null) {
  return (value || '').trim().toLocaleLowerCase().replace(/[\s\-_./]+/g, '');
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || '操作失敗');
  }
  return json;
}

export default function EquipmentTemplatesClient() {
  const [templates, setTemplates] = useState<EquipmentTemplate[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [parts, setParts] = useState<PartOption[]>([]);
  const [partSearch, setPartSearch] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [partsLoadError, setPartsLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentTemplate | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [reconciliationTemplate, setReconciliationTemplate] = useState<EquipmentTemplate | null>(null);
  const [unlinkedEquipment, setUnlinkedEquipment] = useState<UnlinkedEquipment[]>([]);
  const [reconciliationSearch, setReconciliationSearch] = useState('');
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [loadingReconciliation, setLoadingReconciliation] = useState(false);
  const [savingReconciliation, setSavingReconciliation] = useState(false);
  const [unlinkedEquipmentTotal, setUnlinkedEquipmentTotal] = useState<number | null>(null);

  const canSubmit = form.category_id && form.name.trim();
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const duplicateCandidates = useMemo(() => {
    if (editing) return [];
    const name = normalizeIdentity(form.name);
    const brand = normalizeIdentity(form.brand);
    const model = normalizeIdentity(form.model);
    if (!name && !model) return [];
    return templates.filter((template) => {
      const sameModel = model && normalizeIdentity(template.model) === model;
      const sameBrand = !brand || !template.brand || normalizeIdentity(template.brand) === brand;
      const sameName = name && normalizeIdentity(template.name) === name;
      return (sameModel && sameBrand) || sameName;
    }).slice(0, 3);
  }, [editing, form.brand, form.model, form.name, templates]);
  const reconciliationCandidates = useMemo(() => {
    if (!reconciliationTemplate) return [];
    const keyword = normalizeIdentity(reconciliationSearch);
    const templateName = normalizeIdentity(reconciliationTemplate.name);
    const templateBrand = normalizeIdentity(reconciliationTemplate.brand);
    const templateModel = normalizeIdentity(reconciliationTemplate.model);
    return unlinkedEquipment
      .filter((equipment) => !keyword || normalizeIdentity([
        equipment.name,
        equipment.asset_code,
        equipment.brand,
        equipment.model,
        equipment.serial_number,
        equipment.store?.store_code,
        equipment.store?.store_name,
        equipment.store?.short_name,
      ].filter(Boolean).join(' ')).includes(keyword))
      .map((equipment) => ({
        equipment,
        score: (templateModel && normalizeIdentity(equipment.model) === templateModel ? 4 : 0)
          + (templateBrand && normalizeIdentity(equipment.brand) === templateBrand ? 2 : 0)
          + (templateName && normalizeIdentity(equipment.name) === templateName ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.equipment.name.localeCompare(b.equipment.name, 'zh-Hant'));
  }, [reconciliationSearch, reconciliationTemplate, unlinkedEquipment]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '50', sortBy: 'updated_at', sortDir: 'desc' });
    if (search.trim()) params.set('search', search.trim());
    if (activeFilter !== 'all') params.set('active', activeFilter);
    return params.toString();
  }, [activeFilter, search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      const [templateRes, categoryRes, partsRes, unlinkedRes] = await Promise.all([
        fetch(`/api/general-affairs/equipment/templates?${queryString}`),
        fetch('/api/general-affairs/categories?type=equipment'),
        fetch('/api/general-affairs/parts?pageSize=100&isActive=true&sortBy=name'),
        fetch('/api/general-affairs/equipment?pageSize=1&templateStatus=unlinked'),
      ]);

      if (templateRes.status === 403) setPermissionDenied(true);
      const templateJson = await parseResponse(templateRes);
      const categoryJson = categoryRes.ok ? await categoryRes.json() : { data: [] };
      const partsJson = partsRes.ok ? await partsRes.json() : { data: [] };
      setTemplates(templateJson.data || []);
      setCategories(categoryJson.data || []);
      setParts(partsJson.data || []);
      if (unlinkedRes.ok) {
        const unlinkedJson = await unlinkedRes.json();
        setUnlinkedEquipmentTotal(Number(unlinkedJson.meta?.total || 0));
      } else {
        setUnlinkedEquipmentTotal(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入公司設備型號失敗');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('returnTo')) openCreate();
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

  function updateForm<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDirty(false);
    setPartSearch('');
    setSelectedPartIds([]);
    setLoadingParts(false);
    setPartsLoadError('');
    setDialogOpen(true);
  }

  function openEdit(template: EquipmentTemplate) {
    setEditing(template);
    setForm({
      category_id: template.category_id,
      name: template.name || '',
      brand: template.brand || '',
      model: template.model || '',
      description: template.description || '',
      default_warranty_months: template.default_warranty_months?.toString() || '',
      is_active: template.is_active,
    });
    setDirty(false);
    setPartSearch('');
    setSelectedPartIds([]);
    setPartsLoadError('');
    setDialogOpen(true);
    setLoadingParts(true);
    fetch(`/api/general-affairs/parts/target-compatibilities?targetType=EQUIPMENT_TEMPLATE&targetId=${encodeURIComponent(template.id)}&includeInherited=false`, { cache: 'no-store' })
      .then(parseResponse)
      .then((body) => setSelectedPartIds((body.data || []).map((row: { part_id: string }) => row.part_id)))
      .catch((error) => {
        const text = error instanceof Error ? error.message : '適用料件載入失敗';
        setPartsLoadError(text);
        setMessage({ type: 'error', text });
      })
      .finally(() => setLoadingParts(false));
  }

  function closeDialog() {
    if (dirty && !window.confirm('表單尚未儲存，確定要離開？')) return;
    setDialogOpen(false);
    setDirty(false);
  }

  function useExistingTemplate(template: EquipmentTemplate) {
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    if (returnTo?.startsWith('/general-affairs/')) {
      window.location.assign(`${returnTo}${returnTo.includes('?') ? '&' : '?'}templateId=${encodeURIComponent(template.id)}`);
      return;
    }
    openEdit(template);
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        category_id: form.category_id,
        name: form.name,
        brand: form.brand,
        model: form.model,
        description: form.description,
        default_warranty_months: form.default_warranty_months ? Number(form.default_warranty_months) : null,
        is_active: form.is_active,
        specs: {},
        default_fields: {},
      };
      const response = await fetch(
        editing
          ? `/api/general-affairs/equipment/templates/${editing.id}`
          : '/api/general-affairs/equipment/templates',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const result = await parseResponse(response);
      const templateId = result?.data?.id || editing?.id;
      if (templateId) {
        try {
          await parseResponse(await fetch('/api/general-affairs/parts/target-compatibilities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'EQUIPMENT_TEMPLATE', targetId: templateId, partIds: selectedPartIds }),
          }));
        } catch {
          window.alert('公司設備已建立，但適用料件尚未儲存，請稍後到「適用料件設定」補充。');
        }
      }
      setMessage({ type: 'success', text: editing ? '公司設備型號已更新' : '公司設備型號已新增' });
      setDialogOpen(false);
      setDirty(false);
      const returnTo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('returnTo') : null;
      if (!editing && returnTo && result?.data?.id && returnTo.startsWith('/general-affairs/')) {
        window.location.assign(`${returnTo}${returnTo.includes('?') ? '&' : '?'}templateId=${encodeURIComponent(result.data.id)}`);
        return;
      }
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '儲存失敗' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(template: EquipmentTemplate) {
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/equipment/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !template.is_active }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: template.is_active ? '公司設備已停用' : '公司設備已啟用' });
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '狀態更新失敗' });
    }
  }

  async function softDelete(template: EquipmentTemplate) {
    const reason = window.prompt(`請輸入刪除「${template.name}」的原因`);
    if (!reason) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/equipment/templates/${template.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deletion_reason: reason }),
      });
      const json = await parseResponse(response);
      setMessage({
        type: 'success',
        text: json.warning?.message || '公司設備型號已刪除',
      });
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '刪除失敗' });
    }
  }

  async function openReconciliation(template: EquipmentTemplate) {
    setReconciliationTemplate(template);
    setReconciliationSearch('');
    setSelectedEquipmentIds([]);
    setLoadingReconciliation(true);
    try {
      const result = await parseResponse(await fetch('/api/general-affairs/equipment?pageSize=100&templateStatus=unlinked&sortBy=name&sortDir=asc', { cache: 'no-store' }));
      setUnlinkedEquipment(result.data || []);
      setUnlinkedEquipmentTotal(Number(result.meta?.total || 0));
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '載入未連結設備失敗' });
      setReconciliationTemplate(null);
    } finally {
      setLoadingReconciliation(false);
    }
  }

  async function submitReconciliation() {
    if (!reconciliationTemplate || !selectedEquipmentIds.length) return;
    setSavingReconciliation(true);
    try {
      const result = await parseResponse(await fetch(`/api/general-affairs/equipment/templates/${reconciliationTemplate.id}/link-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_ids: selectedEquipmentIds }),
      }));
      setMessage({ type: 'success', text: result.message || '既有設備已完成歸戶' });
      setReconciliationTemplate(null);
      await loadData();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '既有設備歸戶失敗' });
    } finally {
      setSavingReconciliation(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-500">總務服務中心 / 設備管理</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">公司設備型號</h1>
            <p className="mt-1 text-sm text-slate-500">公司從未使用過的設備型號才在這裡新增；各地點登錄設備時直接引用既有型號。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {unlinkedEquipmentTotal !== null && (
              <span className={`inline-flex h-10 items-center rounded-md border px-3 text-sm font-bold ${unlinkedEquipmentTotal > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {unlinkedEquipmentTotal > 0 ? `待歸戶 ${unlinkedEquipmentTotal} 台` : '既有設備已歸戶'}
              </span>
            )}
            <Link href="/general-affairs/parts/compatibilities" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              設定適用料件
            </Link>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">
              <Plus className="h-4 w-4" />
              新增公司設備型號
            </button>
          </div>
        </div>

        <AssetScopeTabs assetType="equipment" current="catalog" />

        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
              placeholder="搜尋名稱、品牌、型號"
            />
          </label>
          <select
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as any)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
          >
            <option value="all">全部狀態</option>
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
        </div>

        {message && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${messageClass(message.type)}`}>
            {message.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
          </div>
        )}

        {!loading && permissionDenied && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-800">
            目前帳號沒有公司設備型號查看權限。
          </div>
        )}

        {!loading && !permissionDenied && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-sm text-red-800">{error}</div>
        )}

        {!loading && !permissionDenied && !error && templates.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-semibold text-slate-700">尚無公司設備型號</p>
            <p className="mt-1 text-sm text-slate-500">先建立公司使用的設備型號，各地點才能引用建檔。</p>
          </div>
        )}

        {!loading && !permissionDenied && !error && templates.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">範本</th>
                  <th className="px-4 py-3">分類</th>
                  <th className="px-4 py-3">品牌 / 型號</th>
                  <th className="px-4 py-3">保固</th>
                  <th className="px-4 py-3">已登錄</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map((template) => (
                  <tr key={template.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{template.name}</div>
                      <div className="mt-1 max-w-md truncate text-xs text-slate-500">{template.description || '無描述'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{template.category?.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{[template.brand, template.model].filter(Boolean).join(' / ') || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{template.default_warranty_months ? `${template.default_warranty_months} 個月` : '-'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {(template.asset_count || 0) > 0 ? (
                        <Link href={`/general-affairs/equipment?templateId=${encodeURIComponent(template.id)}&templateName=${encodeURIComponent([template.brand, template.model || template.name].filter(Boolean).join(' / '))}`} className="font-semibold text-blue-700 underline-offset-2 hover:underline">
                          {template.asset_count || 0} 台
                        </Link>
                      ) : <div className="font-semibold text-slate-800">0 台</div>}
                      <div className="text-xs text-slate-500">{template.site_count || 0} 個據點</div>
                      <button type="button" onClick={() => void openReconciliation(template)} className="mt-1 text-xs font-bold text-blue-700 underline-offset-2 hover:underline">
                        歸戶既有設備
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {template.is_active ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openEdit(template)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="編輯">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => toggleActive(template)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={template.is_active ? '停用' : '啟用'}>
                          <Power className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => softDelete(template)} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="soft delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={submitForm} className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing ? '編輯公司設備型號' : '新增公司設備型號'}</h2>
                <p className="mt-1 text-sm text-slate-500">這裡建立公司可使用的設備種類，不代表任何地點已經持有。</p>
              </div>
              <button type="button" onClick={closeDialog} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
              <CategoryCascadePicker
                categories={categories}
                byId={categoriesById}
                value={form.category_id}
                onChange={(categoryId) => updateForm('category_id', categoryId)}
                label="設備分類"
                emptyLabel="尚未選擇設備分類"
                guidance="使用公司已建立的設備分類；可依層級選擇或直接搜尋名稱、代碼。"
                mdColSpanClassName="md:col-span-2"
              />
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">設備名稱</span>
                <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">品牌</span>
                <input value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">型號</span>
                <input value={form.model} onChange={(event) => updateForm('model', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">預設保固月數</span>
                <input type="number" min="0" value={form.default_warranty_months} onChange={(event) => updateForm('default_warranty_months', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
              </label>
              {!editing && duplicateCandidates.length > 0 && (
                <section className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    <AlertCircle className="h-4 w-4" />
                    可能已經有這個公司設備
                  </div>
                  <div className="mt-2 space-y-2">
                    {duplicateCandidates.map((template) => (
                      <div key={template.id} className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2">
                        <div className="min-w-0 text-sm">
                          <div className="truncate font-semibold text-slate-900">{template.name}</div>
                          <div className="truncate text-xs text-slate-500">{[template.brand, template.model].filter(Boolean).join(' / ') || '未填品牌型號'}</div>
                        </div>
                        <button type="button" onClick={() => useExistingTemplate(template)} className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100">
                          使用這筆
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <label className="flex items-center gap-2 pt-7">
                <input type="checkbox" checked={form.is_active} onChange={(event) => updateForm('is_active', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                <span className="text-sm font-semibold text-slate-700">公司仍在使用</span>
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">描述</span>
                <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              {(
                <section className="md:col-span-2">
                  <div className="text-sm font-semibold text-slate-700">適用料件</div>
                  <input value={partSearch} onChange={(event) => setPartSearch(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="搜尋墨水、碳粉或其他配件" />
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {parts.filter((part) => [part.part_code, part.name, part.specification].filter(Boolean).join(' ').toLowerCase().includes(partSearch.trim().toLowerCase())).slice(0, 20).map((part) => (
                      <label key={part.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50"><input type="checkbox" checked={selectedPartIds.includes(part.id)} onChange={() => setSelectedPartIds((current) => current.includes(part.id) ? current.filter((id) => id !== part.id) : [...current, part.id])} className="h-4 w-4 rounded border-slate-300 text-orange-600" /><span className="text-sm font-semibold text-slate-800">{part.part_code ? `${part.part_code}｜` : ''}{part.name}</span></label>
                    ))}
                    {!parts.length && <div className="p-3 text-center text-sm text-slate-500">尚未建立可選料件，可稍後到適用料件設定補充。</div>}
                  </div>
                  <div className={`mt-1 text-xs ${partsLoadError ? 'text-red-600' : 'text-slate-500'}`}>
                    {partsLoadError || (loadingParts ? '載入既有設定中...' : `已選 ${selectedPartIds.length} 項；未勾選的料件會在儲存後移除。`)}
                  </div>
                </section>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={closeDialog} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
              <button type="submit" disabled={!canSubmit || saving || loadingParts || Boolean(partsLoadError)} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-orange-300">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                儲存
              </button>
            </div>
          </form>
        </div>
      )}

      {reconciliationTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">歸戶既有設備</h2>
                <p className="mt-1 text-sm text-slate-500">選出屬於「{reconciliationTemplate.name}」的既有據點設備。</p>
              </div>
              <button type="button" onClick={() => setReconciliationTemplate(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="關閉">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                歸戶會統一設備名稱、分類、品牌與型號；據點、序號、位置、購買及保固資料不會改變。
              </div>
              <label className="relative mt-4 block">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input value={reconciliationSearch} onChange={(event) => setReconciliationSearch(event.target.value)} placeholder="搜尋據點、設備名稱、品牌、型號或序號" className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm" />
              </label>

              {!loadingReconciliation && reconciliationTemplate.model && reconciliationCandidates.some(({ score }) => score >= 4) && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="text-xs font-semibold text-emerald-800">
                    找到 {reconciliationCandidates.filter(({ score }) => score >= 4).length} 台型號完全相同的設備
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedEquipmentIds(reconciliationCandidates.filter(({ score }) => score >= 4).map(({ equipment }) => equipment.id))}
                    className="shrink-0 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                  >
                    選取型號相同
                  </button>
                </div>
              )}

              {!loadingReconciliation && unlinkedEquipmentTotal !== null && unlinkedEquipmentTotal > unlinkedEquipment.length && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  尚有 {unlinkedEquipmentTotal} 台未歸戶，本次先顯示前 {unlinkedEquipment.length} 台；完成後可繼續整理下一批。
                </p>
              )}

              {loadingReconciliation ? (
                <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-600" /></div>
              ) : reconciliationCandidates.length ? (
                <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {reconciliationCandidates.map(({ equipment, score }) => {
                    const checked = selectedEquipmentIds.includes(equipment.id);
                    return (
                      <label key={equipment.id} className={`flex cursor-pointer items-start gap-3 p-3 hover:bg-slate-50 ${checked ? 'bg-blue-50' : 'bg-white'}`}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedEquipmentIds((current) => current.includes(equipment.id) ? current.filter((id) => id !== equipment.id) : [...current, equipment.id])} className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{equipment.name}</span>
                            {score > 0 && <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">可能相符</span>}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {[equipment.store?.store_code, equipment.store?.short_name || equipment.store?.store_name].filter(Boolean).join(' ')}
                            {' ｜ '}{[equipment.brand, equipment.model].filter(Boolean).join(' / ') || '未填品牌型號'}
                            {equipment.serial_number ? ` ｜ 序號 ${equipment.serial_number}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs text-slate-400">{equipment.asset_code || '未編號'}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  {unlinkedEquipment.length ? '找不到符合搜尋條件的設備' : '目前沒有尚未歸戶的既有設備'}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
              <span className="text-sm font-semibold text-slate-600">已選 {selectedEquipmentIds.length} 台</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setReconciliationTemplate(null)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">取消</button>
                <button type="button" onClick={() => void submitReconciliation()} disabled={!selectedEquipmentIds.length || savingReconciliation} className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">
                  {savingReconciliation && <Loader2 className="h-4 w-4 animate-spin" />}
                  確認歸戶
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
