BEGIN;
CREATE OR REPLACE FUNCTION public.workspace_transfer_snapshot(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object(
 'request',to_jsonb(r),
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stores s WHERE s.id IN(r.from_store_id,r.to_store_id)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM store_employees e WHERE e.employee_code=r.employee_code),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM employee_movement_history h WHERE h.employee_code=r.employee_code),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM monthly_staff_status m WHERE m.employee_code=r.employee_code AND m.store_id IN(r.from_store_id,r.to_store_id)),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.year_month,x.status) FROM (SELECT DISTINCT year_month,status FROM monthly_staff_status WHERE store_id=r.to_store_id)x)
 )::text) FROM store_transfer_requests r WHERE r.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.workspace_transfer_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_snapshot(uuid) TO service_role;
-- DEV-only foundation. Future-dated confirmation remains unavailable until its activation policy is settled.
CREATE OR REPLACE FUNCTION public.workspace_transfer_confirm(p_actor uuid,p_id uuid,p_date date,p_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 from_name text;to_name text;mid uuid;ym text;effective_month text;d integer;total integer;month_day text;is_admin boolean;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_date IS NULL OR p_date<'1912-01-01'::date THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF p_date>(now() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'WORKSPACE_FUTURE_POLICY_PENDING'; END IF;
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
REVOKE ALL ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) TO service_role;
DROP FUNCTION IF EXISTS public.workspace_transfer_confirm(uuid,uuid,date);
NOTIFY pgrst,'reload schema';
COMMIT;
