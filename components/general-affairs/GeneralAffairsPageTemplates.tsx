import type { ReactNode } from 'react';

type GeneralAffairsListPageProps = {
  header: ReactNode;
  kpi?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  detailDrawer?: ReactNode;
};

export function GeneralAffairsListPage({
  header,
  kpi,
  filters,
  children,
  detailDrawer,
}: GeneralAffairsListPageProps) {
  return (
    <div className="space-y-4">
      {header}
      {kpi}
      {filters && <section className="rounded-lg border border-slate-200 bg-white p-4">{filters}</section>}
      <div className={detailDrawer ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]' : ''}>
        <section className="min-w-0">{children}</section>
        {detailDrawer}
      </div>
    </div>
  );
}

type GeneralAffairsDashboardPageProps = {
  header: ReactNode;
  kpi?: ReactNode;
  alerts?: ReactNode;
  quickActions?: ReactNode;
  children: ReactNode;
};

export function GeneralAffairsDashboardPage({
  header,
  kpi,
  alerts,
  quickActions,
  children,
}: GeneralAffairsDashboardPageProps) {
  return (
    <div className="space-y-4">
      {header}
      {alerts}
      {children}
      {quickActions}
      {kpi}
    </div>
  );
}

type GeneralAffairsFormPageProps = {
  header: ReactNode;
  stepper?: ReactNode;
  children: ReactNode;
  contextPanel?: ReactNode;
  actionFooter?: ReactNode;
};

export function GeneralAffairsFormPage({
  header,
  stepper,
  children,
  contextPanel,
  actionFooter,
}: GeneralAffairsFormPageProps) {
  return (
    <div className="space-y-4">
      {header}
      {stepper}
      <div className={contextPanel ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]' : ''}>
        <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">{children}</section>
        {contextPanel}
      </div>
      {actionFooter && (
        <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          {actionFooter}
        </div>
      )}
    </div>
  );
}
