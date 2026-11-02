BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_task_copy_receipts(write_id uuid PRIMARY KEY,actor_id uuid NOT NULL,source_id uuid NOT NULL,source_version bigint NOT NULL,result_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_task_copy_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_task_copy_receipts FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.workspace_copy_archived_task(p_id uuid,p_actor uuid,p_version bigint,p_write uuid,p_department text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE source assignments%ROWTYPE; receipt workspace_task_copy_receipts%ROWTYPE; result uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,1));
  SELECT * INTO source FROM assignments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT source.archived THEN RAISE EXCEPTION 'SOURCE_CONFLICT'; END IF;
  SELECT * INTO receipt FROM workspace_task_copy_receipts WHERE write_id=p_write;
  IF FOUND THEN
    IF receipt.actor_id<>p_actor OR receipt.source_id<>p_id OR receipt.source_version<>p_version THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF;
    RETURN receipt.result_id;
  END IF;
  IF source.workspace_version<>p_version THEN RAISE EXCEPTION 'SOURCE_CONFLICT'; END IF;
  INSERT INTO assignments(template_id,assigned_to,created_by,department,status,archived)
  VALUES(source.template_id,p_actor,p_actor,p_department,'pending',false) RETURNING id INTO result;
  -- The legacy copy omitted this row, leaving the copy invisible in My Tasks.
  INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) VALUES(result,p_actor,NULL);
  INSERT INTO workspace_task_copy_receipts(write_id,actor_id,source_id,source_version,result_id) VALUES(p_write,p_actor,p_id,p_version,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workspace_copy_archived_task(uuid,uuid,bigint,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_copy_archived_task(uuid,uuid,bigint,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
