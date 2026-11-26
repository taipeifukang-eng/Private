-- 正式區草稿 ga-improve-b1-sql/02-ga-improve-b1-po-tax-adjust.sql（G2 含稅單價、G3 調整列）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125110000_ga_improve_b1_po_tax_adjust.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 02-ga-improve-b1-po-tax-adjust.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 總務採購與請款改善第一批（ga-improve-b1）階段 3：G2 含稅單價、G3 調整列（DEV；正式區草稿 ga-improve-b1-sql/02 內容相同）。
-- 內容：
--   1. 欄位與資料表：ga_purchase_orders.price_mode（EXCL 未稅／INCL 含稅，預設 EXCL）、品項 unit_price_gross／line_gross、進貨明細 amount_gross（皆可為空）；
--      ga_purchase_order_adjustments（運費、折扣、折價券、點數折抵、其他，每張採購單最多 10 列）、ga_purchase_receipt_adjustments（進貨單承接的調整列，進貨當下凍結）。
--   2. 計算：ga_po_refresh_totals（未稅與含稅兩個分支，含調整列）；ga_ib1_receipt_calc（進貨單未稅、稅額、含稅，未稅分支與原式相同）；
--      ga_pay_receipt_untaxed／total／tax、ga_pay_po_received、ga_pay_po_amounts、ga_pay_unclaimed_po_ids 改走同一支計算；進貨明細金額凍結觸發器多含稅分支。
--   3. 承接：進貨驗入後由「第一張品項額加調整額大於 0 的有效進貨單」承接全部調整列；作廢承接進貨單時轉給下一張符合條件者。調整列不攤入庫存成本。
--   4. 既有函式加掛（GAIB1-S3 標記，撤回時逐字還原）：ga_po_items_apply、ga_ws_po_receive、ga_ws_po_receipt_void、ga_po_receipt_data、ga_pay_apply_lines（請款預設額用進貨單含稅與稅額）、既有被整支替換的計算函式。
-- 不新增權限碼、不授權給任何角色。沒用到含稅與調整列時，所有金額與原式逐位相同。可重複執行。先決：20261125100000。
-- 還原：20261125110000_ga_improve_b1_po_tax_adjust.rollback.sql（已有含稅採購單或調整列時中止）。
DO $$
BEGIN
  IF to_regprocedure('public.ga_ib1_po_header_ext(uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261125100000_ga_improve_b1_buyer_companies'; END IF;
  IF to_regclass('public.ga_purchase_receipts') IS NULL OR to_regclass('public.ga_purchase_receipt_items') IS NULL OR to_regclass('public.ga_purchase_order_items') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: 採購單與進貨表'; END IF;
END $$;

-- ================================================================ 1. 欄位與資料表
ALTER TABLE public.ga_purchase_orders ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'EXCL';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_purchase_orders_price_mode_check' AND conrelid = 'public.ga_purchase_orders'::regclass) THEN
    ALTER TABLE public.ga_purchase_orders ADD CONSTRAINT ga_purchase_orders_price_mode_check CHECK (price_mode IN ('EXCL', 'INCL'));
  END IF;
END $$;
ALTER TABLE public.ga_purchase_order_items ADD COLUMN IF NOT EXISTS unit_price_gross numeric(14,4);
ALTER TABLE public.ga_purchase_order_items ADD COLUMN IF NOT EXISTS line_gross numeric(14,0);
ALTER TABLE public.ga_purchase_receipt_items ADD COLUMN IF NOT EXISTS amount_gross numeric(14,0);

CREATE TABLE IF NOT EXISTS public.ga_purchase_order_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  amount numeric(14,0) NOT NULL,
  original_price numeric(14,0),
  campaign_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_po_adjustments_kind_check CHECK (kind IN ('FREIGHT', 'DISCOUNT', 'COUPON', 'POINTS', 'OTHER')),
  CONSTRAINT ga_po_adjustments_amount_check CHECK (amount <> 0 AND (kind <> 'FREIGHT' OR amount > 0) AND (kind NOT IN ('DISCOUNT', 'COUPON', 'POINTS') OR amount < 0)),
  CONSTRAINT ga_po_adjustments_text_check CHECK (char_length(label) BETWEEN 1 AND 60 AND (campaign_name IS NULL OR char_length(campaign_name) <= 100) AND (note IS NULL OR char_length(note) <= 200)),
  CONSTRAINT ga_po_adjustments_line_unique UNIQUE (po_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ga_po_adjustments_po ON public.ga_purchase_order_adjustments (po_id);

CREATE TABLE IF NOT EXISTS public.ga_purchase_receipt_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.ga_purchase_receipts(id) ON DELETE CASCADE,
  po_adjustment_id uuid NOT NULL REFERENCES public.ga_purchase_order_adjustments(id) ON DELETE CASCADE,
  amount numeric(14,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_receipt_adjustments_unique UNIQUE (receipt_id, po_adjustment_id)
);
CREATE INDEX IF NOT EXISTS idx_ga_receipt_adjustments_receipt ON public.ga_purchase_receipt_adjustments (receipt_id);

ALTER TABLE public.ga_purchase_order_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_receipt_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_purchase_order_adjustments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_purchase_receipt_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_purchase_order_adjustments TO service_role;
GRANT ALL ON public.ga_purchase_receipt_adjustments TO service_role;

-- ================================================================ 2. 內部輔助與計算
-- 調整列：整批取代（僅草稿呼叫）；輸入金額已含正負號（折扣、折價券、點數折抵為負，運費為正，其他皆可），上限 10 列
CREATE OR REPLACE FUNCTION public.ga_ib1_adjustments_apply(p_po uuid, p_adj jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_el jsonb;
  v_no integer := 0;
  v_kind text;
  v_label text;
  v_txt text;
  v_amt numeric;
  v_orig numeric;
  v_camp text;
  v_note text;
BEGIN
  IF p_adj IS NULL OR jsonb_typeof(p_adj) = 'null' THEN p_adj := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_adj) <> 'array' THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENTS_INVALID', '調整列必須是清單'); END IF;
  IF jsonb_array_length(p_adj) > 10 THEN PERFORM public.ga_po_raise(400, 'TOO_MANY_ADJUSTMENTS', '一張採購單最多 10 列調整（運費、折扣等）'); END IF;
  DELETE FROM public.ga_purchase_order_adjustments WHERE po_id = p_po;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_adj) LOOP
    v_no := v_no + 1;
    IF jsonb_typeof(v_el) <> 'object' THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_INVALID', '第 ' || v_no || ' 列調整格式錯誤'); END IF;
    v_kind := upper(COALESCE(nullif(btrim(COALESCE(v_el ->> 'kind', '')), ''), ''));
    IF v_kind NOT IN ('FREIGHT', 'DISCOUNT', 'COUPON', 'POINTS', 'OTHER') THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_KIND', '第 ' || v_no || ' 列調整的種類錯誤'); END IF;
    v_label := nullif(btrim(COALESCE(v_el ->> 'label', '')), '');
    IF v_label IS NULL THEN v_label := CASE v_kind WHEN 'FREIGHT' THEN '運費' WHEN 'DISCOUNT' THEN '折扣' WHEN 'COUPON' THEN '折價券' WHEN 'POINTS' THEN '點數折抵' ELSE '其他調整' END; END IF;
    IF char_length(v_label) > 60 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_TEXT', '第 ' || v_no || ' 列調整的名稱不可超過 60 字'); END IF;
    v_txt := nullif(btrim(COALESCE(v_el ->> 'amount', '')), '');
    IF v_txt IS NULL OR v_txt !~ '^-?[0-9]{1,8}$' THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_AMOUNT', '第 ' || v_no || ' 列調整金額必須是整數元'); END IF;
    v_amt := v_txt::numeric;
    IF v_amt = 0 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_AMOUNT', '第 ' || v_no || ' 列調整金額不能是 0'); END IF;
    IF v_kind = 'FREIGHT' AND v_amt < 0 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_SIGN', '第 ' || v_no || ' 列運費必須是正數'); END IF;
    IF v_kind IN ('DISCOUNT', 'COUPON', 'POINTS') AND v_amt > 0 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_SIGN', '第 ' || v_no || ' 列折扣、折價券、點數折抵必須是負數'); END IF;
    v_txt := nullif(btrim(COALESCE(v_el ->> 'original_price', '')), '');
    v_orig := NULL;
    IF v_txt IS NOT NULL THEN
      IF v_txt !~ '^[0-9]{1,8}$' THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_AMOUNT', '第 ' || v_no || ' 列原價必須是 0 以上的整數元'); END IF;
      v_orig := v_txt::numeric;
    END IF;
    v_camp := nullif(btrim(COALESCE(v_el ->> 'campaign_name', '')), '');
    IF v_camp IS NOT NULL AND char_length(v_camp) > 100 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_TEXT', '第 ' || v_no || ' 列活動名稱不可超過 100 字'); END IF;
    v_note := nullif(btrim(COALESCE(v_el ->> 'note', '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN PERFORM public.ga_po_raise(400, 'ADJUSTMENT_TEXT', '第 ' || v_no || ' 列備註不可超過 200 字'); END IF;
    INSERT INTO public.ga_purchase_order_adjustments (po_id, line_no, kind, label, amount, original_price, campaign_name, note) VALUES (p_po, v_no, v_kind, v_label, v_amt, v_orig, v_camp, v_note);
  END LOOP;
END;
$f$;

-- 含稅模式的品項：輸入的單價是含稅單價，存成含稅欄位並推算未稅欄位（未稅欄位只供顯示與歷史價比較，不參與總額）
CREATE OR REPLACE FUNCTION public.ga_ib1_item_incl(p_po uuid, p_line_no integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_rate numeric := public.ga_wf_num('po_tax_rate', 0.05);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE id = p_po AND price_mode = 'INCL') THEN RETURN; END IF;
  UPDATE public.ga_purchase_order_items SET unit_price_gross = unit_price, line_gross = round(quantity * unit_price),
         line_amount = round(round(quantity * unit_price) / (1 + v_rate)), unit_price = round(unit_price / (1 + v_rate), 4)
   WHERE po_id = p_po AND line_no = p_line_no;
END;
$f$;

-- 進貨單的未稅、稅額、含稅（含承接的調整列）。未稅模式：未稅＝品項未稅加調整列、稅額＝round(未稅×稅率)；含稅模式：含稅為準、未稅＝round(含稅÷(1＋稅率))、稅額用減的。
CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_calc(p_receipt uuid) RETURNS TABLE (untaxed numeric, tax numeric, total numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT CASE WHEN x.mode = 'INCL' THEN round(x.g / (1 + x.rate)) ELSE x.b END,
         CASE WHEN x.mode = 'INCL' THEN x.g - round(x.g / (1 + x.rate)) ELSE round(x.b * x.rate) END,
         CASE WHEN x.mode = 'INCL' THEN x.g ELSE x.b + round(x.b * x.rate) END
    FROM (SELECT o.price_mode AS mode, o.tax_rate AS rate,
                 COALESCE((SELECT sum(COALESCE(ri.amount_gross, round(ri.amount_untaxed * (1 + o.tax_rate)))) FROM public.ga_purchase_receipt_items ri WHERE ri.receipt_id = r.id), 0)
                   + COALESCE((SELECT sum(ra.amount) FROM public.ga_purchase_receipt_adjustments ra WHERE ra.receipt_id = r.id), 0) AS g,
                 COALESCE((SELECT sum(ri.amount_untaxed) FROM public.ga_purchase_receipt_items ri WHERE ri.receipt_id = r.id), 0)
                   + COALESCE((SELECT sum(ra.amount) FROM public.ga_purchase_receipt_adjustments ra WHERE ra.receipt_id = r.id), 0) AS b
            FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o ON o.id = r.po_id WHERE r.id = p_receipt) x;
$f$;

CREATE OR REPLACE FUNCTION public.ga_pay_receipt_tax(p_receipt uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT COALESCE((SELECT c.tax FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); $f$;

-- 進貨後承接調整列：還沒有有效進貨單承接時，由第一張「品項額加調整額大於 0」的有效進貨單承接全部調整列（進貨當下凍結金額）
CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_adj_carry(p_po uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_adj numeric;
  v_rid uuid;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_adj FROM public.ga_purchase_order_adjustments WHERE po_id = p_po;
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_order_adjustments WHERE po_id = p_po) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ga_purchase_receipt_adjustments ra JOIN public.ga_purchase_receipts r ON r.id = ra.receipt_id WHERE r.po_id = p_po AND r.voided_at IS NULL) THEN RETURN; END IF;
  SELECT r.id INTO v_rid FROM public.ga_purchase_receipts r
   WHERE r.po_id = p_po AND r.voided_at IS NULL
     AND COALESCE((SELECT sum(COALESCE(ri.amount_gross, ri.amount_untaxed)) FROM public.ga_purchase_receipt_items ri WHERE ri.receipt_id = r.id), 0) + v_adj > 0
   ORDER BY r.created_at, r.id LIMIT 1;
  IF v_rid IS NULL THEN RETURN; END IF;
  INSERT INTO public.ga_purchase_receipt_adjustments (receipt_id, po_adjustment_id, amount) SELECT v_rid, a.id, a.amount FROM public.ga_purchase_order_adjustments a WHERE a.po_id = p_po;
END;
$f$;

-- 進貨登錄與作廢進貨的延伸點（階段 5 會重新定義，加入預付核銷）
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

-- 階段 2 的延伸點重新定義（加入計價模式、調整列）
CREATE OR REPLACE FUNCTION public.ga_ib1_po_header_ext(p_po_id uuid, p_header jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_txt text;
  v_id uuid;
  v_cur uuid;
  v_mode text;
  v_old_mode text;
  v_rate numeric;
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
  -- 計價模式（只有草稿可改；切換時保留已輸入的單價數字，只改變它的意義）
  IF p_header ? 'price_mode' THEN
    v_mode := upper(COALESCE(nullif(btrim(COALESCE(p_header ->> 'price_mode', '')), ''), 'EXCL'));
    IF v_mode NOT IN ('EXCL', 'INCL') THEN PERFORM public.ga_po_raise(400, 'INVALID_PRICE_MODE', '單價計價方式只能是未稅或含稅'); END IF;
    SELECT price_mode INTO v_old_mode FROM public.ga_purchase_orders WHERE id = p_po_id AND status = 'DRAFT';
    IF NOT FOUND THEN PERFORM public.ga_po_raise(409, 'PO_LOCKED', '已送出的採購單不能改單價計價方式'); END IF;
    IF v_old_mode IS DISTINCT FROM v_mode THEN
      v_rate := public.ga_wf_num('po_tax_rate', 0.05);
      UPDATE public.ga_purchase_orders SET price_mode = v_mode WHERE id = p_po_id;
      IF v_mode = 'INCL' THEN
        UPDATE public.ga_purchase_order_items SET unit_price_gross = unit_price, line_gross = round(quantity * unit_price),
               line_amount = round(round(quantity * unit_price) / (1 + v_rate)), unit_price = round(unit_price / (1 + v_rate), 4) WHERE po_id = p_po_id;
      ELSE
        UPDATE public.ga_purchase_order_items SET unit_price = COALESCE(unit_price_gross, unit_price), line_amount = round(quantity * COALESCE(unit_price_gross, unit_price)),
               unit_price_gross = NULL, line_gross = NULL WHERE po_id = p_po_id;
      END IF;
    END IF;
  END IF;
  IF p_header ? 'adjustments' THEN PERFORM public.ga_ib1_adjustments_apply(p_po_id, p_header -> 'adjustments'); END IF;
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

-- ================================================================ 3. 既有函式加掛與替換（讀現行定義＋文字替換；已套用就略過、形狀不符就中止）
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
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$
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
$ib1o$), public.ga_ib1_nl(v_def, $ib1n$
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
$ib1n$), 'public.ga_po_refresh_totals(uuid) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
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
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$
BEGIN
  IF NEW.amount_untaxed IS NULL THEN
    SELECT round(i.unit_price * NEW.accepted_qty) INTO NEW.amount_untaxed FROM public.ga_purchase_order_items i WHERE i.id = NEW.po_item_id;
    IF NEW.amount_untaxed IS NULL THEN NEW.amount_untaxed := 0; END IF;
  END IF;
  RETURN NEW;
END;
$ib1o$), public.ga_ib1_nl(v_def, $ib1n$
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
$ib1n$), 'public.ga_pay_freeze_receipt_item_amount() 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_receipt_untaxed(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$ SELECT COALESCE(sum(amount_untaxed), 0) FROM public.ga_purchase_receipt_items WHERE receipt_id = p_receipt; $ib1o$), public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$), 'public.ga_pay_receipt_untaxed(uuid) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_receipt_total(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$ SELECT public.ga_pay_receipt_untaxed(p_receipt) + round(public.ga_pay_receipt_untaxed(p_receipt) * COALESCE(public.ga_pay_receipt_rate(p_receipt), 0)); $ib1o$), public.ga_ib1_nl(v_def, $ib1n$
  SELECT COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0); /* GAIB1-S3 */
$ib1n$), 'public.ga_pay_receipt_total(uuid) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
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
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(x.u), 0) AS u, COALESCE(sum(round(x.u * o.tax_rate)), 0) AS t
                    FROM (SELECT sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id
                           WHERE r.po_id = p_po AND r.voided_at IS NULL GROUP BY r.id) x) s
   WHERE o.id = p_po;
$ib1o$), public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(c.untaxed), 0) AS u, COALESCE(sum(c.tax), 0) AS t
                    FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) c
                   WHERE r.po_id = p_po AND r.voided_at IS NULL) s
   WHERE o.id = p_po;
$ib1n$), 'public.ga_pay_po_received(uuid) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
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
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$
  SELECT o.id,
         COALESCE(s.tot, 0),
         COALESCE(c.claimed, 0),
         COALESCE(c.paid, 0)
    FROM public.ga_purchase_orders o
    LEFT JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL AND r.po_id = ANY (p_ids) GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) FILTER (WHERE q.status <> 'VOID') AS claimed, sum(l.claim_total) FILTER (WHERE q.status = 'PAID') AS paid
                 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = ANY (p_ids) GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE o.id = ANY (p_ids);
$ib1o$), public.ga_ib1_nl(v_def, $ib1n$
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
$ib1n$), 'public.ga_pay_po_amounts(uuid[]) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_unclaimed_po_ids(numeric)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT x.po_id, sum(x.u + round(x.u * x.rate)) AS tot FROM (SELECT r.po_id, o2.tax_rate AS rate, sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id WHERE r.voided_at IS NULL GROUP BY r.po_id, r.id, o2.tax_rate) x GROUP BY x.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1o$), public.ga_ib1_nl(v_def, $ib1n$
  /* GAIB1-S3 */
  SELECT o.id
    FROM public.ga_purchase_orders o
    JOIN (SELECT r.po_id, sum(rc.total) AS tot FROM public.ga_purchase_receipts r CROSS JOIN LATERAL public.ga_ib1_receipt_calc(r.id) rc WHERE r.voided_at IS NULL GROUP BY r.po_id) s ON s.po_id = o.id
    LEFT JOIN (SELECT l.po_id, sum(l.claim_total) AS c FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE q.status <> 'VOID' GROUP BY l.po_id) c ON c.po_id = o.id
   WHERE s.tot - COALESCE(c.c, 0) > p_tol;
$ib1n$), 'public.ga_pay_unclaimed_po_ids(numeric) 整支本體');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_items_apply(uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$            v_mode, v_sid, v_tid, v_over, v_note);
    PERFORM public.ga_ib1_item_incl(p_po_id, v_no); -- GAIB1-S3
  END LOOP;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$            v_mode, v_sid, v_tid, v_over, v_note);
  END LOOP;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$            v_mode, v_sid, v_tid, v_over, v_note);
    PERFORM public.ga_ib1_item_incl(p_po_id, v_no); -- GAIB1-S3
  END LOOP;$ib1n$), 'public.ga_po_items_apply(uuid,jsonb) 含稅品項');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_po_receive(uuid,jsonb,jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receive_ext(p_po_id, v_rid, v_uid); -- GAIB1-S3
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receive_ext(p_po_id, v_rid, v_uid); -- GAIB1-S3
    RETURN jsonb_build_object('ok', true, 'status', 201, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(v_rid), 'po', public.ga_po_data(p_po_id));$ib1n$), 'public.ga_ws_po_receive(uuid,jsonb,jsonb,text) 承接調整列');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receipt_void_ext(p_po_id, r.id, v_reason, v_uid); -- GAIB1-S3
    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    PERFORM public.ga_ib1_receipt_void_ext(p_po_id, r.id, v_reason, v_uid); -- GAIB1-S3
    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,$ib1n$), 'public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone) 轉移調整列');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_receipt_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items) || public.ga_ib1_receipt_data_ext(p_id); -- GAIB1-S3$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items);$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    'created_by_name', (SELECT full_name FROM public.profiles WHERE id = v_r.created_by), 'items', v_items) || public.ga_ib1_receipt_data_ext(p_id); -- GAIB1-S3$ib1n$), 'public.ga_po_receipt_data(uuid) 進貨單輸出');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_apply_lines(uuid,uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid) THEN public.ga_pay_receipt_tax(v_rid) ELSE round(v_u * v_rec.tax_rate) END; END IF; /* GAIB1-S3 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    IF v_t IS NULL THEN v_t := round(v_u * v_rec.tax_rate); END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid) THEN public.ga_pay_receipt_tax(v_rid) ELSE round(v_u * v_rec.tax_rate) END; END IF; /* GAIB1-S3 */$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 預設稅額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'receipt_tax', public.ga_pay_receipt_tax(x.receipt_id), 'receipt_total', x.u + public.ga_pay_receipt_tax(x.receipt_id), /* GAIB1-S3 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'receipt_tax', round(x.u * x.tax_rate), 'receipt_total', x.u + round(x.u * x.tax_rate),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'receipt_tax', public.ga_pay_receipt_tax(x.receipt_id), 'receipt_total', x.u + public.ga_pay_receipt_tax(x.receipt_id), /* GAIB1-S3 */$ib1n$), 'public.ga_ws_pay_receipt_candidates(jsonb,integer,integer) 候選稅額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'unit_price', i.unit_price, 'line_amount', i.line_amount, 'unit_price_gross', i.unit_price_gross, 'line_gross', i.line_gross, /* GAIB1-S3 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'unit_price', i.unit_price, 'line_amount', i.line_amount,$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'unit_price', i.unit_price, 'line_amount', i.line_amount, 'unit_price_gross', i.unit_price_gross, 'line_gross', i.line_gross, /* GAIB1-S3 */$ib1n$), 'public.ga_po_data(uuid) 含稅品項輸出');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- ================================================================ 5. 權限：內部輔助與觸發器函式不開放（不授權給任何角色）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ib1_adjustments_apply', 'ga_ib1_item_incl', 'ga_ib1_receipt_calc', 'ga_pay_receipt_tax', 'ga_ib1_receipt_adj_carry', 'ga_ib1_receive_ext',
                                                         'ga_ib1_receipt_void_ext', 'ga_ib1_receipt_data_ext', 'ga_ib1_po_header_ext', 'ga_ib1_po_data_ext') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
