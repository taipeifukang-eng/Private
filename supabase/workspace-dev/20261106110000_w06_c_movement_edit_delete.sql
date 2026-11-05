-- W06 / M2 規格 C 組：修改與刪除歷史異動（DEV 專用，CREATE OR REPLACE，可重複套用）。
--   C.1 只能刪除該員工最新一筆異動；刪除後依剩餘異動恢復員工主檔狀態、門市、職位，並呼叫 workspace_roster_recompute
--       讓受影響月份名冊恢復（A.1 範圍、A.2 已送審月份只記需重新確認）。修改範圍照舊版：姓名、日期、備註、
--       升職職位與階段、入職藥師身分；不開放改類型與門市；修改後同樣呼叫重算。
--   C.2 權限由 API 檢查，這裡的函式只給 service_role。
BEGIN;

-- 依「剩餘異動」重建主檔的在職狀態與任職門市：沒有任何狀態類異動（入職、調店、復職、留停、離職）時完全不動。
CREATE OR REPLACE FUNCTION public.workspace_employee_master_resync(p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ev record; st text; sid uuid; has_status boolean:=false; last_d date; last_t text; target store_employees%rowtype; changed integer:=0; n integer;
BEGIN
 FOR ev IN SELECT h.movement_type mt,h.movement_date d,h.store_id FROM employee_movement_history h WHERE h.employee_code=p_code ORDER BY h.movement_date,h.created_at,h.id LOOP
  last_d:=ev.d;last_t:=ev.mt;
  IF ev.mt IN('onboarding','store_transfer','return_to_work') THEN st:='active';sid:=ev.store_id;has_status:=true;
  ELSIF ev.mt='leave_without_pay' THEN st:='leave_without_pay';IF ev.store_id IS NOT NULL THEN sid:=ev.store_id; END IF;has_status:=true;
  ELSIF ev.mt='resignation' THEN st:='resigned';IF ev.store_id IS NOT NULL THEN sid:=ev.store_id; END IF;has_status:=true;
  END IF;
 END LOOP;
 IF NOT has_status THEN RETURN false; END IF;
 SELECT * INTO target FROM store_employees WHERE employee_code=p_code AND store_id IS NOT DISTINCT FROM sid ORDER BY is_active DESC,last_movement_date DESC NULLS LAST LIMIT 1;
 IF target.id IS NULL THEN RETURN false; END IF;
 UPDATE store_employees SET is_active=(st<>'resigned'),employment_status=st,last_movement_date=last_d,last_movement_type=last_t,updated_at=now()
  WHERE id=target.id AND (is_active IS DISTINCT FROM (st<>'resigned') OR employment_status IS DISTINCT FROM st OR last_movement_date IS DISTINCT FROM last_d OR last_movement_type IS DISTINCT FROM last_t);
 GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
 UPDATE store_employees SET is_active=false,employment_status='resigned',updated_at=now()
  WHERE employee_code=p_code AND id<>target.id AND is_active;
 GET DIAGNOSTICS n=ROW_COUNT;changed:=changed+n;
 RETURN changed>0;
END;$$;
REVOKE ALL ON FUNCTION public.workspace_employee_master_resync(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_employee_master_resync(text) TO service_role;

-- 修改一筆異動。p_fields：employee_name、movement_date、notes、position、newbie_level、onboarding_is_pharmacist（缺少的欄位維持原值）。
CREATE OR REPLACE FUNCTION public.workspace_movement_update(p_actor uuid,p_id uuid,p_fields jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m employee_movement_history%rowtype; nm text; nd date; nn text; npos text; nlevel text; newv text; oldv text; pharm boolean; kind text;
 rec jsonb; from_ym text; old_ym text; new_ym text; lbl text; prior text;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE store_employees,monthly_staff_status,employee_movement_history IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO m FROM employee_movement_history WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 kind:=CASE WHEN m.movement_type='promotion' AND m.new_value='代理店長' THEN 'acting_manager' ELSE m.movement_type END;
 nm:=btrim(coalesce(p_fields->>'employee_name',m.employee_name,''));
 nd:=coalesce(nullif(p_fields->>'movement_date','')::date,m.movement_date);
 IF nm='' OR length(nm)>100 OR nd<'1912-01-01' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 nn:=CASE WHEN p_fields ? 'notes' THEN nullif(btrim(coalesce(p_fields->>'notes','')),'') ELSE m.notes END;
 pharm:=CASE WHEN jsonb_typeof(p_fields->'onboarding_is_pharmacist')='boolean' THEN (p_fields->>'onboarding_is_pharmacist')::boolean ELSE m.onboarding_is_pharmacist END;
 newv:=m.new_value;oldv:=m.old_value;
 IF kind='promotion' THEN
  npos:=btrim(coalesce(p_fields->>'position',m.new_value,''));nlevel:=nullif(btrim(coalesce(p_fields->>'newbie_level','')),'');
  IF npos='行政(過階)' OR (nlevel='過階行政' AND npos='行政') THEN npos:='行政';nlevel:='過階行政';
  ELSIF npos='行政(未過階)' THEN npos:='行政';nlevel:='未過階行政'; END IF;
  IF NOT (p_fields ? 'newbie_level') AND npos IN('新人','行政') THEN nlevel:=substring(m.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'); END IF;
  IF npos='' OR npos='代理店長' OR (npos IN('新人','行政') AND nlevel IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
  newv:=npos;
  SELECT string_agg(btrim(x),'；') INTO nn FROM unnest(string_to_array(coalesce(nn,''),'；')) x WHERE btrim(x)<>'' AND btrim(x) !~ '^(行政階級|新人等級)[:：]';
  IF npos='行政' AND nlevel IS NOT NULL THEN nn:=concat_ws('；',nn,'行政階級:'||nlevel); END IF;
  IF npos='新人' AND nlevel IS NOT NULL THEN nn:=concat_ws('；',nn,'新人等級:'||nlevel); END IF;
  IF oldv='代理店長' THEN
   SELECT h.new_value INTO prior FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<nd AND h.id<>m.id ORDER BY h.movement_date DESC,h.created_at DESC LIMIT 1;
   IF prior IS NOT NULL THEN oldv:=prior; END IF;
  END IF;
 ELSIF kind='acting_manager' THEN newv:='代理店長';
 ELSIF kind='onboarding' THEN
  -- 備註內的「是否藥師」標記跟著藥師身分走（歷史頁備註欄會顯示它）。
  SELECT string_agg(btrim(x),'；') INTO nn FROM unnest(string_to_array(coalesce(nn,''),'；')) x WHERE btrim(x)<>'' AND btrim(x) !~ '^是否藥師[:：]';
  IF pharm IS NOT NULL THEN nn:=concat_ws('；',nn,'是否藥師:'||CASE WHEN pharm THEN '是' ELSE '否' END); END IF;
 END IF;
 IF nn IS NOT NULL AND length(nn)>5000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_date=nd AND h.id<>m.id AND
   CASE WHEN h.movement_type='promotion' AND h.new_value='代理店長' THEN 'acting_manager' ELSE h.movement_type END=kind AND
   (kind<>'promotion' OR h.new_value IS NOT DISTINCT FROM newv)) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
 UPDATE employee_movement_history SET employee_name=nm,movement_date=nd,new_value=newv,old_value=oldv,notes=nn,
  onboarding_is_pharmacist=CASE WHEN kind='onboarding' THEN pharm ELSE onboarding_is_pharmacist END WHERE id=m.id;
 old_ym:=to_char(m.movement_date,'YYYY-MM');new_ym:=to_char(nd,'YYYY-MM');from_ym:=least(old_ym,new_ym);
 -- 主檔：姓名一律同步；入職日期與藥師身分只在這是該員工最新一次入職時同步；最後異動日期跟著改。
 IF nm IS DISTINCT FROM m.employee_name THEN
  UPDATE store_employees SET employee_name=nm,updated_at=now() WHERE employee_code=m.employee_code AND employee_name IS DISTINCT FROM nm;
  -- 名冊姓名：已送審／已確認月份不動（A.2），其餘月份跟著改。
  UPDATE monthly_staff_status s SET employee_name=nm,updated_at=now() WHERE s.employee_code=m.employee_code AND s.year_month>=from_ym AND s.employee_name IS DISTINCT FROM nm
   AND NOT workspace_staff_month_locked(s.store_id,s.year_month,s.status);
 END IF;
 IF kind='onboarding' AND NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='onboarding' AND h.id<>m.id AND (h.movement_date,h.created_at)>(nd,m.created_at)) THEN
  UPDATE store_employees SET start_date=nd,is_pharmacist=coalesce(pharm,is_pharmacist),updated_at=now()
   WHERE employee_code=m.employee_code AND store_id IS NOT DISTINCT FROM m.store_id AND (start_date IS DISTINCT FROM nd OR is_pharmacist IS DISTINCT FROM coalesce(pharm,is_pharmacist));
 END IF;
 IF nd IS DISTINCT FROM m.movement_date THEN
  UPDATE store_employees SET last_movement_date=nd,updated_at=now() WHERE employee_code=m.employee_code AND last_movement_date=m.movement_date AND last_movement_type=m.movement_type;
  IF m.movement_type IN('onboarding','leave_without_pay','return_to_work','resignation','store_transfer') THEN PERFORM workspace_employee_master_resync(m.employee_code); END IF;
 END IF;
 lbl:='修改異動（'||nd||'）';
 rec:=workspace_roster_recompute(p_actor,m.employee_code,from_ym,NULL,NULL,true,false,kind,m.id::text,lbl);
 IF kind IN('promotion','acting_manager','pass_probation') THEN PERFORM workspace_employee_master_position_sync(m.employee_code); END IF;
 RETURN jsonb_build_object('id',m.id,'roster',rec,'fromMonth',from_ym);
END;$$;
REVOKE ALL ON FUNCTION public.workspace_movement_update(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_update(uuid,uuid,jsonb) TO service_role;

-- 刪除一筆異動：只能刪該員工最新一筆（movement_date、created_at、id 排序最後者）。
CREATE OR REPLACE FUNCTION public.workspace_movement_delete(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m employee_movement_history%rowtype; newer employee_movement_history%rowtype; kind text; rec jsonb; ym text; eff record; restored boolean:=false;
 today date:=(now() AT TIME ZONE 'Asia/Taipei')::date; prev_onb employee_movement_history%rowtype;
BEGIN
 IF p_actor IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor) THEN RAISE EXCEPTION 'WORKSPACE_FORBIDDEN'; END IF;
 LOCK TABLE store_employees,monthly_staff_status,employee_movement_history IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO m FROM employee_movement_history WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
 SELECT * INTO newer FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.id<>m.id AND (h.movement_date,h.created_at,h.id)>(m.movement_date,m.created_at,m.id) ORDER BY h.movement_date DESC,h.created_at DESC,h.id DESC LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_LATEST' USING DETAIL='newer='||newer.id||';date='||newer.movement_date||';type='||newer.movement_type; END IF;
 kind:=CASE WHEN m.movement_type='promotion' AND m.new_value='代理店長' THEN 'acting_manager' ELSE m.movement_type END;
 ym:=to_char(m.movement_date,'YYYY-MM');
 DELETE FROM employee_movement_history WHERE id=m.id;
 -- 主檔狀態與門市：依剩餘異動重建（沒有任何狀態類異動時不動）。
 restored:=workspace_employee_master_resync(m.employee_code);
 -- 入職：恢復上一次入職的到職日與藥師身分。
 IF kind='onboarding' THEN
  SELECT * INTO prev_onb FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='onboarding' ORDER BY h.movement_date DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND THEN
   UPDATE store_employees SET start_date=prev_onb.movement_date,is_pharmacist=coalesce(prev_onb.onboarding_is_pharmacist,is_pharmacist),updated_at=now()
    WHERE employee_code=m.employee_code AND store_id IS NOT DISTINCT FROM prev_onb.store_id;
  END IF;
 END IF;
 -- 職位：升職、代理、過試用期刪除後，主檔職位＝今天以前最新有效升職；已沒有任何升職時退回被刪升職的原職位。
 IF kind IN('promotion','acting_manager','pass_probation') THEN
  SELECT * INTO eff FROM workspace_effective_promotion(m.employee_code,today);
  IF eff.pos IS NOT NULL THEN
   restored:=workspace_employee_master_position_sync(m.employee_code) OR restored;
  ELSIF kind='promotion' AND m.old_value IS NOT NULL AND m.old_value<>'代理店長' THEN
   UPDATE store_employees SET position=m.old_value,current_position=m.old_value,last_promotion_date=NULL,updated_at=now()
    WHERE employee_code=m.employee_code AND current_position IS NOT DISTINCT FROM m.new_value;
   restored:=true;
  END IF;
 END IF;
 -- 名冊職位：已經沒有任何升職紀錄時，重算沒有依據可以還原，草稿月份把被這筆升職改過的職位退回原職位（寫入近期調整紀錄；已送審月份本來就沒被改過，不動）。
 IF kind='promotion' AND m.old_value IS NOT NULL AND m.old_value<>'代理店長' AND m.new_value IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code AND h.movement_type='promotion' AND h.new_value IS NOT NULL AND h.new_value<>'代理店長') THEN
  WITH u AS (
   UPDATE monthly_staff_status s SET position=m.old_value,newbie_level=NULL,updated_at=now()
   WHERE s.employee_code=m.employee_code AND s.year_month>=ym AND s.position IS NOT DISTINCT FROM m.new_value AND NOT workspace_staff_month_locked(s.store_id,s.year_month,s.status)
   RETURNING s.store_id,s.year_month,s.employee_name,s.id)
  INSERT INTO monthly_staff_adjustment_log(store_id,year_month,employee_code,employee_name,monthly_staff_status_id,field,old_value,new_value,movement_id,movement_label,created_by)
  SELECT u.store_id,u.year_month,m.employee_code,u.employee_name,u.id,'position',m.new_value,m.old_value,m.id::text,'刪除異動（'||m.movement_date||'）',p_actor FROM u;
 END IF;
 rec:=workspace_roster_recompute(p_actor,m.employee_code,ym,NULL,NULL,true,false,kind,m.id::text,'刪除異動（'||m.movement_date||'）');
 -- 這位員工已經沒有任何異動：沒有東西再提議更動名冊，這筆異動留下的待確認項目一併結案。
 IF NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code) THEN
  UPDATE monthly_staff_recheck SET status='resolved',resolved_by=p_actor,resolved_at=now(),updated_at=now()
  WHERE employee_code=m.employee_code AND source_type='movement' AND status='pending' AND year_month>=ym;
 END IF;
 RETURN jsonb_build_object('id',m.id,'employee_code',m.employee_code,'employee_name',m.employee_name,'movement_type',kind,'roster',rec,'fromMonth',ym,'masterRestored',restored);
END;$$;
REVOKE ALL ON FUNCTION public.workspace_movement_delete(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_movement_delete(uuid,uuid) TO service_role;
COMMIT;
