-- Rollback of 20261105200100_w05_employee_edit_recheck.sql：還原 workspace_employee_edit；需重新確認資料表只在沒有資料時才刪除（A.2 可能已使用）。
BEGIN;
CREATE OR REPLACE FUNCTION workspace_employee_edit_state(p_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'masters',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM (SELECT id,employee_code,employee_name,start_date,birthday,position,current_position,is_active,employment_status,last_movement_date FROM store_employees WHERE employee_code=p_code) t),'[]'::jsonb),
  'statuses',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY year_month DESC,id) FROM (SELECT id,employee_code,employee_name,position,year_month,monthly_status,start_date FROM monthly_staff_status WHERE employee_code=p_code) t),'[]'::jsonb),
  'movements',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY movement_date DESC,created_at DESC,id) FROM (SELECT id,employee_code,employee_name,movement_type,new_value,movement_date,created_at FROM employee_movement_history WHERE employee_code=p_code) t),'[]'::jsonb)
 );
$$;
CREATE TABLE IF NOT EXISTS workspace_employee_edit_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_employee_edit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_employee_edit_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_employee_edit_requests TO service_role;
CREATE OR REPLACE FUNCTION workspace_employee_edit(p_actor uuid,p_request uuid,p_data jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_employee_edit_requests%rowtype; code text; snapshot jsonb; result jsonb; birth date; started date; changed integer;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 code:=p_data->>'employee_code';
 IF coalesce(code,'') !~ '^[A-Z0-9_-]{1,30}$' OR coalesce(btrim(p_data->>'employee_name'),'')='' OR length(p_data->>'employee_name')>100 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 birth:=nullif(p_data->>'birthday','')::date;started:=nullif(p_data->>'start_date','')::date;
 IF birth<'1900-01-01'::date OR birth>(now() AT TIME ZONE 'Asia/Taipei')::date OR started<'1900-01-01'::date OR (birth IS NOT NULL AND started IS NOT NULL AND birth>started) THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_edit_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 snapshot:=workspace_employee_edit_state(code);
 IF snapshot IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CHANGED'; END IF;
 IF jsonb_array_length(snapshot->'masters')+jsonb_array_length(snapshot->'statuses')+jsonb_array_length(snapshot->'movements')=0 THEN RAISE EXCEPTION 'WORKSPACE_MISSING'; END IF;
 UPDATE store_employees SET employee_name=btrim(p_data->>'employee_name'),start_date=started,birthday=birth,position=nullif(p_data->>'current_position',''),current_position=nullif(p_data->>'current_position','') WHERE employee_code=code;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN
  INSERT INTO store_employees(employee_code,employee_name,position,current_position,start_date,birthday,employment_type,employment_status,is_active,store_id)
  VALUES(code,btrim(p_data->>'employee_name'),nullif(p_data->>'current_position',''),nullif(p_data->>'current_position',''),started,birth,'full_time','active',true,null);
 END IF;
 UPDATE monthly_staff_status SET employee_name=btrim(p_data->>'employee_name'),position=coalesce(nullif(p_data->>'current_position',''),position) WHERE employee_code=code;
 result:=jsonb_build_object('success',true,'employee_code',code);
 INSERT INTO workspace_employee_edit_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION workspace_employee_edit_state(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workspace_employee_edit(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_employee_edit_state(text),workspace_employee_edit(uuid,uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
DROP FUNCTION IF EXISTS public.workspace_staff_month_locked(uuid,text,text);
DO $$ BEGIN IF to_regclass('public.monthly_staff_recheck') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.monthly_staff_recheck) THEN DROP FUNCTION IF EXISTS public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text); DROP TABLE public.monthly_staff_recheck; END IF; END $$;
COMMIT;
