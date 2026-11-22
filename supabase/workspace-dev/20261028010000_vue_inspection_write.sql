-- DEV-only atomic inspection writes. Existing production routes are unchanged.
BEGIN;
ALTER TABLE public.inspection_masters
 ADD COLUMN IF NOT EXISTS workspace_version bigint NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS workspace_write_id uuid,
 ADD COLUMN IF NOT EXISTS workspace_write_hash text;
ALTER TABLE public.inspection_results ADD COLUMN IF NOT EXISTS workspace_quantities jsonb;
CREATE OR REPLACE FUNCTION public.workspace_inspection_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN NEW.workspace_version=OLD.workspace_version+1; RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.workspace_inspection_version() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_workspace_inspection_version ON public.inspection_masters;
CREATE TRIGGER trg_workspace_inspection_version BEFORE UPDATE ON public.inspection_masters FOR EACH ROW EXECUTE FUNCTION public.workspace_inspection_version();
CREATE OR REPLACE FUNCTION public.workspace_save_inspection(p_actor uuid,p_id uuid,p_version bigint,p_write uuid,p_hash text,p_master jsonb,p_results jsonb,p_staff jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE existing public.inspection_masters; saved public.inspection_masters; rid uuid; item jsonb; target_status text;
BEGIN
 IF p_actor IS NULL OR p_write IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || (p_master->>'store_id') || ':' || (p_master->>'inspection_date') || ':' || (p_master->>'inspection_type'),0));
 IF p_id IS NULL THEN
  SELECT * INTO existing FROM public.inspection_masters WHERE client_request_id=p_write FOR UPDATE;
  IF FOUND THEN
   IF existing.inspector_id=p_actor AND existing.workspace_write_hash=p_hash THEN RETURN to_jsonb(existing); END IF;
   RAISE EXCEPTION 'WRITE_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.inspection_masters WHERE inspector_id=p_actor AND store_id=(p_master->>'store_id')::uuid AND inspection_date=(p_master->>'inspection_date')::date AND COALESCE(inspection_type,'supervisor')=p_master->>'inspection_type') THEN RAISE EXCEPTION 'DUPLICATE_DAY'; END IF;
  rid=gen_random_uuid();
  INSERT INTO public.inspection_masters(id,store_id,inspector_id,created_by,inspection_date,inspection_type,inspection_no,client_request_id,status)
  VALUES(rid,(p_master->>'store_id')::uuid,p_actor,p_actor,(p_master->>'inspection_date')::date,p_master->>'inspection_type','VW-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||replace(rid::text,'-',''),p_write,'draft');
 ELSE
  SELECT * INTO existing FROM public.inspection_masters WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR existing.inspector_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'NOT_OWNER'; END IF;
  IF existing.workspace_write_id=p_write AND existing.workspace_write_hash=p_hash THEN RETURN to_jsonb(existing); END IF;
  IF existing.status NOT IN ('draft','in_progress') OR existing.workspace_version<>p_version THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM public.inspection_masters WHERE id<>p_id AND inspector_id=p_actor AND store_id=(p_master->>'store_id')::uuid AND inspection_date=(p_master->>'inspection_date')::date AND COALESCE(inspection_type,'supervisor')=p_master->>'inspection_type') THEN RAISE EXCEPTION 'DUPLICATE_DAY'; END IF;
  rid=p_id;
 END IF;
 target_status=p_master->>'status';
 IF target_status NOT IN ('draft','completed') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 -- Preserve result IDs so linked improvement records remain attached.
 FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
  INSERT INTO public.inspection_results(inspection_id,template_id,max_score,given_score,deduction_amount,is_improvement,selected_items,workspace_quantities,notes,photo_urls)
  VALUES(rid,(item->>'template_id')::uuid,(item->>'max_score')::numeric,(item->>'given_score')::numeric,(item->>'deduction_amount')::numeric,(item->>'is_improvement')::boolean,item->'selected_items',item->'workspace_quantities',item->>'notes',item->'photo_urls')
  ON CONFLICT(inspection_id,template_id) DO UPDATE SET max_score=EXCLUDED.max_score,given_score=EXCLUDED.given_score,deduction_amount=EXCLUDED.deduction_amount,is_improvement=EXCLUDED.is_improvement,selected_items=EXCLUDED.selected_items,workspace_quantities=EXCLUDED.workspace_quantities,notes=EXCLUDED.notes,photo_urls=EXCLUDED.photo_urls;
 END LOOP;
 DELETE FROM public.inspection_on_duty_staff WHERE inspection_id=rid;
 INSERT INTO public.inspection_on_duty_staff(inspection_id,employee_code,employee_name,position,is_duty_supervisor,is_manually_added)
 SELECT rid,r.employee_code,r.employee_name,r.position,r.is_duty_supervisor,r.is_manually_added FROM jsonb_to_recordset(p_staff) AS r(employee_code text,employee_name text,position text,is_duty_supervisor boolean,is_manually_added boolean);
 UPDATE public.inspection_masters SET
 store_id=(p_master->>'store_id')::uuid,inspection_date=(p_master->>'inspection_date')::date,inspection_type=p_master->>'inspection_type',status=target_status,
 total_score=(p_master->>'total_score')::numeric,max_possible_score=220,grade=p_master->>'grade',score_percentage=(p_master->>'score_percentage')::numeric,
 supervisor_notes=p_master->>'supervisor_notes',indoor_temperature=(p_master->>'indoor_temperature')::numeric,
 signature_photo_url=p_master->>'signature_photo_url',supervisor_signature_url=p_master->>'supervisor_signature_url',
 gps_latitude=(p_master->>'gps_latitude')::numeric,gps_longitude=(p_master->>'gps_longitude')::numeric,gps_accuracy=(p_master->>'gps_accuracy')::numeric,gps_timestamp=(p_master->>'gps_timestamp')::timestamptz,
 workspace_version=workspace_version+1,workspace_write_id=p_write,workspace_write_hash=p_hash,updated_at=clock_timestamp()
 WHERE id=rid RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
