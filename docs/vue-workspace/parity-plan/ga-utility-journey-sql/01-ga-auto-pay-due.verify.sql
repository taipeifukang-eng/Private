-- 01-ga-auto-pay-due 只讀驗證（付款日到期自動付款）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '欄位 paid_auto、auto_pay_off 存在、boolean、不可空、預設 false' AS check_name, CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name IN ('paid_auto', 'auto_pay_off') AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') = 2 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '已付款必填檢查允許自動標記（paid_by 可空）' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_payment_requests_paid_check' AND pg_get_constraintdef(oid) ILIKE '%paid_auto%') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '自動標記格式限制 ga_payment_requests_paid_auto_check 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_requests'::regclass AND conname = 'ga_payment_requests_paid_auto_check') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '操作紀錄類型含 cancel_auto_pay' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ga_payment_request_events'::regclass AND conname = 'ga_payment_request_events_type_check' AND pg_get_constraintdef(oid) ILIKE '%cancel_auto_pay%') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '狀態機守門含自動付款旗標例外' AS check_name, CASE WHEN pg_get_functiondef('public.ga_pay_request_guard()'::regprocedure) ILIKE '%ga.pay_auto_mark%' AND pg_get_functiondef('public.ga_pay_request_guard()'::regprocedure) ILIKE '%ga.pay_auto_cancel%' THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '排程函式存在且只開放給 service_role（匿名、登入者都不能執行）' AS check_name, CASE WHEN to_regprocedure('public.ga_apply_due_payment_requests(date,uuid[])') IS NOT NULL
  AND has_function_privilege('service_role', 'public.ga_apply_due_payment_requests(date,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_apply_due_payment_requests(date,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ga_apply_due_payment_requests(date,uuid[])', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '付款日函式存在且不對外開放' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_auto_pay_date(uuid)') IS NOT NULL
  AND NOT has_function_privilege('anon', 'public.ga_pay_auto_pay_date(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ga_pay_auto_pay_date(uuid)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '取消自動付款函式存在、登入者可執行、匿名不可執行' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_request_cancel_auto_pay(uuid,text,text,timestamptz)') IS NOT NULL
  AND has_function_privilege('authenticated', 'public.ga_ws_pay_request_cancel_auto_pay(uuid,text,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ga_ws_pay_request_cancel_auto_pay(uuid,text,text,timestamptz)', 'EXECUTE') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有任何請款單處於不一致狀態（自動標記但不是已付款或作廢、或有付款人）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE paid_auto AND (paid_by IS NOT NULL OR status NOT IN ('PAID', 'VOID'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '排程 ga-auto-pay-due-requests 已建立（每天 UTC 16:05 = 台北 00:05）；沒有 pg_cron 的環境這一列會是 skip' AS check_name,
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN 'skip'
       WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ga-auto-pay-due-requests' AND schedule = '5 16 * * *' AND command ILIKE '%ga_apply_due_payment_requests%') THEN 'pass' ELSE 'fail' END AS result;
