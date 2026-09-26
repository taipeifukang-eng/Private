import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type GeneralAffairsBreadcrumb = {
  label: string;
  href?: string;
};

type GeneralAffairsPageHeaderProps = {
  eyebrow?: string;
  breadcrumbs?: GeneralAffairsBreadcrumb[];
  title: string;
  description?: string;
  statusBadge?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode[];
};

export default function GeneralAffairsPageHeader({
  eyebrow = '總務服務中心',
  breadcrumbs = [],
  title,
  description,
  statusBadge,
  primaryAction,
  secondaryActions = [],
}: GeneralAffairsPageHeaderProps) {
  const hasActions = Boolean(primaryAction) || secondaryActions.length > 0;

  return (
    <header className="mb-4 border-b border-slate-200 pb-4">
      {breadcrumbs.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
              {crumb.href ? (
                <a href={crumb.href} className="hover:text-orange-700">
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
              {index < breadcrumbs.length - 1 && <span className="text-slate-300">/</span>}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-orange-700">{eyebrow}</p>
            {statusBadge}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
        </div>

        {hasActions && (
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {secondaryActions.length > 0 && (
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                {secondaryActions.map((action, index) => (
                  <span key={index}>{action}</span>
                ))}
              </div>
            )}
            {secondaryActions.length > 0 && (
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50 sm:hidden"
                aria-label="更多操作"
                title="更多操作"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
