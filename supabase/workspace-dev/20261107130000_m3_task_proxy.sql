-- M3 B.1：管理者代為勾選並記錄代做者。只用於 DEV。rollback 見同名 .rollback.sql。
-- logs.proxy = true 表示該筆勾選／取消／備註由「非任務參與者的管理者」代做，logs.user_id 就是代做者，created_at 是時間。
-- 新函式 workspace_save_task_v2 與舊版 workspace_save_task 並存（舊版不動）：
--   p_proxy = false：行為同舊版，操作人必須是協作者；
--   p_proxy = true ：不要求協作者身分（應用層已確認有任務管理權限），每筆紀錄標 proxy = true。
BEGIN;
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
    VALUES(p_id,p_actor,entry->>'step_id',entry->>'action',entry->>'note',stamp+idx*interval '1 microsecond',p_proxy);
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
