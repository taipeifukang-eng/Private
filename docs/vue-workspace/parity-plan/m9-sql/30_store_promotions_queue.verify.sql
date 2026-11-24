-- M9 草稿 30 驗證：套用後執行，只有 SELECT。前面每列 ok 都應為 true。
SELECT 'requests 表存在且啟用 RLS' AS item,
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.workspace_promotion_requests')),false) AS ok
UNION ALL SELECT 'activation 表存在且啟用 RLS',
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.workspace_promotion_activation')),false)
UNION ALL SELECT '佇列待處理索引存在', to_regclass('public.workspace_promotion_activation_pending') IS NOT NULL
UNION ALL SELECT '四個函式都存在',
  to_regprocedure('public.workspace_promotion_snapshot(uuid,jsonb)') IS NOT NULL
  AND to_regprocedure('public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text)') IS NOT NULL
  AND to_regprocedure('public.workspace_queue_promotion_activation()') IS NOT NULL
  AND to_regprocedure('public.workspace_apply_due_promotions(date)') IS NOT NULL
UNION ALL SELECT '觸發器存在',
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='workspace_queue_promotion_activation' AND tgrelid=to_regclass('public.workspace_promotion_requests') AND NOT tgisinternal)
UNION ALL SELECT 'anon / authenticated 不可讀寫兩張表',
  NOT (has_table_privilege('anon','public.workspace_promotion_requests','SELECT')
    OR has_table_privilege('anon','public.workspace_promotion_requests','INSERT')
    OR has_table_privilege('authenticated','public.workspace_promotion_requests','SELECT')
    OR has_table_privilege('authenticated','public.workspace_promotion_requests','INSERT')
    OR has_table_privilege('anon','public.workspace_promotion_activation','SELECT')
    OR has_table_privilege('authenticated','public.workspace_promotion_activation','SELECT'))
UNION ALL SELECT '函式只有 service_role 可執行',
  has_function_privilege('service_role','public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text)','EXECUTE')
  AND has_function_privilege('service_role','public.workspace_apply_due_promotions(date)','EXECUTE')
  AND NOT has_function_privilege('anon','public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.workspace_apply_due_promotions(date)','EXECUTE');
-- 以下為資訊（人工查看，不是通過/失敗）：佇列狀態與排程
SELECT count(*) FILTER (WHERE processed_at IS NULL) AS pending, count(*) FILTER (WHERE processed_at IS NOT NULL) AS processed
  FROM public.workspace_promotion_activation;
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS pg_cron_installed;
