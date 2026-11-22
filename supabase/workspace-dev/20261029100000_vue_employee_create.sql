BEGIN;
CREATE TABLE IF NOT EXISTS workspace_employee_create_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_employee_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_employee_create_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_employee_create_requests TO service_role;
CREATE OR REPLACE FUNCTION workspace_employee_create(p_actor uuid,p_request uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_employee_create_requests%rowtype; code text; employee_id uuid; result jsonb; birth date; started date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 code:=p_data->>'employee_code';
 IF coalesce(code,'') !~ '^[A-Z0-9_-]{1,20}$' OR coalesce(btrim(p_data->>'employee_name'),'')='' OR length(p_data->>'employee_name')>100 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 birth:=nullif(p_data->>'birthday','')::date;started:=nullif(p_data->>'start_date','')::date;
 IF birth<'1900-01-01'::date OR birth>(now() AT TIME ZONE 'Asia/Taipei')::date OR started<'1900-01-01'::date OR (birth IS NOT NULL AND started IS NOT NULL AND birth>started) THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
 -- Same order as promotion writes. Checking every source also protects history-only codes.
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_create_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code)
 OR EXISTS(SELECT 1 FROM employee_movement_history WHERE upper(btrim(employee_code))=code)
 OR EXISTS(SELECT 1 FROM monthly_staff_status WHERE upper(btrim(employee_code))=code) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 INSERT INTO store_employees(employee_code,employee_name,position,current_position,start_date,birthday,employment_type,employment_status,is_active,store_id)
 VALUES(code,btrim(p_data->>'employee_name'),nullif(p_data->>'current_position',''),nullif(p_data->>'current_position',''),started,birth,'full_time','active',true,null) RETURNING id INTO employee_id;
 result:=jsonb_build_object('id',employee_id,'employee_code',code);
 INSERT INTO workspace_employee_create_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION workspace_employee_create(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_employee_create(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
