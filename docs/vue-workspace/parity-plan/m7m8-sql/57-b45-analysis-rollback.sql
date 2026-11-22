-- 57-b45-analysis-rollback.sql
-- 撤回 57：把 6 個函式的請款擴充拿掉（逐段反向替換，形狀不符就中止），並移除 ga_pay_unclaimed_po_ids、ga_pay_po_amounts。不刪任何資料。撤回後首頁與徽章沒有待請款、待付款，採購分析沒有請款欄位。要先撤回 58 嗎：不必，58 與 57 彼此不相依。
-- 撤回前備份：先存 6 個函式的現行定義（SELECT pg_get_functiondef(...)）；函式本身可由 57 重新套用還原。
BEGIN;

CREATE OR REPLACE FUNCTION public.ga_b45_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
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
  v_def := pg_get_functiondef($a$public.ga_ws_vendor_perf(text,text)$a$::regprocedure);
  IF position($a$v_can_pay$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$'can_view_po_amount', v_can_po, 'can_view_pay_amount', v_can_pay,$a$, $a$'can_view_po_amount', v_can_po,$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$           'po_paid_total', CASE WHEN v_can_pay THEN (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id JOIN public.ga_purchase_orders o2 ON o2.id = l.po_id WHERE q.status = 'PAID' AND o2.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o2.ordered_at >= v_start AND o2.ordered_at < v_end AND o2.vendor_id IS NOT NULL) END,
           'po_amount_total', CASE WHEN v_can_po THEN$a$, $a$           'po_amount_total', CASE WHEN v_can_po THEN$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$'po_amount', CASE WHEN v_can_po THEN m.po_amount END, 'po_paid_amount', CASE WHEN v_can_pay THEN m.po_paid END,$a$, $a$'po_amount', CASE WHEN v_can_po THEN m.po_amount END,$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount, COALESCE(p.po_paid, 0) AS po_paid$a$, $a$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$      FROM public.ga_purchase_orders o LEFT JOIN LATERAL (SELECT COALESCE(sum(l.claim_total), 0) AS paid FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE v_can_pay AND l.po_id = o.id AND q.status = 'PAID') pd ON true
$a$, $a$      FROM public.ga_purchase_orders o
$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount, COALESCE(sum(pd.paid), 0) AS po_paid$a$, $a$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_can_po := public.ga_po_can_view(v_uid);
  v_can_pay := v_can_po AND public.ga_pay_can_view(v_uid);$a$, $a$  v_can_po := public.ga_po_can_view(v_uid);$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_can_po boolean;
  v_can_pay boolean;$a$, $a$  v_can_po boolean;$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_vendor_perf(text,text) 沒有任何變更'; END IF;
  IF position($a$v_can_pay$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_vendor_perf(text,text) 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_purchase_analysis(text,integer,integer)$a$::regprocedure);
  IF position($a$v_can_pay$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$'orders', v_orders, 'can_view_payment', v_can_pay, 'orders_total', v_total,$a$, $a$'orders', v_orders, 'orders_total', v_total,$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  -- 已請款、已付款、未請款驗入（只給有請款檢視或管理權限者；已作廢進貨不計入，只算有效請款單）
  v_can_pay := public.ga_pay_can_view(v_uid);
  IF v_can_pay THEN
    SELECT jsonb_build_object('claimed_amount', COALESCE(sum(a.claimed), 0), 'paid_amount', COALESCE(sum(a.paid), 0), 'unclaimed_received_amount', COALESCE(sum(GREATEST(a.received_total - a.claimed, 0)), 0))
      INTO v_pay FROM public.ga_pay_po_amounts(ARRAY(SELECT o.id FROM public.ga_purchase_orders o WHERE o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o.ordered_at >= v_start AND o.ordered_at < v_end)) a;
    v_confirmed := v_confirmed || v_pay;
    v_orders := COALESCE((SELECT jsonb_agg(t.e || jsonb_build_object('claimed_amount', COALESCE(a.claimed, 0), 'paid_amount', COALESCE(a.paid, 0), 'unclaimed_received_amount', GREATEST(COALESCE(a.received_total, 0) - COALESCE(a.claimed, 0), 0)) ORDER BY t.ord)
                            FROM jsonb_array_elements(v_orders) WITH ORDINALITY AS t(e, ord) LEFT JOIN public.ga_pay_po_amounts(ARRAY(SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(v_orders) x)) a ON a.po_id = (t.e ->> 'id')::uuid), '[]'::jsonb);
  END IF;
  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$a$, $a$  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_total integer;
  v_can_pay boolean;
  v_pay jsonb;$a$, $a$  v_total integer;$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_purchase_analysis(text,integer,integer) 沒有任何變更'; END IF;
  IF position($a$v_can_pay$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_purchase_analysis(text,integer,integer) 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_po_list(jsonb,integer,integer)$a$::regprocedure);
  IF position($a$v_pay_unclaimed$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))) OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u)))
       AND (NOT v_pay_unclaimed OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u)))$a$, $a$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))))$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');
  v_pay_unclaimed := COALESCE(v_f->>'pay_unclaimed', 'false') IN ('true', 't', '1');
  v_pay := public.ga_pay_can_view(v_uid);
  v_tol := public.ga_pay_tol();$a$, $a$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_attention boolean;
  v_pay_unclaimed boolean;
  v_pay boolean;
  v_tol numeric;$a$, $a$  v_attention boolean;$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_po_list(jsonb,integer,integer) 沒有任何變更'; END IF;
  IF position($a$v_pay_unclaimed$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_po_list(jsonb,integer,integer) 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_summary()$a$::regprocedure);
  IF position($a$pay_unclaimed$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  IF v_c ? 'pay_unclaimed' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.po_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　尚未請款 NT$ ' || x.unclaimed::text, 'at', x.ordered_at) ORDER BY x.ordered_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT o.id, o.po_no, o.vendor_name_snapshot, o.ordered_at, a.received_total - a.claimed AS unclaimed FROM public.ga_purchase_orders o
              JOIN public.ga_pay_po_amounts(ARRAY(SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(public.ga_pay_tol()) u)) a ON a.po_id = o.id ORDER BY o.ordered_at, o.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'pay_unclaimed', 'label', '待請款採購單', 'menu', 'purchase_orders', 'count', (v_c ->> 'pay_unclaimed')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'pay_submitted' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.pr_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　NT$ ' || x.amount_total::text, 'at', x.submitted_at) ORDER BY x.submitted_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT q.id, q.pr_no, q.vendor_name_snapshot, q.amount_total, q.submitted_at FROM public.ga_payment_requests q WHERE q.status = 'SUBMITTED' ORDER BY q.submitted_at, q.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'pay_submitted', 'label', '待付款請款單', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_submitted')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'wo_store_rejected' THEN$a$, $a$  IF v_c ? 'wo_store_rejected' THEN$a$, $a$public.ga_ws_home_summary()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 沒有任何變更'; END IF;
  IF position($a$pay_unclaimed$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_badges()$a$::regprocedure);
  IF position($a$pay_submitted$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$'onboarding', v_c -> 'onboarding_review', 'payment_requests', v_c -> 'pay_submitted'$a$, $a$'onboarding', v_c -> 'onboarding_review'$a$, $a$public.ga_ws_home_badges()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_badges() 沒有任何變更'; END IF;
  IF position($a$pay_submitted$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_home_badges() 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_hm_counts()$a$::regprocedure);
  IF position($a$pay_unclaimed$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  IF v_pay THEN
    SELECT count(*) INTO v_n FROM public.ga_payment_requests WHERE status = 'SUBMITTED';
    v_out := v_out || jsonb_build_object('pay_submitted', v_n);
  END IF;
  RETURN v_out;$a$, $a$  RETURN v_out;$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$    v_out := v_out || jsonb_build_object('po_menu', v_n);
    IF v_pay THEN
      SELECT count(*) INTO v_n FROM public.ga_pay_unclaimed_po_ids(v_tol);
      v_out := v_out || jsonb_build_object('pay_unclaimed', v_n);
    END IF;$a$, $a$    v_out := v_out || jsonb_build_object('po_menu', v_n);$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$SELECT count(*) INTO v_n FROM public.ga_purchase_orders o WHERE public.ga_att_po(o.status, o.expected_delivery_date, v_approve) OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u));$a$, $a$SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, v_approve);$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');
  v_pay := public.ga_pay_can_view(v_uid);
  v_tol := public.ga_pay_tol();$a$, $a$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_n integer;
  v_pay boolean;
  v_tol numeric;$a$, $a$  v_n integer;$a$, $a$public.ga_hm_counts()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_hm_counts() 沒有任何變更'; END IF;
  IF position($a$pay_unclaimed$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_hm_counts() 的第 4.5 批擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_b45_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_pay_unclaimed_po_ids(numeric);
DROP FUNCTION IF EXISTS public.ga_pay_po_amounts(uuid[]);
NOTIFY pgrst, 'reload schema';

COMMIT;
