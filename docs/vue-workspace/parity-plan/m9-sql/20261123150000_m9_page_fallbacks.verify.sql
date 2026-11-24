-- M9 逐頁「回舊版」備援開關：套用後唯讀驗證（只有 SELECT，可隨時重複執行）。每列 ok 應為 true。
-- 對應主檔：20261123150000_m9_page_fallbacks.sql（本驗證檔是審查時補的，主檔內容未動）。
-- 請在套用主檔之後執行；rollback 之後不要跑（表已不存在，權限檢查與最後一段查詢會直接報錯，這是正常的）。
SELECT '資料表 workspace_page_fallbacks 存在且啟用 RLS' AS item,
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.workspace_page_fallbacks')), false) AS ok
UNION ALL SELECT '資料表 workspace_page_fallback_events 存在且啟用 RLS',
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.workspace_page_fallback_events')), false)
UNION ALL SELECT '兩張表都沒有任何 RLS 政策（anon／authenticated 不可讀寫）',
  to_regclass('public.workspace_page_fallbacks') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('workspace_page_fallbacks', 'workspace_page_fallback_events'))
UNION ALL SELECT 'anon／authenticated 對兩張表沒有任何權限',
  to_regclass('public.workspace_page_fallbacks') IS NOT NULL
  AND NOT (has_table_privilege('anon', 'public.workspace_page_fallbacks', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.workspace_page_fallbacks', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('anon', 'public.workspace_page_fallback_events', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.workspace_page_fallback_events', 'SELECT,INSERT,UPDATE,DELETE'))
UNION ALL SELECT '稽核表 service_role 只有 SELECT、INSERT（沒有 UPDATE、DELETE）',
  to_regclass('public.workspace_page_fallback_events') IS NOT NULL
  AND has_table_privilege('service_role', 'public.workspace_page_fallback_events', 'SELECT')
  AND has_table_privilege('service_role', 'public.workspace_page_fallback_events', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.workspace_page_fallback_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.workspace_page_fallback_events', 'DELETE')
UNION ALL SELECT '函式 workspace_set_page_fallback 存在、只有 service_role 可執行',
  to_regprocedure('public.workspace_set_page_fallback(text,boolean,text,uuid)') IS NOT NULL
  AND has_function_privilege('service_role', 'public.workspace_set_page_fallback(text,boolean,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.workspace_set_page_fallback(text,boolean,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_set_page_fallback(text,boolean,text,uuid)', 'EXECUTE')
UNION ALL SELECT '索引 idx_workspace_page_fallback_events_kind 存在',
  to_regclass('public.idx_workspace_page_fallback_events_kind') IS NOT NULL;

-- 目前哪些頁面被切回舊版（上線演練後應為 0 列，除非正在使用備援）
SELECT kind, use_legacy, reason, updated_at
FROM public.workspace_page_fallbacks
WHERE use_legacy
ORDER BY kind;
