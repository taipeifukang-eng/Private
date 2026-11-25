-- 總務採購與請款改善第一批（ga-improve-b1）階段 6：DEV 專用測試資料清除函式（不套正式區，沒有對應的正式區草稿）。
-- 建立 ga_dev_cleanup_ga_improve_b1(p_marker, p_email_like)：清除 ga-improve-b1 測試資料，只處理「廠商名稱帶 QA-GAIB1- 標記」「買受人公司名稱帶 QA-GAIB1- 標記」與
--   「測試帳號（email 符合 p_email_like，預設 m7m8-test-%）」的資料：
--     預付餘額帳、請款單與事件與明細（事件表有不可改刪觸發器，單一交易內暫停後立刻恢復）、發票連結與發票、同仁匯款帳戶與事件、買受人公司事件與公司（採購單與請款單已先清掉時才刪公司）、測試廠商（沒有採購單參照時才刪）。
--   採購單、進貨單與庫存仍由既有 cleanupM7M8（依備註標記）清除；本函式要在它之前與之後各呼叫一次（第一次清請款與帳務資料，第二次清廠商與公司）。只有 service_role 能呼叫。
-- 不新增權限碼、不建立任何角色（測試帳號與臨時角色沿用既有 fixtures，角色代碼沒有新增，所以不會撞名）。
-- 還原：20261125140000_ga_improve_b1_dev_seed.rollback.sql（只刪這支函式）。可重複執行。

CREATE OR REPLACE FUNCTION public.ga_dev_cleanup_ga_improve_b1(p_marker text DEFAULT 'QA-GAIB1-%', p_email_like text DEFAULT 'm7m8-test-%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_vendors uuid[];
  v_pos uuid[];
  v_prs uuid[];
  v_profiles uuid[];
  v_invoices uuid[];
  v_n jsonb := '{}'::jsonb;
  v_c integer;
BEGIN
  IF p_marker IS NULL OR left(p_marker, 9) <> 'QA-GAIB1-' THEN RAISE EXCEPTION '只能清除帶 QA-GAIB1- 標記的測試資料'; END IF;
  IF p_email_like IS NULL OR left(p_email_like, 9) <> 'm7m8-test' THEN RAISE EXCEPTION '測試帳號 email 條件必須以 m7m8-test 開頭'; END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_vendors FROM public.ga_vendors WHERE name LIKE p_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_pos FROM public.ga_purchase_orders WHERE vendor_id = ANY (v_vendors);
  SELECT COALESCE(array_agg(id), '{}') INTO v_profiles FROM public.profiles WHERE email LIKE p_email_like;
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_prs FROM public.ga_payment_requests r
   WHERE r.vendor_id = ANY (v_vendors) OR r.prepay_po_id = ANY (v_pos) OR r.payee_profile_id = ANY (v_profiles)
      OR EXISTS (SELECT 1 FROM public.ga_payment_request_lines l WHERE l.pr_id = r.id AND l.po_id = ANY (v_pos));

  -- 預付餘額帳
  DELETE FROM public.ga_payment_prepay_ledger WHERE prepay_pr_id = ANY (v_prs) OR po_id = ANY (v_pos);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('ledger', v_c);

  -- 請款單與事件、明細
  ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
  DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_prs) OR actor_id = ANY (v_profiles);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('events', v_c);
  ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;
  IF to_regclass('public.ga_payment_request_bill_lines') IS NOT NULL THEN
    ALTER TABLE public.ga_payment_request_bill_lines DISABLE TRIGGER trg_ga_pay_ub_lines_guard;
    UPDATE public.ga_utility_bills SET paid_by_pr_id = NULL WHERE paid_by_pr_id = ANY (v_prs);
    DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = ANY (v_prs);
    ALTER TABLE public.ga_payment_request_bill_lines ENABLE TRIGGER trg_ga_pay_ub_lines_guard;
  END IF;
  DELETE FROM public.ga_payment_requests WHERE id = ANY (v_prs);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('payment_requests', v_c);

  -- 發票（只清測試廠商的發票）
  SELECT COALESCE(array_agg(id), '{}') INTO v_invoices FROM public.ga_purchase_invoices WHERE vendor_id = ANY (v_vendors);
  DELETE FROM public.ga_purchase_invoice_receipts WHERE invoice_id = ANY (v_invoices);
  DELETE FROM public.ga_purchase_invoices WHERE id = ANY (v_invoices);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('invoices', v_c);

  -- 同仁匯款帳戶與事件（事件表不可改刪：單一交易內暫停後立刻恢復）
  ALTER TABLE public.ga_employee_payout_account_events DISABLE TRIGGER trg_ga_employee_payout_account_events_immutable;
  DELETE FROM public.ga_employee_payout_account_events WHERE profile_id = ANY (v_profiles) OR actor_id = ANY (v_profiles);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('payout_events', v_c);
  ALTER TABLE public.ga_employee_payout_account_events ENABLE TRIGGER trg_ga_employee_payout_account_events_immutable;
  DELETE FROM public.ga_employee_payout_accounts WHERE profile_id = ANY (v_profiles);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('payout_accounts', v_c);

  -- 買受人公司（測試公司；仍被採購單或請款單參照的先略過，等採購單清掉後第二次呼叫再刪）
  ALTER TABLE public.ga_buyer_company_events DISABLE TRIGGER trg_ga_buyer_company_events_immutable;
  DELETE FROM public.ga_buyer_company_events WHERE actor_id = ANY (v_profiles)
     OR company_id IN (SELECT c.id FROM public.ga_buyer_companies c WHERE c.name LIKE p_marker
                        AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.buyer_company_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.buyer_company_id = c.id));
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('buyer_events', v_c);
  ALTER TABLE public.ga_buyer_company_events ENABLE TRIGGER trg_ga_buyer_company_events_immutable;
  DELETE FROM public.ga_buyer_companies c WHERE c.name LIKE p_marker
     AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.buyer_company_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.buyer_company_id = c.id);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('buyer_companies', v_c);

  -- 沒有採購單與其他請款單參照的測試廠商
  DELETE FROM public.ga_vendors v WHERE v.name LIKE p_marker AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.vendor_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests r WHERE r.vendor_id = v.id);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('vendors', v_c);
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_dev_cleanup_ga_improve_b1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_dev_cleanup_ga_improve_b1(text, text) TO service_role;
NOTIFY pgrst, 'reload schema';
