-- Google Calendar one-way sync. Run after 20261008100000_organization_annual_calendar.sql.

do $$
begin
  if to_regclass('public.organization_calendar_events') is null
     or to_regclass('public.organization_personal_calendar_events') is null then
    raise exception 'Run 20261008100000_organization_annual_calendar.sql before this migration';
  end if;
end $$;

alter table public.organization_calendar_events
  add column if not exists is_all_day boolean not null default true,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists location text;

alter table public.organization_personal_calendar_events
  add column if not exists is_all_day boolean not null default true,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists location text;

alter table public.organization_calendar_events
  drop constraint if exists organization_calendar_events_time_check;
alter table public.organization_calendar_events
  add constraint organization_calendar_events_time_check check (
    (is_all_day and start_time is null and end_time is null)
    or (
      not is_all_day
      and start_time is not null
      and end_time is not null
      and (end_date > start_date or end_time > start_time)
    )
  );

alter table public.organization_personal_calendar_events
  drop constraint if exists organization_personal_calendar_events_time_check;
alter table public.organization_personal_calendar_events
  add constraint organization_personal_calendar_events_time_check check (
    (is_all_day and start_time is null and end_time is null)
    or (
      not is_all_day
      and start_time is not null
      and end_time is not null
      and (end_date > start_date or end_time > start_time)
    )
  );

alter table public.organization_calendar_events
  drop constraint if exists organization_calendar_events_location_check;
alter table public.organization_calendar_events
  add constraint organization_calendar_events_location_check check (location is null or length(location) <= 500);

alter table public.organization_personal_calendar_events
  drop constraint if exists organization_personal_calendar_events_location_check;
alter table public.organization_personal_calendar_events
  add constraint organization_personal_calendar_events_location_check check (location is null or length(location) <= 500);

insert into public.permissions (module, feature, code, action, description, is_active) values
  ('組織管理', '年度行事曆', 'organization.calendar.google.manage', 'sync', '可連結及管理公司 Google 行事曆單向同步。', true)
on conflict (code) do update set
  module = excluded.module,
  feature = excluded.feature,
  action = excluded.action,
  description = excluded.description,
  is_active = excluded.is_active;

create table if not exists public.organization_calendar_google_connections (
  id smallint primary key default 1 check (id = 1),
  calendar_id text not null,
  google_account_email text not null,
  refresh_token_ciphertext text not null,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  constraint organization_calendar_google_sync_status_check
    check (last_sync_status is null or last_sync_status in ('success', 'partial', 'failed'))
);

create table if not exists public.organization_calendar_google_event_links (
  source_key text primary key,
  source_type text not null,
  calendar_id text not null,
  google_event_id text,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint organization_calendar_google_source_type_check check (source_type in ('company', 'holiday'))
);

create index if not exists idx_organization_calendar_google_event_links_errors
  on public.organization_calendar_google_event_links(updated_at desc)
  where last_error is not null;

alter table public.organization_calendar_google_connections enable row level security;
alter table public.organization_calendar_google_event_links enable row level security;

revoke all on table public.organization_calendar_google_connections from public, anon, authenticated;
revoke all on table public.organization_calendar_google_event_links from public, anon, authenticated;
grant all on table public.organization_calendar_google_connections to service_role;
grant all on table public.organization_calendar_google_event_links to service_role;

notify pgrst, 'reload schema';
