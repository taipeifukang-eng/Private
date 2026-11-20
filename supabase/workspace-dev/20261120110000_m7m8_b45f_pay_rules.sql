-- M7/M8 第 4.5 批追加 F1、F3 與尾差重驗（2026-11-20 驗收問卷）：請款規則（DEV）。
-- 內容：
--   F1 採購單總額上限：一張採購單所有「非作廢」請款明細（草稿、已送出、已付款）的請款金額合計，不得超過採購單含稅總額（ga_purchase_orders.total_amount）＋ 尾差（pay_tolerance_amount，預設 5）；
--      與原本的「累計驗入含稅額上限」並存。新增內部 ga_pay_check_po_total(採購單, 累計請款, 尾差)，在 ga_pay_apply_lines（建立、修改草稿）與 ga_pay_check_live（送出）兩處累計驗入檢查「之後」呼叫
--      （累計驗入檢查先擋，錯誤碼 OVER_CLAIM 不變；通過後才可能是 OVER_PO_TOTAL，409）。主要攔的是分批進貨每張各自四捨五入、使累計驗入含稅額略高於採購單含稅總額的情況。
--   F3 付款日期：付款日期可以比請款單建立日（台北日期）早，但最多早 30 天；不得是未來（既有 PAID_FUTURE）。取代原本「不得早於建立日」（PAID_TOO_EARLY 錯誤碼沿用，訊息改為 30 天）。
--   尾差調低後重驗：送出時（ga_pay_check_live）重驗草稿明細——與發票分攤金額相差超過「目前」尾差且沒有差異原因的，擋下（DIFF_REASON_REQUIRED，請先修改草稿補填原因）；
--      累計驗入與採購單總額上限本來就用目前尾差。已送出、已付款的請款單不受影響（檢查只在送出時跑）。
--   以讀現行定義再文字替換擴充 ga_pay_apply_lines、ga_pay_check_live、ga_ws_pay_request_action（已套用就略過，形狀不符就中止）。
-- 先決：20261119150000（ga_pay_*）。
-- 還原：20261120110000_m7m8_b45f_pay_rules.rollback.sql。可重複執行。
DO $$
BEGIN
  IF to_regprocedure('public.ga_pay_apply_lines(uuid,uuid,jsonb)') IS NULL OR to_regprocedure('public.ga_pay_check_live(uuid)') IS NULL
     OR to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NULL OR to_regprocedure('public.ga_pay_po_received(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261119150000_m7m8_b45_functions';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_b45f_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

-- ================================================================ 1. 內部輔助
-- F1：採購單累計請款（非作廢）不得超過採購單含稅總額＋尾差。累計驗入上限（OVER_CLAIM）呼叫端緊接著檢查；這裡先讓位，避免改變既有錯誤碼。
CREATE OR REPLACE FUNCTION public.ga_pay_check_po_total(p_po uuid, p_claimed numeric, p_tol numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total numeric;
  v_no text;
  v_recv numeric;
BEGIN
  SELECT o.total_amount, o.po_no INTO v_total, v_no FROM public.ga_purchase_orders o WHERE o.id = p_po;
  IF NOT FOUND THEN RETURN; END IF;
  v_recv := (public.ga_pay_po_received(p_po) ->> 'total')::numeric;
  IF p_claimed > v_recv + p_tol THEN RETURN; END IF;
  IF p_claimed > v_total + p_tol THEN
    PERFORM public.ga_rq_raise(409, 'OVER_PO_TOTAL', '採購單 ' || v_no || ' 累計請款 ' || public.ga_pay_money(p_claimed) || ' 元，超過採購單含稅總額 ' || public.ga_pay_money(v_total) || ' 元（容許尾差 ' || public.ga_pay_money(p_tol) || ' 元）；一張採購單的請款總額不能超過訂單金額',
      jsonb_build_object('po_id', p_po, 'po_no', v_no, 'po_total', v_total, 'claimed_total', p_claimed, 'tolerance', p_tol));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_pay_check_po_total(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_check_po_total(uuid, numeric, numeric) TO service_role;

-- 尾差重驗：草稿明細與發票分攤金額相差超過目前尾差、又沒有差異原因時擋下（尾差在建立後被調低的情況）。
CREATE OR REPLACE FUNCTION public.ga_pay_check_tol_reasons(p_pr uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tol numeric := public.ga_pay_tol();
  l record;
BEGIN
  FOR l IN SELECT x.line_no, r.receipt_no, x.claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated
             FROM public.ga_payment_request_lines x
             JOIN public.ga_purchase_receipts r ON r.id = x.receipt_id
             JOIN public.ga_purchase_invoice_receipts ir ON ir.invoice_id = x.invoice_id AND ir.receipt_id = x.receipt_id
            WHERE x.pr_id = p_pr AND x.invoice_id IS NOT NULL AND nullif(btrim(COALESCE(x.diff_reason, '')), '') IS NULL
              AND abs(x.claim_total - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol
            ORDER BY x.line_no LOOP
    PERFORM public.ga_rq_raise(400, 'DIFF_REASON_REQUIRED', '進貨單 ' || l.receipt_no || ' 的請款額 ' || public.ga_pay_money(l.claim_total) || ' 元與發票分攤金額 ' || public.ga_pay_money(l.allocated)
      || ' 元相差超過目前的尾差 ' || public.ga_pay_money(v_tol) || ' 元（尾差設定被調低），請先修改草稿、補填差異原因後再送出', jsonb_build_object('line_no', l.line_no, 'tolerance', v_tol));
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_pay_check_tol_reasons(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_check_tol_reasons(uuid) TO service_role;

-- ================================================================ 2. 現行函式文字替換
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_pay_apply_lines(uuid,uuid,jsonb)$a$::regprocedure);
  IF position($a$ga_pay_check_po_total$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    v_claimed := public.ga_pay_po_claimed(v_po);$a$, $a$    v_claimed := public.ga_pay_po_claimed(v_po);
    PERFORM public.ga_pay_check_po_total(v_po, v_claimed, v_tol);$a$, $a$ga_pay_apply_lines(uuid,uuid,jsonb)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_pay_check_live(uuid)$a$::regprocedure);
  IF position($a$ga_pay_check_po_total$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;$a$, $a$  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;
  -- 尾差調低後重驗草稿：與發票分攤金額相差超過目前尾差、又沒有差異原因的明細不能送出
  PERFORM public.ga_pay_check_tol_reasons(p_pr);$a$, $a$ga_pay_check_live(uuid)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$    v_claimed := public.ga_pay_po_claimed(v_po);$a$, $a$    v_claimed := public.ga_pay_po_claimed(v_po);
    PERFORM public.ga_pay_check_po_total(v_po, v_claimed, v_tol);$a$, $a$ga_pay_check_live(uuid)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_pay_check_live(uuid) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)$a$::regprocedure);
  IF position($a$超過 30 天$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    IF v_paid < (q.created_at AT TIME ZONE 'Asia/Taipei')::date THEN RETURN public.ga_rq_err(400, 'PAID_TOO_EARLY', '付款日期不能早於請款單建立日（' || (q.created_at AT TIME ZONE 'Asia/Taipei')::date || '）'); END IF;$a$, $a$    IF v_paid < ((q.created_at AT TIME ZONE 'Asia/Taipei')::date - 30) THEN RETURN public.ga_rq_err(400, 'PAID_TOO_EARLY', '付款日期不能比請款單建立日（' || (q.created_at AT TIME ZONE 'Asia/Taipei')::date || '）早超過 30 天，最早可填 ' || ((q.created_at AT TIME ZONE 'Asia/Taipei')::date - 30)); END IF;$a$, $a$ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_b45f_swap(text, text, text, text);
NOTIFY pgrst, 'reload schema';
