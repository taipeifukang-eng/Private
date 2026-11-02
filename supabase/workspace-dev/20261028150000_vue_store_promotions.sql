BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_promotion_requests (
 request_id uuid PRIMARY KEY, actor_id uuid NOT NULL,
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_promotion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_promotion_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_promotion_requests TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_promotion_snapshot(p_store uuid,p_rows jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH codes AS (SELECT DISTINCT value->>'employee_code' AS code FROM jsonb_array_elements(p_rows))
 SELECT md5(jsonb_build_object(
  'store',(SELECT to_jsonb(s) FROM stores s WHERE id=p_store),
  'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM store_employees e WHERE e.employee_code IN (SELECT code FROM codes)),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM employee_movement_history h WHERE h.employee_code IN (SELECT code FROM codes)),
  'monthly',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) FROM monthly_staff_status m WHERE m.employee_code IN (SELECT code FROM codes))
 )::text);
$$;

CREATE OR REPLACE FUNCTION public.workspace_promotion_save(p_actor uuid,p_request uuid,p_store uuid,p_rows jsonb,p_expected text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cached workspace_promotion_requests%rowtype; item jsonb; emp store_employees%rowtype;
 code text; start_month text; start_date date; previous_position text; level text; position_row record;
 ids jsonb:='[]'::jsonb; new_id uuid; output jsonb; monthly_count integer:=0; changed integer;
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
    AND coalesce(substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)'),'')=coalesce(level,'')) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE'; END IF;
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
  ids:=ids||jsonb_build_array(new_id);
 END LOOP;
 -- Recompute complete affected monthly intervals, so a backdated insert cannot overwrite a later promotion.
 FOR code,start_month,start_date IN SELECT value->>'employee_code',min(left(value->>'effective_date',7)),min((value->>'effective_date')::date) FROM jsonb_array_elements(p_rows) GROUP BY value->>'employee_code' LOOP
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=start_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),
     newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
     is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT; monthly_count:=monthly_count+changed;
  -- Future appointments remain in history/monthly planning and do not prematurely change today's master.
  SELECT h.new_value,h.movement_date INTO position_row FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=today
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND AND start_date<=today THEN
   UPDATE store_employees SET position=position_row.new_value,current_position=position_row.new_value,last_promotion_date=position_row.movement_date,updated_at=now() WHERE employee_code=code;
  END IF;
 END LOOP;
 output:=jsonb_build_object('created',jsonb_array_length(ids),'ids',ids,'monthlyUpdated',monthly_count);
 INSERT INTO workspace_promotion_requests(request_id,actor_id,store_id,payload,result) VALUES(p_request,p_actor,p_store,p_rows,output);
 RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_promotion_snapshot(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_promotion_snapshot(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
