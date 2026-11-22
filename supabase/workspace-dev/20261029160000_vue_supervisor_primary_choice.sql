BEGIN;
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
NOTIFY pgrst,'reload schema';
COMMIT;
