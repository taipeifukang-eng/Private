-- W05 / M2 規格 E.1-E.3、F.1：員編規則與員工新增入口（DEV 專用，CREATE OR REPLACE，可重複套用）。
-- 規則（與 lib/workspace/employee-id-rule.ts 相同）：FK+4 碼、FKF+5 碼、FKPT+3 碼數字；FKI 一律拒絕；FKPT 為兼職。
-- 只擋「新建立」的員編；既有員編與編輯（員編唯讀）不受影響。
BEGIN;

CREATE OR REPLACE FUNCTION public.workspace_employee_id_valid(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(p_code,'') ~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$' $$;
CREATE OR REPLACE FUNCTION public.workspace_employee_id_type(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN coalesce(p_code,'') LIKE 'FKPT%' THEN 'part_time' ELSE 'full_time' END $$;
REVOKE ALL ON FUNCTION public.workspace_employee_id_valid(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_id_type(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_id_valid(text),public.workspace_employee_id_type(text) TO service_role;

-- E.1 新增員工：格式與兼職判斷都由規則決定。
CREATE OR REPLACE FUNCTION workspace_employee_create(p_actor uuid,p_request uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_employee_create_requests%rowtype; code text; employee_id uuid; result jsonb; birth date; started date; kind text;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 code:=p_data->>'employee_code';
 IF NOT workspace_employee_id_valid(code) OR coalesce(btrim(p_data->>'employee_name'),'')='' OR length(p_data->>'employee_name')>100 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 kind:=workspace_employee_id_type(code);
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
 VALUES(code,btrim(p_data->>'employee_name'),nullif(p_data->>'current_position',''),nullif(p_data->>'current_position',''),started,birth,kind,'active',true,null) RETURNING id INTO employee_id;
 result:=jsonb_build_object('id',employee_id,'employee_code',code,'employment_type',kind);
 INSERT INTO workspace_employee_create_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_data,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION workspace_employee_create(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_employee_create(uuid,uuid,jsonb) TO service_role;

-- E.1 / F.1 員工匯入：員編格式、職位限公司職位清單（types/workflow.ts POSITION_OPTIONS，單元測試會比對兩邊一致）。
CREATE OR REPLACE FUNCTION public.workspace_employee_import_check(p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; errors jsonb:='[]'; n int:=0; msg text; sid uuid; dt date; code text; seen text[]:='{}';
 positions text[]:=ARRAY['總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理'];
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>10000 THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1;msg:=NULL;code:=r->>'employee_code';
  BEGIN
   IF code LIKE 'FKI%' THEN RAISE EXCEPTION '實習生不納入系統，員編不可為 FKI 開頭';END IF;
   IF NOT workspace_employee_id_valid(code) THEN RAISE EXCEPTION '員編格式錯誤，正確格式：FK+4碼數字、FKF+5碼數字、FKPT+3碼數字';END IF;
   IF nullif(btrim(r->>'employee_name'),'') IS NULL OR length(r->>'employee_name')>200 OR nullif(btrim(r->>'position'),'') IS NULL OR length(r->>'position')>100 THEN RAISE EXCEPTION '欄位不完整或姓名、職位過長';END IF;
   IF NOT (r->>'position'=ANY(positions)) THEN RAISE EXCEPTION '職位不在公司職位清單內';END IF;
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
  VALUES((r->>'store_id')::uuid,r->>'employee_code',r->>'employee_name',r->>'position',r->>'position',(r->>'start_date')::date,workspace_employee_id_type(r->>'employee_code'),true,'active');
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

-- E.1 生日匯入（只比對既有員編）：同一套格式規則。
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
  IF NOT workspace_employee_id_valid(row->>'employee_code') OR coalesce(row->>'birthday','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
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
REVOKE ALL ON FUNCTION workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_birthday_save(uuid,uuid,jsonb,text,uuid[]) TO service_role;

-- 觸發器函式以 SECURITY DEFINER 執行（owner 仍可呼叫已 REVOKE 的 workspace_employee_id_valid），因此舊版以 authenticated 身分寫入的路徑不受 REVOKE 影響。
-- E.1 異動入職：不改動 workspace_movement_save，改以資料表觸發器擋下不合規的新員編（FKI、格式、長度）。
CREATE OR REPLACE FUNCTION public.workspace_guard_onboarding_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.movement_type='onboarding' AND NOT workspace_employee_id_valid(NEW.employee_code) THEN
  RAISE EXCEPTION 'WORKSPACE_INVALID' USING DETAIL='employee_id_rule';
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS workspace_guard_onboarding_code ON public.employee_movement_history;
CREATE TRIGGER workspace_guard_onboarding_code BEFORE INSERT ON public.employee_movement_history
 FOR EACH ROW EXECUTE FUNCTION public.workspace_guard_onboarding_code();
REVOKE ALL ON FUNCTION public.workspace_guard_onboarding_code() FROM PUBLIC,anon,authenticated;

-- E.1 每月人員狀態手動新增：員編可留空（舊版行為，見 E.2 待使用者決定），有填就必須合規。只擋新增，不擋更新。
CREATE OR REPLACE FUNCTION public.workspace_guard_manual_staff_code() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(NEW.is_manually_added,false) AND nullif(btrim(coalesce(NEW.employee_code,'')),'') IS NOT NULL AND NOT workspace_employee_id_valid(NEW.employee_code) THEN
  RAISE EXCEPTION 'WORKSPACE_INVALID' USING DETAIL='employee_id_rule';
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS workspace_guard_manual_staff_code ON public.monthly_staff_status;
CREATE TRIGGER workspace_guard_manual_staff_code BEFORE INSERT ON public.monthly_staff_status
 FOR EACH ROW EXECUTE FUNCTION public.workspace_guard_manual_staff_code();
REVOKE ALL ON FUNCTION public.workspace_guard_manual_staff_code() FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
