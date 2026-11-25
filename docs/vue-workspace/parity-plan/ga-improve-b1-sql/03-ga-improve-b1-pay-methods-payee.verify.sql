-- 03-ga-improve-b1-pay-methods-payee 只讀驗證（G4 付款方式與同仁代墊）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '資料表 ga_employee_payout_accounts 存在' AS check_name, CASE WHEN to_regclass('public.ga_employee_payout_accounts') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_employee_payout_accounts 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_employee_payout_accounts')), false) AND NOT has_table_privilege('authenticated', 'public.ga_employee_payout_accounts', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_employee_payout_accounts', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_employee_payout_account_events 存在' AS check_name, CASE WHEN to_regclass('public.ga_employee_payout_account_events') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_employee_payout_account_events 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_employee_payout_account_events')), false) AND NOT has_table_privilege('authenticated', 'public.ga_employee_payout_account_events', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_employee_payout_account_events', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.payee_type 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'payee_type') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.payee_profile_id 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'payee_profile_id') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.payee_name_snapshot 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'payee_name_snapshot') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.payee_account_snapshot 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'payee_account_snapshot') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.pay_card_last4 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'pay_card_last4') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.pay_platform 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'pay_platform') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_employee_active 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_employee_active') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_employee_active' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_payee_account_snapshot 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payee_account_snapshot') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payee_account_snapshot' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_set_payee 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_payee') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_payee' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_check_pay_fields 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_check_pay_fields') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_check_pay_fields' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_payee_guard 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payee_guard') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payee_guard' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_json_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_json_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_json_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_filter_ok 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_filter_ok') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_filter_ok' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_export_enrich 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_export_enrich') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_export_enrich' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_payout_account_save 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payout_account_save') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_payout_account_save' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_payout_account_get_own 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_payout_account_get_own' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_payout_account_set_own 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_payout_account_set_own' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_payout_account_get_for 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_payout_account_get_for' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_payout_account_set_for 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_payout_account_set_for' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_pay_employee_options 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_pay_employee_options' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_pay_my_reimbursements 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_pay_my_reimbursements' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_set_buyer 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_buyer') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_buyer' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_request_json(uuid,boolean,boolean,boolean) 已加掛 GAIB1-S4' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NOT NULL AND position('GAIB1-S4' IN pg_get_functiondef(to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 已加掛 GAIB1-S4' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S4' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_request_list(jsonb,integer,integer) 已加掛 GAIB1-S4' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)') IS NOT NULL AND position('GAIB1-S4' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_export(jsonb) 已加掛 GAIB1-S4' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_export(jsonb)') IS NOT NULL AND position('GAIB1-S4' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_export(jsonb)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有殘留的暫時替換函式 ga_ib1_swap／ga_ib1_nl' AS check_name, CASE WHEN to_regprocedure('public.ga_ib1_swap(text,text,text,text)') IS NULL AND to_regprocedure('public.ga_ib1_nl(text,text)') IS NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有新增任何權限碼（預付、同仁帳戶、買受人公司都用既有權限）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.permissions WHERE code ~ '(prepay|payout|buyer_compan|reimburs)') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '付款方式約束是超集（轉帳、現金、支票、信用卡、網購平台）' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_pay_method_check' AND pg_get_constraintdef(oid) LIKE '%TRANSFER%' AND pg_get_constraintdef(oid) LIKE '%CASH%' AND pg_get_constraintdef(oid) LIKE '%CHECK%' AND pg_get_constraintdef(oid) LIKE '%CREDIT_CARD%' AND pg_get_constraintdef(oid) LIKE '%ONLINE_PLATFORM%') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '付款對象守門觸發器存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_ib1_payee_guard' AND NOT tgisinternal) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有請款單的付款對象都是廠商、沒有代墊資料（套用當下）或代墊單都有同仁' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE (payee_type = 'EMPLOYEE') <> (payee_profile_id IS NOT NULL)) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '同仁帳戶事件表有不可修改刪除的觸發器' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_employee_payout_account_events_immutable' AND NOT tgisinternal) THEN 'pass' ELSE 'fail' END AS result
ORDER BY 1;
