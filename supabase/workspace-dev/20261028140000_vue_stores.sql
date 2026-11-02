BEGIN;
INSERT INTO public.permissions(module,feature,code,action,description,is_active) VALUES
('store','store','store.store.view','view','查看門市列表',true),
('store','store','store.store.view_inactive','view_inactive','查看已停用門市',true),
('store','store','store.store.create','create','建立門市',true),
('store','store','store.store.edit','edit','編輯門市資料',true),
('store','store','store.store.clone','clone','搬遷與維護門市沿革',true)
ON CONFLICT(code) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.workspace_store_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,operation text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_store_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_store_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_store_requests TO service_role;
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
NOTIFY pgrst,'reload schema';
COMMIT;
