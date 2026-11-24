-- 60_task_delete_and_proxy：任務 M3（刪除、協作代理、逐動作代理）正式區草稿。尚未套用，需人工審閱後才能執行。
--
-- 白話說明
--   這份把 DEV 的五支遷移（20261107120000、120100、130000、140000、150000）合併成「最終狀態」一次完成，
--   不假設 DEV 中間版本存在，也不需要照 DEV 時間順序一支一支套：
--   1. 刪除：新增稽核表 workspace_task_delete_audit（只由 service_role 存取）、判斷「任務是否全部完成」的函式
--      workspace_assignment_progress_complete（以勾選紀錄推算，不看 assignments.status）、
--      刪除已完成任務 workspace_delete_assignment、刪除流程模板（有進行中任務就擋）workspace_delete_template，
--      兩個刪除函式在同一交易內先寫稽核紀錄再刪 logs／協作者／任務／模板。
--   2. 支援人員：把「任務核心」(20_task_core) 已建立的 workspace_save_task_template 改成允許
--      「該區段 support_users 名單內、且有部門的人」跨部門被指派。以現行函式原始碼為基礎做精準字串替換
--      （不是整份覆蓋），找不到預期片語就中止，不會改壞；已改過則略過。
--   3. 代理：logs 新增 proxy 欄位（預設 false），新增 workspace_save_task_v2（與舊版 workspace_save_task 並存、舊版不動）。
--      每筆勾選可各自帶 "proxy": true/false，沒帶時沿用 p_proxy；p_proxy = false 仍要求操作人是協作者。
--
-- 前置條件（缺少會直接中止，什麼都不會改）：必須先套用 20_task_core.sql
--   （assignments.workspace_version、workspace_task_receipts、workspace_template_receipts、workspace_save_task_template）。
-- 權限：不建立、不授權任何權限碼。task.manage、task.view_own、task.view_archived 在正式區既有
--   （20260724002545_production_core_compatibility.sql），授權由老闆的勾選頁決定。
--   本檔所有新函式只授權 service_role，沒有 has_permission 呼叫；權限判斷在應用層（API）做，
--   語意依正式區 has_permission（不檢查 roles.is_active、DB 端無 admin 繞過）。
-- 備份：請先執行 60_task_delete_and_proxy.backup.sql。還原：60_task_delete_and_proxy.rollback.sql。驗證：60_task_delete_and_proxy.verify.sql（唯讀）。
-- 可重複執行：CREATE TABLE IF NOT EXISTS、CREATE OR REPLACE、ADD COLUMN IF NOT EXISTS，支援人員改寫有「已改過就略過」判斷。
-- 不修改、不刪除任何既有資料列；既有資料表只新增 logs.proxy 欄位（NOT NULL DEFAULT false，既有紀錄一律視為非代做）。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.templates') IS NULL
     OR to_regclass('public.assignments') IS NULL OR to_regclass('public.logs') IS NULL
     OR to_regclass('public.assignment_collaborators') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: profiles／templates／assignments／logs／assignment_collaborators 其中之一不存在';
  END IF;
  IF to_regclass('public.workspace_task_receipts') IS NULL OR to_regclass('public.workspace_template_receipts') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20_task_core.sql（workspace_task_receipts／workspace_template_receipts 不存在）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assignments' AND column_name='workspace_version') THEN
    RAISE EXCEPTION 'Missing prerequisite: assignments.workspace_version 不存在，請先套用 20_task_core.sql';
  END IF;
  IF to_regprocedure('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: workspace_save_task_template 不存在，請先套用 20_task_core.sql';
  END IF;
END $$;

-- ===== 1. 刪除：稽核表與函式 =====
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
REVOKE ALL ON public.workspace_task_delete_audit FROM PUBLIC, anon, authenticated;

-- 全部區段所有步驟（含子步驟）最近一筆勾選動作皆為 complete 才算完成
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

CREATE OR REPLACE FUNCTION public.workspace_delete_assignment(p_assignment uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a assignments%ROWTYPE; t templates%ROWTYPE; audit_id uuid; collab_count int; log_count int; collab_names jsonb;
BEGIN
  SELECT * INTO a FROM assignments WHERE id=p_assignment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF NOT public.workspace_assignment_progress_complete(a.id) THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_COMPLETED'; END IF;
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
  IF EXISTS(SELECT 1 FROM assignments WHERE template_id=p_template AND archived=false AND NOT public.workspace_assignment_progress_complete(id)) THEN RAISE EXCEPTION 'TEMPLATE_HAS_ACTIVE'; END IF;
  SELECT count(*),count(*) FILTER (WHERE public.workspace_assignment_progress_complete(id)),count(*) FILTER (WHERE archived) INTO total,completed,archived_count FROM assignments WHERE template_id=p_template;
  INSERT INTO workspace_task_delete_audit(kind,actor_id,template_id,template_title,summary)
  VALUES('template',p_actor,t.id,t.title,jsonb_build_object('created_by',t.created_by,'created_at',t.created_at,'assignment_count',total,'completed_count',completed,'archived_count',archived_count))
  RETURNING id INTO audit_id;
  DELETE FROM logs WHERE assignment_id IN (SELECT id FROM assignments WHERE template_id=p_template);
  DELETE FROM assignment_collaborators WHERE assignment_id IN (SELECT id FROM assignments WHERE template_id=p_template);
  DELETE FROM assignments WHERE template_id=p_template;
  DELETE FROM templates WHERE id=p_template;
  RETURN audit_id;
END $$;

REVOKE ALL ON FUNCTION public.workspace_assignment_progress_complete(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_delete_assignment(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_delete_template(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_assignment_progress_complete(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_delete_assignment(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_delete_template(uuid,uuid,text) TO service_role;

-- ===== 2. 支援人員：以現行 workspace_save_task_template 為基礎精準替換 =====
DO $m$
DECLARE
  def text;
  old_frag text := 'AND p.department=s->>''department'')) THEN RAISE EXCEPTION ''INVALID_MEMBER'';';
  new_frag text := 'AND (p.department=s->>''department'' OR (coalesce(s->''support_users'',''[]''::jsonb) ? u.value AND coalesce(p.department,'''')<>'''')))) THEN RAISE EXCEPTION ''INVALID_MEMBER'';';
BEGIN
  SELECT pg_get_functiondef('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)'::regprocedure) INTO def;
  IF position('support_users' in def) > 0 THEN
    RAISE NOTICE 'workspace_save_task_template 已支援 support_users，略過';
  ELSIF position(old_frag in def) = 0 THEN
    RAISE EXCEPTION 'workspace_save_task_template 現行內容與預期不符（找不到 INVALID_MEMBER 部門檢查），請人工比對後再處理';
  ELSE
    EXECUTE replace(def, old_frag, new_frag);
  END IF;
END $m$;

-- ===== 3. 代理：logs.proxy 與 workspace_save_task_v2（逐動作代理最終版） =====
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS proxy boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.workspace_save_task_v2(p_id uuid,p_actor uuid,p_version bigint,p_write uuid,p_hash text,p_actions jsonb,p_status text,p_proxy boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a assignments%ROWTYPE; receipt workspace_task_receipts%ROWTYPE; entry jsonb; idx int:=0; stamp timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_write::text,0));
  SELECT * INTO a FROM assignments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR a.archived THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
  IF NOT p_proxy AND NOT EXISTS(SELECT 1 FROM assignment_collaborators WHERE assignment_id=p_id AND user_id=p_actor) THEN RAISE EXCEPTION 'TASK_CONFLICT'; END IF;
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
    INSERT INTO logs(assignment_id,user_id,step_id,action,note,created_at,proxy)
    VALUES(p_id,p_actor,entry->>'step_id',entry->>'action',entry->>'note',stamp+idx*interval '1 microsecond',coalesce((entry->>'proxy')::boolean,p_proxy));
    idx:=idx+1;
  END LOOP;
  UPDATE assignments SET status=p_status,completed_at=CASE WHEN p_status='completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE id=p_id;
  INSERT INTO workspace_task_receipts(write_id,actor_id,assignment_id,body_hash) VALUES(p_write,p_actor,p_id,p_hash);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
