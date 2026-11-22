BEGIN;
DO $$
DECLARE actor uuid; store uuid; code text:='VEC'||upper(left(gen_random_uuid()::text,8)); data jsonb; request uuid:=gen_random_uuid(); result jsonb; employee uuid;
BEGIN
 SELECT id INTO actor FROM profiles ORDER BY id LIMIT 1;SELECT id INTO store FROM stores ORDER BY id LIMIT 1;
 data:=jsonb_build_object('employee_code',code,'employee_name','新增員工驗證','current_position','專員','birthday','1990-02-03','start_date','2026-10-01');
 result:=workspace_employee_create(actor,request,data);employee:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM store_employees WHERE id=employee AND employee_code=code AND store_id IS NULL AND current_position='專員' AND position='專員' AND is_active) THEN RAISE EXCEPTION 'employee values incorrect'; END IF;
 IF workspace_employee_create(actor,request,data) IS DISTINCT FROM result THEN RAISE EXCEPTION 'replay failure'; END IF;
 BEGIN
  PERFORM workspace_employee_create(actor,gen_random_uuid(),data);
  RAISE EXCEPTION 'duplicate master accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DUPLICATE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM workspace_employee_create(actor,request,data||'{"employee_name":"其他姓名"}');
  RAISE EXCEPTION 'reused request accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_REQUEST_REUSED' THEN RAISE; END IF; END;
 DELETE FROM store_employees WHERE id=employee;
 INSERT INTO employee_movement_history(employee_code,employee_name,movement_type,movement_date,new_value) VALUES(code,'歷史來源驗證','resignation','2026-09-01','resigned');
 BEGIN
  PERFORM workspace_employee_create(actor,gen_random_uuid(),data);
  RAISE EXCEPTION 'history-only duplicate accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DUPLICATE' THEN RAISE; END IF; END;
 DELETE FROM employee_movement_history WHERE employee_code=code;
 INSERT INTO monthly_staff_status(employee_code,employee_name,year_month,store_id,employment_type,monthly_status) VALUES(code,'月報來源驗證','2026-09',store,'full_time','full_month');
 BEGIN
  PERFORM workspace_employee_create(actor,gen_random_uuid(),data);
  RAISE EXCEPTION 'monthly-only duplicate accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DUPLICATE' THEN RAISE; END IF; END;
 DELETE FROM monthly_staff_status WHERE employee_code=code;
 BEGIN
  PERFORM workspace_employee_create(actor,gen_random_uuid(),data||'{"birthday":"2099-01-01"}');
  RAISE EXCEPTION 'future birthday accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DATE' THEN RAISE; END IF; END;
 EXECUTE 'CREATE FUNCTION pg_temp.fail_employee_receipt() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION ''TEST_RECEIPT_FAILURE''; END $fn$';
 EXECUTE 'CREATE TRIGGER test_employee_receipt BEFORE INSERT ON workspace_employee_create_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_employee_receipt()';
 BEGIN
  PERFORM workspace_employee_create(actor,gen_random_uuid(),data);
  RAISE EXCEPTION 'injected receipt failure ignored';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TEST_RECEIPT_FAILURE' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code) THEN RAISE EXCEPTION 'employee left after failed receipt'; END IF;
 IF has_function_privilege('authenticated','workspace_employee_create(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'direct RPC allowed'; END IF;
END $$;
ROLLBACK;
SELECT 'employee creation, replay, duplicates across master/month/history, date rejection, atomic receipt rollback and RPC permissions passed' AS result;
