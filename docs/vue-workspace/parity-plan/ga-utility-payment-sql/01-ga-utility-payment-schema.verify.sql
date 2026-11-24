-- 驗證 01-ga-utility-payment-schema（只有 SELECT，可重複執行）。每列一個檢查項目：status 是 pass 或 fail；全部 pass 才算這一階段到位。
-- 套用後執行；撤回後執行則應該大部分是 fail（代表已撤回）。不含任何寫入。
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'fail' END AS status
  FROM (
  SELECT 1 AS n, 'ga_payment_requests.source 欄位' AS check_name, (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'source')) AS ok
  UNION ALL
  SELECT 2 AS n, 'ga_payment_requests.bill_month 欄位' AS check_name, (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'bill_month')) AS ok
  UNION ALL
  SELECT 3 AS n, 'ga_payment_requests.auto_mark_paid 欄位' AS check_name, (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'auto_mark_paid')) AS ok
  UNION ALL
  SELECT 4 AS n, 'ga_utility_bills.payee_vendor_id 欄位' AS check_name, (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name = 'payee_vendor_id')) AS ok
  UNION ALL
  SELECT 5 AS n, 'ga_utility_bills.paid_by_pr_id 欄位' AS check_name, (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name = 'paid_by_pr_id')) AS ok
  UNION ALL
  SELECT 6 AS n, '資料表 ga_payment_request_bill_lines' AS check_name, (to_regclass('public.ga_payment_request_bill_lines') IS NOT NULL) AS ok
  UNION ALL
  SELECT 7 AS n, '水電明細表 RLS 啟用' AS check_name, (COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.ga_payment_request_bill_lines')), false)) AS ok
  UNION ALL
  SELECT 8 AS n, '水電明細表登入者與匿名無任何權限' AS check_name, (to_regclass('public.ga_payment_request_bill_lines') IS NOT NULL AND NOT has_table_privilege('authenticated', 'public.ga_payment_request_bill_lines', 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('anon', 'public.ga_payment_request_bill_lines', 'SELECT,INSERT,UPDATE,DELETE')) AS ok
  UNION ALL
  SELECT 9 AS n, '索引 ga_payment_request_bill_lines_active_uidx' AS check_name, (EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ga_payment_request_bill_lines_active_uidx')) AS ok
  UNION ALL
  SELECT 10 AS n, '索引 idx_ga_payment_requests_source_status' AS check_name, (EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_ga_payment_requests_source_status')) AS ok
  UNION ALL
  SELECT 11 AS n, '索引 idx_ga_utility_bills_payee_month' AS check_name, (EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_ga_utility_bills_payee_month')) AS ok
  UNION ALL
  SELECT 12 AS n, '同一張帳單只能在一張有效請款單（部分唯一索引）' AS check_name, (EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ga_payment_request_bill_lines_active_uidx' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE active%')) AS ok
  UNION ALL
  SELECT 13 AS n, '約束 ga_payment_requests_source_check' AS check_name, (EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_source_check' AND conrelid = 'public.ga_payment_requests'::regclass)) AS ok
  UNION ALL
  SELECT 14 AS n, '約束 ga_payment_requests_utility_check' AS check_name, (EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_utility_check' AND conrelid = 'public.ga_payment_requests'::regclass)) AS ok
  UNION ALL
  SELECT 15 AS n, '觸發器 trg_ga_pay_lines_source_guard' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_lines_source_guard' AND tgrelid = 'public.ga_payment_request_lines'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 16 AS n, '觸發器 trg_ga_pay_ub_guard' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_ub_guard' AND tgrelid = 'public.ga_payment_requests'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 17 AS n, '觸發器 trg_ga_pay_ub_lines_guard' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_ub_lines_guard' AND tgrelid = 'public.ga_payment_request_bill_lines'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 18 AS n, '函式 ga_pay_lines_source_guard()' AS check_name, (to_regprocedure('public.ga_pay_lines_source_guard()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 19 AS n, '函式 ga_pay_ub_guard()' AS check_name, (to_regprocedure('public.ga_pay_ub_guard()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 20 AS n, '函式 ga_pay_ub_lines_guard()' AS check_name, (to_regprocedure('public.ga_pay_ub_lines_guard()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 21 AS n, '設定鍵 utility_payee_category_id 指向存在的分類' AS check_name, (EXISTS (SELECT 1 FROM ga_workflow_settings s JOIN ga_service_categories c ON c.id::text = s.value_text WHERE s.key = 'utility_payee_category_id')) AS ok
  UNION ALL
  SELECT 22 AS n, '請款單來源欄位只有採購或水電兩種值' AS check_name, (NOT EXISTS (SELECT 1 FROM ga_payment_requests WHERE source NOT IN ('PURCHASE', 'UTILITY'))) AS ok
  UNION ALL
  SELECT 23 AS n, '沒有新增任何請款或水電相關權限碼' AS check_name, (NOT EXISTS (SELECT 1 FROM permissions WHERE code ~ '(utility_payment|utility_request|ub_payment)')) AS ok
  ) c
 ORDER BY n;
