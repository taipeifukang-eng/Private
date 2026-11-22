BEGIN;
CREATE OR REPLACE FUNCTION public.workspace_transfer_snapshot(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object(
 'request',to_jsonb(r),
 'stores',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stores s WHERE s.id IN(r.from_store_id,r.to_store_id)),
 'employees',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM store_employees e WHERE e.employee_code=r.employee_code),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM employee_movement_history h WHERE h.employee_code=r.employee_code),
 'monthly',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM monthly_staff_status m WHERE m.employee_code=r.employee_code AND m.store_id IN(r.from_store_id,r.to_store_id)),
 'initialized',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.store_id,x.year_month,x.status) FROM (SELECT DISTINCT store_id,year_month,status FROM monthly_staff_status WHERE store_id IN(r.from_store_id,r.to_store_id))x)
 )::text) FROM store_transfer_requests r WHERE r.id=p_id;
$$;
REVOKE ALL ON FUNCTION public.workspace_transfer_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_transfer_snapshot(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
