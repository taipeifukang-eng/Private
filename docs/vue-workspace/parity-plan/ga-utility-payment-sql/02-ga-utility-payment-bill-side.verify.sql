-- 驗證 02-ga-utility-payment-bill-side（只有 SELECT，可重複執行）。每列一個檢查項目：status 是 pass 或 fail；全部 pass 才算這一階段到位。
-- 套用後執行；撤回後執行則應該大部分是 fail（代表已撤回）。不含任何寫入。
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'fail' END AS status
  FROM (
  SELECT 1 AS n, '函式 ga_pay_ub_ident(text,text,text)' AS check_name, (to_regprocedure('public.ga_pay_ub_ident(text,text,text)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 2 AS n, '函式 ga_pay_ub_label(ga_utility_bills)' AS check_name, (to_regprocedure('public.ga_pay_ub_label(ga_utility_bills)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 3 AS n, '函式 ga_ub_check_payee(uuid)' AS check_name, (to_regprocedure('public.ga_ub_check_payee(uuid)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 4 AS n, '函式 ga_ub_json_ext(uuid)' AS check_name, (to_regprocedure('public.ga_ub_json_ext(uuid)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 5 AS n, '函式 ga_pay_ub_bill_lock_check(ga_utility_bills,ga_utility_bills)' AS check_name, (to_regprocedure('public.ga_pay_ub_bill_lock_check(ga_utility_bills,ga_utility_bills)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 6 AS n, '函式 ga_ws_ub_payees()' AS check_name, (to_regprocedure('public.ga_ws_ub_payees()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 7 AS n, '函式 ga_ws_ub_set_payee(uuid[],uuid)' AS check_name, (to_regprocedure('public.ga_ws_ub_set_payee(uuid[],uuid)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 8 AS n, '函式 ga_pay_ub_attachment_last_guard()' AS check_name, (to_regprocedure('public.ga_pay_ub_attachment_last_guard()') IS NOT NULL) AS ok
  UNION ALL
  SELECT 9 AS n, '觸發器 trg_ga_pay_ub_attachment_last_guard' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_ub_attachment_last_guard' AND tgrelid = 'public.ga_resource_attachments'::regclass AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 10 AS n, '加掛標記 ga_utility_bill_before_write()' AS check_name, (to_regprocedure('public.ga_utility_bill_before_write()') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_utility_bill_before_write()'))) > 0) AS ok
  UNION ALL
  SELECT 11 AS n, '加掛標記 ga_ub_json(uuid)' AS check_name, (to_regprocedure('public.ga_ub_json(uuid)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ub_json(uuid)'))) > 0) AS ok
  UNION ALL
  SELECT 12 AS n, '加掛標記 ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)' AS check_name, (to_regprocedure('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)'))) > 0) AS ok
  UNION ALL
  SELECT 13 AS n, '加掛標記 ga_ws_ub_list(jsonb,integer,integer)' AS check_name, (to_regprocedure('public.ga_ws_ub_list(jsonb,integer,integer)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_ub_list(jsonb,integer,integer)'))) > 0) AS ok
  UNION ALL
  SELECT 14 AS n, '帳單觸發器仍在且啟用' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_utility_bills_before_write' AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  UNION ALL
  SELECT 15 AS n, '對外函式登入者可執行 ga_ws_ub_payees()' AS check_name, (to_regprocedure('public.ga_ws_ub_payees()') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_ub_payees()'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_ub_payees()'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 16 AS n, '對外函式登入者可執行 ga_ws_ub_set_payee(uuid[],uuid)' AS check_name, (to_regprocedure('public.ga_ws_ub_set_payee(uuid[],uuid)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.ga_ws_ub_set_payee(uuid[],uuid)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.ga_ws_ub_set_payee(uuid[],uuid)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 17 AS n, '內部函式未開放給登入者 ga_ub_check_payee(uuid)' AS check_name, (to_regprocedure('public.ga_ub_check_payee(uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_ub_check_payee(uuid)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 18 AS n, '內部函式未開放給登入者 ga_ub_json_ext(uuid)' AS check_name, (to_regprocedure('public.ga_ub_json_ext(uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_ub_json_ext(uuid)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 19 AS n, '內部函式未開放給登入者 ga_pay_ub_bill_lock_check(ga_utility_bills,ga_utility_bills)' AS check_name, (to_regprocedure('public.ga_pay_ub_bill_lock_check(ga_utility_bills,ga_utility_bills)') IS NOT NULL AND NOT has_function_privilege('authenticated', to_regprocedure('public.ga_pay_ub_bill_lock_check(ga_utility_bills,ga_utility_bills)'), 'EXECUTE')) AS ok
  UNION ALL
  SELECT 20 AS n, '既有水電帳單沒有被動到（paid_by_pr_id 全為空）' AS check_name, (NOT EXISTS (SELECT 1 FROM ga_utility_bills WHERE paid_by_pr_id IS NOT NULL) OR EXISTS (SELECT 1 FROM ga_payment_requests WHERE source = 'UTILITY')) AS ok
  ) c
 ORDER BY n;
