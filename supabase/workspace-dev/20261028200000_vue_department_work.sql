BEGIN;
-- DEV prerequisite schema adapted from existing department responsibility migration.
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


ALTER TABLE work_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_categories,work_items,work_assignments FROM PUBLIC,anon,authenticated;
GRANT ALL ON work_categories,work_items,work_assignments TO service_role;
CREATE TABLE IF NOT EXISTS workspace_department_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_department_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_department_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_department_requests TO service_role;
CREATE OR REPLACE FUNCTION workspace_department_version(p_department uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT md5(jsonb_build_object('unit',(SELECT to_jsonb(u) FROM organization_units u WHERE id=p_department),
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM work_categories c WHERE organization_unit_id=p_department),
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM work_items w WHERE organization_unit_id=p_department),
 'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM work_assignments a JOIN work_items w ON w.id=a.work_item_id WHERE w.organization_unit_id=p_department))::text);
$$;
CREATE OR REPLACE FUNCTION workspace_department_catalog(p_department uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('version',workspace_department_version(p_department),'department',(SELECT to_jsonb(u) FROM organization_units u WHERE id=p_department AND type='department'),
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY sort_order,name),'[]') FROM work_categories c WHERE organization_unit_id=p_department),
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('user',jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'employee_code',p.employee_code,'job_title',p.job_title)) ORDER BY a.created_at,a.id),'[]') FROM work_assignments a LEFT JOIN profiles p ON p.id=a.user_id WHERE a.work_item_id=w.id)) ORDER BY w.created_at DESC,w.id),'[]') FROM work_items w WHERE organization_unit_id=p_department));
$$;
CREATE OR REPLACE FUNCTION workspace_department_save(p_actor uuid,p_request uuid,p_data jsonb,p_expected text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE department uuid; item_id uuid; category uuid; old_item work_items%rowtype; cached workspace_department_requests%rowtype; result jsonb; assignment jsonb; today date:=(now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 department:=(p_data->>'organization_unit_id')::uuid;
 -- Match organization RPC lock order, then lock work tables before changing assignments.
 LOCK TABLE organization_units IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE work_categories,work_items,work_assignments IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_department_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_units WHERE id=department AND type='department' AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_DEPARTMENT'; END IF;
 IF workspace_department_version(department) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 item_id:=nullif(p_data->>'id','')::uuid;
 IF item_id IS NOT NULL THEN
  SELECT * INTO old_item FROM work_items WHERE id=item_id AND organization_unit_id=department;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 END IF;
 IF coalesce(btrim(p_data->>'title'),'')='' OR coalesce(p_data->>'work_type','') NOT IN ('fixed','recurring','project') OR coalesce(p_data->>'importance','') NOT IN ('normal','important','critical') OR coalesce(p_data->>'status','') NOT IN ('active','inactive') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF jsonb_typeof(p_data->'assignments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'assignments')>1000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'assignments') r GROUP BY r->>'user_id',r->>'assignment_type' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 FOR assignment IN SELECT value FROM jsonb_array_elements(p_data->'assignments') LOOP
  IF coalesce(assignment->>'assignment_type','') NOT IN ('PRIMARY','COLLABORATOR','BACKUP') OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=(assignment->>'user_id')::uuid) THEN RAISE EXCEPTION 'WORKSPACE_PERSON'; END IF;
 END LOOP;
 category:=nullif(p_data->>'category_id','')::uuid;
 IF category IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM work_categories WHERE id=category AND organization_unit_id=department AND (status='active' OR id=old_item.category_id)) THEN RAISE EXCEPTION 'WORKSPACE_CATEGORY'; END IF;
 ELSE
  IF coalesce(btrim(p_data->>'category_name'),'')='' THEN RAISE EXCEPTION 'WORKSPACE_CATEGORY'; END IF;
  INSERT INTO work_categories(organization_unit_id,name,status,created_by,updated_by) VALUES(department,btrim(p_data->>'category_name'),'active',p_actor,p_actor)
   ON CONFLICT(organization_unit_id,name) DO UPDATE SET status='active',updated_by=p_actor RETURNING id INTO category;
 END IF;
 IF item_id IS NULL THEN
  INSERT INTO work_items(organization_unit_id,category_id,title,work_type,importance,status,created_by,updated_by)
   VALUES(department,category,p_data->>'title',p_data->>'work_type',p_data->>'importance',p_data->>'status',p_actor,p_actor) RETURNING id INTO item_id;
 END IF;
 UPDATE work_items SET category_id=category,title=p_data->>'title',work_type=p_data->>'work_type',importance=p_data->>'importance',status=p_data->>'status',
 purpose=nullif(p_data->>'purpose',''),execution_context=nullif(p_data->>'execution_context',''),completion_standard=nullif(p_data->>'completion_standard',''),notes=nullif(p_data->>'notes',''),related_resources=nullif(p_data->>'related_resources',''),handover_focus=nullif(p_data->>'handover_focus',''),required_systems=nullif(p_data->>'required_systems',''),important_contacts=nullif(p_data->>'important_contacts',''),handover_notes=nullif(p_data->>'handover_notes',''),updated_by=p_actor WHERE id=item_id;
 UPDATE work_assignments a SET status='inactive',effective_to=greatest(effective_from,today),updated_by=p_actor WHERE work_item_id=item_id AND status='active' AND effective_to IS NULL
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'assignments') r WHERE (r->>'user_id')::uuid=a.user_id AND r->>'assignment_type'=a.assignment_type);
 INSERT INTO work_assignments(work_item_id,user_id,assignment_type,status,effective_from,created_by,updated_by)
 SELECT item_id,(r->>'user_id')::uuid,r->>'assignment_type','active',today,p_actor,p_actor FROM jsonb_array_elements(p_data->'assignments') r
 WHERE NOT EXISTS(SELECT 1 FROM work_assignments a WHERE a.work_item_id=item_id AND a.user_id=(r->>'user_id')::uuid AND a.assignment_type=r->>'assignment_type' AND a.status='active' AND a.effective_to IS NULL);
 result:=jsonb_build_object('id',item_id,'version',workspace_department_version(department));
 INSERT INTO workspace_department_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION workspace_department_version(uuid),workspace_department_catalog(uuid),workspace_department_save(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_department_version(uuid),workspace_department_catalog(uuid),workspace_department_save(uuid,uuid,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
