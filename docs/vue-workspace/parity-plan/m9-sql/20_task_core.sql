-- ============================================================================
-- M9 正式區草稿 20：任務核心（版本、封存、範本、派發）
-- 來源：DEV 20261028050000_vue_tasks / 060000_vue_task_archive / 070000_vue_task_archive_action /
--       080000_vue_task_template / 090000_vue_task_dispatch（合併為一份，依 DEV 順序）
-- 狀態：草稿，尚未套用正式區。不得直接當 migration 執行，需老闆確認。
--
-- 白話說明
--   1. assignments、templates 各新增一欄 workspace_version（預設 0，只用來做「樂觀鎖」：
--      新版頁面存檔時帶版本號，版本不符就回 409，避免覆蓋別人的修改）。
--      Postgres 11 以上新增「有常數預設值的欄位」只改系統目錄，不會重寫整張表，不鎖很久。
--   2. 在 assignments / templates / logs / assignment_collaborators 上建立版本觸發器：
--      每次 UPDATE 自動讓版本 +1；logs、協作者、範本變動時順手讓所屬任務版本 +1。
--      舊版頁面照常寫入，只是版本號會跟著動，舊版行為與回傳資料不變。
--      觸發器名稱皆為本草稿自建（正式區舊 migrations 查無同名或其他這四張表的觸發器），
--      用 DROP TRIGGER IF EXISTS 再建立，可重複執行。
--   3. 新增 5 張「去重收據」表（workspace_task_receipts、_copy_receipts、_archive_receipts、
--      workspace_template_receipts、workspace_task_dispatch_receipts）：同一個 writeId 重送時回同樣結果，
--      不重複寫入。皆啟用 RLS、不開任何政策，anon／authenticated 無法讀寫，只有 service_role 使用。
--   4. 新增 5 個 workspace_* 函式（存檔任務、複製封存任務、封存範本下的任務、存範本、派發/複製任務）。
--      皆為新函式，不替換任何舊版函式；只授權給 service_role，不授權給任何登入角色。
--   5. 不新增權限碼、不授權任何角色（授權由老闆之後用勾選頁決定）。本檔完全沒有呼叫 has_permission。
--
-- 對既有資料的影響：不修改、不刪除任何既有資料列（只新增欄位並預設 0）。
-- 備份：不需要資料備份；若要保險，執行前可先備份 assignments 與 templates 的 id 筆數（見 20_task_core.verify.sql 的筆數對照）。
-- 還原：20_task_core.rollback.sql（會連同收據表一起移除；收據只用於重送去重，移除不影響業務資料）。
-- 驗證：20_task_core.verify.sql（只有 SELECT）。
-- 可重複執行：ADD COLUMN IF NOT EXISTS、CREATE TABLE IF NOT EXISTS、CREATE OR REPLACE、DROP TRIGGER IF EXISTS 後重建。
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.assignments') IS NULL OR to_regclass('public.templates') IS NULL
     OR to_regclass('public.logs') IS NULL OR to_regclass('public.assignment_collaborators') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: assignments／templates／logs／assignment_collaborators／profiles 其中之一不存在';
  END IF;
END $$;

-- ---- 來自 DEV 20261028050000_vue_tasks ----
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

-- ---- 來自 DEV 20261028060000_vue_task_archive ----
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

-- ---- 來自 DEV 20261028070000_vue_task_archive_action ----
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

-- ---- 來自 DEV 20261028080000_vue_task_template ----
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS workspace_version bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.workspace_template_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.workspace_version:=OLD.workspace_version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS workspace_template_version ON public.templates;
CREATE TRIGGER workspace_template_version BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.workspace_template_version();
CREATE TABLE IF NOT EXISTS public.workspace_template_receipts(write_id uuid PRIMARY KEY,actor_id uuid NOT NULL,body_hash text NOT NULL,result_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.workspace_template_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_template_receipts FROM anon,authenticated;
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

-- ---- 來自 DEV 20261028090000_vue_task_dispatch ----
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

-- 收據表補明確授權給 service_role（Supabase 預設通常已有，這裡明示；不授權 anon／authenticated）
GRANT ALL ON public.workspace_task_receipts, public.workspace_task_copy_receipts, public.workspace_task_archive_receipts,
             public.workspace_template_receipts, public.workspace_task_dispatch_receipts TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
