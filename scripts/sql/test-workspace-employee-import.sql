BEGIN;
CREATE FUNCTION pg_temp.employee_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.employee_code='__IMPORT_FAIL' THEN RAISE EXCEPTION 'injected failure';END IF;RETURN NEW;END;$$;
CREATE TRIGGER employee_import_test_fail BEFORE INSERT ON store_employees FOR EACH ROW EXECUTE FUNCTION pg_temp.employee_import_fail();
DO $$
DECLARE sid uuid;actor uuid:=gen_random_uuid();req uuid:=gen_random_uuid();rows jsonb;bad jsonb;outcome jsonb;failed boolean;
BEGIN
 SELECT id INTO sid FROM stores WHERE is_active=true LIMIT 1;
 rows:=jsonb_build_array(jsonb_build_object('row',2,'store_id',sid,'employee_code','__IMPORT_OK','employee_name','交易回滾測試','position','專員','start_date','2026-12-01'));
 IF NOT (workspace_employee_import_check(rows,ARRAY[sid])->>'valid')::boolean THEN RAISE EXCEPTION 'Valid preview failed';END IF;
 IF (workspace_employee_import_check(rows,'{}')->>'valid')::boolean THEN RAISE EXCEPTION 'Scope allowed';END IF;
 bad:=jsonb_set(rows,'{0,start_date}','"2026-02-30"');IF (workspace_employee_import_check(bad,ARRAY[sid])->>'valid')::boolean THEN RAISE EXCEPTION 'Invalid date allowed';END IF;
 IF (workspace_employee_import_check(rows||rows,ARRAY[sid])->>'valid')::boolean THEN RAISE EXCEPTION 'Duplicate file allowed';END IF;
 bad:=rows||jsonb_set(rows,'{0,employee_code}','"__IMPORT_FAIL"');failed:=false;
 BEGIN PERFORM workspace_employee_import_save(actor,req,bad,ARRAY[sid]);EXCEPTION WHEN OTHERS THEN failed:=true;END;
 IF NOT failed OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code='__IMPORT_OK') OR EXISTS(SELECT 1 FROM workspace_employee_import_receipts WHERE request_id=req) THEN RAISE EXCEPTION 'Partial insert or receipt';END IF;
 outcome:=workspace_employee_import_save(actor,req,rows,ARRAY[sid]);
 IF outcome->>'imported'<>'1' OR NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code='__IMPORT_OK' AND position='專員' AND current_position='專員' AND employment_type='full_time' AND employment_status='active' AND is_active=true) THEN RAISE EXCEPTION 'Saved master mismatch';END IF;
 IF workspace_employee_import_save(actor,req,rows,ARRAY[sid]) IS DISTINCT FROM outcome THEN RAISE EXCEPTION 'Retry mismatch';END IF;
 IF (workspace_employee_import_check(rows,ARRAY[sid])->>'valid')::boolean THEN RAISE EXCEPTION 'Existing code allowed';END IF;
 failed:=false;BEGIN PERFORM workspace_employee_import_save(actor,gen_random_uuid(),rows,ARRAY[sid]);EXCEPTION WHEN OTHERS THEN failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'Concurrent duplicate allowed';END IF;
 failed:=false;BEGIN PERFORM workspace_employee_import_save(actor,req,bad,ARRAY[sid]);EXCEPTION WHEN OTHERS THEN failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'Reused payload allowed';END IF;
 IF has_function_privilege('authenticated','workspace_employee_import_save(uuid,uuid,jsonb,uuid[])','EXECUTE') OR has_function_privilege('anon','workspace_employee_import_check(jsonb,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'Public RPC';END IF;
END;$$;
SELECT 'PASS new master/defaults, future date, scope/date/duplicate checks, injected partial failure rollback, request retry, receipt conflict, private grants' result;
ROLLBACK;
