-- 固定月藥師快照表：避免每次總覽都直接依賴 monthly_staff_status
create table if not exists public.pharmacist_monthly_snapshot (
  id uuid primary key default gen_random_uuid(),
  year_month text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  employee_code text not null,
  employee_name text not null default '',
  position text,
  is_active boolean not null default true,
  source text not null default 'seed' check (source in ('seed', 'manual', 'movement')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year_month, store_id, employee_code)
);

create index if not exists idx_pharmacist_monthly_snapshot_year_month
  on public.pharmacist_monthly_snapshot(year_month);

create index if not exists idx_pharmacist_monthly_snapshot_store
  on public.pharmacist_monthly_snapshot(store_id);

create index if not exists idx_pharmacist_monthly_snapshot_employee
  on public.pharmacist_monthly_snapshot(employee_code);

-- updated_at 自動更新
create or replace function public.set_pharmacist_monthly_snapshot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pharmacist_monthly_snapshot_updated_at on public.pharmacist_monthly_snapshot;
create trigger trg_pharmacist_monthly_snapshot_updated_at
before update on public.pharmacist_monthly_snapshot
for each row execute function public.set_pharmacist_monthly_snapshot_updated_at();
