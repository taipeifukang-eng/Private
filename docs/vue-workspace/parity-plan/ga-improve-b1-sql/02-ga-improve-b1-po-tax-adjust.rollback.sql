-- 正式區草稿 ga-improve-b1-sql/02-ga-improve-b1-po-tax-adjust.rollback.sql（G2 含稅單價、G3 調整列）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125110000_ga_improve_b1_po_tax_adjust.rollback.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 02-ga-improve-b1-po-tax-adjust.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 還原 20261125110000_ga_improve_b1_po_tax_adjust.sql（G2 含稅單價、G3 調整列）。
-- 先決：階段 4、5（120000、130000）已先撤回。
-- 安全規則：已有含稅採購單、調整列或進貨承接列時中止（請先清除測試資料；正式區請先確認這些單據可以失去含稅與調整資訊）。
-- 既有函式加掛與整支替換都逐字還原，不影響其他人後來的修改以外的內容。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_orders' AND column_name = 'price_mode') THEN
    IF EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE price_mode <> 'EXCL') THEN RAISE EXCEPTION '不能撤回：還有含稅計價的採購單。'; END IF;
  END IF;
  IF to_regclass('public.ga_purchase_order_adjustments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ga_purchase_order_adjustments) THEN RAISE EXCEPTION '不能撤回：還有採購單調整列（運費、折扣等）。'; END IF;
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
  IF to_regprocedure('public.ga_po_refresh_totals(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_refresh_totals(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
DECLARE
  v_po public.ga_purchase_orders%ROWTYPE;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_total numeric;
  v_adj numeric;
  v_req boolean;
BEGIN
  /* GAIB1-S3 */
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_rate := CASE WHEN v_po.status = 'DRAFT' THEN public.ga_wf_num('po_tax_rate', 0.05) ELSE v_po.tax_rate END;
  SELECT COALESCE(sum(amount), 0) INTO v_adj FROM public.ga_purchase_order_adjustments WHERE po_id = p_po_id;
  IF v_po.price_mode = 'INCL' THEN
    SELECT COALESCE(sum(COALESCE(line_gross, line_amount)), 0) + v_adj INTO v_total FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
    IF v_total < 0 THEN PERFORM public.ga_po_raise(400, 'PO_TOTAL_NEGATIVE', '折扣與折抵超過品項金額，請調整'); END IF;
    v_sub := round(v_total / (1 + v_rate));
    v_tax := v_total - v_sub;
  ELSE
    SELECT COALESCE(sum(line_amount), 0) + v_adj INTO v_sub FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
    IF v_sub < 0 THEN PERFORM public.ga_po_raise(400, 'PO_TOTAL_NEGATIVE', '折扣與折抵超過品項金額，請調整'); END IF;
    v_tax := round(v_sub * v_rate);
    v_total := v_sub + v_tax;
  END IF;
  v_req := CASE WHEN v_po.status = 'DRAFT' THEN (public.ga_wf_num('po_approval_enabled', 1) >= 1 AND v_total > public.ga_wf_num('po_approval_threshold', 5000)) ELSE v_po.approval_required END;
  IF v_po.tax_rate IS DISTINCT FROM v_rate OR v_po.subtotal IS DISTINCT FROM v_sub OR v_po.tax_amount IS DISTINCT FROM v_tax
     OR v_po.total_amount IS DISTINCT FROM v_total OR v_po.approval_required IS DISTINCT FROM v_req THEN
    UPDATE public.ga_purchase_orders SET tax_rate = v_rate, subtotal = v_sub, tax_amount = v_tax, total_amount = v_total, approval_required = v_req WHERE id = p_po_id;
  END IF;
END;
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
DECLARE
  v_po public.ga_purchase_orders%ROWTYPE;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_total numeric;
  v_adj numeric;
  v_req boolean;
BEGIN
  /* GAIB1-S3 */
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_rate := CASE WHEN v_po.status = 'DRAFT' THEN public.ga_wf_num('po_tax_rate', 0.05) ELSE v_po.tax_rate END;
  SELECT COALESCE(sum(amount), 0) INTO v_adj FROM public.ga_purchase_order_adjustments WHERE po_id = p_po_id;
  IF v_po.price_mode = 'INCL' THEN
    SELECT COALESCE(sum(COALESCE(line_gross, line_amount)), 0) + v_adj INTO v_total FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
    IF v_total < 0 THEN PERFORM public.ga_po_raise(400, 'PO_TOTAL_NEGATIVE', '折扣與折抵超過品項金額，請調整'); END IF;
    v_sub := round(v_total / (1 + v_rate));
    v_tax := v_total - v_sub;
  ELSE
    SELECT COALESCE(sum(line_amount), 0) + v_adj INTO v_sub FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
    IF v_sub < 0 THEN PERFORM public.ga_po_raise(400, 'PO_TOTAL_NEGATIVE', '折扣與折抵超過品項金額，請調整'); END IF;
    v_tax := round(v_sub * v_rate);
    v_total := v_sub + v_tax;
  END IF;
  v_req := CASE WHEN v_po.status = 'DRAFT' THEN (public.ga_wf_num('po_approval_enabled', 1) >= 1 AND v_total > public.ga_wf_num('po_approval_threshold', 5000)) ELSE v_po.approval_required END;
  IF v_po.tax_rate IS DISTINCT FROM v_rate OR v_po.subtotal IS DISTINCT FROM v_sub OR v_po.tax_amount IS DISTINCT FROM v_tax
     OR v_po.total_amount IS DISTINCT FROM v_total OR v_po.approval_required IS DISTINCT FROM v_req THEN
    UPDATE public.ga_purchase_orders SET tax_rate = v_rate, subtotal = v_sub, tax_amount = v_tax, total_amount = v_total, approval_required = v_req WHERE id = p_po_id;
  END IF;
END;
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$
DECLARE
  v_po public.ga_purchase_orders%ROWTYPE;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_req boolean;
BEGIN
  SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_rate := CASE WHEN v_po.status = 'DRAFT' THEN public.ga_wf_num('po_tax_rate', 0.05) ELSE v_po.tax_rate END;
  SELECT COALESCE(sum(line_amount), 0) INTO v_sub FROM public.ga_purchase_order_items WHERE po_id = p_po_id;
  v_tax := round(v_sub * v_rate);
  v_req := CASE WHEN v_po.status = 'DRAFT' THEN (public.ga_wf_num('po_approval_enabled', 1) >= 1 AND v_sub + v_tax > public.ga_wf_num('po_approval_threshold', 5000)) ELSE v_po.approval_required END;
  IF v_po.tax_rate IS DISTINCT FROM v_rate OR v_po.subtotal IS DISTINCT FROM v_sub OR v_po.tax_amount IS DISTINCT FROM v_tax
     OR v_po.total_amount IS DISTINCT FROM v_sub + v_tax OR v_po.approval_required IS DISTINCT FROM v_req THEN
    UPDATE public.ga_purchase_orders SET tax_rate = v_rate, subtotal = v_sub, tax_amount = v_tax, total_amount = v_sub + v_tax, approval_required = v_req WHERE id = p_po_id;
  END IF;
END;
$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_refresh_totals(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_freeze_receipt_item_amount()') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_freeze_receipt_item_amount()'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
DECLARE
  v_it record;
BEGIN
  /* GAIB1-S3 */
  IF NEW.amount_untaxed IS NULL THEN
    SELECT i.unit_price, i.unit_price_gross, o.price_mode, o.tax_rate INTO v_it
      FROM public.ga_purchase_order_items i JOIN public.ga_purchase_orders o ON o.id = i.po_id WHERE i.id = NEW.po_item_id;
    IF v_it.price_mode = 'INCL' AND v_it.unit_price_gross IS NOT NULL THEN
      NEW.amount_gross := round(v_it.unit_price_gross * NEW.accepted_qty);
      NEW.amount_untaxed := round(NEW.amount_gross / (1 + v_it.tax_rate));
    ELSE
      NEW.amount_untaxed := round(v_it.unit_price * NEW.accepted_qty);
    END IF;
    IF NEW.amount_untaxed IS NULL THEN NEW.amount_untaxed := 0; END IF;
  END IF;
  RETURN NEW;
END;
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
DECLARE
  v_it record;
BEGIN
  /* GAIB1-S3 */
  IF NEW.amount_untaxed IS NULL THEN
    SELECT i.unit_price, i.unit_price_gross, o.price_mode, o.tax_rate INTO v_it
      FROM public.ga_purchase_order_items i JOIN public.ga_purchase_orders o ON o.id = i.po_id WHERE i.id = NEW.po_item_id;
    IF v_it.price_mode = 'INCL' AND v_it.unit_price_gross IS NOT NULL THEN
      NEW.amount_gross := round(v_it.unit_price_gross * NEW.accepted_qty);
      NEW.amount_untaxed := round(NEW.amount_gross / (1 + v_it.tax_rate));
    ELSE
      NEW.amount_untaxed := round(v_it.unit_price * NEW.accepted_qty);
    END IF;
    IF NEW.amount_untaxed IS NULL THEN NEW.amount_untaxed := 0; END IF;
  END IF;
  RETURN NEW;
END;
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$
BEGIN
  IF NEW.amount_untaxed IS NULL THEN
    SELECT round(i.unit_price * NEW.accepted_qty) INTO NEW.amount_untaxed FROM public.ga_purchase_order_items i WHERE i.id = NEW.po_item_id;
    IF NEW.amount_untaxed IS NULL THEN NEW.amount_untaxed := 0; END IF;
  END IF;
  RETURN NEW;
END;
$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_freeze_receipt_item_amount() 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_receipt_untaxed(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_receipt_untaxed(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$ SELECT COALESCE(sum(amount_untaxed), 0) FROM public.ga_purchase_receipt_items WHERE receipt_id = p_receipt; $ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_receipt_untaxed(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_receipt_total(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_receipt_total(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$ SELECT public.ga_pay_receipt_untaxed(p_receipt) + round(public.ga_pay_receipt_untaxed(p_receipt) * COALESCE(public.ga_pay_receipt_rate(p_receipt), 0)); $ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_receipt_total(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_pay_po_received(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_pay_po_received(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(c.untaxed), 0) AS u, COALESCE(sum(c.tax), 0) AS t
                    FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) c
                   WHERE r.po_id = p_po AND r.voided_at IS NULL) s
   WHERE o.id = p_po;
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(c.untaxed), 0) AS u, COALESCE(sum(c.tax), 0) AS t
                    FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) c
                   WHERE r.po_id = p_po AND r.voided_at IS NULL) s
   WHERE o.id = p_po;
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(x.u), 0) AS u, COALESCE(sum(round(x.u * o.tax_rate)), 0) AS t
                    FROM (SELECT sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id
                           WHERE r.po_id = p_po AND r.voided_at IS NULL GROUP BY r.id) x) s
   WHERE o.id = p_po;
$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_po_received(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
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
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id,
         COALESCE(s.tot, 0),
         COALESCE(c.claimed, 0),
         COALESCE(c.paid, 0)
    FROM public.ga_purchase_orders o
    LEFT JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL AND r.po_id = ANY (p_ids) GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) FILTER (WHERE q.status <> 'VOID') AS claimed, sum(l.claim_total) FILTER (WHERE q.status = 'PAID') AS paid
                 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = ANY (p_ids) GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE o.id = ANY (p_ids);
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id,
         COALESCE(s.tot, 0),
         COALESCE(c.claimed, 0),
         COALESCE(c.paid, 0)
    FROM public.ga_purchase_orders o
    LEFT JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL AND r.po_id = ANY (p_ids) GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) FILTER (WHERE q.status <> 'VOID') AS claimed, sum(l.claim_total) FILTER (WHERE q.status = 'PAID') AS paid
                 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = ANY (p_ids) GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE o.id = ANY (p_ids);
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$
  SELECT o.id,
         COALESCE(s.tot, 0),
         COALESCE(c.claimed, 0),
         COALESCE(c.paid, 0)
    FROM public.ga_purchase_orders o
    LEFT JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL AND r.po_id = ANY (p_ids) GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) FILTER (WHERE q.status <> 'VOID') AS claimed, sum(l.claim_total) FILTER (WHERE q.status = 'PAID') AS paid
                 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = ANY (p_ids) GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE o.id = ANY (p_ids);
$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_po_amounts(uuid[]) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
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
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1n$), public.ga_ib1_nl(v_def, $ib1o$
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_unclaimed_po_ids(numeric) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_po_items_apply(uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_items_apply(uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$            v_mode, v_sid, v_tid, v_over, v_note);
    PERFORM public.ga_ib1_item_incl(p_po_id, v_no); -- GAIB1-S3
  END LOOP;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$            v_mode, v_sid, v_tid, v_over, v_note);
    PERFORM public.ga_ib1_item_incl(p_po_id, v_no); -- GAIB1-S3
  END LOOP;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$            v_mode, v_sid, v_tid, v_over, v_note);
  END LOOP;$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_items_apply(uuid,jsonb) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_po_receive(uuid,jsonb,jsonb,text)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_po_receive(uuid,jsonb,jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receive_ext(p_po_id, v_rid, v_uid); -- GAIB1-S3
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receive_ext(p_po_id, v_rid, v_uid); -- GAIB1-S3
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_po_receive(uuid,jsonb,jsonb,text) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receipt_void_ext(p_po_id, r.id, v_reason, v_uid); -- GAIB1-S3
    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receipt_void_ext(p_po_id, r.id, v_reason, v_uid); -- GAIB1-S3
    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_po_receipt_data(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_receipt_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items) || public.ga_ib1_receipt_data_ext(p_id); -- GAIB1-S3$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items) || public.ga_ib1_receipt_data_ext(p_id); -- GAIB1-S3$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items);$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_receipt_data(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
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
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid) THEN public.ga_pay_receipt_tax(v_rid) ELSE round(v_u * v_rec.tax_rate) END; END IF; /* GAIB1-S3 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid) THEN public.ga_pay_receipt_tax(v_rid) ELSE round(v_u * v_rec.tax_rate) END; END IF; /* GAIB1-S3 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    IF v_t IS NULL THEN v_t := round(v_u * v_rec.tax_rate); END IF;$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
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
  IF position(public.ga_ib1_nl(v_def, $ib1n$'receipt_tax', public.ga_pay_receipt_tax(x.receipt_id), 'receipt_total', x.u + public.ga_pay_receipt_tax(x.receipt_id), /* GAIB1-S3 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'receipt_tax', public.ga_pay_receipt_tax(x.receipt_id), 'receipt_total', x.u + public.ga_pay_receipt_tax(x.receipt_id), /* GAIB1-S3 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'receipt_tax', round(x.u * x.tax_rate), 'receipt_total', x.u + round(x.u * x.tax_rate),$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_receipt_candidates(jsonb,integer,integer) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_po_data(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'unit_price', i.unit_price, 'line_amount', i.line_amount, 'unit_price_gross', i.unit_price_gross, 'line_gross', i.line_gross, /* GAIB1-S3 */$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$'unit_price', i.unit_price, 'line_amount', i.line_amount, 'unit_price_gross', i.unit_price_gross, 'line_gross', i.line_gross, /* GAIB1-S3 */$ib1n$), public.ga_ib1_nl(v_def, $ib1o$'unit_price', i.unit_price, 'line_amount', i.line_amount,$ib1o$)); END IF;
  IF position('GAIB1-S3' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_data(uuid) 還有無法自動移除的 GAIB1-S3 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- 階段 2 的延伸點還原成階段 2 的版本
CREATE OR REPLACE FUNCTION public.ga_ib1_po_header_ext(p_po_id uuid, p_header jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_txt text;
  v_id uuid;
  v_cur uuid;
BEGIN
  IF p_header ? 'buyer_company_id' THEN
    SELECT buyer_company_id INTO v_cur FROM public.ga_purchase_orders WHERE id = p_po_id;
    v_txt := nullif(btrim(COALESCE(p_header ->> 'buyer_company_id', '')), '');
    IF v_txt IS NULL THEN
      v_id := public.ga_ib1_buyer_default_id();
    ELSE
      IF v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM public.ga_po_raise(400, 'INVALID_BUYER', '買受人公司格式錯誤'); END IF;
      v_id := v_txt::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_id AND (is_active OR id = v_cur)) THEN PERFORM public.ga_po_raise(404, 'BUYER_NOT_FOUND', '找不到這家買受人公司，或已停用'); END IF;
    END IF;
    UPDATE public.ga_purchase_orders SET buyer_company_id = v_id WHERE id = p_po_id AND buyer_company_id IS DISTINCT FROM v_id;
  END IF;
END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_po_data_ext(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object('buyer_company_name', c.name, 'buyer_company_tax_id', c.tax_id)
    FROM public.ga_purchase_orders o LEFT JOIN public.ga_buyer_companies c ON c.id = o.buyer_company_id WHERE o.id = p_id;
$f$;

DROP FUNCTION IF EXISTS public.ga_ib1_receipt_data_ext(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_receipt_void_ext(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_receive_ext(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_receipt_adj_carry(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_receipt_tax(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_receipt_calc(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_item_incl(uuid, integer);
DROP FUNCTION IF EXISTS public.ga_ib1_adjustments_apply(uuid, jsonb);
DROP TABLE IF EXISTS public.ga_purchase_receipt_adjustments;
DROP TABLE IF EXISTS public.ga_purchase_order_adjustments;
ALTER TABLE public.ga_purchase_receipt_items DROP COLUMN IF EXISTS amount_gross;
ALTER TABLE public.ga_purchase_order_items DROP COLUMN IF EXISTS line_gross;
ALTER TABLE public.ga_purchase_order_items DROP COLUMN IF EXISTS unit_price_gross;
ALTER TABLE public.ga_purchase_orders DROP CONSTRAINT IF EXISTS ga_purchase_orders_price_mode_check;
ALTER TABLE public.ga_purchase_orders DROP COLUMN IF EXISTS price_mode;
NOTIFY pgrst, 'reload schema';
