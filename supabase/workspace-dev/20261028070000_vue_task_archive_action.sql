BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_task_archive_receipts(write_id uuid PRIMARY KEY,actor_id uuid NOT NULL,template_id uuid NOT NULL,body_hash text NOT NULL,archived_count int NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_task_archive_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_task_archive_receipts FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.workspace_archive_template_tasks(p_template uuid,p_actor uuid,p_write uuid,p_hash text,p_versions jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t templates%ROWTYPE; a assignments%ROWTYPE; receipt workspace_task_archive_receipts%ROWTYPE; steps jsonb; item_ids text[]; total int; archived_total int:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,2));
  SELECT * INTO t FROM templates WHERE id=p_template FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEMPLATE_CONFLICT'; END IF;
  SELECT * INTO receipt FROM workspace_task_archive_receipts WHERE write_id=p_write;
  IF FOUND THEN
    IF receipt.actor_id<>p_actor OR receipt.template_id<>p_template OR receipt.body_hash<>p_hash THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF;
    RETURN receipt.archived_count;
  END IF;
  IF jsonb_typeof(p_versions)<>'array' OR jsonb_array_length(p_versions)=0 THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  PERFORM id FROM assignments WHERE template_id=p_template AND archived=false ORDER BY id FOR UPDATE;
  SELECT count(*) INTO total FROM assignments WHERE template_id=p_template AND archived=false;
  IF total<>jsonb_array_length(p_versions) THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  IF jsonb_typeof(t.sections)='array' AND jsonb_array_length(t.sections)>0 THEN
    SELECT coalesce(jsonb_agg(step),'[]'::jsonb) INTO steps FROM jsonb_array_elements(t.sections) section CROSS JOIN LATERAL jsonb_array_elements(coalesce(section->'steps','[]'::jsonb)) step;
  ELSE steps:=coalesce(t.steps_schema,'[]'::jsonb); END IF;
  SELECT array_agg(DISTINCT id) INTO item_ids FROM (
    SELECT step->>'id' id FROM jsonb_array_elements(steps) step
    UNION ALL SELECT sub->>'id' FROM jsonb_array_elements(steps) step CROSS JOIN LATERAL jsonb_array_elements(coalesce(step->'subSteps','[]'::jsonb)) sub
  ) ids WHERE id IS NOT NULL;
  IF coalesce(array_length(item_ids,1),0)=0 THEN RAISE EXCEPTION 'TASK_INCOMPLETE'; END IF;
  FOR a IN SELECT * FROM assignments WHERE template_id=p_template AND archived=false ORDER BY id LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_versions) v WHERE (v->>'id')::uuid=a.id AND (v->>'version')::bigint=a.workspace_version) THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(item_ids) item_id WHERE coalesce((SELECT action FROM logs WHERE assignment_id=a.id AND step_id=item_id AND action IN ('complete','uncomplete') ORDER BY created_at DESC,id DESC LIMIT 1),'')<>'complete') THEN RAISE EXCEPTION 'TASK_INCOMPLETE'; END IF;
    UPDATE assignments SET archived=true,archived_at=now(),archived_by=p_actor,status='completed',completed_at=coalesce(completed_at,now()) WHERE id=a.id;
    archived_total:=archived_total+1;
  END LOOP;
  INSERT INTO workspace_task_archive_receipts(write_id,actor_id,template_id,body_hash,archived_count) VALUES(p_write,p_actor,p_template,p_hash,archived_total);
  RETURN archived_total;
END $$;
REVOKE ALL ON FUNCTION public.workspace_archive_template_tasks(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_archive_template_tasks(uuid,uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
