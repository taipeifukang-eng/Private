-- 還原 20261125120000_ga_improve_b1_pay_methods_payee.sql（G4 付款方式與同仁代墊）。
-- 先決：階段 5（130000）已先撤回。
-- 安全規則：已有信用卡／網購平台付款或代墊請款單時中止（請先清除測試資料；正式區請先確認這些單據可以失去這些資訊）。
-- 同仁匯款帳戶與事件表整張 DROP（事件不含帳號本文）。既有函式加掛逐字還原。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'payee_type') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE payee_type <> 'VENDOR') THEN RAISE EXCEPTION '不能撤回：還有同仁代墊的請款單。'; END IF;
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE pay_method IN ('CREDIT_CARD', 'ONLINE_PLATFORM')) THEN RAISE EXCEPTION '不能撤回：還有用信用卡或網購平台付款的請款單。'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ib1_nl(p_ref text, p_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN position(E'\r\n' IN p_ref) > 0 THEN replace(replace(p_x, E'\r\n', E'\n'), E'\n', E'\r\n') ELSE replace(p_x, E'\r\n', E'\n') END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  v_out := (v_out - 'payee_account_snapshot') || public.ga_ib1_pay_json_ext(q.id, p_vendor, p_detail); -- GAIB1-S4
  RETURN v_out;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  v_out := (v_out - 'payee_account_snapshot') || public.ga_ib1_pay_json_ext(q.id, p_vendor, p_detail); -- GAIB1-S4
  RETURN v_out;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  RETURN v_out;$ib1o$)); END IF;
  IF position('GAIB1-S4' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_request_json(uuid,boolean,boolean,boolean) 還有無法自動移除的 GAIB1-S4 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', payee_account_snapshot = CASE WHEN q.payee_type = 'EMPLOYEE' THEN public.ga_ib1_payee_account_snapshot(q.payee_profile_id) ELSE q.payee_account_snapshot END /* GAIB1-S4 */, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', payee_account_snapshot = CASE WHEN q.payee_type = 'EMPLOYEE' THEN public.ga_ib1_payee_account_snapshot(q.payee_profile_id) ELSE q.payee_account_snapshot END /* GAIB1-S4 */, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, pay_card_last4 = CASE WHEN v_method = 'CREDIT_CARD' THEN nullif(btrim(COALESCE(p ->> 'card_last4', '')), '') END, pay_platform = CASE WHEN v_method = 'ONLINE_PLATFORM' THEN nullif(btrim(COALESCE(p ->> 'platform', '')), '') END, /* GAIB1-S4 */ paid_date = v_paid,$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, pay_card_last4 = CASE WHEN v_method = 'CREDIT_CARD' THEN nullif(btrim(COALESCE(p ->> 'card_last4', '')), '') END, pay_platform = CASE WHEN v_method = 'ONLINE_PLATFORM' THEN nullif(btrim(COALESCE(p ->> 'platform', '')), '') END, /* GAIB1-S4 */ paid_date = v_paid,$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, paid_date = v_paid,$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM') /* GAIB1-S4 */ THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金、支票、信用卡或網購平台／第三方支付'); END IF;
    PERFORM public.ga_ib1_check_pay_fields(v_method, p); -- GAIB1-S4$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM') /* GAIB1-S4 */ THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金、支票、信用卡或網購平台／第三方支付'); END IF;
    PERFORM public.ga_ib1_check_pay_fields(v_method, p); -- GAIB1-S4$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK') THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金或支票'); END IF;$ib1o$)); END IF;
  IF position('GAIB1-S4' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 還有無法自動移除的 GAIB1-S4 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_request_list(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$       AND public.ga_ib1_pay_filter_ok(q.id, v_f) -- GAIB1-S4
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$       AND public.ga_ib1_pay_filter_ok(q.id, v_f) -- GAIB1-S4
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),$ib1o$)); END IF;
  IF position('GAIB1-S4' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_list(jsonb,integer,integer) 還有無法自動移除的 GAIB1-S4 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_export(jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_export(jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  RETURN public.ga_ib1_export_enrich(jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor)), v_f, v_uid); -- GAIB1-S4$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  RETURN public.ga_ib1_export_enrich(jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor)), v_f, v_uid); -- GAIB1-S4$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor));$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$THEN RETURN public.ga_ib1_export_enrich(public.ga_ws_pay_export_ub(v_f), v_f, v_uid); /* GAIB1-S4 */ END IF;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$THEN RETURN public.ga_ib1_export_enrich(public.ga_ws_pay_export_ub(v_f), v_f, v_uid); /* GAIB1-S4 */ END IF;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$THEN RETURN public.ga_ws_pay_export_ub(v_f); END IF;$ib1o$)); END IF;
  IF position('GAIB1-S4' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_export(jsonb) 還有無法自動移除的 GAIB1-S4 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- 階段 2 的延伸點還原成階段 2 的版本
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_buyer(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_cur uuid;
  v_new uuid;
  v_txt text;
BEGIN
  SELECT buyer_company_id INTO v_cur FROM public.ga_payment_requests WHERE id = p_pr AND status = 'DRAFT';
  IF NOT FOUND THEN RETURN; END IF;
  IF p ? 'buyer_company_id' THEN
    v_txt := nullif(btrim(COALESCE(p ->> 'buyer_company_id', '')), '');
    IF v_txt IS NOT NULL THEN
      v_new := public.ga_pay_uuid(v_txt, '買受人公司', true);
      IF NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_new AND (is_active OR id = v_cur)) THEN
        PERFORM public.ga_rq_raise(404, 'BUYER_NOT_FOUND', '找不到這家買受人公司，或已停用');
      END IF;
    ELSE
      v_new := public.ga_ib1_buyer_default_id();
    END IF;
  ELSIF v_cur IS NULL THEN
    SELECT o.buyer_company_id INTO v_new FROM public.ga_payment_request_lines l JOIN public.ga_purchase_orders o ON o.id = l.po_id WHERE l.pr_id = p_pr ORDER BY l.line_no LIMIT 1;
    IF v_new IS NULL THEN v_new := public.ga_ib1_buyer_default_id(); END IF;
  ELSE
    RETURN;
  END IF;
  IF v_new IS DISTINCT FROM v_cur THEN UPDATE public.ga_payment_requests SET buyer_company_id = v_new WHERE id = p_pr; END IF;
END;
$f$;

DROP TRIGGER IF EXISTS trg_ga_ib1_payee_guard ON public.ga_payment_requests;
DROP FUNCTION IF EXISTS public.ga_ib1_payee_guard();
DROP FUNCTION IF EXISTS public.ga_ws_pay_my_reimbursements(integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_pay_employee_options(text, integer);
DROP FUNCTION IF EXISTS public.ga_ws_payout_account_set_for(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_payout_account_get_for(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_payout_account_set_own(jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_payout_account_get_own();
DROP FUNCTION IF EXISTS public.ga_ib1_payout_account_save(uuid, jsonb, uuid, text);
DROP FUNCTION IF EXISTS public.ga_ib1_export_enrich(jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_pay_filter_ok(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_pay_json_ext(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.ga_ib1_check_pay_fields(text, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_pay_set_payee(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_payee_account_snapshot(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_employee_active(uuid);
DROP TRIGGER IF EXISTS trg_ga_employee_payout_account_events_immutable ON public.ga_employee_payout_account_events;
DROP TABLE IF EXISTS public.ga_employee_payout_account_events;
DROP TABLE IF EXISTS public.ga_employee_payout_accounts;
DROP INDEX IF EXISTS public.idx_ga_payment_requests_payee_profile;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_pay_fields_check;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_payee_check;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_pay_method_check;
ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_pay_method_check CHECK ((pay_method IS NULL) OR (pay_method = ANY (ARRAY['TRANSFER'::text, 'CASH'::text, 'CHECK'::text])));
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS pay_platform;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS pay_card_last4;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS payee_account_snapshot;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS payee_name_snapshot;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS payee_profile_id;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS payee_type;
NOTIFY pgrst, 'reload schema';
