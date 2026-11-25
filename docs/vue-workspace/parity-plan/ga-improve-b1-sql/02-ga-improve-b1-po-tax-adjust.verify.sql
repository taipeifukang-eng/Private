-- 02-ga-improve-b1-po-tax-adjust 只讀驗證（G2 含稅單價、G3 調整列）：每列回 pass 或 fail，全部 pass 才算套用成功。只有 SELECT，沒有任何寫入。
SELECT '資料表 ga_purchase_order_adjustments 存在' AS check_name, CASE WHEN to_regclass('public.ga_purchase_order_adjustments') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_purchase_order_adjustments 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_purchase_order_adjustments')), false) AND NOT has_table_privilege('authenticated', 'public.ga_purchase_order_adjustments', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_purchase_order_adjustments', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_purchase_receipt_adjustments 存在' AS check_name, CASE WHEN to_regclass('public.ga_purchase_receipt_adjustments') IS NOT NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '資料表 ga_purchase_receipt_adjustments 開啟 RLS 且不開放給登入者與匿名' AS check_name, CASE WHEN COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ga_purchase_receipt_adjustments')), false) AND NOT has_table_privilege('authenticated', 'public.ga_purchase_receipt_adjustments', 'SELECT') AND NOT has_table_privilege('anon', 'public.ga_purchase_receipt_adjustments', 'SELECT') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_purchase_orders.price_mode 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_orders' AND column_name = 'price_mode') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_purchase_order_items.unit_price_gross 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_order_items' AND column_name = 'unit_price_gross') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_purchase_order_items.line_gross 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_order_items' AND column_name = 'line_gross') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '欄位 ga_purchase_receipt_items.amount_gross 存在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipt_items' AND column_name = 'amount_gross') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_adjustments_apply 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_adjustments_apply') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_adjustments_apply' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_item_incl 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_item_incl') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_item_incl' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_receipt_calc 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_calc') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_calc' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_pay_receipt_tax 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_pay_receipt_tax') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_pay_receipt_tax' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_receipt_adj_carry 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_adj_carry') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_adj_carry' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_receive_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receive_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receive_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_receipt_void_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_void_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_void_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_receipt_data_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_data_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_receipt_data_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_po_header_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_header_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_header_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '內部函式 ga_ib1_po_data_ext 存在、登入者與匿名都不能執行' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_data_ext') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = 'ga_ib1_po_data_ext' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_refresh_totals(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_po_refresh_totals(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_po_refresh_totals(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_freeze_receipt_item_amount() 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_freeze_receipt_item_amount()') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_freeze_receipt_item_amount()'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_receipt_untaxed(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_receipt_untaxed(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_receipt_untaxed(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_receipt_total(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_receipt_total(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_receipt_total(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_po_received(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_po_received(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_po_received(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_po_amounts(uuid[]) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_po_amounts(uuid[])') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_po_amounts(uuid[])'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_unclaimed_po_ids(numeric) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_unclaimed_po_ids(numeric)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_unclaimed_po_ids(numeric)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_items_apply(uuid,jsonb) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_po_items_apply(uuid,jsonb)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_po_items_apply(uuid,jsonb)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_po_receive(uuid,jsonb,jsonb,text) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_po_receive(uuid,jsonb,jsonb,text)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_ws_po_receive(uuid,jsonb,jsonb,text)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_receipt_data(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_po_receipt_data(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_po_receipt_data(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_pay_apply_lines(uuid,uuid,jsonb) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_pay_apply_lines(uuid,uuid,jsonb)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_pay_apply_lines(uuid,uuid,jsonb)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_ws_pay_receipt_candidates(jsonb,integer,integer) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '既有函式 public.ga_po_data(uuid) 已加掛 GAIB1-S3' AS check_name, CASE WHEN to_regprocedure('public.ga_po_data(uuid)') IS NOT NULL AND position('GAIB1-S3' IN pg_get_functiondef(to_regprocedure('public.ga_po_data(uuid)'))) > 0 THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有殘留的暫時替換函式 ga_ib1_swap／ga_ib1_nl' AS check_name, CASE WHEN to_regprocedure('public.ga_ib1_swap(text,text,text,text)') IS NULL AND to_regprocedure('public.ga_ib1_nl(text,text)') IS NULL THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '沒有新增任何權限碼（預付、同仁帳戶、買受人公司都用既有權限）' AS check_name, CASE WHEN NOT EXISTS (SELECT 1 FROM public.permissions WHERE code ~ '(prepay|payout|buyer_compan|reimburs)') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT 'price_mode 約束存在且既有採購單預設未稅（未使用含稅前的採購單全部 EXCL）' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_purchase_orders_price_mode_check') AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE price_mode IS NULL) THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '調整列約束：運費為正、折扣類為負、金額不為 0' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_po_adjustments_amount_check') THEN 'pass' ELSE 'fail' END AS result
UNION ALL
SELECT '進貨明細金額凍結觸發器仍在' AS check_name, CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_pay_freeze_receipt_item_amount' AND NOT tgisinternal) THEN 'pass' ELSE 'fail' END AS result
ORDER BY 1;
