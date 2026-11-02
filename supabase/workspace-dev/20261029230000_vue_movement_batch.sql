BEGIN;
ALTER TABLE public.employee_movement_history DROP CONSTRAINT IF EXISTS valid_movement_type;
ALTER TABLE public.employee_movement_history ADD CONSTRAINT valid_movement_type CHECK(movement_type IN('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer'));
CREATE TABLE IF NOT EXISTS public.workspace_movement_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, payload jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_movement_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_movement_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_movement_requests TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_movement_snapshot(p_rows jsonb) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH codes AS (SELECT DISTINCT value->>'employee_code' code FROM jsonb_array_elements(p_rows))
 SELECT md5(jsonb_build_object(
 'rows',p_rows,
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM stores s),
 'units',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM organization_units u),
 'profiles',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',employee_code) ORDER BY id) FROM profiles WHERE employee_code IN(SELECT code FROM codes)),
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM organization_memberships m JOIN profiles p ON p.id=m.user_id WHERE p.employee_code IN(SELECT code FROM codes)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM store_employees e WHERE employee_code IN(SELECT code FROM codes)),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM employee_movement_history h WHERE employee_code IN(SELECT code FROM codes)),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM monthly_staff_status m WHERE employee_code IN(SELECT code FROM codes)),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY store_id,year_month,status) FROM (SELECT DISTINCT store_id,year_month,status FROM monthly_staff_status)x)
 )::text);
$$;

CREATE OR REPLACE FUNCTION public.workspace_movement_save(p_actor uuid,p_request uuid,p_rows jsonb,p_expected text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cached workspace_movement_requests%rowtype; item jsonb; entry record; emp store_employees%rowtype;
 req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 unit organization_units%rowtype; uid uuid; sid uuid; orgid uuid; mid uuid; ids jsonb:='[]'; output jsonb;
 code text; kind text; dt date; oldval text; newval text; note text; rowno integer;
 from_name text;to_name text;ym text;effective_month text;d integer;total integer;month_day text;p_date date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- The API checks RBAC; RPC is service-only. Do not permit a nonexistent audit actor.
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status,organization_units,profiles,organization_memberships IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_movement_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF p_expected IS NULL OR workspace_movement_snapshot(p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
 FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',ordinality LOOP
  item:=entry.value;rowno:=entry.ordinality;
  BEGIN
   code:=item->>'employee_code';kind:=item->>'movement_type';dt:=(item->>'effective_date')::date;
   IF code IS NULL OR code !~ '^[A-Z0-9_-]{1,20}$' OR code LIKE 'EXAMPLE-%' OR coalesce(item->>'employee_name','')='' OR dt IS NULL OR dt<'1912-01-01' OR kind NOT IN('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   orgid:=CASE WHEN left(item->>'store_id',4)='org:' THEN substring(item->>'store_id' FROM 5)::uuid END;
   sid:=CASE WHEN orgid IS NULL THEN (item->>'store_id')::uuid END;
   IF orgid IS NOT NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   IF orgid IS NULL AND NOT EXISTS(SELECT 1 FROM stores WHERE id=sid AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
   IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_date=dt AND
    CASE WHEN h.movement_type='promotion' AND h.new_value='代理店長' THEN 'acting_manager' ELSE h.movement_type END=kind AND
    (kind<>'promotion' OR (h.new_value=item->>'position' AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(item->>'newbie_level','')))) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
   IF kind='store_transfer' THEN
    req.employee_code:=code;req.employee_name:=item->>'employee_name';req.from_store_id:=(item->>'from_store_id')::uuid;req.to_store_id:=(item->>'to_store_id')::uuid;req.notes:=nullif(item->>'notes','');p_date:=dt;
 IF req.from_store_id=req.to_store_id THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 SELECT store_name INTO from_name FROM stores WHERE id=req.from_store_id AND is_active=true;
 SELECT store_name INTO to_name FROM stores WHERE id=req.to_store_id AND is_active=true;
 IF from_name IS NULL OR to_name IS NULL THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_type='store_transfer' AND movement_date=p_date) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 -- Backdated changes must not silently undo a later movement. Those require a dedicated correction flow.
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_date>p_date)
 OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND last_movement_date>p_date) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT'; END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND is_active=true)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO source FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND is_active=true;
 IF NOT FOUND OR source.employee_name IS DISTINCT FROM req.employee_name THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id;
 effective_month:=to_char(p_date,'YYYY-MM');d:=extract(day FROM p_date);month_day:=to_char(p_date,'MM/DD');
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND ((store_id=req.from_store_id AND year_month=effective_month) OR (store_id=req.to_store_id AND year_month>=effective_month)) AND status IS DISTINCT FROM 'draft') THEN RAISE EXCEPTION 'WORKSPACE_MONTH_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month>=effective_month GROUP BY store_id,year_month HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_DUPLICATE'; END IF;
 INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by)
 VALUES(req.employee_code,req.employee_name,req.to_store_id,'store_transfer',p_date,from_name,to_name,req.notes,p_actor) RETURNING id INTO mid;
 UPDATE store_employees SET is_active=false,employment_status='resigned',last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=source.id;
 IF target.id IS NULL THEN
  INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,start_date,birthday,employment_status,last_promotion_date,last_movement_date,last_movement_type)
  VALUES(req.to_store_id,source.user_id,req.employee_code,req.employee_name,source.position,source.current_position,source.employment_type,source.is_pharmacist,true,source.start_date,source.birthday,source.employment_status,source.last_promotion_date,p_date,'store_transfer');
 ELSE
  UPDATE store_employees SET user_id=source.user_id,employee_name=req.employee_name,position=source.position,current_position=source.current_position,employment_type=source.employment_type,is_pharmacist=source.is_pharmacist,is_active=true,start_date=source.start_date,birthday=source.birthday,employment_status=source.employment_status,last_promotion_date=source.last_promotion_date,last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=target.id;
 END IF;
 total:=extract(day FROM (date_trunc('month',p_date)+interval '1 month - 1 day'));
 UPDATE monthly_staff_status SET monthly_status='transferred_out',work_days=d-1,total_days_in_month=total,partial_month_reason='調出店',partial_month_notes=month_day||'調出至'||to_name,is_manually_added=false
 WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND year_month=effective_month AND status='draft';
 FOR ym IN SELECT DISTINCT year_month FROM monthly_staff_status WHERE store_id=req.to_store_id AND status='draft' AND year_month>=effective_month ORDER BY year_month LOOP
  total:=extract(day FROM (to_date(ym||'-01','YYYY-MM-DD')+interval '1 month - 1 day'));
  IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id=req.to_store_id AND year_month=ym) THEN
   UPDATE monthly_staff_status SET monthly_status=CASE WHEN ym=effective_month THEN 'transferred_in' ELSE 'full_month' END,work_days=CASE WHEN ym=effective_month THEN total-d+1 ELSE total END,total_days_in_month=total,partial_month_reason=CASE WHEN ym=effective_month THEN '調入店' END,partial_month_notes=CASE WHEN ym=effective_month THEN month_day||'自'||from_name||'調入' END,is_manually_added=false
   WHERE employee_code=req.employee_code AND store_id=req.to_store_id AND year_month=ym AND status='draft';
  ELSE
   INSERT INTO monthly_staff_status(year_month,store_id,user_id,employee_code,employee_name,position,employment_type,is_pharmacist,start_date,monthly_status,work_days,total_days_in_month,work_hours,partial_month_reason,partial_month_notes,is_manually_added,status,is_acting_manager,newbie_level)
   VALUES(ym,req.to_store_id,source.user_id,req.employee_code,req.employee_name,coalesce(source.current_position,source.position,'新人'),source.employment_type,source.is_pharmacist,source.start_date,CASE WHEN ym=effective_month THEN 'transferred_in' ELSE 'full_month' END,CASE WHEN ym=effective_month THEN total-d+1 ELSE total END,total,CASE WHEN source.employment_type='part_time' THEN 0 END,CASE WHEN ym=effective_month THEN '調入店' END,CASE WHEN ym=effective_month THEN month_day||'自'||from_name||'調入' END,false,'draft',EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=req.employee_code AND (h.movement_type='acting_manager' OR (h.movement_type='promotion' AND h.new_value='代理店長')) AND to_char(h.movement_date,'YYYY-MM')<=ym),(SELECT substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') FROM employee_movement_history h WHERE h.employee_code=req.employee_code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=ym ORDER BY h.movement_date DESC,h.created_at DESC,h.id DESC LIMIT 1));
  END IF;
 END LOOP;

   ELSE
    IF (SELECT count(*) FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    SELECT * INTO emp FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid;
    IF emp.id IS NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND employee_name IS DISTINCT FROM item->>'employee_name') THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF kind IN('onboarding','return_to_work') AND EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND is_active AND store_id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'WORKSPACE_OTHER_STORE'; END IF;
    IF kind='promotion' THEN
     output:=workspace_promotion_save(p_actor,gen_random_uuid(),sid,jsonb_build_array(item),workspace_promotion_snapshot(sid,jsonb_build_array(item)));
     mid:=(output->'ids'->>0)::uuid;
    ELSE
     oldval:=coalesce(emp.employment_status,'active');newval:=oldval;note:=nullif(item->>'notes','');uid:=NULL;
     IF kind='onboarding' THEN
      IF nullif(item->>'birthday','') IS NULL OR (item->>'birthday')::date>dt OR jsonb_typeof(item->'onboarding_is_pharmacist') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
      newval:='active';oldval:=NULL;
      note:=concat_ws('；',note,'是否藥師:'||CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '是' ELSE '否' END);
      IF orgid IS NOT NULL THEN
       SELECT * INTO unit FROM organization_units WHERE id=orgid AND status='active' AND type<>'company';
       IF NOT FOUND OR EXISTS(SELECT 1 FROM organization_units WHERE parent_id=orgid AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id,status,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.status,a.path||u.id FROM organization_units u JOIN ancestors a ON u.id=a.parent_id WHERE NOT u.id=ANY(a.path)) SELECT 1 FROM ancestors WHERE status<>'active' OR (parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=ancestors.parent_id))) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE parent_id IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(SELECT 1 FROM organization_units WHERE type='headquarters' AND status='active') AND NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE type='headquarters' AND id<>orgid) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF (SELECT count(*) FROM profiles WHERE employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_ORG_PROFILE'; END IF;
       SELECT id INTO uid FROM profiles WHERE employee_code=code;
       newval:=unit.code||' '||unit.name;note:=concat_ws('；',note,'任職組織:'||newval);
       UPDATE organization_memberships SET status='inactive',effective_to=dt,is_primary=false,updated_by=p_actor,updated_at=now() WHERE user_id=uid AND membership_type='primary_department' AND status='active' AND effective_to IS NULL;
       IF EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department') THEN
        UPDATE organization_memberships SET status='active',effective_from=dt,effective_to=NULL,is_primary=true,membership_role='member',updated_by=p_actor,updated_at=now() WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department';
       ELSE
        INSERT INTO organization_memberships(organization_unit_id,user_id,membership_role,membership_type,effective_from,status,is_primary,created_by,updated_by) VALUES(orgid,uid,'member','primary_department',dt,'active',true,p_actor,p_actor);
       END IF;
      END IF;
      IF emp.id IS NULL THEN
       INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,employment_status,start_date,birthday,last_movement_date,last_movement_type)
       VALUES(sid,uid,code,item->>'employee_name','新人','新人',CASE WHEN code LIKE 'FKPT%' THEN 'part_time' ELSE 'full_time' END,(item->>'onboarding_is_pharmacist')::boolean,true,'active',dt,(item->>'birthday')::date,dt,kind);
      ELSE
       UPDATE store_employees SET is_active=true,employment_status='active',start_date=dt,birthday=(item->>'birthday')::date,is_pharmacist=(item->>'onboarding_is_pharmacist')::boolean,last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
      END IF;
      UPDATE monthly_staff_status SET is_pharmacist=(item->>'onboarding_is_pharmacist')::boolean WHERE employee_code=code AND year_month>=to_char(dt,'YYYY-MM');
     ELSIF kind='acting_manager' THEN
      oldval:=nullif(coalesce(emp.current_position,emp.position),'代理店長');newval:='代理店長';
      UPDATE monthly_staff_status SET is_acting_manager=true WHERE employee_code=code AND year_month>=to_char(dt,'YYYY-MM');
     ELSIF kind='pass_probation' THEN
      oldval:=coalesce(emp.current_position,emp.position);newval:=coalesce(oldval,'過試用期');
     ELSE
      newval:=CASE kind WHEN 'leave_without_pay' THEN 'leave_without_pay' WHEN 'resignation' THEN 'resigned' ELSE 'active' END;
      UPDATE store_employees SET employment_status=newval,is_active=(newval<>'resigned') WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
     END IF;
     IF kind<>'onboarding' THEN UPDATE store_employees SET last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt); END IF;
     INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,onboarding_is_pharmacist,created_at)
     VALUES(code,item->>'employee_name',sid,kind,dt,oldval,newval,note,p_actor,CASE WHEN kind='onboarding' THEN (item->>'onboarding_is_pharmacist')::boolean END,clock_timestamp()) RETURNING id INTO mid;
    END IF;
   END IF;
   ids:=ids||jsonb_build_array(jsonb_build_object('row',rowno,'id',mid));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING MESSAGE=SQLERRM,DETAIL='row='||rowno; END;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'records',ids,'requestId',p_request);
 INSERT INTO workspace_movement_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,output);
 RETURN output;
END;
$$;
-- Validate the exact write path in a subtransaction which is always rolled back.
CREATE OR REPLACE FUNCTION public.workspace_movement_preview(p_actor uuid,p_rows jsonb,p_expected text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE detail text;
BEGIN
 BEGIN
  PERFORM workspace_movement_save(p_actor,gen_random_uuid(),p_rows,p_expected);
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='preview rollback';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('valid',true);
 WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('valid',false,'problem',SQLERRM,'row',coalesce(substring(detail FROM 'row=(\d+)')::integer,1));
 END;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_movement_snapshot(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_snapshot(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
