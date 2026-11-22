BEGIN;
CREATE FUNCTION pg_temp.batch_row(code text,sid uuid,kind text,dt text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('employee_code',code,'employee_name','批次交易測試','store_id',sid,'movement_type',kind,'effective_date',dt,'notes','','position','','newbie_level','','birthday','','onboarding_is_pharmacist',false,'from_store_id','','to_store_id',''); $$;
DO $$
DECLARE actor uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();hq uuid:=gen_random_uuid();dept uuid:=gen_random_uuid();req uuid:=gen_random_uuid();
 code text:='VB'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));rows jsonb;output jsonb;version text;bad jsonb;denied boolean;orgcode text;
BEGIN
 SELECT id INTO actor FROM profiles WHERE role='admin' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'DEV admin required'; END IF;
 INSERT INTO stores(id,store_code,store_name,is_active) VALUES(a,code||'A','批次來源',true),(b,code||'B','批次目的',true);
 INSERT INTO monthly_staff_status(year_month,store_id,employee_code,employee_name,employment_type,monthly_status,work_days,status,monthly_transport_expense,notes)
 VALUES('2026-10',a,code,'批次交易測試','full_time','full_month',31,'draft',123,'保留手填'),('2026-10',b,code,'批次交易測試','full_time','full_month',31,'draft',456,'目的手填'),('2026-11',b,code||'X','初始化用','full_time','full_month',30,'draft',0,NULL);
 rows:=jsonb_build_array(
 pg_temp.batch_row(code,a,'onboarding','2026-10-01')||'{"birthday":"1990-01-01","onboarding_is_pharmacist":true}'::jsonb,
 pg_temp.batch_row(code,a,'promotion','2026-10-02')||'{"position":"專員"}'::jsonb,
 pg_temp.batch_row(code,a,'acting_manager','2026-10-03')||'{"position":"代理店長"}'::jsonb,
 pg_temp.batch_row(code,a,'leave_without_pay','2026-10-04'),
 pg_temp.batch_row(code,a,'return_to_work','2026-10-05'),
 pg_temp.batch_row(code,a,'pass_probation','2026-10-06'),
 pg_temp.batch_row(code,b,'store_transfer','2026-10-07')||jsonb_build_object('from_store_id',a,'to_store_id',b),
 pg_temp.batch_row(code,b,'resignation','2026-10-08'));
 version:=workspace_movement_snapshot(rows);
 IF workspace_movement_preview(actor,rows,version)->>'valid'<>'true' OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code) OR EXISTS(SELECT 1 FROM workspace_movement_requests WHERE payload=rows) THEN RAISE EXCEPTION 'Preview wrote data or failed';END IF;
 UPDATE monthly_staff_status SET monthly_transport_expense=124 WHERE employee_code=code AND store_id=a;
 denied:=false;BEGIN PERFORM workspace_movement_save(actor,req,rows,version);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_STALE' THEN RAISE;END IF;denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale accepted';END IF;
 version:=workspace_movement_snapshot(rows);
 -- Fail on the last row after onboarding, promotion, monthly sync, transfer and receipts were written.
 EXECUTE 'ALTER TABLE employee_movement_history ADD CONSTRAINT workspace_batch_test_failure CHECK(employee_code <> '||quote_literal(code)||' OR movement_type <> ''resignation'')';
 denied:=false;BEGIN PERFORM workspace_movement_save(actor,req,rows,version);EXCEPTION WHEN OTHERS THEN IF position('workspace_batch_test_failure' IN SQLERRM)=0 THEN RAISE;END IF;denied:=true;END;
 IF NOT denied OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code) OR EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code) OR EXISTS(SELECT 1 FROM workspace_movement_requests WHERE request_id=req) OR EXISTS(SELECT 1 FROM workspace_promotion_requests WHERE payload->0->>'employee_code'=code) THEN RAISE EXCEPTION 'Partial batch survived';END IF;
 IF NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=a AND monthly_transport_expense=124 AND work_days=31 AND notes='保留手填') THEN RAISE EXCEPTION 'Monthly rollback failed';END IF;
 ALTER TABLE employee_movement_history DROP CONSTRAINT workspace_batch_test_failure;
 output:=workspace_movement_save(actor,req,rows,version);
 IF (output->>'created')::int<>8 OR (SELECT count(DISTINCT movement_type) FROM employee_movement_history WHERE employee_code=code)<>8 THEN RAISE EXCEPTION 'Eight types not written';END IF;
 IF NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=b AND is_active=false AND employment_status='resigned' AND current_position='專員' AND is_pharmacist AND birthday='1990-01-01') THEN RAISE EXCEPTION 'Master sync incorrect';END IF;
 IF NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=a AND work_days=6 AND monthly_transport_expense=124 AND notes='保留手填' AND position='專員' AND is_acting_manager AND is_pharmacist) THEN RAISE EXCEPTION 'Source monthly sync/manual fields incorrect';END IF;
 IF NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-10' AND work_days=25 AND monthly_transport_expense=456 AND notes='目的手填') OR NOT EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=code AND store_id=b AND year_month='2026-11' AND work_days=30 AND is_acting_manager) THEN RAISE EXCEPTION 'Target monthly sync incorrect';END IF;
 IF workspace_movement_save(actor,req,rows,version) IS DISTINCT FROM output OR (SELECT count(*) FROM employee_movement_history WHERE employee_code=code)<>8 THEN RAISE EXCEPTION 'Retry duplicated';END IF;
 denied:=false;BEGIN PERFORM workspace_movement_save(actor,req,jsonb_set(rows,'{0,notes}','"changed"'),version);EXCEPTION WHEN OTHERS THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Request reuse accepted';END IF;
 denied:=false;BEGIN PERFORM workspace_movement_save(actor,gen_random_uuid(),rows,workspace_movement_snapshot(rows));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DUPLICATE' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Duplicate accepted';END IF;
 -- Future return is allowed (legacy immediate master semantics), followed by future transfer in one batch.
 bad:=jsonb_build_array(pg_temp.batch_row(code,b,'return_to_work','2099-01-01'),pg_temp.batch_row(code,a,'store_transfer','2099-01-02')||jsonb_build_object('from_store_id',b,'to_store_id',a));
 PERFORM workspace_movement_save(actor,gen_random_uuid(),bad,workspace_movement_snapshot(bad));
 IF (SELECT count(*) FROM store_employees WHERE employee_code=code AND is_active)<>1 OR NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=a AND is_active) THEN RAISE EXCEPTION 'Return then transfer failed';END IF;
 -- Organization membership is part of the same transaction; no persistent fixture survives ROLLBACK.
 orgcode:=code||'O';UPDATE profiles SET employee_code=orgcode WHERE id=actor;
 INSERT INTO organization_units(id,code,name,type,status,parent_id) VALUES(hq,code||'HQ','測試總部','headquarters','active',NULL),(dept,code||'D','測試部門','department','active',hq);
 bad:=jsonb_build_array(pg_temp.batch_row(orgcode,NULL,'onboarding','2026-10-01')||jsonb_build_object('store_id','org:'||dept,'birthday','1990-01-01'));
 PERFORM workspace_movement_save(actor,gen_random_uuid(),bad,workspace_movement_snapshot(bad));
 IF NOT EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=actor AND organization_unit_id=dept AND status='active' AND is_primary) OR NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=orgcode AND store_id IS NULL AND user_id=actor) THEN RAISE EXCEPTION 'Organization sync failed';END IF;
 IF has_function_privilege('anon','workspace_movement_save(uuid,uuid,jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','workspace_movement_save(uuid,uuid,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'Public write RPC';END IF;
END;
$$;
SELECT 'PASS eight movement types, chronological chains, stale rejection, injected late failure rollback, monthly/manual preservation, idempotency, future return/transfer, organization membership, private RPC' result;
ROLLBACK;
