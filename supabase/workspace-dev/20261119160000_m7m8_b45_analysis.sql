-- M7/M8 第 4.5 批 H（G45-stat）：採購分析、廠商績效、採購單清單 attention、首頁與導覽徽章的請款擴充（DEV）。
-- 內容：
--   1. 內部輔助：ga_pay_unclaimed_po_ids(tol)（待請款採購單：累計驗入含稅額 - 有效請款累計 > 尾差；單一 SQL 述詞、不帶 search_path，可被規劃器內嵌；已作廢進貨不計）、
--      ga_pay_po_amounts(ids[])（逐張採購單的驗入含稅額、有效請款額、已付款額）。
--   2. ga_hm_counts 新增 pay_unclaimed（待請款採購單，需請款檢視／管理且能看採購單）與 pay_submitted（待付款請款單＝SUBMITTED，需請款檢視／管理）；
--      po_menu（採購單選單徽章）與採購單清單 attention 聯集加入「待請款」，新增篩選 pay_unclaimed；兩者與徽章同一個述詞，數字必等於點進去的列表筆數。
--   3. ga_ws_home_badges 新增選單 payment_requests（待付款）；ga_ws_home_summary 新增「待請款採購單」「待付款請款單」兩個待辦。
--   4. ga_ws_purchase_analysis 新增 claimed_amount、paid_amount、unclaimed_received_amount（只給有請款檢視／管理權限者，並標 can_view_payment）；
--      ga_ws_vendor_perf 新增 po_paid_amount、po_paid_total（已付款金額）。原有欄位與口徑不動；已作廢進貨不計入任何統計。
--   以讀現行函式定義再文字替換的方式加入，已套用就略過，形狀不符就中止。不新增權限碼（沿用 purchase_payment.view／manage）。
-- 先決：20261119110000（請款單）、150000（ga_pay_*）、第 6 批 20261118120000／150000。
-- 還原：20261119160000_m7m8_b45_analysis.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regclass('public.ga_payment_request_lines') IS NULL OR to_regprocedure('public.ga_pay_tol()') IS NULL OR to_regprocedure('public.ga_pay_can_view(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261119110000、20261119150000';
  END IF;
  IF to_regprocedure('public.ga_hm_counts()') IS NULL OR to_regprocedure('public.ga_ws_home_badges()') IS NULL OR to_regprocedure('public.ga_ws_home_summary()') IS NULL
     OR to_regprocedure('public.ga_ws_purchase_analysis(text,integer,integer)') IS NULL OR to_regprocedure('public.ga_ws_vendor_perf(text,text)') IS NULL OR to_regprocedure('public.ga_ws_po_list(jsonb,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 6 批 20261118120000（ga_hm_counts 等）';
  END IF;
END $$;

-- ================================================================ 1. 內部輔助
-- 待請款採購單：單一 SQL 述詞，不帶 search_path（可被規劃器內嵌），全部以 public. 完整限定名稱。
CREATE OR REPLACE FUNCTION public.ga_pay_unclaimed_po_ids(p_tol numeric) RETURNS TABLE (po_id uuid) LANGUAGE sql STABLE
AS $f$
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$f$;
REVOKE ALL ON FUNCTION public.ga_pay_unclaimed_po_ids(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_unclaimed_po_ids(numeric) TO service_role;

-- 逐張採購單：驗入含稅額（未作廢進貨）、有效請款額（非作廢請款單）、已付款額（PAID）。
CREATE OR REPLACE FUNCTION public.ga_pay_po_amounts(p_ids uuid[]) RETURNS TABLE (po_id uuid, received_total numeric, claimed numeric, paid numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT o.id,
         COALESCE(s.tot, 0),
         COALESCE(c.claimed, 0),
         COALESCE(c.paid, 0)
    FROM public.ga_purchase_orders o
    LEFT JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL AND r.po_id = ANY (p_ids) GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) FILTER (WHERE q.status <> 'VOID') AS claimed, sum(l.claim_total) FILTER (WHERE q.status = 'PAID') AS paid
                 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = ANY (p_ids) GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE o.id = ANY (p_ids);
$f$;
REVOKE ALL ON FUNCTION public.ga_pay_po_amounts(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_po_amounts(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.ga_b45_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

-- ================================================================ 2. 現行函式文字替換
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_hm_counts()$a$::regprocedure);
  IF position($a$pay_unclaimed$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  v_n integer;$a$, $a$  v_n integer;
  v_pay boolean;
  v_tol numeric;$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');$a$, $a$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');
  v_pay := public.ga_pay_can_view(v_uid);
  v_tol := public.ga_pay_tol();$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, v_approve);$a$, $a$SELECT count(*) INTO v_n FROM public.ga_purchase_orders o WHERE public.ga_att_po(o.status, o.expected_delivery_date, v_approve) OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u));$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$    v_out := v_out || jsonb_build_object('po_menu', v_n);$a$, $a$    v_out := v_out || jsonb_build_object('po_menu', v_n);
    IF v_pay THEN
      SELECT count(*) INTO v_n FROM public.ga_pay_unclaimed_po_ids(v_tol);
      v_out := v_out || jsonb_build_object('pay_unclaimed', v_n);
    END IF;$a$, $a$public.ga_hm_counts()$a$);
  v_new := public.ga_b45_swap(v_new, $a$  RETURN v_out;$a$, $a$  IF v_pay THEN
    SELECT count(*) INTO v_n FROM public.ga_payment_requests WHERE status = 'SUBMITTED';
    v_out := v_out || jsonb_build_object('pay_submitted', v_n);
  END IF;
  RETURN v_out;$a$, $a$public.ga_hm_counts()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_hm_counts() 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_badges()$a$::regprocedure);
  IF position($a$pay_submitted$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$'onboarding', v_c -> 'onboarding_review'$a$, $a$'onboarding', v_c -> 'onboarding_review', 'payment_requests', v_c -> 'pay_submitted'$a$, $a$public.ga_ws_home_badges()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_badges() 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_summary()$a$::regprocedure);
  IF position($a$pay_unclaimed$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  IF v_c ? 'wo_store_rejected' THEN$a$, $a$  IF v_c ? 'pay_unclaimed' THEN
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
  IF v_c ? 'wo_store_rejected' THEN$a$, $a$public.ga_ws_home_summary()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_po_list(jsonb,integer,integer)$a$::regprocedure);
  IF position($a$v_pay_unclaimed$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  v_attention boolean;$a$, $a$  v_attention boolean;
  v_pay_unclaimed boolean;
  v_pay boolean;
  v_tol numeric;$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');$a$, $a$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');
  v_pay_unclaimed := COALESCE(v_f->>'pay_unclaimed', 'false') IN ('true', 't', '1');
  v_pay := public.ga_pay_can_view(v_uid);
  v_tol := public.ga_pay_tol();$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))))$a$, $a$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))) OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u)))
       AND (NOT v_pay_unclaimed OR (v_pay AND o.id IN (SELECT u.po_id FROM public.ga_pay_unclaimed_po_ids(v_tol) u)))$a$, $a$public.ga_ws_po_list(jsonb,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_po_list(jsonb,integer,integer) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_purchase_analysis(text,integer,integer)$a$::regprocedure);
  IF position($a$v_can_pay$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  v_total integer;$a$, $a$  v_total integer;
  v_can_pay boolean;
  v_pay jsonb;$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$a$, $a$  -- 已請款、已付款、未請款驗入（只給有請款檢視或管理權限者；已作廢進貨不計入，只算有效請款單）
  v_can_pay := public.ga_pay_can_view(v_uid);
  IF v_can_pay THEN
    SELECT jsonb_build_object('claimed_amount', COALESCE(sum(a.claimed), 0), 'paid_amount', COALESCE(sum(a.paid), 0), 'unclaimed_received_amount', COALESCE(sum(GREATEST(a.received_total - a.claimed, 0)), 0))
      INTO v_pay FROM public.ga_pay_po_amounts(ARRAY(SELECT o.id FROM public.ga_purchase_orders o WHERE o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o.ordered_at >= v_start AND o.ordered_at < v_end)) a;
    v_confirmed := v_confirmed || v_pay;
    v_orders := COALESCE((SELECT jsonb_agg(t.e || jsonb_build_object('claimed_amount', COALESCE(a.claimed, 0), 'paid_amount', COALESCE(a.paid, 0), 'unclaimed_received_amount', GREATEST(COALESCE(a.received_total, 0) - COALESCE(a.claimed, 0), 0)) ORDER BY t.ord)
                            FROM jsonb_array_elements(v_orders) WITH ORDINALITY AS t(e, ord) LEFT JOIN public.ga_pay_po_amounts(ARRAY(SELECT (x ->> 'id')::uuid FROM jsonb_array_elements(v_orders) x)) a ON a.po_id = (t.e ->> 'id')::uuid), '[]'::jsonb);
  END IF;
  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  v_new := public.ga_b45_swap(v_new, $a$'orders', v_orders, 'orders_total', v_total,$a$, $a$'orders', v_orders, 'can_view_payment', v_can_pay, 'orders_total', v_total,$a$, $a$public.ga_ws_purchase_analysis(text,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_purchase_analysis(text,integer,integer) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_vendor_perf(text,text)$a$::regprocedure);
  IF position($a$v_can_pay$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45_swap(v_new, $a$  v_can_po boolean;$a$, $a$  v_can_po boolean;
  v_can_pay boolean;$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$  v_can_po := public.ga_po_can_view(v_uid);$a$, $a$  v_can_po := public.ga_po_can_view(v_uid);
  v_can_pay := v_can_po AND public.ga_pay_can_view(v_uid);$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount$a$, $a$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount, COALESCE(sum(pd.paid), 0) AS po_paid$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$      FROM public.ga_purchase_orders o
$a$, $a$      FROM public.ga_purchase_orders o LEFT JOIN LATERAL (SELECT COALESCE(sum(l.claim_total), 0) AS paid FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE v_can_pay AND l.po_id = o.id AND q.status = 'PAID') pd ON true
$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount$a$, $a$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount, COALESCE(p.po_paid, 0) AS po_paid$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$'po_amount', CASE WHEN v_can_po THEN m.po_amount END,$a$, $a$'po_amount', CASE WHEN v_can_po THEN m.po_amount END, 'po_paid_amount', CASE WHEN v_can_pay THEN m.po_paid END,$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$           'po_amount_total', CASE WHEN v_can_po THEN$a$, $a$           'po_paid_total', CASE WHEN v_can_pay THEN (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id JOIN public.ga_purchase_orders o2 ON o2.id = l.po_id WHERE q.status = 'PAID' AND o2.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o2.ordered_at >= v_start AND o2.ordered_at < v_end AND o2.vendor_id IS NOT NULL) END,
           'po_amount_total', CASE WHEN v_can_po THEN$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  v_new := public.ga_b45_swap(v_new, $a$'can_view_po_amount', v_can_po,$a$, $a$'can_view_po_amount', v_can_po, 'can_view_pay_amount', v_can_pay,$a$, $a$public.ga_ws_vendor_perf(text,text)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_vendor_perf(text,text) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_b45_swap(text, text, text, text);

NOTIFY pgrst, 'reload schema';
