BEGIN;
-- DEV prerequisite schema adapted from 20260820090000_organization_domain.sql.
-- No production seed or profile backfill. Access remains through authorized server APIs.
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


ALTER TABLE public.organization_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_manager_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_units,public.organization_memberships,public.organization_manager_assignments FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.organization_units,public.organization_memberships,public.organization_manager_assignments TO service_role;
REVOKE ALL ON FUNCTION public.sync_primary_department_to_profile(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_primary_department_to_profile(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.workspace_organization_requests (
 request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,operation text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_organization_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_organization_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_organization_requests TO service_role;
CREATE OR REPLACE FUNCTION public.workspace_organization_snapshot() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT md5(jsonb_build_object(
 'units',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]'::jsonb) FROM organization_units u),
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb) FROM organization_memberships m),
 'managers',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb) FROM organization_manager_assignments m))::text);
$$;
CREATE OR REPLACE FUNCTION public.workspace_organization_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('version',workspace_organization_snapshot(),'units',coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object(
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('user',jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'employee_code',p.employee_code,'job_title',p.job_title)) ORDER BY p.employee_code,m.id),'[]'::jsonb) FROM organization_memberships m LEFT JOIN profiles p ON p.id=m.user_id WHERE m.organization_unit_id=u.id AND m.status='active' AND m.effective_to IS NULL),
 'managers',(SELECT coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('user',jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'employee_code',p.employee_code,'job_title',p.job_title)) ORDER BY m.is_primary DESC,m.id),'[]'::jsonb) FROM organization_manager_assignments m LEFT JOIN profiles p ON p.id=m.user_id WHERE m.organization_unit_id=u.id AND m.status='active' AND m.effective_to IS NULL)
 ) ORDER BY u.sort_order,u.code,u.id),'[]'::jsonb)) FROM organization_units u;
$$;
CREATE OR REPLACE FUNCTION public.workspace_organization_save(p_actor uuid,p_request uuid,p_operation text,p_data jsonb,p_expected text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_organization_requests%rowtype; unit organization_units%rowtype; item jsonb; sid uuid; parent uuid; output jsonb; people uuid[]; today date:=(now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR p_operation NOT IN ('create','update','hierarchy','members','managers') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 LOCK TABLE organization_units,organization_memberships,organization_manager_assignments IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_organization_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.operation<>p_operation OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;RETURN cached.result;
 END IF;
 IF workspace_organization_snapshot() IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF p_operation NOT IN ('create','hierarchy') THEN
  sid:=(p_data->>'id')::uuid;SELECT * INTO unit FROM organization_units WHERE id=sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 END IF;
 IF p_operation IN ('create','update') THEN
  parent:=nullif(p_data->>'parent_id','')::uuid;
  IF coalesce(p_data->>'code','') !~ '^[A-Z0-9_-]{2,30}$' OR coalesce(btrim(p_data->>'name'),'')='' OR coalesce(p_data->>'status','') NOT IN ('active','inactive') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF (CASE WHEN p_operation='create' THEN p_data->>'type' ELSE unit.type END)='company' AND parent IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_COMPANY_ROOT'; END IF;
  IF parent IS NOT NULL AND (p_operation='create' OR parent IS DISTINCT FROM unit.parent_id) AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=parent AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_PARENT'; END IF;
  IF p_operation='create' THEN
   INSERT INTO organization_units(code,name,short_name,type,parent_id,status,description,sort_order,created_by,updated_by)
    VALUES(p_data->>'code',p_data->>'name',nullif(p_data->>'short_name',''),p_data->>'type',parent,p_data->>'status',nullif(p_data->>'description',''),(p_data->>'sort_order')::integer,p_actor,p_actor) RETURNING id INTO sid;
  ELSE
   UPDATE organization_units SET code=p_data->>'code',name=p_data->>'name',short_name=nullif(p_data->>'short_name',''),parent_id=parent,status=p_data->>'status',description=nullif(p_data->>'description',''),sort_order=(p_data->>'sort_order')::integer,updated_by=p_actor WHERE id=sid;
  END IF;
 ELSIF p_operation='hierarchy' THEN
  IF jsonb_typeof(p_data->'updates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'updates') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'updates') r GROUP BY r->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_data->'updates') LOOP
   SELECT * INTO unit FROM organization_units WHERE id=(item->>'id')::uuid;IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
   parent:=nullif(item->>'parent_id','')::uuid;
   IF unit.type='company' AND parent IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_COMPANY_ROOT'; END IF;
   IF parent IS NOT NULL AND parent IS DISTINCT FROM unit.parent_id AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=parent AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_PARENT'; END IF;
  END LOOP;
  -- Detach the changed nodes within this transaction before applying the final graph.
  -- This permits valid multi-node rearrangements without an intermediate cycle.
  UPDATE organization_units SET parent_id=NULL,updated_by=p_actor WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_data->'updates'));
  FOR item IN SELECT value FROM jsonb_array_elements(p_data->'updates') LOOP
   UPDATE organization_units SET parent_id=nullif(item->>'parent_id','')::uuid,sort_order=(item->>'sort_order')::integer,updated_by=p_actor WHERE id=(item->>'id')::uuid;
  END LOOP;
 ELSIF p_operation='members' THEN
  IF unit.status<>'active' THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
  IF jsonb_typeof(p_data->'user_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'user_ids')>1000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_data->'user_ids') r GROUP BY r HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO people FROM jsonb_array_elements_text(p_data->'user_ids');
  IF EXISTS(SELECT 1 FROM unnest(people) person WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=person)) THEN RAISE EXCEPTION 'WORKSPACE_USER'; END IF;
  IF EXISTS(SELECT 1 FROM organization_memberships m WHERE m.user_id=ANY(people) AND m.organization_unit_id<>sid AND m.status='active' AND m.effective_to IS NULL AND m.is_primary AND NOT EXISTS(SELECT 1 FROM organization_memberships current_member WHERE current_member.organization_unit_id=sid AND current_member.user_id=m.user_id AND current_member.status='active' AND current_member.effective_to IS NULL)) THEN RAISE EXCEPTION 'WORKSPACE_PRIMARY_CONFLICT'; END IF;
  UPDATE organization_memberships SET status='inactive',effective_to=greatest(effective_from,today),updated_by=p_actor WHERE organization_unit_id=sid AND status='active' AND effective_to IS NULL AND NOT(user_id=ANY(people));
  INSERT INTO organization_memberships(organization_unit_id,user_id,membership_role,membership_type,is_primary,status,effective_from,created_by,updated_by)
   SELECT sid,person,'member','primary_department',true,'active',today,p_actor,p_actor FROM unnest(people) person
   WHERE NOT EXISTS(SELECT 1 FROM organization_memberships WHERE organization_unit_id=sid AND user_id=person AND status='active' AND effective_to IS NULL);
 ELSE
  IF unit.status<>'active' THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
  IF jsonb_typeof(p_data->'assignments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'assignments')>1000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF jsonb_array_length(p_data->'assignments')>0 AND (SELECT count(*) FROM jsonb_array_elements(p_data->'assignments') r WHERE (r->>'is_primary')::boolean)<>1 THEN RAISE EXCEPTION 'WORKSPACE_PRIMARY_MANAGER'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'assignments') r GROUP BY r->>'user_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_data->'assignments') LOOP
   IF coalesce(item->>'manager_role','') NOT IN ('manager','deputy_manager','acting_manager') OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=(item->>'user_id')::uuid) THEN RAISE EXCEPTION 'WORKSPACE_USER'; END IF;
  END LOOP;
  UPDATE organization_manager_assignments m SET status='inactive',effective_to=greatest(effective_from,today),updated_by=p_actor WHERE organization_unit_id=sid AND status='active' AND effective_to IS NULL
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'assignments') r WHERE (r->>'user_id')::uuid=m.user_id AND r->>'manager_role'=m.manager_role AND (r->>'is_primary')::boolean=m.is_primary);
  INSERT INTO organization_manager_assignments(organization_unit_id,user_id,manager_role,is_primary,status,effective_from,created_by,updated_by)
   SELECT sid,(r->>'user_id')::uuid,r->>'manager_role',(r->>'is_primary')::boolean,'active',today,p_actor,p_actor FROM jsonb_array_elements(p_data->'assignments') r
   WHERE NOT EXISTS(SELECT 1 FROM organization_manager_assignments m WHERE m.organization_unit_id=sid AND m.user_id=(r->>'user_id')::uuid AND m.manager_role=r->>'manager_role' AND m.is_primary=(r->>'is_primary')::boolean AND m.status='active' AND m.effective_to IS NULL);
 END IF;
 output:=jsonb_build_object('id',sid,'version',workspace_organization_snapshot(),'updated',CASE WHEN p_operation='hierarchy' THEN jsonb_array_length(p_data->'updates') ELSE 1 END);
 INSERT INTO workspace_organization_requests(request_id,actor_id,operation,payload,result) VALUES(p_request,p_actor,p_operation,p_data,output);
 RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_organization_snapshot() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_organization_catalog() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_organization_save(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_organization_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_organization_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_organization_save(uuid,uuid,text,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
