-- 驗證 03-ga-utility-payment-request-core（只有 SELECT，可重複執行）。每列一個檢查項目：status 是 pass 或 fail；全部 pass 才算這一階段到位。
-- 套用後執行；撤回後執行則應該大部分是 fail（代表已撤回）。不含任何寫入。
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'fail' END AS status
  FROM (
  SELECT 1 AS n, '函式 ga_pay_ub_eligible(ga_utility_bills,uuid,date,uuid)' AS check_name, (to_regprocedure('public.ga_pay_ub_eligible(ga_utility_bills,uuid,date,uuid)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 2 AS n, '函式 ga_pay_ub_excluded_stats(uuid,date)' AS check_name, (to_regprocedure('public.ga_pay_ub_excluded_stats(uuid,date)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 3 AS n, '函式 ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])' AS check_name, (to_regprocedure('public.ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])') IS NOT NULL) AS ok
  UNION ALL
  SELECT 4 AS n, '函式 ga_pay_ub_json_ext(uuid,boolean)' AS check_name, (to_regprocedure('public.ga_pay_ub_json_ext(uuid,boolean)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 5 AS n, '函式 ga_pay_ub_submit_check()' AS check_name, (to_regprocedure('public.ga_pay_ub_submit_check()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 6 AS n, '函式 ga_pay_ub_sync()' AS check_name, (to_regprocedure('public.ga_pay_ub_sync()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 7 AS n, '函式 ga_ws_pay_ub_candidates(jsonb)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_candidates(jsonb)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 8 AS n, '函式 ga_ws_pay_ub_create(jsonb,text)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 9 AS n, '函式 ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 10 AS n, '函式 ga_ws_pay_export_ub(jsonb)' AS check_name, (to_regprocedure('public.ga_ws_pay_export_ub(jsonb)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 11 AS n, '觸發器 trg_ga_pay_ub_submit_check' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_ub_submit_check' AND tgrelid = 'public.ga_payment_requests'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 12 AS n, '觸發器 trg_ga_pay_ub_sync' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_ub_sync' AND tgrelid = 'public.ga_payment_requests'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 13 AS n, '對外函式登入者可執行 ga_ws_pay_ub_candidates(jsonb)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_candidates(jsonb)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_pay_ub_candidates(jsonb)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_pay_ub_candidates(jsonb)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 14 AS n, '對外函式登入者可執行 ga_ws_pay_ub_create(jsonb,text)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 15 AS n, '對外函式登入者可執行 ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)' AS check_name, (to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 16 AS n, '對外函式登入者可執行 ga_ws_pay_export_ub(jsonb)' AS check_name, (to_regprocedure('public.ga_ws_pay_export_ub(jsonb)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_pay_export_ub(jsonb)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_pay_export_ub(jsonb)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 17 AS n, '內部函式未開放給登入者 ga_pay_ub_eligible(ga_utility_bills,uuid,date,uuid)' AS check_name, (to_regprocedure('public.ga_pay_ub_eligible(ga_utility_bills,uuid,date,uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_pay_ub_eligible(ga_utility_bills,uuid,date,uuid)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 18 AS n, '內部函式未開放給登入者 ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])' AS check_name, (to_regprocedure('public.ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 19 AS n, '內部函式未開放給登入者 ga_pay_ub_sync()' AS check_name, (to_regprocedure('public.ga_pay_ub_sync()') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_pay_ub_sync()'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 20 AS n, '內部函式未開放給登入者 ga_pay_ub_submit_check()' AS check_name, (to_regprocedure('public.ga_pay_ub_submit_check()') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_pay_ub_submit_check()'), 'EXECUTE')) AS ok
  ) c
 ORDER BY n;
