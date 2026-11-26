-- 驗證 04-ga-utility-payment-request-hooks（只有 SELECT，可重複執行）。每列一個檢查項目：status 是 pass 或 fail；全部 pass 才算這一階段到位。
-- 套用後執行；撤回後執行則應該大部分是 fail（代表已撤回）。不含任何寫入。
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'fail' END AS status
  FROM (
  SELECT 1 AS n, '加掛標記 ga_pay_request_json(uuid,boolean,boolean,boolean)' AS check_name, (to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'))) > 0) AS ok
  UNION ALL
  SELECT 2 AS n, '加掛標記 ga_ws_pay_request_list(jsonb,integer,integer)' AS check_name, (to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)'))) > 0) AS ok
  UNION ALL
  SELECT 3 AS n, '加掛標記 ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)' AS check_name, (to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)'))) > 0) AS ok
  UNION ALL
  SELECT 4 AS n, '加掛標記 ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)' AS check_name, (to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'))) > 0) AS ok
  UNION ALL
  SELECT 5 AS n, '加掛標記 ga_ws_pay_export(jsonb)' AS check_name, (to_regprocedure('public.ga_ws_pay_export(jsonb)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_export(jsonb)'))) > 0) AS ok
  UNION ALL
  SELECT 6 AS n, '送出分支認水電明細' AS check_name, (position('ga_payment_request_bill_lines' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'))) > 0) AS ok
  UNION ALL
  SELECT 7 AS n, '採購函式仍然存在（ga_ws_pay_request_create 未被改動）' AS check_name, (to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)') IS NOT NULL AND position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)'))) = 0) AS ok
  UNION ALL
  SELECT 8 AS n, '採購明細函式未被改動（ga_pay_apply_lines）' AS check_name, (position('GAUP' IN pg_get_functiondef(to_regprocedure('public.ga_pay_apply_lines(uuid,uuid,jsonb)'))) = 0) AS ok
  UNION ALL
  SELECT 9 AS n, '沒有任何角色因本批新增權限（不授權）' AS check_name, (NOT EXISTS (SELECT 1 FROM permissions WHERE code ~ '(utility_payment|utility_request|ub_payment)')) AS ok
  ) c
 ORDER BY n;
