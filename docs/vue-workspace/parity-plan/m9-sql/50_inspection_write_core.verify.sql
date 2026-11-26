-- 唯讀驗證 50_inspection_write_core.sql（只有 SELECT）。每列 ok 應為 true。
SELECT 'inspection_masters 3 新欄位' AS item,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters'
     AND column_name IN ('workspace_version','workspace_write_id','workspace_write_hash'))=3 AS ok
UNION ALL SELECT 'inspection_results.workspace_quantities',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_results' AND column_name='workspace_quantities')
UNION ALL SELECT 'workspace_version NOT NULL 且預設 1',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters' AND column_name='workspace_version' AND is_nullable='NO' AND column_default='1')
UNION ALL SELECT '版本觸發器存在（BEFORE UPDATE）',
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_workspace_inspection_version' AND tgrelid='public.inspection_masters'::regclass AND NOT tgisinternal)
UNION ALL SELECT 'workspace_save_inspection 存在',
  to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
UNION ALL SELECT '函式內容含 gps 寫入與設定版本檢查',
  COALESCE((SELECT prosrc LIKE '%gps_latitude%' AND prosrc LIKE '%SETTINGS_CONFLICT%' FROM pg_proc WHERE oid=to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)')),false)
UNION ALL SELECT '函式只有 service_role 可執行（anon/authenticated 不可）',
  to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
  AND NOT has_function_privilege('anon','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE')
UNION ALL SELECT '前置：定位 trigger 函式存在',
  to_regprocedure('public.enforce_inspection_gps_on_insert()') IS NOT NULL
UNION ALL SELECT '前置：巡店設定版本表存在',
  to_regclass('public.workspace_inspection_settings_revision') IS NOT NULL
UNION ALL SELECT '前置：client_request_id 唯一索引存在',
  EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_inspection_masters_client_request_id');
