-- M3 A.1 / A.2：刪除流程模板（有進行中任務就擋）與刪除已完成任務（同一交易寫稽核紀錄）。
-- 只用於 DEV。rollback 見同名 .rollback.sql。
BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_task_delete_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('assignment','template')),
  actor_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  template_id uuid,
  template_title text,
  assignment_id uuid,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.workspace_task_delete_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_task_delete_audit FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.workspace_delete_assignment(p_assignment uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a assignments%ROWTYPE; t templates%ROWTYPE; audit_id uuid; collab_count int; log_count int; collab_names jsonb;
BEGIN
  SELECT * INTO a FROM assignments WHERE id=p_assignment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF a.status IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_COMPLETED'; END IF;
  SELECT * INTO t FROM templates WHERE id=a.template_id;
  SELECT count(*) INTO collab_count FROM assignment_collaborators WHERE assignment_id=a.id;
  SELECT count(*) INTO log_count FROM logs WHERE assignment_id=a.id;
  SELECT coalesce(jsonb_agg(coalesce(p.full_name,c.user_id::text) ORDER BY p.full_name),'[]'::jsonb) INTO collab_names FROM assignment_collaborators c LEFT JOIN profiles p ON p.id=c.user_id WHERE c.assignment_id=a.id;
  INSERT INTO workspace_task_delete_audit(kind,actor_id,template_id,template_title,assignment_id,summary)
  VALUES('assignment',p_actor,a.template_id,t.title,a.id,jsonb_build_object(
    'department',a.department,'assigned_to',a.assigned_to,'created_by',a.created_by,'created_at',a.created_at,
    'completed_at',a.completed_at,'archived',a.archived,'collaborator_count',collab_count,'collaborators',collab_names,'log_count',log_count))
  RETURNING id INTO audit_id;
  DELETE FROM logs WHERE assignment_id=a.id;
  DELETE FROM assignment_collaborators WHERE assignment_id=a.id;
  DELETE FROM assignments WHERE id=a.id;
  RETURN audit_id;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_delete_template(p_template uuid,p_actor uuid,p_title text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t templates%ROWTYPE; audit_id uuid; total int; completed int; archived_count int;
BEGIN
  SELECT * INTO t FROM templates WHERE id=p_template FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEMPLATE_NOT_FOUND'; END IF;
  IF p_title IS DISTINCT FROM t.title THEN RAISE EXCEPTION 'TITLE_MISMATCH'; END IF;
  PERFORM id FROM assignments WHERE template_id=p_template ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM assignments WHERE template_id=p_template AND archived=false AND coalesce(status,'pending') IN ('pending','in_progress')) THEN RAISE EXCEPTION 'TEMPLATE_HAS_ACTIVE'; END IF;
  SELECT count(*),count(*) FILTER (WHERE status='completed'),count(*) FILTER (WHERE archived) INTO total,completed,archived_count FROM assignments WHERE template_id=p_template;
  INSERT INTO workspace_task_delete_audit(kind,actor_id,template_id,template_title,summary)
  VALUES('template',p_actor,t.id,t.title,jsonb_build_object('created_by',t.created_by,'created_at',t.created_at,'assignment_count',total,'completed_count',completed,'archived_count',archived_count))
  RETURNING id INTO audit_id;
  DELETE FROM logs WHERE assignment_id IN (SELECT id FROM assignments WHERE template_id=p_template);
  DELETE FROM assignment_collaborators WHERE assignment_id IN (SELECT id FROM assignments WHERE template_id=p_template);
  DELETE FROM assignments WHERE template_id=p_template;
  DELETE FROM templates WHERE id=p_template;
  RETURN audit_id;
END $$;
REVOKE ALL ON FUNCTION public.workspace_delete_assignment(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_delete_template(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_delete_assignment(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_delete_template(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
