-- 還原 20261107140000：刪除判斷回到 assignments.status。
BEGIN;
DO $m$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.workspace_delete_assignment(uuid,uuid)'::regprocedure) INTO def;
  def := replace(def,'IF NOT public.workspace_assignment_progress_complete(a.id) THEN','IF a.status IS DISTINCT FROM ''completed'' THEN');
  EXECUTE def;
  SELECT pg_get_functiondef('public.workspace_delete_template(uuid,uuid,text)'::regprocedure) INTO def;
  def := replace(def,'AND NOT public.workspace_assignment_progress_complete(id)) THEN','AND coalesce(status,''pending'') IN (''pending'',''in_progress'')) THEN');
  def := replace(def,'count(*) FILTER (WHERE public.workspace_assignment_progress_complete(id))','count(*) FILTER (WHERE status=''completed'')');
  EXECUTE def;
END $m$;
DROP FUNCTION IF EXISTS public.workspace_assignment_progress_complete(uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
