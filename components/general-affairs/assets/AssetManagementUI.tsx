import type { ReactNode } from 'react';
import {
  AlertCircle,
  Archive,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  ImageIcon,
  Layers3,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

export type AssetTab = {
  id: string;
  label: string;
  count?: number;
};

export type AssetKpiItem = {
  id: string;
  label: string;
  value: number | string;
  description: string;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'orange';
  icon?: ReactNode;
};

const toneClasses: Record<NonNullable<AssetKpiItem['tone']>, string> = {
  slate: 'border-slate-200 bg-white text-slate-700',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
};

export function AssetTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: AssetTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              'inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition',
              active
                ? 'border-orange-600 text-orange-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            ].join(' ')}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className={active ? 'text-orange-600' : 'text-slate-400'}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AssetKpiGrid({ items }: { items: AssetKpiItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border p-4 ${toneClasses[item.tone || 'slate']}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold">{item.label}</div>
              <div className="mt-2 text-2xl font-bold tracking-normal">{item.value}</div>
            </div>
            <div className="rounded-md bg-white/70 p-2 shadow-sm">
              {item.icon || <Boxes className="h-4 w-4" />}
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 opacity-80">{item.description}</p>
        </div>
      ))}
    </div>
  );
}

export function AssetBadge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: NonNullable<AssetKpiItem['tone']>;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

export function AssetFilterPanel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {children}
    </section>
  );
}

export function AssetPlaceholder({
  label,
  tone = 'orange',
}: {
  label: string;
  tone?: 'orange' | 'blue' | 'slate';
}) {
  const colorClass =
    tone === 'blue'
      ? 'bg-sky-50 text-sky-700'
      : tone === 'slate'
        ? 'bg-slate-100 text-slate-600'
        : 'bg-orange-50 text-orange-700';
  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
      <ImageIcon className="h-5 w-5" aria-label={label} />
    </div>
  );
}

export function AssetDetailPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </aside>
  );
}

export function AssetDefinitionList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
          <dt className="text-xs font-semibold text-slate-500">{row.label}</dt>
          <dd className="min-w-0 text-slate-800">{row.value || '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

export type AssetMaintenanceRecord = {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  progress_stage?: string | null;
  reported_at?: string | null;
  created_at?: string | null;
};

export function AssetMaintenanceTimeline({
  records,
  unavailableReason,
}: {
  records: AssetMaintenanceRecord[];
  unavailableReason?: string;
}) {
  if (unavailableReason) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          維修紀錄暫不可讀
        </div>
        <p className="mt-1 text-xs leading-5">{unavailableReason}</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        目前沒有已連結到此資產的維修紀錄。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.slice(0, 5).map((record) => (
        <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-sm font-semibold text-slate-900">{record.title || '未命名維修紀錄'}</div>
            <AssetBadge tone="blue">{record.status || '未標示'}</AssetBadge>
          </div>
          {record.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{record.description}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" />
            {formatDate(record.reported_at || record.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssetFormSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-orange-50 p-2 text-orange-700">
          {icon || <FileText className="h-4 w-4" />}
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function buildDefaultAssetIcons() {
  return {
    total: <Boxes className="h-4 w-4" />,
    active: <CheckCircle2 className="h-4 w-4" />,
    attention: <AlertCircle className="h-4 w-4" />,
    maintenance: <Wrench className="h-4 w-4" />,
    warranty: <ShieldCheck className="h-4 w-4" />,
    category: <Layers3 className="h-4 w-4" />,
    archive: <Archive className="h-4 w-4" />,
    date: <CalendarClock className="h-4 w-4" />,
  };
}

export function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
