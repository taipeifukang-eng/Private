-- 活動版本與營運 唯讀驗證（只有 SELECT，可隨時執行）。每列 ok 應全為 true。
SELECT 'campaigns.workspace_version 欄位' AS item, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='workspace_version' AND is_nullable='NO') AS ok
UNION ALL SELECT 'campaigns.workspace_request_id 欄位', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='workspace_request_id')
UNION ALL SELECT '唯一索引 ux_campaigns_workspace_request', to_regclass('public.ux_campaigns_workspace_request') IS NOT NULL
UNION ALL SELECT '觸發器 trg_workspace_campaign_version', EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.campaigns'::regclass AND tgname='trg_workspace_campaign_version' AND NOT tgisinternal)
UNION ALL SELECT '舊版觸發器 trg_campaigns_updated_at 仍在', EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.campaigns'::regclass AND tgname='trg_campaigns_updated_at' AND NOT tgisinternal)
UNION ALL SELECT '函式 workspace_campaign_version', to_regprocedure('public.workspace_campaign_version()') IS NOT NULL
UNION ALL SELECT '函式 workspace_campaign_state', to_regprocedure('public.workspace_campaign_state(text,uuid,uuid)') IS NOT NULL
UNION ALL SELECT '函式 workspace_campaign_replace', to_regprocedure('public.workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text)') IS NOT NULL
UNION ALL SELECT '函式 workspace_campaign_checklist_order', to_regprocedure('public.workspace_campaign_checklist_order(uuid,uuid,uuid[])') IS NOT NULL
UNION ALL SELECT '表 workspace_campaign_requests 且啟用 RLS', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.workspace_campaign_requests')),false)
UNION ALL SELECT 'anon／authenticated 不可執行營運函式', NOT (has_function_privilege('anon','public.workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','public.workspace_campaign_replace(uuid,uuid,text,uuid,uuid,jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','public.workspace_campaign_state(text,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.workspace_campaign_checklist_order(uuid,uuid,uuid[])','EXECUTE'))
UNION ALL SELECT 'bucket campaign-department-assets 私有且限制 5MB', EXISTS(SELECT 1 FROM storage.buckets WHERE id='campaign-department-assets' AND public=false AND file_size_limit=5242880)
UNION ALL SELECT 'campaigns 版本欄位無空值', NOT EXISTS(SELECT 1 FROM public.campaigns WHERE workspace_version IS NULL);
