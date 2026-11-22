-- 還原 20261120120000_m7m8_b45f_stale_draft.sql：把 ga_hm_counts、ga_ws_home_summary、ga_ws_pay_request_list 的草稿提醒擴充拿掉（形狀不符就中止），並移除 ga_pay_stale_draft_ids。不刪任何資料。可重複執行。
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
  v_def := pg_get_functiondef($a$public.ga_ws_pay_request_list(jsonb,integer,integer)$a$::regprocedure);
  IF position($a$v_stale$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$'draft_count', count(*) FILTER (WHERE status = 'DRAFT'), 'stale_draft_count', (SELECT count(*) FROM public.ga_pay_stale_draft_ids())) FROM public.ga_payment_requests));$a$, $a$'draft_count', count(*) FILTER (WHERE status = 'DRAFT')) FROM public.ga_payment_requests));$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$       AND (NOT v_mine OR q.created_by = v_uid)
       AND (NOT v_stale OR q.id IN (SELECT s.id FROM public.ga_pay_stale_draft_ids() s))$a$, $a$       AND (NOT v_mine OR q.created_by = v_uid)$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$  v_mine boolean := COALESCE(v_f ->> 'mine', '') IN ('true', '1');
  v_stale boolean := COALESCE(v_f ->> 'stale_draft', '') IN ('true', '1');$a$, $a$  v_mine boolean := COALESCE(v_f ->> 'mine', '') IN ('true', '1');$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_pay_request_list(jsonb,integer,integer) 沒有任何變更'; END IF;
  IF position($a$v_stale$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_list(jsonb,integer,integer) 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_summary()$a$::regprocedure);
  IF position($a$pay_stale_draft$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$'label', '待付款請款單', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_submitted')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'pay_stale_draft' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.pr_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　NT$ ' || x.amount_total::text || '　已放 ' || x.days::text || ' 天', 'at', x.since) ORDER BY x.since, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT q.id, q.pr_no, q.vendor_name_snapshot, q.amount_total, COALESCE(q.last_return_at, q.created_at) AS since, (public.ga_po_today() - (COALESCE(q.last_return_at, q.created_at) AT TIME ZONE 'Asia/Taipei')::date) AS days
              FROM public.ga_payment_requests q WHERE q.id IN (SELECT s.id FROM public.ga_pay_stale_draft_ids() s) ORDER BY COALESCE(q.last_return_at, q.created_at), q.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'pay_stale_draft', 'label', '逾 14 天未送出的請款草稿', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_stale_draft')::integer, 'top', v_top));
  END IF;$a$, $a$'label', '待付款請款單', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_submitted')::integer, 'top', v_top));
  END IF;$a$, $a$ga_ws_home_summary()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 沒有任何變更'; END IF;
  IF position($a$pay_stale_draft$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_hm_counts()$a$::regprocedure);
  IF position($a$pay_stale_draft$a$ IN v_def) = 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    v_out := v_out || jsonb_build_object('pay_submitted', v_n);
    SELECT count(*) INTO v_n FROM public.ga_pay_stale_draft_ids();
    v_out := v_out || jsonb_build_object('pay_stale_draft', v_n);$a$, $a$    v_out := v_out || jsonb_build_object('pay_submitted', v_n);$a$, $a$ga_hm_counts()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_hm_counts() 沒有任何變更'; END IF;
  IF position($a$pay_stale_draft$a$ IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_hm_counts() 的第 4.5 批追加擴充無法自動拿掉，請人工處理'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_pay_stale_draft_ids();
DROP FUNCTION IF EXISTS public.ga_b45f_swap(text, text, text, text);
NOTIFY pgrst, 'reload schema';
