BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('campaign-department-assets','campaign-department-assets',false,5242880,ARRAY['image/png','image/jpeg','image/webp']) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS workspace_campaign_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_campaign_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workspace_campaign_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON workspace_campaign_requests TO service_role;
CREATE OR REPLACE FUNCTION workspace_campaign_state(p_kind text,p_campaign uuid,p_scope uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object('campaign',(SELECT to_jsonb(c) FROM campaigns c WHERE id=p_campaign),'rows',CASE p_kind
 WHEN 'schedules' THEN (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM campaign_schedules s WHERE campaign_id=p_campaign)
 WHEN 'ownStaff' THEN (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM campaign_store_own_staff s WHERE campaign_id=p_campaign AND store_id=p_scope)
 WHEN 'supportStaff' THEN (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM campaign_support_staff s WHERE campaign_id=p_campaign AND support_request_id=p_scope) END)::text);
$$;
CREATE OR REPLACE FUNCTION workspace_campaign_replace(p_actor uuid,p_request uuid,p_kind text,p_campaign uuid,p_scope uuid,p_rows jsonb,p_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE payload jsonb:=jsonb_build_object('kind',p_kind,'campaign',p_campaign,'scope',p_scope,'rows',p_rows);cached workspace_campaign_requests%rowtype; item jsonb; campaign campaigns%rowtype; req campaign_support_requests%rowtype;output jsonb;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL OR p_kind NOT IN('schedules','ownStaff','supportStaff') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 LOCK TABLE campaigns,campaign_schedules,campaign_store_own_staff,campaign_support_requests,campaign_support_staff IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO cached FROM workspace_campaign_requests WHERE request_id=p_request;
 IF FOUND THEN IF cached.actor_id<>p_actor OR cached.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'WORKSPACE_REQUEST_REUSED';END IF;RETURN cached.result;END IF;
 SELECT * INTO campaign FROM campaigns WHERE id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';END IF;
 IF p_version IS NULL OR workspace_campaign_state(p_kind,p_campaign,p_scope) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'WORKSPACE_STALE';END IF;
 IF p_kind='schedules' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'store_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_DUPLICATE';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   IF NOT EXISTS(SELECT 1 FROM stores WHERE id=(item->>'store_id')::uuid AND is_active) OR (item->>'activity_date')::date NOT BETWEEN campaign.start_date AND campaign.end_date OR nullif(item->>'activity_date','') IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
  END LOOP;
  DELETE FROM campaign_schedules s WHERE campaign_id=p_campaign AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE (r->>'store_id')::uuid=s.store_id);
  INSERT INTO campaign_schedules(campaign_id,store_id,activity_date) SELECT p_campaign,(r->>'store_id')::uuid,(r->>'activity_date')::date FROM jsonb_array_elements(p_rows) r
   ON CONFLICT(campaign_id,store_id) DO UPDATE SET activity_date=excluded.activity_date,updated_at=now();
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE coalesce(r->>'employee_code','')='' OR coalesce(r->>'employee_name','')='') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'employee_code' HAVING count(*)>1) THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
  IF p_kind='ownStaff' THEN
   IF NOT EXISTS(SELECT 1 FROM stores WHERE id=p_scope AND is_active) THEN RAISE EXCEPTION 'WORKSPACE_INVALID';END IF;
   DELETE FROM campaign_store_own_staff WHERE campaign_id=p_campaign AND store_id=p_scope;
   INSERT INTO campaign_store_own_staff(campaign_id,store_id,employee_code,employee_name,position,is_manually_added,sort_order,created_by)
    SELECT p_campaign,p_scope,r->>'employee_code',r->>'employee_name',r->>'position',coalesce((r->>'is_manually_added')::boolean,false),ordinality::integer,p_actor FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r,ordinality);
  ELSE
   SELECT * INTO req FROM campaign_support_requests WHERE id=p_scope AND campaign_id=p_campaign;
   IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_NOT_FOUND';END IF;
   DELETE FROM campaign_support_staff WHERE campaign_id=p_campaign AND support_request_id=p_scope;
   INSERT INTO campaign_support_staff(campaign_id,support_request_id,supporting_store_id,requesting_store_id,employee_code,employee_name,position,sort_order,created_by)
    SELECT p_campaign,p_scope,req.supporting_store_id,req.requesting_store_id,r->>'employee_code',r->>'employee_name',r->>'position',ordinality::integer,p_actor FROM jsonb_array_elements(p_rows) WITH ORDINALITY a(r,ordinality);
  END IF;
 END IF;
 output:=jsonb_build_object('success',true,'version',workspace_campaign_state(p_kind,p_campaign,p_scope),'count',jsonb_array_length(p_rows));
 INSERT INTO workspace_campaign_requests(request_id,actor_id,payload,result) VALUES(p_request,p_actor,payload,output);RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION workspace_campaign_state(text,uuid,uuid),workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_campaign_state(text,uuid,uuid),workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION workspace_campaign_checklist_order(p_actor uuid,p_campaign uuid,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 LOCK TABLE campaign_checklist_items IN SHARE ROW EXCLUSIVE MODE;
 IF p_ids IS NULL OR cardinality(p_ids)<>(SELECT count(*) FROM campaign_checklist_items WHERE campaign_id=p_campaign) OR cardinality(p_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_ids) id) OR EXISTS(SELECT 1 FROM unnest(p_ids) AS wanted(id) WHERE NOT EXISTS(SELECT 1 FROM campaign_checklist_items c WHERE c.id=wanted.id AND c.campaign_id=p_campaign)) THEN RAISE EXCEPTION 'WORKSPACE_STALE';END IF;
 UPDATE campaign_checklist_items c SET item_order=s.n::integer,updated_by=p_actor,updated_at=now() FROM unnest(p_ids) WITH ORDINALITY s(id,n) WHERE c.id=s.id AND c.campaign_id=p_campaign;
 RETURN jsonb_build_object('success',true);
END;$$;
REVOKE ALL ON FUNCTION workspace_campaign_checklist_order(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION workspace_campaign_checklist_order(uuid,uuid,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
