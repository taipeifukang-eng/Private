-- 還原 60_task_delete_and_proxy.sql。
-- 注意（資料會消失，執行前請讀完）：
--   * workspace_task_delete_audit（刪除稽核紀錄）整張移除；logs.proxy 欄位移除，「誰代做」的標記隨之消失（勾選紀錄本身保留）。
--   * 移除前會先複製到備份表 m9_backup_m3_delete_audit、m9_backup_m3_log_proxy（可重複執行、不覆蓋已備份的列）。
--   * 已被刪除的任務／模板（含勾選紀錄）無法由本檔復原，要找回只能靠整庫備份。
--   * 若前端已改用 workspace_save_task_v2 或刪除函式，請先把前端切回舊版再還原，否則呼叫會失敗。
-- workspace_save_task_template 只還原「支援人員」這一段（回到只允許所選部門人員），不動 20_task_core 的其餘內容。
BEGIN;

CREATE TABLE IF NOT EXISTS public.m9_backup_m3_delete_audit (LIKE public.workspace_task_delete_audit INCLUDING DEFAULTS);
ALTER TABLE public.m9_backup_m3_delete_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_backup_m3_delete_audit FROM PUBLIC, anon, authenticated;
INSERT INTO public.m9_backup_m3_delete_audit
SELECT s.* FROM public.workspace_task_delete_audit s
WHERE NOT EXISTS (SELECT 1 FROM public.m9_backup_m3_delete_audit b WHERE b.id = s.id);

CREATE TABLE IF NOT EXISTS public.m9_backup_m3_log_proxy (
  log_id uuid PRIMARY KEY, assignment_id uuid, user_id uuid, step_id text, action text, log_created_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.m9_backup_m3_log_proxy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_backup_m3_log_proxy FROM PUBLIC, anon, authenticated;
INSERT INTO public.m9_backup_m3_log_proxy(log_id,assignment_id,user_id,step_id,action,log_created_at)
SELECT id,assignment_id,user_id,step_id,action,created_at FROM public.logs WHERE proxy
ON CONFLICT (log_id) DO NOTHING;

DROP FUNCTION IF EXISTS public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean);
ALTER TABLE public.logs DROP COLUMN IF EXISTS proxy;

DROP FUNCTION IF EXISTS public.workspace_delete_assignment(uuid,uuid);
DROP FUNCTION IF EXISTS public.workspace_delete_template(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.workspace_assignment_progress_complete(uuid);
DROP TABLE IF EXISTS public.workspace_task_delete_audit;

DO $m$
DECLARE
  def text;
  new_frag text := 'AND (p.department=s->>''department'' OR (coalesce(s->''support_users'',''[]''::jsonb) ? u.value AND coalesce(p.department,'''')<>'''')))) THEN RAISE EXCEPTION ''INVALID_MEMBER'';';
  old_frag text := 'AND p.department=s->>''department'')) THEN RAISE EXCEPTION ''INVALID_MEMBER'';';
BEGIN
  IF to_regprocedure('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)') IS NOT NULL THEN
    SELECT pg_get_functiondef('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)'::regprocedure) INTO def;
    IF position(new_frag in def) > 0 THEN
      EXECUTE replace(def, new_frag, old_frag);
    ELSE
      RAISE NOTICE 'workspace_save_task_template 不含支援人員改寫，略過';
    END IF;
  END IF;
END $m$;

NOTIFY pgrst,'reload schema';
COMMIT;
