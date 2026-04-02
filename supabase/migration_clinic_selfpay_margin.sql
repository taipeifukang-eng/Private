-- =====================================================
-- 診所自費藥毛利計算模組
-- =====================================================

-- 1) 每月價格主檔（由店長每月匯入 DPOS 對照）
create table if not exists public.clinic_selfpay_price_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  year_month varchar(7) not null,
  health_insurance_code varchar(30) not null,
  product_code varchar(50) not null,
  product_name text,
  selfpay_drug_name text,
  member_price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  source_file_name text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_clinic_selfpay_price_entries_year_month
    check (year_month ~ '^\d{4}-\d{2}$')
);

create unique index if not exists uq_clinic_selfpay_price_entries
  on public.clinic_selfpay_price_entries (store_id, year_month, health_insurance_code);

create index if not exists idx_clinic_selfpay_price_entries_store_month
  on public.clinic_selfpay_price_entries (store_id, year_month);

create index if not exists idx_clinic_selfpay_price_entries_code
  on public.clinic_selfpay_price_entries (health_insurance_code);

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

-- 2) 診所檔匯入批次
create table if not exists public.clinic_selfpay_claim_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  year_month varchar(7) not null,
  clinic_code varchar(50),
  clinic_name text,
  period_start date,
  period_end date,
  item_count integer not null default 0,
  total_qty numeric(14,2) not null default 0,
  total_billing_amount numeric(14,2) not null default 0,
  total_gross_profit_amount numeric(14,2) not null default 0,
  screenshot_path text,
  source_file_name text,
  source_b2_text text,
  source_b4_text text,
  status varchar(20) not null default 'imported',
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  constraint chk_clinic_selfpay_claim_batches_year_month
    check (year_month ~ '^\d{4}-\d{2}$')
);

create index if not exists idx_clinic_selfpay_claim_batches_store_month
  on public.clinic_selfpay_claim_batches (store_id, year_month, imported_at desc);

-- 相容已建立環境：補欄位
alter table if exists public.clinic_selfpay_claim_batches
  add column if not exists item_count integer not null default 0;
alter table if exists public.clinic_selfpay_claim_batches
  add column if not exists total_qty numeric(14,2) not null default 0;
alter table if exists public.clinic_selfpay_claim_batches
  add column if not exists total_billing_amount numeric(14,2) not null default 0;
alter table if exists public.clinic_selfpay_claim_batches
  add column if not exists total_gross_profit_amount numeric(14,2) not null default 0;
alter table if exists public.clinic_selfpay_price_entries
  add column if not exists selfpay_drug_name text;

-- 3) 診所檔明細 + 計算結果
create table if not exists public.clinic_selfpay_claim_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.clinic_selfpay_claim_batches(id) on delete cascade,
  line_no integer,
  health_insurance_code varchar(30) not null,
  drug_name text,
  qty numeric(14,2) not null default 0,

  matched_price_entry_id uuid references public.clinic_selfpay_price_entries(id),
  matched_product_code varchar(50),
  matched_member_price numeric(12,2),
  matched_cost_price numeric(12,2),

  billing_amount numeric(14,2) not null default 0,
  gross_profit_amount numeric(14,2) not null default 0,
  match_status varchar(20) not null default 'unmatched',

  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_selfpay_claim_items_batch
  on public.clinic_selfpay_claim_items (batch_id);

create index if not exists idx_clinic_selfpay_claim_items_match_status
  on public.clinic_selfpay_claim_items (batch_id, match_status);

-- 4) updated_at 觸發器
create or replace function public.set_clinic_selfpay_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clinic_selfpay_price_entries_updated_at on public.clinic_selfpay_price_entries;
create trigger trg_clinic_selfpay_price_entries_updated_at
before update on public.clinic_selfpay_price_entries
for each row execute function public.set_clinic_selfpay_updated_at();

-- 5) Storage bucket（截圖上傳）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-selfpay-screenshots',
  'clinic-selfpay-screenshots',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- 6) RLS: 啟用 + Phase 1 風格（authenticated all, anon deny）
alter table public.clinic_selfpay_price_entries enable row level security;
alter table public.clinic_selfpay_price_month_closures enable row level security;
alter table public.clinic_selfpay_claim_batches enable row level security;
alter table public.clinic_selfpay_claim_items enable row level security;

drop policy if exists "clinic_selfpay_price_service_role_all" on public.clinic_selfpay_price_entries;
create policy "clinic_selfpay_price_service_role_all"
  on public.clinic_selfpay_price_entries for all to service_role
  using (true) with check (true);

drop policy if exists "clinic_selfpay_price_authenticated_all" on public.clinic_selfpay_price_entries;
create policy "clinic_selfpay_price_authenticated_all"
  on public.clinic_selfpay_price_entries for all to authenticated
  using (true) with check (true);

drop policy if exists "clinic_selfpay_price_anon_deny" on public.clinic_selfpay_price_entries;
create policy "clinic_selfpay_price_anon_deny"
  on public.clinic_selfpay_price_entries for all to anon
  using (false) with check (false);

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

drop policy if exists "clinic_selfpay_batch_service_role_all" on public.clinic_selfpay_claim_batches;
create policy "clinic_selfpay_batch_service_role_all"
  on public.clinic_selfpay_claim_batches for all to service_role
  using (true) with check (true);

drop policy if exists "clinic_selfpay_batch_authenticated_all" on public.clinic_selfpay_claim_batches;
create policy "clinic_selfpay_batch_authenticated_all"
  on public.clinic_selfpay_claim_batches for all to authenticated
  using (true) with check (true);

drop policy if exists "clinic_selfpay_batch_anon_deny" on public.clinic_selfpay_claim_batches;
create policy "clinic_selfpay_batch_anon_deny"
  on public.clinic_selfpay_claim_batches for all to anon
  using (false) with check (false);

drop policy if exists "clinic_selfpay_item_service_role_all" on public.clinic_selfpay_claim_items;
create policy "clinic_selfpay_item_service_role_all"
  on public.clinic_selfpay_claim_items for all to service_role
  using (true) with check (true);

drop policy if exists "clinic_selfpay_item_authenticated_all" on public.clinic_selfpay_claim_items;
create policy "clinic_selfpay_item_authenticated_all"
  on public.clinic_selfpay_claim_items for all to authenticated
  using (true) with check (true);

drop policy if exists "clinic_selfpay_item_anon_deny" on public.clinic_selfpay_claim_items;
create policy "clinic_selfpay_item_anon_deny"
  on public.clinic_selfpay_claim_items for all to anon
  using (false) with check (false);

-- Storage policy（僅 service_role 直接存取）
drop policy if exists "clinic_selfpay_screenshot_service_role_all" on storage.objects;
create policy "clinic_selfpay_screenshot_service_role_all"
  on storage.objects for all to service_role
  using (bucket_id = 'clinic-selfpay-screenshots')
  with check (bucket_id = 'clinic-selfpay-screenshots');

-- 7) 權限碼（可選，前端目前以既有權限做入口）
insert into public.permissions (module, feature, code, action, description)
values ('store', 'clinic_selfpay_margin', 'store.clinic_selfpay.margin', 'manage', '診所自費藥毛利計算管理')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id, is_allowed)
select r.id, p.id, true
from public.roles r
join public.permissions p
  on p.code = 'store.clinic_selfpay.margin'
where r.code in ('admin', 'admin_role')
on conflict (role_id, permission_id) do update
set is_allowed = excluded.is_allowed;
