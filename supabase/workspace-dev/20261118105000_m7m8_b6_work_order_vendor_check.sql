-- M7/M8 第 6 批（G21 補充）：工單進度「有填才更新」之外，新選的廠商必須是「合作中」（V3：新單只能選合作中；沿用已綁的停用廠商不擋）。
-- 只改一支內部函式 ga_wo_apply_fields（存進度與送門市確認共用）：vendor_id 有給、且與工單目前綁定的不同時，檢查廠商存在且 status='active'，
-- 否則 VENDOR_NOT_FOUND（404）或 VENDOR_INACTIVE（422）；錯誤在寫入前丟出，外層子交易整段回復（工單、進度、事件都不變）。沒給 vendor_id 時行為完全不變（不清掉原本綁定的廠商）。
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
  v_cur uuid;
  v_vs text;
BEGIN
  -- 審查 A5：有給 vendor_id 但不是合法 uuid，回 400，不再當成「沒給」而默默不更新。
  IF v_vendor IS NULL AND ga_normalize_optional_text(v_p->>'vendor_id') IS NOT NULL THEN PERFORM public.ga_rq_raise(400, 'VENDOR_FORMAT', '廠商格式錯誤，請重新整理後再選'); END IF;
  IF v_assignee IS NOT NULL AND v_name IS NULL THEN v_name := (SELECT full_name FROM public.profiles WHERE id = v_assignee); END IF;
  IF v_vendor IS NOT NULL THEN
    SELECT vendor_id INTO v_cur FROM public.maintenance_requests WHERE id = p_wo;
    IF v_vendor IS DISTINCT FROM v_cur THEN
      SELECT status INTO v_vs FROM public.ga_vendors WHERE id = v_vendor;
      IF NOT FOUND THEN PERFORM public.ga_rq_raise(404, 'VENDOR_NOT_FOUND', '找不到這個廠商，請重新整理後再選'); END IF;
      IF v_vs <> 'active' THEN PERFORM public.ga_rq_raise(422, 'VENDOR_INACTIVE', '這個廠商目前不是「合作中」狀態，不能選用；請改選合作中的廠商'); END IF;
    END IF;
  END IF;
  IF v_cat IS NULL AND v_assignee IS NULL AND v_vendor IS NULL AND v_name IS NULL AND v_method IS NULL THEN RETURN; END IF;
  UPDATE public.maintenance_requests SET category_id = COALESCE(v_cat, category_id), assignee_id = COALESCE(v_assignee, assignee_id), assignee_name = COALESCE(v_name, assignee_name),
    handling_method = COALESCE(v_method, handling_method), vendor_id = COALESCE(v_vendor, vendor_id) WHERE id = p_wo;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_wo_apply_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
