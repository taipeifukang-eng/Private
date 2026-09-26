'use client';

import { forwardRef, useMemo, useState } from 'react';
import { MapPin, Search } from 'lucide-react';

export type AssetSiteOption = {
  id: string;
  store_code: string;
  store_name: string;
  short_name?: string | null;
};

type Props = {
  options: AssetSiteOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

function siteLabel(site: AssetSiteOption) {
  return `${site.store_code} ${site.short_name || site.store_name}`;
}

const AssetSitePicker = forwardRef<HTMLDivElement, Props>(function AssetSitePicker(
  { options, value, onChange, error },
  ref,
) {
  const [search, setSearch] = useState('');
  const selected = options.find((site) => site.id === value) || null;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return options;
    return options.filter((site) =>
      [site.store_code, site.store_name, site.short_name]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [options, search]);

  return (
    <div ref={ref} className="block">
      <span className="text-sm font-semibold text-slate-700">所在據點 *</span>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-400"
          placeholder="搜尋據點代碼、名稱或簡稱"
        />
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-orange-400"
      >
        <option value="">請選擇據點</option>
        {selected && search && !filtered.some((site) => site.id === selected.id) && (
          <option value={selected.id}>{siteLabel(selected)}</option>
        )}
        {filtered.map((site) => (
          <option key={site.id} value={site.id}>{siteLabel(site)}</option>
        ))}
      </select>
      {selected && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          <MapPin className="h-3.5 w-3.5" />
          {siteLabel(selected)}
        </div>
      )}
      {!selected && search && filtered.length === 0 && (
        <p className="mt-1 text-xs text-amber-700">找不到符合的據點，請確認據點資料是否已建立。</p>
      )}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
});

export default AssetSitePicker;
