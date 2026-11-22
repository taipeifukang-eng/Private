-- P02 / M2 規格 D.1、D.2（DEV 專用，CREATE OR REPLACE、冪等，可重複套用）。
--  D.1 整批原子＋完全重複列自動略過：員工匯入、異動批次、批次升遷。完全重複且已存在的列略過並列在結果；其他錯誤整批不存。
--  D.2→H.1／H.7 調店確認（使用者 2026-11-06 改為任一方督導確認即成立）：原店或新店任一位督導（主責或代理）確認即生效；系統管理員可代確認並留紀錄；
--      店長不能確認；批次輸入的調店列建立為待確認申請（requested_date 記錄批次填的日期，確認時預設帶入）。確認紀錄只留一筆（side：from／to／both／admin）。
--  H.5（2026-11-06 修訂）登記調店時詢問「新任職的門市是否也擔任代理店長」，答案存在 store_transfer_requests.continue_acting；
--      確認生效時若原店仍是代理店長：選「是」就在新店自動登記代理店長異動（生效日同調店日，acting_movement_id 記下它，刪除調店時一併還原），
--      選「否」代理註記隨調店結束（acting_ended=true）。
--  既有 DEV 資料表的欄位與限制變更見 20261107100000_m2h_stage_and_transfer_confirm.sql。
--  依賴：20261106100000_w06_roster_recompute（workspace_roster_recompute）。
BEGIN;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS requested_date date;
-- H.5：調店生效時原店仍是代理店長，且答「新店不續任」（代理註記隨調店結束）。
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS acting_ended boolean NOT NULL DEFAULT false;
-- H.5：登記調店時的答案「新任職的門市是否也擔任代理店長」；確認時自動登記的新店代理異動編號。
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS continue_acting boolean NOT NULL DEFAULT false;
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS acting_movement_id uuid;
CREATE TABLE IF NOT EXISTS public.store_transfer_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES public.store_transfer_requests(id) ON DELETE CASCADE,
 side text NOT NULL CHECK(side IN('from','to','both','admin')),
 confirmed_by uuid NOT NULL,
 is_proxy boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id)
);
ALTER TABLE public.store_transfer_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_transfer_confirmations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.store_transfer_confirmations TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_employee_import_check(p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; errors jsonb:='[]'; dups jsonb:='[]'; n int:=0; msg text; sid uuid; dt date; code text; seen text[]:='{}';
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
   -- D.1：完全重複（員編、門市、姓名、職位、到職日都相同）且已存在的列自動略過並列在結果；其餘已存在的員編仍是錯誤。
   IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code) THEN
    IF EXISTS(SELECT 1 FROM store_employees WHERE upper(btrim(employee_code))=code AND store_id=sid AND employee_name=btrim(r->>'employee_name') AND coalesce(current_position,position)=r->>'position' AND start_date=dt) THEN
     dups:=dups||jsonb_build_array(jsonb_build_object('row',coalesce(r->>'row',n::text),'employee_code',code,'message','員工已存在且內容完全相同，將自動略過'));
     seen:=array_append(seen,code);CONTINUE;
    END IF;
    RAISE EXCEPTION '員編已存在，不會覆寫既有資料';
   END IF;
  EXCEPTION WHEN OTHERS THEN msg:=SQLERRM;END;
  seen:=array_append(seen,code);
  IF msg IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('row',coalesce(r->>'row',n::text),'message',msg));END IF;
 END LOOP;
 RETURN jsonb_build_object('valid',jsonb_array_length(errors)=0,'errors',errors,'duplicates',dups);
END;$$;

CREATE OR REPLACE FUNCTION public.workspace_employee_import_save(p_actor uuid,p_request uuid,p_rows jsonb,p_visible uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cached workspace_employee_import_receipts; checked jsonb; result jsonb; r jsonb; total int:=0; skipped jsonb:='[]';
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
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(checked->'duplicates') d WHERE d->>'row'=coalesce(r->>'row','')) THEN skipped:=skipped||jsonb_build_array(jsonb_build_object('row',r->>'row','employee_code',r->>'employee_code'));CONTINUE;END IF;
  INSERT INTO store_employees(store_id,employee_code,employee_name,position,current_position,start_date,employment_type,is_active,employment_status)
  VALUES((r->>'store_id')::uuid,r->>'employee_code',r->>'employee_name',r->>'position',r->>'position',(r->>'start_date')::date,workspace_employee_id_type(r->>'employee_code'),true,'active');
  total:=total+1;
 END LOOP;
 result:=jsonb_build_object('success',true,'imported',total,'skipped',skipped,'requestId',p_request);
 INSERT INTO workspace_employee_import_receipts(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,result);
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.workspace_movement_save(p_actor uuid, p_request uuid, p_rows jsonb, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE cached workspace_movement_requests%rowtype; item jsonb; entry record; emp store_employees%rowtype;
 req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 unit organization_units%rowtype; uid uuid; sid uuid; orgid uuid; mid uuid; ids jsonb:='[]'; output jsonb;
 code text; kind text; dt date; oldval text; newval text; note text; rowno integer;
 skipped jsonb:='[]'; xfer integer:=0; from_sid uuid; to_sid uuid; from_name text;to_name text;ym text;effective_month text;d integer;total integer;month_day text;p_date date;is_latest boolean;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- The API checks RBAC; RPC is service-only. Do not permit a nonexistent audit actor.
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status,organization_units,profiles,organization_memberships IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_movement_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF p_expected IS NULL OR workspace_movement_snapshot(p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
 FOR entry IN SELECT value,ordinality FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',ordinality LOOP
  item:=entry.value;rowno:=entry.ordinality;
  BEGIN
   code:=item->>'employee_code';kind:=item->>'movement_type';dt:=(item->>'effective_date')::date;
   IF code IS NULL OR code !~ '^[A-Z0-9_-]{1,20}$' OR code LIKE 'EXAMPLE-%' OR coalesce(item->>'employee_name','')='' OR dt IS NULL OR dt<'1912-01-01' OR kind NOT IN('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   orgid:=CASE WHEN left(item->>'store_id',4)='org:' THEN substring(item->>'store_id' FROM 5)::uuid END;
   sid:=CASE WHEN orgid IS NULL THEN (item->>'store_id')::uuid END;
   IF orgid IS NOT NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   IF orgid IS NULL AND NOT EXISTS(SELECT 1 FROM stores WHERE id=sid AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
   -- 同一天不可同時有留停與復職（狀態與天數會互相矛盾）。
   IF kind IN('leave_without_pay','return_to_work') AND EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_date=dt AND h.movement_type=CASE WHEN kind='leave_without_pay' THEN 'return_to_work' ELSE 'leave_without_pay' END) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_date=dt AND
    CASE WHEN h.movement_type='promotion' AND h.new_value='代理店長' THEN 'acting_manager' ELSE h.movement_type END=kind AND
    (kind<>'promotion' OR (h.new_value=item->>'position' AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(item->>'newbie_level','')))) THEN
    -- D.1：完全重複且已存在的列自動略過，列在結果；其他錯誤整批不存。
    skipped:=skipped||jsonb_build_array(jsonb_build_object('row',rowno,'employee_code',code,'movement_type',kind,'effective_date',dt,'message','已有相同員工、日期及內容的異動紀錄，將自動略過'));CONTINUE;
   END IF;
   IF kind='store_transfer' THEN
    -- D.2：批次輸入的調店列只建立「待確認」調店申請，要原店與新店督導都確認才生效（生效時才寫異動與回寫名冊）。
    from_sid:=(item->>'from_store_id')::uuid;to_sid:=(item->>'to_store_id')::uuid;
    IF from_sid IS NULL OR to_sid IS NULL OR from_sid=to_sid THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
    SELECT store_name INTO from_name FROM stores WHERE id=from_sid AND is_active=true;
    SELECT store_name INTO to_name FROM stores WHERE id=to_sid AND is_active=true;
    IF from_name IS NULL OR to_name IS NULL THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=code AND movement_type='store_transfer' AND movement_date=dt)
     OR EXISTS(SELECT 1 FROM store_transfer_requests WHERE employee_code=code AND status='pending' AND from_store_id=from_sid AND to_store_id=to_sid) THEN
     skipped:=skipped||jsonb_build_array(jsonb_build_object('row',rowno,'employee_code',code,'movement_type',kind,'effective_date',dt,'message','已有相同的調店紀錄或待確認申請，將自動略過'));CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND store_id=from_sid)
     OR EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND employee_name IS DISTINCT FROM item->>'employee_name') THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    -- H.5：批次逐列可勾「新店續任代理」（預設不勾）；只有該員目前確實是代理店長才會記下。
    INSERT INTO store_transfer_requests(employee_code,employee_name,from_store_id,to_store_id,status,notes,created_by,requested_date,continue_acting)
    VALUES(code,item->>'employee_name',from_sid,to_sid,'pending',nullif(item->>'notes',''),p_actor,dt,coalesce((item->>'continue_acting')::boolean,false) AND workspace_acting_active(code,from_sid,dt)) RETURNING id INTO mid;
    xfer:=xfer+1;

   ELSE
    IF (SELECT count(*) FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    SELECT * INTO emp FROM store_employees WHERE employee_code=code AND store_id IS NOT DISTINCT FROM sid;
    IF kind='return_to_work' AND emp.id IS NULL AND sid IS NOT NULL THEN
     -- 復職不一定回原店：在指定門市建立主檔列，原店列（留停中）停用。
     SELECT * INTO source FROM store_employees WHERE employee_code=code ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
     IF FOUND AND source.employee_name IS NOT DISTINCT FROM item->>'employee_name' THEN
      INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,start_date,birthday,employment_status,last_promotion_date,last_movement_date,last_movement_type)
      VALUES(sid,source.user_id,code,source.employee_name,source.position,source.current_position,source.employment_type,source.is_pharmacist,false,source.start_date,source.birthday,'leave_without_pay',source.last_promotion_date,source.last_movement_date,source.last_movement_type);
      SELECT * INTO emp FROM store_employees WHERE employee_code=code AND store_id=sid;
     END IF;
    END IF;
    IF emp.id IS NULL AND kind<>'onboarding' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND employee_name IS DISTINCT FROM item->>'employee_name') THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
    IF kind='onboarding' AND EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND is_active AND store_id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'WORKSPACE_OTHER_STORE'; END IF;
    IF kind='return_to_work' AND EXISTS(SELECT 1 FROM store_employees WHERE employee_code=code AND is_active AND employment_status IS DISTINCT FROM 'leave_without_pay' AND store_id IS DISTINCT FROM sid) THEN RAISE EXCEPTION 'WORKSPACE_OTHER_STORE'; END IF;
    IF kind='promotion' THEN
     output:=workspace_promotion_save(p_actor,gen_random_uuid(),sid,jsonb_build_array(item),workspace_promotion_snapshot(sid,jsonb_build_array(item)));
     mid:=(output->'ids'->>0)::uuid;
    ELSE
     oldval:=coalesce(emp.employment_status,'active');newval:=oldval;note:=nullif(item->>'notes','');uid:=NULL;
     IF kind='onboarding' THEN
      IF nullif(item->>'birthday','') IS NULL OR (item->>'birthday')::date>dt OR jsonb_typeof(item->'onboarding_is_pharmacist') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
      newval:='active';oldval:=NULL;
      note:=concat_ws('；',note,'是否藥師:'||CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '是' ELSE '否' END);
      IF orgid IS NOT NULL THEN
       SELECT * INTO unit FROM organization_units WHERE id=orgid AND status='active' AND type<>'company';
       IF NOT FOUND OR EXISTS(SELECT 1 FROM organization_units WHERE parent_id=orgid AND status='active') THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id,status,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.status,a.path||u.id FROM organization_units u JOIN ancestors a ON u.id=a.parent_id WHERE NOT u.id=ANY(a.path)) SELECT 1 FROM ancestors WHERE status<>'active' OR (parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units WHERE id=ancestors.parent_id))) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE parent_id IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF EXISTS(SELECT 1 FROM organization_units WHERE type='headquarters' AND status='active') AND NOT EXISTS(WITH RECURSIVE chain AS (SELECT id,parent_id,type,ARRAY[id] path FROM organization_units WHERE id=orgid UNION ALL SELECT u.id,u.parent_id,u.type,c.path||u.id FROM organization_units u JOIN chain c ON u.id=c.parent_id WHERE NOT u.id=ANY(c.path)) SELECT 1 FROM chain WHERE type='headquarters' AND id<>orgid) THEN RAISE EXCEPTION 'WORKSPACE_ORGANIZATION'; END IF;
       IF (SELECT count(*) FROM profiles WHERE employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_ORG_PROFILE'; END IF;
       SELECT id INTO uid FROM profiles WHERE employee_code=code;
       newval:=unit.code||' '||unit.name;note:=concat_ws('；',note,'任職組織:'||newval);
       UPDATE organization_memberships SET status='inactive',effective_to=dt,is_primary=false,updated_by=p_actor,updated_at=now() WHERE user_id=uid AND membership_type='primary_department' AND status='active' AND effective_to IS NULL;
       IF EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department') THEN
        UPDATE organization_memberships SET status='active',effective_from=dt,effective_to=NULL,is_primary=true,membership_role='member',updated_by=p_actor,updated_at=now() WHERE user_id=uid AND organization_unit_id=orgid AND membership_type='primary_department';
       ELSE
        INSERT INTO organization_memberships(organization_unit_id,user_id,membership_role,membership_type,effective_from,status,is_primary,created_by,updated_by) VALUES(orgid,uid,'member','primary_department',dt,'active',true,p_actor,p_actor);
       END IF;
      END IF;
      IF emp.id IS NULL THEN
       INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,employment_type,is_pharmacist,is_active,employment_status,start_date,birthday,last_movement_date,last_movement_type)
       VALUES(sid,uid,code,item->>'employee_name',CASE WHEN code LIKE 'FKPT%' THEN CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END,CASE WHEN code LIKE 'FKPT%' THEN CASE WHEN (item->>'onboarding_is_pharmacist')::boolean THEN '兼職藥師' ELSE '兼職助理' END ELSE '新人' END,CASE WHEN code LIKE 'FKPT%' THEN 'part_time' ELSE 'full_time' END,(item->>'onboarding_is_pharmacist')::boolean,true,'active',dt,(item->>'birthday')::date,dt,kind);
      ELSE
       UPDATE store_employees SET is_active=true,employment_status='active',start_date=dt,birthday=(item->>'birthday')::date,is_pharmacist=(item->>'onboarding_is_pharmacist')::boolean,last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
      END IF;
     ELSIF kind='acting_manager' THEN
      oldval:=nullif(coalesce(emp.current_position,emp.position),'代理店長');newval:='代理店長';
     ELSIF kind='pass_probation' THEN
      oldval:=coalesce(emp.current_position,emp.position);newval:=coalesce(oldval,'過試用期');
     ELSE
      newval:=CASE kind WHEN 'leave_without_pay' THEN 'leave_without_pay' WHEN 'resignation' THEN 'resigned' ELSE 'active' END;
      UPDATE store_employees SET employment_status=newval,is_active=(newval<>'resigned') WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt);
      IF kind='return_to_work' THEN UPDATE store_employees SET is_active=false,employment_status='resigned' WHERE employee_code=code AND id<>emp.id AND is_active AND (last_movement_date IS NULL OR last_movement_date<=dt); END IF;
     END IF;
     IF kind<>'onboarding' THEN UPDATE store_employees SET last_movement_date=dt,last_movement_type=kind WHERE id=emp.id AND (last_movement_date IS NULL OR last_movement_date<=dt); END IF;
     INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,onboarding_is_pharmacist,created_at)
     VALUES(code,item->>'employee_name',sid,kind,dt,oldval,newval,note,p_actor,CASE WHEN kind='onboarding' THEN (item->>'onboarding_is_pharmacist')::boolean END,clock_timestamp()) RETURNING id INTO mid;
     PERFORM workspace_roster_recompute(p_actor,code,to_char(dt,'YYYY-MM'),NULL,NULL,true,false,kind,mid::text,
      CASE kind WHEN 'onboarding' THEN '入職' WHEN 'acting_manager' THEN '代理' WHEN 'leave_without_pay' THEN '留職停薪' WHEN 'return_to_work' THEN '復職' WHEN 'pass_probation' THEN '過試用期' WHEN 'resignation' THEN '離職' ELSE kind END||'（'||dt||'）');
     IF kind IN('acting_manager','pass_probation') THEN PERFORM workspace_employee_master_position_sync(code); END IF;
    END IF;
   END IF;
   ids:=ids||jsonb_build_array(jsonb_build_object('row',rowno,'id',mid,'pending_transfer_request',kind='store_transfer'));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING MESSAGE=SQLERRM,DETAIL='row='||rowno; END;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'records',ids,'requestId',p_request,'skipped',skipped,'transferRequests',xfer);
 INSERT INTO workspace_movement_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,p_rows,output);
 RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_movement_preview(p_actor uuid,p_rows jsonb,p_expected text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE detail text; saved jsonb;
BEGIN
 BEGIN
  saved:=workspace_movement_save(p_actor,gen_random_uuid(),p_rows,p_expected);
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='preview rollback';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('valid',true,'skipped',coalesce(saved->'skipped','[]'::jsonb),'transferRequests',coalesce((saved->>'transferRequests')::int,0));
 WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  RETURN jsonb_build_object('valid',false,'problem',SQLERRM,'row',coalesce(substring(detail FROM 'row=(\d+)')::integer,1));
 END;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_promotion_save(p_actor uuid, p_request uuid, p_store uuid, p_rows jsonb, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE cached workspace_promotion_requests%rowtype; item jsonb; emp store_employees%rowtype;
 code text; start_month text; start_date date; previous_position text; level text; position_row record;
 ids jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb; inserted text[]:='{}'; new_id uuid; output jsonb; monthly_count integer:=0; changed integer;
 today date:=(now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- Lock before checking both the receipt and snapshot. Legacy writers also take row-exclusive table locks.
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_promotion_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cached.actor_id<>p_actor OR cached.store_id<>p_store OR cached.payload IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cached.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM stores WHERE id=p_store AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
 IF workspace_promotion_snapshot(p_store,p_rows) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'employee_code',r->>'effective_date',r->>'position',r->>'newbie_level' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) WITH ORDINALITY ORDER BY value->>'effective_date',CASE value->>'newbie_level' WHEN '二階新人' THEN 2 WHEN '一階新人' THEN 1 ELSE 0 END,ordinality LOOP
  code:=item->>'employee_code';level:=nullif(item->>'newbie_level','');
  IF coalesce(code,'')='' OR code<>upper(btrim(code)) OR length(code)>20 OR coalesce(item->>'employee_name','')='' OR
     coalesce(item->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' OR (item->>'effective_date')::date<'1912-01-01'::date OR
     coalesce(item->>'position','') NOT IN ('總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理','代理店長') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF item->>'position'='新人' AND coalesce(level,'') NOT IN ('未過階新人','一階新人','二階新人') OR item->>'position'='行政' AND coalesce(level,'') NOT IN ('未過階行政','過階行政') THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  IF (SELECT count(*) FROM store_employees WHERE store_id=p_store AND employee_code=code)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  SELECT * INTO emp FROM store_employees WHERE store_id=p_store AND employee_code=code;
  IF emp.employee_name IS DISTINCT FROM item->>'employee_name' THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE'; END IF;
  IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.movement_date=(item->>'effective_date')::date AND h.new_value=item->>'position'
    AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(level,'')) THEN
   skipped:=skipped||jsonb_build_array(jsonb_build_object('employee_code',code,'effective_date',item->>'effective_date','position',item->>'position','message','已有相同員工、日期及職位的升遷紀錄，將自動略過'));CONTINUE;
  END IF;
  -- The previous official position follows chronology, never an acting appointment.
  SELECT h.new_value INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=(item->>'effective_date')::date
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF previous_position IS NULL THEN
   SELECT m.position INTO previous_position FROM monthly_staff_status m WHERE m.employee_code=code AND m.year_month<left(item->>'effective_date',7) AND m.position<>'代理店長' ORDER BY m.year_month DESC,m.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN
   SELECT nullif(h.old_value,'代理店長') INTO previous_position FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date>(item->>'effective_date')::date ORDER BY h.movement_date,h.created_at,h.id LIMIT 1;
  END IF;
  IF previous_position IS NULL THEN previous_position:=nullif(coalesce(emp.current_position,emp.position),'代理店長'); END IF;
  INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,created_at)
   VALUES(code,item->>'employee_name',p_store,'promotion',(item->>'effective_date')::date,previous_position,item->>'position',nullif(concat_ws('；',nullif(item->>'notes',''),CASE WHEN item->>'position'='新人' THEN '新人等級:'||level WHEN item->>'position'='行政' THEN '行政階級:'||level END),''),p_actor,clock_timestamp()) RETURNING id INTO new_id;
  ids:=ids||jsonb_build_array(new_id);inserted:=array_append(inserted,code);
 END LOOP;
 -- A.1／A.6／B.2：名冊依異動重算（已送審／已確認月份不動，記入需重新確認）；B.3：員工主檔職位同步為最新有效升職。
 FOR code,start_month,start_date IN SELECT value->>'employee_code',min(left(value->>'effective_date',7)),min((value->>'effective_date')::date) FROM jsonb_array_elements(p_rows) GROUP BY value->>'employee_code' LOOP
  IF NOT code=ANY(inserted) THEN CONTINUE; END IF;
  output:=workspace_roster_recompute(p_actor,code,start_month,NULL,NULL,true,false,'promotion',ids->>0,'升職（'||start_date||'）');
  monthly_count:=monthly_count+(output->>'updated')::int+(output->>'created')::int;
  PERFORM workspace_employee_master_position_sync(code);
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'ids',ids,'monthlyUpdated',monthly_count,'skipped',skipped);
 INSERT INTO workspace_promotion_requests(request_id,actor_id,store_id,payload,result) VALUES(p_request,p_actor,p_store,p_rows,output);
 RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_transfer_snapshot(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object(
 'request',to_jsonb(r),
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stores s WHERE s.id IN(r.from_store_id,r.to_store_id)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM store_employees e WHERE e.employee_code=r.employee_code),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM employee_movement_history h WHERE h.employee_code=r.employee_code),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM monthly_staff_status m WHERE m.employee_code=r.employee_code AND m.store_id IN(r.from_store_id,r.to_store_id)),
 'confirmations',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.side) FROM store_transfer_confirmations k WHERE k.request_id=r.id),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.store_id,x.year_month,x.status) FROM (SELECT DISTINCT store_id,year_month,status FROM monthly_staff_status WHERE store_id IN(r.from_store_id,r.to_store_id))x)
 )::text) FROM store_transfer_requests r WHERE r.id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.workspace_transfer_confirm(p_actor uuid, p_id uuid, p_date date, p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE req store_transfer_requests%rowtype; source store_employees%rowtype; target store_employees%rowtype;
 sup_from boolean; sup_to boolean; conf_side text; from_name text;to_name text;mid uuid;effective_month text;is_admin boolean;is_latest boolean;was_acting boolean;keep_acting boolean;acting_id uuid;cur_pos text;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR (p_date IS NOT NULL AND p_date<'1912-01-01'::date) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;

 SELECT role='admin' INTO is_admin FROM profiles WHERE id=p_actor;
 IF NOT coalesce(is_admin,false) AND NOT EXISTS(
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
  WHERE ur.user_id=p_actor AND ur.is_active=true AND (ur.expires_at IS NULL OR ur.expires_at>now()) AND r.is_active=true
  AND (r.code IN('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
   OR EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND rp.is_allowed=true AND p.is_active=true AND p.code='employee.store_transfer.confirm'))
 ) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 -- Same ordering as employee and promotion transactions; serialize duplicate checks and monthly initialization.
 LOCK TABLE store_employees,employee_movement_history,monthly_staff_status,store_transfer_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO req FROM store_transfer_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 IF req.status='confirmed' AND req.confirmed_by=p_actor AND req.effective_date=p_date AND req.movement_history_id IS NOT NULL THEN
  RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',req.movement_history_id,'alreadyConfirmed',true,'actingEnded',coalesce(req.acting_ended,false),'actingContinued',req.acting_movement_id IS NOT NULL);
 END IF;
 IF req.status<>'pending' THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 -- H.1／H.7：原店或新店任一位督導（role_type=supervisor，主責或代理）確認即成立；系統管理員可代確認並留下紀錄；店長與其他人不能確認。
 sup_from:=EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND role_type='supervisor' AND store_id=req.from_store_id);
 sup_to:=EXISTS(SELECT 1 FROM store_managers WHERE user_id=p_actor AND role_type='supervisor' AND store_id=req.to_store_id);
 IF NOT sup_from AND NOT sup_to AND NOT coalesce(is_admin,false) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 conf_side:=CASE WHEN sup_from AND sup_to THEN 'both' WHEN sup_from THEN 'from' WHEN sup_to THEN 'to' ELSE 'admin' END;
 IF p_date IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'WORKSPACE_DATE_REQUIRED'; END IF;
 PERFORM id FROM stores WHERE id IN(req.from_store_id,req.to_store_id) ORDER BY id FOR SHARE;
 IF p_version IS DISTINCT FROM workspace_transfer_snapshot(p_id) THEN RAISE EXCEPTION 'WORKSPACE_STALE'; END IF;
 IF req.from_store_id=req.to_store_id THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 SELECT store_name INTO from_name FROM stores WHERE id=req.from_store_id AND is_active=true;
 SELECT store_name INTO to_name FROM stores WHERE id=req.to_store_id AND is_active=true;
 IF from_name IS NULL OR to_name IS NULL THEN RAISE EXCEPTION 'WORKSPACE_STORE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_type='store_transfer' AND movement_date=p_date) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 -- B.1：補登過去的調店只寫歷史；員工目前狀態以最新一筆為準，月份名冊依生效日重新計算。
 is_latest:=NOT EXISTS(SELECT 1 FROM employee_movement_history WHERE employee_code=req.employee_code AND movement_date>p_date)
  AND NOT EXISTS(SELECT 1 FROM store_employees WHERE employee_code=req.employee_code AND last_movement_date>p_date);
 IF is_latest AND (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND is_active=true)<>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO source FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.from_store_id AND is_active=true;
 IF is_latest AND (NOT FOUND OR source.employee_name IS DISTINCT FROM req.employee_name) THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 IF (SELECT count(*) FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id)>1 THEN RAISE EXCEPTION 'WORKSPACE_EMPLOYEE_CHANGED'; END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=req.employee_code AND store_id=req.to_store_id;
 effective_month:=to_char(p_date,'YYYY-MM');
 -- A.2：已送審／已確認月份不動，改記到需重新確認清單（由 workspace_roster_recompute 處理）。
 IF EXISTS(SELECT 1 FROM monthly_staff_status WHERE employee_code=req.employee_code AND store_id IN(req.from_store_id,req.to_store_id) AND year_month>=effective_month GROUP BY store_id,year_month HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_MONTH_DUPLICATE'; END IF;
 -- H.5：調店生效時，原店仍是代理店長者代理註記隨調店結束（由 workspace_roster_recompute 依異動不再標代理）；
 -- 申請上答了「新店續任代理」者，確認後在新店自動登記代理店長異動（生效日同調店日）。
 was_acting:=workspace_acting_active(req.employee_code,req.from_store_id,p_date);
 keep_acting:=was_acting AND coalesce(req.continue_acting,false);
 -- H.1：確認紀錄只留一筆（由哪一方、哪位督導確認，或管理員代確認）；舊版（雙方確認）留下的單側紀錄一併取代。
 DELETE FROM store_transfer_confirmations WHERE request_id=p_id;
 INSERT INTO store_transfer_confirmations(request_id,side,confirmed_by,is_proxy) VALUES(p_id,conf_side,p_actor,conf_side='admin');
 INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by)
 VALUES(req.employee_code,req.employee_name,req.to_store_id,'store_transfer',p_date,from_name,to_name,req.notes,p_actor) RETURNING id INTO mid;
 IF is_latest THEN
 UPDATE store_employees SET is_active=false,employment_status='resigned',last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=source.id;
 IF target.id IS NULL THEN
  INSERT INTO store_employees(store_id,user_id,employee_code,employee_name,position,current_position,newbie_level,employment_type,is_pharmacist,is_active,start_date,birthday,employment_status,last_promotion_date,last_movement_date,last_movement_type)
  VALUES(req.to_store_id,source.user_id,req.employee_code,req.employee_name,source.position,source.current_position,source.newbie_level,source.employment_type,source.is_pharmacist,true,source.start_date,source.birthday,source.employment_status,source.last_promotion_date,p_date,'store_transfer');
 ELSE
  UPDATE store_employees SET user_id=source.user_id,employee_name=req.employee_name,position=source.position,current_position=source.current_position,newbie_level=source.newbie_level,employment_type=source.employment_type,is_pharmacist=source.is_pharmacist,is_active=true,start_date=source.start_date,birthday=source.birthday,employment_status=source.employment_status,last_promotion_date=source.last_promotion_date,last_movement_date=p_date,last_movement_type='store_transfer' WHERE id=target.id;
 END IF;
 END IF;

 IF keep_acting THEN
  -- 異動歷史以 created_at 排序：新店代理要排在調店之後，才不會被同日的調店結束。
  UPDATE employee_movement_history SET created_at=clock_timestamp() WHERE id=mid;
  SELECT coalesce(current_position,position) INTO cur_pos FROM store_employees WHERE employee_code=req.employee_code ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
  INSERT INTO employee_movement_history(employee_code,employee_name,store_id,movement_type,movement_date,old_value,new_value,notes,created_by,created_at)
  VALUES(req.employee_code,req.employee_name,req.to_store_id,'acting_manager',p_date,nullif(cur_pos,'代理店長'),'代理店長','調店時續任代理店長（隨調店申請自動登記）',p_actor,clock_timestamp()+interval '1 millisecond') RETURNING id INTO acting_id;
 END IF;
 PERFORM workspace_roster_recompute(p_actor,req.employee_code,effective_month,NULL,NULL,true,false,'store_transfer',mid::text,'調店（'||p_date||'）');
 UPDATE store_transfer_requests SET status='confirmed',confirmed_by=p_actor,confirmed_at=now(),effective_date=p_date,movement_history_id=mid,acting_ended=(was_acting AND NOT keep_acting),acting_movement_id=acting_id WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'status','confirmed','movement_history_id',mid,'side',conf_side,'actingEnded',(was_acting AND NOT keep_acting),'actingContinued',keep_acting,'employee_code',req.employee_code,'to_store_id',req.to_store_id,'effective_date',p_date);
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_check(jsonb,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_employee_import_save(uuid,uuid,jsonb,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_save(uuid,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_preview(uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_transfer_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_snapshot(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_confirm(uuid,uuid,date,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
