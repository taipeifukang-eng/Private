-- M9 正式區草稿 10：組織與部門職掌（工作台新版 RPC）。尚未套用，需人確認後才轉正式 migration。
-- 對應 DEV：20261028180000_vue_organization、20261028190000_vue_organization_profile_sync、20261028200000_vue_department_work、20261109100000_m5_w21_org_inactive_members_no_unit_sync（只取「最終狀態」）。
-- 白話說明：
--   正式區已有組織四表、work_* 三表、updated_at／防循環／同步部門觸發器、8+2 個權限碼（舊版 20260820090000、20260820093000、20260821110000），本檔不重建、不改動這些，也不改它們原本的 RLS／授權設定。
--   本檔只新增工作台新版需要的物件：
--     表   workspace_organization_requests、workspace_department_requests（防重送紀錄，啟用 RLS、只給 service_role）
--     函式 workspace_organization_snapshot／catalog／save、workspace_department_version／catalog／save（只給 service_role）
--   workspace_organization_save 採 DEV 最終版（M5 W21 Q10：停用部門仍可調整成員與主管）。正式區沒有舊版同名函式，直接建立最終版即可。
--   DEV 的 workspace_organization_unit_sync_profiles 觸發器與函式已在 M5 W21 (Q11) 移除，最終狀態是「不存在」，所以本檔不建立，僅防禦性地確認沒有殘留。
--   不新增權限碼（組織 8 碼、部門工作台 2 碼正式區已有）；也不把任何權限授權給任何角色（授權由老闆之後用勾選頁決定）。
-- 備份：不需要。只新增物件，不動既有資料（touchesExistingData = false）。
-- 可重複執行（IF NOT EXISTS／CREATE OR REPLACE／DROP IF EXISTS）。還原：10_organization_department.rollback.sql；驗證：10_organization_department.verify.sql（只有 SELECT）。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organization_units') IS NULL
     OR to_regclass('public.organization_memberships') IS NULL
     OR to_regclass('public.organization_manager_assignments') IS NULL
     OR to_regclass('public.work_categories') IS NULL
     OR to_regclass('public.work_items') IS NULL
     OR to_regclass('public.work_assignments') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 組織四表／work_* 三表／profiles 其中之一不存在（需先有舊版 20260820090000、20260821110000）';
  END IF;
  IF to_regprocedure('public.sync_primary_department_to_profile(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: sync_primary_department_to_profile(uuid) 不存在';
  END IF;
END $$;

-- 防禦：M5 W21 已移除的單位同步觸發器，確保沒有殘留。
DROP TRIGGER IF EXISTS workspace_organization_unit_sync_profiles ON public.organization_units;
DROP FUNCTION IF EXISTS public.workspace_organization_unit_sync_profiles();


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
  -- M5 Q10: 停用單位仍可調整成員與主管（照舊版）。停用單位不得新增子單位、不得掛在停用上層之下的規則保留在 create/update/hierarchy 分支。
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
  -- M5 Q10: 停用單位仍可調整成員與主管（照舊版）。停用單位不得新增子單位、不得掛在停用上層之下的規則保留在 create/update/hierarchy 分支。
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
