create table if not exists public.clinic_selfpay_price_month_closures (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  year_month varchar(7) not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint chk_clinic_selfpay_price_month_closures_year_month
    check (year_month ~ '^\d{4}-\d{2}$')
);

create unique index if not exists uq_clinic_selfpay_price_month_closures
  on public.clinic_selfpay_price_month_closures (store_id, year_month);

alter table public.clinic_selfpay_price_month_closures enable row level security;

drop policy if exists "clinic_selfpay_price_month_closure_service_role_all" on public.clinic_selfpay_price_month_closures;
create policy "clinic_selfpay_price_month_closure_service_role_all"
  on public.clinic_selfpay_price_month_closures for all to service_role
  using (true) with check (true);

drop policy if exists "clinic_selfpay_price_month_closure_authenticated_all" on public.clinic_selfpay_price_month_closures;
create policy "clinic_selfpay_price_month_closure_authenticated_all"
  on public.clinic_selfpay_price_month_closures for all to authenticated
  using (true) with check (true);

drop policy if exists "clinic_selfpay_price_month_closure_anon_deny" on public.clinic_selfpay_price_month_closures;
create policy "clinic_selfpay_price_month_closure_anon_deny"
  on public.clinic_selfpay_price_month_closures for all to anon
  using (false) with check (false);