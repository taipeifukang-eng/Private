BEGIN;
CREATE FUNCTION pg_temp.confirm_test(actor uuid,id uuid,effective date) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.workspace_transfer_confirm(actor,id,effective,public.workspace_transfer_snapshot(id)); $$;
DO $$
DECLARE actor uuid; a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();request uuid:=gen_random_uuid();employee uuid;result jsonb;code text:='VTC'||substr(replace(gen_random_uuid()::text,'-',''),1,12); denied boolean;old_version text;correction uuid:=gen_random_uuid();
BEGIN
 SELECT id INTO actor FROM profiles WHERE role='admin' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Test needs a DEV administrator'; END IF;
 INSERT INTO stores(id,store_code,store_name,is_active) VALUES(a,code||'A','交易測試來源',true),(b,code||'B','交易測試目的',true);
 INSERT INTO store_employees(store_id,employee_code,employee_name,position,current_position,employment_type,is_active,employment_status,is_pharmacist,birthday,start_date)
 VALUES(a,code,'調店交易測試','專員','專員','full_time',true,'active',true,'1990-02-01','2020-01-01') RETURNING id INTO employee;
 INSERT INTO monthly_staff_status(year_month,store_id,employee_code,employee_name,employment_type,monthly_status,work_days,status)
 VALUES('2026-07',a,code,'調店交易測試','full_time','full_month',31,'draft'),('2026-07',b,code||'X','初始化用','full_time','full_month',31,'draft'),('2026-08',b,code||'X','初始化用','full_time','full_month',31,'draft');
 INSERT INTO store_transfer_requests(id,employee_code,employee_name,from_store_id,to_store_id,status,created_by) VALUES(request,code,'調店交易測試',a,b,'pending',actor);
 old_version:=workspace_transfer_snapshot(request);UPDATE store_transfer_requests SET notes='changed after preview' WHERE id=request;
 denied:=false;BEGIN PERFORM workspace_transfer_confirm(actor,request,'2026-07-15',old_version);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_STALE' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Stale version accepted';END IF;
 -- A closed future destination month must block the entire transaction before any write.
 INSERT INTO monthly_staff_status(year_month,store_id,employee_code,employee_name,employment_type,monthly_status,work_days,status) VALUES('2026-09',b,code,'調店交易測試','full_time','full_month',30,'confirmed');
 denied:=false;BEGIN PERFORM pg_temp.confirm_test(actor,request,'2026-07-15');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_MONTH_LOCKED' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied OR EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code) OR NOT EXISTS(SELECT 1 FROM store_employees WHERE id=employee AND is_active=true) THEN RAISE EXCEPTION 'Closed month did not protect master/history';END IF;
 DELETE FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-09';
 -- Force an error after history/master writes, proving PostgreSQL rolls everything back.
 BEGIN
  EXECUTE 'ALTER TABLE monthly_staff_status ADD CONSTRAINT workspace_transfer_test_failure CHECK (employee_code <> '||quote_literal(code)||' OR store_id <> '||quote_literal(b)||'::uuid)';
  denied:=false;BEGIN PERFORM pg_temp.confirm_test(actor,request,'2026-07-15');EXCEPTION WHEN check_violation THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'Expected injected monthly failure'; END IF;
  IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code) OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=b) OR NOT EXISTS(SELECT 1 FROM store_transfer_requests WHERE id=request AND status='pending') OR NOT EXISTS(SELECT 1 FROM store_employees WHERE id=employee AND is_active=true) THEN RAISE EXCEPTION 'Partial writes survived failure'; END IF;
  ALTER TABLE monthly_staff_status DROP CONSTRAINT workspace_transfer_test_failure;
 END;
 result:=pg_temp.confirm_test(actor,request,'2026-07-15');
 IF result->>'status'<>'confirmed' OR (SELECT count(*) FROM employee_movement_history WHERE employee_code=code)<>1 THEN RAISE EXCEPTION 'Missing confirmation/history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM store_employees WHERE id=employee AND is_active=false) OR NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=b AND is_active=true AND is_pharmacist=true AND birthday='1990-02-01' AND start_date='2020-01-01') THEN RAISE EXCEPTION 'Master data not preserved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=a AND year_month='2026-07' AND work_days=14 AND monthly_status='transferred_out') OR NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-07' AND work_days=17 AND monthly_status='transferred_in') OR NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-08' AND work_days=31 AND monthly_status='full_month') THEN RAISE EXCEPTION 'Month allocation mismatch'; END IF;
 result:=pg_temp.confirm_test(actor,request,'2026-07-15');IF result->>'alreadyConfirmed'<>'true' OR (SELECT count(*) FROM employee_movement_history WHERE employee_code=code)<>1 THEN RAISE EXCEPTION 'Retry duplicated';END IF;
 denied:=false;BEGIN PERFORM pg_temp.confirm_test(actor,request,'2026-07-16');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CONFLICT' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Changed retry accepted';END IF;
 UPDATE monthly_staff_status SET notes='手填備註',monthly_transport_expense=321 WHERE employee_code=code AND store_id=b AND year_month='2026-07';
 old_version:=workspace_transfer_snapshot(request);
 denied:=false;BEGIN PERFORM workspace_transfer_correct(actor,request,'2026-08-20','跨月',old_version,correction);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CROSS_MONTH_PENDING' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Unsettled cross-month correction accepted';END IF;
 EXECUTE 'ALTER TABLE monthly_staff_status ADD CONSTRAINT workspace_transfer_correction_test_failure CHECK (employee_code <> '||quote_literal(code)||' OR work_days <> 12)';
 denied:=false;BEGIN PERFORM workspace_transfer_correct(actor,request,'2026-07-20','日期誤植',old_version,correction);EXCEPTION WHEN check_violation THEN denied:=true;END;
 IF NOT denied OR EXISTS(SELECT 1 FROM workspace_transfer_corrections WHERE request_id=correction) OR NOT EXISTS(SELECT 1 FROM store_transfer_requests WHERE id=request AND effective_date='2026-07-15') OR NOT EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code AND movement_date='2026-07-15') THEN RAISE EXCEPTION 'Correction rollback failed';END IF;
 ALTER TABLE monthly_staff_status DROP CONSTRAINT workspace_transfer_correction_test_failure;
 result:=workspace_transfer_correct(actor,request,'2026-07-20','日期誤植',old_version,correction);
 IF NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=a AND year_month='2026-07' AND work_days=19) OR NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-07' AND work_days=12 AND notes='手填備註' AND monthly_transport_expense=321) THEN RAISE EXCEPTION 'Correction days/manual values mismatch';END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=code AND last_movement_date='2026-07-20')<>2 OR NOT EXISTS(SELECT 1 FROM workspace_transfer_corrections WHERE request_id=correction AND old_date='2026-07-15' AND new_date='2026-07-20' AND before_data->'request'->>'effective_date'='2026-07-15') THEN RAISE EXCEPTION 'Correction master or audit mismatch';END IF;
 result:=workspace_transfer_correct(actor,request,'2026-07-20','日期誤植',old_version,correction);IF result->>'alreadyCorrected'<>'true' THEN RAISE EXCEPTION 'Correction retry failed';END IF;
 denied:=false;BEGIN PERFORM workspace_transfer_correct(actor,request,'2026-07-21','另一日期',old_version,correction);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_REQUEST_REUSED' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Correction key reuse accepted';END IF;
 IF has_function_privilege('authenticated','public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Correction RPC exposed';END IF;
 IF has_function_privilege('authenticated','public.workspace_transfer_confirm(uuid,uuid,date,text)','EXECUTE') OR has_function_privilege('anon','public.workspace_transfer_confirm(uuid,uuid,date,text)','EXECUTE') THEN RAISE EXCEPTION 'RPC exposed to browser'; END IF;
END;
$$;
SELECT 'PASS actual DEV transfer transaction: closed month, injected rollback, master/history/months, idempotence, correction rollback/audit/manual fields, service-only grant' AS result;
ROLLBACK;
