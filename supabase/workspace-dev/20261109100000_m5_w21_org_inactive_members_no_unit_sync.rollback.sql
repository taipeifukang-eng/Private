BEGIN;
-- 回復 M5 W21：還原停用單位不可調整成員與主管的檢查，並重建部門改名／停用同步人員資料部門文字的 trigger。
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
REVOKE ALL ON FUNCTION public.workspace_organization_save(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_organization_save(uuid,uuid,text,jsonb,text) TO service_role;
-- Keep the legacy profile department projection consistent when a unit changes,
-- not only when membership changes. No existing profile backfill is performed.
CREATE OR REPLACE FUNCTION public.workspace_organization_unit_sync_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE person uuid;
BEGIN
 IF (OLD.type='department' OR NEW.type='department') AND
    (OLD.name IS DISTINCT FROM NEW.name OR OLD.status IS DISTINCT FROM NEW.status OR OLD.type IS DISTINCT FROM NEW.type) THEN
  FOR person IN SELECT DISTINCT user_id FROM organization_memberships
   WHERE organization_unit_id=NEW.id AND status='active' AND effective_to IS NULL AND is_primary
  LOOP
   PERFORM sync_primary_department_to_profile(person);
  END LOOP;
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_organization_unit_sync_profiles() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_organization_unit_sync_profiles() TO service_role;
DROP TRIGGER IF EXISTS workspace_organization_unit_sync_profiles ON public.organization_units;
CREATE TRIGGER workspace_organization_unit_sync_profiles
AFTER UPDATE OF name,status,type ON public.organization_units
FOR EACH ROW EXECUTE FUNCTION public.workspace_organization_unit_sync_profiles();
NOTIFY pgrst,'reload schema';
COMMIT;
