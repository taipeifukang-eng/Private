-- Organization annual calendar foundation.
-- Company events are visible to authenticated users; writes are RBAC-gated.
-- Personal event sharing is identity-based and supports revocable share chains.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.permissions') is null
     or to_regprocedure('public.has_permission(uuid,character varying)') is null then
    raise exception 'Annual calendar prerequisites are missing';
  end if;
end $$;

insert into public.permissions (module, feature, code, action, description, is_active) values
  ('組織管理', '年度行事曆', 'organization.calendar.company.create', 'create', '可新增公司年度行事。', true),
  ('組織管理', '年度行事曆', 'organization.calendar.company.edit', 'edit', '可修改或取消公司年度行事。', true),
  ('組織管理', '年度行事曆', 'organization.calendar.holiday.manage', 'manage', '可維護政府公告假日資料。', true)
on conflict (code) do update set
  module = excluded.module,
  feature = excluded.feature,
  action = excluded.action,
  description = excluded.description,
  is_active = excluded.is_active;

create table if not exists public.organization_calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type text not null,
  start_date date not null,
  end_date date not null,
  description text,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_calendar_events_title_check check (length(btrim(title)) between 1 and 160),
  constraint organization_calendar_events_type_check check (event_type in ('meeting', 'activity', 'important')),
  constraint organization_calendar_events_date_range_check check (end_date >= start_date),
  constraint organization_calendar_events_status_check check (status in ('active', 'cancelled'))
);

create index if not exists idx_organization_calendar_events_dates
  on public.organization_calendar_events(start_date, end_date)
  where status = 'active';

create table if not exists public.organization_calendar_event_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.organization_calendar_events(id) on delete restrict,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  constraint organization_calendar_event_audit_action_check check (action in ('created', 'updated', 'cancelled'))
);

create index if not exists idx_organization_calendar_event_audit_event
  on public.organization_calendar_event_audit(event_id, changed_at desc);

create or replace function public.organization_calendar_prepare_event_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user context is required';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.organization_calendar_audit_event_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_action text;
begin
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.employee_code), ''), p.email, v_actor::text)
    into v_actor_name
  from public.profiles p
  where p.id = v_actor;

  v_actor_name := coalesce(v_actor_name, v_actor::text, 'unknown');

  if tg_op = 'INSERT' then
    v_action := 'created';
    insert into public.organization_calendar_event_audit
      (event_id, action, actor_id, actor_name, after_data)
    values
      (new.id, v_action, v_actor, v_actor_name, to_jsonb(new));
    return new;
  end if;

  v_action := case
    when old.status is distinct from new.status and new.status = 'cancelled' then 'cancelled'
    else 'updated'
  end;

  insert into public.organization_calendar_event_audit
    (event_id, action, actor_id, actor_name, before_data, after_data)
  values
    (new.id, v_action, v_actor, v_actor_name, to_jsonb(old), to_jsonb(new));

  return new;
end;
$$;

drop trigger if exists trg_organization_calendar_prepare_event_write on public.organization_calendar_events;
create trigger trg_organization_calendar_prepare_event_write
before insert or update on public.organization_calendar_events
for each row execute function public.organization_calendar_prepare_event_write();

drop trigger if exists trg_organization_calendar_audit_event_write on public.organization_calendar_events;
create trigger trg_organization_calendar_audit_event_write
after insert or update on public.organization_calendar_events
for each row execute function public.organization_calendar_audit_event_write();

alter table public.organization_calendar_events enable row level security;
alter table public.organization_calendar_event_audit enable row level security;

drop policy if exists organization_calendar_events_read on public.organization_calendar_events;
create policy organization_calendar_events_read
  on public.organization_calendar_events for select to authenticated
  using (true);

drop policy if exists organization_calendar_events_create on public.organization_calendar_events;
create policy organization_calendar_events_create
  on public.organization_calendar_events for insert to authenticated
  with check (public.has_permission(auth.uid(), 'organization.calendar.company.create'));

drop policy if exists organization_calendar_events_edit on public.organization_calendar_events;
create policy organization_calendar_events_edit
  on public.organization_calendar_events for update to authenticated
  using (public.has_permission(auth.uid(), 'organization.calendar.company.edit'))
  with check (public.has_permission(auth.uid(), 'organization.calendar.company.edit'));

drop policy if exists organization_calendar_event_audit_read on public.organization_calendar_event_audit;
create policy organization_calendar_event_audit_read
  on public.organization_calendar_event_audit for select to authenticated
  using (true);

revoke all on table public.organization_calendar_events from public, anon, authenticated;
grant select, insert, update on public.organization_calendar_events to authenticated;
revoke all on table public.organization_calendar_event_audit from public, anon, authenticated;
grant select on public.organization_calendar_event_audit to authenticated;

create table if not exists public.organization_personal_calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_personal_calendar_events_title_check check (length(btrim(title)) between 1 and 160),
  constraint organization_personal_calendar_events_date_range_check check (end_date >= start_date)
);

create index if not exists idx_organization_personal_calendar_events_owner_dates
  on public.organization_personal_calendar_events(owner_id, start_date, end_date);

create table if not exists public.organization_personal_calendar_event_shares (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.organization_personal_calendar_events(id) on delete cascade,
  parent_share_id uuid references public.organization_personal_calendar_event_shares(id) on delete cascade,
  shared_by_user_id uuid not null references public.profiles(id) on delete cascade,
  shared_with_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  constraint organization_personal_calendar_event_shares_not_self check (shared_by_user_id <> shared_with_user_id)
);

create index if not exists idx_organization_personal_calendar_shares_event
  on public.organization_personal_calendar_event_shares(event_id, created_at);
create index if not exists idx_organization_personal_calendar_shares_recipient
  on public.organization_personal_calendar_event_shares(shared_with_user_id, event_id)
  where revoked_at is null;
create index if not exists idx_organization_personal_calendar_shares_parent
  on public.organization_personal_calendar_event_shares(parent_share_id)
  where parent_share_id is not null;

create or replace function public.organization_calendar_personal_event_user_can_view(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_personal_calendar_events e
    where e.id = p_event_id
      and e.owner_id = p_user_id
  ) or exists (
    with recursive candidate_shares as (
      select s.id as leaf_id
      from public.organization_personal_calendar_event_shares s
      where s.event_id = p_event_id
        and s.shared_with_user_id = p_user_id
        and s.revoked_at is null
    ), share_ancestors as (
      select c.leaf_id, s.id, s.parent_share_id, s.shared_by_user_id, s.revoked_at
      from candidate_shares c
      join public.organization_personal_calendar_event_shares s on s.id = c.leaf_id
      union all
      select a.leaf_id, parent.id, parent.parent_share_id, parent.shared_by_user_id, parent.revoked_at
      from share_ancestors a
      join public.organization_personal_calendar_event_shares parent on parent.id = a.parent_share_id
      where parent.event_id = p_event_id
    )
    select 1
    from share_ancestors a
    group by a.leaf_id
    having bool_and(a.revoked_at is null)
       and bool_or(
         a.parent_share_id is null
         and a.shared_by_user_id = (
           select e.owner_id
           from public.organization_personal_calendar_events e
           where e.id = p_event_id
         )
       )
  );
$$;

create or replace function public.organization_calendar_personal_event_can_view(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_calendar_personal_event_user_can_view(p_event_id, auth.uid());
$$;

create or replace function public.organization_calendar_personal_event_is_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_personal_calendar_events e
    where e.id = p_event_id and e.owner_id = auth.uid()
  );
$$;

create or replace function public.organization_calendar_touch_personal_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id;
  new.owner_id := old.owner_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_organization_calendar_touch_personal_event on public.organization_personal_calendar_events;
create trigger trg_organization_calendar_touch_personal_event
before update on public.organization_personal_calendar_events
for each row execute function public.organization_calendar_touch_personal_event();

create or replace function public.organization_calendar_share_personal_event(
  p_event_id uuid,
  p_shared_with_user_id uuid,
  p_parent_share_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_parent_recipient uuid;
  v_share_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_shared_with_user_id is null then
    raise exception 'A recipient is required';
  end if;

  select e.owner_id into v_owner
  from public.organization_personal_calendar_events e
  where e.id = p_event_id;
  if not found then
    raise exception 'Personal calendar event not found';
  end if;
  if p_shared_with_user_id = v_actor or p_shared_with_user_id = v_owner then
    raise exception 'The recipient already has owner access or is the current user';
  end if;
  if public.organization_calendar_personal_event_user_can_view(p_event_id, p_shared_with_user_id) then
    raise exception 'The recipient already has access to this event';
  end if;

  if p_parent_share_id is null then
    if v_actor <> v_owner then
      raise exception 'Only the event owner can create a direct share';
    end if;
  else
    select s.shared_with_user_id into v_parent_recipient
    from public.organization_personal_calendar_event_shares s
    where s.id = p_parent_share_id
      and s.event_id = p_event_id
      and s.revoked_at is null;
    if not found or v_parent_recipient <> v_actor then
      raise exception 'An active share owned by the current user is required';
    end if;
    if not public.organization_calendar_personal_event_user_can_view(p_event_id, v_actor) then
      raise exception 'The current share chain is no longer active';
    end if;
  end if;

  insert into public.organization_personal_calendar_event_shares
    (event_id, parent_share_id, shared_by_user_id, shared_with_user_id)
  values
    (p_event_id, p_parent_share_id, v_actor, p_shared_with_user_id)
  returning id into v_share_id;

  return v_share_id;
end;
$$;

create or replace function public.organization_calendar_revoke_personal_event_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_shared_by uuid;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select e.owner_id, s.shared_by_user_id
    into v_owner, v_shared_by
  from public.organization_personal_calendar_event_shares s
  join public.organization_personal_calendar_events e on e.id = s.event_id
  where s.id = p_share_id;
  if not found then
    return false;
  end if;
  if v_actor <> v_owner and v_actor <> v_shared_by then
    raise exception 'Only the event owner or original sharer can revoke this share';
  end if;

  update public.organization_personal_calendar_event_shares
  set revoked_at = coalesce(revoked_at, now()),
      revoked_by = coalesce(revoked_by, v_actor)
  where id = p_share_id;

  return true;
end;
$$;

alter table public.organization_personal_calendar_events enable row level security;
alter table public.organization_personal_calendar_event_shares enable row level security;

drop policy if exists organization_personal_calendar_events_read on public.organization_personal_calendar_events;
create policy organization_personal_calendar_events_read
  on public.organization_personal_calendar_events for select to authenticated
  using (public.organization_calendar_personal_event_can_view(id));

drop policy if exists organization_personal_calendar_events_create on public.organization_personal_calendar_events;
create policy organization_personal_calendar_events_create
  on public.organization_personal_calendar_events for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists organization_personal_calendar_events_update on public.organization_personal_calendar_events;
create policy organization_personal_calendar_events_update
  on public.organization_personal_calendar_events for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists organization_personal_calendar_events_delete on public.organization_personal_calendar_events;
create policy organization_personal_calendar_events_delete
  on public.organization_personal_calendar_events for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists organization_personal_calendar_shares_read on public.organization_personal_calendar_event_shares;
create policy organization_personal_calendar_shares_read
  on public.organization_personal_calendar_event_shares for select to authenticated
  using (
    public.organization_calendar_personal_event_is_owner(event_id)
    or shared_by_user_id = auth.uid()
    or shared_with_user_id = auth.uid()
  );

revoke all on table public.organization_personal_calendar_events from public, anon, authenticated;
grant select, insert, update, delete on public.organization_personal_calendar_events to authenticated;
revoke all on table public.organization_personal_calendar_event_shares from public, anon, authenticated;
grant select on public.organization_personal_calendar_event_shares to authenticated;
revoke all on function public.organization_calendar_personal_event_user_can_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public.organization_calendar_personal_event_can_view(uuid) from public, anon, authenticated;
revoke all on function public.organization_calendar_personal_event_is_owner(uuid) from public, anon, authenticated;
revoke all on function public.organization_calendar_share_personal_event(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.organization_calendar_revoke_personal_event_share(uuid) from public, anon, authenticated;
revoke all on function public.organization_calendar_touch_personal_event() from public, anon, authenticated;
grant execute on function public.organization_calendar_personal_event_can_view(uuid) to authenticated;
grant execute on function public.organization_calendar_personal_event_is_owner(uuid) to authenticated;
grant execute on function public.organization_calendar_share_personal_event(uuid, uuid, uuid) to authenticated;
grant execute on function public.organization_calendar_revoke_personal_event_share(uuid) to authenticated;

create table if not exists public.organization_calendar_holiday_imports (
  id uuid primary key default gen_random_uuid(),
  calendar_year integer not null,
  source_name text not null,
  source_url text not null,
  source_revision text,
  status text not null default 'draft',
  imported_by uuid references public.profiles(id) on delete set null,
  imported_at timestamptz not null default now(),
  constraint organization_calendar_holiday_imports_year_check check (calendar_year between 2000 and 2200),
  constraint organization_calendar_holiday_imports_status_check check (status in ('draft', 'published', 'superseded')),
  constraint organization_calendar_holiday_imports_source_name_check check (length(btrim(source_name)) between 1 and 120),
  constraint organization_calendar_holiday_imports_source_url_check check (source_url ~ '^https?://')
);

create unique index if not exists idx_organization_calendar_one_published_holiday_import
  on public.organization_calendar_holiday_imports(calendar_year)
  where status = 'published';

create table if not exists public.organization_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.organization_calendar_holiday_imports(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  day_type text not null,
  created_at timestamptz not null default now(),
  constraint organization_calendar_holidays_name_check check (length(btrim(name)) between 1 and 120),
  constraint organization_calendar_holidays_type_check check (day_type in ('national_holiday', 'substitute_holiday', 'makeup_workday')),
  constraint organization_calendar_holidays_import_date_key unique (import_id, holiday_date)
);

create index if not exists idx_organization_calendar_holidays_date
  on public.organization_calendar_holidays(holiday_date);

create or replace function public.organization_calendar_validate_holiday_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_year integer;
begin
  select i.calendar_year into v_year
  from public.organization_calendar_holiday_imports i
  where i.id = new.import_id;

  if v_year is null or extract(year from new.holiday_date)::integer <> v_year then
    raise exception 'Holiday date must belong to the import calendar year';
  end if;

  return new;
end;
$$;

create or replace function public.organization_calendar_prepare_holiday_import()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user context is required';
  end if;

  if tg_op = 'INSERT' then
    new.imported_by := auth.uid();
  else
    new.id := old.id;
    new.imported_by := old.imported_by;
    new.imported_at := old.imported_at;
    new.calendar_year := old.calendar_year;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_organization_calendar_validate_holiday_year on public.organization_calendar_holidays;
create trigger trg_organization_calendar_validate_holiday_year
before insert or update of import_id, holiday_date on public.organization_calendar_holidays
for each row execute function public.organization_calendar_validate_holiday_year();

drop trigger if exists trg_organization_calendar_prepare_holiday_import on public.organization_calendar_holiday_imports;
create trigger trg_organization_calendar_prepare_holiday_import
before insert or update on public.organization_calendar_holiday_imports
for each row execute function public.organization_calendar_prepare_holiday_import();

alter table public.organization_calendar_holiday_imports enable row level security;
alter table public.organization_calendar_holidays enable row level security;

drop policy if exists organization_calendar_holiday_imports_read on public.organization_calendar_holiday_imports;
create policy organization_calendar_holiday_imports_read
  on public.organization_calendar_holiday_imports for select to authenticated
  using (
    status = 'published'
    or public.has_permission(auth.uid(), 'organization.calendar.holiday.manage')
  );

drop policy if exists organization_calendar_holiday_imports_manage on public.organization_calendar_holiday_imports;
create policy organization_calendar_holiday_imports_manage
  on public.organization_calendar_holiday_imports for all to authenticated
  using (public.has_permission(auth.uid(), 'organization.calendar.holiday.manage'))
  with check (public.has_permission(auth.uid(), 'organization.calendar.holiday.manage'));

drop policy if exists organization_calendar_holidays_read on public.organization_calendar_holidays;
create policy organization_calendar_holidays_read
  on public.organization_calendar_holidays for select to authenticated
  using (
    exists (
      select 1
      from public.organization_calendar_holiday_imports i
      where i.id = import_id and i.status = 'published'
    )
    or public.has_permission(auth.uid(), 'organization.calendar.holiday.manage')
  );

drop policy if exists organization_calendar_holidays_manage on public.organization_calendar_holidays;
create policy organization_calendar_holidays_manage
  on public.organization_calendar_holidays for all to authenticated
  using (public.has_permission(auth.uid(), 'organization.calendar.holiday.manage'))
  with check (public.has_permission(auth.uid(), 'organization.calendar.holiday.manage'));

revoke all on table public.organization_calendar_holiday_imports from public, anon, authenticated;
grant select, insert, update, delete on public.organization_calendar_holiday_imports to authenticated;
revoke all on table public.organization_calendar_holidays from public, anon, authenticated;
grant select, insert, update, delete on public.organization_calendar_holidays to authenticated;

create or replace function public.organization_calendar_publish_holiday_import(
  p_calendar_year integer,
  p_source_name text,
  p_source_url text,
  p_source_revision text,
  p_holidays jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_import_id uuid;
  v_holiday_count integer;
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'organization.calendar.holiday.manage') then
    raise exception '沒有維護政府假日資料的權限' using errcode = '42501';
  end if;

  if p_calendar_year not between 2000 and 2200 then
    raise exception '年度格式錯誤';
  end if;
  if jsonb_typeof(p_holidays) <> 'array' then
    raise exception '假日資料格式錯誤';
  end if;

  select count(*) into v_holiday_count from jsonb_array_elements(p_holidays);
  if v_holiday_count < 1 or v_holiday_count > 500 then
    raise exception '每次需匯入 1 至 500 筆日期';
  end if;

  insert into public.organization_calendar_holiday_imports (
    calendar_year, source_name, source_url, source_revision, status
  ) values (
    p_calendar_year, p_source_name, p_source_url, nullif(btrim(p_source_revision), ''), 'draft'
  ) returning id into v_import_id;

  insert into public.organization_calendar_holidays (import_id, holiday_date, name, day_type)
  select v_import_id, rows.holiday_date, btrim(rows.name), rows.day_type
  from jsonb_to_recordset(p_holidays) as rows(holiday_date date, name text, day_type text);

  update public.organization_calendar_holiday_imports
  set status = 'superseded'
  where calendar_year = p_calendar_year and status = 'published';

  update public.organization_calendar_holiday_imports
  set status = 'published'
  where id = v_import_id;

  return v_import_id;
end;
$$;

revoke all on function public.organization_calendar_publish_holiday_import(integer, text, text, text, jsonb) from public, anon;
grant execute on function public.organization_calendar_publish_holiday_import(integer, text, text, text, jsonb) to authenticated;

revoke all on function public.organization_calendar_validate_holiday_year() from public, anon, authenticated;
revoke all on function public.organization_calendar_prepare_holiday_import() from public, anon, authenticated;
revoke all on function public.organization_calendar_prepare_event_write() from public, anon, authenticated;
revoke all on function public.organization_calendar_audit_event_write() from public, anon, authenticated;

notify pgrst, 'reload schema';
