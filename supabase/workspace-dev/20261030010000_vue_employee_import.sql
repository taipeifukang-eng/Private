BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_employee_import_receipts(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_employee_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_employee_import_receipts FROM anon,authenticated;
GRANT ALL ON public.workspace_employee_import_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.workspace_employee_import_check(p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; errors jsonb:='[]'; n int:=0; msg text; sid uuid; dt date; code text; seen text[]:='{}';
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>10000 THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1;msg:=NULL;code:=r->>'employee_code';
  BEGIN
   IF code IS NULL OR code !~ '^[A-Z0-9_-]{1,30}$' OR nullif(btrim(r->>'employee_name'),'') IS NULL OR length(r->>'employee_name')>200 OR nullif(btrim(r->>'position'),'') IS NULL OR length(r->>'position')>100 THEN RAISE EXCEPTION '欄位不完整或員編格式不正確';END IF;
   sid:=(r->>'store_id')::uuid;dt:=(r->>'start_date')::date;
   IF dt IS NULL OR r->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' OR dt<'1900-01-01' OR dt>'2099-12-31' THEN RAISE EXCEPTION '到職日期不正確';END IF;
   IF sid IS NULL OR NOT(sid=ANY(coalesce(p_visible,'{}'::uuid[]))) OR NOT EXISTS(SELECT 1 FROM stores WHERE id=sid AND is_active=true) THEN RAISE EXCEPTION '門市不在可匯入範圍或已停用';END IF;
   IF code=ANY(seen) THEN RAISE EXCEPTION '檔案內員編重複';END IF;
   IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code) THEN RAISE EXCEPTION '員編已存在，不會覆寫既有資料';END IF;
  EXCEPTION WHEN OTHERS THEN msg:=SQLERRM;END;
  seen:=array_append(seen,code);
  IF msg IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('row',coalesce(r->>'row',n::text),'message',msg));END IF;
 END LOOP;
 RETURN jsonb_build_object('valid',jsonb_array_length(errors)=0,'errors',errors);
END;$$;
CREATE OR REPLACE FUNCTION public.workspace_employee_import_save(p_actor uuid,p_request uuid,p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cached workspace_employee_import_receipts; checked jsonb; result jsonb; r jsonb; total int:=0;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 LOCK TABLE workspace_employee_import_receipts IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_employee_import_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'IMPORT_REQUEST_REUSED';END IF;
  RETURN cached.result;
 END IF;
 LOCK TABLE stores IN SHARE MODE;
 LOCK TABLE store_employees IN SHARE ROW EXCLUSIVE MODE;
 checked:=workspace_employee_import_check(p_rows,p_visible);
 IF NOT (checked->>'valid')::boolean THEN RAISE EXCEPTION 'IMPORT_CONFLICT';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  INSERT INTO store_employees(store_id,employee_code,employee_name,position,current_position,start_date,employment_type,is_active,employment_status)
  VALUES((r->>'store_id')::uuid,r->>'employee_code',r->>'employee_name',r->>'position',r->>'position',(r->>'start_date')::date,'full_time',true,'active');
  total:=total+1;
 END LOOP;
 result:=jsonb_build_object('success',true,'imported',total,'requestId',p_request);
 INSERT INTO workspace_employee_import_receipts(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,result);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
