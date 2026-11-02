BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_task_dispatch_receipts(write_id uuid PRIMARY KEY,actor_id uuid NOT NULL,body_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_task_dispatch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_task_dispatch_receipts FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.workspace_dispatch_task(p_template uuid,p_version bigint,p_assignment uuid,p_assignment_version bigint,p_actor uuid,p_write uuid,p_hash text,p_operation text,p_form jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t templates%ROWTYPE; a assignments%ROWTYPE; receipt workspace_task_dispatch_receipts%ROWTYPE; result_template uuid; result_assignment uuid; actor_department text; response jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,4));
  SELECT * INTO receipt FROM workspace_task_dispatch_receipts WHERE write_id=p_write;
  IF FOUND THEN IF receipt.actor_id<>p_actor OR receipt.body_hash<>p_hash THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF; RETURN receipt.result; END IF;
  SELECT * INTO t FROM templates WHERE id=p_template FOR UPDATE;
  IF NOT FOUND OR t.workspace_version<>p_version THEN RAISE EXCEPTION 'TEMPLATE_CONFLICT'; END IF;
  SELECT * INTO a FROM assignments WHERE template_id=p_template AND archived=false ORDER BY created_at DESC,id LIMIT 1 FOR UPDATE;
  IF a.id IS DISTINCT FROM p_assignment OR (a.id IS NOT NULL AND a.workspace_version<>p_assignment_version) THEN RAISE EXCEPTION 'ASSIGNMENT_CONFLICT'; END IF;
  SELECT department INTO actor_department FROM profiles WHERE id=p_actor;
  IF p_operation='copy' THEN
    INSERT INTO templates(title,description,steps_schema,sections,created_by) VALUES(p_form->>'title',t.description,t.steps_schema,t.sections,p_actor) RETURNING id INTO result_template;
    INSERT INTO assignments(template_id,assigned_to,created_by,department,status,archived) VALUES(result_template,p_actor,p_actor,coalesce(a.department,actor_department),'pending',false) RETURNING id INTO result_assignment;
    IF a.id IS NOT NULL THEN INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) SELECT result_assignment,user_id,section_id FROM assignment_collaborators WHERE assignment_id=a.id; END IF;
    INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) VALUES(result_assignment,p_actor,NULL) ON CONFLICT(assignment_id,user_id) DO NOTHING;
  ELSIF p_operation='assign' THEN
    IF jsonb_typeof(p_form->'users')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_form->'users') u WHERE NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=u.value::uuid)) THEN RAISE EXCEPTION 'INVALID_MEMBER'; END IF;
    result_template:=p_template;
    IF a.id IS NULL THEN
      INSERT INTO assignments(template_id,assigned_to,created_by,department,status,archived,planned_start_date,planned_end_date) VALUES(p_template,p_actor,p_actor,actor_department,'pending',false,(p_form->>'start')::date,(p_form->>'end')::date) RETURNING id INTO result_assignment;
    ELSE
      result_assignment:=a.id;
      UPDATE assignments SET assigned_to=p_actor,department=actor_department,planned_start_date=(p_form->>'start')::date,planned_end_date=(p_form->>'end')::date WHERE id=a.id;
      DELETE FROM assignment_collaborators WHERE assignment_id=a.id;
    END IF;
    INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) SELECT result_assignment,member,NULL FROM (SELECT value::uuid member FROM jsonb_array_elements_text(p_form->'users') UNION SELECT p_actor) members;
  ELSE RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
  response:=jsonb_build_object('templateId',result_template,'assignmentId',result_assignment);
  INSERT INTO workspace_task_dispatch_receipts(write_id,actor_id,body_hash,result) VALUES(p_write,p_actor,p_hash,response);
  RETURN response;
END $$;
REVOKE ALL ON FUNCTION public.workspace_dispatch_task(uuid,bigint,uuid,bigint,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_dispatch_task(uuid,bigint,uuid,bigint,uuid,uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
