'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import {
  AssetBadge,
  AssetFilterPanel,
  AssetFormSection,
  AssetKpiGrid,
  buildDefaultAssetIcons,
} from '@/components/general-affairs/assets/AssetManagementUI';

type CategoryKind = 'equipment' | 'facility' | 'part';

type AssetCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  code: string;
  description?: string | null;
  sort_order: number;
  is_active: boolean;
};

type CategoryForm = {
  parent_id: string;
  name: string;
  code: string;
  description: string;
  sort_order: string;
  is_active: boolean;
};

type CountRecord = { category_id: string };
type Message = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM: CategoryForm = {
  parent_id: '',
  name: '',
  code: '',
  description: '',
  sort_order: '0',
  is_active: true,
};

const COPY = {
  equipment: {
    title: '設備分類',
    description: '管理設備分類樹、分類代碼與啟用狀態。分類新增與編輯使用既有分類 API，不在前端建立假資料。',
    listHref: '/general-affairs/equipment',
    newLabel: '新增設備分類',
    typeLabel: '設備',
    codeHint: '資產編號正式取實際第二層分類 code 4 碼，例如 IC01；第一層 2 碼與第三層 6 碼不可作為資產編號前綴。',
  },
  facility: {
    title: '設施分類',
    description: '管理設施分類樹、分類代碼與啟用狀態。資料來源與設備分類完全分離。',
    listHref: '/general-affairs/facilities',
    newLabel: '新增設施分類',
    typeLabel: '設施',
    codeHint: '設施資產編號正式取實際第二層分類 code 4 碼，例如 AS01；不得取第一層 2 碼或第三層 6 碼。',
  },
  part: {
    title: '料件分類',
    description: '管理料件分類樹、分類代碼與啟用狀態。資料來源使用既有料件分類 API，不新增資料表。',
    listHref: '/general-affairs/parts',
    newLabel: '新增料件分類',
    typeLabel: '料件',
    codeHint: '料件分類代碼用於料件主檔歸類與搜尋；新增料件正式表單尚未開放前，可先維護分類基礎資料。',
  },
} satisfies Record<CategoryKind, Record<string, string>>;

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || '分類操作失敗');
  return json;
}

function depthOf(category: AssetCategory, byId: Map<string, AssetCategory>) {
  let depth = 1;
  let current = category;
  const seen = new Set<string>([category.id]);
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.id)) break;
    depth += 1;
    seen.add(parent.id);
    current = parent;
  }
  return depth;
}

function hasDescendant(categories: AssetCategory[], categoryId: string, candidateParentId: string) {
  let current = categories.find((category) => category.id === candidateParentId) || null;
  const seen = new Set<string>();
  while (current) {
    if (current.id === categoryId) return true;
    if (!current.parent_id || seen.has(current.parent_id)) return false;
    seen.add(current.parent_id);
    current = categories.find((category) => category.id === current?.parent_id) || null;
  }
  return false;
}

function indentClass(depth: number) {
  if (depth <= 1) return '';
  if (depth === 2) return 'pl-6';
  return 'pl-12';
}

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

function getCategoryPath(categoryId: string, byId: Map<string, AssetCategory>) {
  const path: AssetCategory[] = [];
  let current = byId.get(categoryId) || null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) || null : null;
  }
  return path;
}

function canSelectAsParent(category: AssetCategory, editing: AssetCategory | null, categories: AssetCategory[], byId: Map<string, AssetCategory>) {
  if (category.id === editing?.id) return false;
  if (editing && hasDescendant(categories, editing.id, category.id)) return false;
  return depthOf(category, byId) < 3;
}

function CategoryParentPicker({
  categories,
  byId,
  editing,
  value,
  onChange,
}: {
  categories: AssetCategory[];
  byId: Map<string, AssetCategory>;
  editing: AssetCategory | null;
  value: string;
  onChange: (parentId: string) => void;
}) {
  const selectableCategories = useMemo(
    () => categories.filter((category) => canSelectAsParent(category, editing, categories, byId)),
    [byId, categories, editing],
  );
  const selectableIds = useMemo(() => new Set(selectableCategories.map((category) => category.id)), [selectableCategories]);
  const selectedPath = value ? getCategoryPath(value, byId).filter((category) => selectableIds.has(category.id)) : [];
  const selectedPathIds = new Set(selectedPath.map((category) => category.id));

  const childrenByParent = useMemo(() => {
    const map = new Map<string, AssetCategory[]>();
    selectableCategories.forEach((category) => {
      const parentKey = category.parent_id && selectableIds.has(category.parent_id) ? category.parent_id : 'root';
      const list = map.get(parentKey) || [];
      list.push(category);
      map.set(parentKey, list);
    });
    map.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hant')));
    return map;
  }, [selectableCategories, selectableIds]);

  const columns = useMemo(() => {
    const nextColumns: Array<{ parentId: string; title: string; rows: AssetCategory[] }> = [];
    const rootRows = childrenByParent.get('root') || [];
    nextColumns.push({ parentId: 'root', title: '第 1 層', rows: rootRows });

    selectedPath.forEach((category, index) => {
      const childRows = childrenByParent.get(category.id) || [];
      if (childRows.length) {
        nextColumns.push({ parentId: category.id, title: `第 ${index + 2} 層`, rows: childRows });
      }
    });

    return nextColumns.slice(0, 3);
  }, [childrenByParent, selectedPath]);

  const selectedLabel = selectedPath.length ? selectedPath.map((category) => category.name).join(' / ') : '第一層分類';

  return (
    <div className="md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">上層分類</span>
        <button
          type="button"
          onClick={() => onChange('')}
          className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
            value ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-orange-200 bg-orange-50 text-orange-700'
          }`}
        >
          設為第一層分類
        </button>
      </div>
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 rounded-md bg-white px-3 py-2 text-sm text-slate-600">
          <span className="font-semibold text-slate-700">目前上層路徑：</span>
          {selectedLabel}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {columns.map((column) => (
            <div key={column.parentId} className="min-h-36 rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">{column.title}</div>
              <div className="max-h-52 overflow-y-auto p-2">
                {column.rows.length ? (
                  column.rows.map((category) => {
                    const isSelected = selectedPathIds.has(category.id);
                    const hasChildren = Boolean(childrenByParent.get(category.id)?.length);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => onChange(category.id)}
                        className={`mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm ${
                          isSelected ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{category.name}</span>
                          <span className="block truncate text-xs text-slate-400">{category.code}</span>
                        </span>
                        {hasChildren && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-2 py-6 text-center text-xs text-slate-400">沒有下層分類</div>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">先選第 1 層分類，再依序選擇下層；未選上層時會建立為第一層分類。</p>
      </div>
    </div>
  );
}

export default function AssetCategoryManagementClient({ kind }: { kind: CategoryKind }) {
  const copy = COPY[kind];
  const icons = useMemo(() => buildDefaultAssetIcons(), []);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, AssetCategory[]>();
    categories.forEach((category) => {
      const parentKey = category.parent_id || 'root';
      const list = map.get(parentKey) || [];
      list.push(category);
      map.set(parentKey, list);
    });
    map.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hant')));
    return map;
  }, [categories]);

  const visibleCategories = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((category) => {
      return category.name.toLowerCase().includes(needle) || category.code.toLowerCase().includes(needle);
    });
  }, [categories, search]);

  const kpis = useMemo(() => {
    const leafCount = categories.filter((category) => !childrenByParent.get(category.id)?.length).length;
    const inactive = categories.filter((category) => !category.is_active).length;
    return [
      { id: 'total', label: '分類總數', value: categories.length, description: `目前可讀的${copy.typeLabel}分類`, icon: icons.category },
      { id: 'active', label: '啟用中', value: categories.length - inactive, description: '可供主檔選用的分類', tone: 'green' as const, icon: icons.active },
      { id: 'inactive', label: '停用中', value: inactive, description: '保留歷史但不再新增使用', tone: inactive ? 'amber' as const : 'slate' as const, icon: icons.attention },
      { id: 'leaf', label: '最末層分類', value: leafCount, description: '沒有子分類的分類節點', tone: 'blue' as const, icon: icons.archive },
    ];
  }, [categories, childrenByParent, copy.typeLabel, icons]);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionDenied(false);
    try {
      const response = await fetch(`/api/general-affairs/categories?type=${kind}`);
      if (response.status === 403) setPermissionDenied(true);
      const json = await parseResponse(response);
      const rows = (json.data || []) as AssetCategory[];
      setCategories(rows);
      setExpanded(new Set(rows.filter((category) => !category.parent_id).map((category) => category.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入分類失敗');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadCounts = useCallback(async () => {
    const endpoint = kind === 'equipment'
      ? '/api/general-affairs/equipment?pageSize=100'
      : kind === 'facility'
        ? '/api/general-affairs/facilities?pageSize=100'
        : '/api/general-affairs/parts?pageSize=100';
    try {
      const response = await fetch(endpoint);
      if (!response.ok) return;
      const json = await response.json();
      const next: Record<string, number> = {};
      ((json.data || []) as CountRecord[]).forEach((item) => {
        if (item.category_id) next[item.category_id] = (next[item.category_id] || 0) + 1;
      });
      setCounts(next);
    } catch {
      setCounts({});
    }
  }, [kind]);

  useEffect(() => {
    loadCategories();
    loadCounts();
  }, [loadCategories, loadCounts]);

  function openCreate(parentId = '') {
    setEditing(null);
    setForm({ ...EMPTY_FORM, parent_id: parentId });
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(category: AssetCategory) {
    setEditing(category);
    setForm({
      parent_id: category.parent_id || '',
      name: category.name,
      code: category.code,
      description: category.description || '',
      sort_order: String(category.sort_order || 0),
      is_active: category.is_active,
    });
    setFormError('');
    setDialogOpen(true);
  }

  function validateForm() {
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    if (!name) return '請輸入分類名稱';
    if (!code) return '請輸入分類代碼';
    const duplicate = categories.find((category) => category.id !== editing?.id && category.code.trim().toUpperCase() === code);
    if (duplicate) return `分類代碼 ${code} 已存在`;
    if (editing && form.parent_id && hasDescendant(categories, editing.id, form.parent_id)) return '不可選擇自己或自己的子分類作為上層分類';
    if (form.parent_id) {
      const parent = byId.get(form.parent_id);
      if (!parent) return '上層分類不存在';
      if (depthOf(parent, byId) >= 3) return '分類最多只能建立三層';
    }
    return '';
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        type: kind,
        parent_id: form.parent_id || null,
        name: form.name,
        code: form.code.toUpperCase(),
        description: form.description || null,
        sort_order: Number(form.sort_order || 0),
        is_active: form.is_active,
      };
      const response = await fetch(
        editing ? `/api/general-affairs/categories/${editing.id}` : '/api/general-affairs/categories',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await parseResponse(response);
      const warning = json.warning?.message ? `（${json.warning.message}）` : '';
      setMessage({ type: 'success', text: `${editing ? '分類已更新' : '分類已新增'}${warning}` });
      setDialogOpen(false);
      await loadCategories();
      await loadCounts();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '分類儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(category: AssetCategory) {
    const childCount = childrenByParent.get(category.id)?.length || 0;
    const assetCount = counts[category.id] || 0;
    if (category.is_active && (childCount > 0 || assetCount > 0)) {
      const ok = window.confirm(`此分類已有 ${childCount} 個子分類、${assetCount} 筆${copy.typeLabel}，確定要停用？`);
      if (!ok) return;
    }
    setMessage(null);
    try {
      const response = await fetch(`/api/general-affairs/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, is_active: !category.is_active }),
      });
      await parseResponse(response);
      setMessage({ type: 'success', text: category.is_active ? '分類已停用' : '分類已啟用' });
      await loadCategories();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '分類狀態更新失敗' });
    }
  }

  function renderRows(parentId: string | null = null, depth = 1): JSX.Element[] {
    const rows = childrenByParent.get(parentId || 'root') || [];
    return rows.flatMap((category) => {
      if (!visibleCategories.some((visible) => visible.id === category.id)) {
        const descendants = renderRows(category.id, depth + 1);
        return descendants.length ? descendants : [];
      }
      const childCount = childrenByParent.get(category.id)?.length || 0;
      const expandedRow = expanded.has(category.id);
      const row = (
        <tr key={category.id} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="px-4 py-3">
            <div className={`flex items-center gap-2 ${indentClass(depth)}`}>
              <button
                type="button"
                onClick={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(category.id)) next.delete(category.id);
                  else next.add(category.id);
                  return next;
                })}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                disabled={!childCount}
                aria-label={expandedRow ? '收合分類' : '展開分類'}
              >
                {childCount ? (expandedRow ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="block h-4 w-4" />}
              </button>
              <div>
                <div className="font-semibold text-slate-900">{category.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{category.code}</div>
              </div>
            </div>
          </td>
          <td className="px-4 py-3 text-sm text-slate-600">{byId.get(category.parent_id || '')?.name || '-'}</td>
          <td className="px-4 py-3 text-sm text-slate-600">{depth}</td>
          <td className="px-4 py-3 text-sm text-slate-600">{category.sort_order}</td>
          <td className="px-4 py-3 text-sm text-slate-600">{counts[category.id] || 0}</td>
          <td className="px-4 py-3">
            <AssetBadge tone={category.is_active ? 'green' : 'slate'}>{category.is_active ? '啟用' : '停用'}</AssetBadge>
          </td>
          <td className="px-4 py-3">
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => openCreate(category.id)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="新增子分類">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => openEdit(category)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="編輯">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => toggleActive(category)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title={category.is_active ? '停用' : '啟用'}>
                <Power className="h-4 w-4" />
              </button>
            </div>
          </td>
        </tr>
      );
      return expandedRow ? [row, ...renderRows(category.id, depth + 1)] : [row];
    });
  }

  const header = (
    <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: copy.typeLabel === '設備' ? '設備管理' : '設施管理', href: copy.listHref },
        { label: copy.title },
      ]}
      title={copy.title}
      description={copy.description}
      primaryAction={
        <button
          type="button"
          onClick={() => openCreate()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
        >
          <Plus className="h-4 w-4" />
          {copy.newLabel}
        </button>
      }
    />
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsListPage
        header={header}
        kpi={<AssetKpiGrid items={kpis} />}
        filters={(
          <AssetFilterPanel>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                  placeholder="搜尋分類名稱或代碼"
                />
              </label>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {copy.codeHint}
              </div>
            </div>
          </AssetFilterPanel>
        )}
      >
        {message && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${messageClass(message.type)}`}>
            {message.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}
        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            載入分類
          </div>
        ) : permissionDenied ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">目前帳號沒有{copy.title}查看權限。</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>
        ) : categories.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">目前沒有分類。</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">分類名稱 / 代碼</th>
                    <th className="px-4 py-3">上層分類</th>
                    <th className="px-4 py-3">層級</th>
                    <th className="px-4 py-3">排序</th>
                    <th className="px-4 py-3">{copy.typeLabel}數</th>
                    <th className="px-4 py-3">狀態</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>{renderRows()}</tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 lg:hidden">
              {visibleCategories.map((category) => (
                <div key={category.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{category.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{category.code} / 層級 {depthOf(category, byId)}</div>
                    </div>
                    <AssetBadge tone={category.is_active ? 'green' : 'slate'}>{category.is_active ? '啟用' : '停用'}</AssetBadge>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => openEdit(category)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">編輯</button>
                    <button type="button" onClick={() => toggleActive(category)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">{category.is_active ? '停用' : '啟用'}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GeneralAffairsListPage>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4">
          <form onSubmit={submitForm} className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editing ? '編輯分類' : copy.newLabel}</h2>
                <p className="mt-1 text-sm text-slate-500">最多三層分類，系統會防止循環 parent 關係。</p>
              </div>
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              {formError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
              <AssetFormSection title="分類資料" description="分類代碼由 API 正規化保存；資產編號專用前綴仍需後續 migration 決策。">
                <div className="grid gap-4 md:grid-cols-2">
                  <CategoryParentPicker
                    categories={categories}
                    byId={byId}
                    editing={editing}
                    value={form.parent_id}
                    onChange={(parentId) => setForm((current) => ({ ...current, parent_id: parentId }))}
                  />
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">分類名稱 *</span>
                    <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">分類代碼 *</span>
                    <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm uppercase" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">排序</span>
                    <input type="number" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" />
                  </label>
                  <label className="flex items-center gap-2 pt-7">
                    <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-orange-600" />
                    <span className="text-sm font-semibold text-slate-700">啟用</span>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-sm font-semibold text-slate-700">描述</span>
                    <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
              </AssetFormSection>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">取消</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-orange-300">
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
