-- 01-ga-improve-b1-buyer-companies 只讀驗證（G11 多家買受人公司）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '資料表 ga_buyer_companies 存在' AS check_name, CASE WHEN to_regclass('public.ga_buyer_companies') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_buyer_companies 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_buyer_companies')), false) AND NOT has_table_privilege('authenticated', 'public.ga_buyer_companies', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_buyer_companies', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_buyer_company_events 存在' AS check_name, CASE WHEN to_regclass('public.ga_buyer_company_events') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_buyer_company_events 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_buyer_company_events')), false) AND NOT has_table_privilege('authenticated', 'public.ga_buyer_company_events', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_buyer_company_events', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_purchase_orders.buyer_company_id 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_orders' AND column_name = 'buyer_company_id') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.buyer_company_id 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'buyer_company_id') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.buyer_title_snapshot 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'buyer_title_snapshot') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_payment_requests.buyer_tax_id_snapshot 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'buyer_tax_id_snapshot') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_events_immutable 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_events_immutable') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_events_immutable' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_buyer_default_id 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_default_id') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_default_id' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_buyer_sync_settings 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_sync_settings') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_sync_settings' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_buyer_from_settings 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_from_settings') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_from_settings' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_buyer 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_buyer') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_buyer' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_set_buyer 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_buyer') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_set_buyer' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_po_header_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_header_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_header_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_po_data_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_data_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_data_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_po_buyer_default 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_buyer_default') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_buyer_default' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_pay_buyer_freeze 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_buyer_freeze') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_pay_buyer_freeze' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_buyer_rows 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_rows') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_buyer_rows' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_buyer_company_list 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_buyer_company_list' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_buyer_company_save 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_buyer_company_save' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_buyer_company_set_default 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_buyer_company_set_default' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '函式 ga_ws_buyer_company_deactivate 存在、登入者可執行、匿名不可' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ws_buyer_company_deactivate' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_settings_get() 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_settings_get()') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_settings_get()'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_settings_set(jsonb,timestamp with time zone) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_settings_set(jsonb,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_settings_set(jsonb,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_request_get(uuid) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_get(uuid)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_get(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_header_apply(uuid,jsonb) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_po_header_apply(uuid,jsonb)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_po_header_apply(uuid,jsonb)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_data(uuid) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_po_data(uuid)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_po_data(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_request_create(jsonb,text) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_ub_create(jsonb,text) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone) 已加掛 GAIB1-S2' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S2' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有殘留的暫時替換函式 ga_ib1_swap／ga_ib1_nl' AS check_name, CASE WHEN to_regprocedure('public.ga_ib1_swap(text,text,text,text)') IS NULL AND to_regprocedure('public.ga_ib1_nl(text,text)') IS NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有新增任何權限碼（預付、同仁帳戶、買受人公司都用既有權限）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.permissions WHERE code ~ '(prepay|payout|buyer_compan|reimburs)') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '預設公司至多一家且統編在啟用中不重複（部分唯一索引）' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ga_buyer_companies_default_uidx') AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ga_buyer_companies_tax_active_uidx') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有買受人設定已搬成預設公司（抬頭與統編兩個值都有且統編 8 碼才搬；否則不搬，請總務補齊後手動新增）' AS check_name, CASE WHEN CASE WHEN EXISTS (SELECT 1 FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id' AND btrim(value_text) ~ '^[0-9]{8}$') AND EXISTS (SELECT 1 FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title' AND btrim(COALESCE(value_text, '')) <> '') THEN EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE is_default AND is_active) ELSE true END THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '公司事件表有不可修改刪除的觸發器' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_buyer_company_events_immutable' AND NOT tgisinternal) THEN 'pass' ELSE 'fail' END AS result
ORDER BY 1;
