-- 還原 ga_wo_apply_fields 為第 5 批版本（沒有廠商狀態檢查）。
CREATE OR REPLACE FUNCTION public.ga_wo_apply_fields(p_wo uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_cat uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'category_id'));
  v_assignee uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'assignee_id'));
  v_vendor uuid := public.ga_wo_try_uuid(ga_normalize_optional_text(v_p->>'vendor_id'));
  v_name text := ga_normalize_optional_text(v_p->>'assignee_name');
  v_method text := ga_normalize_optional_text(v_p->>'handling_method');
BEGIN
  IF v_assignee IS NOT NULL AND v_name IS NULL THEN v_name := (SELECT full_name FROM public.profiles WHERE id = v_assignee); END IF;
  IF v_cat IS NULL AND v_assignee IS NULL AND v_vendor IS NULL AND v_name IS NULL AND v_method IS NULL THEN RETURN; END IF;
  UPDATE public.maintenance_requests SET category_id = COALESCE(v_cat, category_id), assignee_id = COALESCE(v_assignee, assignee_id), assignee_name = COALESCE(v_name, assignee_name),
    handling_method = COALESCE(v_method, handling_method), vendor_id = COALESCE(v_vendor, vendor_id) WHERE id = p_wo;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_wo_apply_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
