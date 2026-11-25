-- 正式區草稿 ga-improve-b1-sql/04-ga-improve-b1-prepay.rollback.sql（G1 預付款）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125130000_ga_improve_b1_prepay.rollback.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 04-ga-improve-b1-prepay.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 還原 20261125130000_ga_improve_b1_prepay.sql（G1 預付款）。
-- 安全規則：已有預付請款單、含核銷額的請款明細或預付事件時中止（請先清除測試資料；正式區請先把預付單作廢並確認核銷已回復，事件不可刪除所以已有 prepay_refund 事件時不能撤回）。
-- 既有函式加掛逐字還原；前一階段的延伸點函式還原成前一階段的版本。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'pay_kind') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE pay_kind <> 'NORMAL') THEN RAISE EXCEPTION '不能撤回：還有預付請款單。'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_request_lines' AND column_name = 'prepay_offset') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE prepay_offset <> 0) THEN RAISE EXCEPTION '不能撤回：還有記錄預付核銷額的請款明細。'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ga_payment_request_events WHERE event_type = 'prepay_refund') THEN RAISE EXCEPTION '不能撤回：還有預付退款事件（事件不可刪除）。'; END IF;
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
  IF to_regprocedure('public.ga_pay_po_claimed(uuid,uuid,text)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_po_claimed(uuid,uuid,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$SELECT COALESCE(sum(l.claim_total), 0) + CASE WHEN p_status IS NULL THEN public.ga_pay_po_offset(p_po) ELSE 0 END /* GAIB1-S5 */ FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$SELECT COALESCE(sum(l.claim_total), 0) + CASE WHEN p_status IS NULL THEN public.ga_pay_po_offset(p_po) ELSE 0 END /* GAIB1-S5 */ FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1n$), public.ga_ib1_nl(v_def, $ib1o$SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_po_claimed(uuid,uuid,text) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_unclaimed_po_ids(numeric)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_unclaimed_po_ids(numeric)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$   WHERE s.tot - COALESCE(c.c, 0) - public.ga_pay_po_offset(o.id) /* GAIB1-S5 */ > p_tol;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$   WHERE s.tot - COALESCE(c.c, 0) - public.ga_pay_po_offset(o.id) /* GAIB1-S5 */ > p_tol;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$   WHERE s.tot - COALESCE(c.c, 0) > p_tol;$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_unclaimed_po_ids(numeric) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_po_amounts(uuid[])') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_po_amounts(uuid[])'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$         COALESCE(c.claimed, 0) + public.ga_pay_po_offset(o.id), /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$         COALESCE(c.claimed, 0) + public.ga_pay_po_offset(o.id), /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$         COALESCE(c.claimed, 0),$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_po_amounts(uuid[]) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_apply_lines(uuid,uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_apply_lines(uuid,uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason, prepay_offset) -- GAIB1-S5
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff, v_off);$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason, prepay_offset) -- GAIB1-S5
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff, v_off);$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason)
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff);$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF; -- GAIB1-S5$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF; -- GAIB1-S5$ib1n$), public.ga_ib1_nl(v_def, $ib1o$      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF;$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    v_total := v_u + v_t;
    IF v_off > 0 AND v_total <= 0 THEN PERFORM public.ga_rq_raise(409, 'PREPAY_COVERED', '進貨單 ' || v_rec.receipt_no || ' 已由預付款核銷，免再請款（仍可登錄憑證與連結發票）'); END IF; -- GAIB1-S5$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    v_total := v_u + v_t;
    IF v_off > 0 AND v_total <= 0 THEN PERFORM public.ga_rq_raise(409, 'PREPAY_COVERED', '進貨單 ' || v_rec.receipt_no || ' 已由預付款核銷，免再請款（仍可登錄憑證與連結發票）'); END IF; -- GAIB1-S5$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    v_total := v_u + v_t;$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL AND v_ptax IS NOT NULL THEN v_t := v_ptax; END IF; -- GAIB1-S5
    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL AND v_ptax IS NOT NULL THEN v_t := v_ptax; END IF; -- GAIB1-S5
    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    v_off := public.ga_pay_receipt_offset(v_rid); -- GAIB1-S5
    v_ptax := NULL;
    IF v_u IS NULL AND v_off > 0 THEN
      v_u := round((public.ga_pay_receipt_total(v_rid) - v_off) / (1 + v_rec.tax_rate));
      v_ptax := (public.ga_pay_receipt_total(v_rid) - v_off) - v_u;
    END IF;
    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    v_off := public.ga_pay_receipt_offset(v_rid); -- GAIB1-S5
    v_ptax := NULL;
    IF v_u IS NULL AND v_off > 0 THEN
      v_u := round((public.ga_pay_receipt_total(v_rid) - v_off) / (1 + v_rec.tax_rate));
      v_ptax := (public.ga_pay_receipt_total(v_rid) - v_off) - v_u;
    END IF;
    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  v_ponos text;
  v_off numeric := 0; -- GAIB1-S5
  v_ptax numeric;
BEGIN$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  v_ponos text;
  v_off numeric := 0; -- GAIB1-S5
  v_ptax numeric;
BEGIN$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  v_ponos text;
BEGIN$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_check_live(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_check_live(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_check_tol_reasons(p_pr);
  PERFORM public.ga_ib1_check_prepay_live(p_pr); -- GAIB1-S5$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_check_tol_reasons(p_pr);
  PERFORM public.ga_ib1_check_prepay_live(p_pr); -- GAIB1-S5$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_check_tol_reasons(p_pr);$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_check_live(uuid) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_check_tol_reasons(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_check_tol_reasons(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$AND abs(x.claim_total + x.prepay_offset - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$AND abs(x.claim_total + x.prepay_offset - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$AND abs(x.claim_total - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$x.claim_total + x.prepay_offset /* GAIB1-S5 */ AS claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$x.claim_total + x.prepay_offset /* GAIB1-S5 */ AS claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1n$), public.ga_ib1_nl(v_def, $ib1o$x.claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_check_tol_reasons(uuid) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
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
  IF position(public.ga_ib1_nl(v_def, $ib1n$/* GAUP */ AND q.pay_kind <> 'PREPAY' /* GAIB1-S5 */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$/* GAUP */ AND q.pay_kind <> 'PREPAY' /* GAIB1-S5 */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1n$), public.ga_ib1_nl(v_def, $ib1o$/* GAUP */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason, 'prepay_offset', l.prepay_offset, /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason, 'prepay_offset', l.prepay_offset, /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason,$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_request_json(uuid,boolean,boolean,boolean) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_po_summary(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_po_summary(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id), 'prepay_offset', public.ga_pay_receipt_offset(r.id), /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id), 'prepay_offset', public.ga_pay_receipt_offset(r.id), /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id),$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0), 'prepay', public.ga_ib1_prepay_overview(o.id), /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0), 'prepay', public.ga_ib1_prepay_overview(o.id), /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0),$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_po_summary(uuid) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$        'receipt_prepay_offset', public.ga_pay_receipt_offset(x.receipt_id), 'prepay_covered', (x.u + public.ga_pay_receipt_tax(x.receipt_id) - public.ga_pay_receipt_offset(x.receipt_id) - (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = x.receipt_id AND q.status <> 'VOID') <= 0 AND public.ga_pay_receipt_offset(x.receipt_id) > 0), /* GAIB1-S5 */
        'tolerance', v_tol,$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$        'receipt_prepay_offset', public.ga_pay_receipt_offset(x.receipt_id), 'prepay_covered', (x.u + public.ga_pay_receipt_tax(x.receipt_id) - public.ga_pay_receipt_offset(x.receipt_id) - (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = x.receipt_id AND q.status <> 'VOID') <= 0 AND public.ga_pay_receipt_offset(x.receipt_id) > 0), /* GAIB1-S5 */
        'tolerance', v_tol,$ib1n$), public.ga_ib1_nl(v_def, $ib1o$        'tolerance', v_tol,$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_receipt_candidates(jsonb,integer,integer) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_po_action(uuid,text,timestamp with time zone,text)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_po_action(uuid,text,timestamp with time zone,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF p_action IN ('cancel', 'short_close', 'close') THEN PERFORM public.ga_ib1_prepay_close_guard(p_id); END IF; -- GAIB1-S5
    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    IF p_action IN ('cancel', 'short_close', 'close') THEN PERFORM public.ga_ib1_prepay_close_guard(p_id); END IF; -- GAIB1-S5
    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_po_action(uuid,text,timestamp with time zone,text) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_po_list(jsonb,integer,integer)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_po_list(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),
             'prepay_balance', CASE WHEN v_pay THEN public.ga_pay_po_prepay_balance(b.id) END, /* GAIB1-S5 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),
             'prepay_balance', CASE WHEN v_pay THEN public.ga_pay_po_prepay_balance(b.id) END, /* GAIB1-S5 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),$ib1o$)); END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$       AND (COALESCE(v_f->>'prepaid', '') NOT IN ('1', 'true') OR (v_pay AND public.ga_pay_po_prepay_balance(o.id) > 0)) -- GAIB1-S5
       AND (COALESCE(v_f->>'prepay_overdue', '') NOT IN ('1', 'true') OR (v_pay AND o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND public.ga_pay_po_prepay_balance(o.id) > 0))
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$       AND (COALESCE(v_f->>'prepaid', '') NOT IN ('1', 'true') OR (v_pay AND public.ga_pay_po_prepay_balance(o.id) > 0)) -- GAIB1-S5
       AND (COALESCE(v_f->>'prepay_overdue', '') NOT IN ('1', 'true') OR (v_pay AND o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND public.ga_pay_po_prepay_balance(o.id) > 0))
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1n$), public.ga_ib1_nl(v_def, $ib1o$       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_po_list(jsonb,integer,integer) 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_home_summary()') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_home_summary()'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text || COALESCE(CASE WHEN public.ga_pay_can_view(auth.uid()) AND public.ga_pay_po_prepay_balance(x.id) > 0 THEN '　已預付餘額 NT$' || public.ga_pay_po_prepay_balance(x.id)::bigint END, '') /* GAIB1-S5 */, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text || COALESCE(CASE WHEN public.ga_pay_can_view(auth.uid()) AND public.ga_pay_po_prepay_balance(x.id) > 0 THEN '　已預付餘額 NT$' || public.ga_pay_po_prepay_balance(x.id)::bigint END, '') /* GAIB1-S5 */, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1o$)); END IF;
  IF position('GAIB1-S5' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 還有無法自動移除的 GAIB1-S5 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- 前一階段的延伸點函式還原
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_buyer(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_cur uuid;
  v_new uuid;
  v_txt text;
BEGIN
  PERFORM public.ga_ib1_pay_set_payee(p_pr, p);
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
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_json_ext(p_pr uuid, p_vendor boolean, p_detail boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  v_visible boolean;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  v_visible := q.payee_type <> 'EMPLOYEE' OR p_vendor OR q.payee_profile_id IS NOT DISTINCT FROM auth.uid();
  RETURN jsonb_build_object(
    'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
    'payee_account_snapshot', CASE WHEN v_visible THEN q.payee_account_snapshot ELSE '{}'::jsonb END,
    'payee_account_masked', NOT v_visible,
    'payee_account_last4', CASE WHEN q.payee_type = 'EMPLOYEE' AND q.payee_account_snapshot ->> 'bank_account' IS NOT NULL THEN right(regexp_replace(q.payee_account_snapshot ->> 'bank_account', '[^0-9]', '', 'g'), 4) END);
END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_filter_ok(p_pr uuid, v_f jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT COALESCE(upper(nullif(v_f ->> 'payee_type', '')), '') = '' OR EXISTS (SELECT 1 FROM public.ga_payment_requests q WHERE q.id = p_pr AND q.payee_type = upper(v_f ->> 'payee_type'));
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_export_enrich(p_res jsonb, v_f jsonb, p_uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_can_vendor boolean := public.ga_pay_can_vendor(p_uid);
  v_rows jsonb;
BEGIN
  IF COALESCE(v_f ->> 'extended', '') NOT IN ('1', 'true') OR COALESCE((p_res ->> 'ok')::boolean, false) IS NOT TRUE THEN RETURN p_res; END IF;
  SELECT COALESCE(jsonb_agg(r.value || jsonb_build_object(
      'pay_kind', COALESCE(q.pay_kind_txt, 'NORMAL'), 'payee_type', COALESCE(q.payee_type, 'VENDOR'),
      'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
      'buyer_title', q.buyer_title_snapshot, 'card_last4', q.pay_card_last4, 'platform', q.pay_platform)
      || CASE WHEN v_can_vendor AND q.payee_type = 'EMPLOYEE' THEN jsonb_build_object('payee_bank_name', q.payee_account_snapshot ->> 'bank_name', 'payee_bank_account', q.payee_account_snapshot ->> 'bank_account') ELSE '{}'::jsonb END
      ORDER BY r.ord), '[]'::jsonb)
    INTO v_rows
    FROM jsonb_array_elements(COALESCE(p_res -> 'data' -> 'rows', '[]'::jsonb)) WITH ORDINALITY r(value, ord)
    LEFT JOIN LATERAL (SELECT x.payee_type, x.payee_name_snapshot, x.vendor_name_snapshot, x.buyer_title_snapshot, x.pay_card_last4, x.pay_platform, 'NORMAL'::text AS pay_kind_txt
                         FROM public.ga_payment_requests x WHERE x.pr_no = r.value ->> 'pr_no') q ON true;
  RETURN jsonb_set(p_res, '{data,rows}', v_rows) || jsonb_build_object('extended', true);
END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_receive_ext(p_po uuid, p_receipt uuid, p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  PERFORM public.ga_ib1_receipt_adj_carry(p_po);
END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_void_ext(p_po uuid, p_receipt uuid, p_reason text, p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  DELETE FROM public.ga_purchase_receipt_adjustments WHERE receipt_id = p_receipt;
  PERFORM public.ga_ib1_receipt_adj_carry(p_po);
END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_po_data_ext(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object('buyer_company_name', c.name, 'buyer_company_tax_id', c.tax_id,
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'line_no', a.line_no, 'kind', a.kind, 'label', a.label, 'amount', a.amount, 'original_price', a.original_price,
        'campaign_name', a.campaign_name, 'note', a.note,
        'receipt_no', (SELECT r.receipt_no FROM public.ga_purchase_receipt_adjustments ra JOIN public.ga_purchase_receipts r ON r.id = ra.receipt_id WHERE ra.po_adjustment_id = a.id AND r.voided_at IS NULL LIMIT 1)) ORDER BY a.line_no)
        FROM public.ga_purchase_order_adjustments a WHERE a.po_id = o.id), '[]'::jsonb),
    'adjustment_total', COALESCE((SELECT sum(a.amount) FROM public.ga_purchase_order_adjustments a WHERE a.po_id = o.id), 0))
    FROM public.ga_purchase_orders o LEFT JOIN public.ga_buyer_companies c ON c.id = o.buyer_company_id WHERE o.id = p_id;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_data_ext(p_receipt uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object(
    'amount_total', COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'amount_untaxed', COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'amount_tax', COALESCE((SELECT c.tax FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('po_adjustment_id', ra.po_adjustment_id, 'kind', a.kind, 'label', a.label, 'amount', ra.amount) ORDER BY a.line_no)
                               FROM public.ga_purchase_receipt_adjustments ra JOIN public.ga_purchase_order_adjustments a ON a.id = ra.po_adjustment_id WHERE ra.receipt_id = p_receipt), '[]'::jsonb),
    'has_paid_claim', EXISTS (SELECT 1 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = p_receipt AND q.status = 'PAID'));
$f$;

DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_sync ON public.ga_payment_requests;
DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_guard ON public.ga_payment_requests;
DROP FUNCTION IF EXISTS public.ga_ws_pay_prepay_overview(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_pay_prepay_settle(uuid, numeric, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_pay_prepay_create(jsonb, text);
DROP FUNCTION IF EXISTS public.ga_ib1_check_prepay_live(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_close_guard(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_set_amount(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_sync();
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_guard();
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_cap_check(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.ga_ib1_prepay_overview(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_prepay_release(uuid, text);
DROP FUNCTION IF EXISTS public.ga_pay_prepay_apply(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_po_prepay_balance(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_prepay_balance(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_receipt_offset(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_po_offset(uuid);
DROP TABLE IF EXISTS public.ga_payment_prepay_ledger;
DROP INDEX IF EXISTS public.idx_ga_payment_requests_prepay_po;
ALTER TABLE public.ga_payment_request_events DROP CONSTRAINT IF EXISTS ga_payment_request_events_type_check;
ALTER TABLE public.ga_payment_request_events ADD CONSTRAINT ga_payment_request_events_type_check CHECK ((event_type = ANY (ARRAY['create'::text, 'update'::text, 'submit'::text, 'return'::text, 'mark_paid'::text, 'void'::text, 'note'::text, 'refresh_bank'::text])));
ALTER TABLE public.ga_payment_request_lines DROP CONSTRAINT IF EXISTS ga_payment_request_lines_offset_check;
ALTER TABLE public.ga_payment_request_lines DROP COLUMN IF EXISTS prepay_offset;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_pay_kind_check;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS prepay_po_id;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS pay_kind;
NOTIFY pgrst, 'reload schema';
