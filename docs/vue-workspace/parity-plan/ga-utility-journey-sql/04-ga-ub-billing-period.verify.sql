-- 04-ga-ub-billing-period 只讀驗證（水電帳單計費期間）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '帳單表有 service_period_start、service_period_end 兩欄' AS check_name,
  CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name IN ('service_period_start', 'service_period_end')) = 2 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '請款明細快照表有同名兩欄' AS check_name,
  CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_request_bill_lines' AND column_name IN ('service_period_start', 'service_period_end')) = 2 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '兩欄都允許空值（舊資料不會失敗）' AS check_name,
  CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('ga_utility_bills', 'ga_payment_request_bill_lines') AND column_name LIKE 'service_period_%' AND is_nullable = 'YES') = 4 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT 'CHECK：要嘛都填且起 <= 迄，要嘛都空' AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_utility_bills'::regclass AND conname = 'ga_utility_bills_service_period_check' AND convalidated) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '現有帳單沒有任何一筆違反計費期間 CHECK（只填一邊或起大於迄）' AS check_name,
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.ga_utility_bills WHERE (service_period_start IS NULL) <> (service_period_end IS NULL) OR service_period_start > service_period_end) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '帳單儲存函式已含計費期間規則（PERIOD_REQUIRED）' AS check_name,
  CASE WHEN to_regprocedure('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)') IS NOT NULL
    AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)'::regprocedure) LIKE '%PERIOD_REQUIRED%' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '建立請款明細函式會快照計費期間' AS check_name,
  CASE WHEN to_regprocedure('public.ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])') IS NOT NULL
    AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.ga_pay_ub_apply_bills(uuid,uuid,date,uuid[])'::regprocedure) LIKE '%service_period_start%' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '帳單 JSON、請款明細 JSON、候選帳單都帶計費期間' AS check_name,
  CASE WHEN (SELECT prosrc FROM pg_proc WHERE oid = 'public.ga_ub_json_ext(uuid)'::regprocedure) LIKE '%service_period_start%'
    AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.ga_pay_ub_json_ext(uuid,boolean)'::regprocedure) LIKE '%service_period_start%'
    AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.ga_ws_pay_ub_candidates(jsonb)'::regprocedure) LIKE '%service_period_start%' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '新函式存在、唯讀（STABLE）' AS check_name,
  CASE WHEN to_regprocedure('public.ga_ws_ub_prev_period(jsonb,uuid)') IS NOT NULL AND to_regprocedure('public.ga_ws_ub_report_details(text,integer,text)') IS NOT NULL
    AND (SELECT count(*) FROM pg_proc WHERE oid IN ('public.ga_ws_ub_prev_period(jsonb,uuid)'::regprocedure, 'public.ga_ws_ub_report_details(text,integer,text)'::regprocedure) AND provolatile = 's') = 2 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '新函式只開放給登入者（匿名不能執行）' AS check_name,
  CASE WHEN to_regprocedure('public.ga_ws_ub_prev_period(jsonb,uuid)') IS NOT NULL AND to_regprocedure('public.ga_ws_ub_report_details(text,integer,text)') IS NOT NULL
    AND has_function_privilege('authenticated', 'public.ga_ws_ub_prev_period(jsonb,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ga_ws_ub_prev_period(jsonb,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.ga_ws_ub_report_details(text,integer,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ga_ws_ub_report_details(text,integer,text)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有年度逐月、月季年報表函式仍在' AS check_name,
  CASE WHEN to_regprocedure('public.ga_ws_ub_year_matrix(integer)') IS NOT NULL AND to_regprocedure('public.ga_ws_ub_report(text,integer,text)') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result;
