'use client';

import { type ReactNode, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';

export type GeneralAffairsCategoryOption = {
  id: string;
  parent_id: string | null;
  name: string;
  code: string;
};

type CategoryCascadePickerProps = {
  categories: GeneralAffairsCategoryOption[];
  byId: Map<string, GeneralAffairsCategoryOption>;
  value: string;
  onChange: (categoryId: string) => void;
  error?: ReactNode;
  containerRef?: (node: HTMLDivElement | null) => void;
  label: string;
  emptyLabel: string;
  guidance?: string;
  pathLabel?: string;
  required?: boolean;
  mdColSpanClassName?: string;
};

export function getGeneralAffairsCategoryPath(categoryId: string, byId: Map<string, GeneralAffairsCategoryOption>) {
  const path: GeneralAffairsCategoryOption[] = [];
  let current = byId.get(categoryId) || null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) || null : null;
  }
  return path;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function getCategorySearchText(category: GeneralAffairsCategoryOption, byId: Map<string, GeneralAffairsCategoryOption>) {
  const path = getGeneralAffairsCategoryPath(category.id, byId);
  return [
    category.name,
    category.code,
    path.map((item) => item.name).join(' '),
    path.map((item) => item.code).join(' '),
  ].join(' ').toLowerCase();
}

export default function CategoryCascadePicker({
  categories,
  byId,
  value,
  onChange,
  error,
  containerRef,
  label,
  emptyLabel,
  guidance = '先選第一層，再依序選擇下層；也可用關鍵字搜尋分類名稱或代碼。',
  pathLabel = '目前分類路徑',
  required = true,
  mdColSpanClassName = 'md:col-span-2',
}: CategoryCascadePickerProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const selectedPath = value ? getGeneralAffairsCategoryPath(value, byId) : [];
  const selectedPathIds = new Set(selectedPath.map((category) => category.id));
  const normalizedKeyword = normalizeSearchText(searchKeyword);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, GeneralAffairsCategoryOption[]>();
    categories.forEach((category) => {
      const parentKey = category.parent_id || 'root';
      const list = map.get(parentKey) || [];
      list.push(category);
      map.set(parentKey, list);
    });
    map.forEach((list) => list.sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name, 'zh-Hant')));
    return map;
  }, [categories]);

  const columns = useMemo(() => {
    const nextColumns: Array<{ parentId: string; title: string; rows: GeneralAffairsCategoryOption[] }> = [
      { parentId: 'root', title: '第 1 層', rows: childrenByParent.get('root') || [] },
    ];

    selectedPath.forEach((category, index) => {
      const rows = childrenByParent.get(category.id) || [];
      if (rows.length) nextColumns.push({ parentId: category.id, title: `第 ${index + 2} 層`, rows });
    });

    return nextColumns.slice(0, 3);
  }, [childrenByParent, selectedPath]);

  const searchResults = useMemo(() => {
    if (!normalizedKeyword) return [];
    return categories
      .filter((category) => getCategorySearchText(category, byId).includes(normalizedKeyword))
      .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 30);
  }, [byId, categories, normalizedKeyword]);

  const selectedLabel = selectedPath.length
    ? selectedPath.map((category) => `${category.name}（${category.code}）`).join(' > ')
    : emptyLabel;

  return (
    <div ref={containerRef} tabIndex={-1} className={`rounded-lg border border-slate-200 bg-slate-50 p-3 outline-none ring-orange-200 focus:ring-2 ${mdColSpanClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-700">{label}{required ? ' *' : ''}</div>
          <p className="mt-1 text-xs text-slate-500">{guidance}</p>
        </div>
        {value && (
          <button type="button" onClick={() => onChange('')} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            清除分類
          </button>
        )}
      </div>

      <div className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-slate-600">
        <span className="font-semibold text-slate-700">{pathLabel}：</span>
        {selectedLabel}
      </div>

      <label className="mt-3 block">
        <span className="sr-only">搜尋分類</span>
        <div className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent outline-none"
            placeholder="搜尋分類名稱或代碼，例如 IC01、電腦、耗材"
          />
          {searchKeyword && (
            <button type="button" onClick={() => setSearchKeyword('')} className="text-xs font-semibold text-slate-400 hover:text-slate-700">
              清除
            </button>
          )}
        </div>
      </label>

      {normalizedKeyword ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
            搜尋結果 {searchResults.length ? `（${searchResults.length}）` : ''}
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {searchResults.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-slate-400">找不到符合關鍵字的分類</div>
            ) : searchResults.map((category) => {
              const active = category.id === value;
              const pathLabel = getGeneralAffairsCategoryPath(category.id, byId).map((item) => item.name).join(' > ');
              return (
                <button
                  type="button"
                  key={category.id}
                  onClick={() => onChange(category.id)}
                  className={[
                    'mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition',
                    active ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200' : 'text-slate-700 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{category.name}</span>
                    <span className="block truncate text-xs text-slate-400">{category.code} / {pathLabel}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {columns.map((column) => (
            <div key={column.parentId} className="min-h-40 rounded-md border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">{column.title}</div>
              <div className="max-h-56 overflow-y-auto p-2">
                {column.rows.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-slate-400">沒有下層分類</div>
                ) : column.rows.map((category) => {
                  const active = selectedPathIds.has(category.id);
                  const hasChildren = Boolean(childrenByParent.get(category.id)?.length);
                  return (
                    <button
                      type="button"
                      key={category.id}
                      onClick={() => onChange(category.id)}
                      className={[
                        'mb-1 flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition',
                        active ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-200' : 'text-slate-700 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{category.name}</span>
                        <span className="text-xs text-slate-400">{category.code}</span>
                      </span>
                      {hasChildren && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {error}
    </div>
  );
}
