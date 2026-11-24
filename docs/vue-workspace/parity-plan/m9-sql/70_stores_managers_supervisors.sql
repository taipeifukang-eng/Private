-- M9 正式區草稿 70：門市、店長與督導（尚未套用到正式區；由人確認後才轉正式 migration）
-- 對應 DEV：20261028120000_vue_store_managers、20261028130000_vue_supervisors、20261028140000_vue_stores、
--           20261028170000_vue_store_map_inactive、20261029160000_vue_supervisor_primary_choice（合併為一份，依 DEV 順序）
--
-- 白話說明
--   新增（正式區原本都沒有，也沒有舊版同名物件）：
--   1. 權限碼 store.store.view / view_inactive / create / edit / clone：只在 permissions 補上缺的列（ON CONFLICT DO NOTHING，
--      已存在的列不改描述、不改啟用狀態）。本檔「不授權給任何角色」（不寫 role_permissions），授權由老闆日後用勾選頁決定。
--   2. 資料表 workspace_store_requests：門市異動的冪等紀錄（同一 request_id 重送只回傳舊結果）。RLS 開啟、無政策，只有 service_role 可用。
--   3. 函式（皆 SECURITY DEFINER、固定 search_path、只授權 service_role；REVOKE 掉 PUBLIC/anon/authenticated）：
--        workspace_store_catalog、workspace_store_history、workspace_store_mutate（門市清單／沿革／新增編輯搬遷）
--        workspace_set_store_manager（店長指派）、workspace_set_supervisor（督導與代理）、workspace_set_supervisor_choices（督導主責選擇）
--   4. 停用門市讀取：函式 workspace_can_read_inactive_store() 與 stores 的 SELECT 政策 workspace_store_inactive_read
--      （只加「停用門市可讀」，正式區既有 stores 政策不動；多條 PERMISSIVE 政策是 OR 關係）。
--   不改任何既有資料列、不改既有資料表結構、不動既有函式與政策。
--
-- 與 DEV 的差異（依正式區 has_permission 語意）
--   正式區 has_permission 不檢查 roles.is_active，且資料庫端沒有 admin 角色繞過。DEV 版 workspace_can_read_inactive_store 另外
--   寫了「角色代碼為 admin／owner 等且 roles.is_active」的繞過分支，正式區不沿用：這裡只認
--   has_permission(store.store.view_inactive) 或 has_permission(store.manage)。正式區管理員角色已被授予 store.manage
--   （見 20260820093000_grant_organization_permissions_to_admin_roles），所以管理員仍讀得到；其他人要看停用門市，需由勾選頁授權 view_inactive。
--
-- 是否需備份：否（只新增物件與缺少的權限碼，不改既有資料）。還原請用 70_stores_managers_supervisors.rollback.sql；
--   還原會刪除 workspace_store_requests（冪等紀錄，丟失無害，但如要留存請先 CREATE TABLE ... AS SELECT 備份）。
--   還原「不會」刪除權限碼（其中 store.store.create／clone 在正式區原本就存在，無法區分是否為本檔新增）。
-- 可重複執行：IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT / DROP POLICY IF EXISTS。
-- 驗證：套用後執行 70_stores_managers_supervisors.verify.sql（只有 SELECT）。
BEGIN;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing FROM unnest(ARRAY['stores','store_managers','store_relocation_history','monthly_staff_status','profiles','permissions']) t
   WHERE to_regclass('public.'||t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing prerequisite tables: %', missing; END IF;
  IF to_regprocedure('public.has_permission(uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.has_permission(uuid,varchar)';
  END IF;
  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'stores.id','stores.store_code','stores.store_name','stores.short_name','stores.hr_store_code','stores.manager_name','stores.is_franchise','stores.address','stores.phone','stores.is_active','stores.updated_at','stores.gps_latitude','stores.gps_longitude',
    'store_managers.id','store_managers.store_id','store_managers.user_id','store_managers.role_type','store_managers.is_primary','store_managers.created_at',
    'store_relocation_history.store_id','store_relocation_history.relocation_date','store_relocation_history.created_at','store_relocation_history.created_by',
    'monthly_staff_status.store_id','monthly_staff_status.year_month','monthly_staff_status.monthly_status',
    'profiles.job_title','profiles.full_name','profiles.email',
    'permissions.module','permissions.feature','permissions.code','permissions.action','permissions.description','permissions.is_active']) c
   WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=split_part(c,'.',1) AND column_name=split_part(c,'.',2));
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing prerequisite columns: %', missing; END IF;
END $$;

-- 1. 權限碼（只建立，不授權給任何角色）
INSERT INTO public.permissions(module,feature,code,action,description,is_active) VALUES
('store','store','store.store.view','view','查看門市列表',true),
('store','store','store.store.view_inactive','view_inactive','查看已停用門市',true),
('store','store','store.store.create','create','建立門市',true),
('store','store','store.store.edit','edit','編輯門市資料',true),
('store','store','store.store.clone','clone','搬遷與維護門市沿革',true)
ON CONFLICT(code) DO NOTHING;

-- 2. 冪等紀錄表
CREATE TABLE IF NOT EXISTS public.workspace_store_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,operation text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_store_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_store_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_store_requests TO service_role;

-- 3a. 門市清單／沿革／異動
CREATE OR REPLACE FUNCTION public.workspace_store_catalog(p_inactive boolean,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('version',md5(to_jsonb(s)::text),'latest_month',staff.latest_month,'employee_count',staff.total,'managers',coalesce(managers.items,'[]'::jsonb)) ORDER BY s.store_code),'[]'::jsonb)
FROM stores s LEFT JOIN LATERAL(SELECT max(year_month) AS latest_month FROM monthly_staff_status WHERE store_id=s.id) latest ON true
LEFT JOIN LATERAL(SELECT latest.latest_month,count(*) FILTER(WHERE monthly_status IS DISTINCT FROM 'resigned') total FROM monthly_staff_status WHERE store_id=s.id AND year_month=latest.latest_month)staff ON true
LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('user_id',sm.user_id,'role_type',sm.role_type,'is_primary',sm.is_primary,'name',coalesce(p.full_name,p.email,'未命名'))) items FROM store_managers sm LEFT JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=s.id)managers ON true
WHERE (p_inactive OR s.is_active) AND (p_id IS NULL OR s.id=p_id);
$$;
CREATE OR REPLACE FUNCTION public.workspace_store_history(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('version',md5(to_jsonb(h)::text)) ORDER BY relocation_date DESC,created_at DESC),'[]'::jsonb) FROM store_relocation_history h WHERE store_id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.workspace_store_mutate(p_actor uuid,p_request uuid,p_operation text,p_data jsonb,p_expected text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old stores%rowtype; saved stores%rowtype; hist store_relocation_history%rowtype; cache workspace_store_requests%rowtype; sid uuid; output jsonb;
BEGIN
 LOCK TABLE stores IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE store_relocation_history IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cache FROM workspace_store_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF cache.actor_id<>p_actor OR cache.operation<>p_operation OR cache.payload IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED'; END IF;
  RETURN cache.result;
 END IF;
 IF p_operation='create' THEN
  INSERT INTO stores(store_code,store_name,is_franchise,short_name,hr_store_code,manager_name,address,phone,gps_latitude,gps_longitude)
  VALUES(p_data->>'store_code',p_data->>'store_name',(p_data->>'is_franchise')::boolean,p_data->>'short_name',p_data->>'hr_store_code',p_data->>'manager_name',p_data->>'address',p_data->>'phone',(p_data->>'gps_latitude')::numeric,(p_data->>'gps_longitude')::numeric) RETURNING * INTO saved;sid:=saved.id;
 ELSE
  sid:=(p_data->>'id')::uuid;SELECT * INTO old FROM stores WHERE id=sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
  IF p_operation='history-delete' THEN
   SELECT * INTO hist FROM store_relocation_history WHERE id=(p_data->>'history_id')::uuid AND store_id=sid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND'; END IF;
   IF md5(to_jsonb(hist)::text) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
   DELETE FROM store_relocation_history WHERE id=hist.id;
  ELSE
   IF md5(to_jsonb(old)::text) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
   IF p_operation='edit' THEN
    UPDATE stores SET store_name=p_data->>'store_name',is_franchise=(p_data->>'is_franchise')::boolean,short_name=p_data->>'short_name',hr_store_code=p_data->>'hr_store_code',manager_name=p_data->>'manager_name',address=p_data->>'address',phone=p_data->>'phone',gps_latitude=(p_data->>'gps_latitude')::numeric,gps_longitude=(p_data->>'gps_longitude')::numeric,is_active=(p_data->>'is_active')::boolean,updated_at=clock_timestamp() WHERE id=sid;
   ELSIF p_operation='relocate' THEN
    IF NOT old.is_active THEN RAISE EXCEPTION 'WORKSPACE_INACTIVE'; END IF;
    IF ROW(old.store_code,old.store_name,old.short_name,old.hr_store_code,old.manager_name) IS NOT DISTINCT FROM ROW(p_data->>'new_store_code',p_data->>'new_store_name',p_data->>'new_short_name',p_data->>'new_hr_store_code',p_data->>'new_manager_name') THEN RAISE EXCEPTION 'WORKSPACE_NO_CHANGE'; END IF;
    UPDATE stores SET store_code=p_data->>'new_store_code',store_name=p_data->>'new_store_name',short_name=p_data->>'new_short_name',hr_store_code=p_data->>'new_hr_store_code',manager_name=p_data->>'new_manager_name',updated_at=clock_timestamp() WHERE id=sid;
    INSERT INTO store_relocation_history(store_id,relocation_date,old_store_code,new_store_code,old_store_name,new_store_name,old_short_name,new_short_name,old_hr_store_code,new_hr_store_code,old_manager_name,new_manager_name,note,created_by)
    VALUES(sid,(p_data->>'relocation_date')::date,old.store_code,p_data->>'new_store_code',old.store_name,p_data->>'new_store_name',old.short_name,p_data->>'new_short_name',old.hr_store_code,p_data->>'new_hr_store_code',old.manager_name,p_data->>'new_manager_name',p_data->>'note',p_actor);
   ELSIF p_operation='history-add' THEN
    INSERT INTO store_relocation_history(store_id,relocation_date,old_store_code,new_store_code,old_store_name,new_store_name,old_short_name,new_short_name,old_hr_store_code,new_hr_store_code,old_manager_name,new_manager_name,note,created_by)
    VALUES(sid,(p_data->>'relocation_date')::date,p_data->>'old_store_code',p_data->>'new_store_code',p_data->>'old_store_name',p_data->>'new_store_name',p_data->>'old_short_name',p_data->>'new_short_name',p_data->>'old_hr_store_code',p_data->>'new_hr_store_code',p_data->>'old_manager_name',p_data->>'new_manager_name',p_data->>'note',p_actor);
   ELSE RAISE EXCEPTION 'WORKSPACE_INVALID_OPERATION'; END IF;
  END IF;
 END IF;
 output:=jsonb_build_object('id',sid,'success',true);
 INSERT INTO workspace_store_requests(request_id,actor_id,operation,payload,result) VALUES(p_request,p_actor,p_operation,p_data,output);
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.workspace_store_catalog(boolean,uuid),public.workspace_store_history(uuid),public.workspace_store_mutate(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_store_catalog(boolean,uuid),public.workspace_store_history(uuid),public.workspace_store_mutate(uuid,uuid,text,jsonb,text) TO service_role;

-- 3b. 店長指派
CREATE OR REPLACE FUNCTION public.workspace_set_store_manager(p_user uuid,p_stores uuid[],p_expected text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actual text[]; current_stores uuid[]; desired uuid[];
BEGIN
  LOCK TABLE public.store_managers IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(array_agg(id::text||':'||store_id::text ORDER BY id::text||':'||store_id::text),'{}'),coalesce(array_agg(store_id ORDER BY store_id),'{}') INTO actual,current_stores
  FROM public.store_managers WHERE user_id=p_user AND role_type='store_manager' AND is_primary=true;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO desired FROM unnest(p_stores) x;
  IF current_stores=desired THEN RETURN jsonb_build_object('success',true); END IF;
  IF actual IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_expected) x ORDER BY x) THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user) THEN RAISE EXCEPTION 'WORKSPACE_USER_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE NOT x=ANY(current_stores)) AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user AND (job_title ILIKE '%店長%' OR job_title ILIKE '%督導%')) THEN RAISE EXCEPTION 'WORKSPACE_USER_INELIGIBLE'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(desired) x LEFT JOIN stores s ON s.id=x WHERE s.id IS NULL OR (s.is_active IS NOT TRUE AND NOT x=ANY(current_stores))) THEN RAISE EXCEPTION 'WORKSPACE_STORE_INELIGIBLE'; END IF;
  DELETE FROM store_managers WHERE user_id=p_user AND role_type='store_manager' AND is_primary=true AND NOT store_id=ANY(desired);
  INSERT INTO store_managers(store_id,user_id,role_type,is_primary) SELECT x,p_user,'store_manager',true FROM unnest(desired) x WHERE NOT x=ANY(current_stores);
  RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.workspace_set_store_manager(uuid,uuid[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_set_store_manager(uuid,uuid[],text[]) TO service_role;

-- 3c. 督導與代理
CREATE OR REPLACE FUNCTION public.workspace_set_supervisor(p_user uuid,p_role text,p_stores uuid[],p_proxies uuid[],p_expected text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actual text[]; existing uuid[]; desired uuid[]; current_proxies uuid[]; proxies uuid[]; touched uuid[]; sid uuid; chosen uuid; job text;
BEGIN
 IF p_role NOT IN ('supervisor','store_manager') THEN RAISE EXCEPTION 'WORKSPACE_INVALID_ROLE'; END IF;
 LOCK TABLE store_managers IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(array_agg(id::text||':'||user_id::text||':'||store_id::text||':'||role_type||':'||is_primary::text ORDER BY id::text||':'||user_id::text||':'||store_id::text||':'||role_type||':'||is_primary::text),'{}') INTO actual FROM store_managers;
 SELECT coalesce(array_agg(store_id ORDER BY store_id),'{}') INTO existing FROM store_managers WHERE user_id=p_user AND role_type=p_role;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO desired FROM unnest(p_stores) x;
 SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO proxies FROM unnest(p_proxies) x;
 IF EXISTS(SELECT 1 FROM unnest(proxies) x WHERE NOT x=ANY(desired)) OR (p_role<>'supervisor' AND cardinality(proxies)>0) THEN RAISE EXCEPTION 'WORKSPACE_INVALID_PROXY'; END IF;
 SELECT coalesce(array_agg(sm.store_id ORDER BY sm.store_id),'{}') INTO current_proxies FROM store_managers sm WHERE sm.user_id=p_user AND sm.role_type=p_role AND p_role='supervisor' AND NOT sm.is_primary AND EXISTS(SELECT 1 FROM store_managers other JOIN profiles p ON p.id=other.user_id WHERE other.store_id=sm.store_id AND other.user_id<>p_user AND other.role_type='supervisor' AND p.job_title LIKE '%督導%');
 IF existing=desired AND current_proxies=proxies THEN RETURN jsonb_build_object('success',true); END IF;
 IF actual IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_expected) x ORDER BY x) THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 SELECT job_title INTO job FROM profiles WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_USER_MISSING'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE NOT x=ANY(existing)) AND (job IS NULL OR job !~ '(經理|督導|協理|總監|處長|部長|區經|店長)') THEN RAISE EXCEPTION 'WORKSPACE_USER_INELIGIBLE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(desired) x LEFT JOIN stores s ON s.id=x WHERE s.id IS NULL OR (NOT x=ANY(existing) AND (NOT s.is_active OR s.store_code='0000' OR concat_ws(' ',s.store_code,s.store_name,s.short_name) ~* '(總部|总部|HQ)'))) THEN RAISE EXCEPTION 'WORKSPACE_STORE_INELIGIBLE'; END IF;
 IF p_role='supervisor' THEN
  IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE NOT x=ANY(existing) AND NOT x=ANY(proxies) AND EXISTS(SELECT 1 FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=x AND sm.user_id<>p_user AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%')) THEN RAISE EXCEPTION 'WORKSPACE_PROXY_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(proxies) x WHERE NOT EXISTS(SELECT 1 FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=x AND sm.user_id<>p_user AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%')) THEN RAISE EXCEPTION 'WORKSPACE_PROXY_CHANGED'; END IF;
 END IF;
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(existing||desired) x) INTO touched;
 DELETE FROM store_managers WHERE user_id=p_user AND role_type=p_role AND NOT store_id=ANY(desired);
 INSERT INTO store_managers(user_id,store_id,role_type,is_primary) SELECT p_user,x,p_role,(p_role='supervisor' AND NOT x=ANY(proxies)) FROM unnest(desired) x WHERE NOT x=ANY(existing);
 IF p_role='supervisor' THEN
  UPDATE store_managers SET is_primary=false WHERE user_id=p_user AND role_type='supervisor' AND store_id=ANY(proxies);
  FOREACH sid IN ARRAY touched LOOP
   chosen:=NULL;
   SELECT sm.id INTO chosen FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%' AND NOT(sm.user_id=p_user AND sid=ANY(proxies)) ORDER BY sm.is_primary DESC,sm.created_at,sm.id LIMIT 1;
   IF chosen IS NOT NULL THEN
    UPDATE store_managers sm SET is_primary=(sm.id=chosen) FROM profiles p WHERE p.id=sm.user_id AND sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%';
   END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.workspace_set_supervisor(uuid,text,uuid[],uuid[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_set_supervisor(uuid,text,uuid[],uuid[],text[]) TO service_role;

-- 3d. 督導主責選擇
CREATE OR REPLACE FUNCTION public.workspace_set_supervisor_choices(
 p_user uuid,p_role text,p_stores uuid[],p_primaries jsonb,p_expected text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actual text[]; existing uuid[]; desired uuid[]; touched uuid[]; sid uuid; chosen uuid; candidates uuid[]; previous_primary uuid; job text; choice jsonb;
BEGIN
 IF p_role NOT IN ('supervisor','store_manager') OR p_stores IS NULL OR p_expected IS NULL
 OR jsonb_typeof(p_primaries) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'WORKSPACE_INVALID_INPUT'; END IF;
 LOCK TABLE store_managers IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(array_agg(id::text||':'||user_id::text||':'||store_id::text||':'||role_type||':'||is_primary::text ORDER BY id::text||':'||user_id::text||':'||store_id::text||':'||role_type||':'||is_primary::text),'{}') INTO actual FROM store_managers;
 IF actual IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_expected) x ORDER BY x) THEN RAISE EXCEPTION 'WORKSPACE_CONFLICT'; END IF;
 SELECT job_title INTO job FROM profiles WHERE id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_USER_MISSING'; END IF;
 SELECT coalesce(array_agg(store_id),'{}') INTO existing FROM store_managers WHERE user_id=p_user AND role_type=p_role;
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(p_stores) x ORDER BY x) INTO desired;
 IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE x IS NULL) THEN RAISE EXCEPTION 'WORKSPACE_INVALID_INPUT'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE NOT x=ANY(existing)) AND (job IS NULL OR job !~ '(經理|督導|協理|總監|處長|部長|區經|店長)') THEN RAISE EXCEPTION 'WORKSPACE_USER_INELIGIBLE'; END IF;
 PERFORM id FROM stores WHERE id=ANY(desired) FOR SHARE;
 IF EXISTS(SELECT 1 FROM unnest(desired) x LEFT JOIN stores s ON s.id=x WHERE s.id IS NULL OR (NOT x=ANY(existing) AND (NOT s.is_active OR s.store_code='0000' OR concat_ws(' ',s.store_code,s.store_name,s.short_name) ~* '(總部|总部|HQ)'))) THEN RAISE EXCEPTION 'WORKSPACE_STORE_INELIGIBLE'; END IF;
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(existing||desired) x) INTO touched;
 IF (p_role<>'supervisor' OR coalesce(job,'') NOT LIKE '%督導%') AND p_primaries<>'{}'::jsonb THEN RAISE EXCEPTION 'WORKSPACE_INVALID_PRIMARY'; END IF;
 FOR sid,choice IN SELECT key::uuid,value FROM jsonb_each(p_primaries) LOOP
  IF NOT sid=ANY(touched) OR jsonb_typeof(choice)<>'string' THEN RAISE EXCEPTION 'WORKSPACE_INVALID_PRIMARY'; END IF;
 END LOOP;
 -- Validate every decision before mutating. Managers never compete for supervisor responsibility.
 IF p_role='supervisor' AND job LIKE '%督導%' THEN
  PERFORM p.id FROM profiles p JOIN store_managers sm ON sm.user_id=p.id WHERE sm.store_id=ANY(touched) AND sm.role_type='supervisor' FOR SHARE OF p;
  FOREACH sid IN ARRAY touched LOOP
   SELECT ARRAY(SELECT sm.user_id FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%' AND sm.user_id<>p_user) INTO candidates;
   IF sid=ANY(desired) THEN candidates:=array_append(candidates,p_user); END IF;
   SELECT sm.user_id INTO previous_primary FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%' AND sm.is_primary ORDER BY sm.id LIMIT 1;
   chosen:=(p_primaries->>sid::text)::uuid;
   IF chosen IS NOT NULL AND NOT chosen=ANY(candidates) THEN RAISE EXCEPTION 'WORKSPACE_INVALID_PRIMARY'; END IF;
   IF cardinality(candidates)>0 AND chosen IS NULL THEN
    IF (sid=ANY(desired) AND NOT sid=ANY(existing) AND cardinality(candidates)>1)
      OR (previous_primary=p_user AND NOT sid=ANY(desired))
      OR (cardinality(candidates)>1 AND (previous_primary IS NULL OR NOT previous_primary=ANY(candidates)))
    THEN RAISE EXCEPTION 'WORKSPACE_PRIMARY_REQUIRED'; END IF;
   END IF;
  END LOOP;
 END IF;
 DELETE FROM store_managers WHERE user_id=p_user AND role_type=p_role AND NOT store_id=ANY(desired);
 INSERT INTO store_managers(user_id,store_id,role_type,is_primary)
 SELECT p_user,x,p_role,false FROM unnest(desired) x WHERE NOT x=ANY(existing);
 IF p_role='supervisor' AND job LIKE '%督導%' THEN
  FOREACH sid IN ARRAY touched LOOP
   chosen:=(p_primaries->>sid::text)::uuid;
   IF chosen IS NULL THEN
    -- Existing primary survives. A lone new supervisor can be primary without a choice.
    SELECT sm.user_id INTO chosen FROM store_managers sm JOIN profiles p ON p.id=sm.user_id WHERE sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%' ORDER BY sm.is_primary DESC,sm.id LIMIT 1;
   END IF;
   IF chosen IS NOT NULL THEN
    UPDATE store_managers sm SET is_primary=(sm.user_id=chosen) FROM profiles p WHERE p.id=sm.user_id AND sm.store_id=sid AND sm.role_type='supervisor' AND p.job_title LIKE '%督導%';
   END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.workspace_set_supervisor_choices(uuid,text,uuid[],jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_set_supervisor_choices(uuid,text,uuid[],jsonb,text[]) TO service_role;

-- 4. 停用門市可讀（正式區 has_permission 語意：不檢查 roles.is_active、無 admin 繞過）
CREATE OR REPLACE FUNCTION public.workspace_can_read_inactive_store()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND (
  public.has_permission(auth.uid(),'store.store.view_inactive'::varchar)
  OR public.has_permission(auth.uid(),'store.manage'::varchar)
 );
$$;
REVOKE ALL ON FUNCTION public.workspace_can_read_inactive_store() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_can_read_inactive_store() TO authenticated,service_role;
DROP POLICY IF EXISTS workspace_store_inactive_read ON public.stores;
CREATE POLICY workspace_store_inactive_read ON public.stores FOR SELECT TO authenticated
USING (is_active=false AND public.workspace_can_read_inactive_store());

NOTIFY pgrst,'reload schema';
COMMIT;
