BEGIN;
DO $$
DECLARE actor uuid; dep uuid; other_dep uuid; category uuid; item uuid; receipt uuid:=gen_random_uuid(); body jsonb; result jsonb; version text; assignment_id uuid;
BEGIN
 SELECT id INTO actor FROM profiles ORDER BY id LIMIT 1;
 INSERT INTO organization_units(code,name,type) VALUES('VDWORK-'||upper(left(receipt::text,8)),'職掌交易驗證','department') RETURNING id INTO dep;
 INSERT INTO organization_units(code,name,type) VALUES('VDWORK2-'||upper(left(receipt::text,8)),'其他部門驗證','department') RETURNING id INTO other_dep;
 body:=jsonb_build_object('organization_unit_id',dep,'title','工作職掌驗證','category_name','測試分類','work_type','fixed','importance','important','status','active','assignments',jsonb_build_array(jsonb_build_object('user_id',actor,'assignment_type','PRIMARY')));
 version:=workspace_department_version(dep);result:=workspace_department_save(actor,receipt,body,version);item:=(result->>'id')::uuid;
 IF workspace_department_save(actor,receipt,body,version) IS DISTINCT FROM result THEN RAISE EXCEPTION 'idempotency failure'; END IF;
 SELECT id INTO assignment_id FROM work_assignments WHERE work_item_id=item AND status='active';
 body:=body||jsonb_build_object('id',item,'title','修改職掌內容');
 PERFORM workspace_department_save(actor,gen_random_uuid(),body,workspace_department_version(dep));
 IF NOT EXISTS(SELECT 1 FROM work_assignments WHERE id=assignment_id AND status='active' AND effective_to IS NULL) THEN RAISE EXCEPTION 'retained assignment recreated'; END IF;
 BEGIN
  PERFORM workspace_department_save(actor,gen_random_uuid(),body,version);
  RAISE EXCEPTION 'stale version accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CONFLICT' THEN RAISE; END IF; END;
 INSERT INTO work_categories(organization_unit_id,name) VALUES(other_dep,'其他部門分類') RETURNING id INTO category;
 version:=workspace_department_version(dep);
 BEGIN
  PERFORM workspace_department_save(actor,gen_random_uuid(),body||jsonb_build_object('category_id',category),version);
  RAISE EXCEPTION 'cross-department category accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CATEGORY' THEN RAISE; END IF; END;
 IF workspace_department_version(dep)<>version THEN RAISE EXCEPTION 'failed operation changed data'; END IF;
 -- Force a late insert failure after category/item changes; the entire save must roll back.
 EXECUTE 'CREATE FUNCTION pg_temp.fail_work_assignment() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION ''TEST_LATE_FAILURE''; END $fn$';
 EXECUTE 'CREATE TRIGGER test_fail_work_assignment BEFORE INSERT ON work_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_work_assignment()';
 BEGIN
  PERFORM workspace_department_save(actor,gen_random_uuid(),body||jsonb_build_object('category_name','不應留下的分類','assignments',jsonb_build_array(jsonb_build_object('user_id',actor,'assignment_type','BACKUP'))),version);
  RAISE EXCEPTION 'injected failure ignored';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TEST_LATE_FAILURE' THEN RAISE; END IF; END;
 IF workspace_department_version(dep)<>version THEN RAISE EXCEPTION 'late failure not atomic'; END IF;
 DROP TRIGGER test_fail_work_assignment ON work_assignments;
 PERFORM workspace_department_save(actor,gen_random_uuid(),body||jsonb_build_object('assignments',jsonb_build_array(jsonb_build_object('user_id',actor,'assignment_type','BACKUP'))),version);
 IF NOT EXISTS(SELECT 1 FROM work_assignments WHERE id=assignment_id AND status='inactive' AND effective_to IS NOT NULL) THEN RAISE EXCEPTION 'history lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM work_assignments WHERE work_item_id=item AND assignment_type='BACKUP' AND status='active') THEN RAISE EXCEPTION 'backup assignment missing'; END IF;
 UPDATE organization_units SET status='inactive' WHERE id=dep;
 BEGIN
  PERFORM workspace_department_save(actor,gen_random_uuid(),body,workspace_department_version(dep));
  RAISE EXCEPTION 'inactive department accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_DEPARTMENT' THEN RAISE; END IF; END;
 IF workspace_department_catalog(dep)->>'version' IS DISTINCT FROM workspace_department_version(dep) THEN RAISE EXCEPTION 'snapshot mismatch'; END IF;
 IF has_function_privilege('authenticated','workspace_department_save(uuid,uuid,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'direct mutation exposed'; END IF;
END $$;
ROLLBACK;
SELECT 'department work transaction, retained assignments, history, rollback, scope and idempotency passed' AS result;
