-- Department Workspace - Work Responsibility foundation
-- Work responsibilities live inside Organization Department Management.
-- They are long-running department responsibilities, not task/todo records.

create table if not exists public.work_categories (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null references public.organization_units(id) on delete restrict,
  name text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint work_categories_status_check check (status in ('active', 'inactive')),
  constraint work_categories_unit_name_key unique (organization_unit_id, name)
);

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null references public.organization_units(id) on delete restrict,
  category_id uuid references public.work_categories(id) on delete set null,
  title text not null,
  work_type text not null default 'fixed',
  importance text not null default 'normal',
  status text not null default 'active',
  purpose text,
  execution_context text,
  completion_standard text,
  notes text,
  related_resources text,
  handover_focus text,
  required_systems text,
  important_contacts text,
  handover_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint work_items_work_type_check check (work_type in ('fixed', 'recurring', 'project')),
  constraint work_items_importance_check check (importance in ('normal', 'important', 'critical')),
  constraint work_items_status_check check (status in ('active', 'inactive'))
);

create table if not exists public.work_assignments (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_type text not null,
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint work_assignments_type_check check (assignment_type in ('PRIMARY', 'COLLABORATOR', 'BACKUP')),
  constraint work_assignments_status_check check (status in ('active', 'inactive')),
  constraint work_assignments_effective_range_check check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_work_categories_unit_id on public.work_categories(organization_unit_id);
create index if not exists idx_work_items_unit_id on public.work_items(organization_unit_id);
create index if not exists idx_work_items_category_id on public.work_items(category_id);
create index if not exists idx_work_assignments_work_item_id on public.work_assignments(work_item_id);
create index if not exists idx_work_assignments_user_id on public.work_assignments(user_id);
create index if not exists idx_work_assignments_current
  on public.work_assignments(work_item_id, assignment_type)
  where status = 'active' and effective_to is null;

drop trigger if exists trg_work_categories_updated_at on public.work_categories;
create trigger trg_work_categories_updated_at
before update on public.work_categories
for each row execute function public.set_organization_updated_at();

drop trigger if exists trg_work_items_updated_at on public.work_items;
create trigger trg_work_items_updated_at
before update on public.work_items
for each row execute function public.set_organization_updated_at();

drop trigger if exists trg_work_assignments_updated_at on public.work_assignments;
create trigger trg_work_assignments_updated_at
before update on public.work_assignments
for each row execute function public.set_organization_updated_at();

insert into public.permissions (module, feature, code, action, description, is_active) values
  ('組織管理', '部門工作台', 'organization.department_workspace.view', 'view', '可查看部門工作台與工作職掌。', true),
  ('組織管理', '部門工作台', 'organization.department_workspace.manage', 'edit', '可建立與維護部門工作職掌。', true)
on conflict (code) do update set
  module = excluded.module,
  feature = excluded.feature,
  action = excluded.action,
  description = excluded.description,
  is_active = excluded.is_active;

grant select, insert, update, delete on table public.work_categories to anon, authenticated;
grant select, insert, update, delete on table public.work_items to anon, authenticated;
grant select, insert, update, delete on table public.work_assignments to anon, authenticated;

alter table public.work_categories disable row level security;
alter table public.work_items disable row level security;
alter table public.work_assignments disable row level security;

notify pgrst, 'reload schema';
