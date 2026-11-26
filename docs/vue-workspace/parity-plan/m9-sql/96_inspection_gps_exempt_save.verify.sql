-- 唯讀驗證 96_inspection_gps_exempt_save.sql（只有 SELECT）。每列 ok 應為 true。
SELECT 'inspection_masters.gps_exempt（boolean NOT NULL 預設 false）' AS item,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters' AND column_name='gps_exempt' AND data_type='boolean' AND is_nullable='NO' AND column_default='false') AS ok
UNION ALL SELECT '前置：can_use_inspection_gps_exempt() 存在',
  to_regprocedure('public.can_use_inspection_gps_exempt()') IS NOT NULL
UNION ALL SELECT '前置：兩個定位 trigger 都在',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.inspection_masters'::regclass AND NOT tgisinternal
     AND tgname IN ('trg_inspection_masters_require_gps','trg_inspection_masters_gps_exempt_guard'))=2
UNION ALL SELECT 'workspace_save_inspection 存在',
  to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
UNION ALL SELECT '函式內容含 gps_exempt 寫入、gps 與設定版本檢查',
  COALESCE((SELECT prosrc LIKE '%gps_exempt%' AND prosrc LIKE '%gps_latitude%' AND prosrc LIKE '%SETTINGS_CONFLICT%' FROM pg_proc WHERE oid=to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)')),false)
UNION ALL SELECT '函式只有 service_role 可執行（anon/authenticated 不可）',
  to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
  AND NOT has_function_privilege('anon','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)','EXECUTE');
