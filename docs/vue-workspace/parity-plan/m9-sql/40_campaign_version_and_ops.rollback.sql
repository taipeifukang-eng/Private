-- 活動版本與營運 還原（對應同名主檔）。可重複執行。
-- 白話：移除 3 個營運函式、冪等紀錄表、版本觸發器與函式、唯一索引、兩個欄位；bucket 不用 SQL 刪（Storage 保護觸發器不允許），留著無害。
-- 備份：刪欄位前，先把 workspace_version／workspace_request_id 複製到 public.bak_campaigns_workspace_cols_20261124（已存在就不覆蓋）；
--       workspace_campaign_requests 也先備份到 public.bak_workspace_campaign_requests_20261124。備份表確認無用後再手動 DROP。
-- 影響：舊版畫面不受影響（舊版不使用這些欄位／函式）。bucket 一律保留，要刪請走 Dashboard／Storage API。
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.bak_campaigns_workspace_cols_20261124') IS NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='workspace_version') THEN
    EXECUTE 'CREATE TABLE public.bak_campaigns_workspace_cols_20261124 AS SELECT id, workspace_version, workspace_request_id FROM public.campaigns';
  END IF;
  IF to_regclass('public.bak_workspace_campaign_requests_20261124') IS NULL
     AND to_regclass('public.workspace_campaign_requests') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE public.bak_workspace_campaign_requests_20261124 AS SELECT * FROM public.workspace_campaign_requests';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.workspace_campaign_checklist_order(uuid,uuid,uuid[]);
DROP FUNCTION IF EXISTS public.workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_campaign_state(text,uuid,uuid);
DROP TABLE IF EXISTS public.workspace_campaign_requests;
DROP TRIGGER IF EXISTS trg_workspace_campaign_version ON public.campaigns;
DROP FUNCTION IF EXISTS public.workspace_campaign_version();
DROP INDEX IF EXISTS public.ux_campaigns_workspace_request;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS workspace_request_id, DROP COLUMN IF EXISTS workspace_version;
-- 不用 SQL 刪 bucket：Supabase 的 storage 保護觸發器不允許直接 DELETE storage.buckets／storage.objects（會讓整個還原交易失敗）。
-- bucket campaign-department-assets 留著無害（私有、空的）；要刪請到 Dashboard 的 Storage 或用 Storage API，先清空再刪。
DO $$ BEGIN RAISE NOTICE 'bucket campaign-department-assets 未刪除（請由 Dashboard／Storage API 處理）'; END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
