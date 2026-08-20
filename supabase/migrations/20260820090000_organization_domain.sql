-- Organization Domain Phase 1
-- Store Domain remains unchanged. stores/store_id/store_managers keep serving
-- store operations, inspection, monthly staff status, and store permissions.

create table if not exists public.organization_units (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  short_name text,
  type text not null,
  parent_id uuid references public.organization_units(id) on delete restrict,
  status text not null default 'active',
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint organization_units_code_key unique (code),
  constraint organization_units_type_check check (type in ('company', 'headquarters', 'department', 'team')),
  constraint organization_units_status_check check (status in ('active', 'inactive')),
  constraint organization_units_parent_not_self check (parent_id is null or parent_id <> id)
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null references public.organization_units(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_role text not null default 'member',
  membership_type text not null default 'primary_department',
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'active',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint organization_memberships_status_check check (status in ('active', 'inactive')),
  constraint organization_memberships_effective_range_check check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.organization_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null references public.organization_units(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  manager_role text not null default 'manager',
  effective_from date not null default current_date,
  effective_to date,
  is_primary boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint organization_manager_assignments_role_check check (manager_role in ('manager', 'deputy_manager', 'acting_manager')),
  constraint organization_manager_assignments_status_check check (status in ('active', 'inactive')),
  constraint organization_manager_assignments_effective_range_check check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists idx_organization_memberships_one_current_primary
  on public.organization_memberships(user_id)
  where is_primary = true and status = 'active' and effective_to is null;

create index if not exists idx_organization_units_parent_id on public.organization_units(parent_id);
create index if not exists idx_organization_units_type on public.organization_units(type);
create index if not exists idx_organization_units_status on public.organization_units(status);
create index if not exists idx_organization_memberships_unit_id on public.organization_memberships(organization_unit_id);
create index if not exists idx_organization_memberships_user_id on public.organization_memberships(user_id);
create index if not exists idx_organization_manager_assignments_unit_id on public.organization_manager_assignments(organization_unit_id);
create index if not exists idx_organization_manager_assignments_user_id on public.organization_manager_assignments(user_id);

create or replace function public.set_organization_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organization_units_updated_at on public.organization_units;
create trigger trg_organization_units_updated_at
before update on public.organization_units
for each row execute function public.set_organization_updated_at();

drop trigger if exists trg_organization_memberships_updated_at on public.organization_memberships;
create trigger trg_organization_memberships_updated_at
before update on public.organization_memberships
for each row execute function public.set_organization_updated_at();

drop trigger if exists trg_organization_manager_assignments_updated_at on public.organization_manager_assignments;
create trigger trg_organization_manager_assignments_updated_at
before update on public.organization_manager_assignments
for each row execute function public.set_organization_updated_at();

create or replace function public.prevent_organization_unit_cycle()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Organization unit cannot be its own parent';
  end if;

  if exists (
    with recursive ancestors as (
      select ou.id, ou.parent_id
      from public.organization_units ou
      where ou.id = new.parent_id
      union all
      select parent.id, parent.parent_id
      from public.organization_units parent
      join ancestors a on a.parent_id = parent.id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Organization hierarchy cycle is not allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_organization_unit_cycle on public.organization_units;
create trigger trg_prevent_organization_unit_cycle
before insert or update of parent_id on public.organization_units
for each row execute function public.prevent_organization_unit_cycle();

create or replace function public.sync_primary_department_to_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_name text;
begin
  select ou.name
    into v_department_name
  from public.organization_memberships om
  join public.organization_units ou on ou.id = om.organization_unit_id
  where om.user_id = p_user_id
    and om.is_primary = true
    and om.status = 'active'
    and om.effective_to is null
    and ou.type = 'department'
    and ou.status = 'active'
  order by om.effective_from desc, om.created_at desc
  limit 1;

  update public.profiles
     set department = v_department_name,
         updated_at = now()
   where id = p_user_id
     and department is distinct from v_department_name;
end;
$$;

create or replace function public.organization_membership_sync_profile_department()
returns trigger
language plpgsql
as $$
begin
  perform public.sync_primary_department_to_profile(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

drop trigger if exists trg_organization_membership_sync_profile_department on public.organization_memberships;
create trigger trg_organization_membership_sync_profile_department
after insert or update or delete on public.organization_memberships
for each row execute function public.organization_membership_sync_profile_department();

insert into public.permissions (module, feature, code, action, description, is_active) values
  ('組織管理', '公司組織', 'organization.organization.view', 'view', '可查看公司組織架構。', true),
  ('組織管理', '部門管理', 'organization.department.view', 'view', '可查看部門列表。', true),
  ('組織管理', '部門管理', 'organization.department.create', 'create', '可新增部門。', true),
  ('組織管理', '部門管理', 'organization.department.edit', 'edit', '可編輯與啟停部門。', true),
  ('組織管理', '部門成員', 'organization.member.view', 'view', '可查看部門成員。', true),
  ('組織管理', '部門成員', 'organization.member.manage', 'edit', '可設定部門成員。', true),
  ('組織管理', '部門主管', 'organization.manager.view', 'view', '可查看部門主管。', true),
  ('組織管理', '部門主管', 'organization.manager.manage', 'assign', '可設定部門主管與副主管。', true)
on conflict (code) do update set
  module = excluded.module,
  feature = excluded.feature,
  action = excluded.action,
  description = excluded.description,
  is_active = excluded.is_active;

insert into public.organization_units (code, name, short_name, type, parent_id, status, sort_order, description)
values ('FK-COMPANY', '富康活力藥局股份有限公司', '富康活力', 'company', null, 'active', 10, '公司根組織')
on conflict (code) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  type = excluded.type,
  status = excluded.status,
  sort_order = excluded.sort_order,
  description = excluded.description;

insert into public.organization_units (code, name, short_name, type, parent_id, status, sort_order, description)
select 'FK-HQ', '總部', '總部', 'headquarters', company.id, 'active', 20, '總部組織'
from public.organization_units company
where company.code = 'FK-COMPANY'
on conflict (code) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  type = excluded.type,
  parent_id = excluded.parent_id,
  status = excluded.status,
  sort_order = excluded.sort_order,
  description = excluded.description;

insert into public.organization_units (code, name, short_name, type, parent_id, status, sort_order)
select seed.code, seed.name, seed.short_name, 'department', hq.id, 'active', seed.sort_order
from public.organization_units hq
cross join (values
  ('D001', '營業部', '營業部', 101),
  ('D002', '商品部', '商品部', 102),
  ('D003', '人資部', '人資部', 103),
  ('D004', '行銷部', '行銷部', 104),
  ('D005', '會計部', '會計部', 105),
  ('D006', '總務', '總務', 106),
  ('D007', '物流部', '物流部', 107)
) as seed(code, name, short_name, sort_order)
where hq.code = 'FK-HQ'
on conflict (code) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  type = excluded.type,
  parent_id = excluded.parent_id,
  status = excluded.status,
  sort_order = excluded.sort_order;

grant select, insert, update, delete on table public.organization_units to anon, authenticated;
grant select, insert, update, delete on table public.organization_memberships to anon, authenticated;
grant select, insert, update, delete on table public.organization_manager_assignments to anon, authenticated;

alter table public.organization_units disable row level security;
alter table public.organization_memberships disable row level security;
alter table public.organization_manager_assignments disable row level security;

notify pgrst, 'reload schema';
