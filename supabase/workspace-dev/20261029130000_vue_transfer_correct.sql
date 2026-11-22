BEGIN;
ALTER TABLE store_transfer_requests ADD COLUMN IF NOT EXISTS corrected_at timestamptz, ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS correction_reason text;
CREATE TABLE IF NOT EXISTS workspace_transfer_corrections(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,transfer_id uuid NOT NULL,old_date date NOT NULL,new_date date NOT NULL,reason text NOT NULL,before_data jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_transfer_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_transfer_corrections FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_transfer_corrections TO service_role;
CREATE OR REPLACE FUNCTION workspace_transfer_correct(p_actor uuid,p_id uuid,p_date date,p_reason text,p_version text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE req store_transfer_requests%rowtype; cached workspace_transfer_corrections%rowtype; target store_employees%rowtype; old_data jsonb;result jsonb;is_admin boolean;ym text;d integer;total integer;from_name text;to_name text;history employee_movement_history%rowtype;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR p_request IS NULL OR p_date IS NULL OR p_date<'2000-01-01'::date OR p_date>'2100-12-31'::date OR coalesce(btrim(p_reason),'')='' OR length(p_reason)>2000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
 IF p_date>(now() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'WORKSPACE_FUTURE_POLICY_PENDING';END IF;
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
REVOKE ALL ON FUNCTION workspace_transfer_correct(uuid,uuid,date,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_transfer_correct(uuid,uuid,date,text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
