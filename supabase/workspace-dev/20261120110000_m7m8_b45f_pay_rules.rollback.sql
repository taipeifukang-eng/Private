-- 還原 20261120110000_m7m8_b45f_pay_rules.sql：把 ga_pay_apply_lines、ga_pay_check_live、ga_ws_pay_request_action 的追加擴充拿掉（形狀不符就中止），並移除兩個內部輔助函式。不刪任何資料。可重複執行。
CREATE OR REPLACE FUNCTION public.ga_b45f_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)$a$::regprocedure);
  IF position($a$超過 30 天$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    IF v_paid < ((q.created_at AT TIME ZONE 'Asia/Taipei')::date - 30) THEN RETURN public.ga_rq_err(400, 'PAID_TOO_EARLY', '付款日期不能比請款單建立日（' || (q.created_at AT TIME ZONE 'Asia/Taipei')::date || '）早超過 30 天，最早可填 ' || ((q.created_at AT TIME ZONE 'Asia/Taipei')::date - 30)); END IF;$a$, $a$    IF v_paid < (q.created_at AT TIME ZONE 'Asia/Taipei')::date THEN RETURN public.ga_rq_err(400, 'PAID_TOO_EARLY', '付款日期不能早於請款單建立日（' || (q.created_at AT TIME ZONE 'Asia/Taipei')::date || '）'); END IF;$a$, $a$ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 沒有任何變更'; END IF;
  IF position($a$超過 30 天$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_pay_check_live(uuid)$a$::regprocedure);
  IF position($a$ga_pay_check_po_total$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    v_claimed := public.ga_pay_po_claimed(v_po);
    PERFORM public.ga_pay_check_po_total(v_po, v_claimed, v_tol);$a$, $a$    v_claimed := public.ga_pay_po_claimed(v_po);$a$, $a$ga_pay_check_live(uuid)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;
  -- 尾差調低後重驗草稿：與發票分攤金額相差超過目前尾差、又沒有差異原因的明細不能送出
  PERFORM public.ga_pay_check_tol_reasons(p_pr);$a$, $a$  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;$a$, $a$ga_pay_check_live(uuid)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_pay_check_live(uuid) 沒有任何變更'; END IF;
  IF position($a$ga_pay_check_po_total$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_check_live(uuid) 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_pay_apply_lines(uuid,uuid,jsonb)$a$::regprocedure);
  IF position($a$ga_pay_check_po_total$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    v_claimed := public.ga_pay_po_claimed(v_po);
    PERFORM public.ga_pay_check_po_total(v_po, v_claimed, v_tol);$a$, $a$    v_claimed := public.ga_pay_po_claimed(v_po);$a$, $a$ga_pay_apply_lines(uuid,uuid,jsonb)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 沒有任何變更'; END IF;
  IF position($a$ga_pay_check_po_total$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_pay_check_po_total(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.ga_pay_check_tol_reasons(uuid);
DROP FUNCTION IF EXISTS public.ga_b45f_swap(text, text, text, text);
NOTIFY pgrst, 'reload schema';
