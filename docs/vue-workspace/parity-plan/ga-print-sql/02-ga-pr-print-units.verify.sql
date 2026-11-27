-- 02-ga-pr-print-units 只讀驗證（請款單列印使用單位逐列可改）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '欄位 ga_payment_requests.print_units 存在、型別 jsonb、可為空' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'print_units' AND data_type = 'jsonb' AND is_nullable = 'YES') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '格式限制 ga_pr_print_units_shape 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_pr_print_units_shape') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '儲存列印欄位函式已支援 units（函式內容含 print_units）' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_print_fields_set(uuid,jsonb)') IS NOT NULL AND pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_print_fields_set(uuid,jsonb)')) ILIKE '%print_units%' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '儲存列印欄位函式登入者可執行、匿名不可執行' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_print_fields_set(uuid,jsonb)') IS NOT NULL AND has_function_privilege('authenticated', 'public.ga_ws_pay_request_print_fields_set(uuid,jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.ga_ws_pay_request_print_fields_set(uuid,jsonb)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有請款單函式沒有被改動（沒有 print_units 加掛）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname IN ('ga_pay_request_json', 'ga_ws_pay_request_get', 'ga_ws_pay_request_update', 'ga_ws_pay_request_action') AND pg_get_functiondef(p.oid) ILIKE '%print_units%') THEN 'pass' ELSE 'fail' END AS result;
