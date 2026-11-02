BEGIN;
CREATE TABLE IF NOT EXISTS workspace_birthday_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_birthday_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_birthday_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_birthday_requests TO service_role;
CREATE OR REPLACE FUNCTION workspace_birthday_snapshot(p_codes text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH records AS (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_code',employee_code,'employee_name',employee_name,'birthday',birthday,'is_active',is_active,'employment_status',employment_status,'last_movement_date',last_movement_date) ORDER BY id),'[]') AS rows
 FROM store_employees WHERE upper(btrim(employee_code))=ANY(p_codes))
 SELECT jsonb_build_object('rows',rows,'version',md5(rows::text)) FROM records;
$$;
CREATE OR REPLACE FUNCTION workspace_birthday_save(p_actor uuid,p_request uuid,p_rows jsonb,p_expected text,p_visible_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_birthday_requests%rowtype; codes text[]; snapshot jsonb; row jsonb; canonical_name text; birthday_date date; affected integer; result jsonb;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 LOCK TABLE store_employees IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_birthday_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 SELECT array_agg(value->>'employee_code') INTO codes FROM jsonb_array_elements(p_rows);
 IF EXISTS(SELECT 1 FROM unnest(codes) c GROUP BY c HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 snapshot:=workspace_birthday_snapshot(codes);
 IF snapshot->>'version' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'rows') r WHERE NOT coalesce((r->>'id')::uuid=ANY(p_visible_ids),false)) THEN RAISE EXCEPTION 'WORKSPACE_SCOPE'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF coalesce(row->>'employee_code','') !~ '^[A-Z0-9_-]{1,30}$' OR coalesce(row->>'birthday','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  birthday_date:=(row->>'birthday')::date;
  IF birthday_date<'1900-01-01'::date OR birthday_date>(now() AT TIME ZONE 'Asia/Taipei')::date THEN RAISE EXCEPTION 'WORKSPACE_DATE'; END IF;
  SELECT employee_name INTO canonical_name FROM store_employees WHERE upper(btrim(employee_code))=row->>'employee_code'
   ORDER BY (is_active IS DISTINCT FROM false AND employment_status IS DISTINCT FROM 'resigned') DESC,last_movement_date DESC NULLS LAST,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  IF btrim(coalesce(canonical_name,'')) IS DISTINCT FROM row->>'employee_name' THEN RAISE EXCEPTION 'WORKSPACE_NAME'; END IF;
 END LOOP;
 UPDATE store_employees e SET birthday=(r->>'birthday')::date FROM jsonb_array_elements(p_rows) r WHERE upper(btrim(e.employee_code))=r->>'employee_code';
 GET DIAGNOSTICS affected=ROW_COUNT;
 result:=jsonb_build_object('employees',jsonb_array_length(p_rows),'records',affected);
 INSERT INTO workspace_birthday_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION workspace_birthday_snapshot(text[]),workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_birthday_snapshot(text[]),workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
