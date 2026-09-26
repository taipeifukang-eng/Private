'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

export type AssetCatalogOption = {
  id: string;
  title: string;
  detail?: string;
  searchText?: string;
};

type Props = {
  label: string;
  emptyLabel: string;
  options: AssetCatalogOption[];
  value: string;
  onChange: (value: string) => void;
};

export default function AssetCatalogPicker({ label, emptyLabel, options, value, onChange }: Props) {
  const [search, setSearch] = useState('');
  const visibleOptions = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-TW');
    if (!keyword) return options;
    return options.filter((option) => (
      option.id === value
      || `${option.title} ${option.detail || ''} ${option.searchText || ''}`.toLocaleLowerCase('zh-TW').includes(keyword)
    ));
  }, [options, search, value]);

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3 md:col-span-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <span className="text-xs text-slate-500">選定後帶入共用資料</span>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`搜尋${label}`}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm"
          />
        </label>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">{emptyLabel}</option>
          {visibleOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}{option.detail ? ` - ${option.detail}` : ''}
            </option>
          ))}
        </select>
      </div>
      {search && visibleOptions.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">找不到相符主檔，請先確認是否需要建立新的公司主檔。</p>
      )}
    </div>
  );
}
