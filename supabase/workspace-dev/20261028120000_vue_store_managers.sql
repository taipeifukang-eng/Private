BEGIN;
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
NOTIFY pgrst,'reload schema';
COMMIT;
