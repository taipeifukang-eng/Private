BEGIN;
DO $$
DECLARE actor uuid; a uuid; b uuid; c uuid; receipt uuid:=gen_random_uuid(); snapshot text; result jsonb; payload jsonb;
BEGIN
 SELECT id INTO actor FROM profiles ORDER BY id LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'test requires existing DEV actor'; END IF;
 snapshot:=workspace_organization_snapshot();
 payload:=jsonb_build_object('code','VORG-'||upper(left(receipt::text,8)),'name','組織交易測試','type','company','parent_id',NULL,'status','active','sort_order',0);
 result:=workspace_organization_save(actor,receipt,'create',payload,snapshot); a:=(result->>'id')::uuid;
 IF workspace_organization_save(actor,receipt,'create',payload,snapshot) IS DISTINCT FROM result THEN RAISE EXCEPTION 'idempotency failed'; END IF;
 BEGIN
  PERFORM workspace_organization_save(actor,receipt,'create',payload||'{"name":"changed"}',snapshot);
  RAISE EXCEPTION 'reused request accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_REQUEST_REUSED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM workspace_organization_save(actor,gen_random_uuid(),'create',payload,snapshot);
  RAISE EXCEPTION 'stale write accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_CONFLICT' THEN RAISE; END IF; END;
 INSERT INTO organization_units(code,name,type,parent_id) VALUES('VORGB-'||upper(left(receipt::text,8)),'測試部門 B','department',a) RETURNING id INTO b;
 INSERT INTO organization_units(code,name,type,parent_id) VALUES('VORGC-'||upper(left(receipt::text,8)),'測試部門 C','department',b) RETURNING id INTO c;
 -- Valid inversion must work atomically despite the old graph B -> C.
 PERFORM workspace_organization_save(actor,gen_random_uuid(),'hierarchy',jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('id',b,'parent_id',c,'sort_order',1),jsonb_build_object('id',c,'parent_id',a,'sort_order',2))),workspace_organization_snapshot());
 IF (SELECT parent_id FROM organization_units WHERE id=b)<>c THEN RAISE EXCEPTION 'inversion failed'; END IF;
 snapshot:=workspace_organization_snapshot();
 BEGIN
  PERFORM workspace_organization_save(actor,gen_random_uuid(),'hierarchy',jsonb_build_object('updates',jsonb_build_array(jsonb_build_object('id',c,'parent_id',b,'sort_order',1))),snapshot);
  RAISE EXCEPTION 'cycle accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%cycle%' THEN RAISE; END IF; END;
 IF workspace_organization_snapshot()<>snapshot THEN RAISE EXCEPTION 'cycle rollback failed'; END IF;
 -- All membership and profile changes below are rolled back with the test.
 UPDATE organization_memberships SET status='inactive',effective_to=greatest(effective_from,current_date) WHERE user_id=actor AND status='active' AND effective_to IS NULL;
 PERFORM workspace_organization_save(actor,gen_random_uuid(),'members',jsonb_build_object('id',b,'user_ids',jsonb_build_array(actor)),workspace_organization_snapshot());
 UPDATE organization_units SET name='測試部門更名' WHERE id=b;
 IF (SELECT department FROM profiles WHERE id=actor) IS DISTINCT FROM '測試部門更名' THEN RAISE EXCEPTION 'department rename profile sync failed'; END IF;
 UPDATE organization_units SET status='inactive' WHERE id=b;
 IF (SELECT department FROM profiles WHERE id=actor) IS NOT NULL THEN RAISE EXCEPTION 'inactive department profile sync failed'; END IF;
 UPDATE organization_units SET status='active' WHERE id=b;
 IF (SELECT department FROM profiles WHERE id=actor) IS DISTINCT FROM '測試部門更名' THEN RAISE EXCEPTION 'reactivated department profile sync failed'; END IF;
 snapshot:=workspace_organization_snapshot();
 BEGIN
  PERFORM workspace_organization_save(actor,gen_random_uuid(),'members',jsonb_build_object('id',c,'user_ids',jsonb_build_array(actor)),snapshot);
  RAISE EXCEPTION 'primary conflict accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'WORKSPACE_PRIMARY_CONFLICT' THEN RAISE; END IF; END;
 IF workspace_organization_snapshot()<>snapshot THEN RAISE EXCEPTION 'membership rollback failed'; END IF;
 PERFORM workspace_organization_save(actor,gen_random_uuid(),'members',jsonb_build_object('id',b,'user_ids','[]'::jsonb),snapshot);
 IF NOT EXISTS(SELECT 1 FROM organization_memberships WHERE organization_unit_id=b AND user_id=actor AND status='inactive' AND effective_to IS NOT NULL) THEN RAISE EXCEPTION 'membership history lost'; END IF;
 PERFORM workspace_organization_save(actor,gen_random_uuid(),'managers',jsonb_build_object('id',b,'assignments',jsonb_build_array(jsonb_build_object('user_id',actor,'manager_role','manager','is_primary',true))),workspace_organization_snapshot());
 PERFORM workspace_organization_save(actor,gen_random_uuid(),'managers',jsonb_build_object('id',b,'assignments',jsonb_build_array(jsonb_build_object('user_id',actor,'manager_role','acting_manager','is_primary',true))),workspace_organization_snapshot());
 IF NOT EXISTS(SELECT 1 FROM organization_manager_assignments WHERE organization_unit_id=b AND manager_role='manager' AND status='inactive') THEN RAISE EXCEPTION 'manager history lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_manager_assignments WHERE organization_unit_id=b AND manager_role='acting_manager' AND status='active') THEN RAISE EXCEPTION 'manager change failed'; END IF;
 IF (workspace_organization_catalog()->>'version')<>workspace_organization_snapshot() THEN RAISE EXCEPTION 'catalog snapshot mismatch'; END IF;
 IF has_function_privilege('authenticated','public.workspace_organization_save(uuid,uuid,text,jsonb,text)','EXECUTE') OR has_table_privilege('anon','public.organization_units','INSERT') THEN RAISE EXCEPTION 'direct write exposure'; END IF;
END $$;
ROLLBACK;
SELECT 'organization transaction, history, idempotency, conflict and access tests passed' AS result;

