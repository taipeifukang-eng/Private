-- 還原 20261107130000_m3_task_proxy.sql（logs.proxy 欄位會移除，代做標記隨之消失，勾選紀錄本身保留）。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean);
ALTER TABLE public.logs DROP COLUMN IF EXISTS proxy;
NOTIFY pgrst,'reload schema';
COMMIT;
