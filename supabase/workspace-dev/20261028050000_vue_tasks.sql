BEGIN;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS workspace_version bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.workspace_task_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.workspace_version:=OLD.workspace_version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS workspace_task_version ON public.assignments;
CREATE TRIGGER workspace_task_version BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.workspace_task_version();
CREATE OR REPLACE FUNCTION public.workspace_task_child_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN UPDATE assignments SET workspace_version=workspace_version WHERE id=OLD.assignment_id; END IF;
  IF TG_OP <> 'DELETE' THEN UPDATE assignments SET workspace_version=workspace_version WHERE id=NEW.assignment_id; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS workspace_task_logs_version ON public.logs;
CREATE TRIGGER workspace_task_logs_version AFTER INSERT OR UPDATE OR DELETE ON public.logs FOR EACH ROW EXECUTE FUNCTION public.workspace_task_child_version();
DROP TRIGGER IF EXISTS workspace_task_collaborators_version ON public.assignment_collaborators;
CREATE TRIGGER workspace_task_collaborators_version AFTER INSERT OR UPDATE OR DELETE ON public.assignment_collaborators FOR EACH ROW EXECUTE FUNCTION public.workspace_task_child_version();
CREATE OR REPLACE FUNCTION public.workspace_task_template_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN UPDATE assignments SET workspace_version=workspace_version WHERE template_id=NEW.id; RETURN NULL; END $$;
DROP TRIGGER IF EXISTS workspace_task_template_version ON public.templates;
CREATE TRIGGER workspace_task_template_version AFTER UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.workspace_task_template_version();
CREATE TABLE IF NOT EXISTS public.workspace_task_receipts (
  write_id uuid PRIMARY KEY, actor_id uuid NOT NULL, assignment_id uuid NOT NULL,
  body_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_task_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_task_receipts FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.workspace_save_task(p_id uuid,p_actor uuid,p_version bigint,p_write uuid,p_hash text,p_actions jsonb,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a assignments%ROWTYPE; receipt workspace_task_receipts%ROWTYPE; entry jsonb; idx int:=0; stamp timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,0));
  SELECT * INTO a FROM assignments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR a.archived THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM assignment_collaborators WHERE assignment_id=p_id AND user_id=p_actor) THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  SELECT * INTO receipt FROM workspace_task_receipts WHERE write_id=p_write;
  IF FOUND THEN
    IF receipt.actor_id<>p_actor OR receipt.assignment_id<>p_id OR receipt.body_hash<>p_hash THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF;
    RETURN true;
  END IF;
  IF a.workspace_version<>p_version THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  IF p_status NOT IN ('in_progress','completed') OR jsonb_typeof(p_actions)<>'array' OR jsonb_array_length(p_actions)=0 THEN RAISE EXCEPTION 'INVALID_ACTIONS'; END IF;
  SELECT greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond',clock_timestamp())) INTO stamp FROM logs WHERE assignment_id=p_id;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    IF entry->>'action' NOT IN ('complete','uncomplete') OR coalesce(entry->>'step_id','')='' THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
    INSERT INTO logs(assignment_id,user_id,step_id,action,note,created_at)
    VALUES(p_id,p_actor,entry->>'step_id',entry->>'action',entry->>'note',stamp+idx*interval '1 microsecond');
    idx:=idx+1;
  END LOOP;
  UPDATE assignments SET status=p_status,completed_at=CASE WHEN p_status='completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE id=p_id;
  INSERT INTO workspace_task_receipts(write_id,actor_id,assignment_id,body_hash) VALUES(p_write,p_actor,p_id,p_hash);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.workspace_save_task(uuid,uuid,bigint,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_task(uuid,uuid,bigint,uuid,text,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
