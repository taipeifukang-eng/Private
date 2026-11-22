-- M3 A.1 / A.2 修正：刪除判斷改用 Q9／B.3「所有區段所有步驟完成才算已完成」（勾選紀錄推算），不再看 assignments.status。
-- 只用於 DEV。rollback 見同名 .rollback.sql（還原成 status 欄位判斷）。
BEGIN;
CREATE OR REPLACE FUNCTION public.workspace_assignment_progress_complete(p_assignment uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t templates%ROWTYPE; a assignments%ROWTYPE; steps jsonb; total int; done int;
BEGIN
  SELECT * INTO a FROM assignments WHERE id=p_assignment;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO t FROM templates WHERE id=a.template_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.sections IS NOT NULL AND jsonb_typeof(t.sections)='array' AND jsonb_array_length(t.sections)>0 THEN
    SELECT coalesce(jsonb_agg(st),'[]'::jsonb) INTO steps FROM jsonb_array_elements(t.sections) s, jsonb_array_elements(coalesce(s->'steps','[]'::jsonb)) st;
  ELSE
    steps := CASE WHEN jsonb_typeof(t.steps_schema)='array' THEN t.steps_schema ELSE '[]'::jsonb END;
  END IF;
  WITH RECURSIVE flat(id) AS (
    SELECT st->>'id' FROM jsonb_array_elements(steps) st
    UNION ALL
    SELECT sub->>'id' FROM jsonb_array_elements(steps) st, jsonb_array_elements(coalesce(st->'subSteps','[]'::jsonb)) sub
  ), ids AS (SELECT DISTINCT id FROM flat WHERE id IS NOT NULL),
  latest AS (
    SELECT DISTINCT ON (step_id) step_id,action FROM logs WHERE assignment_id=p_assignment ORDER BY step_id,created_at DESC,id DESC
  )
  SELECT count(*), count(*) FILTER (WHERE l.action='complete') INTO total,done FROM ids LEFT JOIN latest l ON l.step_id=ids.id;
  RETURN total>0 AND total=done;
END $$;
REVOKE ALL ON FUNCTION public.workspace_assignment_progress_complete(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_assignment_progress_complete(uuid) TO service_role;

DO $m$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.workspace_delete_assignment(uuid,uuid)'::regprocedure) INTO def;
  def := replace(def,'IF a.status IS DISTINCT FROM ''completed'' THEN','IF NOT public.workspace_assignment_progress_complete(a.id) THEN');
  EXECUTE def;
  SELECT pg_get_functiondef('public.workspace_delete_template(uuid,uuid,text)'::regprocedure) INTO def;
  def := replace(def,'AND coalesce(status,''pending'') IN (''pending'',''in_progress'')) THEN','AND NOT public.workspace_assignment_progress_complete(id)) THEN');
  def := replace(def,'count(*) FILTER (WHERE status=''completed'')','count(*) FILTER (WHERE public.workspace_assignment_progress_complete(id))');
  EXECUTE def;
END $m$;
NOTIFY pgrst,'reload schema';
COMMIT;
