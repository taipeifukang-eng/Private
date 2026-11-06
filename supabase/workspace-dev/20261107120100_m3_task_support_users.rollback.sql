-- 還原 20261107120100：回到只允許所選部門人員的原函式。
BEGIN;
CREATE OR REPLACE FUNCTION public.workspace_save_task_template(p_id uuid,p_actor uuid,p_version bigint,p_versions jsonb,p_write uuid,p_hash text,p_form jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE receipt workspace_template_receipts%ROWTYPE; t templates%ROWTYPE; a assignments%ROWTYPE; result uuid; new_assignment uuid; all_steps jsonb; member uuid; section_id text; department_name text; total int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,3));
  SELECT * INTO receipt FROM workspace_template_receipts WHERE write_id=p_write;
  IF FOUND THEN IF receipt.actor_id<>p_actor OR receipt.body_hash<>p_hash THEN RAISE EXCEPTION 'WRITE_CONFLICT'; END IF; RETURN receipt.result_id; END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO t FROM templates WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR t.workspace_version<>p_version THEN RAISE EXCEPTION 'TEMPLATE_CONFLICT'; END IF;
    PERFORM id FROM assignments WHERE template_id=p_id ORDER BY id FOR UPDATE;
    SELECT count(*) INTO total FROM assignments WHERE template_id=p_id;
    IF total<>jsonb_array_length(p_versions) OR EXISTS(SELECT 1 FROM assignments current_assignment WHERE current_assignment.template_id=p_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_versions) v WHERE (v->>'id')::uuid=current_assignment.id AND (v->>'version')::bigint=current_assignment.workspace_version)) THEN RAISE EXCEPTION 'ASSIGNMENT_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM assignments WHERE template_id=p_id AND status='completed') THEN RAISE EXCEPTION 'TASK_COMPLETED'; END IF;
  END IF;
  PERFORM id FROM profiles WHERE id IN (SELECT member_id::uuid FROM jsonb_array_elements(p_form->'sections') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'assigned_users') members(member_id)) ORDER BY id FOR SHARE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_form->'sections') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'assigned_users') u WHERE NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=u.value::uuid AND p.department=s->>'department')) THEN RAISE EXCEPTION 'INVALID_MEMBER'; END IF;
  SELECT coalesce(jsonb_agg(step),'[]'::jsonb) INTO all_steps FROM jsonb_array_elements(p_form->'sections') s CROSS JOIN LATERAL jsonb_array_elements(s->'steps') step;
  IF p_id IS NULL THEN
    INSERT INTO templates(title,description,sections,steps_schema,created_by) VALUES(p_form->>'title',p_form->>'description',p_form->'sections',all_steps,p_actor) RETURNING id INTO result;
    SELECT department INTO department_name FROM profiles WHERE id=p_actor;
    INSERT INTO assignments(template_id,assigned_to,created_by,department,status,archived,planned_start_date,planned_end_date) VALUES(result,p_actor,p_actor,department_name,'pending',false,(p_form->>'planned_start_date')::date,(p_form->>'planned_end_date')::date) RETURNING id INTO new_assignment;
    FOR member IN SELECT DISTINCT member_id::uuid FROM jsonb_array_elements(p_form->'sections') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'assigned_users') members(member_id) UNION SELECT p_actor LOOP
      SELECT s->>'id' INTO section_id FROM jsonb_array_elements(p_form->'sections') WITH ORDINALITY AS sections(s,n) WHERE (s->'assigned_users') ? member::text ORDER BY n LIMIT 1;
      INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) VALUES(new_assignment,member,section_id);
    END LOOP;
  ELSE
    result:=p_id;
    UPDATE templates SET title=p_form->>'title',description=p_form->>'description',sections=p_form->'sections',steps_schema=all_steps WHERE id=p_id;
    FOR a IN SELECT * FROM assignments WHERE template_id=p_id ORDER BY id LOOP
      IF a.status IN ('pending','in_progress') THEN UPDATE assignments SET planned_start_date=(p_form->>'planned_start_date')::date,planned_end_date=(p_form->>'planned_end_date')::date WHERE id=a.id; END IF;
      FOR member IN SELECT DISTINCT member_id::uuid FROM jsonb_array_elements(p_form->'sections') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'assigned_users') members(member_id) LOOP
        SELECT s->>'id' INTO section_id FROM jsonb_array_elements(p_form->'sections') WITH ORDINALITY AS sections(s,n) WHERE (s->'assigned_users') ? member::text ORDER BY n LIMIT 1;
        INSERT INTO assignment_collaborators(assignment_id,user_id,section_id) VALUES(a.id,member,section_id) ON CONFLICT(assignment_id,user_id) DO UPDATE SET section_id=excluded.section_id;
      END LOOP;
      DELETE FROM assignment_collaborators c WHERE c.assignment_id=a.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_form->'sections') s WHERE (s->'assigned_users') ? c.user_id::text) AND NOT EXISTS(SELECT 1 FROM logs l WHERE l.assignment_id=a.id AND l.user_id=c.user_id);
    END LOOP;
  END IF;
  INSERT INTO workspace_template_receipts(write_id,actor_id,body_hash,result_id) VALUES(p_write,p_actor,p_hash,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
