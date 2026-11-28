-- 03-ga-ub-scan-upload 只讀驗證（水電帳單手機掃 QR 上傳）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '權杖資料表存在且開啟 RLS' AS check_name, CASE WHEN to_regclass('public.ga_ub_scan_tokens') IS NOT NULL
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ga_ub_scan_tokens'::regclass) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表沒有任何政策、匿名與登入者都不能直接讀寫' AS check_name, CASE WHEN to_regclass('public.ga_ub_scan_tokens') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ga_ub_scan_tokens')
  AND NOT has_table_privilege('anon', 'public.ga_ub_scan_tokens', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ga_ub_scan_tokens', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ga_ub_scan_tokens', 'INSERT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '五支函式都存在' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_scan_token_create(uuid,text)') IS NOT NULL
  AND to_regprocedure('public.ga_ws_ub_scan_token_revoke(uuid)') IS NOT NULL
  AND to_regprocedure('public.ga_ub_scan_token_status(text)') IS NOT NULL
  AND to_regprocedure('public.ga_ub_scan_token_commit(text,jsonb)') IS NOT NULL
  AND to_regprocedure('public.ga_ub_scan_bill_state(uuid)') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '發 QR 函式只給登入者、匿名不能執行' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_ub_scan_token_create(uuid,text)') IS NOT NULL
  AND has_function_privilege('authenticated', 'public.ga_ws_ub_scan_token_create(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_ws_ub_scan_token_create(uuid,text)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '權杖查詢與寫入函式只給系統帳號（匿名、登入者都不能執行）' AS check_name, CASE WHEN to_regprocedure('public.ga_ub_scan_token_status(text)') IS NOT NULL
  AND to_regprocedure('public.ga_ub_scan_token_commit(text,jsonb)') IS NOT NULL
  AND has_function_privilege('service_role', 'public.ga_ub_scan_token_status(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ga_ub_scan_token_commit(text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_ub_scan_token_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ga_ub_scan_token_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_ub_scan_token_commit(text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ga_ub_scan_token_commit(text,jsonb)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result;
