-- W06 rollback：還原 5 支函式為套用前的 DEV 定義，移除 W06 新增的函式、資料表與欄位。
BEGIN;
CREATE OR REPLACE FUNCTION public.workspace_movement_save(p_actor uuid, p_request uuid, p_rows jsonb, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
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
CREATE OR REPLACE FUNCTION public.workspace_promotion_save(p_actor uuid, p_request uuid, p_store uuid, p_rows jsonb, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE cached workspace_promotion_requests%rowtype; item jsonb; emp store_employees%rowtype;
 code text; start_month text; start_date date; previous_position text; level text; position_row record;
 ids jsonb:='[]'::jsonb; new_id uuid; output jsonb; monthly_count integer:=0; changed integer;
 today date:=(now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- Lock before checking both the receipt and snapshot. Legacy writers also take row-exclusive table locks.
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_promotion_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.store_id<>p_store OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM stores WHERE id=p_store AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
 IF workspace_promotion_snapshot(p_store,p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'employee_code',r->>'effective_date',r->>'position',r->>'newbie_level' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',CASE value->>'newbie_level' WHEN '二階新人' THEN 2 WHEN '一階新人' THEN 1 ELSE 0 END,ordinality LOOP
  code:=item->>'employee_code';level:=nullif(item->>'newbie_level','');
  IF coalesce(code,'')='' OR code<>upper(btrim(code)) OR length(code)>20 OR coalesce(item->>'employee_name','')='' OR
     coalesce(item->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR (item->>'effective_date')::date<'1912-01-01'::date OR
     coalesce(item->>'position','') NOT IN ('總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理','代理店長') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF item->>'position'='新人' AND coalesce(level,'') NOT IN ('未過階新人','一階新人','二階新人') OR item->>'position'='行政' AND coalesce(level,'') NOT IN ('未過階行政','過階行政') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF (SELECT count(*) FROM store_employees WHERE store_id=p_store AND employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  SELECT * INTO emp FROM store_employees WHERE store_id=p_store AND employee_code=code;
  IF emp.employee_name IS DISTINCT FROM item->>'employee_name' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.movement_date=(item->>'effective_date')::date AND h.new_value=item->>'position'
    AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(level,'')) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
  -- The previous official position follows chronology, never an acting appointment.
  SELECT h.new_value INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=(item->>'effective_date')::date
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF previous_position IS NULL THEN
   SELECT m.position INTO previous_position FROM monthly_staff_status m WHERE m.employee_code=code AND m.year_month<left(item->>'effective_date',7) AND m.position<>'代理店長' ORDER BY m.year_month DESC,m.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN
   SELECT nullif(h.old_value,'代理店長') INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date>(item->>'effective_date')::date ORDER BY h.movement_date,h.created_at,h.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN previous_position:=nullif(coalesce(emp.current_position,emp.position),'代理店長'); END IF;
  INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,created_at)
   VALUES(code,item->>'employee_name',p_store,'promotion',(item->>'effective_date')::date,previous_position,item->>'position',nullif(concat_ws('；',nullif(item->>'notes',''),CASE WHEN item->>'position'='新人' THEN '新人等級:'||level WHEN item->>'position'='行政' THEN '行政階級:'||level END),''),p_actor,clock_timestamp()) RETURNING id INTO new_id;
  ids:=ids||jsonb_build_array(new_id);
 END LOOP;
 -- Recompute complete affected monthly intervals, so a backdated insert cannot overwrite a later promotion.
 FOR code,start_month,start_date IN SELECT value->>'employee_code',min(left(value->>'effective_date',7)),min((value->>'effective_date')::date) FROM jsonb_array_elements(p_rows) GROUP BY value->>'employee_code' LOOP
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=start_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),
     newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
     is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT; monthly_count:=monthly_count+changed;
  -- Future appointments remain in history/monthly planning and do not prematurely change today's master.
  SELECT h.new_value,h.movement_date INTO position_row FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=today
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND AND start_date<=today THEN
   UPDATE store_employees SET position=position_row.new_value,current_position=position_row.new_value,last_promotion_date=position_row.movement_date,updated_at=now() WHERE employee_code=code;
  END IF;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'ids',ids,'monthlyUpdated',monthly_count);
 INSERT INTO workspace_promotion_requests(request_id,actor_id,store_id,payload,result) VALUES(p_request,p_actor,p_store,p_rows,output);
 RETURN output;
END;
$$;
CREATE OR REPLACE FUNCTION public.workspace_apply_due_promotions(p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Taipei'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $$
DECLARE code text; latest record; first_month text; master_count integer:=0; monthly_count integer:=0; processed_count integer:=0; changed integer;
BEGIN
 IF p_as_of IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID_DATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of) THEN
  RETURN jsonb_build_object('processed',0,'mastersUpdated',0,'monthlyUpdated',0);
 END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE workspace_promotion_activation IN SHARE ROW EXCLUSIVE MODE;
 FOR code IN SELECT DISTINCT h.employee_code FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of ORDER BY h.employee_code LIMIT 500 LOOP
  SELECT min(to_char(h.movement_date,'YYYY-MM')) INTO first_month FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  SELECT h.id,h.new_value,h.movement_date INTO latest FROM employee_movement_history h
   WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=p_as_of
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND THEN
   UPDATE store_employees SET position=latest.new_value,current_position=latest.new_value,last_promotion_date=latest.movement_date,updated_at=now()
    WHERE employee_code=code AND (position,current_position,last_promotion_date) IS DISTINCT FROM (latest.new_value,latest.new_value,latest.movement_date);
   GET DIAGNOSTICS changed=ROW_COUNT;master_count:=master_count+changed;
  END IF;
  -- Include months created after the original save, and preserve all later official promotions.
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=first_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
    is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT;monthly_count:=monthly_count+changed;
  UPDATE workspace_promotion_activation q SET processed_at=now(),applied_history_id=latest.id
   FROM employee_movement_history h WHERE h.id=q.history_id AND q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  GET DIAGNOSTICS changed=ROW_COUNT;processed_count:=processed_count+changed;
 END LOOP;
 RETURN jsonb_build_object('processed',processed_count,'mastersUpdated',master_count,'monthlyUpdated',monthly_count);
END;
$$;
CREATE OR REPLACE FUNCTION public.workspace_transfer_confirm(p_actor uuid, p_id uuid, p_date date, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 from_name text;to_name text;mid uuid;ym text;effective_month text;d integer;total integer;month_day text;is_admin boolean;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_date IS NULL OR p_date<'1912-01-01'::date THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 
 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now()) AND r.is_active=true
  AND (r.code IN('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
   OR EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND rp.is_allowed=true AND p.is_active=true AND p.code='employee.store_transfer.confirm'))
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 -- Same ordering as employee and promotion transactions; serialize duplicate checks and monthly initialization.
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status,store_transfer_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO req FROM store_transfer_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND store_id IN(req.from_store_id,req.to_store_id)) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 IF req.status='confirmed' AND req.confirmed_by=p_actor AND req.effective_date=p_date AND req.movement_history_id IS NOT NULL THEN
  RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',req.movement_history_id,'alreadyConfirmed',true);
 END IF;
 IF req.status<>'pending' THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 PERFORM id FROM stores WHERE id IN(req.from_store_id,req.to_store_id) ORDER BY id FOR SHARE;
 IF p_version IS NULL OR p_version IS DISTINCT FROM workspace_transfer_snapshot(p_id) THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
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
   INSERT INTO monthly_staff_status(year_month,store_id,user_id,employee_code,employee_name,position,employment_type,is_pharmacist,start_date,monthly_status,work_days,total_days_in_month,work_hours,partial_month_reason,partial_month_notes,is_manually_added,status)
   VALUES(ym,req.to_store_id,source.user_id,req.employee_code,req.employee_name,coalesce(source.current_position,source.position,'新人'),source.employment_type,source.is_pharmacist,source.start_date,CASE WHEN ym=effective_month THEN 'transferred_in' ELSE 'full_month' END,CASE WHEN ym=effective_month THEN total-d+1 ELSE total END,total,CASE WHEN source.employment_type='part_time' THEN 0 END,CASE WHEN ym=effective_month THEN '調入店' END,CASE WHEN ym=effective_month THEN month_day||'自'||from_name||'調入' END,false,'draft');
  END IF;
 END LOOP;
 UPDATE store_transfer_requests SET status='confirmed',confirmed_by=p_actor,confirmed_at=now(),effective_date=p_date,movement_history_id=mid WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',mid);
END;
$$;
CREATE OR REPLACE FUNCTION public.workspace_transfer_correct(p_actor uuid, p_id uuid, p_date date, p_reason text, p_version text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; cached workspace_transfer_corrections%rowtype; target store_employees%rowtype; old_data jsonb;result jsonb;is_admin boolean;ym text;d integer;total integer;from_name text;to_name text;history employee_movement_history%rowtype;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_request IS NULL OR p_date IS NULL OR p_date<'2000-01-01'::date OR p_date>'2100-12-31'::date OR coalesce(btrim(p_reason),'')='' OR length(p_reason)>2000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
 
 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now()) AND r.is_active=true
  AND (r.code IN('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
   OR EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND rp.is_allowed=true AND p.is_active=true AND p.code='employee.store_transfer.confirm'))
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status,store_transfer_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO req FROM store_transfer_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';END IF;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND store_id IN(req.from_store_id,req.to_store_id)) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN';END IF;
 SELECT * INTO cached FROM workspace_transfer_corrections WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.transfer_id<>p_id OR cached.new_date<>p_date OR cached.reason<>btrim(p_reason) THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED';END IF;
  RETURN cached.result||jsonb_build_object('alreadyCorrected',true);
 END IF;
 IF req.status<>'confirmed' OR req.effective_date IS NULL OR req.movement_history_id IS NULL THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT';END IF;
 IF req.effective_date=p_date THEN RAISE EXCEPTION 'WORKSPACE_SAME_DATE';END IF;
 IF to_char(req.effective_date,'YYYY-MM')<>to_char(p_date,'YYYY-MM') THEN RAISE EXCEPTION 'WORKSPACE_CROSS_MONTH_PENDING';END IF;
 PERFORM id FROM stores WHERE id IN(req.from_store_id,req.to_store_id) ORDER BY id FOR SHARE;
 IF p_version IS NULL OR p_version IS DISTINCT FROM workspace_transfer_snapshot(p_id) THEN RAISE EXCEPTION 'WORKSPACE_STALE';END IF;
 SELECT * INTO history FROM employee_movement_history WHERE id=req.movement_history_id;
 IF NOT FOUND OR history.movement_type<>'store_transfer' OR history.employee_code IS DISTINCT FROM req.employee_code OR history.store_id IS DISTINCT FROM req.to_store_id OR history.movement_date IS DISTINCT FROM req.effective_date THEN RAISE EXCEPTION 'WORKSPACE_HISTORY_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND id<>history.id AND movement_date>=least(req.effective_date,p_date)) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT';END IF;
 IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND last_movement_date>req.effective_date) THEN RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT';END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND is_active=true)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id AND is_active=true;
 IF NOT FOUND OR target.last_movement_type IS DISTINCT FROM 'store_transfer' OR target.last_movement_date IS DISTINCT FROM req.effective_date THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 IF NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND is_active=false AND last_movement_type='store_transfer' AND last_movement_date=req.effective_date) THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED';END IF;
 ym:=to_char(p_date,'YYYY-MM');d:=extract(day FROM p_date);total:=extract(day FROM(date_trunc('month',p_date)+interval '1 month - 1 day'));
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym AND status IS DISTINCT FROM 'draft') THEN RAISE EXCEPTION 'WORKSPACE_MONTH_LOCKED';END IF;
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym GROUP BY store_id HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_DUPLICATE';END IF;
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND year_month=ym AND ((store_id=req.from_store_id AND monthly_status<>'transferred_out') OR(store_id=req.to_store_id AND monthly_status<>'transferred_in'))) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_CHANGED';END IF;
 SELECT store_name INTO from_name FROM stores WHERE id=req.from_store_id;SELECT store_name INTO to_name FROM stores WHERE id=req.to_store_id;
 old_data:=jsonb_build_object('request',to_jsonb(req),'history',to_jsonb(history),'employees',(SELECT jsonb_agg(to_jsonb(e)) FROM store_employees e WHERE employee_code=req.employee_code),'monthly',(SELECT jsonb_agg(to_jsonb(m)) FROM monthly_staff_status m WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym));
 UPDATE employee_movement_history SET movement_date=p_date,notes=concat_ws('；',nullif(notes,''),'生效日更正 '||req.effective_date||' → '||p_date||'（'||btrim(p_reason)||'）') WHERE id=history.id;
 UPDATE store_employees SET last_movement_date=p_date WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND last_movement_type='store_transfer' AND last_movement_date=req.effective_date;
 UPDATE monthly_staff_status SET work_days=CASE WHEN store_id=req.from_store_id THEN d-1 ELSE total-d+1 END,total_days_in_month=total,partial_month_notes=CASE WHEN store_id=req.from_store_id THEN to_char(p_date,'MM/DD')||'調出至'||to_name ELSE to_char(p_date,'MM/DD')||'自'||from_name||'調入' END WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month=ym;
 UPDATE store_transfer_requests SET effective_date=p_date,corrected_at=now(),corrected_by=p_actor,correction_reason=btrim(p_reason) WHERE id=p_id;
 result:=jsonb_build_object('id',p_id,'effective_date',p_date,'status','confirmed');
 INSERT INTO workspace_transfer_corrections(request_id,actor_id,transfer_id,old_date,new_date,reason,before_data,result) VALUES(p_request,p_actor,p_id,req.effective_date,p_date,btrim(p_reason),old_data,result);
 RETURN result;
END;
$$;
DROP FUNCTION IF EXISTS public.workspace_roster_apply_store_month(uuid,uuid,text,boolean,boolean,text);
DROP FUNCTION IF EXISTS public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text);
DROP FUNCTION IF EXISTS public.workspace_employee_master_position_sync(text);
DROP FUNCTION IF EXISTS public.workspace_effective_promotion(text,date);
DROP FUNCTION IF EXISTS public.workspace_position_rank(text,text);
DROP TABLE IF EXISTS public.monthly_staff_adjustment_log;
ALTER TABLE public.monthly_staff_status DROP COLUMN IF EXISTS movement_hint;
NOTIFY pgrst,'reload schema';
COMMIT;
