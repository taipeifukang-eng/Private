'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import type { AssetSiteOption } from './AssetSitePicker';

type Props = {
  options: AssetSiteOption[];
  value: string;
  onChange: (value: string) => void;
};

function siteLabel(site: AssetSiteOption) {
  return `${site.store_code} ${site.short_name || site.store_name}`;
}

export default function AssetSiteFilter({ options, value, onChange }: Props) {
  const listId = useId();
  const selected = options.find((site) => site.id === value) || null;
  const [query, setQuery] = useState('');
  const labels = useMemo(
    () => new Map(options.map((site) => [siteLabel(site).toLocaleLowerCase(), site.id])),
    [options],
  );

  useEffect(() => {
    setQuery(selected ? siteLabel(selected) : '');
  }, [selected?.id]);

  function applyQuery(next: string) {
    setQuery(next);
    if (!next.trim()) {
      onChange('');
      return;
    }
    const matchedId = labels.get(next.trim().toLocaleLowerCase());
    if (matchedId) onChange(matchedId);
  }

  return (
    <div className="relative min-w-0">
      <MapPin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        list={listId}
        value={query}
        onChange={(event) => applyQuery(event.target.value)}
        onBlur={() => setQuery(selected ? siteLabel(selected) : '')}
        className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
        placeholder="全部據點"
        aria-label="依據點篩選"
      />
      <datalist id={listId}>
        {options.map((site) => <option key={site.id} value={siteLabel(site)} />)}
      </datalist>
      {value && (
        <button
          type="button"
          onClick={() => { setQuery(''); onChange(''); }}
          className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="清除據點篩選"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
