-- 01-ga-pr-print-fields 只讀驗證（請款單紙本格式列印）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '欄位 ga_payment_requests.applicant_name 存在且可為空' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'applicant_name' AND is_nullable = 'YES') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.applicant_dept 存在且可為空' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'applicant_dept' AND is_nullable = 'YES') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.attach_docs 存在且可為空' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'attach_docs' AND is_nullable = 'YES') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.reason_override 存在且可為空' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'reason_override' AND is_nullable = 'YES') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '長度限制 ga_pr_print_fields_len 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_pr_print_fields_len') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_pay_request_print_fields_set 存在、登入者可執行、匿名不可執行' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_print_fields_set(uuid,jsonb)') IS NOT NULL AND has_function_privilege('authenticated', 'public.ga_ws_pay_request_print_fields_set(uuid,jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ga_ws_pay_request_print_fields_set(uuid,jsonb)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_pay_request_print_extra 存在、登入者可執行、匿名不可執行' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_print_extra(uuid)') IS NOT NULL AND has_function_privilege('authenticated', 'public.ga_ws_pay_request_print_extra(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ga_ws_pay_request_print_extra(uuid)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '兩支新函式都是 SECURITY DEFINER 並固定 search_path' AS check_name, CASE WHEN (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('ga_ws_pay_request_print_fields_set', 'ga_ws_pay_request_print_extra') AND p.prosecdef AND p.proconfig IS NOT NULL AND array_to_string(p.proconfig, ',') LIKE '%search_path%') = 2 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有請款單函式沒有被改動（沒有 print 加掛標記）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname IN ('ga_pay_request_json', 'ga_ws_pay_request_get', 'ga_ws_pay_request_update', 'ga_ws_pay_request_action') AND pg_get_functiondef(p.oid) ILIKE '%print_fields%') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有新增任何權限碼（permissions 表沒有含 print 的碼）' AS check_name, CASE WHEN to_regclass('public.permissions') IS NULL OR NOT EXISTS (SELECT 1 FROM public.permissions WHERE to_jsonb(permissions)::text ILIKE '%pr_print%') THEN 'pass' ELSE 'fail' END AS result;
