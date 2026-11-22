BEGIN;
DO $$
DECLARE actor uuid; first_id uuid; second_id uuid; first_code text:='VBD'||upper(left(gen_random_uuid()::text,8)); second_code text:='VBD'||upper(left(gen_random_uuid()::text,8)); rows jsonb; snapshot jsonb; result jsonb; request uuid:=gen_random_uuid();
BEGIN
 SELECT id INTO actor FROM profiles ORDER BY id LIMIT 1;
 INSERT INTO store_employees(employee_code,employee_name,employment_type,birthday) VALUES(first_code,'生日驗證一','full_time','1990-01-01') RETURNING id INTO first_id;
 INSERT INTO store_employees(employee_code,employee_name,employment_type,birthday) VALUES(second_code,'生日驗證二','full_time','1991-01-01') RETURNING id INTO second_id;
 rows:=jsonb_build_array(jsonb_build_object('employee_code',first_code,'employee_name','生日驗證一','birthday','2000-02-29'),jsonb_build_object('employee_code',second_code,'employee_name','生日驗證二','birthday','2001-03-04'));
 snapshot:=workspace_birthday_snapshot(ARRAY[first_code,second_code]);
 BEGIN
  PERFORM workspace_birthday_save(actor,gen_random_uuid(),rows,snapshot->>'version',ARRAY[first_id]);
  RAISE EXCEPTION 'scope bypass';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_SCOPE' THEN RAISE; END IF; END;
 EXECUTE 'CREATE FUNCTION pg_temp.fail_birthday() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF NEW.employee_name=''生日驗證二'' THEN RAISE EXCEPTION ''TEST_LATE_FAILURE''; END IF; RETURN NEW; END $fn$';
 EXECUTE 'CREATE TRIGGER test_fail_birthday BEFORE UPDATE ON store_employees FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_birthday()';
 BEGIN
  PERFORM workspace_birthday_save(actor,gen_random_uuid(),rows,snapshot->>'version',ARRAY[first_id,second_id]);
  RAISE EXCEPTION 'injected failure ignored';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TEST_LATE_FAILURE' THEN RAISE; END IF; END;
 IF workspace_birthday_snapshot(ARRAY[first_code,second_code]) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'partial birthday write'; END IF;
 DROP TRIGGER test_fail_birthday ON store_employees;
 result:=workspace_birthday_save(actor,request,rows,snapshot->>'version',ARRAY[first_id,second_id]);
 IF (result->>'employees')::int<>2 OR (result->>'records')::int<>2 THEN RAISE EXCEPTION 'wrong count'; END IF;
 IF (SELECT birthday FROM store_employees WHERE id=first_id)<>'2000-02-29'::date THEN RAISE EXCEPTION 'birthday not saved'; END IF;
 IF workspace_birthday_save(actor,request,rows,snapshot->>'version',ARRAY[first_id,second_id]) IS DISTINCT FROM result THEN RAISE EXCEPTION 'replay failure'; END IF;
 BEGIN
  PERFORM workspace_birthday_save(actor,gen_random_uuid(),rows,snapshot->>'version',ARRAY[first_id,second_id]);
  RAISE EXCEPTION 'stale preview accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CONFLICT' THEN RAISE; END IF; END;
 snapshot:=workspace_birthday_snapshot(ARRAY[first_code,second_code]);
 BEGIN
  PERFORM workspace_birthday_save(actor,gen_random_uuid(),jsonb_set(rows,'{1,employee_name}','"錯誤姓名"'),snapshot->>'version',ARRAY[first_id,second_id]);
  RAISE EXCEPTION 'incorrect name accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_NAME' THEN RAISE; END IF; END;
 IF workspace_birthday_snapshot(ARRAY[first_code,second_code]) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'name failure changed data'; END IF;
 IF has_function_privilege('authenticated','workspace_birthday_save(uuid,uuid,jsonb,text,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'direct write exposed'; END IF;
END $$;
ROLLBACK;
SELECT 'birthday scope, atomic rollback, write, receipt replay, stale version, name and RPC restrictions passed' AS result;
