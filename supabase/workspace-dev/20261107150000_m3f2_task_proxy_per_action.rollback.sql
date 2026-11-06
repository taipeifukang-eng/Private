-- 還原 20261107150000_m3f2_task_proxy_per_action.sql：函式回到「整筆儲存一個 proxy 旗標」的版本（logs.proxy 欄位與既有紀錄不動）。
BEGIN;
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
