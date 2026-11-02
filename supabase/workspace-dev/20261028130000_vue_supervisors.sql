BEGIN;
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
NOTIFY pgrst,'reload schema';
COMMIT;
